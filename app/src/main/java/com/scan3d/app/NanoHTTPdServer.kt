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
