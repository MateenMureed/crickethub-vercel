package com.crickethub.app.offline.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "matches")
data class MatchEntity(
    @PrimaryKey val id: Long,
    val leagueId: Long?,
    val teamAId: Long?,
    val teamBId: Long?,
    val teamAName: String,
    val teamBName: String,
    val teamALogo: String?,
    val teamBLogo: String?,
    val status: String,
    val resultSummary: String?,
    val startsAtEpochMs: Long?,
    val serverUpdatedAtEpochMs: Long?,
    val cachedAtEpochMs: Long,
)

@Entity(tableName = "teams")
data class TeamEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val shortName: String?,
    val logoUrl: String?,
    val cachedAtEpochMs: Long,
)

@Entity(tableName = "live_scores")
data class LiveScoreEntity(
    @PrimaryKey val matchId: Long,
    val scoreText: String,
    val oversText: String,
    val wickets: Int,
    val strikerName: String?,
    val nonStrikerName: String?,
    val bowlerName: String?,
    val lastBallText: String?,
    val serverUpdatedAtEpochMs: Long?,
    val cachedAtEpochMs: Long,
)

@Entity(tableName = "league_table", primaryKeys = ["leagueId", "teamId"])
data class LeagueTableEntity(
    val leagueId: Long,
    val teamId: Long,
    val teamName: String,
    val position: Int,
    val played: Int,
    val won: Int,
    val lost: Int,
    val tied: Int,
    val noResult: Int,
    val points: Int,
    val netRunRate: Double,
    val cachedAtEpochMs: Long,
)
