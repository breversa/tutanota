/* generated file, don't edit. */

import { CredentialsInfo } from "./CredentialsInfo.js"
/**
 * Key definition for shortcuts.
 */
export interface PersistedCredentials {
	readonly credentialInfo: CredentialsInfo
	readonly accessToken: string
	readonly databaseKey: string | null
	readonly encryptedPassword: string
}
