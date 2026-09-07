package com.devicemanager.manager

import android.content.Context
import android.util.Base64
import android.util.Log
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.model.ChunkUploadRequest
import com.devicemanager.data.remote.model.TransferInitRequest
import com.devicemanager.data.remote.model.TransferPriority
import com.devicemanager.data.remote.model.TransferStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.PriorityBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages chunked file uploads with queueing, resume, retry, progress, speed, ETA.
 *
 * Features:
 * - FIFO upload queue with priority levels
 * - Configurable chunk size (64KB - 1MB, default 256KB)
 * - Resume after interruption: tracks uploaded chunks, skips on retry
 * - Retry failed chunks (max 5 retries with exponential backoff)
 * - Progress tracking: bytes/total, percentage
 * - Transfer speed: bytes/sec over rolling 5-second window
 * - ETA: remaining bytes / current speed
 * - MD5 checksum per chunk and full file
 */
class ChunkedUploadManager(
    private val context: Context,
    private val apiService: ApiService,
    private val deviceId: String
) {
    companion object {
        private const val TAG = "ChunkedUploadManager"
        private const val DEFAULT_CHUNK_SIZE = 256 * 1024 // 256KB
        private const val MIN_CHUNK_SIZE = 64 * 1024
        private const val MAX_CHUNK_SIZE = 1024 * 1024
        private const val MAX_RETRIES = 5
        private const val SPEED_WINDOW_MS = 5000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = PriorityBlockingQueue<UploadTask>(
        64,
        compareByDescending<UploadTask> { it.priority }.thenBy { it.createdAt }
    )
    private val mutex = Mutex()
    private val isProcessing = AtomicBoolean(false)
    private var processorJob: Job? = null

    // Track uploaded chunks per transfer for resume
    private val uploadedChunks = ConcurrentHashMap<String, MutableSet<Int>>()

    // Speed tracking: list of (timestamp, bytes) pairs
    private val speedSamples = mutableListOf<Pair<Long, Long>>()

    data class UploadProgress(
        val transferId: String,
        val filename: String,
        val totalBytes: Long,
        val uploadedBytes: Long,
        val percentage: Int,
        val speedBytesPerSec: Double,
        val etaSeconds: Long,
        val status: String,
        val error: String? = null
    )

    private val _progress = MutableStateFlow<Map<String, UploadProgress>>(emptyMap())
    val progress: StateFlow<Map<String, UploadProgress>> = _progress.asStateFlow()

    data class UploadTask(
        val filePath: String,
        val priority: Int = TransferPriority.NORMAL,
        val createdAt: Long = System.currentTimeMillis(),
        val mimeType: String = "application/octet-stream"
    )

    /**
     * Add a file to the upload queue.
     */
    fun enqueue(filePath: String, priority: Int = TransferPriority.NORMAL, mimeType: String = "application/octet-stream") {
        val file = File(filePath)
        if (!file.exists()) {
            Log.e(TAG, "File not found: $filePath")
            return
        }
        queue.offer(UploadTask(filePath, priority, System.currentTimeMillis(), mimeType))
        Log.d(TAG, "Queued: ${file.name} (priority=$priority, size=${file.length()})")
        startProcessing()
    }

    /**
     * Start the queue processor if not already running.
     */
    private fun startProcessing() {
        if (isProcessing.compareAndSet(false, true)) {
            processorJob = scope.launch {
                processQueue()
            }
        }
    }

    /**
     * Process the upload queue.
     */
    private suspend fun processQueue() {
        try {
            while (true) {
                val task = queue.poll() ?: break
                try {
                    uploadFile(task)
                } catch (e: Exception) {
                    Log.e(TAG, "Upload task failed: ${e.message}", e)
                }
            }
        } finally {
            isProcessing.set(false)
        }
    }

    /**
     * Upload a single file using chunked transfer.
     */
    private suspend fun uploadFile(task: UploadTask) {
        val file = File(task.filePath)
        if (!file.exists()) {
            updateProgress(task.filePath, UploadProgress(
                transferId = "", filename = file.name, totalBytes = file.length(),
                uploadedBytes = 0, percentage = 0, speedBytesPerSec = 0.0,
                etaSeconds = 0, status = TransferStatus.FAILED, error = "File not found"
            ))
            return
        }

        val fileChecksum = calculateFileMd5(file)
        val totalChunks = Math.ceil(file.length().toDouble() / DEFAULT_CHUNK_SIZE).toInt()

        // Step 1: Initialize transfer
        val initResponse = try {
            apiService.initTransfer(
                TransferInitRequest(
                    deviceId = deviceId,
                    filename = file.name,
                    size = file.length(),
                    checksum = fileChecksum,
                    mimeType = task.mimeType
                )
            )
        } catch (e: Exception) {
            Log.e(TAG, "Transfer init failed: ${e.message}", e)
            updateProgress(task.filePath, UploadProgress(
                transferId = "", filename = file.name, totalBytes = file.length(),
                uploadedBytes = 0, percentage = 0, speedBytesPerSec = 0.0,
                etaSeconds = 0, status = TransferStatus.FAILED, error = "Init failed: ${e.message}"
            ))
            return
        }

        if (!initResponse.isSuccessful || initResponse.body() == null) {
            updateProgress(task.filePath, UploadProgress(
                transferId = "", filename = file.name, totalBytes = file.length(),
                uploadedBytes = 0, percentage = 0, speedBytesPerSec = 0.0,
                etaSeconds = 0, status = TransferStatus.FAILED,
                error = "Init failed: HTTP ${initResponse.code()}"
            ))
            return
        }

        val transferId = initResponse.body()!!.transferId
        val chunkSize = initResponse.body()!!.chunkSize.coerceIn(MIN_CHUNK_SIZE, MAX_CHUNK_SIZE)
        uploadedChunks[transferId] = mutableSetOf()

        // Step 2: Check status for resume (get already-uploaded chunks)
        try {
            val statusResp = apiService.getTransferStatus(transferId)
            if (statusResp.isSuccessful && statusResp.body() != null) {
                val existing = statusResp.body()!!.uploadedChunks
                uploadedChunks[transferId]?.addAll(existing)
                Log.d(TAG, "Resume: ${existing.size} chunks already uploaded for $transferId")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Status check failed, starting fresh: ${e.message}")
        }

        // Step 3: Upload chunks
        val startTime = System.currentTimeMillis()
        var uploadedBytes = 0L
        speedSamples.clear()

        for (chunkIndex in 0 until totalChunks) {
            // Skip already-uploaded chunks (resume)
            if (uploadedChunks[transferId]?.contains(chunkIndex) == true) {
                val skipBytes = minOf(chunkSize.toLong(), file.length() - chunkIndex.toLong() * chunkSize)
                uploadedBytes += skipBytes
                continue
            }

            val chunkData = readChunk(file, chunkIndex, chunkSize)
            if (chunkData == null) {
                updateProgress(transferId, UploadProgress(
                    transferId, file.name, file.length(), uploadedBytes,
                    (uploadedBytes * 100 / file.length()).toInt(), 0.0, 0,
                    TransferStatus.FAILED, "Failed to read chunk $chunkIndex"
                ))
                return
            }

            val chunkChecksum = calculateMd5(chunkData)
            val base64Data = Base64.encodeToString(chunkData, Base64.NO_WRAP)

            // Upload chunk with retry
            var success = false
            var retryCount = 0
            var lastError: String? = null

            while (!success && retryCount < MAX_RETRIES) {
                try {
                    val response = apiService.uploadChunk(
                        transferId,
                        ChunkUploadRequest(
                            chunkIndex = chunkIndex,
                            totalChunks = totalChunks,
                            checksum = chunkChecksum,
                            data = base64Data
                        )
                    )

                    if (response.isSuccessful && response.body()?.verified == true) {
                        success = true
                        uploadedChunks[transferId]?.add(chunkIndex)
                        uploadedBytes += chunkData.size
                        recordSpeedSample(chunkData.size)
                    } else {
                        lastError = "HTTP ${response.code()}"
                        retryCount++
                        if (retryCount < MAX_RETRIES) {
                            delay((1000 * Math.pow(2.0, retryCount.toDouble())).toLong())
                        }
                    }
                } catch (e: Exception) {
                    lastError = e.message
                    retryCount++
                    if (retryCount < MAX_RETRIES) {
                        delay((1000 * Math.pow(2.0, retryCount.toDouble())).toLong())
                    }
                }
            }

            if (!success) {
                updateProgress(transferId, UploadProgress(
                    transferId, file.name, file.length(), uploadedBytes,
                    (uploadedBytes * 100 / file.length()).toInt(),
                    getCurrentSpeed(), calculateEta(uploadedBytes, file.length()),
                    TransferStatus.FAILED, "Chunk $chunkIndex failed after $MAX_RETRIES retries: $lastError"
                ))
                return
            }

            // Update progress
            val speed = getCurrentSpeed()
            val eta = calculateEta(uploadedBytes, file.length())
            updateProgress(transferId, UploadProgress(
                transferId, file.name, file.length(), uploadedBytes,
                (uploadedBytes * 100 / file.length()).toInt(),
                speed, eta, TransferStatus.UPLOADING
            ))
        }

        // Step 4: Complete transfer
        updateProgress(transferId, UploadProgress(
            transferId, file.name, file.length(), file.length(), 100,
            getCurrentSpeed(), 0, TransferStatus.COMPLETING
        ))

        try {
            val completeResp = apiService.completeTransfer(transferId)
            if (completeResp.isSuccessful && completeResp.body()?.verified == true) {
                updateProgress(transferId, UploadProgress(
                    transferId, file.name, file.length(), file.length(), 100,
                    0.0, 0, TransferStatus.COMPLETED
                ))
                Log.d(TAG, "Transfer completed: $transferId (${file.name})")
            } else {
                val error = completeResp.body()?.let {
                    if (!it.verified) "Checksum verification failed" else "Completion failed"
                } ?: "HTTP ${completeResp.code()}"
                updateProgress(transferId, UploadProgress(
                    transferId, file.name, file.length(), uploadedBytes,
                    (uploadedBytes * 100 / file.length()).toInt(), 0.0, 0,
                    TransferStatus.FAILED, error
                ))
            }
        } catch (e: Exception) {
            updateProgress(transferId, UploadProgress(
                transferId, file.name, file.length(), uploadedBytes,
                (uploadedBytes * 100 / file.length()).toInt(), 0.0, 0,
                TransferStatus.FAILED, "Complete failed: ${e.message}"
            ))
        }
    }

    /**
     * Read a specific chunk from a file.
     */
    private fun readChunk(file: File, chunkIndex: Int, chunkSize: Int): ByteArray? {
        return try {
            val offset = chunkIndex.toLong() * chunkSize
            val bytesToRead = minOf(chunkSize.toLong(), file.length() - offset).toInt()
            if (bytesToRead <= 0) return null

            val buffer = ByteArray(bytesToRead)
            FileInputStream(file).use { fis ->
                fis.skip(offset)
                var totalRead = 0
                while (totalRead < bytesToRead) {
                    val read = fis.read(buffer, totalRead, bytesToRead - totalRead)
                    if (read == -1) break
                    totalRead += read
                }
            }
            if (buffer.size == bytesToRead) buffer else buffer.copyOf(bytesToRead)
        } catch (e: Exception) {
            Log.e(TAG, "Read chunk error: ${e.message}", e)
            null
        }
    }

    /**
     * Calculate MD5 of a byte array.
     */
    private fun calculateMd5(data: ByteArray): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(data)
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * Calculate MD5 of an entire file.
     */
    private fun calculateFileMd5(file: File): String {
        val md = MessageDigest.getInstance("MD5")
        FileInputStream(file).use { fis ->
            val buffer = ByteArray(8192)
            var read: Int
            while (fis.read(buffer).also { read = it } != -1) {
                md.update(buffer, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Record a speed sample.
     */
    private fun recordSpeedSample(bytes: Int) {
        synchronized(speedSamples) {
            speedSamples.add(Pair(System.currentTimeMillis(), bytes.toLong()))
            // Prune samples older than the window
            val cutoff = System.currentTimeMillis() - SPEED_WINDOW_MS
            speedSamples.removeAll { it.first < cutoff }
        }
    }

    /**
     * Get current transfer speed in bytes/sec over rolling window.
     */
    private fun getCurrentSpeed(): Double {
        synchronized(speedSamples) {
            if (speedSamples.isEmpty()) return 0.0
            val totalBytes = speedSamples.sumOf { it.second }
            val windowSec = SPEED_WINDOW_MS / 1000.0
            return totalBytes / windowSec
        }
    }

    /**
     * Calculate ETA in seconds.
     */
    private fun calculateEta(uploadedBytes: Long, totalBytes: Long): Long {
        val speed = getCurrentSpeed()
        if (speed <= 0) return 0
        val remaining = totalBytes - uploadedBytes
        return (remaining / speed).toLong()
    }

    /**
     * Update progress state.
     */
    private fun updateProgress(key: String, progress: UploadProgress) {
        scope.launch {
            mutex.withLock {
                val current = _progress.value.toMutableMap()
                current[key] = progress
                _progress.value = current
            }
        }
    }

    /**
     * Get progress for a specific transfer.
     */
    fun getProgress(transferId: String): UploadProgress? {
        return _progress.value[transferId]
    }

    /**
     * Get all active transfers.
     */
    fun getAllProgress(): Map<String, UploadProgress> = _progress.value

    /**
     * Cancel all uploads and clear queue.
     */
    fun cancelAll() {
        queue.clear()
        processorJob?.cancel()
        isProcessing.set(false)
        uploadedChunks.clear()
        speedSamples.clear()
    }
}
