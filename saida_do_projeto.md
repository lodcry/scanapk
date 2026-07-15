---
### Início do arquivo: ./app/build.gradle
```
plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace 'com.scan3d.app'
    compileSdk 34

    defaultConfig {
        applicationId "com.scan3d.app"
        minSdk 26
        targetSdk 34
        versionCode 2
        versionName "2.0"
    }

    buildTypes {
        debug   { minifyEnabled false; debuggable true }
        release {
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = '17' }
}

dependencies {
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.ar:core:1.41.0'
    implementation 'org.nanohttpd:nanohttpd:2.3.1'
}
```
### Fim do arquivo: ./app/build.gradle
---
### Início do arquivo: ./app/proguard-rules.pro
```
-keep class com.scan3d.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.google.ar.** { *; }
-keep class fi.iki.elonen.** { *; }
```
### Fim do arquivo: ./app/proguard-rules.pro
---
### Início do arquivo: ./app/src/main/AndroidManifest.xml
```
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <uses-feature android:name="android.hardware.camera" android:required="true" />
    <uses-feature android:name="android.hardware.camera.ar" android:required="false" />

    <application
        android:allowBackup="false"
        android:icon="@drawable/ic_launcher"
        android:label="SCAN3D"
        android:theme="@style/Theme.Scan3D"
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config">

        <meta-data android:name="com.google.ar.core" android:value="required" />

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="portrait"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name=".ARScanActivity"
            android:exported="false"
            android:screenOrientation="portrait"
            android:configChanges="orientation|screenSize" />

    </application>
</manifest>
```
### Fim do arquivo: ./app/src/main/AndroidManifest.xml
---
### Início do arquivo: ./app/src/main/java/com/scan3d/app/ARScanActivity.kt
```
package com.scan3d.app

import android.app.Activity
import android.graphics.Color
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.*
import com.google.ar.core.*
import com.google.ar.core.exceptions.*
import org.json.JSONArray
import org.json.JSONObject
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class ARScanActivity : Activity() {

    private var session: Session? = null
    private lateinit var glView: GLSurfaceView
    private val handler = Handler(Looper.getMainLooper())
    private var textureId = -1

    private val pointBuffer = mutableListOf<JSONObject>()
    private var scanning = false
    private var frameCount = 0
    private var totalPoints = 0

    private lateinit var tvStatus: TextView
    private lateinit var tvPoints: TextView
    private lateinit var tvFps: TextView
    private var fpsCount = 0
    private var fpsLast = System.currentTimeMillis()

    companion object {
        const val RESULT_POINTS = "points"
        const val MAX_POINTS = 15000
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        glView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(object : GLSurfaceView.Renderer {
                override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
                    GLES20.glClearColor(0f, 0f, 0f, 1f)
                    val tex = IntArray(1)
                    GLES20.glGenTextures(1, tex, 0)
                    textureId = tex[0]
                }
                override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
                    GLES20.glViewport(0, 0, w, h)
                    session?.setDisplayGeometry(0, w, h)
                }
                override fun onDrawFrame(gl: GL10?) {
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
                    val s = session ?: return
                    try {
                        if (textureId >= 0) s.setCameraTextureName(textureId)
                        val frame = s.update()
                        if (scanning) processFrame(frame)
                        fpsCount++
                        val now = System.currentTimeMillis()
                        if (now - fpsLast >= 1000) {
                            val fps = fpsCount
                            fpsCount = 0
                            fpsLast = now
                            handler.post { tvFps.text = "$fps FPS" }
                        }
                    } catch (e: Exception) {
                        DebugLog.e(DebugLog.Tag.ARCORE, "Frame: ${e.message}")
                    }
                }
            })
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        root.addView(glView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val overlay = buildOverlay()
        root.addView(overlay, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        setContentView(root)
        initARCore()
    }

    private fun buildOverlay(): FrameLayout {
        val frame = FrameLayout(this)
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xCC000000.toInt())
            setPadding(dp(12), dp(10), dp(12), dp(10))
            gravity = Gravity.CENTER_VERTICAL
        }
        tvStatus = TextView(this).apply {
            text = "◈ ARCORE — INICIANDO"; textSize = 12f
            setTextColor(0xFF00ffcc.toInt()); letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        tvPoints = TextView(this).apply { text = "0 PTS"; textSize = 11f; setTextColor(0xFF00ffcc.toInt()) }
        tvFps = TextView(this).apply { text = "0 FPS"; textSize = 10f; setTextColor(0x8800ffcc.toInt()); setPadding(dp(10),0,0,0) }
        topBar.addView(tvStatus); topBar.addView(tvPoints); topBar.addView(tvFps)
        frame.addView(topBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        val mira = FrameLayout(this).also { f ->
            f.addView(android.view.View(this).apply { setBackgroundColor(0xAA00ffcc.toInt()); layoutParams = FrameLayout.LayoutParams(1, dp(40), Gravity.CENTER) })
            f.addView(android.view.View(this).apply { setBackgroundColor(0xAA00ffcc.toInt()); layoutParams = FrameLayout.LayoutParams(dp(40), 1, Gravity.CENTER) })
        }
        frame.addView(mira, FrameLayout.LayoutParams(dp(60), dp(60), Gravity.CENTER))

        val botBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setBackgroundColor(0xEE000000.toInt())
            setPadding(dp(10), dp(12), dp(10), dp(24)); gravity = Gravity.CENTER
        }
        val btnScan = Button(this).apply { text="⬤ SCAN"; textSize=12f; stateListAnimator=null; setBackgroundColor(0xFF00ffcc.toInt()); setTextColor(0xFF000000.toInt()); setPadding(dp(24),dp(10),dp(24),dp(10)) }
        val btnStop = Button(this).apply { text="⬛ PARAR"; textSize=12f; stateListAnimator=null; setBackgroundColor(0xFFff6060.toInt()); setTextColor(0xFFffffff.toInt()); setPadding(dp(24),dp(10),dp(24),dp(10)); isEnabled=false; alpha=0.4f }
        val btnConfirm = Button(this).apply { text="✓ SALVAR"; textSize=12f; stateListAnimator=null; setBackgroundColor(0xFF00ffcc.toInt()); setTextColor(0xFF000000.toInt()); setPadding(dp(24),dp(10),dp(24),dp(10)); isEnabled=false; alpha=0.4f }
        val btnCancel = Button(this).apply { text="✕"; textSize=12f; stateListAnimator=null; setBackgroundColor(Color.TRANSPARENT); setTextColor(0xFFff6060.toInt()); setPadding(dp(16),dp(10),dp(16),dp(10)) }

        btnScan.setOnClickListener { scanning=true; btnScan.isEnabled=false; btnScan.alpha=0.4f; btnStop.isEnabled=true; btnStop.alpha=1f; tvStatus.text="● SCANNING — MOVA O CELULAR" }
        btnStop.setOnClickListener { scanning=false; btnStop.isEnabled=false; btnStop.alpha=0.4f; btnConfirm.isEnabled=true; btnConfirm.alpha=1f; tvStatus.text="◈ PARADO — ${totalPoints} PTS CAPTURADOS" }
        btnConfirm.setOnClickListener { finishWithPoints() }
        btnCancel.setOnClickListener { setResult(RESULT_CANCELED); finish() }

        botBar.addView(btnCancel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnScan, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnStop, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnConfirm, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)))
        frame.addView(botBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        return frame
    }

    private fun processFrame(frame: Frame) {
        if (pointBuffer.size >= MAX_POINTS) return
        val cloud = frame.acquirePointCloud()
        try {
            val buf = cloud.points; val n = cloud.ids.limit()
            val batch = mutableListOf<JSONObject>()
            for (i in 0 until n) {
                val idx = i*4; if (idx+3 >= buf.limit()) break
                val x=buf.get(idx).toDouble(); val y=buf.get(idx+1).toDouble(); val z=buf.get(idx+2).toDouble(); val conf=buf.get(idx+3).toDouble()
                if (conf < 0.1) continue
                batch.add(JSONObject().apply { put("x",x); put("y",y); put("z",z); put("confidence",conf); put("ts",System.currentTimeMillis()) })
            }
            if (batch.isNotEmpty()) {
                synchronized(pointBuffer) { pointBuffer.addAll(batch) }
                totalPoints += batch.size; frameCount++
                if (frameCount%10==0) handler.post { tvPoints.text = "$totalPoints PTS" }
            }
        } finally { cloud.release() }
    }

    private fun finishWithPoints() {
        val arr = JSONArray()
        synchronized(pointBuffer) { pointBuffer.forEach { arr.put(it) } }
        setResult(RESULT_OK, android.content.Intent().apply { putExtra(RESULT_POINTS, arr.toString()) })
        finish()
    }

    private fun initARCore() {
        try {
            session = Session(this).also { s ->
                s.configure(Config(s).apply {
                    depthMode = Config.DepthMode.AUTOMATIC
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                })
            }
            handler.post { tvStatus.text = "◈ ARCORE PRONTO" }
            DebugLog.log(DebugLog.Tag.ARCORE, "Session iniciada com Depth API")
        } catch (e: Exception) { DebugLog.e(DebugLog.Tag.ARCORE, "Erro ARCore: ${e.message}"); finish() }
    }

    override fun onResume() { super.onResume(); try { session?.resume() } catch (e: Exception) {}; glView.onResume() }
    override fun onPause() { super.onPause(); glView.onPause(); session?.pause() }
    override fun onDestroy() { session?.close(); super.onDestroy() }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/ARScanActivity.kt
---
### Início do arquivo: ./app/src/main/java/com/scan3d/app/DebugLog.kt
```
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

    enum class Tag { WEBVIEW, BRIDGE, CAMERA, SENSOR, ERRO, SYS, ARCORE, SERVER }
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
    @Synchronized fun clear() { entries.clear(); handler.post { listeners.forEach { it() } } }
    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    fun dump(): String = getAll().joinToString("\n") { "[${it.time}][${it.tag}] ${it.msg}" }
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/DebugLog.kt
---
### Início do arquivo: ./app/src/main/java/com/scan3d/app/MainActivity.kt
```
package com.scan3d.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Session
import com.google.ar.core.exceptions.UnavailableException
import org.json.JSONArray

class MainActivity : AppCompatActivity() {

    lateinit var webView: WebView
    private lateinit var db: ScanDatabase
    private lateinit var server: NanoHTTPdServer
    private val handler = Handler(Looper.getMainLooper())
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    companion object {
        var instance: MainActivity? = null
        const val REQ_CAMERA = 101
        const val REQ_AR = 102
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this

        db = ScanDatabase(this)
        server = NanoHTTPdServer(db)
        try {
            server.start()
            DebugLog.log(DebugLog.Tag.SERVER, "NanoHTTPd iniciado na porta 3001")
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.SERVER, "Erro ao iniciar servidor: ${e.message}")
        }

        val root = FrameLayout(this)
        webView = WebView(this)
        root.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val btnLog = Button(this).apply {
            text = "📋"; textSize = 14f; stateListAnimator = null
            setBackgroundColor(0xCC1a1a26.toInt()); setTextColor(0xFF00ffcc.toInt())
            setPadding(dp(6), dp(4), dp(6), dp(4)); alpha = 0.8f
        }
        btnLog.setOnClickListener { showLogDialog() }
        root.addView(btnLog, FrameLayout.LayoutParams(dp(44), dp(38)).apply {
            gravity = Gravity.TOP or Gravity.END; topMargin = dp(48); rightMargin = dp(8)
        })

        setContentView(root)
        setupWebView()
        checkCamera() // ← PRIMEIRO pede permissão da câmera
    }

    private fun checkARCoreDirectly() {
        try {
            val availability = ArCoreApk.getInstance().checkAvailability(this)
            DebugLog.log(DebugLog.Tag.ARCORE, "Availability: $availability")
            DebugLog.log(DebugLog.Tag.ARCORE, "isSupported: ${availability.isSupported}")

            if (availability.isSupported) {
                DebugLog.log(DebugLog.Tag.ARCORE, "✓ ARCore SUPORTADO")
                try {
                    val session = Session(this)
                    session.close()
                    DebugLog.log(DebugLog.Tag.ARCORE, "✓ Session criada com sucesso")
                } catch (e: UnavailableException) {
                    DebugLog.e(DebugLog.Tag.ARCORE, "Session falhou: ${e.message}")
                } catch (e: SecurityException) {
                    DebugLog.e(DebugLog.Tag.ARCORE, "Permissão da câmera negada")
                }
            } else {
                DebugLog.e(DebugLog.Tag.ARCORE, "✕ ARCore NÃO SUPORTADO")
            }
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.ARCORE, "Erro ao verificar: ${e.message}")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.addJavascriptInterface(Scan3DBridge(), "Scan3DBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript("""
                    (function(){
                        window.__NATIVE_APP__ = true;
                        window.__ARCORE_AVAILABLE__ = true;
                        window.onerror = function(m,s,l){
                            Scan3DBridge && Scan3DBridge.log('ERRO', m+' ('+s+':'+l+')');
                        };
                        window.addEventListener('unhandledrejection', function(e){
                            Scan3DBridge && Scan3DBridge.log('ERRO', 'Promise: '+(e.reason?.message||e.reason||''));
                        });
                    })();
                """.trimIndent(), null)
                DebugLog.log(DebugLog.Tag.WEBVIEW, "onPageFinished → $url")
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                DebugLog.e(DebugLog.Tag.WEBVIEW, "${err.errorCode}: ${err.description} — ${req.url}")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) request.grant(request.resources)
                else {
                    pendingPermissionRequest = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity, arrayOf(Manifest.permission.CAMERA), REQ_CAMERA
                    )
                }
            }
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val tag = if (msg.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    DebugLog.Tag.ERRO else DebugLog.Tag.WEBVIEW
                DebugLog.log(tag, "[JS] ${msg.message()}")
                return true
            }
            override fun onShowFileChooser(wv: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileUploadCallback = cb
                try { startActivityForResult(p.createIntent(), 3001) } catch (e: Exception) { return false }
                return true
            }
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
    }

    inner class Scan3DBridge {
        @JavascriptInterface
        fun log(tag: String, msg: String) {
            val t = when (tag.uppercase()) {
                "BRIDGE" -> DebugLog.Tag.BRIDGE
                "CAMERA" -> DebugLog.Tag.CAMERA
                "ARCORE" -> DebugLog.Tag.ARCORE
                "ERRO", "ERROR" -> DebugLog.Tag.ERRO
                else -> DebugLog.Tag.SYS
            }
            DebugLog.log(t, "[JS] $msg")
        }

        @JavascriptInterface
        fun startARScan() {
            DebugLog.log(DebugLog.Tag.ARCORE, "startARScan() chamado pelo JS")
            handler.post {
                try {
                    val intent = Intent(this@MainActivity, ARScanActivity::class.java)
                    startActivityForResult(intent, REQ_AR)
                } catch (e: Exception) {
                    DebugLog.e(DebugLog.Tag.ARCORE, "Erro ao iniciar AR: ${e.message}")
                }
            }
        }

        @JavascriptInterface
        fun isARAvailable(): Boolean {
            return try {
                val availability = ArCoreApk.getInstance()
                    .checkAvailability(this@MainActivity)
                val supported = availability.isSupported
                DebugLog.log(DebugLog.Tag.ARCORE, "isARAvailable() → $supported")
                supported
            } catch (e: Exception) {
                DebugLog.e(DebugLog.Tag.ARCORE, "isARAvailable erro: ${e.message}")
                false
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Long) {
            val v = getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator ?: return
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                v.vibrate(android.os.VibrationEffect.createOneShot(ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            else @Suppress("DEPRECATION") v.vibrate(ms)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_AR -> {
                if (resultCode == RESULT_OK && data != null) {
                    val pointsJson = data.getStringExtra(ARScanActivity.RESULT_POINTS) ?: "[]"
                    DebugLog.log(DebugLog.Tag.ARCORE, "AR finalizado, recebendo ${pointsJson.length} caracteres")
                    handler.post {
                        webView.evaluateJavascript(
                            "window.__onARScanComplete && window.__onARScanComplete($pointsJson)", null
                        )
                    }
                } else {
                    DebugLog.log(DebugLog.Tag.ARCORE, "AR cancelado")
                    handler.post {
                        webView.evaluateJavascript(
                            "window.__onARScanCancelled && window.__onARScanCancelled()", null
                        )
                    }
                }
            }
            3001 -> {
                fileUploadCallback?.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data) ?: arrayOf()
                )
                fileUploadCallback = null
            }
        }
    }

    private fun checkCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED) {
            // Permissão já concedida → verifica ARCore
            checkARCoreDirectly()
            loadApp()
        } else {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
        }
    }

    fun loadApp() {
        DebugLog.log(DebugLog.Tag.SYS, "Carregando React de assets/")
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_CAMERA) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (granted) {
                pendingPermissionRequest?.grant(pendingPermissionRequest!!.resources)
                // Permissão concedida → verifica ARCore
                checkARCoreDirectly()
            } else {
                pendingPermissionRequest?.deny()
            }
            pendingPermissionRequest = null
            loadApp()
        }
    }

    private fun showLogDialog() {
        val dialog = android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0a0a0f.toInt())
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF111118.toInt())
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        header.addView(TextView(this).apply {
            text = "◈ SCAN3D LOG"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF00ffcc.toInt())
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        val btnCopy = Button(this).apply {
            text = "COPIAR"; textSize = 10f; stateListAnimator = null
            setBackgroundColor(0xFF00ffcc.toInt()); setTextColor(0xFF000000.toInt())
            setPadding(dp(10), 0, dp(10), 0)
        }
        btnCopy.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("scan3d_log", DebugLog.dump()))
            Toast.makeText(this, "✓ Copiado", Toast.LENGTH_SHORT).show()
        }
        val btnClose = Button(this).apply {
            text = "✕"; textSize = 10f; stateListAnimator = null
            setBackgroundColor(Color.TRANSPARENT); setTextColor(0xFFff6060.toInt())
            setPadding(dp(10), 0, dp(10), 0)
        }
        btnClose.setOnClickListener { dialog.dismiss() }
        header.addView(btnCopy, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(34)).apply { setMargins(0,0,dp(6),0) })
        header.addView(btnClose, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(34)))

        val scroll = ScrollView(this)
        val ll = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        DebugLog.getAll().forEach { e ->
            ll.addView(TextView(this).apply {
                val col = when (e.tag) {
                    DebugLog.Tag.ERRO   -> 0xFFff6060.toInt()
                    DebugLog.Tag.ARCORE -> 0xFFffb800.toInt()
                    DebugLog.Tag.SERVER -> 0xFF5b8cff.toInt()
                    DebugLog.Tag.CAMERA -> 0xFFffb800.toInt()
                    else                -> 0xFF9090a0.toInt()
                }
                text = "[${e.time}][${e.tag}] ${e.msg}"
                textSize = 10f; typeface = Typeface.MONOSPACE
                setTextColor(col); setPadding(0, dp(1), 0, dp(1))
            })
        }
        scroll.addView(ll)
        root.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        dialog.setContentView(root)
        dialog.show()
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onResume()  { super.onResume();  webView.onResume() }
    override fun onPause()   { super.onPause();   webView.onPause() }
    override fun onDestroy() {
        instance = null
        server.stop()
        webView.destroy()
        super.onDestroy()
    }
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/MainActivity.kt
---
### Início do arquivo: ./app/src/main/java/com/scan3d/app/NanoHTTPdServer.kt
```
package com.scan3d.app

