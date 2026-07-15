package com.scan3d.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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

    // acumuladores de sensor para envio em batch
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

        // botão de log (canto superior direito, sempre visível em debug)
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
                // injeta polyfill de sensor nativo
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

    // ── BRIDGE JS ↔ KOTLIN ──────────────────────────────────────
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

    // ── SENSORES ────────────────────────────────────────────────
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

    // ── CÂMERA ──────────────────────────────────────────────────
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
                    loadApp() // carrega mesmo assim — modo demo
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

    // ── LOG DIALOG ──────────────────────────────────────────────
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
