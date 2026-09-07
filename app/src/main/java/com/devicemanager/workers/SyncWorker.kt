package com.devicemanager.workers

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.devicemanager.DeviceManagerApp

/**
 * Offline queue sync worker.
 *
 * Retries queued events when network is available.
 * Runs every 15 minutes.
 * Processes events in FIFO order with retry limits.
 *
 * Enhanced with:
 * - Dedup verification: checks server for existing records before re-uploading
 * - Conflict handling: if server has newer data, don't overwrite
 * - Batch flush: sends multiple queued events in sequence when possible
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "SyncWorker"
        private const val BATCH_SIZE = 20
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "Running sync worker")

        return try {
            val app = applicationContext as DeviceManagerApp
            val queueSize = app.syncRepository.getQueueSize()

            if (queueSize == 0) {
                Log.d(TAG, "No queued events to sync")
                return Result.success()
            }

            Log.d(TAG, "Syncing $queueSize queued events (batch size: $BATCH_SIZE)")

            // Process in batches to avoid long-running blocks
            var totalSynced = 0
            var remaining = queueSize

            while (remaining > 0) {
                val batchCount = minOf(BATCH_SIZE, remaining)
                val synced = app.syncRepository.syncQueuedEventsBatch(batchCount)
                totalSynced += synced

                // If nothing was synced in this batch, stop (likely network issue)
                if (synced == 0) {
                    Log.w(TAG, "No events synced in batch — stopping, will retry later")
                    break
                }

                remaining = app.syncRepository.getQueueSize()
                Log.d(TAG, "Batch synced: $synced, remaining: $remaining")
            }

            Log.d(TAG, "Synced $totalSynced events total")
            app.preferences.lastSyncTime = System.currentTimeMillis()

            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Sync worker error: ${e.message}", e)
            Result.retry()
        }
    }
}
