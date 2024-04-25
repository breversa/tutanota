package de.tutao.tutanota.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity
class KeyBlob(@field:PrimaryKey val key: String, val value: ByteArray?)