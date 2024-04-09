/* generated file, don't edit. */


package de.tutao.tutanota.ipc

import kotlinx.serialization.*
import kotlinx.serialization.json.*

/**
 * Operations for credential encryption operations using OS keychain.
 */
interface NativeCredentialsFacade {
	 suspend fun getSupportedEncryptionModes(
	): List<CredentialEncryptionMode>
	 suspend fun loadAll(
	): List<PersistedCredentials>
	/**
	 * Encrypt and store credentials
	 */
	 suspend fun store(
		credentials: UnencryptedCredentials,
	): Unit
	 suspend fun loadByUserId(
		id: String,
	): UnencryptedCredentials?
	 suspend fun deleteByUserId(
		id: String,
	): Unit
	 suspend fun getCredentialEncryptionMode(
	): CredentialEncryptionMode?
	 suspend fun setCredentialEncryptionMode(
		encryptionMode: CredentialEncryptionMode?,
	): Unit
	 suspend fun clear(
	): Unit
}
