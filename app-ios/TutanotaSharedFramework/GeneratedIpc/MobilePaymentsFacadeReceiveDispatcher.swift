/* generated file, don't edit. */


import Foundation

public class MobilePaymentsFacadeReceiveDispatcher {
	let facade: MobilePaymentsFacade
	init(facade: MobilePaymentsFacade) {
		self.facade = facade
	}
	func dispatch(method: String, arg: [String]) async throws -> String {
		switch method {
		case "requestSubscriptionToPlan":
			let plan = try! JSONDecoder().decode(String.self, from: arg[0].data(using: .utf8)!)
			let interval = try! JSONDecoder().decode(Int.self, from: arg[1].data(using: .utf8)!)
			let result = try await self.facade.requestSubscriptionToPlan(
				plan,
				interval
			)
			return toJson(result)
		default:
			fatalError("licc messed up! \(method)")
		}
	}
}