import React, { useState } from 'react'

const C = { primary: '#00ffcc', danger: '#ff6060', dim: 'rgba(0,255,204,0.25)' }

function Dot({ ok }) {
  if (ok === null) return null
  return <span style={{ color: ok ? '#44ff88' : '#ff6060', fontSize: 11 }}>
    {ok ? ' ✓ online' : ' ✗ offline'}
  </span>
}

export default function TelaSetup({ onConcluido }) {
  const [apiUrl,    setApiUrl]    = useState('https://')
  const [colmapUrl, setColmapUrl] = useState('https://serverealscan.onrender.com')
  const [apiOk,     setApiOk]     = useState(null)
  const [colmapOk,  setColmapOk]  = useState(null)
  const [testando,  setTestando]  = useState(false)
  const [erro,      setErro]      = useState('')

  async function testar() {
    setTestando(true); setErro(''); setApiOk(null); setColmapOk(null)
    try {
      const a = await fetch(apiUrl.replace(/\/+$/,'') + '/saude', { signal: AbortSignal.timeout(10000) })
      setApiOk(a.ok)
    } catch { setApiOk(false) }
    try {
      const c = await fetch(colmapUrl.replace(/\/+$/,'') + '/health', { signal: AbortSignal.timeout(10000) })
      setColmapOk(c.ok)
    } catch { setColmapOk(false) }
    setTestando(false)
  }

  function salvar() {
    if (!apiUrl.startsWith('http') || !colmapUrl.startsWith('http')) {
      setErro('As duas URLs precisam começar com https://'); return
    }
    if (typeof window !== 'undefined' && window.Scan3DBridge) {
      window.Scan3DBridge.setApiUrl(apiUrl.trim().replace(/\/+$/,''))
      window.Scan3DBridge.setColmapUrl(colmapUrl.trim().replace(/\/+$/,''))
      window.Scan3DBridge.markConfigured()
    } else {
      localStorage.setItem('genesis_api_url', apiUrl.trim().replace(/\/+$/,''))
      localStorage.setItem('genesis_colmap_url', colmapUrl.trim().replace(/\/+$/,''))
      localStorage.setItem('genesis_configured', '1')
    }
    onConcluido()
  }

  const inp = {
    width: '100%', background: '#0d0d0d',
    border: '1px solid rgba(0,255,204,.2)', color: '#fff',
    padding: '12px', borderRadius: 8, fontSize: 12,
    fontFamily: 'monospace', boxSizing: 'border-box', marginTop: 6,
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'#000508',
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', padding:24, gap:0,
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#00ffcc', letterSpacing: 4, marginBottom: 8 }}>
        GÊNESIS
      </div>
      <div style={{ fontSize: 11, color: 'rgba(0,255,204,.4)', letterSpacing: 2, marginBottom: 32, textAlign:'center' }}>
        CONFIGURAÇÃO INICIAL
      </div>

      <div style={{ width:'100%', maxWidth:400, display:'flex', flexDirection:'column', gap:20 }}>

        <div>
          <div style={{ color:'#888', fontSize:11, letterSpacing:1 }}>
            GENESIS API <Dot ok={apiOk}/>
          </div>
          <div style={{ color:'rgba(0,255,204,.35)', fontSize:10, marginTop:2 }}>
            Serviço Node.js — gera avatares rigged (GLB)
          </div>
          <input
            style={inp}
            value={apiUrl}
            onChange={e => { setApiUrl(e.target.value); setApiOk(null) }}
            placeholder="https://genesis-api-xxxx.onrender.com"
          />
        </div>

        <div>
          <div style={{ color:'#888', fontSize:11, letterSpacing:1 }}>
            COLMAP / SCAN AR <Dot ok={colmapOk}/>
          </div>
          <div style={{ color:'rgba(0,255,204,.35)', fontSize:10, marginTop:2 }}>
            Serviço Docker — fotogrametria / nuvem de pontos
          </div>
          <input
            style={inp}
            value={colmapUrl}
            onChange={e => { setColmapUrl(e.target.value); setColmapOk(null) }}
            placeholder="https://serverealscan.onrender.com"
          />
        </div>

        {erro && (
          <div style={{ color:'#ff6060', fontSize:11, textAlign:'center' }}>{erro}</div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button
            onClick={testar}
            disabled={testando}
            style={{
              flex:1, padding:'13px', background:'transparent',
              border:`1px solid ${C.dim}`, color:'#00ffcc',
              borderRadius:10, fontSize:12, cursor:'pointer', fontWeight:600,
            }}>
            {testando ? '⏳ Testando...' : '⚡ Testar conexão'}
          </button>
          <button
            onClick={salvar}
            style={{
              flex:1, padding:'13px', background:'#00ffcc', color:'#001510',
              border:'none', borderRadius:10, fontSize:12, cursor:'pointer', fontWeight:700,
            }}>
            Salvar e entrar →
          </button>
        </div>

        <div style={{ color:'rgba(0,255,204,.25)', fontSize:10, textAlign:'center', lineHeight:1.7, marginTop:4 }}>
          Você pode mudar as URLs depois na aba ⚙️ Config.<br/>
          Pra reiniciar esta tela: botão 📋 do canto → RESET.
        </div>
      </div>
    </div>
  )
}
