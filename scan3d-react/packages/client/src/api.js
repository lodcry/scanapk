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