import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject

class NanoHTTPdServer(private val db: ScanDatabase) : NanoHTTPD(3001) {

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri.trimEnd('/')
        val method = session.method

        return try {
            when {
                uri == "/api/health" && method == Method.GET ->
                    json(JSONObject().apply {
                        put("ok", true)
                        put("scans", db.scanCount())
                        put("ts", System.currentTimeMillis())
                    }.toString())

                uri == "/api/scans" && method == Method.GET ->
                    json(db.listScans().toString())

                uri == "/api/scans" && method == Method.POST -> {
                    val body = body(session)
                    val name = body.optString("name", "Scan ${System.currentTimeMillis()}")
                    val id = db.createScan(name)
                    DebugLog.log(DebugLog.Tag.SERVER, "POST /api/scans → id=$id")
                    json(JSONObject().put("id", id).toString())
                }

                uri.matches(Regex("/api/scans/\\d+")) && method == Method.DELETE -> {
                    val id = uri.split("/").last().toLong()
                    db.deleteScan(id)
                    DebugLog.log(DebugLog.Tag.SERVER, "DELETE /api/scans/$id")
                    json(JSONObject().put("ok", true).toString())
                }

                uri.matches(Regex("/api/scans/\\d+/points")) && method == Method.POST -> {
                    val scanId = uri.split("/")[3].toLong()
                    val body = body(session)
                    val pts = body.optJSONArray("points") ?: JSONArray()
                    db.insertPoints(scanId, pts)
                    DebugLog.log(DebugLog.Tag.SERVER, "POST points scan=$scanId +${pts.length()}")
                    json(JSONObject().apply {
                        put("ok", true)
                        put("inserted", pts.length())
                    }.toString())
                }

                uri.matches(Regex("/api/scans/\\d+/points")) && method == Method.GET -> {
                    val scanId = uri.split("/")[3].toLong()
                    json(db.getPoints(scanId).toString())
                }

                else -> newFixedLengthResponse(
                    Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found"
                )
            }
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.SERVER, "Erro: ${e.message}")
            newFixedLengthResponse(
                Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.message ?: "error"
            )
        }
    }

    private fun json(s: String) = newFixedLengthResponse(
        Response.Status.OK, "application/json", s
    ).also { it.addHeader("Access-Control-Allow-Origin", "*") }

    private fun body(session: IHTTPSession): JSONObject {
        val map = mutableMapOf<String, String>()
        session.parseBody(map)
        return try { JSONObject(map["postData"] ?: "{}") } catch (e: Exception) { JSONObject() }
    }
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/NanoHTTPdServer.kt
---
### Início do arquivo: ./app/src/main/java/com/scan3d/app/ScanDatabase.kt
```
package com.scan3d.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

class ScanDatabase(context: Context) :
    SQLiteOpenHelper(context, "scan3d.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        db.execSQL("""
            CREATE TABLE scan_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id INTEGER NOT NULL,
                x REAL, y REAL, z REAL,
                confidence REAL, ts INTEGER
            )
        """)
        db.execSQL("""
            CREATE TABLE ar_objects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id INTEGER NOT NULL,
                name TEXT, type TEXT,
                px REAL, py REAL, pz REAL,
                sx REAL, sy REAL, sz REAL,
                rx REAL, ry REAL, rz REAL
            )
        """)
    }

    override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {}

    fun listScans(): JSONArray {
        val db = readableDatabase
        val arr = JSONArray()
        val c = db.rawQuery("""
            SELECT s.id, s.name, s.created_at, COUNT(p.id) as point_count
            FROM scans s LEFT JOIN scan_points p ON p.scan_id = s.id
            GROUP BY s.id ORDER BY s.created_at DESC
        """, null)
        while (c.moveToNext()) {
            arr.put(JSONObject().apply {
                put("id", c.getLong(0))
                put("name", c.getString(1))
                put("created_at", c.getLong(2))
                put("point_count", c.getLong(3))
            })
        }
        c.close()
        return arr
    }

    fun createScan(name: String): Long {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("name", name)
            put("created_at", System.currentTimeMillis())
        }
        return db.insert("scans", null, cv)
    }

    fun deleteScan(id: Long) {
        val db = writableDatabase
        db.delete("scan_points", "scan_id=?", arrayOf(id.toString()))
        db.delete("ar_objects", "scan_id=?", arrayOf(id.toString()))
        db.delete("scans", "id=?", arrayOf(id.toString()))
    }

    fun insertPoints(scanId: Long, points: JSONArray) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (i in 0 until points.length()) {
                val p = points.getJSONObject(i)
                val cv = ContentValues().apply {
                    put("scan_id", scanId)
                    put("x", p.optDouble("x", 0.0))
                    put("y", p.optDouble("y", 0.0))
                    put("z", p.optDouble("z", 0.0))
                    put("confidence", p.optDouble("confidence", 1.0))
                    put("ts", p.optLong("ts", System.currentTimeMillis()))
                }
                db.insert("scan_points", null, cv)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun getPoints(scanId: Long): JSONArray {
        val db = readableDatabase
        val arr = JSONArray()
        val c = db.rawQuery(
            "SELECT x,y,z,confidence FROM scan_points WHERE scan_id=?",
            arrayOf(scanId.toString())
        )
        while (c.moveToNext()) {
            arr.put(JSONObject().apply {
                put("x", c.getDouble(0))
                put("y", c.getDouble(1))
                put("z", c.getDouble(2))
                put("confidence", c.getDouble(3))
            })
        }
        c.close()
        return arr
    }

    fun scanCount(): Int {
        val db = readableDatabase
        val c = db.rawQuery("SELECT COUNT(*) FROM scans", null)
        val n = if (c.moveToFirst()) c.getInt(0) else 0
        c.close()
        return n
    }
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/ScanDatabase.kt
---
### Início do arquivo: ./app/src/main/res/drawable/ic_launcher.xml
```
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#030b07" android:pathData="M0,0h108v108h-108z"/>
    <circle android:fillColor="#00ffcc" android:centerX="54" android:centerY="54" android:radius="28dp"/>
    <circle android:fillColor="#030b07" android:centerX="54" android:centerY="54" android:radius="10dp"/>
