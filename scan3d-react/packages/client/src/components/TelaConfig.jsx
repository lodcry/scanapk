import React, { useState, useEffect } from 'react'
import { getApiUrl, setApiUrl, getColmapUrl, setColmapUrl } from '../config'

const C = { primary: '#00ffcc', dim: 'rgba(0,255,204,0.25)' }

function statusCor(s) {
  if (s === null) return '#555'
  return s ? '#44ff88' : '#ff6060'
}

export default function TelaConfig({ goBack }) {
  const [apiUrl,    setApiUrlLocal]    = useState('')
  const [colmapUrl, setColmapUrlLocal] = useState('')
  const [apiOk,     setApiOk]     = useState(null)
  const [colmapOk,  setColmapOk]  = useState(null)
  const [salvo,     setSalvo]     = useState('')
  const [testando,  setTestando]  = useState(false)

  useEffect(() => {
    setApiUrlLocal(getApiUrl())
    setColmapUrlLocal(getColmapUrl())
  }, [])

  async function testar() {
    setTestando(true); setApiOk(null); setColmapOk(null)
    try {
      const r = await fetch(apiUrl.replace(/\/+$/,'') + '/saude', { signal: AbortSignal.timeout(8000) })
      setApiOk(r.ok)
    } catch { setApiOk(false) }
    try {
      const r = await fetch(colmapUrl.replace(/\/+$/,'') + '/health', { signal: AbortSignal.timeout(8000) })
      setColmapOk(r.ok)
    } catch { setColmapOk(false) }
    setTestando(false)
  }

  function salvar() {
    setApiUrl(apiUrl); setColmapUrl(colmapUrl)
    if (window.Scan3DBridge) { window.Scan3DBridge.markConfigured() }
    setSalvo('✓ Salvo')
    setTimeout(() => setSalvo(''), 2000)
    testar()
  }

  function reset() {
    if (window.Scan3DBridge) { window.Scan3DBridge.resetConfig() }
    else {
      localStorage.clear()
      window.location.reload()
    }
  }

  const inp = {
    width:'100%', background:'#0d0d0d',
    border:'1px solid rgba(0,255,204,.2)', color:'#fff',
    padding:'10px 12px', borderRadius:8, fontSize:11,
    fontFamily:'monospace', boxSizing:'border-box',
  }
  const btn = {
    background:'rgba(0,255,204,.07)', border:`1px solid ${C.dim}`,
    color:C.primary, padding:'9px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
  }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', background:'#000508', display:'flex', flexDirection:'column', position:'fixed', inset:0 }}>
      <div style={{
        padding:'12px 16px', background:'rgba(0,0,0,.9)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.1)',
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ CONFIGURAÇÃO</span>
        <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>✕</button>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:16, display:'flex', flexDirection:'column', gap:16 }}>

        <div>
          <div style={{ color:'#888', fontSize:11, letterSpacing:1, marginBottom:4 }}>
            GENESIS API
            <span style={{ color: statusCor(apiOk), marginLeft:8 }}>
              {apiOk === null ? '' : apiOk ? '✓ online' : '✗ offline'}
            </span>
          </div>
          <div style={{ color:'rgba(0,255,204,.3)', fontSize:10, marginBottom:6 }}>
            Gera avatares rigged (GLB) via landmarks
          </div>
          <input style={inp} value={apiUrl} onChange={e => { setApiUrlLocal(e.target.value); setApiOk(null) }}
            placeholder="https://genesis-api-xxxx.onrender.com" />
        </div>

        <div>
          <div style={{ color:'#888', fontSize:11, letterSpacing:1, marginBottom:4 }}>
            COLMAP / SCAN AR
            <span style={{ color: statusCor(colmapOk), marginLeft:8 }}>
              {colmapOk === null ? '' : colmapOk ? '✓ online' : '✗ offline'}
            </span>
          </div>
          <div style={{ color:'rgba(0,255,204,.3)', fontSize:10, marginBottom:6 }}>
            Fotogrametria / nuvem de pontos ARCore
          </div>
          <input style={inp} value={colmapUrl} onChange={e => { setColmapUrlLocal(e.target.value); setColmapOk(null) }}
            placeholder="https://serverealscan.onrender.com" />
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={testar} disabled={testando}
            style={{ ...btn, flex:1, textAlign:'center' }}>
            {testando ? '⏳ Testando...' : '⚡ Testar'}
          </button>
          <button onClick={salvar}
            style={{ flex:1, padding:'9px 14px', background:'#00ffcc', color:'#001510', border:'none', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>
            {salvo || 'Salvar'}
          </button>
        </div>

        <div style={{ marginTop:8, padding:12, background:'rgba(255,96,96,.05)', border:'1px solid rgba(255,96,96,.15)', borderRadius:10 }}>
          <div style={{ color:'#ff8888', fontSize:10, marginBottom:8, fontWeight:700 }}>ZONA DE PERIGO</div>
          <button onClick={reset}
            style={{ width:'100%', padding:'10px', background:'transparent', border:'1px solid rgba(255,96,96,.3)', color:'#ff6060', borderRadius:8, fontSize:11, cursor:'pointer' }}>
            Resetar configuração (volta pra tela inicial)
          </button>
        </div>

        <div style={{ padding:12, background:'rgba(0,255,204,.03)', border:'1px solid rgba(0,255,204,.1)', borderRadius:10 }}>
          <div style={{ color:'#666', fontSize:10, lineHeight:1.7 }}>
            As URLs ficam salvas no aparelho via SharedPreferences (Kotlin) —
            não somem com atualização do app. Só somem se você tocar em
            "Resetar configuração" ou desinstalar o APK.
          </div>
        </div>
      </div>
    </div>
  )
}
