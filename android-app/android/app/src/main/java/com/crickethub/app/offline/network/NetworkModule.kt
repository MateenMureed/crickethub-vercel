package com.crickethub.app.offline.network

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object NetworkModule {
    private const val BASE_URL = "https://cricket-android.azurewebsites.net/"

    val offlineApi: OfflineApi by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OfflineApi::class.java)
    }
}
