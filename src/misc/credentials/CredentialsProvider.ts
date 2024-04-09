import type { CredentialEncryptionMode } from "./CredentialEncryptionMode"
import type { Credentials } from "./Credentials"
import { InterWindowEventFacadeSendDispatcher } from "../../native/common/generatedipc/InterWindowEventFacadeSendDispatcher.js"
import { SqlCipherFacade } from "../../native/common/generatedipc/SqlCipherFacade.js"
import { CredentialsInfo } from "../../native/common/generatedipc/CredentialsInfo.js"
import { CredentialType } from "./CredentialType.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"

export type CredentialsAndDatabaseKey = {
	credentials: Credentials
	databaseKey?: Uint8Array | null
}

/**
 * Main entry point to interact with credentials, i.e. storing and retrieving credentials from/to persistence.
 */
export class CredentialsProvider {
	constructor(
		private readonly credentialsFacade: NativeCredentialsFacade,
		private readonly sqliteCipherFacade: SqlCipherFacade | null,
		private readonly interWindowEventSender: InterWindowEventFacadeSendDispatcher | null,
	) {}

	/**
	 * Stores credentials. If credentials already exist for login, they will be overwritten.
	 * Also creates a database key
	 */
	async store(credentials: UnencryptedCredentials): Promise<void> {
		return this.credentialsFacade.store(credentials)
	}

	/**
	 * Change the encrypted password for the stored credentials.
	 */
	async replacePassword(credentials: CredentialsInfo, encryptedPassword: string): Promise<void> {
		// FIXME reimplement?
		// const encryptedCredentials = await this.storage.loadByUserId(credentials.userId)
		// if (encryptedCredentials == null) {
		// 	throw new Error(`Trying to replace password for credentials but credentials are not persisted: ${credentials.userId}`)
		// }
		// // Encrypted password is encrypted with the session key and is the same for encrypted and decrypted credentials, no additional logic is needed.
		// const newEncryptedCredentials = { ...encryptedCredentials, encryptedPassword }
		// await this.storage.store(newEncryptedCredentials)
	}

	async storeRaw(PersistedCredentials: PersistedCredentials) {
		// await this.storage.store(PersistedCredentials)
		// FIXME reimplement?
	}

	async getCredentialsInfoByUserId(userId: Id): Promise<CredentialsInfo | null> {
		const allCredentials = await this.credentialsFacade.loadAll()
		return allCredentials.find((c) => c.credentialsInfo.userId === userId)?.credentialsInfo ?? null
	}

	/**
	 * Returns the full credentials for the userId passed in.
	 * @param userId
	 */
	async getCredentialsByUserId(userId: Id): Promise<UnencryptedCredentials | null> {
		return this.credentialsFacade.loadByUserId(userId)
		// FIXME add database key if needed when migrating credentials
		// if (decrypted.databaseKey == null) {
		// 	// When offline mode is first released, there will be users who have saved credentials but no database key.
		// 	// In the future, we will never save credentials without it, but we need to create one here
		//
		// 	decrypted.databaseKey = await this.databaseKeyFactory.generateKey()
		//
		// 	if (decrypted.databaseKey != null) {
		// 		const reEncrypted = await this.credentialsEncryption.encrypt(decrypted)
		// 		this.storage.store(reEncrypted)
		// 	}
		// }
	}

	/**
	 * Returns the stored credentials infos of all internal users, i.e. users that have a "real" tutanota account and not the ones that
	 * have a secure external mailbox.
	 */
	async getInternalCredentialsInfos(): Promise<ReadonlyArray<CredentialsInfo>> {
		const allCredentials = (await this.credentialsFacade.loadAll()).map((persistedCredentials) => persistedCredentials.credentialsInfo)
		return allCredentials.filter((credential) => credential.type === CredentialType.internal)
	}

	/**
	 * Deletes stored credentials with specified userId.
	 * No-op if credentials are not there.
	 * @param opts.deleteOfflineDb whether to delete offline database. Will delete by default.
	 */
	async deleteByUserId(userId: Id, opts: { deleteOfflineDb: boolean } = { deleteOfflineDb: true }): Promise<void> {
		await this.interWindowEventSender?.localUserDataInvalidated(userId)
		if (opts.deleteOfflineDb) {
			await this.sqliteCipherFacade?.deleteDb(userId)
		}
		await this.credentialsFacade.deleteByUserId(userId)
	}

	/**
	 * Sets the credentials encryption mode, i.e. how the intermediate key used for encrypting credentials is protected.
	 * @param encryptionMode
	 * @throws KeyPermanentlyInvalidatedError
	 * @throws CredentialAuthenticationError
	 */
	async setCredentialsEncryptionMode(encryptionMode: CredentialEncryptionMode): Promise<void> {
		await this.credentialsFacade.setCredentialEncryptionMode(encryptionMode)
		this.interWindowEventSender?.reloadDeviceConfig()
	}

	/**
	 * Returns the credentials encryption mode, i.e. how the intermediate key used for encrypting credentials is protected.
	 */
	getCredentialsEncryptionMode(): Promise<CredentialEncryptionMode | null> {
		return this.credentialsFacade.getCredentialEncryptionMode()
	}

	/**
	 * Returns all credentials encryption modes that are supported by the device.
	 */
	async getSupportedEncryptionModes(): Promise<ReadonlyArray<CredentialEncryptionMode>> {
		return await this.credentialsFacade.getSupportedEncryptionModes()
	}

	/**
	 * Removes all stored credentials as well as any settings associated with credentials encryption.
	 */
	async clearCredentials(reason: Error | string): Promise<void> {
		console.warn("clearing all stored credentials:", reason)
		await this.credentialsFacade.clear()
	}
}
