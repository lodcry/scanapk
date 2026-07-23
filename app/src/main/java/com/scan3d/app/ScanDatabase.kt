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
