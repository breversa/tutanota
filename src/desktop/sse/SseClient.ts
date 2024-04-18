import http from "node:http"
import type { DesktopNetworkClient } from "../net/DesktopNetworkClient"
import { log } from "../DesktopLog"

const TAG = "[SSE]"

export interface SseDelay {
	reconnectDelay(attempt: number): number
	initialConnectionDelay(): number
}

export interface SseEventHandler {
	onNewMessage: (message: string) => unknown
	onNotAuthenticated: () => unknown
}

export interface SseConnectOptions {
	url: URL
	headers: Record<string, string | undefined>
}

export enum ConnectionState {
	disconnected,
	connecting,
	connected,
}

type State =
	| { state: ConnectionState.disconnected }
	| { state: ConnectionState.connecting; options: SseConnectOptions; connection: http.ClientRequest; attempt: number }
	| { state: ConnectionState.connected; options: SseConnectOptions; connection: http.ClientRequest; receivedHeartbeat: boolean }

export class SseClient {
	private listener: SseEventHandler | null = null
	private _state: State = { state: ConnectionState.disconnected }
	private readTimeout: number | null = null
	private timeoutHandle: NodeJS.Timeout | null = null
	private heartBeatListenderHandle: NodeJS.Timeout | undefined = undefined
	private set state(newState: State) {
		log.debug(TAG, "state:", ConnectionState[newState.state])
		this._state = newState
	}

	private get state(): State {
		return this._state
	}

	constructor(private readonly net: DesktopNetworkClient, private readonly delay: SseDelay) {}

	async connect(options: SseConnectOptions) {
		log.debug(TAG, "connect")
		switch (this.state.state) {
			case ConnectionState.connecting:
			case ConnectionState.connected:
				await this.disconnect()
				break
			case ConnectionState.disconnected:
			// go on with connection
		}
		const { url, headers } = options

		const connection = this.net.request(url, {
			headers: {
				"Content-Type": "application/json",
				Connection: "Keep-Alive",
				"Keep-Alive": "header",
				Accept: "text/event-stream",
				...headers,
			},
			method: "GET",
		})
		connection
			.on("socket", (s) => {
				// We add this listener purely as a workaround for some problem with net module.
				// The problem is that sometimes request gets stuck after handshake - does not process unless some event
				// handler is called (and it works more reliably with console.log()).
				// This makes the request magically unstuck, probably console.log does some I/O and/or socket things.
				s.on("lookup", () => log.debug("lookup sse request"))
			})
			.on("response", async (res) => {
				log.debug("established SSE connection with code", res.statusCode)
				this.state = { state: ConnectionState.connected, connection, options, receivedHeartbeat: false }

				if (res.statusCode === 403 || res.statusCode === 401) {
					await this.listener?.onNotAuthenticated()
					await this.delayedReconnect()
					return
				}

				res.setEncoding("utf8")
				let resData = ""
				res.on("data", (d) => {
					// add new data to the buffer
					resData += d
					const lines = resData.split("\n")
					resData = lines.pop() ?? "" // put the last line back into the buffer

					for (const l of lines) {
						const trimmedLine = l.trim()
						if (trimmedLine === "") {
							log.debug("heartbeat")
							this.onHeartbeat()
						} else {
							this.listener?.onNewMessage(trimmedLine)
						}
					}
				})
					.on("close", async () => {
						log.debug("sse response closed")
						await this.delayedReconnect()
					})
					.on("error", async (e) => {
						console.error("sse response error:", e)
						await this.delayedReconnect()
					})
			})
			.on("information", () => log.debug(TAG, "sse information"))
			.on("connect", () => log.debug(TAG, "sse connect:"))
			.on("error", async (e) => {
				console.error("sse error:", e.message)
				await this.exponentialBackdownReconnect()
			})
			.end()
		this.state = { state: ConnectionState.connecting, attempt: 1, connection, options }
	}

	async disconnect() {
		return new Promise<void>((resolve) => {
			switch (this.state.state) {
				case ConnectionState.connected:
				case ConnectionState.connecting:
					this.state.connection.once("close", () => {
						this.state = { state: ConnectionState.disconnected }
						resolve()
					})
					this.state.connection.destroy()
			}
		})
	}

	setEventListener(listener: SseEventHandler) {
		this.listener = listener
	}

	setReadTimeout(timeout: number) {
		this.readTimeout = timeout
		this.resetHeartbeatListener()
		this.onHeartbeat()
	}

	private async exponentialBackdownReconnect() {
		if (this.timeoutHandle != null) clearTimeout(this.timeoutHandle)
		if (this.state.state !== ConnectionState.connecting) return
		this.timeoutHandle = setTimeout(this.retryConnect, this.delay.reconnectDelay(this.state.attempt))
	}

	private async delayedReconnect() {
		if (this.timeoutHandle != null) clearTimeout(this.timeoutHandle)
		this.timeoutHandle = setTimeout(this.retryConnect, this.delay.initialConnectionDelay())
	}

	private async retryConnect() {
		// noinspection FallThroughInSwitchStatementJS
		switch (this.state.state) {
			case ConnectionState.connecting:
				this.state.attempt++
			case ConnectionState.connected:
				await this.connect(this.state.options)
				break
		}
	}

	private onHeartbeat() {
		if (this.state.state === ConnectionState.connected) {
			this.state = { ...this.state, receivedHeartbeat: true }
		}
	}

	private resetHeartbeatListener() {
		// It will check if the heartbeat was received periodically.
		// Theoretically we need to reset this every time we connect but
		// the server will send us the timeout right after the connection anyway.
		clearInterval(this.heartBeatListenderHandle)
		this.heartBeatListenderHandle = setInterval(() => {
			if (this.state.state === ConnectionState.connected) {
				if (this.state.receivedHeartbeat) {
					this.state = { ...this.state, receivedHeartbeat: false }
				} else {
					this.connect(this.state.options)
				}
			}
		}, Math.floor(this.readTimeout! * 1.2))
	}
}
