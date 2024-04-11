import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { DeviceConfig } from "../DeviceConfig.js"
import { CredentialEncryptionMode } from "./CredentialEncryptionMode.js"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"

/**
 * This is a temporary stub that we will replace soon by some mechanism that will be able to utilize fingerprint/pin on mobile devices
 * for encryption of login data. Using this implementation does not mean we do not encrypt credentials currently since there is an
 * additional mechanism for credentials encryption using an access key stored server side. This is done in LoginFacade.
 */

export class WebCredentialsFacade implements NativeCredentialsFacade {
	constructor(private readonly deviceConfig: DeviceConfig) {}

	async clear(): Promise<void> {
		const allCredentials = await this.deviceConfig.getCredentials()
		for (const credentials of allCredentials) {
			await this.deviceConfig.deleteByUserId(credentials.credentialInfo.userId)
		}
	}

	deleteByUserId(id: string): Promise<void> {
		return this.deviceConfig.deleteByUserId(id)
	}

	async getCredentialEncryptionMode(): Promise<CredentialEncryptionMode | null> {
		return null
	}

	async loadAll(): Promise<ReadonlyArray<PersistedCredentials>> {
		return this.deviceConfig.getCredentials()
	}

	async loadByUserId(id: string): Promise<UnencryptedCredentials | null> {
		const persistedCredentials = this.deviceConfig.getCredentialsByUserId(id)
		if (persistedCredentials == null) return null
		return {
			credentialInfo: persistedCredentials.credentialInfo,
			encryptedPassword: persistedCredentials.encryptedPassword,
			accessToken: persistedCredentials.accessToken,
			databaseKey: null,
		}
	}

	async setCredentialEncryptionMode(_: CredentialEncryptionMode | null): Promise<void> {}

	async store(credentials: UnencryptedCredentials): Promise<void> {
		const persistedCredentials: PersistedCredentials = {
			credentialInfo: credentials.credentialInfo,
			encryptedPassword: credentials.encryptedPassword,
			accessToken: credentials.accessToken,
			databaseKey: null,
		}
		this.deviceConfig.storeCredentials(persistedCredentials)
	}

	async storeEncrypted(credentials: PersistedCredentials): Promise<void> {
		this.deviceConfig.storeCredentials(credentials)
	}

	async getSupportedEncryptionModes() {
		return []
	}

	migrateToNativeCredentials(
		credentials: ReadonlyArray<PersistedCredentials>,
		encryptionMode: CredentialEncryptionMode | null,
		credentialsKey: Uint8Array | null,
	): Promise<void> {
		throw new Error("Method not implemented.")
	}
}
