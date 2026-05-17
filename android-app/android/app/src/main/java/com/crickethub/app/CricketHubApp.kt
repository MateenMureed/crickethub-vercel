package com.crickethub.app

import android.app.Application
import com.crickethub.app.offline.sync.OfflineSyncScheduler

class CricketHubApp : Application() {
    override fun onCreate() {
        super.onCreate()
        OfflineSyncScheduler.schedulePeriodic(this)
    }
}
