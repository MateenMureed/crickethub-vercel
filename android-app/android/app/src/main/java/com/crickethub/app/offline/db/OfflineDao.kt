package com.crickethub.app.offline.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface MatchDao {
    @Query("SELECT * FROM matches ORDER BY COALESCE(startsAtEpochMs, 0) DESC")
    fun observeMatches(): Flow<List<MatchEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<MatchEntity>)
}

@Dao
interface TeamDao {
    @Query("SELECT * FROM teams ORDER BY name ASC")
    fun observeTeams(): Flow<List<TeamEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<TeamEntity>)
}

@Dao
interface LiveScoreDao {
    @Query("SELECT * FROM live_scores ORDER BY serverUpdatedAtEpochMs DESC")
    fun observeLiveScores(): Flow<List<LiveScoreEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<LiveScoreEntity>)
}

@Dao
interface LeagueTableDao {
    @Query("SELECT * FROM league_table WHERE leagueId = :leagueId ORDER BY position ASC")
    fun observeByLeague(leagueId: Long): Flow<List<LeagueTableEntity>>

    @Query("SELECT * FROM league_table ORDER BY leagueId ASC, position ASC")
    fun observeAll(): Flow<List<LeagueTableEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<LeagueTableEntity>)

    @Query("DELETE FROM league_table WHERE leagueId = :leagueId")
    suspend fun clearLeague(leagueId: Long)
}
