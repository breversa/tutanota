import type { WindowManager } from "../DesktopWindowManager"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade"
import type { DesktopConfig } from "../config/DesktopConfig"
import { DesktopNotifier, NotificationResult } from "../DesktopNotifier"
import { LanguageViewModel } from "../../misc/LanguageViewModel"
import { Agent, fetch as undiciFetch } from "undici"
import { IdTupleWrapper, NotificationInfo } from "../../api/entities/sys/TypeRefs"
import { CredentialEncryptionMode } from "../../misc/credentials/CredentialEncryptionMode"
import { DesktopConfigEncKey, DesktopConfigKey } from "../config/ConfigKeys"
import { ExtendedNotificationMode } from "../../native/common/generatedipc/ExtendedNotificationMode"
import { assertNotNull, base64ToBase64Url, neverNull } from "@tutao/tutanota-utils"
import { log } from "../DesktopLog"
import tutanotaModelInfo from "../../api/entities/tutanota/ModelInfo"
import { handleRestError } from "../../api/common/error/RestError"
import { EncryptedAlarmNotification } from "../../native/common/EncryptedAlarmNotification"
import { SseInfo } from "./DesktopSseClient"
import { Mail } from "../../api/entities/tutanota/TypeRefs.js"

const TAG = "[notifications]"

type MailMetadata = Pick<Mail, "sender" | "firstRecipient" | "_id">

export class TutaNotificationHandler {
	constructor(
		private readonly wm: WindowManager,
		private readonly nativeCredentialFacade: NativeCredentialsFacade,
		private readonly conf: DesktopConfig,
		private readonly notifier: DesktopNotifier,
		private readonly lang: LanguageViewModel,
		private readonly fetch: typeof undiciFetch,
		private readonly appVersion: string,
	) {}

	async onMailNotification(notificationInfo: NotificationInfo) {
		const w = this.wm.getAll().find((w) => w.getUserId() === notificationInfo.userId)

		if (w && w.isFocused()) {
			// no need for notification if user is looking right at the window
			return
		}

		// we can't download the email if we don't have access to credentials
		const canShowExtendedNotification =
			(await this.nativeCredentialFacade.getCredentialEncryptionMode()) === CredentialEncryptionMode.DEVICE_LOCK &&
			(await this.conf.getVar(DesktopConfigKey.extendedNotificationMode)) !== ExtendedNotificationMode.NoSenderOrSubject
		if (!canShowExtendedNotification) {
			const notificationId = notificationInfo.mailId
				? `${notificationInfo.mailId.listId},${notificationInfo.mailId?.listElementId}`
				: notificationInfo.userId
			this.notifier.submitGroupedNotification(this.lang.get("pushNewMail_msg"), `${notificationInfo.mailAddress}`, notificationId, (res) =>
				this.onMailNotificationClick(res, notificationInfo),
			)
			return
		}
		const mailMetadata = await this.downloadMailMetadata(notificationInfo)
		if (mailMetadata == null) return
		this.notifier.submitGroupedNotification(mailMetadata.sender.address, mailMetadata.firstRecipient?.address ?? "", mailMetadata._id.join(","), (res) =>
			this.onMailNotificationClick(res, notificationInfo),
		)
	}

	private onMailNotificationClick(res: NotificationResult, ni: NotificationInfo) {
		if (res === NotificationResult.Click) {
			this.wm.openMailBox({
				userId: ni.userId,
				mailAddress: ni.mailAddress,
			})
		}
	}

	private async downloadMailMetadata(ni: NotificationInfo): Promise<MailMetadata | null> {
		const sseInfo = await this.conf.getVar(DesktopConfigEncKey.sseInfo)
		const url = this.makeMailMetadataUrl(assertNotNull(sseInfo), assertNotNull(ni.mailId))

		// decrypt access token
		const credentials = await this.nativeCredentialFacade.loadByUserId(ni.userId)
		if (credentials == null) {
			log.warn(`Not found credentials to download notification, userId ${ni.userId}`)
			return null
		}

		log.debug(TAG, "downloading mail notification metadata")
		const headers: Record<string, string> = {
			userIds: ni.userId,
			v: tutanotaModelInfo.version.toString(),
			cv: this.appVersion,
			accessToken: credentials.accessToken,
		}

		try {
			const response = await this.fetch(url, {
				headers: headers,
				dispatcher: new Agent({ connectTimeout: 20000 }),
			})
			if (!response.ok) {
				const tutanotaError = handleRestError(neverNull(response.status), url.toString(), response.headers.get("Error-Id"), null)
				throw tutanotaError
			}

			const parsedResponse = await response.json()
			return parsedResponse as MailMetadata
		} catch (e) {
			log.debug(TAG, "Error fetching mail metadata, " + (e as Error).message)
			return null
		}
	}

	private makeMailMetadataUrl(sseInfo: SseInfo, mailId: IdTupleWrapper): URL {
		const url = new URL(sseInfo.sseOrigin)
		url.pathname = `rest/tutanota/mail/${base64ToBase64Url(mailId.listId)}/${base64ToBase64Url(mailId.listElementId)}`
		return url
	}

	onAlarmNotification(alarmNotification: EncryptedAlarmNotification) {}

	onUserInvalidated(userId: Id) {}
}
