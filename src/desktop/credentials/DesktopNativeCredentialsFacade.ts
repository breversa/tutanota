import { CredentialEncryptionMode } from "../../misc/credentials/CredentialEncryptionMode"
import { DesktopKeyStoreFacade } from "../DesktopKeyStoreFacade.js"
import { DesktopNativeCryptoFacade } from "../DesktopNativeCryptoFacade"
import { assert, base64ToUint8Array, stringToUtf8Uint8Array, uint8ArrayToBase64, utf8Uint8ArrayToString } from "@tutao/tutanota-utils"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { bitArrayToUint8Array, uint8ArrayToBitArray } from "@tutao/tutanota-crypto"
import { CryptoError } from "@tutao/tutanota-crypto/error.js"
import { KeyPermanentlyInvalidatedError } from "../../api/common/error/KeyPermanentlyInvalidatedError.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { DesktopCredentialsStorage } from "../db/DesktopCredentialsStorage.js"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"
import { AppPassHandler } from "./AppPassHandler.js"

/** the single source of truth for this configuration */
const SUPPORTED_MODES = Object.freeze([CredentialEncryptionMode.DEVICE_LOCK, CredentialEncryptionMode.APP_PASSWORD] as const)
export type DesktopCredentialsMode = typeof SUPPORTED_MODES[number]

/**
 * Native storage will transparently encrypt and decrypt database key and access token during load and store calls.
 */
export class DesktopNativeCredentialsFacade implements NativeCredentialsFacade {
	constructor(
		private readonly desktopKeyStoreFacade: DesktopKeyStoreFacade,
		private readonly crypto: DesktopNativeCryptoFacade,
		private readonly credentialDb: DesktopCredentialsStorage,
		private readonly appPassHandler: AppPassHandler,
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

	private async getDesktopCredentialEncryptionMode(): Promise<DesktopCredentialsMode | null> {
		const retVal = this.credentialDb.getCredentialEncryptionMode()
		return retVal ? CredentialEncryptionMode[retVal as DesktopCredentialsMode] : null
	}

	private async getCredentialsEncryptionKey(): Promise<Uint8Array | null> {
		const credentialsEncryptionKey = await this.credentialDb.getCredentialsEncryptionKey()
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
				accessToken: utf8Uint8ArrayToString(this.crypto.aesDecryptBytes(credentialsKey, base64ToUint8Array(persistedCredentials.accessToken))),
				databaseKey: persistedCredentials.databaseKey
					? this.crypto.aesDecryptBytes(credentialsKey, base64ToUint8Array(persistedCredentials.databaseKey))
					: null,
			}
		} catch (e) {
			// FIXME this should have been detected earlier, when we've been decrypting credentialsKey, is it authenticated?
			throw new KeyPermanentlyInvalidatedError("Failed AES decrypt: " + e)
		}
	}

	private encryptCredentials(unencryptedCredentials: UnencryptedCredentials, credentialsEncryptionKey: BitArray): PersistedCredentials {
		return {
			credentialInfo: unencryptedCredentials.credentialInfo,
			accessToken: uint8ArrayToBase64(this.crypto.aesEncryptBytes(credentialsEncryptionKey, stringToUtf8Uint8Array(unencryptedCredentials.accessToken))),
			encryptedPassword: unencryptedCredentials.encryptedPassword,
			databaseKey: unencryptedCredentials.databaseKey
				? uint8ArrayToBase64(this.crypto.aesEncryptBytes(credentialsEncryptionKey, unencryptedCredentials.databaseKey))
				: null,
		}
	}

	async setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode): Promise<void> {
		this.credentialDb.setCredentialEncryptionMode(encryptionMode)
	}

	private setCredentialsEncryptionKey(credentialsEncryptionKey: Uint8Array | null) {
		this.credentialDb.setCredentialsEncryptionKey(credentialsEncryptionKey ? uint8ArrayToBase64(credentialsEncryptionKey) : null)
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
		this.assertSupportedEncryptionMode(encryptionMode as DesktopCredentialsMode)
		await this.setCredentialEncryptionMode(encryptionMode)
		this.setCredentialsEncryptionKey(credentialsKey)
		for (const credential of credentials) {
			await this.storeEncrypted(credential)
		}
	}

	async storeEncrypted(credentials: PersistedCredentials): Promise<void> {
		this.credentialDb.store(credentials)
	}

	private assertSupportedEncryptionMode(encryptionMode: DesktopCredentialsMode) {
		assert(SUPPORTED_MODES.includes(encryptionMode), `should not use unsupported encryption mode ${encryptionMode}`)
	}

	private async getOrCreateCredentialEncryptionKey(): Promise<BitArray> {
		const encryptionMode = (await this.getDesktopCredentialEncryptionMode()) ?? CredentialEncryptionMode.DEVICE_LOCK
		const exisingKey = await this.getCredentialsEncryptionKey()
		if (exisingKey != null) {
			const decryptedKey = await this.decryptUsingKeychain(exisingKey, encryptionMode)
			return uint8ArrayToBitArray(decryptedKey)
		} else {
			const newKey = bitArrayToUint8Array(this.crypto.generateDeviceKey())
			const encryptedKey = await this.encryptUsingKeychain(newKey, encryptionMode)
			this.setCredentialsEncryptionKey(encryptedKey)
			return uint8ArrayToBitArray(newKey)
		}
	}

	/**
	 * @private visibleForTesting
	 */
	async decryptUsingKeychain(encryptedDataWithAppPassWrapper: Uint8Array, encryptionMode: DesktopCredentialsMode): Promise<Uint8Array> {
		try {
			// making extra sure that the mode is the right one since this comes over IPC
			this.assertSupportedEncryptionMode(encryptionMode)
			const encryptedData = await this.appPassHandler.removeAppPassWrapper(encryptedDataWithAppPassWrapper, encryptionMode)
			const keyChainKey = await this.desktopKeyStoreFacade.getKeyChainKey()
			return this.crypto.unauthenticatedAes256DecryptKey(keyChainKey, encryptedData)
		} catch (e) {
			if (e instanceof CryptoError) {
				// If the key could not be decrypted it means that something went very wrong. We will probably not be able to do anything about it so just
				// delete everything.
				throw new KeyPermanentlyInvalidatedError(`Could not decrypt credentials: ${e.stack ?? e.message}`)
			} else {
				throw e
			}
		}
	}

	private async encryptUsingKeychain(data: Uint8Array, encryptionMode: DesktopCredentialsMode): Promise<Uint8Array> {
		try {
			// making extra sure that the mode is the right one since this comes over IPC
			this.assertSupportedEncryptionMode(encryptionMode)
			const keyChainKey = await this.desktopKeyStoreFacade.getKeyChainKey()
			const encryptedData = this.crypto.aes256EncryptKey(keyChainKey, data)
			return this.appPassHandler.addAppPassWrapper(encryptedData, encryptionMode)
		} catch (e) {
			if (e instanceof CryptoError) {
				// If the key could not be decrypted it means that something went very wrong. We will probably not be able to do anything about it so just
				// delete everything.
				throw new KeyPermanentlyInvalidatedError(`Could not encrypt credentials: ${e.stack ?? e.message}`)
			} else {
				throw e
			}
		}
	}
}
