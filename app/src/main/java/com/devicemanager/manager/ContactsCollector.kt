package com.devicemanager.manager

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import android.util.Log
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.ContactEntry

/**
 * Collects contacts using ContentResolver.
 *
 * Queries ContactsContract.CommonDataKinds.Phone for phone numbers
 * and ContactsContract.CommonDataKinds.Email for emails.
 * Requires READ_CONTACTS permission.
 */
class ContactsCollector(private val context: Context) {
    companion object {
        private const val TAG = "ContactsCollector"
    }

    fun hasPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
                PackageManager.PERMISSION_GRANTED
    }

    /**
     * Collect all contacts with phone numbers and emails.
     */
    fun collectContacts(): List<ContactEntry> {
        if (!hasPermission()) {
            Log.w(TAG, "Contacts permission not granted")
            return emptyList()
        }

        val contacts = mutableListOf<ContactEntry>()
        val contentResolver: ContentResolver = context.contentResolver

        try {
            // Query phone numbers
            val phoneCursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID
                ),
                null,
                null,
                null
            )

            val contactMap = mutableMapOf<String, ContactEntry>()

            phoneCursor?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val idIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)

                while (cursor.moveToNext()) {
                    val name = cursor.getString(nameIndex) ?: ""
                    val number = cursor.getString(numberIndex) ?: ""
                    val contactId = cursor.getString(idIndex) ?: ""

                    if (name.isNotBlank()) {
                        val existing = contactMap[contactId]
                        if (existing != null) {
                            // Append phone if not already present
                            if (existing.phone == null) {
                                contactMap[contactId] = existing.copy(phone = number)
                            }
                        } else {
                            contactMap[contactId] = ContactEntry(
                                name = name,
                                phone = number,
                                email = null
                            )
                        }
                    }
                }
            }

            // Query emails
            val emailCursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Email.ADDRESS,
                    ContactsContract.CommonDataKinds.Email.CONTACT_ID
                ),
                null,
                null,
                null
            )

            emailCursor?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.DISPLAY_NAME)
                val emailIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS)
                val idIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.CONTACT_ID)

                while (cursor.moveToNext()) {
                    val name = cursor.getString(nameIndex) ?: ""
                    val email = cursor.getString(emailIndex) ?: ""
                    val contactId = cursor.getString(idIndex) ?: ""

                    if (name.isNotBlank()) {
                        val existing = contactMap[contactId]
                        if (existing != null) {
                            if (existing.email == null) {
                                contactMap[contactId] = existing.copy(email = email)
                            }
                        } else {
                            contactMap[contactId] = ContactEntry(
                                name = name,
                                phone = null,
                                email = email
                            )
                        }
                    }
                }
            }

            contacts.addAll(contactMap.values)
        } catch (e: Exception) {
            Log.e(TAG, "Collect contacts error: ${e.message}", e)
        }

        Log.d(TAG, "Collected ${contacts.size} contacts")
        return contacts
    }
}
