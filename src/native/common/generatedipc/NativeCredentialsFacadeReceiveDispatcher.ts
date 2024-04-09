/* generated file, don't edit. */

import { UnencryptedCredentials } from "./UnencryptedCredentials.js"
import { CredentialEncryptionMode } from "./CredentialEncryptionMode.js"
import { NativeCredentialsFacade } from "./NativeCredentialsFacade.js"

export class NativeCredentialsFacadeReceiveDispatcher {
	constructor(private readonly facade: NativeCredentialsFacade) {}
	async dispatch(method: string, arg: Array<any>): Promise<any> {
		switch (method) {
			case "getSupportedEncryptionModes": {
				return this.facade.getSupportedEncryptionModes()
			}
			case "loadAll": {
				return this.facade.loadAll()
			}
			case "store": {
				const credentials: UnencryptedCredentials = arg[0]
				return this.facade.store(credentials)
			}
			case "loadByUserId": {
				const id: string = arg[0]
				return this.facade.loadByUserId(id)
			}
			case "deleteByUserId": {
				const id: string = arg[0]
				return this.facade.deleteByUserId(id)
			}
			case "getCredentialEncryptionMode": {
				return this.facade.getCredentialEncryptionMode()
			}
			case "setCredentialEncryptionMode": {
				const encryptionMode: CredentialEncryptionMode | null = arg[0]
				return this.facade.setCredentialEncryptionMode(encryptionMode)
			}
			case "clear": {
				return this.facade.clear()
			}
		}
	}
}
