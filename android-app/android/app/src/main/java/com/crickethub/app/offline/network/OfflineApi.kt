package com.crickethub.app.offline.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.GET

interface OfflineApi {
    @GET("api/matches/live/all")
    suspend fun getLiveMatches(): List<RemoteMatch>

    @GET("api/matches/upcoming/all")
    suspend fun getUpcomingMatches(): List<RemoteMatch>

    @GET("api/teams")
    suspend fun getTeams(): List<RemoteTeam>

    @GET("api/stats/dashboard")
    suspend fun getDashboard(): RemoteDashboard
}

data class RemoteMatch(
    @SerializedName("id") val id: Long,
    @SerializedName("league_id") val leagueId: Long?,
    @SerializedName("team_a_id") val teamAId: Long?,
    @SerializedName("team_b_id") val teamBId: Long?,
    @SerializedName("team_a_name") val teamAName: String?,
    @SerializedName("team_b_name") val teamBName: String?,
    @SerializedName("team_a_logo") val teamALogo: String?,
    @SerializedName("team_b_logo") val teamBLogo: String?,
    @SerializedName("status") val status: String?,
    @SerializedName("result_summary") val resultSummary: String?,
    @SerializedName("date") val date: String?,
    @SerializedName("updated_at") val updatedAt: String?,
)

data class RemoteTeam(
    @SerializedName("id") val id: Long,
    @SerializedName("name") val name: String?,
    @SerializedName("short_name") val shortName: String?,
    @SerializedName("logo") val logo: String?,
)

data class RemoteDashboard(
    @SerializedName("live_scores") val liveScores: List<RemoteLiveScore>?,
    @SerializedName("points_tables") val pointsTables: List<RemotePointsTable>?,
)

data class RemoteLiveScore(
    @SerializedName("match_id") val matchId: Long,
    @SerializedName("score") val score: String?,
    @SerializedName("overs") val overs: String?,
    @SerializedName("wickets") val wickets: Int?,
    @SerializedName("striker") val striker: String?,
    @SerializedName("non_striker") val nonStriker: String?,
    @SerializedName("bowler") val bowler: String?,
    @SerializedName("last_ball") val lastBall: String?,
    @SerializedName("updated_at") val updatedAt: String?,
)

data class RemotePointsTable(
    @SerializedName("league_id") val leagueId: Long,
    @SerializedName("rows") val rows: List<RemotePointsRow>?,
)

data class RemotePointsRow(
    @SerializedName("team_id") val teamId: Long,
    @SerializedName("team_name") val teamName: String?,
    @SerializedName("position") val position: Int?,
    @SerializedName("played") val played: Int?,
    @SerializedName("won") val won: Int?,
    @SerializedName("lost") val lost: Int?,
    @SerializedName("tied") val tied: Int?,
    @SerializedName("no_result") val noResult: Int?,
    @SerializedName("points") val points: Int?,
    @SerializedName("nrr") val nrr: Double?,
)
