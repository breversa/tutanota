import Foundation

public func translate(_ key: String, default defaultValue: String) -> String { Bundle.main.localizedString(forKey: key, value: defaultValue, table: "InfoPlist") }

// // keep in sync with src/native/main/NativePushServiceApp.ts
let SYS_MODEL_VERSION = 85

public func addSystemModelHeaders(to headers: inout [String: String]) { headers["v"] = String(SYS_MODEL_VERSION) }

public func makeDbPath(fileName: String) -> URL {
	let sharedDirectory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.tutao.tutanota")

	return (sharedDirectory?.appendingPathComponent(fileName))!
}
