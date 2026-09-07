package com.devicemanager.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Represents a command received from the server that has not yet been executed.
 * Used for offline command persistence — commands are stored here when received
 * and removed after execution (or marked as processed).
 */
@Entity(tableName = "pending_commands")
data class PendingCommand(
    @PrimaryKey
    val commandId: String,
    val type: String,
    val payloadJson: String?,
    val receivedAt: Long,
    val status: String = "PENDING",
    val retryCount: Int = 0
)
