import { OfflineMigration } from "../OfflineStorageMigrator.js"
import { OfflineStorage } from "../OfflineStorage.js"
import { SqlCipherFacade } from "../../../../native/common/generatedipc/SqlCipherFacade.js"
import { addValue, deleteInstancesOfType, migrateAllListElements } from "../StandardMigrations.js"
import { PushIdentifierTypeRef } from "../../../entities/sys/TypeRefs.js"

import { AppType } from "../../../common/TutanotaConstants.js"

export const sys104: OfflineMigration = {
	app: "sys",
	version: 104,
	async migrate(storage: OfflineStorage, _: SqlCipherFacade) {
		await deleteInstancesOfType(storage, PushIdentifierTypeRef)
	},
}
