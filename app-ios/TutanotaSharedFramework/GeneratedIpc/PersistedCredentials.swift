/* generated file, don't edit. */


/**
 * Key definition for shortcuts.
 */
public struct PersistedCredentials : Codable {
	public init(
		credentialInfo: CredentialsInfo,
		accessToken: String,
		databaseKey: String?,
		encryptedPassword: String
	) {
		self.credentialInfo = credentialInfo
		self.accessToken = accessToken
		self.databaseKey = databaseKey
		self.encryptedPassword = encryptedPassword
	}
	public let credentialInfo: CredentialsInfo
	public let accessToken: String
	public let databaseKey: String?
	public let encryptedPassword: String
}
