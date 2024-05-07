public class CredentialsDatabase {
	private let db: SqliteDb

	public init(db: SqliteDb) throws {
		self.db = db
		let dbPath = makeDbPath(fileName: "credentials.sqlite")
		try db.open(dbPath: dbPath.absoluteString)
		try self.createCredentialTable()
	}

	public func createCredentialTable() throws {
		try db.prepare(
			query: """
				CREATE TABLE IF NOT EXISTS credentials
				(login TEXT NOT NULL,
				userId TEXT NOT NULL,
				type TEXT NOT NULL,
				accessToken BLOB NOT NULL,
				databaseKey BLOB,
				encryptedPassword TEXT NOT NULL,
				PRIMARY KEY (userId),
				UNIQUE(login))
				"""
		)
		.run()
		try db.prepare(
			query: """
				CREATE TABLE IF NOT EXISTS credentialEncryptionModeEnum (mode TEXT UNIQUE)
				"""
		)
		.run()
		try db.prepare(
			query: """
				CREATE TABLE IF NOT EXISTS credentialEncryptionMode (id INTEGER NOT NULL,
				credentialEncryptionMode TEXT NOT NULL, FOREIGN KEY(credentialEncryptionMode) REFERENCES credentialEncryptionModeEnum(mode), PRIMARY KEY (id), CHECK (id=0))
				"""
		)
		.run()
		try db.prepare(
			query: """
				CREATE TABLE IF NOT EXISTS credentialEncryptionKey (id INTEGER NOT NULL,
				credentialEncryptionKey BLOB NOT NULL, PRIMARY KEY (id), CHECK (id=0))
				"""
		)
		.run()
	}

	public func getAll() throws -> [PersistedCredentials] {
		try db.prepare(
			query: """
				SELECT * FROM credentials
				"""
		)
		.all()
		.map { sqlRow in
			let credentialsInfo = CredentialsInfo(
				login: try sqlRow["login"]!.asString(),
				userId: try sqlRow["userId"]!.asString(),
				type: CredentialType(rawValue: try sqlRow["type"]!.asString())!
			)

			let databaseKey: DataWrapper? = if case let .bytes(value) = sqlRow["databaseKey"] { value } else { nil }
			return PersistedCredentials(
				credentialInfo: credentialsInfo,
				accessToken: try sqlRow["accessToken"]!.asBytes(),
				databaseKey: databaseKey,
				encryptedPassword: try sqlRow["encryptedPassword"]!.asString()
			)
		}
	}

	public func store(credentials: PersistedCredentials) throws {
		let databaseKey: TaggedSqlValue = if let databaseKey = credentials.databaseKey { .bytes(value: databaseKey) } else { .null }
		try db.prepare(
			query: """
				INSERT INTO credentials (login, userId, type, accessToken, databaseKey, encryptedPassword) 
				VALUES (?, ?, ?, ?, ?, ?)
				"""
		)
		.bindParams([
			.string(value: credentials.credentialInfo.login), .string(value: credentials.credentialInfo.userId),
			.string(value: credentials.credentialInfo.type.rawValue), .bytes(value: credentials.accessToken), databaseKey,
			.string(value: credentials.encryptedPassword),
		])
		.run()
	}

	public func delete(userId: String) throws {
		try db.prepare(
			query: """
				DELETE FROM credentials WHERE userId == ?
				"""
		)
		.bindParams([.string(value: userId)]).run()
	}

	public func getCredentialEncryptionMode() throws -> CredentialEncryptionMode? {
		try db
			.prepare(
				query: """
					SELECT credentialEncryptionMode FROM credentialEncryptionMode LIMIT 1
					"""
			)
			.get()?["credentialEncryptionMode"]
			.flatMap { mode in CredentialEncryptionMode(rawValue: try mode.asString()) }
	}

	public func getCredentialsEncryptionKey() throws -> DataWrapper? {
		try db
			.prepare(
				query: """
					SELECT credentialEncryptionKey FROM credentialEncryptionKey LIMIT 1
					"""
			)
			.get()?["credentialEncryptionKey"]?
			.asBytes()

	}

	public func setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode?) throws {
		if let encryptionMode {
			try db.prepare(
				query: """
					INSERT OR REPLACE INTO credentialEncryptionMode (id, credentialEncryptionMode) VALUES (0, ?)
					"""
			)
			.bindParams([.string(value: encryptionMode.rawValue)]).run()
		} else {
			try db.prepare(
				query: """
					DELETE FROM credentialEncryptionMode
					"""
			)
			.run()
		}
	}

	public func setCredentialsEncryptionKey(encryptionKey: DataWrapper?) throws {
		if let encryptionKey {
			try db.prepare(
				query: """
					INSERT OR REPLACE INTO credentialEncryptionKey (id, credentialEncryptionKey) VALUES (0, ?)
					"""
			)
			.bindParams([.bytes(value: encryptionKey)]).run()
		} else {
			try db.prepare(
				query: """
					DELETE FROM credentialEncryptionKey
					"""
			)
			.run()
		}
	}

	public func deleteAllCredentials() throws {
		try db.prepare(
			query: """
				DELETE FROM credentials
				"""
		)
		.run()
	}
}

private extension TaggedSqlValue {
	struct InvalidSqlType: Error { init() { } }

	func asString() throws -> String { if case let .string(value) = self { return value } else { throw InvalidSqlType() } }
	func asBytes() throws -> DataWrapper { if case let .bytes(value) = self { return value } else { throw InvalidSqlType() } }
}
