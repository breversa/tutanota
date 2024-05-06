import Foundation
import LocalAuthentication

public class AppLockHandler {
	public static func showAppLockPrompt(_ method: AppLockMethod) async throws {
		switch method {
		case .biometrics:
			do {
				try await LAContext()
					.evaluatePolicy(
						.deviceOwnerAuthenticationWithBiometrics,
						localizedReason: translate("TutaoUnlockCredentialsAction", default: "Unlock credentials")
					)
			} catch {
				throw CancelledError(message: "Permission for biometrics denied, cancelled by user, or incorrect.", underlyingError: error)
			}
		case .system_pass_or_biometrics:
			do {
				try await LAContext()
					.evaluatePolicy(
						.deviceOwnerAuthentication,
						localizedReason: translate("TutaoUnlockCredentialsAction", default: "Unlock credentials")
					)
			} catch {
				throw CancelledError(message: "Permission for biometrics denied, cancelled by user, or incorrect.", underlyingError: error)
			}
		default: break
		}
	}

	public static func isSystemPasswordSupported() -> Bool {
		let context = LAContext()

		return context.canEvaluatePolicy(.deviceOwnerAuthentication)
	}
	public static func isBiometricsSupported() -> Bool {
		let context = LAContext()

		return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
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
