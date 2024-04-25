import o from "@tutao/otest"
import { AppPassHandler, resolveChecked } from "../../../../src/desktop/credentials/AppPassHandler.js"
import { DesktopNativeCryptoFacade } from "../../../../src/desktop/DesktopNativeCryptoFacade.js"
import { LanguageViewModel } from "../../../../src/misc/LanguageViewModel.js"
import { DesktopConfig } from "../../../../src/desktop/config/DesktopConfig.js"
import { function as fn, matchers, object, verify, when } from "testdouble"
import { CommonNativeFacade } from "../../../../src/native/common/generatedipc/CommonNativeFacade.js"
import { DesktopConfigKey } from "../../../../src/desktop/config/ConfigKeys.js"
import { defer, delay, stringToBase64 } from "@tutao/tutanota-utils"
import { CredentialEncryptionMode } from "../../../../src/misc/credentials/CredentialEncryptionMode.js"
import { CancelledError } from "../../../../src/api/common/error/CancelledError.js"
import { assertThrows } from "@tutao/tutanota-test-utils"
import { KeyPermanentlyInvalidatedError } from "../../../../src/api/common/error/KeyPermanentlyInvalidatedError.js"
import path from "node:path"

o.spec("AppPassHandler", () => {
	let crypto: DesktopNativeCryptoFacade
	let lang: LanguageViewModel
	let conf: DesktopConfig
	let commonNativeFacade: CommonNativeFacade
	let appPassHandler: AppPassHandler

	o.beforeEach(async () => {
		crypto = object()
		lang = object()
		conf = object()
		// too hard to mock
		const wasmPath = path.resolve("../packages/tutanota-crypto/lib/hashes/Argon2id/argon2.wasm")
		const argon = loadArgon2ModuleFromFile(wasmPath)
		commonNativeFacade = object()
		appPassHandler = new AppPassHandler(crypto, conf, argon, lang, () => Promise.resolve(commonNativeFacade))
	})

	o("throws a CancelledError for all pending requests if the salt changes", async function () {
		when(conf.getVar(DesktopConfigKey.appPassSalt)).thenResolve(stringToBase64("saltsalt"))
		const pwPromise = defer<string>()
		when(commonNativeFacade.promptForPassword(matchers.anything())).thenReturn(pwPromise.promise)

		// matchers.captor() did not give me the values array :(
		const cbs: Array<any> = []
		conf.once = (key, cb) => {
			o(key).equals(DesktopConfigKey.appPassSalt)
			cb("saltsalt2")
			return conf
		}
		const promise1 = appPassHandler.removeAppPassWrapper(Uint8Array.from([1, 2, 3, 4]), CredentialEncryptionMode.APP_PASSWORD)
		const promise2 = appPassHandler.removeAppPassWrapper(Uint8Array.from([1, 2, 3, 4]), CredentialEncryptionMode.APP_PASSWORD)

		verify(commonNativeFacade.showAlertDialog(matchers.anything()), { times: 0 })

		await assertThrows(CancelledError, () => promise1)
		await assertThrows(CancelledError, () => promise2)

		pwPromise.resolve("make it call the alternative")
		await delay(0)
		verify(commonNativeFacade.showAlertDialog(matchers.anything()), { times: 2 })
	})

	o("throws a KeyPermanentlyInvalidatedError if there is no salt", async function () {
		when(conf.getVar(DesktopConfigKey.appPassSalt)).thenResolve(null)
		const pwPromise = defer<string>()
		when(commonNativeFacade.promptForPassword(matchers.anything())).thenReturn(pwPromise.promise)

		await assertThrows(KeyPermanentlyInvalidatedError, () =>
			appPassHandler.removeAppPassWrapper(Uint8Array.from([1, 2, 3, 4]), CredentialEncryptionMode.APP_PASSWORD),
		)
	})
})

async function loadArgon2ModuleFromFile(path: string): Promise<WebAssembly.Exports> {
	if (typeof process !== "undefined") {
		try {
			const { readFile } = await import("node:fs/promises")
			const wasmBuffer = await readFile(path)
			return (await WebAssembly.instantiate(wasmBuffer)).instance.exports
		} catch (e) {
			throw new Error(`Can't load argon2 module: ${e}`)
		}
	} else {
		return (await WebAssembly.instantiateStreaming(await fetch(path))).instance.exports
	}
}

o.spec("resolveChecked", function () {
	o("rejects if whileNot rejects, also calls otherwise", async function () {
		const otherWise = fn<any>()
		const { promise, resolve } = defer()
		const rejector = defer<never>()
		const subject = assertThrows(Error, () => resolveChecked(promise, rejector.promise, otherWise))
		rejector.reject(new Error("aw"))
		resolve(0)
		await subject
		verify(otherWise(), { times: 1 })
	})

	o("rejects if promise rejects", async function () {
		const otherWise = fn<any>()
		const { promise, reject } = defer()
		const rejector = defer<never>()
		const subject = assertThrows(Error, () => resolveChecked(promise, rejector.promise, otherWise))
		reject(new Error("aw"))
		await subject
		verify(otherWise(), { times: 0 })
	})

	o("resolves if promise resolves", async function () {
		const otherWise = fn<any>()
		const { promise, resolve } = defer()
		const rejector = defer<never>()
		const subject = resolveChecked(promise, rejector.promise, otherWise)
		resolve("hello")
		const value = await subject
		verify(otherWise(), { times: 0 })
		o(value).equals("hello")
	})
})
