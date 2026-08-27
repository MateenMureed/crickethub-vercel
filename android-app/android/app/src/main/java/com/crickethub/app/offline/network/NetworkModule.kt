package com.crickethub.app.offline.network

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object NetworkModule {
    // Keep this in sync with VITE_ANDROID_BACKEND_URL when shipping an APK.
    // This native offline helper is optional and is not used by the web UI.
    private const val BASE_URL = "https://your-project.vercel.app/"

    val offlineApi: OfflineApi by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OfflineApi::class.java)
    }
}
