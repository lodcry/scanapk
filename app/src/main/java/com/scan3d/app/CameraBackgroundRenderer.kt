package com.scan3d.app

import android.opengl.GLES11Ext
import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

class CameraBackgroundRenderer {

    var textureId = -1
        private set

    private var program = 0
    private var quadVertices: FloatBuffer
    private var quadTexCoords: FloatBuffer

    private val QUAD_COORDS = floatArrayOf(
        -1f, -1f, 0f,
         1f, -1f, 0f,
        -1f,  1f, 0f,
         1f,  1f, 0f
    )

    private val VERTEX_SHADER = """
        attribute vec4 a_Position;
        attribute vec2 a_TexCoord;
        varying vec2 v_TexCoord;
        void main() {
            gl_Position = a_Position;
            v_TexCoord = a_TexCoord;
        }
    """.trimIndent()

    private val FRAGMENT_SHADER = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        varying vec2 v_TexCoord;
        uniform samplerExternalOES u_Texture;
        void main() {
            gl_FragColor = texture2D(u_Texture, v_TexCoord);
        }
    """.trimIndent()

    init {
        quadVertices = ByteBuffer.allocateDirect(QUAD_COORDS.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(QUAD_COORDS); position(0) }
        val defaultTex = floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)
        quadTexCoords = ByteBuffer.allocateDirect(defaultTex.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(defaultTex); position(0) }
    }

    fun createOnGlThread() {
        val tex = IntArray(1)
        GLES20.glGenTextures(1, tex, 0)
        textureId = tex[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        val vs = loadShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fs = loadShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        program = GLES20.glCreateProgram().also {
            GLES20.glAttachShader(it, vs)
            GLES20.glAttachShader(it, fs)
            GLES20.glLinkProgram(it)
        }
    }

    private fun loadShader(type: Int, src: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, src)
        GLES20.glCompileShader(shader)
        return shader
    }

    fun updateTexCoords(rawCoords: FloatArray) {
        quadTexCoords.clear()
        quadTexCoords.put(rawCoords)
        quadTexCoords.position(0)
    }

    fun draw() {
        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glDepthMask(false)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

        val posHandle = GLES20.glGetAttribLocation(program, "a_Position")
        val texHandle = GLES20.glGetAttribLocation(program, "a_TexCoord")
        val texUniform = GLES20.glGetUniformLocation(program, "u_Texture")
        GLES20.glUniform1i(texUniform, 0)

        GLES20.glVertexAttribPointer(posHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(posHandle)
        GLES20.glVertexAttribPointer(texHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(texHandle)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(posHandle)
        GLES20.glDisableVertexAttribArray(texHandle)
        GLES20.glDepthMask(true)
        GLES20.glEnable(GLES20.GL_DEPTH_TEST)
    }
}
