package com.example.data.remote

import com.example.data.prefs.PreferenceManager
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class ApiClient(private val preferenceManager: PreferenceManager) {

    val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    val okHttpClient: OkHttpClient by lazy {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request()
                val response = chain.proceed(request)

                // Detect if server returned an HTML error page instead of JSON
                val contentType = response.header("Content-Type") ?: ""
                if (!response.isSuccessful && contentType.contains("text/html")) {
                    throw java.io.IOException("Server returned HTML error (${response.code}). Please check server connection.")
                }

                response
            }
            .addInterceptor(logging)
            .build()
    }

    private var currentRetrofit: Retrofit? = null
    private var currentBaseUrl: String? = null

    fun getService(): ApiService {
        val baseUrl = preferenceManager.getServerUrl().let {
            if (it.endsWith("/")) it else "$it/"
        }
        if (currentRetrofit == null || currentBaseUrl != baseUrl) {
            currentBaseUrl = baseUrl
            currentRetrofit = Retrofit.Builder()
                .baseUrl(baseUrl)
                .client(okHttpClient)
                .addConverterFactory(MoshiConverterFactory.create(moshi))
                .build()
        }
        return currentRetrofit!!.create(ApiService::class.java)
    }
}
