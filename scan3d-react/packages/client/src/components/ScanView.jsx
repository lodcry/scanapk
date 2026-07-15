import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { createScan, pushPoints } from '../api'

function useVisualViewportOffsets() {
  const [offsets, setOffsets] = useState({ bottom: 0, top: 0, height: window.innerHeight })
  useEffect(() => {
    const vv = window.visualViewport
    const update = () => {
      if (!vv) { setOffsets({ bottom: 0, top: 0, height: window.innerHeight }); return }
      setOffsets({
        bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
        top: Math.max(0, vv.offsetTop),
        height: vv.height
      })
    }
    update()
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update) }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      if (vv) { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return offsets
}

function HUD({ pts, fps, mode, alpha, beta, gamma, apiOk, topOffset }) {
  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, zIndex:1000, pointerEvents:'none',
      paddingTop: `calc(env(safe-area-inset-top) + ${topOffset}px + 10px)`,
      paddingLeft:14, paddingRight:14, paddingBottom:10,
      background:'linear-gradient(to bottom, rgba(0,0,0,.82) 0%, transparent 100%)',
      display:'flex', justifyContent:'space-between', alignItems:'flex-start',
    }}>
      <div>
        <div style={{ fontSize:14, letterSpacing:5, color:'#00ffcc', textShadow:'0 0 14px #00ffcc66' }}>◈ SCAN3D</div>
        <div style={{ fontSize:9, color: apiOk ? '#00ffcc88' : '#ff606088', letterSpacing:1, marginTop:2 }}>
          {apiOk ? '● API OK' : '✕ SEM API'}
        </div>
      </div>
      <div style={{ fontSize:9, color:'#00ffcc88', lineHeight:2, textAlign:'right', letterSpacing:1 }}>
        <span style={{ color:'#00ffcc', fontSize:11, fontWeight:'bold' }}>{pts.toLocaleString()}</span> PTS<br/>
        {fps} FPS<br/>
        α{alpha} β{beta} γ{gamma}<br/>
        <span style={{ color: mode === 'SCANNING' ? '#00ffcc' : '#ffffff55' }}>{mode}</span>
      </div>
    </div>
  )
}

function Cross({ active }) {
  const c = active ? '#00ffcc' : 'rgba(255,255,255,.3)'
  return (
    <div style={{
      position:'fixed', top:'50%', left:'50%',
      transform:'translate(-50%,-50%)',
      width:40, height:40, pointerEvents:'none', zIndex:10,
    }}>
      <div style={{ position:'absolute', width:1, height:'100%', left:'50%', background:c, opacity:.7 }}/>
      <div style={{ position:'absolute', width:'100%', height:1, top:'50%', background:c, opacity:.7 }}/>
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        width: active ? 7 : 4, height: active ? 7 : 4,
        background: c, borderRadius:'50%',
        transform:'translate(-50%,-50%)',
        boxShadow: active ? `0 0 12px ${c}` : 'none',
        transition:'all .2s',
      }}/>
    </div>
  )
}

function Toast({ msg, topOffset }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', top:`calc(env(safe-area-inset-top) + ${topOffset + 68}px)`, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,.85)', border:'1px solid rgba(0,255,204,.35)',
      padding:'7px 20px', borderRadius:20,
      fontSize:11, letterSpacing:1.5, color:'#00ffcc',
      zIndex:1000, whiteSpace:'nowrap', pointerEvents:'none',
      boxShadow:'0 0 20px rgba(0,255,204,.15)',
    }}>
      {msg}
    </div>
  )
}

function PointCloud({ points }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const n = points.length
    if (n === 0) {
      ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      return
    }
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const p = points[i]
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z
      const c=p.confidence??0.8
      col[i*3]=0; col[i*3+1]=c; col[i*3+2]=1-c
    }
    ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    ref.current.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
    ref.current.geometry.computeBoundingSphere()
  }, [points])
  return (
    <points ref={ref}>
      <bufferGeometry/>
      <pointsMaterial size={0.018} vertexColors sizeAttenuation transparent opacity={0.9}/>
    </points>
  )
}

