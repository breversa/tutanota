package de.tutao.tutanota.credentials

import android.content.Context
import android.security.keystore.KeyPermanentlyInvalidatedException
import de.tutao.tutanota.AndroidNativeCryptoFacade
import de.tutao.tutanota.AndroidNativeCryptoFacade.Companion.bytesToKey
import de.tutao.tutanota.CryptoError
import de.tutao.tutanota.data.AppDatabase
import de.tutao.tutanota.ipc.CredentialEncryptionMode
import de.tutao.tutanota.ipc.DataWrapper
import de.tutao.tutanota.ipc.NativeCredentialsFacade
import de.tutao.tutanota.ipc.PersistedCredentials
import de.tutao.tutanota.ipc.UnencryptedCredentials
import de.tutao.tutanota.ipc.wrap

abstract class AndroidNativeCredentialsFacade(
	private val activity: Context,
	private val crypto: AndroidNativeCryptoFacade,
) : NativeCredentialsFacade {
	private val db: AppDatabase = AppDatabase.getDatabase(activity, false)

	companion object {
		// FIXME Can we move this to somewhere all platforms can read?
		private const val CREDENTIALS_ENCRYPTION_MODE_KEY = "credentialEncryptionMode"
		private const val CREDENTIALS_ENCRYPTION_KEY_KEY = "credentialsEncryptionKey"
	}

	override suspend fun loadAll(): List<PersistedCredentials> {
		return db.persistedCredentialsDao().allPersistedCredentials.map { e -> e.toObject() }
	}

	override suspend fun store(credentials: UnencryptedCredentials) {
		val credentialsEncryptionKey = this.getOrCreateCredentialEncryptionKey()
		val encryptedCredentials: PersistedCredentials = this.encryptCredentials(credentials, credentialsEncryptionKey)
		this.storeEncrypted(encryptedCredentials)
	}

	override suspend fun storeEncrypted(credentials: PersistedCredentials) {
		db.persistedCredentialsDao().insertPersistedCredentials(credentials.toEntity())
	}

	override suspend fun loadByUserId(id: String): UnencryptedCredentials? {
		val credentialsKey = this.getCredentialsEncryptionKey()
			?: throw KeyPermanentlyInvalidatedException("Credentials key is missing, cannot decrypt credentials")
		if (this.getCredentialEncryptionMode() != CredentialEncryptionMode.DEVICE_LOCK) {
			// re-encrypt credentials here
			val encryptedKey = this.encryptUsingKeychain(credentialsKey, CredentialEncryptionMode.DEVICE_LOCK)
			db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, encryptedKey)
		}
		val encryptedCredentials =
			db.persistedCredentialsDao().allPersistedCredentials.firstOrNull { e -> e.userId == id }?.toObject()
		return if (encryptedCredentials != null) this.decryptCredentials(encryptedCredentials, credentialsKey) else null
	}

	override suspend fun deleteByUserId(id: String) {
		db.persistedCredentialsDao().deletePersistedCredentials(id)
	}

	override suspend fun clear() {
		db.persistedCredentialsDao().clear()
		db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, null)
		this.setCredentialEncryptionMode(null)
	}

	override suspend fun migrateToNativeCredentials(
		credentials: List<PersistedCredentials>, encryptionMode: CredentialEncryptionMode, credentialsKey: DataWrapper
	) {
		this.setCredentialEncryptionMode(encryptionMode)
		db.keyBinaryDao().put(
			CREDENTIALS_ENCRYPTION_KEY_KEY, credentialsKey.data
		)
		for (credential: PersistedCredentials in credentials) {
			this.storeEncrypted(credential)
		}
	}

	override suspend fun getCredentialEncryptionMode(): CredentialEncryptionMode? {
		return enumValues<CredentialEncryptionMode>().firstOrNull {
			it.name == (db.keyValueDao().getString(CREDENTIALS_ENCRYPTION_MODE_KEY) ?: "")
		}
	}

	override suspend fun setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode?) {
		db.keyValueDao().putString(CREDENTIALS_ENCRYPTION_MODE_KEY, encryptionMode?.name)
	}

	private suspend fun getCredentialsEncryptionKey(): ByteArray? {
		val encryptionMode = this.getCredentialEncryptionMode() ?: CredentialEncryptionMode.DEVICE_LOCK
		val existingKey = db.keyBinaryDao().get(CREDENTIALS_ENCRYPTION_KEY_KEY)
		return if (existingKey != null) {
			this.decryptUsingKeychain(existingKey, encryptionMode)
		} else {
			null
		}
	}

	private suspend fun getOrCreateCredentialEncryptionKey(): ByteArray {
		val encryptionMode = this.getCredentialEncryptionMode() ?: CredentialEncryptionMode.DEVICE_LOCK
		val existingKey = this.getCredentialsEncryptionKey()
		return if (existingKey != null) {
			decryptUsingKeychain(existingKey, encryptionMode)
		} else {
			val newKey = this.crypto.generateAes256Key()
			val encryptedKey = this.encryptUsingKeychain(newKey, encryptionMode)
			db.keyBinaryDao().put(CREDENTIALS_ENCRYPTION_KEY_KEY, encryptedKey)
			newKey
		}
	}

	private fun decryptCredentials(
		persistedCredentials: PersistedCredentials, credentialsKey: ByteArray
	): UnencryptedCredentials {
		try {
			val databaseKey = if (persistedCredentials.databaseKey != null) {
				this.crypto.decryptKey(
					bytesToKey(credentialsKey), persistedCredentials.databaseKey.data
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
			this.crypto.encryptKey(
				bytesToKey(credentialsEncryptionKey), unencryptedCredentials.databaseKey.data
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

	protected abstract suspend fun encryptUsingKeychain(
		data: ByteArray, encryptionMode: CredentialEncryptionMode
	): ByteArray

	protected abstract suspend fun decryptUsingKeychain(
		encryptedData: ByteArray, encryptionMode: CredentialEncryptionMode
	): ByteArray
}