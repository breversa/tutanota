import { CredentialsProvider } from "./CredentialsProvider.js"
import { isAdminClient, isBrowser, isDesktop } from "../../api/common/Env"
import type { NativeInterface } from "../../native/common/NativeInterface"
import { assertNotNull } from "@tutao/tutanota-utils"
import { InterWindowEventFacadeSendDispatcher } from "../../native/common/generatedipc/InterWindowEventFacadeSendDispatcher.js"
import { SqlCipherFacade } from "../../native/common/generatedipc/SqlCipherFacade.js"
import { PersistedCredentials } from "../../native/common/generatedipc/PersistedCredentials.js"
import { NativeCredentialsFacade } from "../../native/common/generatedipc/NativeCredentialsFacade.js"
import { DeviceConfig } from "../DeviceConfig.js"
import { CredentialEncryptionMode } from "./CredentialEncryptionMode.js"
import { UnencryptedCredentials } from "../../native/common/generatedipc/UnencryptedCredentials.js"

export function usingKeychainAuthenticationWithOptions(): boolean {
	return !isBrowser() && !isAdminClient()
}

/**
 * Factory method for credentials provider that will return an instance injected with the implementations appropriate for the platform.
 */
export async function createCredentialsProvider(
	nativeApp: NativeInterface | null,
	sqlCipherFacade: SqlCipherFacade,
	deviceConfig: DeviceConfig,
	interWindowEventSender: InterWindowEventFacadeSendDispatcher | null,
): Promise<CredentialsProvider> {
	if (usingKeychainAuthenticationWithOptions()) {
		const { NativeCredentialsFacadeSendDispatcher } = await import("../../native/common/generatedipc/NativeCredentialsFacadeSendDispatcher.js")
		const credentialsFacade = new NativeCredentialsFacadeSendDispatcher(assertNotNull(nativeApp))
		return new CredentialsProvider(credentialsFacade, sqlCipherFacade, isDesktop() ? interWindowEventSender : null)
	} else {
		return new CredentialsProvider(new WebCredentialsFacade(deviceConfig), null, null)
	}
}

/**
 * This is a temporary stub that we will replace soon by some mechanism that will be able to utilize fingerprint/pin on mobile devices
 * for encryption of login data. Using this implementation does not mean we do not encrypt credentials currently since there is an
 * additional mechanism for credentials encryption using an access key stored server side. This is done in LoginFacade.
 */

class WebCredentialsFacade implements NativeCredentialsFacade {
	constructor(private readonly deviceConfig: DeviceConfig) {}
	async clear(): Promise<void> {
		const allCredentials = await this.deviceConfig.loadAll()
		for (const credentials of allCredentials) {
			await this.deviceConfig.deleteByUserId(credentials.credentialsInfo.userId)
		}
	}

	deleteByUserId(id: string): Promise<void> {
		return this.deviceConfig.deleteByUserId(id)
	}

	async getCredentialEncryptionMode(): Promise<CredentialEncryptionMode | null> {
		return null
	}

	loadAll(): Promise<ReadonlyArray<PersistedCredentials>> {
		return this.deviceConfig.loadAll()
	}

	async loadByUserId(id: string): Promise<UnencryptedCredentials | null> {
		const persistedCredentials = await this.deviceConfig.loadByUserId(id)
		if (persistedCredentials == null) return null
		return {
			credentialsInfo: persistedCredentials.credentialsInfo,
			encryptedPassword: persistedCredentials.encryptedPassword,
			accessToken: persistedCredentials.accessToken,
			databaseKey: null,
		}
	}

	async setCredentialEncryptionMode(_: CredentialEncryptionMode | null): Promise<void> {}

	store(credentials: UnencryptedCredentials): Promise<void> {
		const persistedCredentials: PersistedCredentials = {
			credentialsInfo: credentials.credentialsInfo,
			encryptedPassword: credentials.encryptedPassword,
			accessToken: credentials.accessToken,
			databaseKey: null,
		}
		return this.deviceConfig.store(persistedCredentials)
	}
	async getSupportedEncryptionModes() {
		return []
	}
}
