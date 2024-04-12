import o from "@tutao/otest"
import { CredentialsProvider } from "../../../../src/misc/credentials/CredentialsProvider.js"
import { assertNotNull } from "@tutao/tutanota-utils"
import { CredentialEncryptionMode } from "../../../../src/misc/credentials/CredentialEncryptionMode.js"
import { object, when } from "testdouble"
import { verify } from "@tutao/tutanota-test-utils"
import { InterWindowEventFacadeSendDispatcher } from "../../../../src/native/common/generatedipc/InterWindowEventFacadeSendDispatcher.js"
import { SqlCipherFacade } from "../../../../src/native/common/generatedipc/SqlCipherFacade.js"
import { PersistedCredentials } from "../../../../src/native/common/generatedipc/PersistedCredentials.js"
import { UnencryptedCredentials } from "../../../../src/native/common/generatedipc/UnencryptedCredentials.js"
import { CredentialType } from "../../../../src/misc/credentials/CredentialType.js"
import { NativeCredentialsFacade } from "../../../../src/native/common/generatedipc/NativeCredentialsFacade.js"
import { CredentialsInfo } from "../../../../src/native/common/generatedipc/CredentialsInfo.js"

const encryptionKey = new Uint8Array([1, 2, 5, 8])

o.spec("CredentialsProvider", function () {
	let credentialsProvider: CredentialsProvider
	let internalCredentials: UnencryptedCredentials
	let internalCredentials2: UnencryptedCredentials
	let externalCredentials: UnencryptedCredentials
	let encryptedInternalCredentials: PersistedCredentials
	let encryptedExternalCredentials: PersistedCredentials
	let encryptedInternalCredentialsWithoutDatabaseKey: Omit<PersistedCredentials, "databaseKey">
	let sqlCipherFacadeMock: SqlCipherFacade
	let interWindowEventSenderMock: InterWindowEventFacadeSendDispatcher
	let nativeCredentialFacadeMock: NativeCredentialsFacade
	o.beforeEach(function () {
		internalCredentials = {
			credentialInfo: {
				login: "test@example.com",
				userId: "789",
				type: CredentialType.internal,
			},
			encryptedPassword: "123",
			accessToken: "456",
			databaseKey: null,
		}
		internalCredentials2 = {
			credentialInfo: {
				login: "test@example.com",
				userId: "789012",
				type: CredentialType.internal,
			},
			encryptedPassword: "123456",
			accessToken: "456789",
			databaseKey: null,
		}
		externalCredentials = {
			credentialInfo: {
				login: "test2@example.com",
				userId: "7892",
				type: CredentialType.external,
			},
			encryptedPassword: "1232",
			accessToken: "4562",
			databaseKey: null,
		}
		encryptedInternalCredentials = {
			credentialInfo: {
				login: internalCredentials.credentialInfo.login,
				userId: internalCredentials.credentialInfo.userId,
				type: internalCredentials.credentialInfo.type,
			},
			encryptedPassword: assertNotNull(internalCredentials.encryptedPassword),
			accessToken: internalCredentials.accessToken,
			databaseKey: "SSBhbSBhIGtleQo=",
		}
		encryptedExternalCredentials = {
			credentialInfo: {
				login: internalCredentials.credentialInfo.login,
				userId: internalCredentials.credentialInfo.userId,
				type: internalCredentials.credentialInfo.type,
			},
			encryptedPassword: assertNotNull(externalCredentials.encryptedPassword),
			accessToken: externalCredentials.accessToken,
			databaseKey: "SSBhbSBhIGtleQo=",
		}
		encryptedInternalCredentialsWithoutDatabaseKey = {
			credentialInfo: {
				login: internalCredentials.credentialInfo.login,
				userId: internalCredentials.credentialInfo.userId,
				type: internalCredentials.credentialInfo.type,
			},
			encryptedPassword: assertNotNull(internalCredentials2.encryptedPassword),
			accessToken: internalCredentials2.accessToken,
		}
		sqlCipherFacadeMock = object()
		interWindowEventSenderMock = object()
		nativeCredentialFacadeMock = object()
		credentialsProvider = new CredentialsProvider(nativeCredentialFacadeMock, sqlCipherFacadeMock, interWindowEventSenderMock)
	})

	o.spec("Storing credentials", function () {
		o("Should store credentials", async function () {
			await credentialsProvider.store(internalCredentials)
			verify(nativeCredentialFacadeMock.store(internalCredentials))
		})
	})

	o.spec("Reading Credentials", function () {
		o.beforeEach(async function () {
			when(nativeCredentialFacadeMock.loadByUserId(internalCredentials.credentialInfo.userId)).thenResolve(internalCredentials)
			when(nativeCredentialFacadeMock.loadByUserId(externalCredentials.credentialInfo.userId)).thenResolve(externalCredentials)
			when(nativeCredentialFacadeMock.loadAll()).thenResolve([encryptedInternalCredentials, encryptedExternalCredentials])
		})
		o("Should return internal Credentials", async function () {
			const retrievedCredentials = await credentialsProvider.getDecryptedCredentialsByUserId(internalCredentials.credentialInfo.userId)

			o(retrievedCredentials).deepEquals(internalCredentials)
		})

		o("Should return credential infos for internal users", async function () {
			const retrievedCredentials = await credentialsProvider.getInternalCredentialsInfos()

			o(retrievedCredentials).deepEquals([encryptedInternalCredentials.credentialInfo])
		})
	})

	o.spec("Deleting credentials", function () {
		o("Should delete credentials from storage", async function () {
			await credentialsProvider.deleteByUserId(internalCredentials.credentialInfo.userId)
			verify(nativeCredentialFacadeMock.deleteByUserId(internalCredentials.credentialInfo.userId), { times: 1 })
		})
		o("Deletes offline database", async function () {
			await credentialsProvider.deleteByUserId(internalCredentials.credentialInfo.userId)
			verify(sqlCipherFacadeMock.deleteDb(internalCredentials.credentialInfo.userId))
		})
		o("Sends event over EventBus", async function () {
			await credentialsProvider.deleteByUserId(internalCredentials.credentialInfo.userId)
			verify(interWindowEventSenderMock.localUserDataInvalidated(internalCredentials.credentialInfo.userId))
		})
	})

	o.spec("Setting credentials encryption mode", function () {
		o("Enrolling", async function () {
			const newEncryptionMode = CredentialEncryptionMode.DEVICE_LOCK
			await credentialsProvider.setCredentialEncryptionMode(newEncryptionMode)
			verify(nativeCredentialFacadeMock.setCredentialEncryptionMode(newEncryptionMode), { times: 1 })
		})
	})

	o.spec("Changing credentials encryption mode", function () {
		o("Changing encryption mode", async function () {
			const oldEncryptionMode = CredentialEncryptionMode.SYSTEM_PASSWORD
			const newEncryptionMode = CredentialEncryptionMode.DEVICE_LOCK

			when(nativeCredentialFacadeMock.getCredentialEncryptionMode()).thenResolve(oldEncryptionMode)

			await credentialsProvider.setCredentialEncryptionMode(newEncryptionMode)

			verify(nativeCredentialFacadeMock.setCredentialEncryptionMode(newEncryptionMode))
		})
	})

	o.spec("clearCredentials", function () {
		o.beforeEach(function () {
			when(nativeCredentialFacadeMock.loadAll()).thenResolve([encryptedInternalCredentials, encryptedExternalCredentials])
		})
		o("deleted credentials, key and mode", async function () {
			await credentialsProvider.clearCredentials("testing")

			verify(nativeCredentialFacadeMock.deleteByUserId(internalCredentials.credentialInfo.userId))
			verify(nativeCredentialFacadeMock.deleteByUserId(externalCredentials.credentialInfo.userId))
		})
		o("Clears offline databases", async function () {
			await credentialsProvider.clearCredentials("testing")
			verify(sqlCipherFacadeMock.deleteDb(internalCredentials.credentialInfo.userId))
			verify(sqlCipherFacadeMock.deleteDb(externalCredentials.credentialInfo.userId))
		})
		o("Sends event over EventBus", async function () {
			await credentialsProvider.clearCredentials("testing")
			verify(interWindowEventSenderMock.localUserDataInvalidated(internalCredentials.credentialInfo.userId))
			verify(interWindowEventSenderMock.localUserDataInvalidated(externalCredentials.credentialInfo.userId))
		})
	})

	o.spec("replace the stored password", function () {
		const userId = "userId"
		const credentials: CredentialsInfo = {
			login: "login",
			userId: userId,
			type: CredentialType.internal,
		}
		const persistentCredentials: PersistedCredentials = {
			credentialInfo: credentials,
			accessToken: "accessToken",
			databaseKey: "databaseKey",
			encryptedPassword: "old encrypted password",
		}
		const newEncryptedPassword = "uhagre2"
		o.beforeEach(function () {
			when(nativeCredentialFacadeMock.loadAll()).thenResolve([persistentCredentials])
		})

		o("replace only", async function () {
			await credentialsProvider.replacePassword(credentials, newEncryptedPassword)

			verify(
				nativeCredentialFacadeMock.storeEncrypted({
					credentialInfo: credentials,
					accessToken: "accessToken",
					databaseKey: "databaseKey",
					encryptedPassword: newEncryptedPassword,
				}),
			)
		})
	})
})
