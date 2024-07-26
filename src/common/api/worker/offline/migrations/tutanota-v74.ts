import { OfflineMigration } from "../OfflineStorageMigrator.js"
import { OfflineStorage } from "../OfflineStorage.js"
import { addValue, migrateAllElements, renameAttribute } from "../StandardMigrations.js"
import {
	CalendarGroupRootTypeRef,
	GroupSettingsTypeRef,
	TutanotaPropertiesTypeRef,
	UserSettingsGroupRoot,
	UserSettingsGroupRootTypeRef,
} from "../../../entities/tutanota/TypeRefs.js"

export const tutanota74: OfflineMigration = {
	app: "tutanota",
	version: 74,
	async migrate(storage: OfflineStorage) {
		await migrateAllElements(UserSettingsGroupRootTypeRef, storage, [
			(oldUserSettings: UserSettingsGroupRoot) => {
				oldUserSettings.groupSettings = oldUserSettings.groupSettings.map((settings) => {
					return { ...settings, sourceUrl: null }
				})

				return oldUserSettings
			},
		])
	},
}
