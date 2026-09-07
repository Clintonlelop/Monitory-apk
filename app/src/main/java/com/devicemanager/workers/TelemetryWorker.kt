package com.devicemanager.workers

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.devicemanager.DeviceManagerApp
import com.devicemanager.manager.TelemetryCollector

/**
 * Periodic telemetry upload worker.
 *
 * Collects battery, network, storage, and RAM telemetry and sends to server.
 * Runs every 15 minutes (minimum WorkManager interval).
 */
class TelemetryWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "TelemetryWorker"
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "Running telemetry worker")

        return try {
            val app = applicationContext as DeviceManagerApp
            val collector = TelemetryCollector(applicationContext)
            val telemetry = collector.collect()

            val result = app.telemetryRepository.sendTelemetry(telemetry)
            if (result.isSuccess) {
                Log.d(TAG, "Telemetry uploaded successfully")
                Result.success()
            } else {
                Log.w(TAG, "Telemetry upload failed: ${result.exceptionOrNull()?.message}")
                // Event is queued for retry by the repository
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry worker error: ${e.message}", e)
            Result.retry()
        }
    }
}
