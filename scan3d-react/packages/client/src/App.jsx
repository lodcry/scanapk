import React, { useState, useEffect } from 'react'
import ScanView from './components/ScanView'
import Viewer3D from './components/Viewer3D'
import ScansPanel from './components/ScansPanel'

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
      {screen === 'scan'   && <ScanView   goViewer={() => setScreen('viewer')} goScans={() => setScreen('scans')} />}
      {screen === 'viewer' && <Viewer3D   goBack={() => setScreen('scan')} />}
      {screen === 'scans'  && <ScansPanel goBack={() => setScreen('scan')} />}
    </div>
  )
}
