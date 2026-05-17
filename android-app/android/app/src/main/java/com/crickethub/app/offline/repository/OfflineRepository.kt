package com.crickethub.app.offline.repository

import androidx.room.withTransaction
import com.crickethub.app.offline.db.CricketHubDatabase
import com.crickethub.app.offline.db.LeagueTableEntity
import com.crickethub.app.offline.db.LiveScoreEntity
import com.crickethub.app.offline.db.MatchEntity
import com.crickethub.app.offline.db.TeamEntity
import com.crickethub.app.offline.network.NetworkModule
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.time.Instant
import java.time.format.DateTimeParseException

data class OfflineHomeSnapshot(
    val matches: List<MatchEntity>,
    val teams: List<TeamEntity>,
    val liveScores: List<LiveScoreEntity>,
    val leagueTables: List<LeagueTableEntity>,
    val cachedAtEpochMs: Long,
)

class OfflineRepository(private val db: CricketHubDatabase) {
    private val api = NetworkModule.offlineApi

    fun observeHomeSnapshot(): Flow<OfflineHomeSnapshot> {
        return combine(
            db.matchDao().observeMatches(),
            db.teamDao().observeTeams(),
            db.liveScoreDao().observeLiveScores(),
            db.leagueTableDao().observeAll(),
        ) { matches, teams, liveScores, leagueTables ->
            val latest = listOfNotNull(
                matches.maxOfOrNull { it.cachedAtEpochMs },
                teams.maxOfOrNull { it.cachedAtEpochMs },
                liveScores.maxOfOrNull { it.cachedAtEpochMs },
                leagueTables.maxOfOrNull { it.cachedAtEpochMs },
            ).maxOrNull() ?: 0L

            OfflineHomeSnapshot(
                matches = matches,
                teams = teams,
                liveScores = liveScores,
                leagueTables = leagueTables,
                cachedAtEpochMs = latest,
            )
        }
    }

    suspend fun refreshAll() {
        val now = System.currentTimeMillis()
        val live = runCatching { api.getLiveMatches() }.getOrDefault(emptyList())
        val upcoming = runCatching { api.getUpcomingMatches() }.getOrDefault(emptyList())
        val teams = runCatching { api.getTeams() }.getOrDefault(emptyList())
        val dashboard = runCatching { api.getDashboard() }.getOrNull()

        val matches = (live + upcoming)
            .distinctBy { it.id }
            .map {
                MatchEntity(
                    id = it.id,
                    leagueId = it.leagueId,
                    teamAId = it.teamAId,
                    teamBId = it.teamBId,
                    teamAName = it.teamAName.orEmpty(),
                    teamBName = it.teamBName.orEmpty(),
                    teamALogo = it.teamALogo,
                    teamBLogo = it.teamBLogo,
                    status = it.status ?: "scheduled",
                    resultSummary = it.resultSummary,
                    startsAtEpochMs = parseIsoToEpoch(it.date),
                    serverUpdatedAtEpochMs = parseIsoToEpoch(it.updatedAt),
                    cachedAtEpochMs = now,
                )
            }

        val teamEntities = teams.map {
            TeamEntity(
                id = it.id,
                name = it.name.orEmpty(),
                shortName = it.shortName,
                logoUrl = it.logo,
                cachedAtEpochMs = now,
            )
        }

        val liveEntities = dashboard?.liveScores.orEmpty().map {
            LiveScoreEntity(
                matchId = it.matchId,
                scoreText = it.score ?: "-",
                oversText = it.overs ?: "0.0",
                wickets = it.wickets ?: 0,
                strikerName = it.striker,
                nonStrikerName = it.nonStriker,
                bowlerName = it.bowler,
                lastBallText = it.lastBall,
                serverUpdatedAtEpochMs = parseIsoToEpoch(it.updatedAt),
                cachedAtEpochMs = now,
            )
        }

        val tableEntities = dashboard?.pointsTables.orEmpty().flatMap { table ->
            table.rows.orEmpty().map { row ->
                LeagueTableEntity(
                    leagueId = table.leagueId,
                    teamId = row.teamId,
                    teamName = row.teamName.orEmpty(),
                    position = row.position ?: 0,
                    played = row.played ?: 0,
                    won = row.won ?: 0,
                    lost = row.lost ?: 0,
                    tied = row.tied ?: 0,
                    noResult = row.noResult ?: 0,
                    points = row.points ?: 0,
                    netRunRate = row.nrr ?: 0.0,
                    cachedAtEpochMs = now,
                )
            }
        }

        db.withTransaction {
            if (matches.isNotEmpty()) db.matchDao().upsertAll(matches)
            if (teamEntities.isNotEmpty()) db.teamDao().upsertAll(teamEntities)
            if (liveEntities.isNotEmpty()) db.liveScoreDao().upsertAll(liveEntities)
            if (tableEntities.isNotEmpty()) db.leagueTableDao().upsertAll(tableEntities)
        }
    }

    private fun parseIsoToEpoch(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return try {
            Instant.parse(value).toEpochMilli()
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
