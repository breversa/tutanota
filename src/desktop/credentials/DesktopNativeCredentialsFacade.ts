import { CredentialEncryptionMode } from "../../misc/credentials/CredentialEncryptionMode"
import { DesktopKeyStoreFacade } from "../DesktopKeyStoreFacade.js"
import { DesktopNativeCryptoFacade } from "../DesktopNativeCryptoFacade"
import { assert, base64ToUint8Array, stringToUtf8Uint8Array, Thunk, uint8ArrayToBase64, utf8Uint8ArrayToString } from "@tutao/tutanota-utils"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { CommonNativeFacade } from "../../native/common/generatedipc/CommonNativeFacade.js"
import { LanguageViewModel } from "../../misc/LanguageViewModel.js"
import { DesktopConfig } from "../config/DesktopConfig.js"
import { DesktopConfigKey } from "../config/ConfigKeys.js"
import { Aes256Key, bitArrayToUint8Array, generateKeyFromPassphraseArgon2id, KEY_LENGTH_BYTES_AES_256, uint8ArrayToBitArray } from "@tutao/tutanota-crypto"
import { CryptoError } from "@tutao/tutanota-crypto/error.js"
import { CancelledError } from "../../api/common/error/CancelledError.js"
import { KeyPermanentlyInvalidatedError } from "../../api/common/error/KeyPermanentlyInvalidatedError.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { DesktopCredentialsSqlDb } from "../db/DesktopCredentialsSqlDb.js"
import { CredentialType } from "../../misc/credentials/CredentialType.js"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"
import { sql } from "../../api/worker/offline/Sql.js"

/** the single source of truth for this configuration */
const SUPPORTED_MODES = Object.freeze([CredentialEncryptionMode.DEVICE_LOCK, CredentialEncryptionMode.APP_PASSWORD] as const)
export type DesktopCredentialsMode = typeof SUPPORTED_MODES[number]

/**
 * Native storage will transparently encrypt and decrypt database key and access token during load and store calls.
 */
export class DesktopNativeCredentialsFacade implements NativeCredentialsFacade {
	/**
	 * @param desktopKeyStoreFacade
	 * @param crypto
	 * @param argon2idFacade
	 * @param lang
	 * @param conf
	 * @param credentialDb
	 * @param getCurrentCommonNativeFacade a "factory" that returns the commonNativeFacade for the window that would be most suited to serve a given request
	 */
	constructor(
		private readonly desktopKeyStoreFacade: DesktopKeyStoreFacade,
		private readonly crypto: DesktopNativeCryptoFacade,
		private readonly argon2idFacade: Promise<WebAssembly.Exports>,
		private readonly lang: LanguageViewModel,
		private readonly conf: DesktopConfig,
		private readonly credentialDb: DesktopCredentialsSqlDb,
		private readonly getCurrentCommonNativeFacade: () => Promise<CommonNativeFacade>,
	) {}

	private async removeAppPassWrapper(dataWithAppPassWrapper: Uint8Array, encryptionMode: DesktopCredentialsMode): Promise<Uint8Array> {
		// our mode is not app Pass, so there is no wrapper to remove
		if (encryptionMode !== CredentialEncryptionMode.APP_PASSWORD) return dataWithAppPassWrapper
		const appPassKey = await this.deriveKeyFromAppPass()
		if (appPassKey == null) throw new KeyPermanentlyInvalidatedError("can't remove app pass wrapper without salt")

		try {
			return this.crypto.aesDecryptBytes(appPassKey, dataWithAppPassWrapper)
		} catch (e) {
			if (e instanceof CryptoError) {
				const nativeFacade = await this.getCurrentCommonNativeFacade()
				//noinspection ES6MissingAwait
				nativeFacade.showAlertDialog("invalidPassword_msg")
				throw new CancelledError("app Pass verification failed")
			} else {
				throw e
			}
		}
	}

	private async addAppPassWrapper(dataWithoutAppPassWrapper: Uint8Array, encryptionMode: DesktopCredentialsMode): Promise<Uint8Array> {
		if (encryptionMode === CredentialEncryptionMode.APP_PASSWORD) {
			const appPassKey = (await this.deriveKeyFromAppPass()) ?? (await this.enrollForAppPass())
			return this.crypto.aesEncryptBytes(appPassKey, dataWithoutAppPassWrapper)
		} else {
			// our mode is not app Pass, so the app Pass salt should not be set
			await this.conf.setVar(DesktopConfigKey.appPassSalt, null)
			return dataWithoutAppPassWrapper
		}
	}

