import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store'
import { getColmapUrl } from '../config'

const C = {
  primary: '#00ffcc',
  danger:  '#ff6060',
  dim:     'rgba(0,255,204,0.35)',
  panel:   'rgba(0,0,0,0.88)',
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
    }}>{msg}</div>
  )
}

export default function ScanView({ goMesh }) {
  const { scanning, setScanning, mode, setMode, arReady, setArReady,
          jobStatus, jobMessage, setJob, resetJob } = useStore()
  const [toast, setToast] = useState('')
  const pollRef = useRef(null)

  const toast_ = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3200)
  }, [])

  useEffect(() => {
    if (window.Scan3DBridge) {
      try { setArReady(window.Scan3DBridge.isARAvailable()) }
      catch (e) { setArReady(false) }
    }
  }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const startPolling = useCallback((id) => {
    stopPolling()
    const COLMAP_URL = getColmapUrl()
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${COLMAP_URL}/jobs/${id}`)
        const data = await r.json()
        setJob({ jobStatus: data.status, jobMessage: data.message || '' })
        if (data.status === 'done') {
          stopPolling()
          setJob({ meshUrl: `${COLMAP_URL}/jobs/${id}/mesh` })
          toast_('✓ MODELO 3D PRONTO')
          setMode('CONCLUÍDO')
          goMesh()
        } else if (data.status === 'error') {
          stopPolling()
          toast_('ERRO NO SERVIDOR: ' + (data.message || ''))
          setMode('ERRO')
        }
      } catch (e) {
        // servidor pode estar acordando (cold start) — continua tentando
      }
    }, 4000)
  }, [])

  useEffect(() => {
    window.__onUploadStart = () => {
      setScanning(false)
      setMode('ENVIANDO')
      setJob({ jobStatus: 'uploading', jobMessage: 'enviando fotos...' })
      toast_('ENVIANDO FOTOS PRO SERVIDOR…')
    }
    window.__onUploadDone = (id) => {
      setJob({ jobId: id, jobStatus: 'queued', jobMessage: 'na fila' })
      setMode('PROCESSANDO')
      toast_('FOTOS ENVIADAS — PROCESSANDO NO SERVIDOR')
      startPolling(id)
    }
    window.__onUploadError = (msg) => {
      setMode('ERRO')
      toast_('ERRO NO ENVIO: ' + msg)
    }
    window.__onARScanCancelled = () => {
      setScanning(false)
      setMode('CANCELADO')
      toast_('SCAN CANCELADO')
    }
    return () => {
      delete window.__onUploadStart
      delete window.__onUploadDone
      delete window.__onUploadError
      delete window.__onARScanCancelled
      stopPolling()
    }
  }, [startPolling])

  function startScan() {
    if (!window.Scan3DBridge) { toast_('BRIDGE NATIVA N/D'); return }
    if (!arReady) { toast_('ARCORE NÃO DISPONÍVEL'); return }
    resetJob()
    setScanning(true)
    setMode('SCANNING')
    toast_('ABRINDO CÂMERA — TIRE FOTOS AO REDOR DO OBJETO')
    window.Scan3DBridge.startARScan()
  }

  const btn = {
    background:'rgba(0,255,204,.07)', border:`1px solid ${C.dim}`,
    color:C.primary, padding:'12px 16px', borderRadius:10,
    fontSize:10, letterSpacing:2, cursor:'pointer',
    WebkitTapHighlightColor:'transparent', userSelect:'none',
    minWidth:64, textAlign:'center',
  }

  return (
    <div style={{ width:'100vw', height:'calc(var(--vh,1vh)*100)', position:'fixed', inset:0, background:'#000' }}>
      <Toast msg={toast} />
      <div style={{ position:'fixed', top:'40%', left:0, right:0, textAlign:'center', color:C.primary }}>
        <div style={{ fontSize:15, letterSpacing:6, fontWeight:'bold' }}>◈ SCAN AR (COLMAP)</div>
        <div style={{ fontSize:10, marginTop:10, letterSpacing:1.5, color:'rgba(0,255,204,.5)' }}>{mode}</div>
        {jobStatus && jobStatus !== 'done' && (
          <div style={{ fontSize:9, marginTop:6, color:'rgba(0,255,204,.35)', letterSpacing:1 }}>{jobMessage}</div>
        )}
      </div>
      <div style={{
        position:'fixed', bottom:0, left:0, right:0,
        padding:'14px 12px 32px',
        background:'linear-gradient(to top,rgba(0,0,0,.95) 70%,transparent)',
      }}>
        <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
          <button style={btn} onClick={startScan} disabled={scanning}>
            {scanning ? '● CAPTURANDO' : '⬤ NOVO SCAN'}
          </button>
          {jobStatus === 'done' && (
            <button style={btn} onClick={goMesh}>◎ VER MODELO 3D</button>
          )}
        </div>
      </div>
    </div>
  )
}
