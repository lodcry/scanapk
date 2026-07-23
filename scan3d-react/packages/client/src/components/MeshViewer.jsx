import React, { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader'
import { useStore } from '../store'

function Mesh({ url, onLoaded, onError }) {
  const [geometry, setGeometry] = useState(null)

  useEffect(() => {
    const loader = new PLYLoader()
    loader.load(
      url,
      (geo) => {
        geo.computeVertexNormals()
        geo.center()
        setGeometry(geo)
        onLoaded && onLoaded()
      },
      undefined,
      (err) => onError && onError(err)
    )
  }, [url])

  if (!geometry) return null
  const hasColor = !!geometry.getAttribute('color')

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors={hasColor} color={hasColor ? undefined : '#00ffcc'} />
    </mesh>
  )
}

export default function MeshViewer({ goBack }) {
  const meshUrl = useStore((s) => s.meshUrl)
  const [error, setError] = useState(null)

  const btn = {
    background:'rgba(0,255,204,.07)', border:'1px solid rgba(0,255,204,.25)',
    color:'#00ffcc', padding:'9px 14px', borderRadius:8,
    fontSize:10, letterSpacing:1.5, cursor:'pointer',
  }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', display:'flex', flexDirection:'column', background:'#000508', position:'fixed', inset:0 }}>
      <div style={{
        padding:'12px 16px', background:'rgba(0,0,0,.9)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.1)',
      }}>
        <span style={{ fontSize:13, letterSpacing:5, color:'#00ffcc' }}>◈ MODELO 3D</span>
        <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>✕</button>
      </div>
      <div style={{ flex:1, position:'relative' }}>
        {!meshUrl && (
          <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', color:'rgba(0,255,204,.4)', fontSize:11 }}>
            NENHUM MODELO AINDA
          </div>
        )}
        {meshUrl && (
          <Canvas camera={{ position:[0,1,2], fov:55 }}>
            <color attach="background" args={['#000508']} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[3,5,3]} intensity={0.8} />
            <Mesh
              url={meshUrl}
              onError={(e) => setError('erro ao carregar modelo: ' + e.message)}
            />
            <OrbitControls enableDamping dampingFactor={0.08} minDistance={0.1} maxDistance={20} />
          </Canvas>
        )}
        {error && (
          <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', color:'#ff6060', fontSize:11, textAlign:'center', padding:'0 20px' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
