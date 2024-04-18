import { DesktopConfig } from "../config/DesktopConfig.js"
import { SseInfo } from "./DesktopSseClient.js"
import { DesktopConfigEncKey, DesktopConfigKey } from "../config/ConfigKeys.js"
import { remove } from "@tutao/tutanota-utils"

export class SseStorage {
	constructor(private readonly conf: DesktopConfig) {}

	async getSseInfo(): Promise<SseInfo | null> {
		return (await this.conf.getVar(DesktopConfigEncKey.sseInfo)) as SseInfo | null
	}

	async storePushIdentifier(identifier: string, userId: Id, sseOrigin: string) {
		const previousSseInfo = await this.getSseInfo()
		let newSseInfo: SseInfo
		if (!previousSseInfo) {
			newSseInfo = {
				identifier,
				userIds: [userId],
				sseOrigin,
			}
		} else {
			newSseInfo = previousSseInfo
			newSseInfo.userIds.push(userId)
		}
		await this.conf.setVar(DesktopConfigEncKey.sseInfo, newSseInfo)
	}

	async removeUser(userId: Id) {
		const sseInfo = await this.getSseInfo()
		if (sseInfo != null) {
			remove(sseInfo.userIds, userId)
			await this.conf.setVar(DesktopConfigEncKey.sseInfo, sseInfo)
		}
	}

	async getMissedNotificationCheckTime(): Promise<number | null> {
		const value = await this.conf.getVar(DesktopConfigKey.lastMissedNotificationCheckTime)
		return value ?? null
	}

	async recordMissedNotificationCheckTime() {
		await this.conf.setVar(DesktopConfigKey.lastMissedNotificationCheckTime, Date.now())
	}

	async getLastProcessedNotificationId(): Promise<Id | null> {
		const value = await this.conf.getVar(DesktopConfigKey.lastProcessedNotificationId)
		return value ?? null
	}

	async setLastProcessedNotificationId(id: Id) {
		await this.conf.setVar(DesktopConfigKey.lastProcessedNotificationId, id)
	}

	async getHeartbeatTimeoutSec(): Promise<number | null> {
		const value = await this.conf.getVar(DesktopConfigKey.heartbeatTimeoutInSeconds)
		return value ?? null
	}

	async setHeartbeatTimeoutSec(timeout: number) {
		await this.conf.setVar(DesktopConfigKey.heartbeatTimeoutInSeconds, timeout)
	}

	async clear() {
		await this.conf.setVar(DesktopConfigKey.lastMissedNotificationCheckTime, null)
		await this.conf.setVar(DesktopConfigKey.lastProcessedNotificationId, null)
		await this.conf.setVar(DesktopConfigKey.heartbeatTimeoutInSeconds, null)
		await this.conf.setVar(DesktopConfigEncKey.sseInfo, null)
	}
}
