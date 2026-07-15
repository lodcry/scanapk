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
                }
                override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
                    GLES20.glViewport(0, 0, w, h)
                    session?.setDisplayGeometry(0, w, h)
                }
                override fun onDrawFrame(gl: GL10?) {
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
                    val s = session ?: return
                    try {
                        s.setCameraTextureName(0)
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
            text = "◈ ARCORE — INICIANDO"
            textSize = 12f
            setTextColor(0xFF00ffcc.toInt())
            letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        tvPoints = TextView(this).apply {
            text = "0 PTS"
            textSize = 11f
            setTextColor(0xFF00ffcc.toInt())
        }
        tvFps = TextView(this).apply {
            text = "0 FPS"
            textSize = 10f
            setTextColor(0x8800ffcc.toInt())
            setPadding(dp(10), 0, 0, 0)
        }
        topBar.addView(tvStatus)
        topBar.addView(tvPoints)
        topBar.addView(tvFps)
        frame.addView(topBar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ))

        val mira = buildMira()
        frame.addView(mira, FrameLayout.LayoutParams(dp(60), dp(60), Gravity.CENTER))

        val botBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xEE000000.toInt())
            setPadding(dp(10), dp(12), dp(10), dp(24))
            gravity = Gravity.CENTER
        }

        val btnScan = Button(this).apply {
            text = "⬤ SCAN"
            textSize = 12f
            stateListAnimator = null
            setBackgroundColor(0xFF00ffcc.toInt())
            setTextColor(0xFF000000.toInt())
            setPadding(dp(24), dp(10), dp(24), dp(10))
        }
        val btnStop = Button(this).apply {
            text = "⬛ PARAR"
            textSize = 12f
            stateListAnimator = null
            setBackgroundColor(0xFFff6060.toInt())
            setTextColor(0xFFffffff.toInt())
            setPadding(dp(24), dp(10), dp(24), dp(10))
            isEnabled = false
            alpha = 0.4f
        }
        val btnConfirm = Button(this).apply {
            text = "✓ SALVAR"
            textSize = 12f
            stateListAnimator = null
            setBackgroundColor(0xFF00ffcc.toInt())
            setTextColor(0xFF000000.toInt())
            setPadding(dp(24), dp(10), dp(24), dp(10))
            isEnabled = false
            alpha = 0.4f
        }
        val btnCancel = Button(this).apply {
            text = "✕"
            textSize = 12f
            stateListAnimator = null
            setBackgroundColor(Color.TRANSPARENT)
            setTextColor(0xFFff6060.toInt())
            setPadding(dp(16), dp(10), dp(16), dp(10))
        }

        btnScan.setOnClickListener {
            scanning = true
            btnScan.isEnabled = false; btnScan.alpha = 0.4f
            btnStop.isEnabled = true; btnStop.alpha = 1f
            tvStatus.text = "● SCANNING — MOVA O CELULAR"
            DebugLog.log(DebugLog.Tag.ARCORE, "Scan iniciado")
        }
        btnStop.setOnClickListener {
            scanning = false
            btnStop.isEnabled = false; btnStop.alpha = 0.4f
            btnConfirm.isEnabled = true; btnConfirm.alpha = 1f
            tvStatus.text = "◈ PARADO — ${totalPoints} PTS CAPTURADOS"
            DebugLog.log(DebugLog.Tag.ARCORE, "Scan parado, $totalPoints pts")
        }
        btnConfirm.setOnClickListener { finishWithPoints() }
        btnCancel.setOnClickListener { setResult(RESULT_CANCELED); finish() }

        botBar.addView(btnCancel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnScan, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnStop, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnConfirm, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)))

        frame.addView(botBar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        ))
        return frame
    }

    private fun buildMira(): FrameLayout {
        return FrameLayout(this).also { f ->
            f.addView(android.view.View(this).apply {
                setBackgroundColor(0xAA00ffcc.toInt())
                layoutParams = FrameLayout.LayoutParams(1, dp(40), Gravity.CENTER)
            })
            f.addView(android.view.View(this).apply {
                setBackgroundColor(0xAA00ffcc.toInt())
                layoutParams = FrameLayout.LayoutParams(dp(40), 1, Gravity.CENTER)
            })
        }
    }

    private fun processFrame(frame: Frame) {
        if (pointBuffer.size >= MAX_POINTS) return
        val cloud = frame.acquirePointCloud()
        try {
            val buf = cloud.points
            val n = cloud.ids.limit()
            val batch = mutableListOf<JSONObject>()
            for (i in 0 until n) {
                val idx = i * 4
                if (idx + 3 >= buf.limit()) break
                val x = buf.get(idx).toDouble()
                val y = buf.get(idx + 1).toDouble()
                val z = buf.get(idx + 2).toDouble()
                val conf = buf.get(idx + 3).toDouble()
                if (conf < 0.1) continue
                batch.add(JSONObject().apply {
                    put("x", x); put("y", y); put("z", z)
                    put("confidence", conf)
                    put("ts", System.currentTimeMillis())
                })
            }
            if (batch.isNotEmpty()) {
                synchronized(pointBuffer) { pointBuffer.addAll(batch) }
                totalPoints += batch.size
                frameCount++
                if (frameCount % 10 == 0) {
                    val pts = totalPoints
                    handler.post { tvPoints.text = "$pts PTS" }
                    pushToReact(batch)
                }
            }
        } finally {
            cloud.release()
        }
    }

    private fun pushToReact(batch: List<JSONObject>) {
        val arr = JSONArray()
        batch.forEach { arr.put(it) }
        MainActivity.instance?.runOnUiThread {
            MainActivity.instance?.webView?.evaluateJavascript(
                "window.__onARPoints && window.__onARPoints(${arr})", null
            )
        }
    }

    private fun finishWithPoints() {
        val arr = JSONArray()
        synchronized(pointBuffer) { pointBuffer.forEach { arr.put(it) } }
        val intent = android.content.Intent().apply {
            putExtra(RESULT_POINTS, arr.toString())
        }
        setResult(RESULT_OK, intent)
        finish()
    }

    private fun initARCore() {
        try {
            session = Session(this, setOf(Session.Feature.SHARED_CAMERA)).also { s ->
                val config = Config(s).apply {
                    depthMode = Config.DepthMode.AUTOMATIC
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                    planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                }
                s.configure(config)
            }
            handler.post { tvStatus.text = "◈ ARCORE PRONTO" }
            DebugLog.log(DebugLog.Tag.ARCORE, "Session iniciada com Depth API")
        } catch (e: UnavailableUserDeclinedInstallationException) {
            DebugLog.e(DebugLog.Tag.ARCORE, "AR não instalado: ${e.message}")
            finish()
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.ARCORE, "Erro ARCore: ${e.message}")
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        try { session?.resume() } catch (e: Exception) { DebugLog.e(DebugLog.Tag.ARCORE, "Resume: ${e.message}") }
        glView.onResume()
    }

    override fun onPause() {
        super.onPause()
        glView.onPause()
        session?.pause()
    }

    override fun onDestroy() {
        session?.close()
        super.onDestroy()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
