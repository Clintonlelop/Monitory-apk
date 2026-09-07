package com.devicemanager.workers

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.devicemanager.DeviceManagerApp
import com.devicemanager.data.remote.model.UsageRequest
import com.devicemanager.manager.UsageStatsCollector

/**
 * Periodic usage stats upload worker.
 *
 * Collects app usage statistics via UsageStatsManager and sends to server.
 * Runs every 6 hours.
 * Checks if usage access is granted before collecting.
 */
class UsageStatsWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "UsageStatsWorker"
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "Running usage stats worker")

        return try {
            val app = applicationContext as DeviceManagerApp
            val collector = UsageStatsCollector(applicationContext)

            if (!collector.hasUsageAccess()) {
                Log.w(TAG, "Usage access not granted, skipping")
                return Result.success() // Don't retry if permission denied
            }

            val usage = collector.collectDailyUsage()
            if (usage.isEmpty()) {
                Log.d(TAG, "No usage data to send")
                return Result.success()
            }

            val request = UsageRequest(usage = usage)
            val deviceId = app.preferences.deviceId
            val response = app.apiService.sendUsageStats(deviceId, request)

            if (response.isSuccessful) {
                Log.d(TAG, "Usage stats uploaded: ${usage.size} apps")
                Result.success()
            } else {
                Log.w(TAG, "Usage stats upload failed: HTTP ${response.code()}")
                app.syncRepository.queueEvent(
                    "USAGE",
                    "/api/usage",
                    request,
                    "usage_${System.currentTimeMillis()}"
                )
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Usage stats worker error: ${e.message}", e)
            Result.retry()
        }
    }
}
