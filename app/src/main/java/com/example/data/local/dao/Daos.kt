package com.example.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.example.data.local.entity.CommandEntity
import com.example.data.local.entity.OfflineEventEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvent(event: OfflineEventEntity): Long

    @Query("SELECT * FROM offline_events ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getPendingEvents(limit: Int = 50): List<OfflineEventEntity>

    @Query("DELETE FROM offline_events WHERE id = :id")
    suspend fun deleteEvent(id: Long)

    @Query("DELETE FROM offline_events WHERE id IN (:ids)")
    suspend fun deleteEvents(ids: List<Long>)

    @Update
    suspend fun updateEvent(event: OfflineEventEntity)

    @Query("SELECT COUNT(*) FROM offline_events")
    fun getPendingEventsCountFlow(): Flow<Int>
}

@Dao
interface CommandDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(command: CommandEntity)

    @Query("SELECT * FROM command_history ORDER BY timestamp DESC LIMIT 100")
    fun getAllCommandsFlow(): Flow<List<CommandEntity>>

    @Query("SELECT * FROM command_history WHERE commandId = :commandId")
    suspend fun getCommandById(commandId: String): CommandEntity?

    @Query("UPDATE command_history SET status = :status, result = :result, errorMessage = :errorMessage, completionTimestamp = :completionTimestamp WHERE commandId = :commandId")
    suspend fun updateStatus(
        commandId: String,
        status: String,
        result: String?,
        errorMessage: String?,
        completionTimestamp: Long?
    )
}
