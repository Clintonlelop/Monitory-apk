package com.devicemanager.manager

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import android.util.Log
import com.devicemanager.data.remote.model.UsageEntry
import com.devicemanager.util.Extensions
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Wrapper around UsageStatsManager for app usage statistics.
 *
 * Checks if usage access is granted via AppOpsManager.
 * Maps package names to app names using PackageManager.
 * Queries daily and weekly intervals.
 */
class UsageStatsCollector(private val context: Context) {
    companion object {
        private const val TAG = "UsageStatsCollector"
    }

    /**
     * Check if usage access permission is granted.
     */
    fun hasUsageAccess(): Boolean {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            }
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Collect daily usage stats for all apps.
     */
    fun collectDailyUsage(): List<UsageEntry> {
        if (!hasUsageAccess()) {
            Log.w(TAG, "Usage access not granted")
            return emptyList()
        }

        return try {
            val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

            val calendar = Calendar.getInstance()
            calendar.set(Calendar.HOUR_OF_DAY, 0)
            calendar.set(Calendar.MINUTE, 0)
            calendar.set(Calendar.SECOND, 0)
            calendar.set(Calendar.MILLISECOND, 0)
            val startTime = calendar.timeInMillis
            val endTime = System.currentTimeMillis()

            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startTime,
                endTime
            )

            val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            val today = dateFormat.format(Date())

            stats.filter { it.totalTimeInForeground > 0 }
                .sortedByDescending { it.totalTimeInForeground }
                .map { usageStat ->
                    UsageEntry(
                        packageName = usageStat.packageName,
                        appName = Extensions.getAppName(context, usageStat.packageName),
                        usageSeconds = usageStat.totalTimeInForeground / 1000,
                        lastUsed = usageStat.lastTimeUsed,
                        date = today
                    )
                }
        } catch (e: Exception) {
            Log.e(TAG, "Collect daily usage error: ${e.message}", e)
            emptyList()
        }
    }

    /**
     * Collect weekly usage stats for all apps.
     */
    fun collectWeeklyUsage(): List<UsageEntry> {
        if (!hasUsageAccess()) {
            Log.w(TAG, "Usage access not granted")
            return emptyList()
        }

        return try {
            val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

            val calendar = Calendar.getInstance()
            calendar.add(Calendar.DAY_OF_YEAR, -7)
            val startTime = calendar.timeInMillis
            val endTime = System.currentTimeMillis()

            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_WEEKLY,
                startTime,
                endTime
            )

            val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            val today = dateFormat.format(Date())

            // Aggregate by package name across the week
            val aggregated = mutableMapOf<String, UsageStats>()
            for (stat in stats) {
                val existing = aggregated[stat.packageName]
                if (existing == null) {
                    aggregated[stat.packageName] = stat
                } else {
                    existing.totalTimeInForeground += stat.totalTimeInForeground
                    if (stat.lastTimeUsed > existing.lastTimeUsed) {
                        existing.lastTimeUsed = stat.lastTimeUsed
                    }
                }
            }

            aggregated.values
                .filter { it.totalTimeInForeground > 0 }
                .sortedByDescending { it.totalTimeInForeground }
                .map { usageStat ->
                    UsageEntry(
                        packageName = usageStat.packageName,
                        appName = Extensions.getAppName(context, usageStat.packageName),
                        usageSeconds = usageStat.totalTimeInForeground / 1000,
                        lastUsed = usageStat.lastTimeUsed,
                        date = today
                    )
                }
        } catch (e: Exception) {
            Log.e(TAG, "Collect weekly usage error: ${e.message}", e)
            emptyList()
        }
    }
}