</vector>
```
### Fim do arquivo: ./app/src/main/res/drawable/ic_launcher.xml
---
### Início do arquivo: ./app/src/main/res/layout/activity_main.xml
```
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#000000">
    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
```
### Fim do arquivo: ./app/src/main/res/layout/activity_main.xml
---
### Início do arquivo: ./app/src/main/res/values/strings.xml
```
<resources>
    <string name="app_name">SCAN3D</string>
</resources>
```
### Fim do arquivo: ./app/src/main/res/values/strings.xml
---
### Início do arquivo: ./app/src/main/res/values/themes.xml
```
<resources>
    <style name="Theme.Scan3D" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowFullscreen">true</item>
    </style>
</resources>
```
### Fim do arquivo: ./app/src/main/res/values/themes.xml
---
### Início do arquivo: ./app/src/main/res/xml/network_security_config.xml
```
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
    </domain-config>
</network-security-config>
```
### Fim do arquivo: ./app/src/main/res/xml/network_security_config.xml
---
### Início do arquivo: ./build.gradle
```
plugins {
    id 'com.android.application' version '8.2.0' apply false
    id 'org.jetbrains.kotlin.android' version '1.9.22' apply false
}
```
### Fim do arquivo: ./build.gradle
---
### Início do arquivo: ./codemagic.yaml
```
workflows:
  android-scan3d:
    name: SCAN3D APK Standalone
    max_build_duration: 60
    instance_type: mac_mini_m2

    environment:
      java: 17
      node: 18

    scripts:
      - name: Setup SDK
        script: |
          echo "sdk.dir=$ANDROID_SDK_ROOT" > $CM_BUILD_DIR/local.properties

      - name: Setup Gradle
        script: |
          cd $CM_BUILD_DIR
          gradle wrapper --gradle-version=8.2
          chmod +x gradlew

      - name: Build React → assets
        script: |
          cd $CM_BUILD_DIR/scan3d-react
          npm install
          npm run build

      - name: Build APK
        script: |
          cd $CM_BUILD_DIR
          ./gradlew assembleDebug --stacktrace

    artifacts:
      - app/build/outputs/apk/debug/*.apk
```
### Fim do arquivo: ./codemagic.yaml
---
### Início do arquivo: ./gradle.properties
```
android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m
```
### Fim do arquivo: ./gradle.properties
---
### Início do arquivo: ./gradle/wrapper/gradle-wrapper.properties
```
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```
### Fim do arquivo: ./gradle/wrapper/gradle-wrapper.properties
---
### Início do arquivo: ./gradlew
```
#!/bin/sh
DIRNAME="$(dirname "$0")"
exec "$DIRNAME/gradle/wrapper/gradle-wrapper.jar" "$@"
```
### Fim do arquivo: ./gradlew
---
### Início do arquivo: ./saida_do_projeto.md
```
```
### Fim do arquivo: ./saida_do_projeto.md
---
### Início do arquivo: ./scan3d-react/package.json
```
{
  "name": "scan3d-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build -w packages/client"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```
### Fim do arquivo: ./scan3d-react/package.json
---
### Início do arquivo: ./scan3d-react/packages/client/index.html
```
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"/>
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-capable" content="yes"/>
    <title>SCAN3D</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root {
        width: 100%; height: 100%; overflow: hidden;
        background: #000; overscroll-behavior: none;
      }
      body {
        font-family: 'Courier New', Courier, monospace;
        -webkit-font-smoothing: antialiased;
        touch-action: none; position: fixed; inset: 0;
      }
      button { font-family: inherit; -webkit-tap-highlight-color: transparent; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```
### Fim do arquivo: ./scan3d-react/packages/client/index.html
---
### Início do arquivo: ./scan3d-react/packages/client/package.json
```
{
  "name": "@scan3d/client",
  "version": "2.0.0",
  "scripts": {
    "build": "vite build",
    "dev": "vite --host 0.0.0.0 --port 5173"
  },
  "dependencies": {
    "@react-three/fiber": "^8.15.19",
    "@react-three/drei": "^9.99.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "three": "^0.160.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.12"
  }
}
```
### Fim do arquivo: ./scan3d-react/packages/client/package.json
---
### Início do arquivo: ./scan3d-react/packages/client/src/App.jsx
```
import React, { useState, useEffect } from 'react'
import ScanView from './components/ScanView'
import Viewer3D from './components/Viewer3D'
import ScansPanel from './components/ScansPanel'

export default function App() {
  const [screen, setScreen] = useState('scan')

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`)
    }
    setVh()
    window.addEventListener('resize', setVh)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh)
    return () => window.removeEventListener('resize', setVh)
  }, [])

  return (
    <div style={{
      width: '100vw', height: 'calc(var(--vh,1vh)*100)',
      background: '#000', overflow: 'hidden',
      position: 'fixed', inset: 0,
    }}>
      {screen === 'scan'   && <ScanView   goViewer={() => setScreen('viewer')} goScans={() => setScreen('scans')} />}
      {screen === 'viewer' && <Viewer3D   goBack={() => setScreen('scan')} />}
      {screen === 'scans'  && <ScansPanel goBack={() => setScreen('scan')} />}
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/App.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/api.js
```
const BASE = 'http://localhost:3001/api'

async function req(url, opts = {}) {
  const r = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export const createScan = (name) => req('/scans', { method: 'POST', body: { name } })
export const listScans  = ()     => req('/scans')
export const deleteScan = (id)   => req(`/scans/${id}`, { method: 'DELETE' })
export const loadPoints = (id)   => req(`/scans/${id}/points`)
export const healthCheck = ()    => req('/health')

export async function pushPoints(scanId, points) {
  if (!scanId || !points.length) return
  return req(`/scans/${scanId}/points`, { method: 'POST', body: { points } })
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/api.js
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/ScanView.jsx
```
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { createScan, pushPoints, healthCheck } from '../api'

const C = {
  bg:      '#000000',
  primary: '#00ffcc',
  danger:  '#ff6060',
  dim:     'rgba(0,255,204,0.35)',
  panel:   'rgba(0,0,0,0.88)',
}

function HUD({ pts, mode, apiOk, arReady }) {
  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, zIndex:1000,
      padding:'14px 16px 12px',
      background:'linear-gradient(to bottom,rgba(0,0,0,.9),transparent)',
      display:'flex', justifyContent:'space-between', alignItems:'flex-start',
      pointerEvents:'none',
    }}>
      <div>
        <div style={{ fontSize:15, letterSpacing:6, color:C.primary, fontWeight:'bold',
          textShadow:`0 0 20px ${C.primary}66` }}>◈ SCAN3D</div>
        <div style={{ fontSize:9, letterSpacing:1.5, marginTop:4, color: apiOk ? C.dim : C.danger }}>
          {apiOk ? '● DB ONLINE' : '✕ DB OFFLINE'}
        </div>
        <div style={{ fontSize:9, letterSpacing:1.5, marginTop:2, color: arReady ? C.dim : C.danger }}>
          {arReady ? '● ARCORE OK' : '✕ ARCORE N/D'}
        </div>
      </div>
      <div style={{ textAlign:'right', lineHeight:1.8 }}>
        <div style={{ fontSize:20, fontWeight:'bold', color:C.primary,
          textShadow:`0 0 16px ${C.primary}` }}>
          {pts.toLocaleString()}
        </div>
        <div style={{ fontSize:9, color:C.dim, letterSpacing:2 }}>PONTOS</div>
        <div style={{ fontSize:11, color: mode === 'SCANNING' ? C.primary : 'rgba(255,255,255,0.3)',
          letterSpacing:2, marginTop:4 }}>{mode}</div>
      </div>
    </div>
  )
}

function Toast({ msg }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', top:'14%', left:'50%', transform:'translateX(-50%)',
      background:C.panel, border:`1px solid ${C.dim}`,
      padding:'8px 22px', borderRadius:24,
      fontSize:11, letterSpacing:2, color:C.primary,
      zIndex:1000, whiteSpace:'nowrap', pointerEvents:'none',
      boxShadow:`0 0 24px rgba(0,255,204,.2)`,
    }}>{msg}</div>
  )
}

function PointCloud({ points }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current || !points.length) return
    const n = points.length
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const p = points[i]
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z
      const c = p.confidence ?? 0.8
      col[i*3]=0; col[i*3+1]=c; col[i*3+2]=1-c*0.5
    }
    ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(pos,3))
    ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(col,3))
    ref.current.geometry.computeBoundingSphere()
  }, [points])

  return (
    <points ref={ref}>
      <bufferGeometry/>
      <pointsMaterial size={0.02} vertexColors sizeAttenuation transparent opacity={0.95}/>
    </points>
  )
}

function AutoRotate({ active }) {
  useFrame(({ camera }) => {
    if (!active) return
    camera.position.x = Math.sin(Date.now()*0.0003) * 3
    camera.position.z = Math.cos(Date.now()*0.0003) * 3
    camera.lookAt(0,0,0)
  })
  return null
}

export default function ScanView({ goViewer, goScans }) {
  const { points, addPoints, setScanning, scanning, clearPoints, setScanId, scanId, setMode, mode, arReady, setArReady } = useStore()
  const [toast, setToast] = useState('')
  const [apiOk, setApiOk] = useState(false)
  const scanIdRef = useRef(scanId)
  const bufRef = useRef([])
  const pushTimer = useRef(null)

  useEffect(() => { scanIdRef.current = scanId }, [scanId])

  const toast_ = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }, [])

  useEffect(() => {
    healthCheck().then(() => setApiOk(true)).catch(() => setApiOk(false))
    const t = setInterval(() => {
      healthCheck().then(() => setApiOk(true)).catch(() => setApiOk(false))
    }, 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (window.Scan3DBridge) {
      try {
        const ok = window.Scan3DBridge.isARAvailable()
        setArReady(ok)
        console.log('[BRIDGE]', `isARAvailable → ${ok}`)
      } catch(e) {
        console.error('[BRIDGE] erro:', e)
        setArReady(false)
      }
    }
  }, [])

  useEffect(() => {
    window.__onARPoints = (pts) => {
      addPoints(pts)
      bufRef.current.push(...pts)
    }
    window.__onARScanComplete = async (pts) => {
      addPoints(pts)
      setScanning(false)
      setMode('CONCLUÍDO')
      toast_(`✓ ${pts.length.toLocaleString()} PONTOS REAIS`)
      clearInterval(pushTimer.current)
      if (pts.length > 0) {
        try {
          let id = scanIdRef.current
          if (!id) {
            const r = await createScan('Scan ' + new Date().toLocaleTimeString('pt-BR'))
            id = r.id; setScanId(id); scanIdRef.current = id
          }
          await pushPoints(id, pts)
          toast_(`✓ SALVO — ${pts.length.toLocaleString()} PTS`)
        } catch(e) { toast_('ERRO AO SALVAR') }
      }
      window.Scan3DBridge?.vibrate(80)
    }
    window.__onARScanCancelled = () => {
      setScanning(false)
      setMode('CANCELADO')
      toast_('SCAN CANCELADO')
    }
    return () => {
      delete window.__onARPoints
      delete window.__onARScanComplete
      delete window.__onARScanCancelled
    }
  }, [])

  async function startScan() {
    if (!window.Scan3DBridge) { toast_('BRIDGE NATIVA N/D'); return }
    if (!arReady) { toast_('ARCORE NÃO DISPONÍVEL'); return }
    try {
      let id = scanIdRef.current
      if (!id) {
        const r = await createScan('Scan ' + new Date().toLocaleTimeString('pt-BR'))
        id = r.id; setScanId(id); scanIdRef.current = id
      }
      setScanning(true)
      setMode('SCANNING')
      toast_('ABRINDO ARCORE…')
      window.Scan3DBridge.startARScan()
    } catch(e) { toast_('ERRO: ' + e.message) }
  }

  const btn = {
    background:'rgba(0,255,204,.07)', border:`1px solid ${C.dim}`,
    color:C.primary, padding:'12px 16px', borderRadius:10,
    fontSize:10, letterSpacing:2, cursor:'pointer',
    WebkitTapHighlightColor:'transparent', userSelect:'none',
    minWidth:64, textAlign:'center', transition:'all .15s',
  }
  const btnRed = { ...btn, color:C.danger, borderColor:'rgba(255,96,96,.3)', background:'rgba(255,96,96,.05)' }
  const btnActive = { ...btn, background:'rgba(0,255,204,.2)', borderColor:C.primary, boxShadow:`0 0 16px rgba(0,255,204,.3)` }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', position:'fixed', inset:0, background:C.bg }}>
      <HUD pts={points.length} mode={mode} apiOk={apiOk} arReady={arReady} />
      <Toast msg={toast} />

      <Canvas
        style={{ position:'fixed', inset:0, zIndex:1 }}
        camera={{ position:[0,1,3], fov:65, near:0.001, far:500 }}
        gl={{ alpha:false, antialias:true }}
      >
        <color attach="background" args={['#000508']}/>
        <ambientLight intensity={0.4} color="#00ffcc"/>
        <pointLight position={[0,3,0]} intensity={0.6} color="#00ffcc"/>
        <PointCloud points={points}/>
        <AutoRotate active={!scanning && points.length > 0}/>
        <gridHelper args={[20, 40, '#001a0e', '#001208']} position={[0,-1,0]}/>
      </Canvas>

      <div style={{
        position:'fixed', bottom:0, left:0, right:0, zIndex:2,
        padding:'14px 12px 32px',
        background:'linear-gradient(to top,rgba(0,0,0,.95) 70%,transparent)',
      }}>
        <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
          <button style={scanning ? btnActive : btn} onClick={startScan}>
            {scanning ? '● AR ATIVO' : '⬤ SCAN AR'}
          </button>
          <button style={btn} onClick={() => {
            if (points.length < 10) { toast_('FAÇA UM SCAN PRIMEIRO'); return }
            goViewer()
          }}>◎ VER 3D</button>
          <button style={btn} onClick={goScans}>☰ SALVOS</button>
          <button style={btnRed} onClick={() => { clearPoints(); toast_('RESETADO') }}>✕ RESET</button>
        </div>
        {scanning && (
          <div style={{ textAlign:'center', marginTop:10, fontSize:9, color:'rgba(0,255,204,.45)', letterSpacing:2 }}>
            ARCORE ATIVO — MOVA O CELULAR DEVAGAR
          </div>
        )}
      </div>
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/components/ScanView.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/ScansPanel.jsx
```
import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { listScans, deleteScan, loadPoints } from '../api'

export default function ScansPanel({ goBack }) {
  const [scans, setScans]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const { setPoints, setScanId } = useStore()

  const load = async () => {
    setLoading(true)
    try { setScans(await listScans()) }
    catch (e) { console.error('[SCANS]', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleLoad(scan) {
    setLoadingId(scan.id)
    try {
      const pts = await loadPoints(scan.id)
      setPoints(pts); setScanId(scan.id)
      goBack()
    } catch(e) { console.error('[LOAD]', e.message) }
    finally { setLoadingId(null) }
  }

  async function handleDelete(id) {
    setDeleting(id)
    try { await deleteScan(id); setScans(s => s.filter(x => x.id !== id)) }
    catch(e) { console.error('[DEL]', e.message) }
    finally { setDeleting(null) }
  }

  const btn = {
    background:'rgba(0,255,204,.07)', border:'1px solid rgba(0,255,204,.22)',
    color:'#00ffcc', padding:'8px 12px', borderRadius:8,
    fontSize:10, letterSpacing:1, cursor:'pointer',
    WebkitTapHighlightColor:'transparent',
  }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', background:'#000508', display:'flex', flexDirection:'column', position:'fixed', inset:0 }}>
      <div style={{
        padding:'12px 16px', background:'rgba(0,0,0,.9)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.1)',
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ SCANS SALVOS</span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={btn} onClick={load} disabled={loading}>↺</button>
          <button style={btn} onClick={goBack}>← VOLTAR</button>
        </div>
      </div>
      <div style={{ flex:1, overflow:'auto', padding:12, display:'flex', flexDirection:'column', gap:8 }}>
        {loading && (
          <div style={{ color:'rgba(0,255,204,.35)', textAlign:'center', marginTop:60, letterSpacing:2, fontSize:11 }}>
            CARREGANDO…
          </div>
        )}
        {!loading && !scans.length && (
          <div style={{ color:'rgba(0,255,204,.2)', textAlign:'center', marginTop:80, fontSize:11, letterSpacing:2 }}>
            NENHUM SCAN<br/><span style={{ fontSize:9 }}>FAÇA SEU PRIMEIRO SCAN AR</span>
          </div>
        )}
        {scans.map(s => (
          <div key={s.id} style={{
            background:'rgba(0,255,204,.03)', border:'1px solid rgba(0,255,204,.12)',
            borderRadius:10, padding:'12px 14px',
            display:'flex', justifyContent:'space-between', alignItems:'center',
          }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:'#00ffcc', fontSize:12, letterSpacing:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {s.name}
              </div>
              <div style={{ color:'rgba(0,255,204,.35)', fontSize:9, marginTop:4, letterSpacing:.5 }}>
                {Number(s.point_count).toLocaleString()} pts · {new Date(s.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginLeft:10 }}>
              <button style={{ ...btn, opacity: loadingId===s.id?.5:1 }} onClick={() => handleLoad(s)} disabled={loadingId===s.id}>
                {loadingId===s.id ? '…' : '▶'}
              </button>
              <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)', opacity: deleting===s.id?.5:1 }}
                onClick={() => handleDelete(s.id)} disabled={deleting===s.id}>
                {deleting===s.id ? '…' : '✕'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/components/ScansPanel.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/Viewer3D.jsx
```
import React, { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'

function PointCloud({ points }) {
  const ref = useRef()

  const { positions, colors } = useMemo(() => {
    if (!points.length) return { positions: new Float32Array(0), colors: new Float32Array(0) }
    let cx=0, cy=0, cz=0
    for (const p of points) { cx+=p.x; cy+=p.y; cz+=p.z }
    cx/=points.length; cy/=points.length; cz/=points.length
    const positions = new Float32Array(points.length*3)
    const colors    = new Float32Array(points.length*3)
    for (let i=0;i<points.length;i++) {
      const p=points[i]; const c=p.confidence??0.8
      positions[i*3]=p.x-cx; positions[i*3+1]=p.y-cy; positions[i*3+2]=p.z-cz
      colors[i*3]=0; colors[i*3+1]=c; colors[i*3+2]=1-c*0.5
    }
    return { positions, colors }
  }, [points])

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length/3} array={positions} itemSize={3}/>
        <bufferAttribute attach="attributes-color" count={colors.length/3} array={colors} itemSize={3}/>
      </bufferGeometry>
      <pointsMaterial size={0.022} vertexColors sizeAttenuation transparent opacity={0.95}/>
    </points>
  )
}

export default function Viewer3D({ goBack }) {
  const points = useStore(s => s.points)
  const [autoRotate, setAutoRotate] = useState(true)

  const btn = {
    background:'rgba(0,255,204,.07)', border:'1px solid rgba(0,255,204,.25)',
    color:'#00ffcc', padding:'9px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
    WebkitTapHighlightColor:'transparent',
  }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', display:'flex', flexDirection:'column', background:'#000508', position:'fixed', inset:0 }}>
      <div style={{
        padding:'12px 16px', background:'rgba(0,0,0,.9)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.1)',
      }}>
        <span style={{ fontSize:13, letterSpacing:5, color:'#00ffcc' }}>◈ VIEWER 3D</span>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:9, color:'rgba(0,255,204,.45)', letterSpacing:1 }}>
            {points.length.toLocaleString()} PTS
          </span>
          <button style={btn} onClick={() => setAutoRotate(v => !v)}>
            {autoRotate ? '⏸ AUTO' : '▶ AUTO'}
          </button>
          <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>
            ✕
          </button>
        </div>
      </div>
      <div style={{ flex:1, position:'relative' }}>
        <Canvas camera={{ position:[0,1.5,4], fov:60 }} gl={{ antialias:true }}>
          <color attach="background" args={['#000508']}/>
          <ambientLight intensity={0.5}/>
          <directionalLight position={[5,10,5]} intensity={0.7} color="#00ffcc"/>
          {points.length > 0 ? <PointCloud points={points}/> : null}
          <Grid args={[20,20]} position={[0,-1,0]} cellColor="#001a0e" sectionColor="#003322" fadeDistance={15}/>
          <OrbitControls enableDamping dampingFactor={0.07}
            autoRotate={autoRotate} autoRotateSpeed={0.5}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
            minDistance={0.3} maxDistance={30}/>
        </Canvas>
        {!points.length && (
          <div style={{
            position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            color:'rgba(0,255,204,.25)', fontSize:11, letterSpacing:2, textAlign:'center', pointerEvents:'none',
          }}>
            SEM PONTOS<br/><span style={{ fontSize:9 }}>FAÇA UM SCAN AR</span>
          </div>
        )}
      </div>
      <div style={{
        padding:'10px', background:'rgba(0,0,0,.8)',
        borderTop:'1px solid rgba(0,255,204,.07)',
        textAlign:'center', fontSize:9, color:'rgba(0,255,204,.3)', letterSpacing:2,
      }}>
        1 DEDO = ORBITAR · 2 DEDOS = ZOOM/PAN
      </div>
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/components/Viewer3D.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/main.jsx
```
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')).render(<App />)
```
### Fim do arquivo: ./scan3d-react/packages/client/src/main.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/store.js
```
import { create } from 'zustand'

const MAX = 15000

export const useStore = create((set, get) => ({
  scanId: null,
  scanning: false,
  points: [],
  mode: 'IDLE',
  arReady: false,

  setScanId: (id) => set({ scanId: id }),
  setScanning: (v) => set({ scanning: v }),
  setMode: (mode) => set({ mode }),
  setArReady: (v) => set({ arReady: v }),

  addPoints: (pts) => {
    const current = get().points
    const merged = [...current, ...pts]
    set({ points: merged.length > MAX ? merged.slice(-MAX) : merged })
  },

  setPoints: (pts) => set({ points: pts.slice(-MAX) }),
  clearPoints: () => set({ points: [], scanId: null, mode: 'IDLE', scanning: false }),
}))
```
### Fim do arquivo: ./scan3d-react/packages/client/src/store.js
---
### Início do arquivo: ./scan3d-react/packages/client/vite.config.js
```
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../../..', 'app/src/main/assets'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          fiber: ['@react-three/fiber', '@react-three/drei'],
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  }
})
```
### Fim do arquivo: ./scan3d-react/packages/client/vite.config.js
---
### Início do arquivo: ./settings.gradle
```
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Scan3D"
include ':app'
```
### Fim do arquivo: ./settings.gradle