	/**
	 * if there is a salt stored, use it and a password prompt to derive the app Pass key.
	 * if there isn't, ask for a new password, generate a salt & store it, then derive the key.
	 * @return the derived 256-bit key or null if none is found
	 */
	private async deriveKeyFromAppPass(): Promise<Aes256Key | null> {
		const storedAppPassSaltB64 = await this.conf.getVar(DesktopConfigKey.appPassSalt)
		if (storedAppPassSaltB64 == null) return null
		const commonNativeFacade = await this.getCurrentCommonNativeFacade()
		const pw = await this.tryWhileSaltNotChanged(commonNativeFacade.promptForPassword(this.lang.get("credentialsEncryptionModeAppPassword_label")))
		const salt = base64ToUint8Array(storedAppPassSaltB64)
		return generateKeyFromPassphraseArgon2id(await this.argon2idFacade, pw, salt)
	}

	private async enrollForAppPass(): Promise<Aes256Key> {
		const newSalt = this.crypto.randomBytes(KEY_LENGTH_BYTES_AES_256)
		const commonNativeFacade = await this.getCurrentCommonNativeFacade()
		const newPw = await this.tryWhileSaltNotChanged(
			commonNativeFacade.promptForNewPassword(this.lang.get("credentialsEncryptionModeAppPassword_label"), null),
		)
		const newAppPassSaltB64 = uint8ArrayToBase64(newSalt)
		await this.conf.setVar(DesktopConfigKey.appPassSalt, newAppPassSaltB64)
		return generateKeyFromPassphraseArgon2id(await this.argon2idFacade, newPw, newSalt)
	}

	private async tryWhileSaltNotChanged(pwPromise: Promise<string>): Promise<string> {
		const commonNativeFacade = await this.getCurrentCommonNativeFacade()
		return resolveChecked<string>(
			pwPromise,
			new Promise((_, reject) =>
				this.conf.once(DesktopConfigKey.appPassSalt, () => {
					reject(new CancelledError("salt changed during pw prompt"))
				}),
			),
			() => commonNativeFacade.showAlertDialog("retry_action"),
		)
	}

	async getSupportedEncryptionModes(): Promise<ReadonlyArray<DesktopCredentialsMode>> {
		return SUPPORTED_MODES
	}

	deleteByUserId(id: string): Promise<void> {
		const formattedQuery = sql`DELETE FROM credentials WHERE userId = ${id}`
		return this.credentialDb.run(formattedQuery.query, formattedQuery.params)
	}

	async getCredentialEncryptionMode(): Promise<CredentialEncryptionMode | null> {
		const retVal = await this.conf.getVar(DesktopConfigKey.credentialEncryptionMode)
		return retVal ? CredentialEncryptionMode[retVal as keyof typeof CredentialEncryptionMode] : null
	}

	private async getDesktopCredentialEncryptionMode(): Promise<DesktopCredentialsMode | null> {
		const retVal = await this.conf.getVar(DesktopConfigKey.credentialEncryptionMode)
		return retVal ? CredentialEncryptionMode[retVal as DesktopCredentialsMode] : null
	}

	private async getCredentialsEncryptionKey(): Promise<Uint8Array | null> {
		const credentialsEncryptionKey = await this.conf.getVar(DesktopConfigKey.credentialsEncryptionKey)
		return credentialsEncryptionKey ? base64ToUint8Array(credentialsEncryptionKey) : null
	}

	async loadAll(): Promise<ReadonlyArray<PersistedCredentials>> {
		const credentialsKey = await this.getOrCreateCredentialEncryptionKey()
		const formattedQuery = sql`SELECT * FROM credentials`
		const records = await this.credentialDb.all(formattedQuery.query, formattedQuery.params)
		return records.map((row) => {
			const credentialType = CredentialType[row.type.value as keyof typeof CredentialType]
			if (!credentialType) throw Error() // FIXME
			const persistedCredential: PersistedCredentials = {
				credentialInfo: {
					login: row.login.value as string,
					userId: row.userId.value as string,
					type: credentialType,
				},
				encryptedPassword: row.encryptedPassword.value as string,
				accessToken: row.accessToken.value as string,
				databaseKey: row.databaseKey.value as string,
			}
			return persistedCredential
		})
	}

