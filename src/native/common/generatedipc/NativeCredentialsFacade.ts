/* generated file, don't edit. */

import { CredentialEncryptionMode } from "./CredentialEncryptionMode.js"
import { UnencryptedCredentials } from "./UnencryptedCredentials.js"
import { PersistedCredentials } from "./PersistedCredentials.js"
/**
 * Operations for credential encryption operations using OS keychain.
 */
export interface NativeCredentialsFacade {
	getSupportedEncryptionModes(): Promise<ReadonlyArray<CredentialEncryptionMode>>

	loadAll(): Promise<ReadonlyArray<UnencryptedCredentials>>

	/**
	 * Encrypt and store credentials
	 */
	store(credentials: UnencryptedCredentials): Promise<void>

	loadByUserId(id: string): Promise<UnencryptedCredentials | null>

	deleteByUserId(id: string): Promise<void>

	getCredentialEncryptionMode(): Promise<CredentialEncryptionMode | null>

	setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode | null): Promise<void>

	clear(): Promise<void>

	/**
	 * Migrate existing credentials to native db
	 */
	migrateToNativeCredentials(
		credentials: ReadonlyArray<PersistedCredentials>,
		encryptionMode: CredentialEncryptionMode | null,
		credentialsKey: Uint8Array | null,
	): Promise<void>
}
