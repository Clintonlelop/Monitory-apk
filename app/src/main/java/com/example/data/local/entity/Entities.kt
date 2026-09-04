package com.example.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_events")
data class OfflineEventEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val eventType: String, // "TELEMETRY", "LOCATION", "NOTIFICATION"
    val payloadJson: String,
    val timestamp: Long = System.currentTimeMillis(),
    val attempts: Int = 0
)

@Entity(tableName = "command_history")
data class CommandEntity(
    @PrimaryKey
    val commandId: String,
    val deviceId: String,
    val commandType: String,
    val parametersJson: String?,
    val status: String,
    val result: String?,
    val errorMessage: String?,
    val timestamp: Long,
    val completionTimestamp: Long?
)
