import { useRef, useState, useCallback } from 'react'

export default function useCamera() {
  const streamRef = useRef(null)
  const [ativa, setAtiva] = useState(false)
  const [erro, setErro] = useState(null)
  const [camera, setCamera] = useState('user')

  const iniciar = useCallback(async (videoEl, facingMode = 'user') => {
    try {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()) }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false
      })
      streamRef.current = stream
      if (videoEl) { videoEl.srcObject = stream; await videoEl.play() }
      setAtiva(true)
      setCamera(facingMode)
      setErro(null)
    } catch (e) { setErro(e.message) }
  }, [])

  const parar = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setAtiva(false)
  }, [])

  const trocar = useCallback(async (videoEl) => {
    const nova = camera === 'user' ? 'environment' : 'user'
    await iniciar(videoEl, nova)
  }, [camera, iniciar])

  const capturarFrame = useCallback((videoEl, qualidade = 0.85) => {
    if (!videoEl || videoEl.readyState < 2) return null
    const canvas = document.createElement('canvas')
    canvas.width = videoEl.videoWidth
    canvas.height = videoEl.videoHeight
    canvas.getContext('2d').drawImage(videoEl, 0, 0)
    return canvas.toDataURL('image/jpeg', qualidade)
  }, [])

  return { ativa, erro, camera, iniciar, parar, trocar, capturarFrame }
}
