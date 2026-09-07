package com.devicemanager.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.devicemanager.data.local.entity.QueuedEvent

@Dao
interface EventQueueDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: QueuedEvent): Long

    @Query("SELECT * FROM queued_events ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getQueuedEvents(limit: Int = 100): List<QueuedEvent>

    @Query("SELECT COUNT(*) FROM queued_events")
    suspend fun getQueueCount(): Int

    @Update
    suspend fun update(event: QueuedEvent)

    @Query("DELETE FROM queued_events WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM queued_events WHERE retryCount >= :maxRetries")
    suspend fun deleteExhausted(maxRetries: Int = 5)

    @Query("DELETE FROM queued_events")
    suspend fun clearAll()
}
