import React, { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as THREE from 'three'

function AvatarModel({ url, onLoaded, onError }) {
  const [scene, setScene] = useState(null)

  useEffect(() => {
    const loader = new GLTFLoader()
    loader.load(
      url,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const center = box.getCenter(new THREE.Vector3())
        gltf.scene.position.set(-center.x, -box.min.y, -center.z)
        setScene(gltf.scene)
        onLoaded && onLoaded()
      },
      undefined,
      (err) => onError && onError(err)
    )
  }, [url])

  if (!scene) return null
  return <primitive object={scene} />
}

export default function AvatarViewer({ avatarUrl, goBack }) {
  const [error, setError] = useState(null)
  const [carregado, setCarregado] = useState(false)

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
        <span style={{ fontSize:13, letterSpacing:5, color:'#00ffcc' }}>◈ AVATAR 3D</span>
        <button style={{ ...btn, color:'#ff6060', borderColor:'rgba(255,96,96,.3)' }} onClick={goBack}>✕</button>
      </div>
      <div style={{ flex:1, position:'relative' }}>
        {!avatarUrl && (
          <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', color:'rgba(0,255,204,.4)', fontSize:11, textAlign:'center' }}>
            NENHUM AVATAR AINDA<br/><span style={{ fontSize:9 }}>USE A ABA AVATAR PRA CRIAR UM</span>
          </div>
        )}
        {avatarUrl && (
          <Canvas camera={{ position:[0,1.1,2.6], fov:45 }}>
            <color attach="background" args={['#14141f']} />
            <ambientLight intensity={0.65} />
            <directionalLight position={[2,4,2]} intensity={1} castShadow />
            <directionalLight position={[-2,1,-2]} intensity={0.3} color="#88aaff" />
            <AvatarModel
              url={avatarUrl}
              onLoaded={() => setCarregado(true)}
              onError={(e) => setError('erro ao carregar avatar: ' + e.message)}
            />
            <OrbitControls enableDamping dampingFactor={0.08} minDistance={0.5} maxDistance={6} target={[0,0.95,0]} />
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
