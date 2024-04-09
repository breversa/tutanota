/* generated file, don't edit. */


/**
 * Credentials ready to be used at runtime
 */
public struct UnencryptedCredentials : Codable {
	public init(
		credentialsInfo: CredentialsInfo,
		accessToken: String,
		databaseKey: DataWrapper?,
		encryptedPassword: String
	) {
		self.credentialsInfo = credentialsInfo
		self.accessToken = accessToken
		self.databaseKey = databaseKey
		self.encryptedPassword = encryptedPassword
	}
	public let credentialsInfo: CredentialsInfo
	public let accessToken: String
	public let databaseKey: DataWrapper?
	public let encryptedPassword: String
}
