package de.tutao.tutanota.credentials

import android.content.Context
import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import de.tutao.tutanota.AndroidKeyStoreFacade
import de.tutao.tutanota.AndroidNativeCryptoFacade
import de.tutao.tutanota.AndroidNativeCryptoFacade.Companion.bytesToKey
import de.tutao.tutanota.CryptoError
import de.tutao.tutanota.base64ToBytes
import de.tutao.tutanota.data.AppDatabase
import de.tutao.tutanota.ipc.CredentialEncryptionMode
import de.tutao.tutanota.ipc.DataWrapper
import de.tutao.tutanota.ipc.NativeCredentialsFacade
import de.tutao.tutanota.ipc.PersistedCredentials
import de.tutao.tutanota.ipc.UnencryptedCredentials
import de.tutao.tutanota.ipc.wrap
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.firstOrNull
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

abstract class AndroidNativeCredentialsFacade(
	private val keyStoreFacade: AndroidKeyStoreFacade,
	private val activity: Context,
	private val crypto: AndroidNativeCryptoFacade,
	private val authenticationPrompt: AuthenticationPrompt
) : NativeCredentialsFacade {
	private val db: AppDatabase = AppDatabase.getDatabase(activity, false)
	private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

	companion object {
		// FIXME Can we move this to somewhere all platforms can read?
		private val ENCRYPTION_MODE_KEY = "credentialEncryptionMode"
		private val CREDENTIALS_ENCRYPTION_KEY_KEY = "credentialsEncryptionKey"
	}

	private object PreferencesKeys {
		val ENCRYPTION_MODE_KEY_PREF = stringPreferencesKey(ENCRYPTION_MODE_KEY)
		val CREDENTIALS_ENCRYPTION_KEY_KEY_PREF = stringPreferencesKey(CREDENTIALS_ENCRYPTION_KEY_KEY)
	}

	override suspend fun loadAll(): List<PersistedCredentials> {
		return db.PersistedCredentialsDao().allPersistedCredentials.map { e -> e.toObject() }
	}

	override suspend fun store(credentials: UnencryptedCredentials) {
		val credentialsEncryptionKey = this.getOrCreateCredentialEncryptionKey()
		val encryptedCredentials: PersistedCredentials = this.encryptCredentials(credentials, credentialsEncryptionKey)
		db.PersistedCredentialsDao().insertPersistedCredentials(encryptedCredentials.toEntity())
	}

	override suspend fun storeEncrypted(credentials: PersistedCredentials) {
		TODO("Not yet implemented")
	}

	override suspend fun loadByUserId(id: String): UnencryptedCredentials? {
		val credentialsKey = this.getOrCreateCredentialEncryptionKey()
		val encryptedCredentials =
			db.PersistedCredentialsDao().allPersistedCredentials.firstOrNull { e -> e.userId == id }?.toObject()
		return if (encryptedCredentials != null) this.decryptCredentials(encryptedCredentials, credentialsKey) else null
	}

	override suspend fun deleteByUserId(id: String) {
		db.PersistedCredentialsDao().deletePersistedCredentials(id)
	}

	override suspend fun clear() {
		TODO("Not yet implemented")
	}

	override suspend fun migrateToNativeCredentials(
		credentials: List<PersistedCredentials>, encryptionMode: CredentialEncryptionMode, credentialsKey: DataWrapper
	) {
		TODO("Not yet implemented")
	}

	override suspend fun getCredentialEncryptionMode(): CredentialEncryptionMode? {
		val encryptionModeStr = activity.dataStore.data.catch { exception ->
			if (exception is IOException) {
				emit(emptyPreferences())
			} else {
				throw exception
			}
		}.firstOrNull()?.get(PreferencesKeys.ENCRYPTION_MODE_KEY_PREF)

		return if (encryptionModeStr != null) enumValueOf<CredentialEncryptionMode>(encryptionModeStr) else null
	}

	override suspend fun setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode?) {
		activity.dataStore.edit { preferences ->
			if (encryptionMode != null) preferences[PreferencesKeys.ENCRYPTION_MODE_KEY_PREF] = encryptionMode.name
		}
	}

	suspend fun getCredentialsEncryptionKey(): DataWrapper? {
		val credentialsEncryptionKey = activity.dataStore.data.catch { exception ->
			if (exception is IOException) {
				emit(emptyPreferences())
			} else {
				throw exception
			}
		}.firstOrNull()?.get(PreferencesKeys.CREDENTIALS_ENCRYPTION_KEY_KEY_PREF)

		return credentialsEncryptionKey?.base64ToBytes()?.wrap()
	}

	suspend fun setCredentialsEncryptionKey(credentialsEncryptionKey: ByteArray?) {
		TODO("Not yet implemented")
//		activity.dataStore.edit { preferences ->
//			if (credentialsEncryptionKey != null) preferences[PreferencesKeys.CREDENTIALS_ENCRYPTION_KEY_KEY_PREF] =
//				credentialsEncryptionKey
//		}
	}

	private suspend fun getOrCreateCredentialEncryptionKey(): ByteArray {
		val encryptionMode = this.getCredentialEncryptionMode() ?: CredentialEncryptionMode.DEVICE_LOCK
		val exisingKey = this.getCredentialsEncryptionKey()
		if (exisingKey != null) {
			return decryptUsingKeychain(exisingKey.data, encryptionMode)
		} else {
			val newKey = this.crypto.generateAes256Key()
			val encryptedKey = this.encryptUsingKeychain(newKey, encryptionMode)
			this.setCredentialsEncryptionKey(encryptedKey)
			return newKey
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
				accessToken =
				this.crypto.aesDecryptData(
					credentialsKey, persistedCredentials.accessToken
				),
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
		val bais = ByteArrayInputStream(unencryptedCredentials.accessToken.encodeToByteArray())
		val baos = ByteArrayOutputStream()
		this.crypto.aesEncryptData(credentialsEncryptionKey, bais, baos)
		val accessToken = baos.toByteArray()

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