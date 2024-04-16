import http from "node:http"
import type { DesktopNetworkClient } from "../net/DesktopNetworkClient"
import { log } from "../DesktopLog"

const TAG = "[SSE]"

export interface SseEventHandler {
	onNewMessage: (message: string) => unknown
	onNotAuthenticated: () => unknown
}

export interface SseConnectOptions {
	url: URL
	headers: Record<string, string | undefined>
}

type State =
	| { state: "notconnected" }
	| { state: "connecting"; options: SseConnectOptions; connection: http.ClientRequest; attempt: number }
	| { state: "connected"; options: SseConnectOptions; connection: http.ClientRequest }

export class SseClient {
	private listener: SseEventHandler | null = null
	private _state: State = { state: "notconnected" }
	private set state(newState: State) {
		log.debug(TAG, "state:", newState.state)
		this._state = newState
	}

	private get state(): State {
		return this._state
	}

	constructor(private readonly net: DesktopNetworkClient) {}

	connect(options: SseConnectOptions) {
		log.debug(TAG, "connect")
		switch (this.state.state) {
			case "connected":
			case "connecting":
				// FIXME maybe await for it
				this.disconnect()
				break
			case "notconnected":
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
				this.state = { state: "connected", connection, options }

				if (res.statusCode === 403 || res.statusCode === 401) {
					this.listener?.onNotAuthenticated()
					this.disconnect()
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
					.on("close", () => {
						log.debug("sse response closed")

						// FIXME reschedule if needed
						// this.connection = null
						// this._reschedule(initialConnectTimeoutSeconds)
					})
					.on("error", (e) => {
						console.error("sse response error:", e)
						// FIXME reconnect
					})
			})
			.on("information", (e) => log.debug(TAG, "sse information"))
			.on("connect", (e) => log.debug(TAG, "sse connect:"))
			.on("error", (e) => {
				console.error("sse error:", e.message)
				// FIXME reconnect, taking attempt number into account
			})
			.end()
		this.state = { state: "connecting", attempt: 1, connection, options }
	}

	disconnect() {
		switch (this.state.state) {
			case "connected":
			case "connecting":
				// FIXME is this right? await
				this.state.connection.destroy()
				this.state = { state: "notconnected" }
		}
	}

	setEventListener(listener: SseEventHandler) {
		this.listener = listener
	}

	setReadTimeout(timeout: number) {}
}
