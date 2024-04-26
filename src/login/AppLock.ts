import { MobileSystemFacade } from "../native/common/generatedipc/MobileSystemFacade.js"

/**
 * Enforces app authentication via system mechanism e.g. system password or biometrics.
 */
export interface AppLock {
	/** @throws CredentialAuthenticationError */
	enforce(): Promise<void>
}

export class NoOpAppLock implements AppLock {
	async enforce(): Promise<void> {}
}

export class MobileAppLock implements AppLock {
	constructor(private readonly mobileSystemFacade: MobileSystemFacade) {}

	async enforce(): Promise<void> {
		return this.mobileSystemFacade.enforceAppLock(await this.mobileSystemFacade.getAppLockMethod())
	}
}
