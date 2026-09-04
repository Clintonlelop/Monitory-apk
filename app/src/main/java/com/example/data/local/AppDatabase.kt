package com.example.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.example.data.local.dao.CommandDao
import com.example.data.local.dao.EventDao
import com.example.data.local.entity.CommandEntity
import com.example.data.local.entity.OfflineEventEntity

@Database(
    entities = [OfflineEventEntity::class, CommandEntity::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun commandDao(): CommandDao

    companion object {
        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "device_manager.db"
                ).fallbackToDestructiveMigration().build().also { instance = it }
            }
        }
    }
}
