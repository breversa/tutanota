import Foundation

public class KeychainEncryption {
	private let keychainManager: KeychainManager

	public init (keychainManager: KeychainManager) {
		self.keychainManager = keychainManager
	}

	func encryptUsingKeychain(_ data: Data, _ encryptionMode: CredentialEncryptionMode) async throws -> Data {
		// iOS does not actually require explicit permission when encrypting with biometrics, and 'context.canEvaluatePolicy' does not return false until the user actually says no,
		// thus we need to force it to check for permission here; this will throw CancelledError if permission was then denied.
		//
		// If we don't do this, then the user will get locked out until they fix it in Settings.
		try await checkPermissionForEncryptionMode(encryptionMode)
		return try self.keychainManager.encryptData(encryptionMode: encryptionMode, data: data)
	}

	func decryptUsingKeychain(_ encryptedData: Data, _ encryptionMode: CredentialEncryptionMode) async throws -> Data {
		let data = try self.keychainManager.decryptData(encryptionMode: encryptionMode, encryptedData: encryptedData)
		return data
	}

	private func checkPermissionForEncryptionMode(_ mode: CredentialEncryptionMode) async throws {
    		switch mode {
    		case .biometrics:
    			do {
    				try await LAContext()
    					.evaluatePolicy(
    						.deviceOwnerAuthenticationWithBiometrics,
    						localizedReason: translate("TutaoUnlockCredentialsAction", default: "Unlock credentials")
    					)
    			} catch { throw CancelledError(message: "Permission for biometrics denied, cancelled by user, or incorrect.", underlyingError: error) }
    		default: break
    		}
    	}
}
