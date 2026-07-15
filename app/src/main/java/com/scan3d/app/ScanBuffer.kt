package com.scan3d.app

object ScanBuffer {
    @Volatile
    var pendingZipPath: String? = null

    fun take(): String? {
        val p = pendingZipPath
        pendingZipPath = null
        return p
    }
}
