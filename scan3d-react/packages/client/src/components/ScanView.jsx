import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { createScan, pushPoints, healthCheck } from '../api'

const C = {
  bg:      '#000000',
  primary: '#00ffcc',
  danger:  '#ff6060',
  dim:     'rgba(0,255,204,0.35)',
  panel:   'rgba(0,0,0,0.88)',
}

function HUD({ pts, mode, apiOk, arReady }) {
  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, zIndex:1000,
      padding:'14px 16px 12px',
      background:'linear-gradient(to bottom,rgba(0,0,0,.9),transparent)',
      display:'flex', justifyContent:'space-between', alignItems:'flex-start',
      pointerEvents:'none',
    }}>
      <div>
        <div style={{ fontSize:15, letterSpacing:6, color:C.primary, fontWeight:'bold',
          textShadow:`0 0 20px ${C.primary}66` }}>◈ SCAN3D</div>
        <div style={{ fontSize:9, letterSpacing:1.5, marginTop:4, color: apiOk ? C.dim : C.danger }}>
          {apiOk ? '● DB ONLINE' : '✕ DB OFFLINE'}
        </div>
        <div style={{ fontSize:9, letterSpacing:1.5, marginTop:2, color: arReady ? C.dim : C.danger }}>
          {arReady ? '● ARCORE OK' : '✕ ARCORE N/D'}
        </div>
      </div>
      <div style={{ textAlign:'right', lineHeight:1.8 }}>
        <div style={{ fontSize:20, fontWeight:'bold', color:C.primary,
          textShadow:`0 0 16px ${C.primary}` }}>
          {pts.toLocaleString()}
        </div>
        <div style={{ fontSize:9, color:C.dim, letterSpacing:2 }}>PONTOS</div>
        <div style={{ fontSize:11, color: mode === 'SCANNING' ? C.primary : 'rgba(255,255,255,0.3)',
          letterSpacing:2, marginTop:4 }}>{mode}</div>
      </div>
    </div>
  )
}

function Toast({ msg }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', top:'14%', left:'50%', transform:'translateX(-50%)',
      background:C.panel, border:`1px solid ${C.dim}`,
      padding:'8px 22px', borderRadius:24,
      fontSize:11, letterSpacing:2, color:C.primary,
      zIndex:1000, whiteSpace:'nowrap', pointerEvents:'none',
      boxShadow:`0 0 24px rgba(0,255,204,.2)`,
    }}>{msg}</div>
  )
}

function PointCloud({ points }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current || !points.length) return
    const n = points.length
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const p = points[i]
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z
      const c = p.confidence ?? 0.8
      col[i*3]=0; col[i*3+1]=c; col[i*3+2]=1-c*0.5
    }
    ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(pos,3))
    ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(col,3))
    ref.current.geometry.computeBoundingSphere()
  }, [points])

  return (
    <points ref={ref}>
      <bufferGeometry/>
      <pointsMaterial size={0.02} vertexColors sizeAttenuation transparent opacity={0.95}/>
    </points>
  )
}

function AutoRotate({ active }) {
  useFrame(({ camera }) => {
    if (!active) return
    camera.position.x = Math.sin(Date.now()*0.0003) * 3
    camera.position.z = Math.cos(Date.now()*0.0003) * 3
    camera.lookAt(0,0,0)
  })
  return null
}

