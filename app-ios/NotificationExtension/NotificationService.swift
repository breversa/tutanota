import UserNotifications

class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        if let bestAttemptContent = bestAttemptContent {
			let mailId = bestAttemptContent.userInfo["mailId"] as? [String]
			let userId = bestAttemptContent.userInfo["userId"] as? String

			let credentialsDb = try! CredentialsDatabase(db: SqliteDb())
			let record = try! credentialsDb.getAll().first {
				$0.credentialInfo.userId == userId
			}

            // Modify the notification content here...
			bestAttemptContent.title = "mailId: \(mailId?.joined(separator: ", ") ?? ""), accessToken: \(record?.accessToken ?? "")"

            contentHandler(bestAttemptContent)
        }
    }
    
    override func serviceExtensionTimeWillExpire() {
        // Called just before the extension will be terminated by the system.
        // Use this as an opportunity to deliver your "best attempt" at modified content, otherwise the original push payload will be used.
        if let contentHandler = contentHandler, let bestAttemptContent =  bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

}
