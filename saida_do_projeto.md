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
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
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
import org.json.JSONObject

class MainActivity : AppCompatActivity(), SensorEventListener {

    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    private lateinit var sensorManager: SensorManager
    private var gyroscope: Sensor? = null
    private var accelerometer: Sensor? = null
    private var rotationVector: Sensor? = null

    private val handler = Handler(Looper.getMainLooper())
    private var sensorRunning = false

    private var lastAlpha = 0.0
    private var lastBeta  = 0.0
    private var lastGamma = 0.0
    private var lastAx    = 0.0
    private var lastAy    = 0.0
    private var lastAz    = 0.0

    private val rotMatrix   = FloatArray(9)
    private val orientation = FloatArray(3)

    companion object {
        const val REQ_CAMERA = 101
        const val SERVER_URL = "http://localhost:5173"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        sensorManager  = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        gyroscope      = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        accelerometer  = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
        rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

        val root = android.widget.FrameLayout(this)
        webView = WebView(this)
        root.addView(webView, android.widget.FrameLayout.LayoutParams(
            android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            android.widget.FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val btnLog = Button(this).apply {
            text = "📋"; textSize = 14f; stateListAnimator = null
            setBackgroundColor(0xCC1a1a26.toInt()); setTextColor(0xFF00ffcc.toInt())
            setPadding(dp(6), dp(4), dp(6), dp(4)); alpha = 0.8f
        }
        btnLog.setOnClickListener { showLogDialog() }
        root.addView(btnLog, android.widget.FrameLayout.LayoutParams(dp(44), dp(38)).apply {
            gravity = Gravity.TOP or Gravity.END; topMargin = dp(48); rightMargin = dp(8)
        })

        setContentView(root)
        setupWebView()
        checkCamera()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled                = true
            domStorageEnabled                = true
            databaseEnabled                  = true
            allowFileAccess                  = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode                 = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode                        = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls              = false
            useWideViewPort                  = true
            loadWithOverviewMode             = true
            userAgentString                  = "$userAgentString Scan3DApp/1.0"
        }

        webView.addJavascriptInterface(Scan3DBridge(), "Scan3DBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                view.evaluateJavascript("""
                    (function(){
                        window.__NATIVE_SENSORS__ = true;
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
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                DebugLog.e(DebugLog.Tag.WEBVIEW, "Erro ${error.errorCode}: ${error.description} — ${request.url}")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    DebugLog.log(DebugLog.Tag.CAMERA, "Grant câmera WebView")
                    request.grant(request.resources)
                } else {
                    pendingPermissionRequest = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity, arrayOf(Manifest.permission.CAMERA), REQ_CAMERA
                    )
                }
            }
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val tag = if (msg.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    DebugLog.Tag.ERRO else DebugLog.Tag.WEBVIEW
                DebugLog.log(tag, "[JS] ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
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
                "SENSOR" -> DebugLog.Tag.SENSOR
                "ERRO", "ERROR" -> DebugLog.Tag.ERRO
                else -> DebugLog.Tag.SYS
            }
            DebugLog.log(t, "[JS] $msg")
        }

        @JavascriptInterface
        fun isCameraGranted(): Boolean =
            ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun hasSensors(): Boolean =
            rotationVector != null || (gyroscope != null && accelerometer != null)

        @JavascriptInterface
        fun startSensors() {
            handler.post { registerSensors() }
            DebugLog.log(DebugLog.Tag.SENSOR, "startSensors()")
        }

        @JavascriptInterface
        fun stopSensors() {
            handler.post { unregisterSensors() }
            DebugLog.log(DebugLog.Tag.SENSOR, "stopSensors()")
        }

        @JavascriptInterface
        fun vibrate(ms: Long) {
            val v = getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator ?: return
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                v.vibrate(android.os.VibrationEffect.createOneShot(ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            else @Suppress("DEPRECATION") v.vibrate(ms)
        }
    }

    private fun registerSensors() {
        if (sensorRunning) return
        sensorRunning = true
        rotationVector?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        } ?: run {
            gyroscope?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        }
        accelerometer?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
        DebugLog.log(DebugLog.Tag.SENSOR, "Sensores registrados — rv=${rotationVector != null} acc=${accelerometer != null}")
    }

    private fun unregisterSensors() {
        sensorRunning = false
        sensorManager.unregisterListener(this)
        DebugLog.log(DebugLog.Tag.SENSOR, "Sensores removidos")
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR -> {
                SensorManager.getRotationMatrixFromVector(rotMatrix, event.values)
                SensorManager.getOrientation(rotMatrix, orientation)
                lastAlpha = Math.toDegrees(orientation[0].toDouble())
                lastBeta  = Math.toDegrees(orientation[1].toDouble())
                lastGamma = Math.toDegrees(orientation[2].toDouble())
                pushOrientation()
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                lastAx = event.values[0].toDouble()
                lastAy = event.values[1].toDouble()
                lastAz = event.values[2].toDouble()
                pushAcceleration()
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}

    private fun pushOrientation() {
        val js = "window.__onNativeOrientation && window.__onNativeOrientation(${lastAlpha},${lastBeta},${lastGamma})"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun pushAcceleration() {
        val js = "window.__onNativeAcceleration && window.__onNativeAcceleration(${lastAx},${lastAy},${lastAz})"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun checkCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED) {
            loadApp()
        } else {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
        }
    }

    private fun loadApp() {
        DebugLog.log(DebugLog.Tag.SYS, "loadUrl → $SERVER_URL")
        webView.loadUrl(SERVER_URL)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_CAMERA -> {
                val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    pendingPermissionRequest?.grant(pendingPermissionRequest!!.resources)
                    pendingPermissionRequest = null
                    loadApp()
                } else {
                    pendingPermissionRequest?.deny()
                    pendingPermissionRequest = null
                    DebugLog.e(DebugLog.Tag.CAMERA, "Câmera negada pelo usuário")
                    loadApp()
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 3001) {
            fileUploadCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data) ?: arrayOf()
            )
            fileUploadCallback = null
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
                    DebugLog.Tag.CAMERA -> 0xFFffb800.toInt()
                    DebugLog.Tag.SENSOR -> 0xFF00ffcc.toInt()
                    DebugLog.Tag.BRIDGE -> 0xFF5b8cff.toInt()
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
    override fun onPause()   { super.onPause();   webView.onPause(); unregisterSensors() }
    override fun onDestroy() { unregisterSensors(); webView.destroy(); super.onDestroy() }
    override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }
}
```
### Fim do arquivo: ./app/src/main/java/com/scan3d/app/MainActivity.kt
---
### Início do arquivo: ./app/src/main/res/drawable/ic_launcher.xml
```
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#030b07" android:pathData="M0,0h108v108h-108z"/>
    <circle android:fillColor="#00ffcc" android:centerX="54" android:centerY="54" android:radius="28dp"/>
    <path android:fillColor="#030b07" android:pathData="M54,26 L54,38"/>
    <path android:fillColor="#030b07" android:pathData="M54,70 L54,82"/>
    <path android:fillColor="#030b07" android:pathData="M26,54 L38,54"/>
    <path android:fillColor="#030b07" android:pathData="M70,54 L82,54"/>
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
        <item name="android:textColorPrimary">#e8e8f0</item>
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
        <domain includeSubdomains="true">192.168.15.16</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```
### Fim do arquivo: ./app/src/main/res/xml/network_security_config.xml
---
### Início do arquivo: ./app/src/main/AndroidManifest.xml
```
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <uses-feature android:name="android.hardware.camera" android:required="true" />
    <uses-feature android:name="android.hardware.sensor.gyroscope" android:required="false" />
    <uses-feature android:name="android.hardware.sensor.accelerometer" android:required="false" />

    <application
        android:allowBackup="false"
        android:icon="@drawable/ic_launcher"
        android:label="SCAN3D"
        android:theme="@style/Theme.Scan3D"
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="portrait"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>
</manifest>
```
### Fim do arquivo: ./app/src/main/AndroidManifest.xml
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
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        debug   { minifyEnabled false; debuggable true }
        release {
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    buildFeatures { viewBinding true }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = '17' }
}

dependencies {
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.webkit:webkit:1.8.0'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
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
```
### Fim do arquivo: ./app/proguard-rules.pro
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
### Início do arquivo: ./build.gradle
```
plugins {
    id 'com.android.application' version '8.2.0' apply false
    id 'org.jetbrains.kotlin.android' version '1.9.22' apply false
}
```
### Fim do arquivo: ./build.gradle
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
---
### Início do arquivo: ./gradle.properties
```
android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m
```
### Fim do arquivo: ./gradle.properties
---
### Início do arquivo: ./gradlew
```
#!/bin/sh
DIRNAME="$(dirname "$0")"
exec "$DIRNAME/gradle/wrapper/gradle-wrapper.jar" "$@"
```
### Fim do arquivo: ./gradlew
---
### Início do arquivo: ./codemagic.yaml
```
workflows:
  android-scan3d:
    name: SCAN3D APK
    max_build_duration: 60
    instance_type: mac_mini_m2

    environment:
      java: 17

    scripts:
      - name: Setup
        script: |
          cd $CM_BUILD_DIR
          echo "sdk.dir=$ANDROID_SDK_ROOT" > local.properties
          gradle wrapper --gradle-version=8.2

      - name: Build debug APK
        script: |
          cd $CM_BUILD_DIR
          ./gradlew assembleDebug --stacktrace

    artifacts:
      - app/build/outputs/apk/debug/*.apk
```
### Fim do arquivo: ./codemagic.yaml
---
### Início do arquivo: ./scan3d-react/packages/server/src/index.js
```
const express = require('express')
const cors = require('cors')
const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3001
const DB_PATH = path.join(__dirname, '../scan3d.db.json')

app.use(cors())
app.use(express.json({ limit: '50mb' }))

let db = null

const L = (tag, msg, extra = '') => {
  const t = new Date().toISOString().slice(11, 23)
  console.log(`[${t}] [${tag.padEnd(8)}] ${msg}${extra ? ' '+JSON.stringify(extra) : ''}`)
}

async function initDB() {
  L('DB', 'Iniciando sql.js...')
  const SQL = await initSqlJs()
  if (fs.existsSync(DB_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
      db = new SQL.Database(Buffer.from(saved.data))
      L('DB', 'Carregado do disco ✓')
    } catch (e) {
      L('DB', 'Erro ao carregar, criando novo:', e.message)
      db = new SQL.Database()
    }
  } else {
    db = new SQL.Database()
    L('DB', 'Novo banco criado ✓')
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scan_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      x REAL, y REAL, z REAL,
      confidence REAL, ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS ar_objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      name TEXT, type TEXT,
      px REAL, py REAL, pz REAL,
      sx REAL, sy REAL, sz REAL,
      rx REAL, ry REAL, rz REAL
    );
  `)
  persist()
}

