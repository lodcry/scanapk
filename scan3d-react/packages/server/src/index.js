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
