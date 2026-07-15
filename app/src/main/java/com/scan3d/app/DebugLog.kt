package com.scan3d.app

import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.*

object DebugLog {

    private const val MAX = 800
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private val entries = ArrayDeque<Entry>()
    private val listeners = mutableListOf<() -> Unit>()
    private val handler = Handler(Looper.getMainLooper())

    enum class Tag { WEBVIEW, BRIDGE, CAMERA, SENSOR, ERRO, SYS }

    data class Entry(val time: String, val tag: Tag, val msg: String)

    @Synchronized
    fun log(tag: Tag, msg: String) {
        android.util.Log.d("Scan3D/${tag.name}", msg)
        entries.addLast(Entry(fmt.format(Date()), tag, msg))
        if (entries.size > MAX) entries.removeFirst()
        handler.post { listeners.forEach { it() } }
    }

    fun w(tag: Tag, msg: String) = log(tag, "⚠ $msg")
    fun e(tag: Tag, msg: String) = log(tag, "✕ $msg")

    @Synchronized fun getAll(): List<Entry> = entries.toList()
    @Synchronized fun getFiltered(tag: Tag?): List<Entry> =
        if (tag == null) entries.toList() else entries.filter { it.tag == tag }
    @Synchronized fun clear() { entries.clear(); handler.post { listeners.forEach { it() } } }

    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    fun dump(): String = getAll().joinToString("\n") { "[${it.time}][${it.tag}] ${it.msg}" }
}