function persist() {
  if (!db) return
  try {
    const data = db.export()
    fs.writeFileSync(DB_PATH, JSON.stringify({ data: Array.from(data) }))
  } catch (e) {
    L('DB', 'Erro ao persistir:', e.message)
  }
}

setInterval(persist, 15000)

function rows(result) {
  if (!result.length) return []
  const cols = result[0].columns
  return result[0].values.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])))
}

// ── SCANS ──────────────────────────────────────────
app.get('/api/scans', (req, res) => {
  try {
    const result = db.exec(`
      SELECT s.id, s.name, s.created_at, COUNT(p.id) as point_count
      FROM scans s LEFT JOIN scan_points p ON p.scan_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC
    `)
    const data = rows(result)
    L('GET', `/api/scans → ${data.length} registros`)
    res.json(data)
  } catch (e) {
    L('ERR', 'GET /api/scans', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/scans', (req, res) => {
  try {
    const name = req.body.name || 'Scan ' + new Date().toLocaleTimeString('pt-BR')
    db.run('INSERT INTO scans(name, created_at) VALUES(?, ?)', [name, Date.now()])
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
    persist()
    L('POST', `/api/scans → id=${id} name="${name}"`)
    res.json({ id })
  } catch (e) {
    L('ERR', 'POST /api/scans', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/scans/:id', (req, res) => {
  try {
    const { id } = req.params
    db.run('DELETE FROM scan_points WHERE scan_id=?', [id])
    db.run('DELETE FROM ar_objects WHERE scan_id=?', [id])
    db.run('DELETE FROM scans WHERE id=?', [id])
    persist()
    L('DEL', `/api/scans/${id}`)
    res.json({ ok: true })
  } catch (e) {
    L('ERR', `DELETE /api/scans/${req.params.id}`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── POINTS ─────────────────────────────────────────
app.post('/api/scans/:id/points', (req, res) => {
  try {
    const scanId = Number(req.params.id)
    const points = req.body.points
    if (!Array.isArray(points) || !points.length) return res.json({ ok: true, inserted: 0 })
    const stmt = db.prepare('INSERT INTO scan_points(scan_id,x,y,z,confidence,ts) VALUES(?,?,?,?,?,?)')
    for (const p of points) stmt.run([scanId, p.x, p.y, p.z, p.confidence, p.ts || Date.now()])
    stmt.free()
    L('POST', `/api/scans/${scanId}/points → +${points.length} pts`)
    res.json({ ok: true, inserted: points.length })
  } catch (e) {
    L('ERR', `POST /api/scans/${req.params.id}/points`, e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/scans/:id/points', (req, res) => {
  try {
    const scanId = Number(req.params.id)
    const result = db.exec(`SELECT x,y,z,confidence FROM scan_points WHERE scan_id=${scanId}`)
    const data = rows(result)
    L('GET', `/api/scans/${scanId}/points → ${data.length} pts`)
    res.json(data)
  } catch (e) {
    L('ERR', `GET /api/scans/${req.params.id}/points`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── OBJECTS ────────────────────────────────────────
app.post('/api/scans/:id/objects', (req, res) => {
  try {
    const o = req.body
    const scanId = req.params.id
    db.run(
      'INSERT INTO ar_objects(scan_id,name,type,px,py,pz,sx,sy,sz,rx,ry,rz) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [scanId, o.name||'', o.type||'cube', o.px||0,o.py||0,o.pz||0, o.sx||1,o.sy||1,o.sz||1, o.rx||0,o.ry||0,o.rz||0]
    )
    persist()
    L('POST', `/api/scans/${scanId}/objects type=${o.type}`)
    res.json({ ok: true })
  } catch (e) {
    L('ERR', `POST /api/scans/${req.params.id}/objects`, e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/scans/:id/objects', (req, res) => {
  try {
    const scanId = Number(req.params.id)
    const result = db.exec(`SELECT * FROM ar_objects WHERE scan_id=${scanId}`)
    const data = rows(result)
    L('GET', `/api/scans/${scanId}/objects → ${data.length}`)
    res.json(data)
  } catch (e) {
    L('ERR', `GET /api/scans/${req.params.id}/objects`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── HEALTH ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const result = db.exec('SELECT COUNT(*) as n FROM scans')
  const n = result[0]?.values[0][0] ?? 0
  res.json({ ok: true, scans: n, ts: Date.now() })
})

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    L('SERVER', `✓ API rodando em http://0.0.0.0:${PORT}`)
    L('SERVER', `✓ DB em ${DB_PATH}`)
  })
}).catch(e => {
  console.error('FATAL initDB:', e)
  process.exit(1)
})
```
### Fim do arquivo: ./scan3d-react/packages/server/src/index.js
---
### Início do arquivo: ./scan3d-react/packages/server/package.json
```
{
  "name": "@scan3d/server",
  "version": "1.0.0",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "sql.js": "^1.10.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.3"
  }
}
```
### Fim do arquivo: ./scan3d-react/packages/server/package.json
---
### Início do arquivo: ./scan3d-react/packages/server/scan3d.db.json
```
```
### Fim do arquivo: ./scan3d-react/packages/server/scan3d.db.json
---
### Início do arquivo: ./scan3d-react/packages/server/nodemon.json
```
{
  "ignore": ["*.db.json"],
  "delay": 300
}
```
### Fim do arquivo: ./scan3d-react/packages/server/nodemon.json
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/ScanView.jsx
```
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { createScan, pushPoints } from '../api'

function useVisualViewportOffsets() {
  const [offsets, setOffsets] = useState({ bottom: 0, top: 0, height: window.innerHeight })
  useEffect(() => {
    const vv = window.visualViewport
    const update = () => {
      if (!vv) { setOffsets({ bottom: 0, top: 0, height: window.innerHeight }); return }
      setOffsets({
        bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
        top: Math.max(0, vv.offsetTop),
        height: vv.height
      })
    }
    update()
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update) }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      if (vv) { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return offsets
}

function HUD({ pts, fps, mode, alpha, beta, gamma, apiOk, topOffset }) {
  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, zIndex:1000, pointerEvents:'none',
      paddingTop: `calc(env(safe-area-inset-top) + ${topOffset}px + 10px)`,
      paddingLeft:14, paddingRight:14, paddingBottom:10,
      background:'linear-gradient(to bottom, rgba(0,0,0,.82) 0%, transparent 100%)',
      display:'flex', justifyContent:'space-between', alignItems:'flex-start',
    }}>
      <div>
        <div style={{ fontSize:14, letterSpacing:5, color:'#00ffcc', textShadow:'0 0 14px #00ffcc66' }}>◈ SCAN3D</div>
        <div style={{ fontSize:9, color: apiOk ? '#00ffcc88' : '#ff606088', letterSpacing:1, marginTop:2 }}>
          {apiOk ? '● API OK' : '✕ SEM API'}
        </div>
      </div>
      <div style={{ fontSize:9, color:'#00ffcc88', lineHeight:2, textAlign:'right', letterSpacing:1 }}>
        <span style={{ color:'#00ffcc', fontSize:11, fontWeight:'bold' }}>{pts.toLocaleString()}</span> PTS<br/>
        {fps} FPS<br/>
        α{alpha} β{beta} γ{gamma}<br/>
        <span style={{ color: mode === 'SCANNING' ? '#00ffcc' : '#ffffff55' }}>{mode}</span>
      </div>
    </div>
  )
}

function Cross({ active }) {
  const c = active ? '#00ffcc' : 'rgba(255,255,255,.3)'
  return (
    <div style={{
      position:'fixed', top:'50%', left:'50%',
      transform:'translate(-50%,-50%)',
      width:40, height:40, pointerEvents:'none', zIndex:10,
    }}>
      <div style={{ position:'absolute', width:1, height:'100%', left:'50%', background:c, opacity:.7 }}/>
      <div style={{ position:'absolute', width:'100%', height:1, top:'50%', background:c, opacity:.7 }}/>
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        width: active ? 7 : 4, height: active ? 7 : 4,
        background: c, borderRadius:'50%',
        transform:'translate(-50%,-50%)',
        boxShadow: active ? `0 0 12px ${c}` : 'none',
        transition:'all .2s',
      }}/>
    </div>
  )
}

function Toast({ msg, topOffset }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', top:`calc(env(safe-area-inset-top) + ${topOffset + 68}px)`, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,.85)', border:'1px solid rgba(0,255,204,.35)',
      padding:'7px 20px', borderRadius:20,
      fontSize:11, letterSpacing:1.5, color:'#00ffcc',
      zIndex:1000, whiteSpace:'nowrap', pointerEvents:'none',
      boxShadow:'0 0 20px rgba(0,255,204,.15)',
    }}>
      {msg}
    </div>
  )
}

function PointCloud({ points }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const n = points.length
    if (n === 0) {
      ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      return
    }
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const p = points[i]
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z
      const c=p.confidence??0.8
      col[i*3]=0; col[i*3+1]=c; col[i*3+2]=1-c
    }
    ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
    ref.current.geometry.computeBoundingSphere()
  }, [points])
  return (
    <points ref={ref}>
      <bufferGeometry/>
      <pointsMaterial size={0.018} vertexColors sizeAttenuation transparent opacity={0.9}/>
    </points>
  )
}

function CamController({ alpha, beta, gamma }) {
  const { camera } = useThree()
  useFrame(() => {
    camera.rotation.set(THREE.MathUtils.degToRad(beta), THREE.MathUtils.degToRad(alpha), -THREE.MathUtils.degToRad(gamma), 'YXZ')
  })
  return null
}

function ARCube({ position }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.getElapsedTime() * 0.6
    ref.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 1.2) * 0.04
  })
  return (
    <mesh ref={ref} position={position}>
      <boxGeometry args={[0.18,0.18,0.18]}/>
      <meshStandardMaterial color="#00ffcc" metalness={0.6} roughness={0.2} emissive="#002211"/>
    </mesh>
  )
}

