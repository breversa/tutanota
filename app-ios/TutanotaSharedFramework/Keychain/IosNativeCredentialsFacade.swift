import Foundation
import LocalAuthentication

struct NotImplemented: Error {

}

public class IosNativeCredentialsFacade: NativeCredentialsFacade {
	private static let ENCRYPTION_MODE_KEY = "credentialEncryptionMode"
	private static let CREDENTIALS_ENCRYPTION_KEY_KEY = "credentialsEncryptionKey"

	private let keychainManager: KeychainManager
	private let credentialsDb: CredentialsDatabase
	private let userDefaults: UserDefaults

	public init(keychainManager: KeychainManager, credentialsDb: CredentialsDatabase, userDefaults: UserDefaults) {
		self.keychainManager = keychainManager
		self.credentialsDb = credentialsDb
		self.userDefaults = userDefaults
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
		try self.setCredentialEncryptionMode(nil)
		try self.setCredentialsEncryptionKey(nil)
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
	public func setCredentialEncryptionMode(_ encryptionMode: CredentialEncryptionMode?) throws {
		try self.credentialsDb.setCredentialEncryptionMode(encryptionMode: encryptionMode)
	}
	private func getCredentialsEncryptionKey() throws -> Data? {
		return try self.credentialsDb.getCredentialsEncryptionKey().map { Data(base64Encoded: $0)! }
	}
	private func setCredentialsEncryptionKey(_ credentialsEncryptionKey: Data?) throws {
		let base64 = credentialsEncryptionKey?.base64EncodedString()
		try self.credentialsDb.setCredentialsEncryptionKey(encryptionKey: base64)
	}

	func encryptUsingKeychain(_ data: Data, _ encryptionMode: CredentialEncryptionMode) async throws -> Data {
		return try self.keychainManager.encryptData(encryptionMode: encryptionMode, data: data)
	}

	private func decryptUsingKeychain(_ encryptedData: Data, _ encryptionMode: CredentialEncryptionMode) async throws -> Data {
		let data = try self.keychainManager.decryptData(encryptionMode: encryptionMode, encryptedData: encryptedData)
		return data
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
			accessToken: accessToken.base64EncodedString(),
			databaseKey: unencryptedCredentials.databaseKey.map { dbKey in try aesEncryptKey(dbKey.data, withKey: credentialsEncryptionKey).base64EncodedString() },
			encryptedPassword: unencryptedCredentials.encryptedPassword
		)
	}

	private func decryptCredentials(persistedCredentials: PersistedCredentials, credentialsKey: Data) throws ->  UnencryptedCredentials {
			do {
				let accessTokenData: Data = Data(base64Encoded: persistedCredentials.accessToken)!
				return try UnencryptedCredentials(
					credentialInfo: persistedCredentials.credentialInfo,
					accessToken: String(bytes: aesDecryptData(accessTokenData, withKey: credentialsKey), encoding: .utf8)!,
					databaseKey: persistedCredentials.databaseKey.map({ dbKey in
						try aesDecryptKey(Data(base64Encoded: dbKey)!, withKey: credentialsKey).wrap()
					}),
					encryptedPassword: persistedCredentials.encryptedPassword
				)
			} catch {
				throw KeyPermanentlyInvalidatedError(underlyingError: error)
			}
		}

	private func getOrCreateCredentialEncryptionKey() async throws -> Data {
		let encryptionMode = (try self.getCredentialEncryptionMode()) ?? CredentialEncryptionMode.deviceLock
		let exisingKey = try self.getCredentialsEncryptionKey()
		if let exisingKey {
			let decryptedKey = try await self.decryptUsingKeychain(exisingKey, encryptionMode)
			return decryptedKey
		} else {
			let newKey = aesGenerateKey()
			let encryptedKey = try await self.encryptUsingKeychain(newKey, encryptionMode)
			try self.setCredentialsEncryptionKey(encryptedKey)
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
