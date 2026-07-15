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
        checkCamera()
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
            DebugLog.log(DebugLog.Tag.ARCORE, "startARScan() chamado")
            handler.post {
                val intent = Intent(this@MainActivity, ARScanActivity::class.java)
                startActivityForResult(intent, REQ_AR)
            }
        }

        @JavascriptInterface
        fun isARAvailable(): Boolean {
            return try {
                val availability = ArCoreApk.getInstance()
                    .checkAvailability(this@MainActivity)
                availability.isSupported
            } catch (e: Exception) { false }
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
                    DebugLog.log(DebugLog.Tag.ARCORE, "AR finalizado, recebendo pontos")
                    handler.post {
                        webView.evaluateJavascript(
                            "window.__onARScanComplete && window.__onARScanComplete($pointsJson)", null
                        )
                    }
                } else {
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
            if (granted) { pendingPermissionRequest?.grant(pendingPermissionRequest!!.resources) }
            else { pendingPermissionRequest?.deny() }
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
