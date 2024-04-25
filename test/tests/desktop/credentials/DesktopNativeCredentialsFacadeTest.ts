import o from "@tutao/otest"
import { DesktopNativeCredentialsFacade } from "../../../../src/desktop/credentials/DesktopNativeCredentialsFacade.js"
import { DesktopNativeCryptoFacade } from "../../../../src/desktop/DesktopNativeCryptoFacade.js"
import { makeKeyStoreFacade } from "../../TestUtils.js"
import { object } from "testdouble"
import { DesktopConfig } from "../../../../src/desktop/config/DesktopConfig.js"
import { DesktopCredentialsStorage } from "../../../../src/desktop/db/DesktopCredentialsStorage.js"
import { AppPassHandler } from "../../../../src/desktop/credentials/AppPassHandler.js"
import { KeychainManager } from "../../../../src/desktop/credentials/KeychainManager.js"

o.spec("DesktopNativeCredentialsFacade", () => {
	const key = new Uint8Array([1, 2, 3])
	const keyStoreFacade = makeKeyStoreFacade(key)

	const getSubject = async () => {
		const crypto: DesktopNativeCryptoFacade = object()
		const conf: DesktopConfig = object()
		const credentialsDb: DesktopCredentialsStorage = object()
		const appPassHandler: AppPassHandler = object()
		const keychainManager: KeychainManager = object()

		return {
			subject: new DesktopNativeCredentialsFacade(crypto, credentialsDb, keychainManager),
			mocks: {
				crypto,
				conf,
				credentialsDb,
				appPassHandler,
			},
		}
	}

	// FIXME move or rewrite
	// o("throws when using wrong encryption mode", async function () {
	// 	const { subject, mocks } = await getSubject()
	// 	// @ts-ignore
	// 	await assertThrows(Error, () => subject.decryptUsingKeychain("base64", CredentialEncryptionMode.BIOMETRICS))
	// 	// @ts-ignore
	// 	await assertThrows(Error, () => subject.decryptUsingKeychain("base64", CredentialEncryptionMode.SYSTEM_PASSWORD))
	// 	// @ts-ignore
	// 	await assertThrows(Error, () => subject.encryptUsingKeychain("base64", CredentialEncryptionMode.BIOMETRICS))
	// 	// @ts-ignore
	// 	await assertThrows(Error, () => subject.encryptUsingKeychain("base64", CredentialEncryptionMode.SYSTEM_PASSWORD))
	// })
	//
	// o("does not throw when using right encryption mode, app pw", async function () {
	// 	const { subject, mocks } = await getSubject()
	// 	when(mocks.conf.getVar(DesktopConfigKey.appPassSalt)).thenResolve(stringToBase64("saltsalt"))
	// 	when(mocks.appPassHandler.removeAppPassWrapper(matchers.anything(), matchers.anything())).thenResolve(new Uint8Array([0]))
	//
	// 	await subject.decryptUsingKeychain(new Uint8Array([1]), CredentialEncryptionMode.APP_PASSWORD)
	// })
	//
	// o("does not throw when using right encryption mode, device lock", async function () {
	// 	const { subject, mocks } = await getSubject()
	// 	await subject.decryptUsingKeychain(Uint8Array.from([1, 2, 3]), CredentialEncryptionMode.DEVICE_LOCK)
	// })
})
