import { Indexer } from "../api/worker/search/Indexer.js"
import { NativePushServiceApp } from "../native/main/NativePushServiceApp.js"
import { ConfigurationDatabase } from "../api/worker/facades/lazy/ConfigurationDatabase.js"
import { MobileContactsFacade } from "../native/common/generatedipc/MobileContactsFacade.js"
import { ofClass } from "@tutao/tutanota-utils"
import { PermissionError } from "../api/common/error/PermissionError.js"
import { UnencryptedCredentials } from "../native/common/generatedipc/UnencryptedCredentials.js"

export interface CredentialRemovalHandler {
	onCredentialsRemoved(credentials: UnencryptedCredentials): Promise<void>
}

export class NoopCredentialRemovalHandler implements CredentialRemovalHandler {
	async onCredentialsRemoved(_: UnencryptedCredentials): Promise<void> {}
}

export class AppsCredentialRemovalHandler implements CredentialRemovalHandler {
	constructor(
		private readonly indexer: Indexer,
		private readonly pushApp: NativePushServiceApp,
		private readonly configFacade: ConfigurationDatabase,
		private readonly mobileContactsFacade: MobileContactsFacade | null,
	) {}

	async onCredentialsRemoved(credentials: UnencryptedCredentials) {
		if (credentials.databaseKey != null) {
			const { userId } = credentials.credentialInfo
			await this.indexer.deleteIndex(userId)
			await this.pushApp.invalidateAlarmsForUser(userId)
			await this.pushApp.removeUserFromNotifications(userId)
			await this.configFacade.delete(userId)
		}

		await this.mobileContactsFacade
			?.deleteContacts(credentials.credentialInfo.login, null)
			.catch(ofClass(PermissionError, (e) => console.log("No permission to clear contacts", e)))
	}
}
