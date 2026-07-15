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
