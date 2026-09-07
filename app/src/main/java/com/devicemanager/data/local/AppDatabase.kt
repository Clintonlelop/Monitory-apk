package com.devicemanager.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.devicemanager.data.local.dao.EventQueueDao
import com.devicemanager.data.local.dao.PendingCommandDao
import com.devicemanager.data.local.entity.PendingCommand
import com.devicemanager.data.local.entity.QueuedEvent

/**
 * Room database for offline queue persistence.
 *
 * Tables:
 * - pending_commands: commands received but not yet executed
 * - queued_events: events that failed to upload and need retry
 */
@Database(
    entities = [PendingCommand::class, QueuedEvent::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun pendingCommandDao(): PendingCommandDao
    abstract fun eventQueueDao(): EventQueueDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "app_database"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
