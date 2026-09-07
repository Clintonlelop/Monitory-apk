package com.devicemanager

import android.app.Application
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.devicemanager.data.local.AppDatabase
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.WebSocketClient
import com.devicemanager.data.repository.DeviceRepository
import com.devicemanager.data.repository.LocationRepository
import com.devicemanager.data.repository.SyncRepository
import com.devicemanager.data.repository.TelemetryRepository
import com.devicemanager.manager.CallLogCollector
import com.devicemanager.manager.ChunkedUploadManager
import com.devicemanager.manager.CommandExecutor
import com.devicemanager.manager.ContactsCollector
import com.devicemanager.manager.DiagnosticRunner
import com.devicemanager.manager.FileCollector
import com.devicemanager.manager.LocationManager
import com.devicemanager.manager.PermissionManager
import com.devicemanager.manager.SmsCollector
import com.devicemanager.manager.SnapshotCollector
import com.devicemanager.manager.TelemetryCollector
import com.devicemanager.manager.UsageStatsCollector
import com.devicemanager.util.Constants
import com.devicemanager.util.Extensions
import com.devicemanager.util.Preferences
import com.devicemanager.workers.LocationWorker
import com.devicemanager.workers.SyncWorker
import com.devicemanager.workers.TelemetryWorker
import com.devicemanager.workers.UsageStatsWorker
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Application class for dependency injection and global initialization.
 *
 * Initializes:
 * - SharedPreferences wrapper
 * - Room database
 * - OkHttp + Retrofit (with device token interceptor)
 * - WebSocket client
 * - Repositories
 * - Managers
 * - CommandExecutor
 * - Periodic WorkManager tasks
 */
class DeviceManagerApp : Application() {
    companion object {
        private const val TAG = "DeviceManagerApp"
    }

    // Utilities
    lateinit var preferences: Preferences
        private set
    lateinit var gson: Gson
        private set

    // Database
    lateinit var database: AppDatabase
        private set

    // Network
    lateinit var okHttpClient: OkHttpClient
        private set
    lateinit var apiService: ApiService
        private set
    lateinit var webSocketClient: WebSocketClient
        private set

    // Repositories
    lateinit var deviceRepository: DeviceRepository
        private set
    lateinit var telemetryRepository: TelemetryRepository
        private set
    lateinit var locationRepository: LocationRepository
        private set
    lateinit var syncRepository: SyncRepository
        private set

    // Managers
    lateinit var permissionManager: PermissionManager
        private set
    lateinit var telemetryCollector: TelemetryCollector
        private set
    lateinit var locationManager: LocationManager
        private set
    lateinit var usageStatsCollector: UsageStatsCollector
        private set
    lateinit var contactsCollector: ContactsCollector
        private set
    lateinit var callLogCollector: CallLogCollector
        private set
    lateinit var smsCollector: SmsCollector
        private set
    lateinit var fileCollector: FileCollector
        private set
    lateinit var chunkedUploadManager: ChunkedUploadManager
        private set
    lateinit var snapshotCollector: SnapshotCollector
        private set
    lateinit var diagnosticRunner: DiagnosticRunner
        private set

    // Command executor
    lateinit var commandExecutor: CommandExecutor
        private set

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Application created")

