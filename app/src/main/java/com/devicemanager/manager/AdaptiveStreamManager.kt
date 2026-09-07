package com.devicemanager.manager

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.RandomAccessFile

/**
 * Adaptive stream quality manager for remote screen control.
 *
 * Monitors network latency, device temperature, CPU load, and battery level
 * to dynamically adjust JPEG quality, frame interval, and capture resolution.
 *
 * Adaptive logic:
 * - latency > 200ms: reduce quality by 10, reduce FPS target by 5
 * - latency > 500ms: reduce quality to 40, cap FPS at 15
 * - battery temp > 40°C: reduce FPS by 10, reduce quality by 10
 * - battery < 20%: cap FPS at 15, quality at 50
 * - latency < 50ms for 5s: gradually increase quality/FPS up to target
 *
 * Low-latency mode:
 * - Minimum buffering, send frame immediately after capture
 * - Process INPUT_EVENT within 16ms of receipt
 * - Dynamic bitrate starting at 2Mbps
 * - Vsync-aligned capture via Choreographer
 * - Reduce JPEG quality to maintain <100ms end-to-end latency
 */
class AdaptiveStreamManager(private val context: Context) {
    companion object {
        private const val TAG = "AdaptiveStreamManager"

        const val MIN_QUALITY = 10
        const val MAX_QUALITY = 100
        const val MIN_FRAME_INTERVAL_MS = 100L  // ~10 FPS min
        const val MAX_FRAME_INTERVAL_MS = 1000L // ~1 FPS max

        // Quality presets
        const val QUALITY_LOW = 40
        const val QUALITY_MEDIUM = 70
        const val QUALITY_HIGH = 90

        // Latency thresholds
        const val LATENCY_GOOD_MS = 50
        const val LATENCY_FAIR_MS = 200
        const val LATENCY_POOR_MS = 500

        // Thermal thresholds
        const val TEMP_THRESHOLD_C = 40.0f

        // Battery threshold
        const val BATTERY_LOW_THRESHOLD = 20

        // Adaptive evaluation interval
        private const val EVAL_INTERVAL_MS = 2000L
        private const val QUALITY_REPORT_INTERVAL_MS = 2000L
        private const val LOW_LATENCY_GOOD_DURATION_MS = 5000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var evalJob: Job? = null
    private var reportJob: Job? = null

    // Target settings (from dashboard)
    @Volatile var targetFps: Int = 30
        private set
    @Volatile var targetQuality: Int = QUALITY_MEDIUM
        private set
    @Volatile var lowLatencyMode: Boolean = false
        private set

    // Current adaptive settings
    @Volatile var currentQuality: Int = QUALITY_MEDIUM
        private set
    @Volatile var currentFrameIntervalMs: Long = 1000L / 30
        private set
    @Volatile var currentResolutionScale: Float = 1.0f
        private set

    // Metrics
    @Volatile var currentLatencyMs: Long = 0
        private set
    @Volatile var currentJitterMs: Long = 0
        private set
    @Volatile var currentPacketLossPct: Float = 0f
        private set
    @Volatile var currentFps: Int = 0
        private set
    @Volatile var currentBitrateKbps: Int = 0
        private set
    @Volatile var currentNetworkType: String = "UNKNOWN"
        private set
    @Volatile var inputInjectionLatencyMs: Long = 0
        private set

    // Tracking for gradual increase
    private var goodLatencySinceMs: Long = 0
    private var lastAdjustmentReason: String = ""

    // Callback for quality reports
    var onQualityReport: ((QualityReport) -> Unit)? = null

    // Frame tracking for FPS calculation
    private val frameTimestamps = mutableListOf<Long>()
    private val latencySamples = mutableListOf<Long>()

    data class QualityReport(
        val latencyMs: Long,
        val jitterMs: Long,
        val packetLossPct: Float,
        val fps: Int,
        val resolution: String,
        val bitrateKbps: Int,
        val networkType: String,
        val quality: Int,
        val frameIntervalMs: Long,
        val lowLatency: Boolean,
        val adjustmentReason: String,
        val inputLatencyMs: Long,
        val batteryTemp: Float,
        val batteryLevel: Int,
        val cpuLoad: Float
    )

    /**
     * Start adaptive monitoring.
     */
    fun start(targetFps: Int = 30, targetQuality: Int = QUALITY_MEDIUM, lowLatency: Boolean = false) {
        this.targetFps = targetFps
        this.targetQuality = targetQuality.coerceIn(MIN_QUALITY, MAX_QUALITY)
        this.lowLatencyMode = lowLatency
        this.currentQuality = this.targetQuality
        this.currentFrameIntervalMs = (1000L / targetFps).coerceIn(MIN_FRAME_INTERVAL_MS, MAX_FRAME_INTERVAL_MS)
        this.currentResolutionScale = 1.0f
        this.goodLatencySinceMs = 0
        this.lastAdjustmentReason = "Initialized"

        startEvaluationLoop()
        startReportLoop()
        Log.d(TAG, "Adaptive stream started: targetFps=$targetFps, targetQuality=$targetQuality, lowLatency=$lowLatency")
    }

    /**
     * Stop adaptive monitoring.
     */
    fun stop() {
        evalJob?.cancel()
        reportJob?.cancel()
        evalJob = null
        reportJob = null
        frameTimestamps.clear()
        latencySamples.clear()
        Log.d(TAG, "Adaptive stream stopped")
    }

    /**
     * Update target settings from dashboard STREAM_CONTROL.
     */
    fun updateTargets(targetFps: Int?, targetQuality: Int?, lowLatency: Boolean?) {
        targetFps?.let {
            this.targetFps = it.coerceIn(1, 60)
            if (currentFrameIntervalMs > 1000L / this.targetFps) {
                currentFrameIntervalMs = 1000L / this.targetFps
            }
        }
        targetQuality?.let {
            this.targetQuality = it.coerceIn(MIN_QUALITY, MAX_QUALITY)
        }
        lowLatency?.let {
            this.lowLatencyMode = it
        }
        Log.d(TAG, "Targets updated: fps=${this.targetFps}, quality=${this.targetQuality}, lowLatency=${this.lowLatencyMode}")
    }

    /**
     * Record a frame was sent (for FPS calculation).
     */
    fun recordFrameSent(sizeBytes: Int) {
        val now = System.currentTimeMillis()
        frameTimestamps.add(now)
        // Keep only last 2 seconds
        while (frameTimestamps.isNotEmpty() && now - frameTimestamps.first() > 2000) {
            frameTimestamps.removeAt(0)
        }
        currentFps = if (frameTimestamps.size > 1) {
            val elapsed = (now - frameTimestamps.first()) / 1000.0
            if (elapsed > 0) (frameTimestamps.size / elapsed).toInt() else frameTimestamps.size
        } else 0

        // Estimate bitrate (bytes in last 2 seconds)
        currentBitrateKbps = if (frameTimestamps.size > 1) {
            val elapsed = (now - frameTimestamps.first()) / 1000.0
            if (elapsed > 0) ((sizeBytes * 8 * frameTimestamps.size / elapsed) / 1000).toInt() else 0
        } else 0
    }

    /**
     * Record a latency measurement (ping/pong round-trip).
     */
    fun recordLatency(latencyMs: Long) {
        currentLatencyMs = latencyMs
        latencySamples.add(latencyMs)
        while (latencySamples.size > 10) latencySamples.removeAt(0)

        // Calculate jitter (variance)
        if (latencySamples.size >= 2) {
            val mean = latencySamples.average()
            val variance = latencySamples.map { (it - mean) * (it - mean) }.average()
            currentJitterMs = Math.sqrt(variance).toLong()
        }
    }

    /**
     * Record packet loss percentage.
     */
    fun recordPacketLoss(pct: Float) {
        currentPacketLossPct = pct
    }

    /**
     * Record network type.
     */
    fun recordNetworkType(type: String) {
        currentNetworkType = type
    }

    /**
     * Record input injection latency.
     */
    fun recordInputLatency(latencyMs: Long) {
        inputInjectionLatencyMs = latencyMs
    }

    /**
     * Get the effective frame interval, considering low-latency mode.
     * In low-latency mode, frames are sent immediately (interval is advisory).
     */
    fun getEffectiveFrameIntervalMs(): Long {
        return if (lowLatencyMode) {
            // In low-latency mode, use vsync-aligned capture (~16ms)
            currentFrameIntervalMs.coerceAtMost(16L)
        } else {
            currentFrameIntervalMs
        }
    }

    /**
     * Check if a frame should be sent now based on current interval.
     */
    fun shouldSendFrame(lastFrameMs: Long): Boolean {
        return System.currentTimeMillis() - lastFrameMs >= getEffectiveFrameIntervalMs()
    }

    /**
     * Get network quality classification.
     */
    fun getNetworkQuality(): NetworkQuality {
        return when {
            currentLatencyMs < LATENCY_GOOD_MS && currentJitterMs < 20 && currentPacketLossPct < 1f -> NetworkQuality.EXCELLENT
            currentLatencyMs < LATENCY_FAIR_MS && currentJitterMs < 50 && currentPacketLossPct < 3f -> NetworkQuality.GOOD
            currentLatencyMs < LATENCY_POOR_MS && currentPacketLossPct < 5f -> NetworkQuality.FAIR
            else -> NetworkQuality.POOR
        }
    }

    enum class NetworkQuality {
        EXCELLENT, GOOD, FAIR, POOR
    }

    // ── Adaptive evaluation loop ─────────────────────────────────────

    private fun startEvaluationLoop() {
        evalJob?.cancel()
        evalJob = scope.launch {
            while (true) {
                delay(EVAL_INTERVAL_MS)
                evaluateAndAdjust()
            }
        }
    }

    private fun startReportLoop() {
        reportJob?.cancel()
        reportJob = scope.launch {
            while (true) {
                delay(QUALITY_REPORT_INTERVAL_MS)
                emitQualityReport()
            }
        }
    }

    private fun evaluateAndAdjust() {
        val latency = currentLatencyMs
        val batteryInfo = getBatteryInfo()
        val cpuLoad = getCpuLoad()
        var adjusted = false
        var reason = ""

        // Low-latency mode: aggressive quality reduction to maintain <100ms
        if (lowLatencyMode && latency > 100) {
            val reduction = ((latency - 100) / 50).toInt().coerceAtMost(20)
            val newQuality = (currentQuality - reduction).coerceAtLeast(MIN_QUALITY)
            if (newQuality != currentQuality) {
                Log.d(TAG, "Low-latency adjust: quality $currentQuality -> $newQuality (latency=${latency}ms)")
                currentQuality = newQuality
                reason = "Low-latency: reduced quality (latency ${latency}ms > 100ms)"
                adjusted = true
            }
        }

        // High latency > 500ms: severe reduction
        if (latency > LATENCY_POOR_MS) {
            if (currentQuality > 40) {
                Log.d(TAG, "Poor latency: quality $currentQuality -> 40")
                currentQuality = 40
                reason = "Reduced quality: very high latency (${latency}ms)"
                adjusted = true
            }
            val maxInterval = 1000L / 15
            if (currentFrameIntervalMs < maxInterval) {
                currentFrameIntervalMs = maxInterval
                reason = "Capped FPS at 15: very high latency (${latency}ms)"
                adjusted = true
            }
        }
        // High latency > 200ms: moderate reduction
        else if (latency > LATENCY_FAIR_MS) {
            val newQuality = (currentQuality - 10).coerceAtLeast(MIN_QUALITY)
            if (newQuality != currentQuality && !adjusted) {
                Log.d(TAG, "Fair latency: quality $currentQuality -> $newQuality")
                currentQuality = newQuality
                reason = "Reduced quality: high latency (${latency}ms)"
                adjusted = true
            }
            // Reduce FPS target by 5
            val newInterval = (currentFrameIntervalMs + (1000L / 5)).coerceAtMost(MAX_FRAME_INTERVAL_MS)
            if (newInterval != currentFrameIntervalMs) {
                currentFrameIntervalMs = newInterval
                if (reason.isEmpty()) reason = "Reduced FPS: high latency (${latency}ms)"
                adjusted = true
            }
        }
        // Good latency for sustained period: gradually increase
        else if (latency < LATENCY_GOOD_MS) {
            if (goodLatencySinceMs == 0L) {
                goodLatencySinceMs = System.currentTimeMillis()
            }
            val goodDuration = System.currentTimeMillis() - goodLatencySinceMs
            if (goodDuration >= LOW_LATENCY_GOOD_DURATION_MS) {
                // Gradually increase quality toward target
                if (currentQuality < targetQuality) {
                    currentQuality = (currentQuality + 5).coerceAtMost(targetQuality)
                    reason = "Increased quality: stable low latency (${latency}ms)"
                    adjusted = true
                }
                // Gradually increase FPS toward target
                val targetInterval = 1000L / targetFps
                if (currentFrameIntervalMs > targetInterval) {
                    currentFrameIntervalMs = (currentFrameIntervalMs - 10).coerceAtLeast(targetInterval)
                    if (reason.isEmpty()) reason = "Increased FPS: stable low latency (${latency}ms)"
                    adjusted = true
                }
                // Reset resolution scale if it was reduced
                if (currentResolutionScale < 1.0f) {
                    currentResolutionScale = (currentResolutionScale + 0.1f).coerceAtMost(1.0f)
                }
            }
        } else {
            goodLatencySinceMs = 0
        }

        // Thermal throttling
        if (batteryInfo.temperature > TEMP_THRESHOLD_C) {
            val newInterval = (currentFrameIntervalMs + (1000L / 10)).coerceAtMost(MAX_FRAME_INTERVAL_MS)
            if (newInterval != currentFrameIntervalMs) {
                currentFrameIntervalMs = newInterval
                reason = "Reduced FPS: high temperature (${batteryInfo.temperature}°C)"
                adjusted = true
            }
            val newQuality = (currentQuality - 10).coerceAtLeast(MIN_QUALITY)
            if (newQuality != currentQuality) {
                currentQuality = newQuality
                if (reason.isEmpty()) reason = "Reduced quality: high temperature (${batteryInfo.temperature}°C)"
                adjusted = true
            }
        }

        // Low battery
        if (batteryInfo.level in 1..BATTERY_LOW_THRESHOLD && !batteryInfo.isCharging) {
            val maxInterval = 1000L / 15
            if (currentFrameIntervalMs < maxInterval) {
                currentFrameIntervalMs = maxInterval
                reason = "Capped FPS at 15: low battery (${batteryInfo.level}%)"
                adjusted = true
            }
            if (currentQuality > 50) {
                currentQuality = 50
                if (reason.isEmpty()) reason = "Capped quality at 50: low battery (${batteryInfo.level}%)"
                adjusted = true
            }
        }

        // High CPU load: reduce resolution
        if (cpuLoad > 0.8f) {
            if (currentResolutionScale > 0.5f) {
                currentResolutionScale = (currentResolutionScale - 0.1f).coerceAtLeast(0.5f)
                reason = "Reduced resolution: high CPU load (${(cpuLoad * 100).toInt()}%)"
                adjusted = true
            }
        }

        if (adjusted) {
            lastAdjustmentReason = reason
            Log.d(TAG, "Adaptive adjustment: $reason | quality=$currentQuality, interval=${currentFrameIntervalMs}ms, scale=$currentResolutionScale")
        }
    }

    private fun emitQualityReport() {
        val batteryInfo = getBatteryInfo()
        val cpuLoad = getCpuLoad()
        val resolution = if (currentResolutionScale < 1.0f) {
            "scaled ${(currentResolutionScale * 100).toInt()}%"
        } else {
            "native"
        }

        val report = QualityReport(
            latencyMs = currentLatencyMs,
            jitterMs = currentJitterMs,
            packetLossPct = currentPacketLossPct,
            fps = currentFps,
            resolution = resolution,
            bitrateKbps = currentBitrateKbps,
            networkType = currentNetworkType,
            quality = currentQuality,
            frameIntervalMs = currentFrameIntervalMs,
            lowLatency = lowLatencyMode,
            adjustmentReason = lastAdjustmentReason,
            inputLatencyMs = inputInjectionLatencyMs,
            batteryTemp = batteryInfo.temperature,
            batteryLevel = batteryInfo.level,
            cpuLoad = cpuLoad
        )

        onQualityReport?.invoke(report)
    }

    // ── System metrics helpers ───────────────────────────────────────

    private fun getBatteryInfo(): BatteryInfo {
        return try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus = context.registerReceiver(null, filter)
            val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val temp = batteryStatus?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0

            val batteryPct = if (level != -1 && scale != -1) {
                (level * 100 / scale.toFloat()).toInt()
            } else 0

            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL

            BatteryInfo(batteryPct, isCharging, temp / 10.0f)
        } catch (e: Exception) {
            Log.e(TAG, "Battery info error: ${e.message}", e)
            BatteryInfo(0, false, 0f)
        }
    }

