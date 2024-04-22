import { log } from "../DesktopLog.js"
import { makeDbPath } from "./DbUtils.js"
import { Database, default as Sqlite } from "better-sqlite3"
import fs from "node:fs"
import { OfflineDbClosedError } from "../../api/common/error/OfflineDbClosedError.js"
import { CryptoError } from "@tutao/tutanota-crypto/error.js"
import { app } from "electron"
import { SqlValue } from "../../api/worker/offline/SqlValue.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { UntaggedQuery, usql } from "../../api/worker/offline/Sql.js"
import { CredentialType } from "../../misc/credentials/CredentialType.js"
import { CredentialEncryptionMode } from "../../misc/credentials/CredentialEncryptionMode.js"
import { Base64 } from "@tutao/tutanota-utils"

const TableDefinitions = Object.freeze({
	credentials:
		"login TEXT NOT NULL, userId TEXT NOT NULL, type TEXT NOT NULL, accessToken BLOB NOT NULL, databaseKey BLOB," +
		" encryptedPassword TEXT NOT NULL, PRIMARY KEY (userId), UNIQUE(login)",
	credentialsEncryptionMode: "credentialsEncryptionMode TEXT, FOREIGN KEY(credentialsEncryptionMode) REFERENCES credentialsEncryptionModeEnum(mode)",
	credentialEncryptionKey: "credentialEncryptionKey BLOB",
} as const)

/**
 * Sql database for storing already encrypted user credentials
 */
export class DesktopCredentialsStorage {
	private _db: Database | null = null
	private get db(): Database {
		if (this._db == null) {
			throw new OfflineDbClosedError()
		}
		return this._db
	}

	private readonly _sqliteNativePath: string | null = null
	public static readonly dbPath: string = makeDbPath("credentials")

	constructor(sqliteNativePath: string) {
		this._sqliteNativePath = sqliteNativePath
		if (this._db == null) {
			this.create().then(() => {
				app.on("will-quit", () => this.closeDb())
			})
		}
	}

	async create(retry: boolean = true): Promise<void> {
		try {
			this.openDb()
			this.createTables()
		} catch (e) {
			if (!retry) throw e
			log.debug("retrying to create credentials db")
			await this.deleteDb()
			return this.create(false)
		}
	}

	openDb(): void {
		this._db = new Sqlite(DesktopCredentialsStorage.dbPath, {
			// Remove ts-ignore once proper definition of Options exists, see https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/59049#
			// @ts-ignore missing type
			nativeBinding: this._sqliteNativePath,
			// verbose: (message, args) => console.log("DB", message, args),
		})
		try {
			this.initSql()
		} catch (e) {
			// If we can't initialize the database we don't want to be stuck in a state where we hold the file lock, we need to retry the whole process again
			this.db.close()
			this._db = null
			throw e
		}
	}

	private initSql() {
		this.db.pragma("cipher_memory_security = ON")

		const errors: [] = this.db.pragma("cipher_integrity_check")
		if (errors.length > 0) {
			throw new CryptoError(`Integrity check failed with result : ${JSON.stringify(errors)}`)
		}
	}

	async closeDb(): Promise<void> {
		this.db.close()
		this._db = null
	}

	async deleteDb(): Promise<void> {
		log.debug("deleting credentials db")
		await fs.promises.rm(DesktopCredentialsStorage.dbPath, { maxRetries: 3, force: true })
	}

	private createTables() {
		this.createEnumTable()
		for (let [name, definition] of Object.entries(TableDefinitions)) {
			this.run({ query: `CREATE TABLE IF NOT EXISTS ${name} (${definition})`, params: [] })
		}
	}

	store(credentials: PersistedCredentials) {
		const formattedQuery = usql`INSERT INTO credentials (login, userId, type, accessToken, databaseKey, encryptedPassword) VALUES (
${credentials.credentialInfo.login}, ${credentials.credentialInfo.userId}, ${credentials.credentialInfo.type},
${credentials.accessToken}, ${credentials.databaseKey}, ${credentials.encryptedPassword})`
		return this.run(formattedQuery)
	}

	getAllCredentials() {
		const records = this.all(usql`SELECT * FROM credentials`)
		return records.map((row) => this.unmapCredentials(row))
	}

	getCredentialsByUserId(userId: string) {
		const row = this.get(usql`SELECT * FROM credentials WHERE userId = ${userId}`)
		if (!row) return null
		return this.unmapCredentials(row)
	}

	deleteByUserId(userId: string) {
		return this.run(usql`DELETE FROM credentials WHERE userId = ${userId}`)
	}

	deleteAllCredentials() {
		this.run(usql`DELETE FROM credentials`)
	}

	private createEnumTable() {
		this.run({ query: `CREATE TABLE IF NOT EXISTS credentialsEncryptionModeEnum (mode TEXT UNIQUE)`, params: [] })
		for (let i in CredentialEncryptionMode) {
			const insertQuery = usql`INSERT INTO credentialsEncryptionModeEnum (mode) VALUES (${i})`
			this.run(insertQuery)
		}
	}

	private unmapCredentials(row: Record<string, string | number | Uint8Array | null>) {
		const credentialType = CredentialType[row.type as keyof typeof CredentialType]
		if (!credentialType) throw Error() // FIXME different error
		return {
			credentialInfo: {
				login: row.login as string,
				userId: row.userId as string,
				type: credentialType,
			},
			encryptedPassword: row.encryptedPassword as string,
			accessToken: row.accessToken as Uint8Array,
			databaseKey: row.databaseKey as Uint8Array,
		}
	}

	private run({ query, params }: UntaggedQuery): void {
		this.db.prepare(query).run(params)
	}

	/**
	 * Execute a query
	 * @returns a single object or undefined if the query returns nothing
	 */
	private get({ query, params }: UntaggedQuery): Record<string, SqlValue> | null {
		return this.db.prepare(query).get(params) ?? null
	}

	/**
	 * Execute a query
	 * @returns a list of objects or an empty list if the query returns nothing
	 */
	private all({ query, params }: UntaggedQuery): Array<Record<string, SqlValue>> {
		return this.db.prepare(query).all(params)
	}

	getCredentialEncryptionMode(): string | null {
		const row = this.get(usql`SELECT credentialsEncryptionMode FROM credentialsEncryptionMode LIMIT 1`)
		if (!row) return null
		return row.credentialsEncryptionMode as string
	}

	getCredentialEncryptionKey(): Base64 | null {
		const row = this.get(usql`SELECT credentialsEncryptionKey FROM credentialsEncryptionKey LIMIT 1`)
		if (!row) return null
		return row.credentialsEncryptionKey as string
	}

	setCredentialEncryptionMode(encryptionMode: CredentialEncryptionMode | null) {
		this.run(usql`DELETE FROM credentialsEncryptionMode`)
		if (encryptionMode != null) {
			this.run(usql`INSERT INTO credentialsEncryptionMode (credentialsEncryptionMode) VALUES (${encryptionMode})`)
		}
	}

	setCredentialEncryptionKey(encryptionKey: Base64 | null) {
		this.run(usql`DELETE FROM credentialsEncryptionKey`)
		if (encryptionKey != null) {
			this.run(usql`INSERT INTO credentialsEncryptionKey (credentialsEncryptionKey) VALUES (${encryptionKey})`)
		}
	}
}
