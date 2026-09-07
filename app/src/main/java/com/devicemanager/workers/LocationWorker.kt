package com.devicemanager.workers

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.devicemanager.DeviceManagerApp
import com.devicemanager.manager.LocationManager

/**
 * Periodic location upload worker.
 *
 * Gets current location using FusedLocationProvider and sends to server.
 * Runs every 30 minutes.
 * Checks permission before accessing and reports denied state.
 */
class LocationWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "LocationWorker"
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "Running location worker")

        return try {
            val app = applicationContext as DeviceManagerApp
            val locationManager = LocationManager(applicationContext)

            if (!locationManager.hasPermission()) {
                Log.w(TAG, "Location permission not granted, skipping")
                return Result.success() // Don't retry if permission denied
            }

            val location = locationManager.getCurrentLocation()
            if (location == null) {
                Log.w(TAG, "Could not obtain location")
                return Result.retry()
            }

            val result = app.locationRepository.sendLocation(location)
            if (result.isSuccess) {
                Log.d(TAG, "Location uploaded successfully")
                Result.success()
            } else {
                Log.w(TAG, "Location upload failed: ${result.exceptionOrNull()?.message}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Location worker error: ${e.message}", e)
            Result.retry()
        }
    }
}