export default function ScanView({ goViewer, goScans }) {
  const { scanning, points, arObjects, mode, addPoints, setScanning, clearPoints, setScanId, scanId, setMode, addArObject } = useStore()
  const [fps, setFps] = useState(0)
  const [alpha, setAlpha] = useState(0)
  const [beta, setBeta] = useState(0)
  const [gamma, setGamma] = useState(0)
  const [toast, setToast] = useState('')
  const [apiOk, setApiOk] = useState(false)
  const [camErr, setCamErr] = useState(false)
  const [isFs, setIsFs] = useState(!!document.fullscreenElement)
  const { bottom: bottomOffset, top: topOffset } = useVisualViewportOffsets()
  const vidRef = useRef(null)
  const sensorRef = useRef({ alpha:0, beta:0, gamma:0, ax:0, ay:0, az:0 })
  const posRef = useRef({ px:0, py:0, pz:0, vx:0, vy:0, vz:0, lastTime:Date.now() })
  const bufRef = useRef([])
  const scanTimer = useRef(null)
  const pushTimer = useRef(null)
  const fpsRef = useRef({ count:0, last:Date.now() })
  const scanIdRef = useRef(scanId)
  useEffect(() => { scanIdRef.current = scanId }, [scanId])

  const toast_ = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2400)
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{})
    else document.documentElement.requestFullscreen().catch(()=>toast_('TELA CHEIA INDISPONÍVEL'))
  }

  useEffect(() => {
    fetch('/api/health').then(r=>r.ok&&setApiOk(true)).catch(()=>setApiOk(false))
    const t=setInterval(()=>{fetch('/api/health').then(r=>r.ok?setApiOk(true):setApiOk(false)).catch(()=>setApiOk(false))},5000)
    return ()=>clearInterval(t)
  }, [])

  useEffect(() => {
    const vid = document.createElement('video')
    vid.setAttribute('playsinline','')
    vid.muted = true
    vid.autoplay = true
    Object.assign(vid.style, {
      position:'fixed', top:0, left:0, width:'100%', height:'100%',
      objectFit:'cover', zIndex:0, pointerEvents:'none',
    })
    document.body.prepend(vid)
    vidRef.current = vid

    navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment', width:{ ideal:1280 } }, audio:false })
      .then(stream => { vid.srcObject = stream; vid.play(); toast_('CÂMERA ATIVA ●') })
      .catch(() => { setCamErr(true); toast_('SEM CÂMERA — MODO DEMO') })

    return () => {
      vid.srcObject?.getTracks().forEach(t=>t.stop())
      vid.remove()
    }
  }, [])

  // ═══════════════════════════════════════════════════════
  // PATCH: BRIDGE NATIVA + FALLBACK
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (window.__NATIVE_SENSORS__ && window.Scan3DBridge) {
      // bridge nativa — dados chegam via evaluateJavascript do Kotlin
      window.__onNativeOrientation = (a, b, g) => {
        sensorRef.current.alpha = a
        sensorRef.current.beta  = b
        sensorRef.current.gamma = g
        setAlpha(Math.round(a))
        setBeta(Math.round(b))
        setGamma(Math.round(g))
      }
      window.__onNativeAcceleration = (ax, ay, az) => {
        sensorRef.current.ax = ax
        sensorRef.current.ay = ay
        sensorRef.current.az = az
      }
      window.Scan3DBridge.startSensors()
      return () => {
        window.Scan3DBridge.stopSensors()
        delete window.__onNativeOrientation
        delete window.__onNativeAcceleration
      }
    } else {
      // fallback browser — deviceorientation original
      const onOri = e => {
        sensorRef.current.alpha = e.alpha||0
        sensorRef.current.beta  = e.beta||0
        sensorRef.current.gamma = e.gamma||0
        setAlpha(Math.round(e.alpha||0))
        setBeta(Math.round(e.beta||0))
        setGamma(Math.round(e.gamma||0))
      }
      const onMot = e => {
        const a = e.acceleration||{}
        sensorRef.current.ax = a.x||0
        sensorRef.current.ay = a.y||0
        sensorRef.current.az = a.z||0
      }
      window.addEventListener('deviceorientation', onOri, true)
      window.addEventListener('devicemotion', onMot, true)
      return () => {
        window.removeEventListener('deviceorientation', onOri, true)
        window.removeEventListener('devicemotion', onMot, true)
      }
    }
  }, [])
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setFps(Math.round(fpsRef.current.count / Math.max((now - fpsRef.current.last)/1000, 0.001)))
      fpsRef.current.count = 0
      fpsRef.current.last = now
    }, 1000)
    return () => clearInterval(id)
  }, [])

  function capturePoint() {
    fpsRef.current.count++
    const { alpha:a, beta:b, ax, ay, az } = sensorRef.current
    const pos = posRef.current
    const now = Date.now()
    const dt = Math.min((now - pos.lastTime)/1000, 0.08)
    pos.lastTime = now
    pos.vx = (pos.vx + ax*dt)*0.9
    pos.vy = (pos.vy + ay*dt)*0.9
    pos.vz = (pos.vz + az*dt)*0.9
    pos.px += pos.vx*dt
    pos.py += pos.vy*dt
    pos.pz += pos.vz*dt
    const aR = THREE.MathUtils.degToRad(a)
    const bR = THREE.MathUtils.degToRad(b)
    const batch = []
    for (let i=0; i<5; i++) {
      const spread = 0.25
      const d = 0.4 + Math.random()*3.5
      batch.push({
        x: pos.px + Math.sin(aR+(Math.random()-.5)*spread)*Math.cos(bR+(Math.random()-.5)*spread)*d,
        y: pos.py + Math.sin(bR+(Math.random()-.5)*spread)*d,
        z: pos.pz - Math.cos(aR+(Math.random()-.5)*spread)*Math.cos(bR+(Math.random()-.5)*spread)*d,
        confidence: 1-d/5, ts: now,
      })
    }
    bufRef.current.push(...batch)
    addPoints(batch)
  }

  async function startScan() {
    let id = scanIdRef.current
    if (!id) {
      try {
        const r = await createScan('Scan '+new Date().toLocaleTimeString('pt-BR'))
        id = r.id; setScanId(id); scanIdRef.current = id
      } catch (e) { toast_('ERRO AO CRIAR SCAN'); return }
    }
    setScanning(true); setMode('SCANNING'); toast_('SCANNING — MOVA O CELULAR')
    scanTimer.current = setInterval(capturePoint, 280)
    pushTimer.current = setInterval(async () => {
      if (bufRef.current.length > 0 && scanIdRef.current) {
        const batch = bufRef.current.splice(0, 150)
        try { await pushPoints(scanIdRef.current, batch) }
        catch (e) { bufRef.current.unshift(...batch) }
      }
    }, 2000)
  }

  async function stopScan() {
    clearInterval(scanTimer.current); clearInterval(pushTimer.current)
    if (bufRef.current.length > 0 && scanIdRef.current) {
      try { await pushPoints(scanIdRef.current, bufRef.current.splice(0)) }
      catch (e) { console.error('[STOP] flush falhou:', e.message) }
    }
    setScanning(false); setMode('PARADO')
    toast_(`PARADO — ${useStore.getState().points.length.toLocaleString()} PTS`)
  }

  function handleClear() {
    clearInterval(scanTimer.current); clearInterval(pushTimer.current)
    clearPoints()
    posRef.current = { px:0, py:0, pz:0, vx:0, vy:0, vz:0, lastTime:Date.now() }
    bufRef.current = []
    toast_('RESETADO')
  }

  function handleAddCube() {
    addArObject({ id: Date.now(), type:'cube', position:[0,0,-1.2] })
    toast_('CUBO AR ADICIONADO')
  }

  const btn = {
    background:'rgba(0,255,204,.06)', border:'1px solid rgba(0,255,204,.25)',
    color:'#00ffcc', padding:'11px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
    WebkitTapHighlightColor:'transparent', userSelect:'none',
    minWidth:60, textAlign:'center',
  }
  const btnRed = { ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)', background:'rgba(255,96,96,.05)' }
  const btnActive = { ...btn, background:'rgba(0,255,204,.18)', borderColor:'rgba(0,255,204,.6)', boxShadow:'0 0 12px rgba(0,255,204,.3)' }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh, 1vh) * 100)', position:'fixed', inset:0 }}>

      <HUD pts={points.length} fps={fps} mode={mode} alpha={alpha} beta={beta} gamma={gamma} apiOk={apiOk} topOffset={topOffset}/>
      <Cross active={scanning}/>
      <Toast msg={toast} topOffset={topOffset}/>

      {camErr && (
        <div style={{
          position:'fixed', top:'45%', left:'50%', transform:'translate(-50%,-50%)',
          color:'rgba(255,255,255,.3)', fontSize:11, letterSpacing:2, textAlign:'center',
          pointerEvents:'none', zIndex:5,
        }}>
          SEM CÂMERA<br/><span style={{ fontSize:9, opacity:.6 }}>MODO SIMULAÇÃO</span>
        </div>
      )}

      <Canvas
        style={{ position:'fixed', top:0, left:0, width:'100%', height:'100%', zIndex:1, pointerEvents:'none' }}
        camera={{ position:[0,0,0.001], fov:70, near:0.001, far:500 }}
        gl={{ alpha:true, antialias:true, preserveDrawingBuffer:false }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.setClearAlpha(0) }}
      >
        <ambientLight intensity={0.4} color="#00ffcc"/>
        <directionalLight position={[3,8,5]} intensity={0.8}/>
        <CamController alpha={alpha} beta={beta} gamma={gamma}/>
        <PointCloud points={points}/>
        {arObjects.map(o => o.type==='cube' && <ARCube key={o.id} position={o.position}/>)}
      </Canvas>

      <div style={{
        position:'fixed', left:0, right:0, zIndex:2,
        bottom: `${bottomOffset}px`,
        padding:'12px 10px calc(env(safe-area-inset-bottom) + 20px)',
        background:'linear-gradient(to top, rgba(0,0,0,.92) 60%, transparent)',
        transition: 'bottom 0.1s ease-out',
      }}>
        <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
          <button style={scanning ? btnActive : btn} onClick={scanning ? stopScan : startScan} onTouchStart={e=>e.stopPropagation()}>
            {scanning ? '⬛ PARAR' : '⬤ SCAN'}
          </button>
          <button style={btn} onClick={handleAddCube}>◻ CUBO</button>
          <button style={btn} onClick={()=>{if(points.length<10){toast_('FAÇA UM SCAN PRIMEIRO');return};goViewer()}}>◎ VER 3D</button>
          <button style={btn} onClick={goScans}>☰ SALVOS</button>
          <button style={btn} onClick={toggleFullscreen}>{isFs?'⤢ SAIR':'⛶ TELA CHEIA'}</button>
          <button style={btnRed} onClick={handleClear}>✕ RESET</button>
        </div>
        {scanning && (
          <div style={{ textAlign:'center', marginTop:8, fontSize:9, color:'rgba(0,255,204,.5)', letterSpacing:2 }}>
            CAPTURANDO ~{Math.round(1000/280*5)} PTS/S — TOTAL {points.length.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/components/ScanView.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/Viewer3D.jsx
```
import React, { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'

function PointCloud({ points }) {
  const ref = useRef()

  const { positions, colors } = useMemo(() => {
    if (!points.length) return { positions: new Float32Array(0), colors: new Float32Array(0) }

    let cx = 0, cy = 0, cz = 0
    for (const p of points) { cx += p.x; cy += p.y; cz += p.z }
    cx /= points.length; cy /= points.length; cz /= points.length

    const positions = new Float32Array(points.length * 3)
    const colors    = new Float32Array(points.length * 3)

    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const c = p.confidence ?? 0.8
      positions[i*3]   = p.x - cx
      positions[i*3+1] = p.y - cy
      positions[i*3+2] = p.z - cz
      colors[i*3]      = 0
      colors[i*3+1]    = c
      colors[i*3+2]    = 1 - c
    }
    return { positions, colors }
  }, [points])

  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.0008
  })

  if (!points.length) return null

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.025} vertexColors sizeAttenuation transparent opacity={0.9}/>
    </points>
  )
}

function EmptyState() {
  return (
    <group>
      <Grid args={[10,10]} cellColor="#001a0e" sectionColor="#003322"/>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.05, 8, 8]}/>
        <meshBasicMaterial color="#00ffcc"/>
      </mesh>
    </group>
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
    <div style={{ width:'100vw', height:'100vh', display:'flex', flexDirection:'column', background:'#030b07', position:'fixed', inset:0 }}>

      {/* Header */}
      <div style={{
        padding:'10px 14px', background:'rgba(0,0,0,.8)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.12)',
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ VIEWER 3D</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ fontSize:9, color:'rgba(0,255,204,.5)', letterSpacing:1 }}>
            {points.length.toLocaleString()} PTS
          </span>
          <button style={btn} onClick={() => setAutoRotate(v => !v)}>
            {autoRotate ? '⏸ AUTO' : '▶ AUTO'}
          </button>
          <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>
            ✕ FECHAR
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex:1, position:'relative' }}>
        <Canvas
          camera={{ position:[0, 1.5, 4], fov:60 }}
          gl={{ antialias:true, alpha:false }}
        >
          <color attach="background" args={['#030b07']}/>
          <ambientLight intensity={0.6}/>
          <directionalLight position={[5,10,5]} intensity={0.7} color="#00ffcc"/>
          <pointLight position={[-5,-5,-5]} intensity={0.3} color="#004422"/>

          {points.length > 0
            ? <PointCloud points={points}/>
            : <EmptyState/>
          }

          <Grid
            args={[20, 20]}
            position={[0, -1, 0]}
            cellColor="#001a0e"
            sectionColor="#003322"
            fadeDistance={15}
          />
          <OrbitControls
            enableDamping
            dampingFactor={0.07}
            autoRotate={autoRotate}
            autoRotateSpeed={0.4}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
            minDistance={0.5}
            maxDistance={30}
          />
        </Canvas>

        {points.length === 0 && (
          <div style={{
            position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            textAlign:'center', pointerEvents:'none',
            color:'rgba(0,255,204,.3)', fontSize:11, letterSpacing:2,
          }}>
            SEM PONTOS<br/>
            <span style={{ fontSize:9, opacity:.6 }}>FAÇA UM SCAN PRIMEIRO</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding:'10px', background:'rgba(0,0,0,.7)',
        borderTop:'1px solid rgba(0,255,204,.08)',
        textAlign:'center',
        fontSize:9, color:'rgba(0,255,204,.35)', letterSpacing:1.5,
      }}>
        1 DEDO = ORBITAR · 2 DEDOS = ZOOM/PAN
      </div>
    </div>
  )
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/components/Viewer3D.jsx
---
### Início do arquivo: ./scan3d-react/packages/client/src/components/ScansPanel.jsx
```
import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { listScans, deleteScan, loadPoints } from '../api'

export default function ScansPanel({ goBack }) {
  const [scans, setScans]     = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const { setPoints, setScanId } = useStore()

  const load = async () => {
    setLoading(true)
    try {
      const s = await listScans()
      setScans(s)
    } catch (e) {
      console.error('[SCANS] listScans falhou:', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleLoad(scan) {
    setLoadingId(scan.id)
    try {
      const pts = await loadPoints(scan.id)
      setPoints(pts)
      setScanId(scan.id)
      console.log('[LOAD] scan', scan.id, '→', pts.length, 'pts')
      goBack()
    } catch (e) {
      console.error('[LOAD] erro:', e.message)
    } finally {
      setLoadingId(null)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    try {
      await deleteScan(id)
      setScans(s => s.filter(x => x.id !== id))
    } catch (e) {
      console.error('[DEL] erro:', e.message)
    } finally {
      setDeleting(null)
    }
  }

  const btn = {
    background:'rgba(0,255,204,.07)', border:'1px solid rgba(0,255,204,.22)',
    color:'#00ffcc', padding:'8px 12px', borderRadius:8,
    fontSize:10, letterSpacing:1, cursor:'pointer',
    WebkitTapHighlightColor:'transparent',
  }

  return (
    <div style={{ width:'100vw', height:'100vh', background:'#030b07', display:'flex', flexDirection:'column', position:'fixed', inset:0 }}>

      <div style={{
        padding:'10px 14px', background:'rgba(0,0,0,.8)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.12)',
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ SCANS SALVOS</span>
        <button style={btn} onClick={load} disabled={loading}>↺ ATUALIZAR</button>
        <button style={{ ...btn, marginLeft:6 }} onClick={goBack}>← VOLTAR</button>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:12, display:'flex', flexDirection:'column', gap:8 }}>

        {loading && (
          <div style={{ color:'rgba(0,255,204,.4)', textAlign:'center', marginTop:50, letterSpacing:2, fontSize:11 }}>
            CARREGANDO...
          </div>
        )}

        {!loading && scans.length === 0 && (
          <div style={{ color:'rgba(0,255,204,.25)', textAlign:'center', marginTop:60, fontSize:11, letterSpacing:2 }}>
            NENHUM SCAN SALVO<br/>
            <span style={{ fontSize:9, opacity:.6 }}>FAÇA SEU PRIMEIRO SCAN</span>
          </div>
        )}

        {scans.map(s => (
          <div key={s.id} style={{
            background:'rgba(0,0,0,.55)', border:'1px solid rgba(0,255,204,.15)',
            borderRadius:10, padding:'12px 14px',
            display:'flex', justifyContent:'space-between', alignItems:'center',
          }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:'#00ffcc', fontSize:12, letterSpacing:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {s.name}
              </div>
              <div style={{ color:'rgba(0,255,204,.4)', fontSize:9, marginTop:4, letterSpacing:.5 }}>
                {Number(s.point_count).toLocaleString()} pts · {new Date(s.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginLeft:10, flexShrink:0 }}>
              <button
                style={{ ...btn, opacity: loadingId === s.id ? .5 : 1 }}
                onClick={() => handleLoad(s)}
                disabled={loadingId === s.id}
              >
                {loadingId === s.id ? '...' : '▶ CARREGAR'}
              </button>
              <button
                style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)', background:'rgba(255,96,96,.05)', opacity: deleting === s.id ? .5 : 1 }}
                onClick={() => handleDelete(s.id)}
                disabled={deleting === s.id}
              >
                {deleting === s.id ? '...' : '✕'}
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

export const useStore = create((set, get) => ({
  scanId: null,
  scanning: false,
  points: [],
  arObjects: [],
  mode: 'IDLE',

  setScanId: (id) => set({ scanId: id }),
  setScanning: (v) => set({ scanning: v }),

  // ⚠️ CORREÇÃO CRÍTICA: limite máximo + descarte circular
  addPoints: (pts) => {
    const current = get().points
    const MAX = 8000 // seguro para mobile

    if (current.length >= MAX) {
      const cut = Math.floor(MAX * 0.2)
      set({ points: [...current.slice(cut), ...pts].slice(-MAX) })
    } else {
      const total = current.length + pts.length
      if (total > MAX) {
        const room = MAX - current.length
        set({ points: [...current, ...pts.slice(0, room)] })
      } else {
        set({ points: [...current, ...pts] })
      }
    }
  },

  setPoints: (pts) => set({ points: pts }),
  clearPoints: () => set({ points: [], arObjects: [], scanId: null, mode: 'IDLE' }),
  addArObject: (obj) => set(s => ({ arObjects: [...s.arObjects, obj] })),
  removeArObject: (id) => set(s => ({ arObjects: s.arObjects.filter(o => o.id !== id) })),
  setMode: (mode) => set({ mode }),
}))
```
### Fim do arquivo: ./scan3d-react/packages/client/src/store.js
---
### Início do arquivo: ./scan3d-react/packages/client/src/api.js
```
const BASE = '/api'

async function req(url, opts = {}) {
  try {
    const r = await fetch(BASE + url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) {
    console.error('[API]', url, e.message)
    throw e
  }
}

export const createScan  = (name)          => req('/scans', { method:'POST', body:{ name } })
export const listScans   = ()              => req('/scans')
export const deleteScan  = (id)            => req(`/scans/${id}`, { method:'DELETE' })
export const loadPoints  = (id)            => req(`/scans/${id}/points`)
export const saveObject  = (id, obj)       => req(`/scans/${id}/objects`, { method:'POST', body: obj })

export async function pushPoints(scanId, points) {
  if (!scanId || !points.length) return
  return req(`/scans/${scanId}/points`, { method:'POST', body:{ points } })
}
```
### Fim do arquivo: ./scan3d-react/packages/client/src/api.js
---
### Início do arquivo: ./scan3d-react/packages/client/src/App.jsx
```
import React, { useState, useEffect } from 'react'
import ScanView from './components/ScanView'
import Viewer3D from './components/Viewer3D'
import ScansPanel from './components/ScansPanel'

function useRealViewportHeight() {
  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }
    setVh()
    window.addEventListener('resize', setVh)
    window.addEventListener('orientationchange', setVh)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh)
    return () => {
      window.removeEventListener('resize', setVh)
      window.removeEventListener('orientationchange', setVh)
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', setVh)
    }
  }, [])
}

function useAutoFullscreen() {
  useEffect(() => {
    const tryFs = () => {
      const el = document.documentElement
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen().catch(() => {})
      }
    }
    window.addEventListener('touchstart', tryFs, { once: true })
    window.addEventListener('click', tryFs, { once: true })
    return () => {
      window.removeEventListener('touchstart', tryFs)
      window.removeEventListener('click', tryFs)
    }
  }, [])
}

export default function App() {
  const [screen, setScreen] = useState('scan')
  useRealViewportHeight()
  useAutoFullscreen()

  return (
    <div style={{
      width: '100vw',
      height: 'calc(var(--vh, 1vh) * 100)',
      background: '#000',
      overflow: 'hidden',
      position: 'fixed',
      inset: 0,
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
### Início do arquivo: ./scan3d-react/packages/client/public/manifest.json
```
{
  "name": "SCAN3D",
  "short_name": "SCAN3D",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```
### Fim do arquivo: ./scan3d-react/packages/client/public/manifest.json
---
### Início do arquivo: ./scan3d-react/packages/client/public/icon.svg
```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#030b07"/>
  <circle cx="256" cy="256" r="180" fill="none" stroke="#00ffcc" stroke-width="10" opacity="0.6"/>
  <circle cx="256" cy="256" r="120" fill="none" stroke="#00ffcc" stroke-width="14"/>
  <circle cx="256" cy="256" r="18" fill="#00ffcc"/>
  <line x1="256" y1="40" x2="256" y2="130" stroke="#00ffcc" stroke-width="10"/>
  <line x1="256" y1="382" x2="256" y2="472" stroke="#00ffcc" stroke-width="10"/>
  <line x1="40" y1="256" x2="130" y2="256" stroke="#00ffcc" stroke-width="10"/>
  <line x1="382" y1="256" x2="472" y2="256" stroke="#00ffcc" stroke-width="10"/>
</svg>
```
### Fim do arquivo: ./scan3d-react/packages/client/public/icon.svg
---
### Início do arquivo: ./scan3d-react/packages/client/package.json
```
{
  "name": "@scan3d/client",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@react-three/drei": "^9.99.0",
    "@react-three/fiber": "^8.15.19",
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
### Início do arquivo: ./scan3d-react/packages/client/vite.config.js
```
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
```
### Fim do arquivo: ./scan3d-react/packages/client/vite.config.js
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
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
    <meta name="theme-color" content="#000000"/>
    <link rel="manifest" href="/manifest.json"/>
    <link rel="apple-touch-icon" href="/icon.svg"/>
    <title>SCAN3D</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root {
        width: 100%;
        height: 100%;
        height: 100dvh;
        overflow: hidden;
        background: #000;
        overscroll-behavior: none;
      }
      body {
        font-family: 'Courier New', Courier, monospace;
        -webkit-font-smoothing: antialiased;
        touch-action: none;
        position: fixed;
        inset: 0;
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
### Início do arquivo: ./scan3d-react/package.json
```
{
  "name": "scan3d-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w packages/server\" \"npm run dev -w packages/client\"",
    "build": "npm run build -w packages/client",
    "start": "npm run start -w packages/server"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```
### Fim do arquivo: ./scan3d-react/package.json
---
### Início do arquivo: ./saida_do_projeto.md
```
```
### Fim do arquivo: ./saida_do_projeto.md