function CamController({ alpha, beta, gamma }) {
  const { camera } = useThree()
  useFrame(() => {
    camera.rotation.set(THREE.MathUtils.degToRad(beta), THREE.MathUtils.degToRad(alpha), -THREE.MathUtils.degToRad(gamma), 'YXZ')
  })
  return null
}

function ARCube({ position }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.getElapsedTime() * 0.6
    ref.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 1.2) * 0.04
  })
  return (
    <mesh ref={ref} position={position}>
      <boxGeometry args={[0.18,0.18,0.18]}/>
      <meshStandardMaterial color="#00ffcc" metalness={0.6} roughness={0.2} emissive="#002211"/>
    </mesh>
  )
}

export default function ScanView({ goViewer, goScans }) {
  const { scanning, points, arObjects, mode, addPoints, setScanning, clearPoints, setScanId, scanId, setMode, addArObject } = useStore()
  const [fps, setFps] = useState(0)
  const [alpha, setAlpha] = useState(0)
  const [beta, setBeta] = useState(0)
  const [gamma, setGamma] = useState(0)
  const [toast, setToast] = useState('')
  const [apiOk, setApiOk] = useState(false)
  const [camErr, setCamErr] = useState(false)
  const [isFs, setIsFs] = useState(!!document.fullscreenElement)
  const { bottom: bottomOffset, top: topOffset } = useVisualViewportOffsets()
  const vidRef = useRef(null)
  const sensorRef = useRef({ alpha:0, beta:0, gamma:0, ax:0, ay:0, az:0 })
  const posRef = useRef({ px:0, py:0, pz:0, vx:0, vy:0, vz:0, lastTime:Date.now() })
  const bufRef = useRef([])
  const scanTimer = useRef(null)
  const pushTimer = useRef(null)
  const fpsRef = useRef({ count:0, last:Date.now() })
  const scanIdRef = useRef(scanId)
  useEffect(() => { scanIdRef.current = scanId }, [scanId])

  const toast_ = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2400)
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{})
    else document.documentElement.requestFullscreen().catch(()=>toast_('TELA CHEIA INDISPONÍVEL'))
  }

  useEffect(() => {
    fetch('/api/health').then(r=>r.ok&&setApiOk(true)).catch(()=>setApiOk(false))
    const t=setInterval(()=>{fetch('/api/health').then(r=>r.ok?setApiOk(true):setApiOk(false)).catch(()=>setApiOk(false))},5000)
    return ()=>clearInterval(t)
  }, [])

  useEffect(() => {
    const vid = document.createElement('video')
    vid.setAttribute('playsinline','')
    vid.muted = true
    vid.autoplay = true
    Object.assign(vid.style, {
      position:'fixed', top:0, left:0, width:'100%', height:'100%',
      objectFit:'cover', zIndex:0, pointerEvents:'none',
    })
    document.body.prepend(vid)
    vidRef.current = vid

    navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment', width:{ ideal:1280 } }, audio:false })
      .then(stream => { vid.srcObject = stream; vid.play(); toast_('CÂMERA ATIVA ●') })
      .catch(() => { setCamErr(true); toast_('SEM CÂMERA — MODO DEMO') })

    return () => {
      vid.srcObject?.getTracks().forEach(t=>t.stop())
      vid.remove()
    }
  }, [])

  // ═══════════════════════════════════════════════════════
  // PATCH: BRIDGE NATIVA + FALLBACK
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (window.__NATIVE_SENSORS__ && window.Scan3DBridge) {
      // bridge nativa — dados chegam via evaluateJavascript do Kotlin
      window.__onNativeOrientation = (a, b, g) => {
        sensorRef.current.alpha = a
        sensorRef.current.beta  = b
        sensorRef.current.gamma = g
        setAlpha(Math.round(a))
        setBeta(Math.round(b))
        setGamma(Math.round(g))
      }
      window.__onNativeAcceleration = (ax, ay, az) => {
        sensorRef.current.ax = ax
        sensorRef.current.ay = ay
        sensorRef.current.az = az
      }
      window.Scan3DBridge.startSensors()
      return () => {
        window.Scan3DBridge.stopSensors()
        delete window.__onNativeOrientation
        delete window.__onNativeAcceleration
      }
    } else {
      // fallback browser — deviceorientation original
      const onOri = e => {
        sensorRef.current.alpha = e.alpha||0
        sensorRef.current.beta  = e.beta||0
        sensorRef.current.gamma = e.gamma||0
        setAlpha(Math.round(e.alpha||0))
        setBeta(Math.round(e.beta||0))
        setGamma(Math.round(e.gamma||0))
      }
      const onMot = e => {
        const a = e.acceleration||{}
        sensorRef.current.ax = a.x||0
        sensorRef.current.ay = a.y||0
        sensorRef.current.az = a.z||0
      }
      window.addEventListener('deviceorientation', onOri, true)
      window.addEventListener('devicemotion', onMot, true)
      return () => {
        window.removeEventListener('deviceorientation', onOri, true)
        window.removeEventListener('devicemotion', onMot, true)
      }
    }
  }, [])
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setFps(Math.round(fpsRef.current.count / Math.max((now - fpsRef.current.last)/1000, 0.001)))
      fpsRef.current.count = 0
      fpsRef.current.last = now
    }, 1000)
    return () => clearInterval(id)
  }, [])

  function capturePoint() {
    fpsRef.current.count++
    const { alpha:a, beta:b, ax, ay, az } = sensorRef.current
    const pos = posRef.current
    const now = Date.now()
    const dt = Math.min((now - pos.lastTime)/1000, 0.08)
    pos.lastTime = now
    pos.vx = (pos.vx + ax*dt)*0.9
    pos.vy = (pos.vy + ay*dt)*0.9
    pos.vz = (pos.vz + az*dt)*0.9
    pos.px += pos.vx*dt
    pos.py += pos.vy*dt
    pos.pz += pos.vz*dt
    const aR = THREE.MathUtils.degToRad(a)
    const bR = THREE.MathUtils.degToRad(b)
    const batch = []
    for (let i=0; i<5; i++) {
      const spread = 0.25
      const d = 0.4 + Math.random()*3.5
      batch.push({
        x: pos.px + Math.sin(aR+(Math.random()-.5)*spread)*Math.cos(bR+(Math.random()-.5)*spread)*d,
        y: pos.py + Math.sin(bR+(Math.random()-.5)*spread)*d,
        z: pos.pz - Math.cos(aR+(Math.random()-.5)*spread)*Math.cos(bR+(Math.random()-.5)*spread)*d,
        confidence: 1-d/5, ts: now,
      })
    }
    bufRef.current.push(...batch)
    addPoints(batch)
  }

  async function startScan() {
    let id = scanIdRef.current
    if (!id) {
      try {
        const r = await createScan('Scan '+new Date().toLocaleTimeString('pt-BR'))
        id = r.id; setScanId(id); scanIdRef.current = id
      } catch (e) { toast_('ERRO AO CRIAR SCAN'); return }
    }
    setScanning(true); setMode('SCANNING'); toast_('SCANNING — MOVA O CELULAR')
    scanTimer.current = setInterval(capturePoint, 280)
    pushTimer.current = setInterval(async () => {
      if (bufRef.current.length > 0 && scanIdRef.current) {
        const batch = bufRef.current.splice(0, 150)
        try { await pushPoints(scanIdRef.current, batch) }
        catch (e) { bufRef.current.unshift(...batch) }
      }
    }, 2000)
  }

  async function stopScan() {
    clearInterval(scanTimer.current); clearInterval(pushTimer.current)
    if (bufRef.current.length > 0 && scanIdRef.current) {
      try { await pushPoints(scanIdRef.current, bufRef.current.splice(0)) }
      catch (e) { console.error('[STOP] flush falhou:', e.message) }
    }
    setScanning(false); setMode('PARADO')
    toast_(`PARADO — ${useStore.getState().points.length.toLocaleString()} PTS`)
  }

  function handleClear() {
    clearInterval(scanTimer.current); clearInterval(pushTimer.current)
    clearPoints()
    posRef.current = { px:0, py:0, pz:0, vx:0, vy:0, vz:0, lastTime:Date.now() }
    bufRef.current = []
    toast_('RESETADO')
  }

  function handleAddCube() {
    addArObject({ id: Date.now(), type:'cube', position:[0,0,-1.2] })
    toast_('CUBO AR ADICIONADO')
  }

  const btn = {
    background:'rgba(0,255,204,.06)', border:'1px solid rgba(0,255,204,.25)',
    color:'#00ffcc', padding:'11px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
    WebkitTapHighlightColor:'transparent', userSelect:'none',
    minWidth:60, textAlign:'center',
  }
  const btnRed = { ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)', background:'rgba(255,96,96,.05)' }
  const btnActive = { ...btn, background:'rgba(0,255,204,.18)', borderColor:'rgba(0,255,204,.6)', boxShadow:'0 0 12px rgba(0,255,204,.3)' }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh, 1vh) * 100)', position:'fixed', inset:0 }}>

      <HUD pts={points.length} fps={fps} mode={mode} alpha={alpha} beta={beta} gamma={gamma} apiOk={apiOk} topOffset={topOffset}/>
      <Cross active={scanning}/>
      <Toast msg={toast} topOffset={topOffset}/>

      {camErr && (
        <div style={{
          position:'fixed', top:'45%', left:'50%', transform:'translate(-50%,-50%)',
          color:'rgba(255,255,255,.3)', fontSize:11, letterSpacing:2, textAlign:'center',
          pointerEvents:'none', zIndex:5,
        }}>
          SEM CÂMERA<br/><span style={{ fontSize:9, opacity:.6 }}>MODO SIMULAÇÃO</span>
        </div>
      )}

      <Canvas
        style={{ position:'fixed', top:0, left:0, width:'100%', height:'100%', zIndex:1, pointerEvents:'none' }}
        camera={{ position:[0,0,0.001], fov:70, near:0.001, far:500 }}
        gl={{ alpha:true, antialias:true, preserveDrawingBuffer:false }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.setClearAlpha(0) }}
      >
        <ambientLight intensity={0.4} color="#00ffcc"/>
        <directionalLight position={[3,8,5]} intensity={0.8}/>
        <CamController alpha={alpha} beta={beta} gamma={gamma}/>
        <PointCloud points={points}/>
        {arObjects.map(o => o.type==='cube' && <ARCube key={o.id} position={o.position}/>)}
      </Canvas>

      <div style={{
        position:'fixed', left:0, right:0, zIndex:2,
        bottom: `${bottomOffset}px`,
        padding:'12px 10px calc(env(safe-area-inset-bottom) + 20px)',
        background:'linear-gradient(to top, rgba(0,0,0,.92) 60%, transparent)',
        transition: 'bottom 0.1s ease-out',
      }}>
        <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
          <button style={scanning ? btnActive : btn} onClick={scanning ? stopScan : startScan} onTouchStart={e=>e.stopPropagation()}>
            {scanning ? '⬛ PARAR' : '⬤ SCAN'}
          </button>
          <button style={btn} onClick={handleAddCube}>◻ CUBO</button>
          <button style={btn} onClick={()=>{if(points.length<10){toast_('FAÇA UM SCAN PRIMEIRO');return};goViewer()}}>◎ VER 3D</button>
          <button style={btn} onClick={goScans}>☰ SALVOS</button>
          <button style={btn} onClick={toggleFullscreen}>{isFs?'⤢ SAIR':'⛶ TELA CHEIA'}</button>
          <button style={btnRed} onClick={handleClear}>✕ RESET</button>
        </div>
        {scanning && (
          <div style={{ textAlign:'center', marginTop:8, fontSize:9, color:'rgba(0,255,204,.5)', letterSpacing:2 }}>
            CAPTURANDO ~{Math.round(1000/280*5)} PTS/S — TOTAL {points.length.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
