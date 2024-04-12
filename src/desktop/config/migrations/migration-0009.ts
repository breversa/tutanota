import type { Config } from "../ConfigCommon"
import { DesktopConfigEncKey, DesktopConfigKey } from "../ConfigKeys.js"
import { ExtendedNotificationMode } from "../../../native/common/generatedipc/ExtendedNotificationMode.js"

/** add the extendedNotificationMode value with different default for existing users */
async function migrate(oldConfig: Config): Promise<void> {
	Object.assign(oldConfig, {
		desktopConfigVersion: 9,
		[DesktopConfigKey.extendedNotificationMode]: oldConfig[DesktopConfigEncKey.sseInfo]
			? ExtendedNotificationMode.NoSenderOrSubject
			: ExtendedNotificationMode.SenderAndSubject,
	})
}

export const migrateClient = migrate
export const migrateAdmin = migrate
