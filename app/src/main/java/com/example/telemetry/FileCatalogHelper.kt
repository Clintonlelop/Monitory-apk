package com.example.telemetry

import android.content.Context
import android.provider.MediaStore
import com.example.data.model.FileEntryData

class FileCatalogHelper(private val context: Context) {

    fun collectFilesAndMedia(limitPerCategory: Int = 150): List<FileEntryData> {
        val images = queryMedia(
            uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            mimeFallback = "image/*",
            limit = limitPerCategory
        )
        val videos = queryMedia(
            uri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            mimeFallback = "video/*",
            limit = limitPerCategory
        )
        val downloads = queryMedia(
            uri = MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            mimeFallback = "application/octet-stream",
            limit = limitPerCategory
        )

        return (images + videos + downloads)
            .distinctBy { it.path }
            .sortedByDescending { it.modifiedAt }
    }

    private fun queryMedia(
        uri: android.net.Uri,
        mimeFallback: String,
        limit: Int
    ): List<FileEntryData> {
        val projection = arrayOf(
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.RELATIVE_PATH
        )

        val sortOrder = "${MediaStore.MediaColumns.DATE_MODIFIED} DESC LIMIT $limit"
        val resolver = context.contentResolver
        val result = mutableListOf<FileEntryData>()

        resolver.query(uri, projection, null, null, sortOrder)?.use { cursor ->
            val nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
            val sizeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE)
            val mimeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
            val modifiedIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
            val relPathIdx = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)

            while (cursor.moveToNext()) {
                val name = if (nameIdx >= 0) cursor.getString(nameIdx) else null
                if (name.isNullOrBlank()) continue

                val size = if (sizeIdx >= 0) cursor.getLong(sizeIdx) else 0L
                val mime = if (mimeIdx >= 0) cursor.getString(mimeIdx) else null
                val modifiedSeconds = if (modifiedIdx >= 0) cursor.getLong(modifiedIdx) else 0L
                val relativePath = if (relPathIdx >= 0) cursor.getString(relPathIdx) else ""

                result.add(
                    FileEntryData(
                        name = name,
                        path = (relativePath ?: "") + name,
                        size = size,
                        mimeType = mime ?: mimeFallback,
                        isDirectory = false,
                        modifiedAt = modifiedSeconds * 1000
                    )
                )
            }
        }

        return result
    }
}

