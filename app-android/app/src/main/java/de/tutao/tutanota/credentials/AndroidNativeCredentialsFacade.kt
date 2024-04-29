package de.tutao.tutanota.credentials

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Log
import de.tutao.tutanota.AndroidNativeCryptoFacade
import de.tutao.tutanota.CryptoError
import de.tutao.tutanota.data.AppDatabase
import de.tutao.tutanota.ipc.CredentialEncryptionMode
import de.tutao.tutanota.ipc.DataWrapper
import de.tutao.tutanota.ipc.NativeCredentialsFacade
import de.tutao.tutanota.ipc.PersistedCredentials
import de.tutao.tutanota.ipc.UnencryptedCredentials
import de.tutao.tutanota.ipc.wrap

private const val TAG = "Credentials"

class AndroidNativeCredentialsFacade(
	private val crypto: AndroidNativeCryptoFacade,
	private val keychainEncryption: KeychainEncryption,
	private val db: AppDatabase,
) : NativeCredentialsFacade {

	companion object {
		private const val CREDENTIALS_ENCRYPTION_MODE_KEY = "credentialEncryptionMode"
		private const val CREDENTIALS_ENCRYPTION_KEY_KEY = "credentialsEncryptionKey"
	}

	override suspend fun loadAll(): List<PersistedCredentials> {
		return db.persistedCredentialsDao().allPersistedCredentials.map { e -> e.toObject() }
	}

	override suspend fun store(credentials: UnencryptedCredentials) {
		val credentialsEncryptionKey = this.getOrCreateCredentialEncryptionKey()
		val encryptedCredentials: PersistedCredentials = try {
			this.encryptCredentials(credentials, credentialsEncryptionKey)
		} finally {
			credentialsEncryptionKey.fill(0)
		}
		this.storeEncrypted(encryptedCredentials)
	}

	override suspend fun storeEncrypted(credentials: PersistedCredentials) {
		db.persistedCredentialsDao().insertPersistedCredentials(credentials.toEntity())
	}

	override suspend fun loadByUserId(id: String): UnencryptedCredentials? {
		val credentialsKey = this.getCredentialsEncryptionKey()
			?: throw KeyPermanentlyInvalidatedException("Credentials key is missing, cannot decrypt credentials")
		try {
			if (this.getCredentialEncryptionMode() != CredentialEncryptionMode.DEVICE_LOCK) {
				Log.d(TAG, "Migrating encryption mode to DEVICE_LOCK")
				// re-encrypt credentials here
				val encryptedKey =
					this.keychainEncryption.encryptUsingKeychain(credentialsKey, CredentialEncryptionMode.DEVICE_LOCK)
				db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, encryptedKey)
				setCredentialEncryptionMode(CredentialEncryptionMode.DEVICE_LOCK)
				Log.d(TAG, "Encryption mode migration complete")
			}
			val encryptedCredentials =
				db.persistedCredentialsDao().allPersistedCredentials.firstOrNull { e -> e.userId == id }?.toObject()
			return if (encryptedCredentials != null) this.decryptCredentials(
				encryptedCredentials,
				credentialsKey
			) else null
		} finally {
			credentialsKey.fill(0)
		}
	}

	override suspend fun deleteByUserId(id: String) {
		db.persistedCredentialsDao().deletePersistedCredentials(id)
	}

	override suspend fun clear() {
		db.persistedCredentialsDao().clear()
		db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, null)
		db.keyValueDao().putString(CREDENTIALS_ENCRYPTION_MODE_KEY, null)
	}

	override suspend fun migrateToNativeCredentials(
		credentials: List<PersistedCredentials>, encryptionMode: CredentialEncryptionMode, credentialsKey: DataWrapper
	) {
		db.keyValueDao().putString(CREDENTIALS_ENCRYPTION_MODE_KEY, encryptionMode.name)
		db.keyBinaryDao().put(
			CREDENTIALS_ENCRYPTION_KEY_KEY, credentialsKey.data
		)
		for (credential: PersistedCredentials in credentials) {
			this.storeEncrypted(credential)
		}
	}

	override suspend fun getCredentialEncryptionMode(): CredentialEncryptionMode? {
		return db.keyValueDao().getString(CREDENTIALS_ENCRYPTION_MODE_KEY)
			?.let { CredentialEncryptionMode.fromValue(it) }
	}

	override suspend fun setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode) {
		require(this.getSupportedEncryptionModes().contains(encryptionMode)) {
			"Invalid encryption mode: ${encryptionMode.name}"
		}
		db.keyValueDao().putString(CREDENTIALS_ENCRYPTION_MODE_KEY, encryptionMode.name)
	}

	override suspend fun getSupportedEncryptionModes(): List<CredentialEncryptionMode> {
		return listOf(CredentialEncryptionMode.DEVICE_LOCK)
	}

	private suspend fun getCredentialsEncryptionKey(): ByteArray? {
		val encryptionMode = this.getCredentialEncryptionMode() ?: CredentialEncryptionMode.DEVICE_LOCK
		val existingKey = db.keyBinaryDao().get(CREDENTIALS_ENCRYPTION_KEY_KEY)
		return if (existingKey != null) {
			this.keychainEncryption.decryptUsingKeychain(existingKey, encryptionMode)
		} else {
			null
		}
	}

	private suspend fun getOrCreateCredentialEncryptionKey(): ByteArray {
		val encryptionMode = this.getCredentialEncryptionMode() ?: CredentialEncryptionMode.DEVICE_LOCK
		val existingKey = this.getCredentialsEncryptionKey()
		return if (existingKey != null) {
			return existingKey
		} else {
			val newKey = this.crypto.generateAes256Key()
			val encryptedKey = this.keychainEncryption.encryptUsingKeychain(newKey, encryptionMode)
			db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, encryptedKey)
			newKey
		}
	}

	private fun decryptCredentials(
		persistedCredentials: PersistedCredentials, credentialsKey: ByteArray
	): UnencryptedCredentials {
		try {
			val databaseKey = if (persistedCredentials.databaseKey != null) {
				this.crypto.aesDecryptData(
					credentialsKey, persistedCredentials.databaseKey.data
				).wrap()
			} else {
				null
			}
			return UnencryptedCredentials(
				credentialInfo = persistedCredentials.credentialInfo,
				encryptedPassword = persistedCredentials.encryptedPassword,
				accessToken = this.crypto.aesDecryptData(
					credentialsKey, persistedCredentials.accessToken.data
				).decodeToString(),
				databaseKey = databaseKey,
			)
		} catch (e: KeyPermanentlyInvalidatedException) {
			// FIXME this should have been detected earlier, when we've been decrypting credentialsKey, is it authenticated?
			throw CryptoError(e)
		}
	}

	private fun encryptCredentials(
		unencryptedCredentials: UnencryptedCredentials, credentialsEncryptionKey: ByteArray
	): PersistedCredentials {
		val accessToken =
			this.crypto.aesEncryptData(credentialsEncryptionKey, unencryptedCredentials.accessToken.encodeToByteArray())

		val databaseKey = if (unencryptedCredentials.databaseKey != null) {
			this.crypto.aesEncryptData(
				credentialsEncryptionKey, unencryptedCredentials.databaseKey.data
			).wrap()
		} else {
			null
		}

		return PersistedCredentials(
			credentialInfo = unencryptedCredentials.credentialInfo,
			accessToken = accessToken.wrap(),
			encryptedPassword = unencryptedCredentials.encryptedPassword,
			databaseKey = databaseKey,
		)
	}
}