package com.scan3d.app

import android.app.Activity
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
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
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class ARScanActivity : Activity() {

    private var session: Session? = null
    private lateinit var glView: GLSurfaceView
    private val handler = Handler(Looper.getMainLooper())
    private val bgRenderer = CameraBackgroundRenderer()

    private var scanning = false
    private var fpsCount = 0
    private var fpsLast = System.currentTimeMillis()

    private var viewportWidth = 0
    private var viewportHeight = 0
    private var viewportChanged = false

    private lateinit var photosDir: File
    private val capturedPhotos = mutableListOf<File>()
    private var lastCaptureTime = 0L

    private lateinit var tvStatus: TextView
    private lateinit var tvPoints: TextView
    private lateinit var tvFps: TextView

    companion object {
        const val MAX_PHOTOS = 40
        const val CAPTURE_INTERVAL_MS = 700L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        photosDir = File(cacheDir, "scan_${System.currentTimeMillis()}")
        photosDir.mkdirs()

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        glView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            preserveEGLContextOnPause = true
            setRenderer(object : GLSurfaceView.Renderer {
                override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
                    GLES20.glClearColor(0f, 0f, 0f, 1f)
                    bgRenderer.createOnGlThread()
                }
                override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
                    GLES20.glViewport(0, 0, w, h)
                    viewportWidth = w
                    viewportHeight = h
                    viewportChanged = true
                }
                override fun onDrawFrame(gl: GL10?) {
                    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
                    val s = session ?: return
                    try {
                        s.setCameraTextureName(bgRenderer.textureId)
                        if (viewportChanged) {
                            s.setDisplayGeometry(0, viewportWidth, viewportHeight)
                            viewportChanged = false
                        }
                        val frame = s.update()
                        if (frame.hasDisplayGeometryChanged()) {
                            bgRenderer.updateTexCoords(transformedCoords(frame))
                        }
                        bgRenderer.draw()
                        maybeCapturePhoto(frame)

                        fpsCount++
                        val now = System.currentTimeMillis()
                        if (now - fpsLast >= 1000) {
                            val fps = fpsCount; fpsCount = 0; fpsLast = now
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
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))
        root.addView(buildOverlay(), FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))

        setContentView(root)
        initARCore()
    }

    private fun transformedCoords(frame: Frame): FloatArray {
        // Coordenadas NDC dos 4 vertices do quad, na MESMA ordem do TRIANGLE_STRIP:
        // (-1,-1), (1,-1), (-1,1), (1,1)
        val ndc = floatArrayOf(
            -1f, -1f,
             1f, -1f,
            -1f,  1f,
             1f,  1f
        )
        val src = ByteBuffer.allocateDirect(ndc.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
            .apply { put(ndc); position(0) }
        val dst = ByteBuffer.allocateDirect(ndc.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        frame.transformCoordinates2d(
            Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, src,
            Coordinates2d.TEXTURE_NORMALIZED, dst
        )
        dst.position(0)
        val out = FloatArray(ndc.size)
        dst.get(out)
        return out
    
    }

    private fun maybeCapturePhoto(frame: Frame) {
        if (!scanning) return
        if (capturedPhotos.size >= MAX_PHOTOS) return
        val now = System.currentTimeMillis()
        if (now - lastCaptureTime < CAPTURE_INTERVAL_MS) return
        try {
            val image = frame.acquireCameraImage()
            try {
                val jpeg = yuvToJpeg(image)
                val file = File(photosDir, "photo_${"%03d".format(capturedPhotos.size)}.jpg")
                FileOutputStream(file).use { it.write(jpeg) }
                capturedPhotos.add(file)
                lastCaptureTime = now
                handler.post { tvPoints.text = "${capturedPhotos.size} FOTOS" }
            } finally {
                image.close()
            }
        } catch (e: NotYetAvailableException) {
            // ignora, frame ainda sem imagem pronta
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.ARCORE, "Captura: ${e.message}")
        }
    }

    private fun yuvToJpeg(image: Image): ByteArray {
        val width = image.width
        val height = image.height
        val ySize = width * height
        val nv21 = ByteArray(ySize + ySize / 2)

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        var pos = 0
        val yBuffer = yPlane.buffer
        val yRowStride = yPlane.rowStride
        val yPixelStride = yPlane.pixelStride
        for (row in 0 until height) {
            val rowStart = row * yRowStride
            for (col in 0 until width) {
                nv21[pos++] = yBuffer.get(rowStart + col * yPixelStride)
            }
        }

        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer
        val uRowStride = uPlane.rowStride
        val uPixelStride = uPlane.pixelStride
        val vRowStride = vPlane.rowStride
        val vPixelStride = vPlane.pixelStride
        val chromaHeight = height / 2
        val chromaWidth = width / 2
        for (row in 0 until chromaHeight) {
            for (col in 0 until chromaWidth) {
                val vIndex = row * vRowStride + col * vPixelStride
                val uIndex = row * uRowStride + col * uPixelStride
                nv21[pos++] = vBuffer.get(vIndex)
                nv21[pos++] = uBuffer.get(uIndex)
            }
        }

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, width, height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, width, height), 85, out)
        return out.toByteArray()
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
        tvPoints = TextView(this).apply { text = "0 FOTOS"; textSize = 11f; setTextColor(0xFF00ffcc.toInt()) }
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
        val btnConfirm = Button(this).apply { text="✓ ENVIAR"; textSize=12f; stateListAnimator=null; setBackgroundColor(0xFF00ffcc.toInt()); setTextColor(0xFF000000.toInt()); setPadding(dp(24),dp(10),dp(24),dp(10)); isEnabled=false; alpha=0.4f }
        val btnCancel = Button(this).apply { text="✕"; textSize=12f; stateListAnimator=null; setBackgroundColor(Color.TRANSPARENT); setTextColor(0xFFff6060.toInt()); setPadding(dp(16),dp(10),dp(16),dp(10)) }

        btnScan.setOnClickListener {
            scanning = true; btnScan.isEnabled=false; btnScan.alpha=0.4f
            btnStop.isEnabled=true; btnStop.alpha=1f
            tvStatus.text = "● CAPTURANDO — ANDE DEVAGAR AO REDOR DO OBJETO"
        }
        btnStop.setOnClickListener {
            scanning = false; btnStop.isEnabled=false; btnStop.alpha=0.4f
            btnConfirm.isEnabled=true; btnConfirm.alpha=1f
            tvStatus.text = "◈ PARADO — ${capturedPhotos.size} FOTOS"
        }
        btnConfirm.setOnClickListener { finishWithPhotos() }
        btnCancel.setOnClickListener { setResult(RESULT_CANCELED); finish() }

        botBar.addView(btnCancel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnScan, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnStop, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)).apply { setMargins(0,0,dp(6),0) })
        botBar.addView(btnConfirm, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48)))
        frame.addView(botBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        return frame
    }

    private fun finishWithPhotos() {
        if (capturedPhotos.isEmpty()) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }
        tvStatus.text = "◈ COMPACTANDO ${capturedPhotos.size} FOTOS..."
        try {
            val zipFile = File(cacheDir, "scan_${System.currentTimeMillis()}.zip")
            ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                capturedPhotos.forEach { photo ->
                    zos.putNextEntry(ZipEntry(photo.name))
                    photo.inputStream().use { it.copyTo(zos) }
                    zos.closeEntry()
                }
            }
            ScanBuffer.pendingZipPath = zipFile.absolutePath
            setResult(RESULT_OK)
            finish()
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.ARCORE, "Erro ao compactar: ${e.message}")
            setResult(RESULT_CANCELED)
            finish()
        }
    }

    private fun initARCore() {
        try {
            session = Session(this).also { s ->
                s.configure(s.config)
            }
            handler.post { tvStatus.text = "◈ ARCORE PRONTO" }
            DebugLog.log(DebugLog.Tag.ARCORE, "Session iniciada")
        } catch (e: Exception) {
            DebugLog.e(DebugLog.Tag.ARCORE, "Erro ARCore: ${e.message}")
            finish()
        }
    }
    override fun onResume() { super.onResume(); try { session?.resume() } catch (e: Exception) {}; glView.onResume() }
    override fun onPause() { super.onPause(); glView.onPause(); session?.pause() }
    override fun onDestroy() { session?.close(); super.onDestroy() }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
