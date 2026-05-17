package com.crickethub.app.offline.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.crickethub.app.offline.db.CricketHubDatabase
import com.crickethub.app.offline.repository.OfflineRepository

class OfflineSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val repository = OfflineRepository(CricketHubDatabase.get(applicationContext))
        return runCatching {
            repository.refreshAll()
            Result.success()
        }.getOrElse {
            Result.retry()
        }
    }
}
