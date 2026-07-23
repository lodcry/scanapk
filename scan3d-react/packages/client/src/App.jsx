import React, { useState, useEffect } from 'react'
import { isConfigured } from './config'
import TelaSetup    from './components/TelaSetup'
import ScanView     from './components/ScanView'
import MeshViewer   from './components/MeshViewer'
import ScanAvatar   from './components/ScanAvatar'
import AvatarViewer from './components/AvatarViewer'
import TelaConfig   from './components/TelaConfig'
import { useStore } from './store'

const C = { primary: '#00ffcc' }

export default function App() {
  const [configurado, setConfigurado] = useState(null) // null = ainda checando
  const [aba,    setAba]    = useState('avatar')
  const [subtela, setSubtela] = useState(null)
  const { avatarUrl, setAvatarUrl } = useStore()

  useEffect(() => {
    const setVh = () =>
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`)
    setVh()
    window.addEventListener('resize', setVh)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh)
    return () => window.removeEventListener('resize', setVh)
  }, [])

  useEffect(() => {
    // pequeno delay pro bridge nativo inicializar antes de checar
    const t = setTimeout(() => setConfigurado(isConfigured()), 300)
    return () => clearTimeout(t)
  }, [])

  if (configurado === null) {
    return (
      <div style={{ position:'fixed', inset:0, background:'#000508',
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ color:'rgba(0,255,204,.4)', fontSize:11, letterSpacing:3 }}>INICIANDO...</div>
      </div>
    )
  }

  if (!configurado) {
    return <TelaSetup onConcluido={() => setConfigurado(true)} />
  }

  function handleAvatarPronto(av) {
    setAvatarUrl(av.glb_url)
    setAba('visualizar')
    setSubtela('avatar3d')
  }

  const abas = [
    { id:'avatar',     label:'🧍 Avatar' },
    { id:'ar',         label:'📷 Scan AR' },
    { id:'visualizar', label:'◎ Ver 3D' },
    { id:'config',     label:'⚙️ Config' },
  ]

  const mostraBar = !(aba === 'avatar' || (aba === 'ar' && !subtela))

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', background:'#000', overflow:'hidden', position:'fixed', inset:0 }}>

      {aba === 'avatar' && (
        <ScanAvatar onAvatarPronto={handleAvatarPronto} goBack={() => setAba('visualizar')} />
      )}

      {aba === 'ar' && (
        subtela === 'mesh'
          ? <MeshViewer goBack={() => setSubtela(null)} />
          : <ScanView goMesh={() => setSubtela('mesh')} />
      )}

      {aba === 'visualizar' && (
        subtela === 'avatar3d' || (!subtela && avatarUrl)
          ? <AvatarViewer avatarUrl={avatarUrl} goBack={() => setAba('avatar')} />
          : <MeshViewer goBack={() => setAba('ar')} />
      )}

      {aba === 'config' && (
        <TelaConfig goBack={() => setAba('avatar')} />
      )}

      {mostraBar && (
        <div style={{
          position:'fixed', bottom:0, left:0, right:0, zIndex:200,
          display:'flex', background:'rgba(0,0,0,.92)',
          borderTop:'1px solid rgba(0,255,204,.1)',
          paddingBottom:'env(safe-area-inset-bottom,0px)',
        }}>
          {abas.map(t => (
            <button key={t.id}
              onClick={() => { setAba(t.id); setSubtela(null) }}
              style={{
                flex:1, padding:'12px 4px', border:'none', cursor:'pointer',
                fontSize:11, background:'transparent',
                color: aba === t.id ? C.primary : 'rgba(255,255,255,0.35)',
                borderTop: aba === t.id ? `2px solid ${C.primary}` : '2px solid transparent',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