export default function ScanView({ goViewer, goScans }) {
  const { points, addPoints, setScanning, scanning, clearPoints, setScanId, scanId, setMode, mode, arReady, setArReady } = useStore()
  const [toast, setToast] = useState('')
  const [apiOk, setApiOk] = useState(false)
  const scanIdRef = useRef(scanId)
  const bufRef = useRef([])
  const pushTimer = useRef(null)

  useEffect(() => { scanIdRef.current = scanId }, [scanId])

  const toast_ = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }, [])

  useEffect(() => {
    healthCheck().then(() => setApiOk(true)).catch(() => setApiOk(false))
    const t = setInterval(() => {
      healthCheck().then(() => setApiOk(true)).catch(() => setApiOk(false))
    }, 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (window.Scan3DBridge) {
      try {
        const ok = window.Scan3DBridge.isARAvailable()
        setArReady(ok)
        console.log('[BRIDGE]', `isARAvailable → ${ok}`)
      } catch(e) {
        console.error('[BRIDGE] erro:', e)
        setArReady(false)
      }
    }
  }, [])

  useEffect(() => {
    window.__onARPoints = (pts) => {
      addPoints(pts)
      bufRef.current.push(...pts)
    }
    window.__onARScanComplete = async (pts) => {
      addPoints(pts)
      setScanning(false)
      setMode('CONCLUÍDO')
      toast_(`✓ ${pts.length.toLocaleString()} PONTOS REAIS`)
      clearInterval(pushTimer.current)
      if (pts.length > 0) {
        try {
          let id = scanIdRef.current
          if (!id) {
            const r = await createScan('Scan ' + new Date().toLocaleTimeString('pt-BR'))
            id = r.id; setScanId(id); scanIdRef.current = id
          }
          await pushPoints(id, pts)
          toast_(`✓ SALVO — ${pts.length.toLocaleString()} PTS`)
        } catch(e) { toast_('ERRO AO SALVAR') }
      }
      window.Scan3DBridge?.vibrate(80)
    }
    window.__onARScanCancelled = () => {
      setScanning(false)
      setMode('CANCELADO')
      toast_('SCAN CANCELADO')
    }
    return () => {
      delete window.__onARPoints
      delete window.__onARScanComplete
      delete window.__onARScanCancelled
    }
  }, [])

  async function startScan() {
    if (!window.Scan3DBridge) { toast_('BRIDGE NATIVA N/D'); return }
    if (!arReady) { toast_('ARCORE NÃO DISPONÍVEL'); return }
    try {
      let id = scanIdRef.current
      if (!id) {
        const r = await createScan('Scan ' + new Date().toLocaleTimeString('pt-BR'))
        id = r.id; setScanId(id); scanIdRef.current = id
      }
      setScanning(true)
      setMode('SCANNING')
      toast_('ABRINDO ARCORE…')
      window.Scan3DBridge.startARScan()
    } catch(e) { toast_('ERRO: ' + e.message) }
  }

  const btn = {
    background:'rgba(0,255,204,.07)', border:`1px solid ${C.dim}`,
    color:C.primary, padding:'12px 16px', borderRadius:10,
    fontSize:10, letterSpacing:2, cursor:'pointer',
    WebkitTapHighlightColor:'transparent', userSelect:'none',
    minWidth:64, textAlign:'center', transition:'all .15s',
  }
  const btnRed = { ...btn, color:C.danger, borderColor:'rgba(255,96,96,.3)', background:'rgba(255,96,96,.05)' }
  const btnActive = { ...btn, background:'rgba(0,255,204,.2)', borderColor:C.primary, boxShadow:`0 0 16px rgba(0,255,204,.3)` }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', position:'fixed', inset:0, background:C.bg }}>
      <HUD pts={points.length} mode={mode} apiOk={apiOk} arReady={arReady} />
      <Toast msg={toast} />

      <Canvas
        style={{ position:'fixed', inset:0, zIndex:1 }}
        camera={{ position:[0,1,3], fov:65, near:0.001, far:500 }}
        gl={{ alpha:false, antialias:true }}
      >
        <color attach="background" args={['#000508']}/>
        <ambientLight intensity={0.4} color="#00ffcc"/>
        <pointLight position={[0,3,0]} intensity={0.6} color="#00ffcc"/>
        <PointCloud points={points}/>
        <AutoRotate active={!scanning && points.length > 0}/>
        <gridHelper args={[20, 40, '#001a0e', '#001208']} position={[0,-1,0]}/>
      </Canvas>

      <div style={{
        position:'fixed', bottom:0, left:0, right:0, zIndex:2,
        padding:'14px 12px 32px',
        background:'linear-gradient(to top,rgba(0,0,0,.95) 70%,transparent)',
      }}>
        <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
          <button style={scanning ? btnActive : btn} onClick={startScan}>
            {scanning ? '● AR ATIVO' : '⬤ SCAN AR'}
          </button>
          <button style={btn} onClick={() => {
            if (points.length < 10) { toast_('FAÇA UM SCAN PRIMEIRO'); return }
            goViewer()
          }}>◎ VER 3D</button>
          <button style={btn} onClick={goScans}>☰ SALVOS</button>
          <button style={btnRed} onClick={() => { clearPoints(); toast_('RESETADO') }}>✕ RESET</button>
        </div>
        {scanning && (
          <div style={{ textAlign:'center', marginTop:10, fontSize:9, color:'rgba(0,255,204,.45)', letterSpacing:2 }}>
            ARCORE ATIVO — MOVA O CELULAR DEVAGAR
          </div>
        )}
      </div>
    </div>
  )
}
