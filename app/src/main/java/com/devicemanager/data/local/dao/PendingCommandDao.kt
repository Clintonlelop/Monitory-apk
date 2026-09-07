package com.devicemanager.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.devicemanager.data.local.entity.PendingCommand
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingCommandDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(command: PendingCommand)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(commands: List<PendingCommand>)

    @Update
    suspend fun update(command: PendingCommand)

    @Query("DELETE FROM pending_commands WHERE commandId = :commandId")
    suspend fun deleteById(commandId: String)

    @Query("SELECT * FROM pending_commands WHERE status = 'PENDING' ORDER BY receivedAt ASC")
    suspend fun getPendingCommands(): List<PendingCommand>

    @Query("SELECT * FROM pending_commands ORDER BY receivedAt DESC LIMIT :limit")
    fun observeRecentCommands(limit: Int = 50): Flow<List<PendingCommand>>

    @Query("SELECT COUNT(*) FROM pending_commands WHERE status = 'PENDING'")
    suspend fun getPendingCount(): Int

    @Query("DELETE FROM pending_commands WHERE status != 'PENDING'")
    suspend fun clearProcessed()
}
