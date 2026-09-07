package com.devicemanager.data.repository

import android.util.Log
import com.devicemanager.data.local.dao.EventQueueDao
import com.devicemanager.data.local.entity.QueuedEvent
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.model.LocationRequest
import com.devicemanager.util.Constants
import com.devicemanager.util.Preferences
import com.google.gson.Gson

/**
 * Repository for location data upload.
 * Handles offline queueing when network is unavailable.
 *
 * NOTE: Geofencing is evaluated server-side. This client only sends raw
 * location data; no Google Play Services Geofencing API is used.
 */
class LocationRepository(
    private val apiService: ApiService,
    private val eventQueueDao: EventQueueDao,
    private val preferences: Preferences,
    private val gson: Gson
) {
    companion object {
        private const val TAG = "LocationRepository"
    }

    /**
     * Send location data to the server. Falls back to offline queue on failure.
     */
    suspend fun sendLocation(request: LocationRequest): Result<Unit> {
        return try {
            val deviceId = preferences.deviceId
            val response = apiService.sendLocation(deviceId, request)
            if (response.isSuccessful) {
                preferences.lastLocationTime = System.currentTimeMillis()
                Result.success(Unit)
            } else {
                queueForRetry(request)
                Result.failure(Exception("Location upload failed: HTTP ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Location upload error: ${e.message}", e)
            queueForRetry(request)
            Result.failure(e)
        }
    }

    /**
     * Queue location event for later retry.
     */
    private suspend fun queueForRetry(request: LocationRequest) {
        try {
            val json = gson.toJson(request)
            val event = QueuedEvent(
                eventType = "LOCATION",
                endpoint = Constants.API_LOCATIONS,
                payloadJson = json,
                dedupKey = "location_${request.timestamp}",
                createdAt = System.currentTimeMillis()
            )
            eventQueueDao.insert(event)
            Log.d(TAG, "Location queued for retry")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to queue location: ${e.message}", e)
        }
    }
}
