import o from "@tutao/otest"
import { MISSED_NOTIFICATION_TTL, TutaSseFacade } from "../../../../src/desktop/sse/TutaSseFacade.js"
import { matchers, object, verify, when } from "testdouble"
import { SseStorage } from "../../../../src/desktop/sse/SseStorage.js"
import { TutaNotificationHandler } from "../../../../src/desktop/sse/TutaNotificationHandler.js"
import { SseClient, SseConnectOptions } from "../../../../src/desktop/sse/SseClient.js"
import { DesktopNativeCryptoFacade } from "../../../../src/desktop/DesktopNativeCryptoFacade.js"
import { fetch as undiciFetch } from "undici"
import { typeModels } from "../../../../src/api/entities/sys/TypeModels.js"
import { deepEqual } from "@tutao/tutanota-utils"
import { DateProvider } from "../../../../src/api/common/DateProvider.js"

const APP_V = "3"
o.spec("TutaSseFacade", () => {
	let sseFacade: TutaSseFacade
	let sseStorage: SseStorage
	let notificationHandler: TutaNotificationHandler
	let sseClient: SseClient
	let crypto: DesktopNativeCryptoFacade
	let fetch: typeof undiciFetch
	let date: DateProvider
	o.beforeEach(() => {
		sseStorage = object()
		notificationHandler = object()
		sseClient = object()
		crypto = object()
		fetch = object()
		date = object()
		sseFacade = new TutaSseFacade(sseStorage, notificationHandler, sseClient, crypto, APP_V, fetch, date)
	})

	function setupSseInfo() {
		when(sseStorage.getSseInfo()).thenResolve({
			identifier: "id",
			sseOrigin: "http://something.com",
			userIds: ["userId"],
		})
	}

	o.spec("connect", () => {
		o.test("connect", async () => {
			setupSseInfo()
			await sseFacade.connect()
			const url = new URL(
				"http://something.com/sse?_body=%7B%22_format%22%3A%220%22%2C%22identifier%22%3A%22id%22%2C%22userIds%22%3A%5B%7B%22value%22%3A%22userId%22%7D%5D%7D",
			)
			verify(
				sseClient.connect(
					matchers.argThat((opts: SseConnectOptions) => {
						return opts.url.toString() === url.toString() && deepEqual(opts.headers, { v: typeModels.MissedNotification.version, cv: APP_V })
					}),
				),
			)
		})
		o.test("connect when notification TTL expired", async () => {
			when(date.now()).thenReturn(MISSED_NOTIFICATION_TTL + 100)
			when(sseStorage.getMissedNotificationCheckTime()).thenResolve(1)
			await sseFacade.connect()
			verify(notificationHandler.onExpiredData())
			verify(sseStorage.clear())
			verify(sseClient.connect(matchers.anything()), { times: 0 })
		})
		o.test("disconnect and reconnect when already connected", async () => {
			setupSseInfo()
			await sseFacade.connect()
			await sseFacade.connect()
			verify(sseClient.disconnect())
			verify(sseClient.connect(matchers.anything()), { times: 2 })
		})
		o.test("set heartbeat timeout when connecting", async () => {
			when(sseStorage.getHeartbeatTimeoutSec()).thenResolve(1)
			setupSseInfo()
			await sseFacade.connect()
			verify(sseClient.setReadTimeout(1))
		})
	})
})
