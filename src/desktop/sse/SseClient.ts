import http from "node:http"
import type { DesktopNetworkClient } from "../net/DesktopNetworkClient"
import { log } from "../DesktopLog"
import { SseStorage } from "./SseStorage.js"

const TAG = "[SSE]"

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
	| { state: ConnectionState.connected; options: SseConnectOptions; connection: http.ClientRequest }

export class SseClient {
	private listener: SseEventHandler | null = null
	private _state: State = { state: ConnectionState.disconnected }
	private readTimeout: number | null = null
	private timeoutHandle: NodeJS.Timeout | null = null
	private set state(newState: State) {
		log.debug(TAG, "state:", ConnectionState[newState.state])
		this._state = newState
	}

	private get state(): State {
		return this._state
	}

	constructor(private readonly net: DesktopNetworkClient, private readonly sseStorage: SseStorage) {}

	async connect(options: SseConnectOptions) {
		// FIXME split to handle different states
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
				this.state = { state: ConnectionState.connected, connection, options }

				if (res.statusCode === 403 || res.statusCode === 401) {
					await this.listener?.onNotAuthenticated()
					await this.disconnect()
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
						this.listener?.onNewMessage(l.trim())
					}
				})
					.on("close", async () => {
						log.debug("sse response closed")

						// FIXME reschedule if needed
						const initialConnectTimeoutSeconds = (await this.sseStorage.getInitialSseConnectTimeoutInSeconds()) ?? 60
						await this.scheduledReconnect(initialConnectTimeoutSeconds)
						// this._reschedule(initialConnectTimeoutSeconds)
					})
					.on("error", (e) => {
						console.error("sse response error:", e)
						// FIXME reconnect
					})
			})
			.on("information", (e) => log.debug(TAG, "sse information"))
			.on("connect", (e) => log.debug(TAG, "sse connect:"))
			.on("error", async (e) => {
				console.error("sse error:", e.message)
				this.scheduledReconnect(await this.calcReconnectTimeoutInSeconds())
			})
			.end()
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
	}

	private async calcReconnectTimeoutInSeconds() {
		if (this.state.state !== ConnectionState.connecting) return 0
		// FIXME null may be unnecessary
		const initialConnectTimeoutSeconds = (await this.sseStorage.getInitialSseConnectTimeoutInSeconds()) ?? 60
		const maxConnectTimeoutSeconds = (await this.sseStorage.getMaxSseConnectTimeoutInSeconds()) ?? 2400
		// double the connection timeout with each attempt to connect, capped by maxConnectTimeoutSeconds
		return Math.min(initialConnectTimeoutSeconds * Math.pow(2, this.state.attempt), maxConnectTimeoutSeconds)
	}

	/**
	 * Only use with clean disconnected state
	 */
	scheduledConnect(timeout: number, options: SseConnectOptions) {
		if (this.state.state === ConnectionState.connecting) return
		if (this.timeoutHandle != null) clearTimeout(this.timeoutHandle)
		this.timeoutHandle = setTimeout(async () => {
			await this.connect(options)
		}, timeout)
	}

	/**
	 * Only use with connecting state
	 */
	private scheduledReconnect(timeout: number) {
		if (this.timeoutHandle != null) clearTimeout(this.timeoutHandle)
		this.timeoutHandle = setTimeout(this.reconnect, timeout)
	}

	private async reconnect() {
		if (this.state.state !== ConnectionState.connecting) return
		this.state.attempt++
		await this.connect(this.state.options)
	}
}
