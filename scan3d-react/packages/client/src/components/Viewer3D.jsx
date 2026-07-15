import React, { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'

function PointCloud({ points }) {
  const ref = useRef()

  const { positions, colors } = useMemo(() => {
    if (!points.length) return { positions: new Float32Array(0), colors: new Float32Array(0) }

    let cx = 0, cy = 0, cz = 0
    for (const p of points) { cx += p.x; cy += p.y; cz += p.z }
    cx /= points.length; cy /= points.length; cz /= points.length

    const positions = new Float32Array(points.length * 3)
    const colors    = new Float32Array(points.length * 3)

    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const c = p.confidence ?? 0.8
      positions[i*3]   = p.x - cx
      positions[i*3+1] = p.y - cy
      positions[i*3+2] = p.z - cz
      colors[i*3]      = 0
      colors[i*3+1]    = c
      colors[i*3+2]    = 1 - c
    }
    return { positions, colors }
  }, [points])

  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.0008
  })

  if (!points.length) return null

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.025} vertexColors sizeAttenuation transparent opacity={0.9}/>
    </points>
  )
}

function EmptyState() {
  return (
    <group>
      <Grid args={[10,10]} cellColor="#001a0e" sectionColor="#003322"/>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.05, 8, 8]}/>
        <meshBasicMaterial color="#00ffcc"/>
      </mesh>
    </group>
  )
}

export default function Viewer3D({ goBack }) {
  const points = useStore(s => s.points)
  const [autoRotate, setAutoRotate] = useState(true)

  const btn = {
    background:'rgba(0,255,204,.07)', border:'1px solid rgba(0,255,204,.25)',
    color:'#00ffcc', padding:'9px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
    WebkitTapHighlightColor:'transparent',
  }

  return (
    <div style={{ width:'100vw', height:'100vh', display:'flex', flexDirection:'column', background:'#030b07', position:'fixed', inset:0 }}>

      {/* Header */}
      <div style={{
        padding:'10px 14px', background:'rgba(0,0,0,.8)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.12)',
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ VIEWER 3D</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ fontSize:9, color:'rgba(0,255,204,.5)', letterSpacing:1 }}>
            {points.length.toLocaleString()} PTS
          </span>
          <button style={btn} onClick={() => setAutoRotate(v => !v)}>
            {autoRotate ? '⏸ AUTO' : '▶ AUTO'}
          </button>
          <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>
            ✕ FECHAR
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex:1, position:'relative' }}>
        <Canvas
          camera={{ position:[0, 1.5, 4], fov:60 }}
          gl={{ antialias:true, alpha:false }}
        >
          <color attach="background" args={['#030b07']}/>
          <ambientLight intensity={0.6}/>
          <directionalLight position={[5,10,5]} intensity={0.7} color="#00ffcc"/>
          <pointLight position={[-5,-5,-5]} intensity={0.3} color="#004422"/>

          {points.length > 0
            ? <PointCloud points={points}/>
            : <EmptyState/>
          }

          <Grid
            args={[20, 20]}
            position={[0, -1, 0]}
            cellColor="#001a0e"
            sectionColor="#003322"
            fadeDistance={15}
          />
          <OrbitControls
            enableDamping
            dampingFactor={0.07}
            autoRotate={autoRotate}
            autoRotateSpeed={0.4}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
            minDistance={0.5}
            maxDistance={30}
          />
        </Canvas>

        {points.length === 0 && (
          <div style={{
            position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            textAlign:'center', pointerEvents:'none',
            color:'rgba(0,255,204,.3)', fontSize:11, letterSpacing:2,
          }}>
            SEM PONTOS<br/>
            <span style={{ fontSize:9, opacity:.6 }}>FAÇA UM SCAN PRIMEIRO</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding:'10px', background:'rgba(0,0,0,.7)',
        borderTop:'1px solid rgba(0,255,204,.08)',
        textAlign:'center',
        fontSize:9, color:'rgba(0,255,204,.35)', letterSpacing:1.5,
      }}>
        1 DEDO = ORBITAR · 2 DEDOS = ZOOM/PAN
      </div>
    </div>
  )
}
