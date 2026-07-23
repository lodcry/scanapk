package com.scan3d.app

import android.content.Context
import android.content.SharedPreferences

object ConfigStore {
    private const val PREFS    = "scan3d_config"
    private const val KEY_API    = "api_url"
    private const val KEY_COLMAP = "colmap_url"
    private const val KEY_DONE   = "genesis_configured"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isConfigured(ctx: Context): Boolean =
        prefs(ctx).getBoolean(KEY_DONE, false)

    fun getApiUrl(ctx: Context): String =
        prefs(ctx).getString(KEY_API, "") ?: ""

    fun setApiUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_API, url.trim().trimEnd('/')).apply()
    }

    fun getColmapUrl(ctx: Context): String =
        prefs(ctx).getString(KEY_COLMAP, "") ?: ""

    fun setColmapUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_COLMAP, url.trim().trimEnd('/')).apply()
    }

    fun markConfigured(ctx: Context) {
        prefs(ctx).edit().putBoolean(KEY_DONE, true).apply()
    }

    // Útil pra debug — reseta tudo e mostra o setup de novo
    fun reset(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}
