package com.example.telemetry

import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import com.example.data.model.AppInfoData
import com.example.data.model.UsageData
import java.util.Calendar

class AppInventoryHelper(private val context: Context) {

    fun getInstalledApplications(): List<AppInfoData> {
        val pm = context.packageManager
        val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
        } else {
            pm.getInstalledPackages(0)
        }

        return packages.mapNotNull { pkg ->
            try {
                val appInfo = pkg.applicationInfo ?: return@mapNotNull null
                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val label = pm.getApplicationLabel(appInfo).toString()
                val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    pkg.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    pkg.versionCode.toLong()
                }

                AppInfoData(
                    packageName = pkg.packageName,
                    appName = label,
                    versionName = pkg.versionName ?: "1.0",
                    versionCode = versionCode,
                    isSystemApp = isSystem,
                    firstInstallTime = pkg.firstInstallTime,
                    lastUpdateTime = pkg.lastUpdateTime
                )
            } catch (_: Exception) {
                null
            }
        }.sortedBy { it.appName.lowercase() }
    }
}

class UsageStatsHelper(private val context: Context) {

    fun getAppUsageStats(): List<UsageData> {
        val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyList()

        val calendar = Calendar.getInstance()
        val endTime = calendar.timeInMillis
        calendar.add(Calendar.DAY_OF_YEAR, -1) // Past 24 hours
        val startTime = calendar.timeInMillis

        val usageStatsList = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startTime,
            endTime
        ) ?: return emptyList()

        val pm = context.packageManager
        return usageStatsList
            .filter { it.totalTimeInForeground > 0 }
            .map { stats ->
                val appName = try {
                    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        pm.getApplicationInfo(stats.packageName, PackageManager.ApplicationInfoFlags.of(0))
                    } else {
                        pm.getApplicationInfo(stats.packageName, 0)
                    }
                    pm.getApplicationLabel(info).toString()
                } catch (_: Exception) {
                    stats.packageName
                }
                UsageData(
                    packageName = stats.packageName,
                    appName = appName,
                    totalTimeInForegroundMs = stats.totalTimeInForeground,
                    lastTimeUsed = stats.lastTimeUsed
                )
            }
            .sortedByDescending { it.totalTimeInForegroundMs }
    }
}
