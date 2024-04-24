package de.tutao.tutanota.credentials

import androidx.room.Entity
import androidx.room.PrimaryKey
import de.tutao.tutanota.CredentialType
import de.tutao.tutanota.ipc.CredentialsInfo
import de.tutao.tutanota.ipc.PersistedCredentials
import de.tutao.tutanota.ipc.wrap

@Entity(tableName = "PersistedCredentials")
class PersistedCredentialsEntity(
	val accessToken: ByteArray,
	val databaseKey: ByteArray?,
	val encryptedPassword: String,
	// CredentialsInfo. Cannot use userId as @primarykey if it is @Embedded.
	val login: String,
	@PrimaryKey val userId: String,
	val type: CredentialType,
)


fun PersistedCredentials.toEntity(): PersistedCredentialsEntity {
	return PersistedCredentialsEntity(
		accessToken = accessToken.data,
		databaseKey = databaseKey?.data,
		encryptedPassword = encryptedPassword,
		login = credentialInfo.login,
		userId = credentialInfo.userId,
		type = credentialInfo.type,
	)
}

fun PersistedCredentialsEntity.toObject(): PersistedCredentials {
	val credentialInfo = CredentialsInfo(
		login = login, userId = userId, type = type
	)
	return PersistedCredentials(
		accessToken = accessToken.wrap(),
		databaseKey = databaseKey?.wrap(),
		encryptedPassword = encryptedPassword,
		credentialInfo = credentialInfo,
	)
}
