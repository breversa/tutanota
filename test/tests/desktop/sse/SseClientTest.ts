import o from "@tutao/otest"
import { SseClient, SseConnectOptions, SseDelay, SseEventHandler } from "../../../../src/desktop/sse/SseClient.js"
import { ClientRequestOptions, DesktopNetworkClient } from "../../../../src/desktop/net/DesktopNetworkClient.js"
import { matchers, object } from "testdouble"
import http from "node:http"
import { verify } from "@tutao/tutanota-test-utils"
import { assertNotNull, defer } from "@tutao/tutanota-utils"

o.spec("SseClient", function () {
	const defaultOptions: SseConnectOptions = Object.freeze({ url: new URL("http://example.com"), headers: { header: "headerValue" } })

	let sseClient: SseClient
	let net: NetStub
	let delay: SseDelay
	let listener: SseEventHandler

	o.beforeEach(() => {
		net = new NetStub()
		delay = object()
		listener = object()

		sseClient = new SseClient(net as unknown as DesktopNetworkClient, delay)

		sseClient.setEventListener(listener)
	})

	o.test("connect passes options to net correctly", async () => {
		await sseClient.connect(defaultOptions)
		const request = await net.waitForRequest()
		o(request.url).deepEquals(defaultOptions.url)
		o(request.opts).deepEquals({
			headers: {
				"Content-Type": "application/json",
				Connection: "Keep-Alive",
				"Keep-Alive": "header",
				Accept: "text/event-stream",
				header: "headerValue",
			},
			method: "GET",
		})
	})

	o.spec("messages", () => {
		o.test("heartbeat does not trigger listener", async () => {
			const response = new ResponseStub()

			await sseClient.connect(defaultOptions)

			const request = await net.waitForRequest()
			await request.sendResponse(response)
			response.sendData("\n\n")

			verify(listener.onNewMessage(matchers.anything()), { times: 0 })
		})

		o.test("data message triggers listener", async () => {
			const response = new ResponseStub()

			await sseClient.connect(defaultOptions)

			const request = await net.waitForRequest()
			await request.sendResponse(response)
			response.sendData("data: test\n")

			verify(listener.onNewMessage("data: test"))
		})
	})
})

class NetStub implements Partial<DesktopNetworkClient> {
	private requestDefer = defer<RequestStub>()
	requests: RequestStub[] = []
	request(url: URL, opts: ClientRequestOptions): http.ClientRequest {
		const requestMock = new RequestStub(url, opts)
		this.requests.push(requestMock)
		this.requestDefer.resolve(requestMock)
		return requestMock as unknown as http.ClientRequest
	}

	waitForRequest(): Promise<RequestStub> {
		return this.requestDefer.promise
	}
}

class RequestStub implements Partial<http.ClientRequest> {
	constructor(readonly url: URL, readonly opts: ClientRequestOptions) {}

	eventListeners = new Map<string, (...args: any[]) => unknown>()
	on(event, listener) {
		this.eventListeners.set(event, listener)
		return this as unknown as http.ClientRequest
	}

	async sendResponse(response: ResponseStub) {
		await assertNotNull(this.eventListeners.get("response"))(response)
	}

	end() {
		return this as unknown as http.ClientRequest
	}
}

class ResponseStub implements Partial<http.IncomingMessage> {
	eventListeners = new Map<string, (...args: any[]) => unknown>()
	on(event, listener) {
		this.eventListeners.set(event, listener)
		return this as unknown as http.IncomingMessage
	}

	setEncoding() {
		return this as unknown as http.IncomingMessage
	}

	sendData(data: string) {
		assertNotNull(this.eventListeners.get("data"))(data)
	}
}
