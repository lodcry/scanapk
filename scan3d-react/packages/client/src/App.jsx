import React, { useState, useEffect } from 'react'
import ScanView from './components/ScanView'
import MeshViewer from './components/MeshViewer'

export default function App() {
  const [screen, setScreen] = useState('scan')

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`)
    }
    setVh()
    window.addEventListener('resize', setVh)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh)
    return () => window.removeEventListener('resize', setVh)
  }, [])

  return (
    <div style={{
      width: '100vw', height: 'calc(var(--vh,1vh)*100)',
      background: '#000', overflow: 'hidden',
      position: 'fixed', inset: 0,
    }}>
      {screen === 'scan' && <ScanView goMesh={() => setScreen('mesh')} />}
      {screen === 'mesh' && <MeshViewer goBack={() => setScreen('scan')} />}
    </div>
  )
}
