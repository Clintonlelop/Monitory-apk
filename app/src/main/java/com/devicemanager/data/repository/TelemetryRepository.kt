package com.devicemanager.data.repository

import android.util.Log
import com.devicemanager.data.local.dao.EventQueueDao
import com.devicemanager.data.local.entity.QueuedEvent
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.model.TelemetryRequest
import com.devicemanager.util.Constants
import com.devicemanager.util.Preferences
import com.google.gson.Gson

/**
 * Repository for telemetry data collection and upload.
 * Handles offline queueing when network is unavailable.
 */
class TelemetryRepository(
    private val apiService: ApiService,
    private val eventQueueDao: EventQueueDao,
    private val preferences: Preferences,
    private val gson: Gson
) {
    companion object {
        private const val TAG = "TelemetryRepository"
    }

    /**
     * Send telemetry data to the server. Falls back to offline queue on failure.
     */
    suspend fun sendTelemetry(request: TelemetryRequest): Result<Unit> {
        return try {
            val deviceId = preferences.deviceId
            val response = apiService.sendTelemetry(deviceId, request)
            if (response.isSuccessful) {
                preferences.lastTelemetryTime = System.currentTimeMillis()
                Result.success(Unit)
            } else {
                queueForRetry(request)
                Result.failure(Exception("Telemetry upload failed: HTTP ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry upload error: ${e.message}", e)
            queueForRetry(request)
            Result.failure(e)
        }
    }

    /**
     * Queue telemetry event for later retry.
     */
    private suspend fun queueForRetry(request: TelemetryRequest) {
        try {
            val json = gson.toJson(request)
            val event = QueuedEvent(
                eventType = "TELEMETRY",
                endpoint = Constants.API_TELEMETRY,
                payloadJson = json,
                dedupKey = "telemetry_${System.currentTimeMillis()}",
                createdAt = System.currentTimeMillis()
            )
            eventQueueDao.insert(event)
            Log.d(TAG, "Telemetry queued for retry")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to queue telemetry: ${e.message}", e)
        }
    }
}