    private data class BatteryInfo(
        val level: Int,
        val isCharging: Boolean,
        val temperature: Float
    )

    /**
     * Read CPU load from /proc/stat.
     * Returns 0.0 - 1.0 representing overall CPU utilization.
     */
    private fun getCpuLoad(): Float {
        return try {
            val reader = RandomAccessFile("/proc/stat", "r")
            val line = reader.readLine()
            reader.close()

            // cpu  user nice system idle iowait irq softirq steal guest guest_nice
            val parts = line.split("\\s+".toRegex())
            if (parts.size < 5) return 0f

            val user = parts[1].toLongOrNull() ?: 0
            val nice = parts[2].toLongOrNull() ?: 0
            val system = parts[3].toLongOrNull() ?: 0
            val idle = parts[4].toLongOrNull() ?: 0
            val iowait = if (parts.size > 5) parts[5].toLongOrNull() ?: 0 else 0
            val irq = if (parts.size > 6) parts[6].toLongOrNull() ?: 0 else 0
            val softirq = if (parts.size > 7) parts[7].toLongOrNull() ?: 0 else 0

            val total = user + nice + system + idle + iowait + irq + softirq
            val busy = total - idle

            if (total > 0) (busy.toFloat() / total.toFloat()) else 0f
        } catch (e: Exception) {
            Log.e(TAG, "CPU load error: ${e.message}", e)
            0f
        }
    }
}
