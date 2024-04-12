/* generated file, don't edit. */


package de.tutao.tutanota.ipc

import kotlinx.serialization.*
import kotlinx.serialization.json.*

@Serializable
enum class ExtendedNotificationMode {
	@SerialName("0")
	NO_SENDER_OR_SUBJECT,
	
	@SerialName("1")
	ONLY_SENDER,
	
	@SerialName("2")
	SENDER_AND_SUBJECT;
}
