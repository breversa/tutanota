import type { Commands } from "../common/threading/MessageDispatcher.js"
import { MessageDispatcher, Request } from "../common/threading/MessageDispatcher.js"
import { Transport, WebWorkerTransport } from "../common/threading/Transport.js"
import { assertMainOrNode } from "../common/Env"
import type { IMainLocator } from "./MainLocator"
import { client } from "../../misc/ClientDetector"
import type { DeferredObject } from "@tutao/tutanota-utils"
import { defer, downcast } from "@tutao/tutanota-utils"
import { handleUncaughtError } from "../../misc/ErrorHandler"
import type { MainInterface, WorkerInterface } from "../worker/WorkerImpl"
import { DelayedImpls, exposeLocalDelayed, exposeRemote } from "../common/WorkerProxy"
import type { RestClient } from "../worker/rest/RestClient"
import { EntropyDataChunk } from "../worker/facades/EntropyFacade.js"
import { objToError } from "../common/utils/ErrorUtils.js"
import { IMailLocator } from "../../../mail-app/mailLocator.js"
import { ICalendarLocator } from "../../../calendar-app/calendarLocator.js"

assertMainOrNode()

type ProgressUpdater = (progress: number) => unknown
type MainRequest = Request<MainRequestType>

export const enum WsConnectionState {
	connecting,
	connected,
	terminated,
}

export class WorkerClient {
	private _deferredInitialized: DeferredObject<void> = defer()
	private _isInitialized: boolean = false

	private _dispatcher!: MessageDispatcher<WorkerRequestType, MainRequestType>

	constructor() {
		this.initialized.then(() => {
			this._isInitialized = true
		})
	}

	get initialized(): Promise<void> {
		return this._deferredInitialized.promise
	}

	async init(mainInterfaced: MainInterfaces, uncaughtErrorHandler: (error: Error) => unknown): Promise<void> {
		if (env.mode !== "Test") {
			const { prefixWithoutFile } = window.tutao.appState
			// In apps/desktop we load HTML file and url ends on path/index.html so we want to load path/WorkerBootstrap.js.
			// In browser we load at domain.com or localhost/path (locally) and we want to load domain.com/WorkerBootstrap.js or
			// localhost/path/WorkerBootstrap.js respectively.
			// Service worker has similar logic but it has luxury of knowing that it's served as sw.js.
			const workerUrl = prefixWithoutFile + "/worker-bootstrap.js"
			const worker = new Worker(workerUrl)
			this._dispatcher = new MessageDispatcher(new WebWorkerTransport(worker), this.queueCommands(locator, appLocator), "main-worker")
			await this._dispatcher.postRequest(new Request("setup", [window.env, this.getInitialEntropy(), client.browserData()]))

			worker.onerror = (e: any) => {
				throw new Error(`could not setup worker: ${e.name} ${e.stack} ${e.message} ${e}`)
			}
		} else {
			// node: we do not use workers but connect the client and the worker queues directly with each other
			// attention: do not load directly with require() here because in the browser SystemJS would load the WorkerImpl in the client although this code is not executed
			// @ts-ignore
			const WorkerImpl = globalThis.testWorker
			const workerImpl = new WorkerImpl(this, true)
			await workerImpl.init(client.browserData())
			workerImpl._queue._transport = {
				postMessage: (msg: any) => this._dispatcher.handleMessage(msg),
			}
			this._dispatcher = new MessageDispatcher(
				{
					postMessage: function (msg: any) {
						workerImpl._queue.handleMessage(msg)
					},
				} as Transport<WorkerRequestType, MainRequestType>,
				this.queueCommands(locator, appLocator),
				"main-worker",
			)
		}

		this._deferredInitialized.resolve()
	}

	queueCommands(locator: IMainLocator, appLocator: IMailLocator | ICalendarLocator): Commands<MainRequestType> {
		return {
			execNative: (message: MainRequest) => appLocator.native.invokeNative(downcast(message.args[0]), downcast(message.args[1])),
			error: (message: MainRequest) => {
				this.uncaughtErrorHandler(objToError(message.args[0]))
				handleUncaughtError(
					objToError(message.args[0]),
					appLocator.commonSystemFacade,
					appLocator.interWindowEventSender,
					appLocator.search,
					appLocator.secondFactorHandler,
					appLocator.credentialsProvider,
				)
				return Promise.resolve()
			},
			facade: exposeLocalDelayed<DelayedImpls<MainInterface>, MainRequestType>({
				async loginListener() {
					return appLocator.loginListener
				},
				async wsConnectivityListener() {
					return locator.connectivityModel
				},
				async progressTracker() {
					return locator.progressTracker
				},
				async eventController() {
					return locator.eventController
				},
				async operationProgressTracker() {
					return locator.operationProgressTracker
				},
				async infoMessageHandler() {
					return appLocator.infoMessageHandler
				},
			}),
		}
	}

	getWorkerInterface(): WorkerInterface {
		return exposeRemote<WorkerInterface>(async (request) => this._postRequest(request))
	}

	restRequest(...args: Parameters<RestClient["request"]>): Promise<any | null> {
		return this._postRequest(new Request("restRequest", Array.from(arguments)))
	}

	/** @private visible for tests */
	async _postRequest(msg: Request<WorkerRequestType>): Promise<any> {
		await this.initialized
		return this._dispatcher.postRequest(msg)
	}

	reset(): Promise<void> {
		return this._postRequest(new Request("reset", []))
	}

	/**
	 * Add data from either secure random source or Math.random as entropy.
	 */
	private getInitialEntropy(): Array<EntropyDataChunk> {
		const valueList = new Uint32Array(16)
		crypto.getRandomValues(valueList)
		const entropy: Array<EntropyDataChunk> = []

		for (let i = 0; i < valueList.length; i++) {
			// 32 because we have 32-bit values Uint32Array
			entropy.push({
				source: "random",
				entropy: 32,
				data: valueList[i],
			})
		}

		return entropy
	}
}

export function bootstrapWorker(locator: IMainLocator, appLocator: IMailLocator | ICalendarLocator): WorkerClient {
	const worker = new WorkerClient()
	const start = Date.now()
	worker.init(locator, appLocator).then(() => console.log("worker init time (ms):", Date.now() - start))
	return worker
}
