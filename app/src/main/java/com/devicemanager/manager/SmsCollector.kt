package com.devicemanager.manager

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import android.util.Log
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.SmsEntry

/**
 * Collects SMS messages using ContentResolver.
 *
 * Queries Telephony.Sms.CONTENT_URI.
 *
 * IMPORTANT LIMITATION (Android 10+ / API 29):
 * On Android 10 and above, the READ_SMS permission is restricted. Only the
 * default SMS app can read the full SMS content via Telephony.Sms.CONTENT_URI.
 * Non-default apps will receive an empty cursor. This is a deliberate Android
 * security restriction and cannot be bypassed. The app must be set as the
 * default SMS app (which also requires implementing SMS receiving functionality)
 * to access full SMS content. This limitation is documented and reported
 * gracefully rather than attempting to bypass Android security.
 */
class SmsCollector(private val context: Context) {
    companion object {
        private const val TAG = "SmsCollector"
    }

    fun hasPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
                PackageManager.PERMISSION_GRANTED
    }

    /**
     * Check if the app is the default SMS app (required for full SMS access on Android 10+).
     */
    fun isDefaultSmsApp(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Telephony.Sms.getDefaultSmsPackage(context) == context.packageName
        } else {
            true // On older versions, READ_SMS is sufficient
        }
    }

    /**
     * Collect SMS messages.
     * On Android 10+, returns empty list if app is not the default SMS app.
     */
    fun collectSms(limit: Int = 500): List<SmsEntry> {
        if (!hasPermission()) {
            Log.w(TAG, "SMS permission not granted")
            return emptyList()
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !isDefaultSmsApp()) {
            Log.w(TAG, "App is not the default SMS app. Cannot read SMS content on Android 10+.")
            return emptyList()
        }

        val messages = mutableListOf<SmsEntry>()
        val contentResolver: ContentResolver = context.contentResolver

        try {
            val projection = arrayOf(
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.TYPE,
                Telephony.Sms.DATE,
                Telephony.Sms.THREAD_ID
            )

            val sortOrder = "${Telephony.Sms.DATE} DESC LIMIT $limit"

            val cursor = contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )

            cursor?.use { c ->
                val addressIndex = c.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIndex = c.getColumnIndex(Telephony.Sms.BODY)
                val typeIndex = c.getColumnIndex(Telephony.Sms.TYPE)
                val dateIndex = c.getColumnIndex(Telephony.Sms.DATE)
                val threadIdIndex = c.getColumnIndex(Telephony.Sms.THREAD_ID)

                while (c.moveToNext()) {
                    val address = c.getString(addressIndex) ?: ""
                    val body = c.getString(bodyIndex)
                    val type = c.getInt(typeIndex)
                    val date = c.getLong(dateIndex)
                    val threadId = c.getLong(threadIdIndex)

                    val messageType = mapMessageType(type)

                    messages.add(
                        SmsEntry(
                            address = address,
                            body = body,
                            messageType = messageType,
                            date = date,
                            threadId = threadId
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Collect SMS error: ${e.message}", e)
        }

        Log.d(TAG, "Collected ${messages.size} SMS messages")
        return messages
    }

    /**
     * Map Android SMS type integer to string.
     */
    private fun mapMessageType(type: Int): String {
        return when (type) {
            Telephony.Sms.MESSAGE_TYPE_INBOX -> "INBOX"
            Telephony.Sms.MESSAGE_TYPE_SENT -> "SENT"
            Telephony.Sms.MESSAGE_TYPE_DRAFT -> "DRAFT"
            Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "OUTBOX"
            Telephony.Sms.MESSAGE_TYPE_FAILED -> "FAILED"
            Telephony.Sms.MESSAGE_TYPE_QUEUED -> "QUEUED"
            else -> "UNKNOWN"
        }
    }
}
