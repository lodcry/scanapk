import React, { useRef, useState, useEffect } from 'react'
import useMediaPipe from '../hooks/useMediaPipe'
import useCamera    from '../hooks/useCamera'
import { logC } from '../utils/logger'
import { getApiUrl } from '../config'
import { analisarPoseT, calcularYaw, deltaYawCorrigido, calcularTamanhoRosto } from '../utils/analisePose'

const FACE_SIZE_MINIMA   = 0.14
const FRAMES_FRENTE_MIN  = 8
const FRAMES_GIRADOS_MIN = 25
const FRAMES_ROSTO_MIN   = 20
const TEMPO_ROSTO_MIN_MS = 2500
const GRAUS_GIRO_MIN     = 280
const CAPTURA_INTERVALO  = 150

const C = { primary: '#00ffcc', danger: '#ff6060', dim: 'rgba(0,255,204,0.35)' }

export default function ScanAvatar({ onAvatarPronto, goBack }) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)

  const capturaRef = useRef({
    frames_frente:[], frames_girados:[], frames_rosto:[],
    landmarks_frente:[], landmarks_girados:[], landmarks_rosto:[],
    yaws_girados:[],
  })

  const yawAtualRef     = useRef(0)
  const yawAnteriorRef  = useRef(0)
  const yawAcumRef      = useRef(0)
  const ultimaCaptRef   = useRef(0)
  const intervalosRef   = useRef([])
  const etapaRef        = useRef('inicio')
  const rostoOkDesdeRef = useRef(null)

  const { pronto:mpPronto, erro:mpErro, detectar } = useMediaPipe()
  const { ativa, erro:camErro, camera, iniciar, parar, trocar, capturarFrame } = useCamera()

  const [etapa,        setEtapa]        = useState('inicio')
  const [analise,      setAnalise]      = useState({ ok:false, msgs:['Iniciando...'] })
  const [tempoOk,      setTempoOk]      = useState(0)
  const [progresso,    setProgresso]    = useState(0)
  const [altura,       setAltura]       = useState('182')
  const [peso,         setPeso]         = useState('75')
  const [mensagem,     setMensagem]     = useState('')
  const [erroTexto,    setErroTexto]    = useState(null)
  const [statusApi,    setStatusApi]    = useState('')
  const [totalFrames,  setTotalFrames]  = useState(0)
  const [grausGiro,    setGrausGiro]    = useState(0)
  const [tamanhoRosto, setTamanhoRosto] = useState(0)

  useEffect(()=>{ etapaRef.current = etapa },[etapa])
  useEffect(()=>()=>intervalosRef.current.forEach(clearInterval),[])

  useEffect(()=>{
    if(!mpPronto||!ativa||etapaRef.current==='inicio') return
    let ok=true
    function loop(){
      if(!ok) return
      const video=videoRef.current
      if(video?.readyState>=2){
        const res=detectar(video,performance.now())
        if(res?.landmarks?.[0]){
          const lm=res.landmarks[0]
          if(etapaRef.current==='pose_t') setAnalise(analisarPoseT(lm))
          const yawNovo=calcularYaw(lm)
          const delta=deltaYawCorrigido(yawAnteriorRef.current,yawNovo)
          yawAnteriorRef.current=yawNovo
          yawAtualRef.current=yawNovo
          if(etapaRef.current==='girando'){
            yawAcumRef.current+=delta
            setGrausGiro(Math.round(Math.abs(yawAcumRef.current)))
          }
          setTamanhoRosto(calcularTamanhoRosto(lm))
          _desenharCanvas(lm)
          _processarCaptura(lm)
        }
      }
      rafRef.current=requestAnimationFrame(loop)
    }
    rafRef.current=requestAnimationFrame(loop)
    return()=>{ok=false;cancelAnimationFrame(rafRef.current)}
  },[mpPronto,ativa,detectar])

  function _processarCaptura(lm){
    const agora=Date.now()
    const et=etapaRef.current
    if(agora-ultimaCaptRef.current<CAPTURA_INTERVALO) return
    ultimaCaptRef.current=agora
    const c=capturaRef.current

    if(et==='capturando_frente'){
      const frame=capturarFrame(videoRef.current)
      if(frame){c.frames_frente.push(frame);c.landmarks_frente.push([...lm])}
      if(Math.abs(yawAtualRef.current)>25&&c.frames_frente.length>=FRAMES_FRENTE_MIN){
        yawAnteriorRef.current=yawAtualRef.current
        yawAcumRef.current=0
        _irPara('girando','Gire devagar 360° completo — pode ir!')
      }
    }
    else if(et==='girando'){
      const frame=capturarFrame(videoRef.current)
      if(frame){c.frames_girados.push(frame);c.landmarks_girados.push([...lm]);c.yaws_girados.push(yawAtualRef.current)}
      const graus=Math.abs(yawAcumRef.current)
      setProgresso(Math.round(Math.min(graus/GRAUS_GIRO_MIN*100,100)))
      if(graus>=GRAUS_GIRO_MIN&&c.frames_girados.length>=FRAMES_GIRADOS_MIN){
        _irPara('rosto','Perfeito! Agora aproxime o rosto da câmera')
      }
    }
    else if(et==='rosto'){
      const faceSize=calcularTamanhoRosto(lm)
      const pertoAgora=faceSize>=FACE_SIZE_MINIMA

      if(pertoAgora&&!rostoOkDesdeRef.current){
        rostoOkDesdeRef.current=agora
        setMensagem('Segure firme — capturando rosto...')
      } else if(!pertoAgora&&rostoOkDesdeRef.current){
        rostoOkDesdeRef.current=null
        setMensagem(`Chegue mais perto (${(faceSize/FACE_SIZE_MINIMA*100).toFixed(0)}%)`)
      }

      const tempoDecorrido=rostoOkDesdeRef.current?(agora-rostoOkDesdeRef.current):0
      const pctTam=Math.min(faceSize/FACE_SIZE_MINIMA*100,100)
      const pctTempo=Math.min(tempoDecorrido/TEMPO_ROSTO_MIN_MS*100,100)
      setProgresso(Math.round(Math.min(pctTam,pctTempo)))

      if(faceSize>=FACE_SIZE_MINIMA*0.75){
        const frame=capturarFrame(videoRef.current,0.95)
        if(frame){c.frames_rosto.push(frame);c.landmarks_rosto.push([...lm])}
      }

      if(pertoAgora&&tempoDecorrido>=TEMPO_ROSTO_MIN_MS&&c.frames_rosto.length>=FRAMES_ROSTO_MIN){
        _irPara('processando','Enviando pra API...')
        processarDigitalizacao()
      }
    }

    setTotalFrames(c.frames_frente.length+c.frames_girados.length+c.frames_rosto.length)
  }

  function _irPara(novaEtapa,msg=''){
    setEtapa(novaEtapa)
    etapaRef.current=novaEtapa
    setProgresso(0)
    setMensagem(msg)
    if(novaEtapa!=='rosto') rostoOkDesdeRef.current=null
  }

  useEffect(()=>{
    if(etapa!=='pose_t') return
    if(!analise.ok){setTempoOk(0);return}
    const t=setInterval(()=>{
      setTempoOk(prev=>{
        const n=prev+0.1
        if(n>=2){clearInterval(t);_irPara('capturando_frente','Fique de frente — capturando...');return 0}
        return n
      })
    },100)
    intervalosRef.current.push(t)
    return()=>clearInterval(t)
  },[etapa,analise.ok])

  async function processarDigitalizacao(){
    setErroTexto(null)
    const API_URL = getApiUrl()
    const c=capturaRef.current
    logC('INFO','scan','Enviando pra genesis-api',{ api: API_URL })

    try{
      setStatusApi('Verificando API...')
      let tentativas=0
      while(tentativas<6){
        try{
          const health=await fetch(`${API_URL}/saude`,{signal:AbortSignal.timeout(8000)})
          await health.json()
          break
        }catch(e){
          tentativas++
          setStatusApi(`API acordando... ${tentativas}/6`)
          await new Promise(r=>setTimeout(r,8000))
        }
      }
      if(tentativas>=6){
        setErroTexto('API não respondeu após 6 tentativas — confira a URL na aba Config')
        _irPara('erro');return
      }

      const avId=Math.random().toString(36).slice(2,10)+Date.now().toString(36)
      const tf=c.frames_frente.length+c.frames_girados.length+c.frames_rosto.length
      setStatusApi(`Enviando ${tf} frames...`)

      const payload={
        avatar_id:avId, nome:'Meu Avatar',
        frames:{frente:c.frames_frente,girados:c.frames_girados,rosto_proximo:c.frames_rosto},
        yaws:{girados:c.yaws_girados},
        landmarks:{
          frente:  c.landmarks_frente.map(f=>f.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility||1}))),
          girados: c.landmarks_girados.map(f=>f.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility||1}))),
          rosto:   c.landmarks_rosto.map(f=>f.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility||1}))),
        },
        metadata:{altura_cm:parseFloat(altura),peso_kg:parseFloat(peso),giro_total_graus:yawAcumRef.current},
      }

      const resp=await fetch(`${API_URL}/processar`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),
      })
      if(!resp.ok){
        const txt=await resp.text().catch(()=>'')
        throw new Error(`API retornou ${resp.status}: ${txt}`)
      }
      await _pollingStatus(avId, API_URL)

    }catch(e){
      logC('ERROR','scan','Falha: '+e.message)
      setErroTexto(e.message)
      _irPara('erro')
    }
  }

  async function _pollingStatus(avId, API_URL){
    const MAX=72
    for(let i=0;i<MAX;i++){
      await new Promise(r=>setTimeout(r,4000))
      try{
        const r=await fetch(`${API_URL}/status/${avId}`)
        const data=await r.json()
        setStatusApi(`${data.mensagem} (${data.progresso}%)`)
        if(data.status==='pronto'&&data.glb_url){
          _irPara('pronto','Avatar criado!')
          onAvatarPronto({
            id:avId, nome:'Meu Avatar',
            altura_cm:parseFloat(altura), peso_kg:parseFloat(peso),
            glb_url:`${API_URL}${data.glb_url}`,
          })
          return
        }
        if(data.status==='erro') throw new Error(data.erro||'API falhou')
      }catch(e){
        if(e.message.includes('API')){ setErroTexto(e.message);_irPara('erro');return }
        setStatusApi(`Aguardando API... (${i+1})`)
      }
    }
    setErroTexto('Processamento demorou demais (timeout)')
    _irPara('erro')
  }

  function cancelar(){
    intervalosRef.current.forEach(clearInterval);intervalosRef.current=[]
    cancelAnimationFrame(rafRef.current);parar()
    capturaRef.current={
      frames_frente:[],frames_girados:[],frames_rosto:[],
      landmarks_frente:[],landmarks_girados:[],landmarks_rosto:[],
      yaws_girados:[],
    }
    yawAcumRef.current=0;rostoOkDesdeRef.current=null
    setGrausGiro(0);_irPara('inicio');setErroTexto(null);setTotalFrames(0)
  }

  async function comecar(){
    _irPara('pose_t')
    setAnalise({ok:false,msgs:['Entre na pose T...']})
    setTempoOk(0);setErroTexto(null)
    capturaRef.current={
      frames_frente:[],frames_girados:[],frames_rosto:[],
      landmarks_frente:[],landmarks_girados:[],landmarks_rosto:[],
      yaws_girados:[],
    }
    yawAcumRef.current=0;rostoOkDesdeRef.current=null
    await iniciar(videoRef.current,camera)
  }

  function _desenharCanvas(lm){
    const canvas=canvasRef.current,video=videoRef.current
    if(!canvas||!video) return
    canvas.width=video.videoWidth;canvas.height=video.videoHeight
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height
    ctx.clearRect(0,0,w,h)
    const cx=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[0,11],[0,12]]
    ctx.strokeStyle='#00ffcc';ctx.lineWidth=3
    cx.forEach(([a,b])=>{
      if(!lm[a]||!lm[b]) return
      ctx.beginPath();ctx.moveTo(lm[a].x*w,lm[a].y*h);ctx.lineTo(lm[b].x*w,lm[b].y*h);ctx.stroke()
    })
    ctx.fillStyle='#00ffcc66'
    for(let i=33;i<501;i++){if(!lm[i])continue;ctx.beginPath();ctx.arc(lm[i].x*w,lm[i].y*h,1.2,0,Math.PI*2);ctx.fill()}
    ctx.fillStyle='#00ffcc'
    for(let i=0;i<33;i++){if(!lm[i])continue;ctx.beginPath();ctx.arc(lm[i].x*w,lm[i].y*h,5,0,Math.PI*2);ctx.fill()}
    if(etapaRef.current==='rosto'){
      const pct=Math.min(tamanhoRosto/FACE_SIZE_MINIMA,1)
      ctx.strokeStyle=pct>=1?'#44ff88':'#ffaa00';ctx.lineWidth=3
      ctx.strokeRect(w*.25,h*.1,w*.5,h*.7)
    }
  }

  const etapasVideo=['pose_t','capturando_frente','girando','rosto']
  const btn = { background:'rgba(0,255,204,.07)', border:`1px solid ${C.dim}`, color:C.primary, padding:'9px 14px', borderRadius:8, fontSize:10, letterSpacing:1.5, cursor:'pointer' }

  return (
    <div style={{width:'100vw',height:'calc(var(--vh,1vh)*100)',display:'flex',flexDirection:'column',background:'#000',position:'fixed',inset:0}}>
      <div style={{
        padding:'12px 16px', background:'rgba(0,0,0,.9)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(0,255,204,.1)', zIndex:5,
      }}>
        <span style={{ fontSize:13, letterSpacing:4, color:'#00ffcc' }}>◈ SCAN AVATAR</span>
        <button style={{ ...btn, color:C.danger, borderColor:'rgba(255,96,96,.3)' }} onClick={()=>{cancelar();goBack()}}>✕</button>
      </div>

      <div style={{flex:1,position:'relative',background:'#000',overflow:'hidden'}}>
        <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',display:ativa?'block':'none'}}/>
        <canvas ref={canvasRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',display:ativa?'block':'none'}}/>

        {!ativa&&etapa==='inicio'&&(
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:18,padding:24}}>
            <div style={{fontSize:56}}>🧍</div>
            <div style={{fontSize:13,color:'#888',textAlign:'center',lineHeight:1.7,maxWidth:300}}>
              Fique a 2m da câmera, em pé, com boa iluminação.<br/>
              <strong style={{color:'#ccc'}}>T-pose → frente → giro 360° → rosto</strong>
            </div>
            <div style={{display:'flex',gap:16,marginTop:6}}>
              {[['Altura (cm)',altura,setAltura],['Peso (kg)',peso,setPeso]].map(([lbl,val,set])=>(
                <div key={lbl}>
                  <label style={{color:'#666',fontSize:11}}>{lbl}</label>
                  <input type="number" value={val} onChange={e=>set(e.target.value)}
                    style={{display:'block',background:'#0d0d0d',border:'1px solid rgba(0,255,204,.2)',color:'#fff',padding:'10px 12px',borderRadius:8,width:100,fontSize:17,marginTop:4}}/>
                </div>
              ))}
            </div>
            <button onClick={comecar} disabled={!mpPronto} style={{
              marginTop:10, padding:'14px 28px',
              background: mpPronto ? '#00ffcc' : '#222', color: mpPronto ? '#001510' : '#555',
              border:'none', borderRadius:12, fontSize:14, fontWeight:700, cursor: mpPronto ? 'pointer' : 'not-allowed',
            }}>
              {mpPronto?'📷 Iniciar Digitalização':'Carregando detectores...'}
            </button>
          </div>
        )}

        {etapa==='pose_t'&&(
          <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(transparent,rgba(0,0,0,0.95))',padding:'40px 16px 16px'}}>
            <div style={{color:'#fff',fontSize:14,fontWeight:600,marginBottom:10,textAlign:'center'}}>Entre na pose T: braços abertos, pernas afastadas</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10,justifyContent:'center'}}>
              {analise.msgs.map((m,i)=>(
                <span key={i} style={{background:'#ff4444',borderRadius:20,padding:'5px 11px',fontSize:11,fontWeight:600}}>{m}</span>
              ))}
              {analise.ok&&<span style={{background:'#44ff88',color:'#000',borderRadius:20,padding:'5px 11px',fontSize:11,fontWeight:700}}>✓ Pose correta! Segure...</span>}
            </div>
          </div>
        )}

        {['capturando_frente','girando','rosto'].includes(etapa)&&(
          <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,0.92)',padding:'16px'}}>
            <div style={{color:'#00ffcc',fontSize:15,fontWeight:600,marginBottom:8,textAlign:'center'}}>{mensagem}</div>
            {etapa==='girando'&&<div style={{color:'#aaa',fontSize:12,textAlign:'center',marginBottom:6}}>{grausGiro}° de {GRAUS_GIRO_MIN}° girados</div>}
            <div style={{background:'#222',borderRadius:6,height:8}}>
              <div style={{background:'#00ffcc',height:8,borderRadius:6,width:`${progresso}%`,transition:'width .3s'}}/>
            </div>
            <div style={{color:'#444',fontSize:10,marginTop:6,textAlign:'center'}}>{totalFrames} frames · {progresso}%</div>
          </div>
        )}

        {etapa==='processando'&&(
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.95)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:18}}>
            <div style={{fontSize:52,animation:'girar 1.2s linear infinite'}}>⚙️</div>
            <style>{`@keyframes girar{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            <div style={{color:'#00ffcc',fontSize:15,fontWeight:600,textAlign:'center'}}>{mensagem}</div>
            <div style={{color:'#666',fontSize:12,textAlign:'center'}}>{statusApi}</div>
          </div>
        )}

        {etapa==='pronto'&&(
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.95)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
            <div style={{fontSize:64}}>✅</div>
            <div style={{color:'#44ff88',fontSize:20,fontWeight:700}}>Avatar criado!</div>
          </div>
        )}

        {etapa==='erro'&&(
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.97)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:24}}>
            <div style={{fontSize:48}}>⚠️</div>
            <div style={{color:'#ff4444',fontSize:16,fontWeight:700,textAlign:'center'}}>Falha ao criar avatar</div>
            <div style={{color:'#aaa',fontSize:11,textAlign:'center',maxWidth:300,fontFamily:'monospace',background:'#0d0d0d',padding:12,borderRadius:8}}>{erroTexto}</div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>{_irPara('processando','Reenviando...');processarDigitalizacao()}}
                style={{padding:'12px 18px',background:'#00ffcc',color:'#001510',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                Tentar de novo
              </button>
              <button onClick={cancelar}
                style={{padding:'12px 18px',background:'#222',color:'#fff',border:'1px solid #333',borderRadius:10,fontSize:13,cursor:'pointer'}}>
                Recomeçar
              </button>
            </div>
          </div>
        )}

        {(mpErro||camErro)&&(
          <div style={{position:'absolute',top:8,left:8,right:8,background:'#ff000033',borderRadius:8,padding:10}}>
            <div style={{color:'#ff4444',fontSize:11}}>{mpErro||camErro}</div>
          </div>
        )}
      </div>

      {etapasVideo.includes(etapa)&&(
        <div style={{padding:'10px 14px',background:'#0d0d0d',display:'flex',gap:8,borderTop:'1px solid rgba(0,255,204,.1)'}}>
          <button onClick={()=>trocar(videoRef.current)} style={{padding:'13px 16px',background:'#111',color:'#fff',border:'1px solid rgba(0,255,204,.2)',borderRadius:12,fontSize:18,cursor:'pointer'}}>🔄</button>
          <button onClick={cancelar} style={{flex:1,padding:13,background:'#ff4444',color:'#fff',border:'none',borderRadius:12,fontSize:14,fontWeight:600,cursor:'pointer'}}>✕ Cancelar</button>
        </div>
      )}
    </div>
  )
}
