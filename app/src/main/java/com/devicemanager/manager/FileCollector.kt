package com.devicemanager.manager

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.FileEntry

/**
 * Collects file metadata using MediaStore.
 *
 * Queries Images, Video, Audio, Downloads, and Documents collections.
 * Only sends metadata (filename, type, size, path, mime, date_modified) —
 * actual file uploads use /api/upload (multipart).
 *
 * Uses scoped storage on Android 10+ (no READ_EXTERNAL_STORAGE needed).
 * On older versions, READ_EXTERNAL_STORAGE is required.
 * Paginated to avoid huge payloads.
 */
class FileCollector(private val context: Context) {
    companion object {
        private const val TAG = "FileCollector"
        const val PAGE_SIZE = 200
    }

    fun hasPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Scoped storage: MediaStore is accessible without permission
            true
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Collect file metadata from all MediaStore collections.
     * Returns a paginated list.
     */
    fun collectFiles(page: Int = 0): List<FileEntry> {
        if (!hasPermission()) {
            Log.w(TAG, "Storage permission not granted")
            return emptyList()
        }

        val files = mutableListOf<FileEntry>()
        val contentResolver: ContentResolver = context.contentResolver

        try {
            files.addAll(queryImages(contentResolver, page))
            files.addAll(queryVideo(contentResolver, page))
            files.addAll(queryAudio(contentResolver, page))
            files.addAll(queryDownloads(contentResolver, page))
            files.addAll(queryDocuments(contentResolver, page))
        } catch (e: Exception) {
            Log.e(TAG, "Collect files error: ${e.message}", e)
        }

        Log.d(TAG, "Collected ${files.size} file entries (page $page)")
        return files
    }

    /**
     * Collect all file metadata across all pages.
     */
    fun collectAllFiles(): List<FileEntry> {
        val allFiles = mutableListOf<FileEntry>()
        var page = 0
        while (true) {
            val pageFiles = collectFiles(page)
            if (pageFiles.isEmpty()) break
            allFiles.addAll(pageFiles)
            if (pageFiles.size < PAGE_SIZE * 5) break // Less than full page across all collections
            page++
            if (page > 10) break // Safety limit
        }
        return allFiles
    }

    private fun queryImages(resolver: ContentResolver, page: Int): List<FileEntry> {
        return queryCollection(
            resolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            "image",
            page
        )
    }

    private fun queryVideo(resolver: ContentResolver, page: Int): List<FileEntry> {
        return queryCollection(
            resolver,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            "video",
            page
        )
    }

    private fun queryAudio(resolver: ContentResolver, page: Int): List<FileEntry> {
        return queryCollection(
            resolver,
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            "audio",
            page
        )
    }

    private fun queryDownloads(resolver: ContentResolver, page: Int): List<FileEntry> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            queryCollection(
                resolver,
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                "download",
                page
            )
        } else {
            emptyList()
        }
    }

    private fun queryDocuments(resolver: ContentResolver, page: Int): List<FileEntry> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            queryCollection(
                resolver,
                MediaStore.Files.getContentUri("external"),
                "document",
                page,
                selection = MediaStore.Files.FileColumns.MEDIA_TYPE + " = " +
                        MediaStore.Files.FileColumns.MEDIA_TYPE_DOCUMENT
            )
        } else {
            emptyList()
        }
    }

    private fun queryCollection(
        resolver: ContentResolver,
        uri: android.net.Uri,
        fileType: String,
        page: Int,
        selection: String? = null
    ): List<FileEntry> {
        val entries = mutableListOf<FileEntry>()

        val projection = arrayOf(
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.DATA
        )

        val offset = page * PAGE_SIZE
        val sortOrder = "${MediaStore.MediaColumns.DATE_MODIFIED} DESC LIMIT $PAGE_SIZE OFFSET $offset"

        try {
            val cursor = resolver.query(
                uri,
                projection,
                selection,
                null,
                sortOrder
            )

            cursor?.use { c ->
                val nameIndex = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeIndex = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val mimeIndex = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val dateIndex = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
                val dataIndex = c.getColumnIndex(MediaStore.MediaColumns.DATA)

                while (c.moveToNext()) {
                    val filename = c.getString(nameIndex) ?: continue
                    val size = c.getLong(sizeIndex)
                    val mimeType = c.getString(mimeIndex)
                    val dateModified = c.getLong(dateIndex) * 1000 // seconds to millis
                    val filePath = if (dataIndex >= 0) c.getString(dataIndex) else null

                    entries.add(
                        FileEntry(
                            filename = filename,
                            fileType = fileType,
                            sizeBytes = size,
                            filePath = filePath,
                            mimeType = mimeType,
                            dateModified = dateModified
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Query $fileType error: ${e.message}", e)
        }

        return entries
    }
}
