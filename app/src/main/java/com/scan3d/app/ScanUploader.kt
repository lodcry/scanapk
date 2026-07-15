package com.scan3d.app

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object ScanUploader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(180, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun uploadZip(zipFile: File, onResult: (jobId: String?, error: String?) -> Unit) {
        Thread {
            try {
                val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart(
                        "file", zipFile.name,
                        zipFile.asRequestBody("application/zip".toMediaTypeOrNull())
                    ).build()

                val request = Request.Builder()
                    .url("${Config.RENDER_BASE_URL}/jobs")
                    .post(body)
                    .build()

                client.newCall(request).execute().use { resp ->
                    val text = resp.body?.string() ?: ""
                    if (!resp.isSuccessful) {
                        onResult(null, "HTTP ${resp.code}: $text")
                        return@Thread
                    }
                    val json = JSONObject(text)
                    onResult(json.optString("job_id"), null)
                }
            } catch (e: Exception) {
                onResult(null, e.message ?: "erro desconhecido no upload")
            }
        }.start()
    }
}
