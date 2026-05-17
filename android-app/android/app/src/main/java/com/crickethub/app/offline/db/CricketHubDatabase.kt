package com.crickethub.app.offline.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        MatchEntity::class,
        TeamEntity::class,
        LiveScoreEntity::class,
        LeagueTableEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class CricketHubDatabase : RoomDatabase() {
    abstract fun matchDao(): MatchDao
    abstract fun teamDao(): TeamDao
    abstract fun liveScoreDao(): LiveScoreDao
    abstract fun leagueTableDao(): LeagueTableDao

    companion object {
        @Volatile
        private var INSTANCE: CricketHubDatabase? = null

        fun get(context: Context): CricketHubDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    CricketHubDatabase::class.java,
                    "cricket_hub_offline.db",
                ).fallbackToDestructiveMigration().build().also { INSTANCE = it }
            }
        }
    }
}