	async loadByUserId(id: string): Promise<UnencryptedCredentials | null> {
		const credentialsKey = await this.getOrCreateCredentialEncryptionKey()
		const formattedQuery = sql`SELECT * FROM credentials WHERE userId = ${id}`
		const row = await this.credentialDb.get(formattedQuery.query, formattedQuery.params)
		if (!row) return null
		const credentialType = CredentialType[row.type.value as keyof typeof CredentialType]
		if (!credentialType) throw Error() // FIXME
		const persistedCredentials = {
			credentialInfo: {
				login: row.login.value as string,
				userId: row.userId.value as string,
				type: credentialType,
			},
			encryptedPassword: row.encryptedPassword.value as string,
			accessToken: row.accessToken.value as string,
			databaseKey: row.databaseKey.value as string,
		}
		return this.decryptCredentials(persistedCredentials, credentialsKey)
	}

	private decryptCredentials(persistedCredentials: PersistedCredentials, credentialsKey: BitArray): UnencryptedCredentials {
		return {
			credentialInfo: persistedCredentials.credentialInfo,
			encryptedPassword: persistedCredentials.encryptedPassword,
			accessToken: utf8Uint8ArrayToString(this.crypto.aesDecryptBytes(credentialsKey, base64ToUint8Array(persistedCredentials.accessToken))),
			databaseKey: persistedCredentials.databaseKey
				? this.crypto.aesDecryptBytes(credentialsKey, base64ToUint8Array(persistedCredentials.databaseKey))
				: null,
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
		await this.conf.setVar(DesktopConfigKey.credentialEncryptionMode, encryptionMode)
	}

	private async setCredentialsEncryptionKey(credentialsEncryptionKey: Uint8Array | null): Promise<void> {
		await this.conf.setVar(DesktopConfigKey.credentialsEncryptionKey, credentialsEncryptionKey ? uint8ArrayToBase64(credentialsEncryptionKey) : null)
	}

	async store(credentials: UnencryptedCredentials): Promise<void> {
		const credentialsEncryptionKey = await this.getOrCreateCredentialEncryptionKey()
		const encryptedCredentials: PersistedCredentials = this.encryptCredentials(credentials, credentialsEncryptionKey)
		return this.storeEncrypted(encryptedCredentials)
	}

	async clear(): Promise<void> {
		const formattedQuery = sql`DELETE FROM credentials`
		await this.credentialDb.run(formattedQuery.query, formattedQuery.params)
		await this.setCredentialsEncryptionKey(null)
		await this.conf.setVar(DesktopConfigKey.credentialEncryptionMode, null)
	}

	async migrateToNativeCredentials(credentials: ReadonlyArray<PersistedCredentials>, encryptionMode: CredentialEncryptionMode, credentialsKey: Uint8Array) {
		// store persistedCredentials, key & mode
		this.assertSupportedEncryptionMode(encryptionMode as DesktopCredentialsMode)
		await this.setCredentialEncryptionMode(encryptionMode)
		await this.setCredentialsEncryptionKey(credentialsKey)
		for (const credential of credentials) {
			await this.storeEncrypted(credential)
		}
	}

	async storeEncrypted(credentials: PersistedCredentials): Promise<void> {
		const formattedQuery = sql`INSERT INTO credentials (login, userId, type, accessToken, databaseKey, encryptedPassword) VALUES (
${credentials.credentialInfo.login}, ${credentials.credentialInfo.userId}, ${credentials.credentialInfo.type},
${credentials.accessToken}, ${credentials.databaseKey}, ${credentials.encryptedPassword})`
		return this.credentialDb.run(formattedQuery.query, formattedQuery.params)
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
			await this.setCredentialsEncryptionKey(encryptedKey)
			return uint8ArrayToBitArray(newKey)
		}
	}

	private async decryptUsingKeychain(encryptedDataWithAppPassWrapper: Uint8Array, encryptionMode: DesktopCredentialsMode): Promise<Uint8Array> {
		try {
			// making extra sure that the mode is the right one since this comes over IPC
			this.assertSupportedEncryptionMode(encryptionMode)
			const encryptedData = await this.removeAppPassWrapper(encryptedDataWithAppPassWrapper, encryptionMode)
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
			return this.addAppPassWrapper(encryptedData, encryptionMode)
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

/**
 * resolve a promise, but inject another action if whileNot did reject in the meantime.
 * if whileNot did reject, the returned promise will reject as well.
 */
export async function resolveChecked<R>(promise: Promise<R>, whileNotRejected: Promise<never>, otherWiseAlso: Thunk): Promise<R> {
	let cancelled = false
	return await Promise.race<R>([
		promise.then((value) => {
			if (cancelled) otherWiseAlso()
			return value
		}),
		whileNotRejected.catch((e) => {
			cancelled = true
			throw e
		}),
	])
}
