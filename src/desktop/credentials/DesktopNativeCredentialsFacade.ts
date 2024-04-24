import { CredentialEncryptionMode } from "../../misc/credentials/CredentialEncryptionMode.js"
import { DesktopNativeCryptoFacade } from "../DesktopNativeCryptoFacade"
import { base64ToUint8Array, stringToUtf8Uint8Array, uint8ArrayToBase64, utf8Uint8ArrayToString } from "@tutao/tutanota-utils"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { bitArrayToUint8Array, uint8ArrayToBitArray } from "@tutao/tutanota-crypto"
import { KeyPermanentlyInvalidatedError } from "../../api/common/error/KeyPermanentlyInvalidatedError.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { DesktopCredentialsStorage } from "../db/DesktopCredentialsStorage.js"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"
import { assertSupportedEncryptionMode, DesktopCredentialsMode, SUPPORTED_MODES } from "./CredentialCommons.js"
import { KeychainManager } from "./KeychainManager.js"

/**
 * Native storage will transparently encrypt and decrypt database key and access token during load and store calls.
 */
export class DesktopNativeCredentialsFacade implements NativeCredentialsFacade {
	constructor(
		private readonly crypto: DesktopNativeCryptoFacade,
		private readonly credentialDb: DesktopCredentialsStorage,
		private readonly keychainManager: KeychainManager,
	) {}

	async getSupportedEncryptionModes(): Promise<ReadonlyArray<DesktopCredentialsMode>> {
		return SUPPORTED_MODES
	}

	async deleteByUserId(id: string): Promise<void> {
		this.credentialDb.deleteByUserId(id)
	}

	async getCredentialEncryptionMode(): Promise<CredentialEncryptionMode | null> {
		const retVal = this.credentialDb.getCredentialEncryptionMode()
		return retVal ? CredentialEncryptionMode[retVal as keyof typeof CredentialEncryptionMode] : null
	}

	private getDesktopCredentialEncryptionMode(): DesktopCredentialsMode | null {
		const retVal = this.credentialDb.getCredentialEncryptionMode()
		return retVal ? CredentialEncryptionMode[retVal as DesktopCredentialsMode] : null
	}

	private getCredentialsEncryptionKey(): Uint8Array | null {
		const credentialsEncryptionKey = this.credentialDb.getCredentialEncryptionKey()
		return credentialsEncryptionKey ? base64ToUint8Array(credentialsEncryptionKey) : null
	}

	async loadAll(): Promise<ReadonlyArray<PersistedCredentials>> {
		return this.credentialDb.getAllCredentials()
	}

	async loadByUserId(id: string): Promise<UnencryptedCredentials | null> {
		const credentialsKey = await this.getOrCreateCredentialEncryptionKey()
		const encryptedCredentials = this.credentialDb.getCredentialsByUserId(id)
		return encryptedCredentials ? this.decryptCredentials(encryptedCredentials, credentialsKey) : null
	}

	private decryptCredentials(persistedCredentials: PersistedCredentials, credentialsKey: BitArray): UnencryptedCredentials {
		try {
			return {
				credentialInfo: persistedCredentials.credentialInfo,
				encryptedPassword: persistedCredentials.encryptedPassword,
				accessToken: utf8Uint8ArrayToString(this.crypto.aesDecryptBytes(credentialsKey, persistedCredentials.accessToken)),
				databaseKey: persistedCredentials.databaseKey ? this.crypto.aesDecryptBytes(credentialsKey, persistedCredentials.databaseKey) : null,
			}
		} catch (e) {
			// FIXME this should have been detected earlier, when we've been decrypting credentialsKey, is it authenticated?
			throw new KeyPermanentlyInvalidatedError("Failed AES decrypt: " + e)
		}
	}

	private encryptCredentials(unencryptedCredentials: UnencryptedCredentials, credentialsEncryptionKey: BitArray): PersistedCredentials {
		return {
			credentialInfo: unencryptedCredentials.credentialInfo,
			accessToken: this.crypto.aesEncryptBytes(credentialsEncryptionKey, stringToUtf8Uint8Array(unencryptedCredentials.accessToken)),
			encryptedPassword: unencryptedCredentials.encryptedPassword,
			databaseKey: unencryptedCredentials.databaseKey ? this.crypto.aesEncryptBytes(credentialsEncryptionKey, unencryptedCredentials.databaseKey) : null,
		}
	}

	async setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode): Promise<void> {
		this.credentialDb.setCredentialEncryptionMode(encryptionMode)
	}

	private setCredentialsEncryptionKey(credentialsEncryptionKey: Uint8Array | null) {
		this.credentialDb.setCredentialEncryptionKey(credentialsEncryptionKey ? uint8ArrayToBase64(credentialsEncryptionKey) : null)
	}

	async store(credentials: UnencryptedCredentials): Promise<void> {
		const credentialsEncryptionKey = await this.getOrCreateCredentialEncryptionKey()
		const encryptedCredentials: PersistedCredentials = this.encryptCredentials(credentials, credentialsEncryptionKey)
		return this.storeEncrypted(encryptedCredentials)
	}

	async clear(): Promise<void> {
		this.credentialDb.deleteAllCredentials()
		this.setCredentialsEncryptionKey(null)
		this.credentialDb.setCredentialEncryptionMode(null)
	}

	async migrateToNativeCredentials(credentials: ReadonlyArray<PersistedCredentials>, encryptionMode: CredentialEncryptionMode, credentialsKey: Uint8Array) {
		// store persistedCredentials, key & mode
		assertSupportedEncryptionMode(encryptionMode as DesktopCredentialsMode)
		await this.setCredentialEncryptionMode(encryptionMode)
		this.setCredentialsEncryptionKey(credentialsKey)
		for (const credential of credentials) {
			await this.storeEncrypted(credential)
		}
	}

	async storeEncrypted(credentials: PersistedCredentials): Promise<void> {
		this.credentialDb.store(credentials)
	}

	private async getOrCreateCredentialEncryptionKey(): Promise<BitArray> {
		const encryptionMode = this.getDesktopCredentialEncryptionMode() ?? CredentialEncryptionMode.DEVICE_LOCK
		const exisingKey = this.getCredentialsEncryptionKey()
		if (exisingKey != null) {
			const decryptedKey = await this.keychainManager.decryptUsingKeychain(exisingKey, encryptionMode)
			return uint8ArrayToBitArray(decryptedKey)
		} else {
			const newKey = bitArrayToUint8Array(this.crypto.generateDeviceKey())
			const encryptedKey = await this.keychainManager.encryptUsingKeychain(newKey, encryptionMode)
			this.setCredentialsEncryptionKey(encryptedKey)
			return uint8ArrayToBitArray(newKey)
		}
	}
}
