import { DeviceConfig } from "../DeviceConfig.js"
import type { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { Dialog } from "../../gui/base/Dialog.js"

export class CredentialFormatMigrator {
	constructor(private readonly deviceConfig: DeviceConfig, private readonly nativeCredentialFacade: NativeCredentialsFacade | null) {}

	async migrate(): Promise<void> {
		try {
			await this.migrateToNativeCredentials()
		} catch (e) {
			console.error(e)
			await Dialog.message(
				() => "Could not migrate credentials",
				`${e.name} ${e.message}
${e.stack}`,
			).then(() => this.migrate())
		}
	}

	/**
	 * Migrate existing credentials to native db if the migration haven't happened once. Also generate database key if missing.
	 */
	private async migrateToNativeCredentials() {
		if (this.nativeCredentialFacade != null && !this.deviceConfig.getIsCredentialsMigratedToNative()) {
			console.log("Migrating credentials to native")
			const allPersistedCredentials = await this.deviceConfig.getCredentials()
			const encryptionMode = await this.deviceConfig.getCredentialEncryptionMode()
			const credentialsKey = await this.deviceConfig.getCredentialsEncryptionKey()
			if (encryptionMode != null && credentialsKey != null) {
				console.log("migrating credentials", allPersistedCredentials)
				await this.nativeCredentialFacade.migrateToNativeCredentials(allPersistedCredentials, encryptionMode, credentialsKey)
			} else {
				console.log("Skipping migration as encryption data is not there")
			}
			console.log("Stored credentials in native")

			await this.deviceConfig.clearCredentialsData()

			console.log("Cleared credentials in deviceConfig")

			this.deviceConfig.setIsCredentialsMigratedToNative(true)
		}
	}
}
