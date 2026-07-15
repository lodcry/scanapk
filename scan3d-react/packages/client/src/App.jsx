import React, { useState, useEffect } from 'react'
import ScanView from './components/ScanView'
import Viewer3D from './components/Viewer3D'
import ScansPanel from './components/ScansPanel'

function useRealViewportHeight() {
  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }
    setVh()
    window.addEventListener('resize', setVh)
    window.addEventListener('orientationchange', setVh)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh)
    return () => {
      window.removeEventListener('resize', setVh)
      window.removeEventListener('orientationchange', setVh)
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', setVh)
    }
  }, [])
}

function useAutoFullscreen() {
  useEffect(() => {
    const tryFs = () => {
      const el = document.documentElement
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen().catch(() => {})
      }
    }
    window.addEventListener('touchstart', tryFs, { once: true })
    window.addEventListener('click', tryFs, { once: true })
    return () => {
      window.removeEventListener('touchstart', tryFs)
      window.removeEventListener('click', tryFs)
    }
  }, [])
}

export default function App() {
  const [screen, setScreen] = useState('scan')
  useRealViewportHeight()
  useAutoFullscreen()

  return (
    <div style={{
      width: '100vw',
      height: 'calc(var(--vh, 1vh) * 100)',
      background: '#000',
      overflow: 'hidden',
      position: 'fixed',
      inset: 0,
    }}>
      {screen === 'scan'   && <ScanView   goViewer={() => setScreen('viewer')} goScans={() => setScreen('scans')} />}
      {screen === 'viewer' && <Viewer3D   goBack={() => setScreen('scan')} />}
      {screen === 'scans'  && <ScansPanel goBack={() => setScreen('scan')} />}
    </div>
  )
}