        initializeUtilities()
        initializeDatabase()
        initializeNetwork()
        initializeRepositories()
        initializeManagers()
        initializeCommandExecutor()
        initializeWorkManager()
    }

    private fun initializeUtilities() {
        preferences = Preferences(this)
        gson = GsonBuilder().setLenient().create()

        // Generate device token on first launch
        if (preferences.deviceToken.isBlank()) {
            preferences.deviceToken = Extensions.generateDeviceToken()
            Log.d(TAG, "Generated new device token: ${preferences.deviceToken}")
        }
    }

    private fun initializeDatabase() {
        database = AppDatabase.getInstance(this)
    }

    private fun initializeNetwork() {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        // Device token interceptor
        val tokenInterceptor = okhttp3.Interceptor { chain ->
            val originalRequest = chain.request()
            val token = preferences.deviceToken
            val requestBuilder = originalRequest.newBuilder()
                .header("X-Device-Token", token)
                .header("Content-Type", "application/json")
            chain.proceed(requestBuilder.build())
        }

        okHttpClient = OkHttpClient.Builder()
            .addInterceptor(tokenInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        // Base URL — use configured server URL or default
        val baseUrl = if (preferences.serverUrl.isNotBlank()) {
            preferences.serverUrl + "/"
        } else {
            BuildConfig.DEFAULT_SERVER_URL + "/"
        }

        apiService = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(ApiService::class.java)

        webSocketClient = WebSocketClient(okHttpClient, gson, this)
    }

    /**
     * Reinitialize the API service when server URL changes.
     */
    fun reinitializeApiService() {
        val baseUrl = if (preferences.serverUrl.isNotBlank()) {
            preferences.serverUrl + "/"
        } else {
            BuildConfig.DEFAULT_SERVER_URL + "/"
        }

        apiService = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(ApiService::class.java)

        Log.d(TAG, "API service reinitialized with base URL: $baseUrl")
    }

    private fun initializeRepositories() {
        deviceRepository = DeviceRepository(apiService, preferences)
        telemetryRepository = TelemetryRepository(
            apiService, database.eventQueueDao(), preferences, gson
        )
        locationRepository = LocationRepository(
            apiService, database.eventQueueDao(), preferences, gson
        )
        syncRepository = SyncRepository(apiService, database.eventQueueDao(), preferences, gson)
    }

    private fun initializeManagers() {
        permissionManager = PermissionManager(this)
        telemetryCollector = TelemetryCollector(this)
        locationManager = LocationManager(this)
        usageStatsCollector = UsageStatsCollector(this)
        contactsCollector = ContactsCollector(this)
        callLogCollector = CallLogCollector(this)
        smsCollector = SmsCollector(this)
        fileCollector = FileCollector(this)
        chunkedUploadManager = ChunkedUploadManager(this, apiService, preferences.deviceId)
        snapshotCollector = SnapshotCollector(this, permissionManager, webSocketClient, preferences)
        diagnosticRunner = DiagnosticRunner(this, apiService, webSocketClient, permissionManager, preferences)
    }

    private fun initializeCommandExecutor() {
        commandExecutor = CommandExecutor(
            context = this,
            apiService = apiService,
            webSocketClient = webSocketClient,
            deviceRepository = deviceRepository,
            telemetryRepository = telemetryRepository,
            locationRepository = locationRepository,
            syncRepository = syncRepository,
            telemetryCollector = telemetryCollector,
            locationManager = locationManager,
            usageStatsCollector = usageStatsCollector,
            contactsCollector = contactsCollector,
            callLogCollector = callLogCollector,
            smsCollector = smsCollector,
            fileCollector = fileCollector,
            chunkedUploadManager = chunkedUploadManager,
            snapshotCollector = snapshotCollector,
            diagnosticRunner = diagnosticRunner,
            preferences = preferences,
            gson = gson
        )
    }

    /**
     * Public method to initialize WorkManager after setup is complete.
     * Called from SetupActivity after successful pairing.
     */
    fun initializeWorkManagerPublic() {
        initializeWorkManager()
    }

    private fun initializeWorkManager() {
        if (!preferences.isSetupComplete) {
            Log.d(TAG, "Setup not complete, skipping WorkManager initialization")
            return
        }

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        // Telemetry: every 15 minutes
        val telemetryRequest = PeriodicWorkRequestBuilder<TelemetryWorker>(
            Constants.TELEMETRY_INTERVAL_MIN, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(Constants.WORK_TELEMETRY)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            Constants.WORK_TELEMETRY,
            ExistingPeriodicWorkPolicy.KEEP,
            telemetryRequest
        )

        // Location: every 30 minutes
        val locationRequest = PeriodicWorkRequestBuilder<LocationWorker>(
            Constants.LOCATION_INTERVAL_MIN, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(Constants.WORK_LOCATION)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            Constants.WORK_LOCATION,
            ExistingPeriodicWorkPolicy.KEEP,
            locationRequest
        )

        // Sync: every 15 minutes
        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(
            Constants.SYNC_INTERVAL_MIN, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(Constants.WORK_SYNC)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            Constants.WORK_SYNC,
            ExistingPeriodicWorkPolicy.KEEP,
            syncRequest
        )

        // Usage stats: every 6 hours
        val usageRequest = PeriodicWorkRequestBuilder<UsageStatsWorker>(
            Constants.USAGE_STATS_INTERVAL_HOURS, TimeUnit.HOURS
        )
            .setConstraints(constraints)
            .addTag(Constants.WORK_USAGE_STATS)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            Constants.WORK_USAGE_STATS,
            ExistingPeriodicWorkPolicy.KEEP,
            usageRequest
        )

        Log.d(TAG, "WorkManager periodic tasks initialized")
    }
}
