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

const TableDefinitions = Object.freeze({
	credentials:
		"login TEXT NOT NULL, userId TEXT NOT NULL, type TEXT NOT NULL, accessToken TEXT NOT NULL, databaseKey TEXT," +
		" encryptedPassword TEXT NOT NULL, PRIMARY KEY (userId), UNIQUE(login)",
} as const)

/**
 * Sql database for storing already encrypted user credentials
 * FIXME use worker
 * FIXME maybe a different interface
 */
export class DesktopCredentialsStorage {
	private _db: Database | null = null
	private get db(): Database {
		if (this._db == null) {
			throw new OfflineDbClosedError() // FIXME different error
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

	private unmapCredentials(row: Record<string, string | number | Uint8Array | null>) {
		const credentialType = CredentialType[row.type as keyof typeof CredentialType]
		if (!credentialType) throw Error() // FIXME
		return {
			credentialInfo: {
				login: row.login as string,
				userId: row.userId as string,
				type: credentialType,
			},
			encryptedPassword: row.encryptedPassword as string,
			accessToken: row.accessToken as string,
			databaseKey: row.databaseKey as string,
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
}
