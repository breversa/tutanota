import Foundation
import LocalAuthentication

struct NotImplemented: Error {

}

public class IosNativeCredentialsFacade: NativeCredentialsFacade {
	private static let ENCRYPTION_MODE_KEY = "credentialEncryptionMode"
	private static let CREDENTIALS_ENCRYPTION_KEY_KEY = "credentialsEncryptionKey"

	private let keychainEncryption: KeychainEncryption
	private let credentialsDb: CredentialsDatabase

	public init(keychainEncryption: KeychainEncryption, credentialsDb: CredentialsDatabase) {
		self.keychainEncryption = keychainEncryption
		self.credentialsDb = credentialsDb
	}

	public func loadAll() async throws -> [PersistedCredentials] { try self.credentialsDb.getAll() }
	public func store(_ unencryptedCredentials: UnencryptedCredentials) async throws {
		let credentialsEncryptionKey = try await self.getOrCreateCredentialEncryptionKey()
		let encryptedCredentials: PersistedCredentials = try self.encryptCredentials(unencryptedCredentials, credentialsEncryptionKey)
		return try await self.storeEncrypted(encryptedCredentials)
	}
	public func storeEncrypted(_ credentials: PersistedCredentials) async throws { try self.credentialsDb.store(credentials: credentials) }
	public func clear() async throws {
		try self.credentialsDb.deleteAllCredentials()
		try self.credentialsDb.setCredentialEncryptionMode(encryptionMode: nil)
		try self.credentialsDb.setCredentialsEncryptionKey(encryptionKey: nil)
	}
	public func migrateToNativeCredentials(_ credentials: [PersistedCredentials], _ encryptionMode: CredentialEncryptionMode, _ credentialsKey: DataWrapper) async throws {
		// on mobile we alsways use DEVICE_LOCK encryption method but previously it could have been another one
		// we need to re-encrypt the credentials here
		// and handle the possible auth failure in the web part
		fatalError("FIXME Not implemented")
	}

	public func loadByUserId(_ id: String) async throws -> UnencryptedCredentials? {
		let credentials = try self.credentialsDb.getAll()
		guard let persistedCredentials = credentials.first(where: { $0.credentialInfo.userId == id }) else {
			return nil
		}
		return try self.decryptCredentials(persistedCredentials: persistedCredentials, credentialsKey: await self.getOrCreateCredentialEncryptionKey())
	}
	public func deleteByUserId(_ id: String) async throws { try self.credentialsDb.delete(userId: id) }
	public func getCredentialEncryptionMode() throws -> CredentialEncryptionMode? {
		return try self.credentialsDb.getCredentialEncryptionMode()
	}
	public func setCredentialEncryptionMode(_ encryptionMode: CredentialEncryptionMode) async throws {
		try self.credentialsDb.setCredentialEncryptionMode(encryptionMode: encryptionMode)
	}
	private func getCredentialsEncryptionKey() async throws -> Data? {
		let encryptionMode = (try self.getCredentialEncryptionMode()) ?? CredentialEncryptionMode.deviceLock
		let existingKey = try self.credentialsDb.getCredentialsEncryptionKey().map { $0.data }
		if let existingKey {
			return try await self.keychainEncryption.decryptUsingKeychain(existingKey, encryptionMode)
		} else {
			return nil
		}
	}

	public func getSupportedEncryptionModes() async -> [CredentialEncryptionMode] {
		var supportedModes = [CredentialEncryptionMode.deviceLock]
		let context = LAContext()

		let systemPasswordSupported = context.canEvaluatePolicy(.deviceOwnerAuthentication)
		if systemPasswordSupported { supportedModes.append(.systemPassword) }
		let biometricsSupported = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
		if biometricsSupported { supportedModes.append(.biometrics) }
		return supportedModes
	}

	private func encryptCredentials(_ unencryptedCredentials: UnencryptedCredentials, _ credentialsEncryptionKey: Data) throws -> PersistedCredentials {
		let accessToken = try aesEncryptData(unencryptedCredentials.accessToken.data(using: .utf8)!, withKey:credentialsEncryptionKey)
		return try PersistedCredentials(
			credentialInfo: unencryptedCredentials.credentialInfo,
			accessToken: accessToken.wrap(),
			databaseKey: unencryptedCredentials.databaseKey.map { dbKey in try aesEncryptKey(dbKey.data, withKey: credentialsEncryptionKey).wrap() },
			encryptedPassword: unencryptedCredentials.encryptedPassword
		)
	}

	private func decryptCredentials(persistedCredentials: PersistedCredentials, credentialsKey: Data) throws ->  UnencryptedCredentials {
			do {
				return try UnencryptedCredentials(
					credentialInfo: persistedCredentials.credentialInfo,
					accessToken: String(bytes: aesDecryptData(persistedCredentials.accessToken.data, withKey: credentialsKey), encoding: .utf8)!,
					databaseKey: persistedCredentials.databaseKey.map({ dbKey in
						try aesDecryptKey(dbKey.data, withKey: credentialsKey).wrap()
					}),
					encryptedPassword: persistedCredentials.encryptedPassword
				)
			} catch {
				throw KeyPermanentlyInvalidatedError(underlyingError: error)
			}
		}

	private func getOrCreateCredentialEncryptionKey() async throws -> Data {
		let existingKey = try await self.getCredentialsEncryptionKey()
		if let existingKey {
			return existingKey
		} else {
			let encryptionMode = (try self.getCredentialEncryptionMode()) ?? CredentialEncryptionMode.deviceLock
			let newKey = aesGenerateKey()
			let encryptedKey = try await self.keychainEncryption.encryptUsingKeychain(newKey, encryptionMode)
			try self.credentialsDb.setCredentialsEncryptionKey(encryptionKey: encryptedKey.wrap())
			return newKey
		}
	}

}

fileprivate extension LAContext {
	func canEvaluatePolicy(_ policy: LAPolicy) -> Bool {
		var error: NSError?
		let supported = self.canEvaluatePolicy(policy, error: &error)
		if let error { TUTSLog("Cannot evaluate policy \(policy): \(error.debugDescription)") }
		return supported
	}
}
