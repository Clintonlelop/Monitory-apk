package com.devicemanager.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Represents an event (telemetry, location, notification, etc.) that failed to
 * upload due to network issues and is queued for retry by SyncWorker.
 *
 * Deduplication: unique key is based on eventType + timestamp + payload hash.
 */
@Entity(
    tableName = "queued_events",
    indices = [Index(value = ["dedupKey"], unique = true)]
)
data class QueuedEvent(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val eventType: String,
    val endpoint: String,
    val payloadJson: String,
    val dedupKey: String,
    val createdAt: Long,
    val retryCount: Int = 0,
    val lastError: String? = null
)
