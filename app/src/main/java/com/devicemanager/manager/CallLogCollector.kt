package com.devicemanager.manager

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import android.util.Log
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.CallEntry

/**
 * Collects call log using ContentResolver.
 *
 * Queries CallLog.Calls with type mapping (incoming/outgoing/missed).
 * Requires READ_CALL_LOG permission.
 */
class CallLogCollector(private val context: Context) {
    companion object {
        private const val TAG = "CallLogCollector"
    }

    fun hasPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) ==
                PackageManager.PERMISSION_GRANTED
    }

    /**
     * Collect call log entries.
     */
    fun collectCallLog(limit: Int = 500): List<CallEntry> {
        if (!hasPermission()) {
            Log.w(TAG, "Call log permission not granted")
            return emptyList()
        }

        val calls = mutableListOf<CallEntry>()
        val contentResolver: ContentResolver = context.contentResolver

        try {
            val projection = arrayOf(
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DURATION,
                CallLog.Calls.DATE
            )

            val sortOrder = "${CallLog.Calls.DATE} DESC LIMIT $limit"

            val cursor = contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )

            cursor?.use { c ->
                val numberIndex = c.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIndex = c.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIndex = c.getColumnIndex(CallLog.Calls.TYPE)
                val durationIndex = c.getColumnIndex(CallLog.Calls.DURATION)
                val dateIndex = c.getColumnIndex(CallLog.Calls.DATE)

                while (c.moveToNext()) {
                    val number = c.getString(numberIndex) ?: ""
                    val contactName = c.getString(nameIndex)
                    val type = c.getInt(typeIndex)
                    val duration = c.getLong(durationIndex)
                    val date = c.getLong(dateIndex)

                    val callType = mapCallType(type)

                    calls.add(
                        CallEntry(
                            number = number,
                            contactName = contactName,
                            callType = callType,
                            durationSeconds = duration,
                            callDate = date
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Collect call log error: ${e.message}", e)
        }

        Log.d(TAG, "Collected ${calls.size} call log entries")
        return calls
    }

    /**
     * Map Android call type integer to string.
     */
    private fun mapCallType(type: Int): String {
        return when (type) {
            CallLog.Calls.INCOMING_TYPE -> "INCOMING"
            CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
            CallLog.Calls.MISSED_TYPE -> "MISSED"
            CallLog.Calls.VOICEMAIL_TYPE -> "VOICEMAIL"
            CallLog.Calls.REJECTED_TYPE -> "REJECTED"
            CallLog.Calls.BLOCKED_TYPE -> "BLOCKED"
            else -> "UNKNOWN"
        }
    }
}
