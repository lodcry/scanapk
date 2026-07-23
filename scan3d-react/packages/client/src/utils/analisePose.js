export function analisarPoseT(landmarks) {
  if (!landmarks || landmarks.length < 33)
    return { ok: false, msgs: ['Nenhuma pose detectada'] }

  const msgs = []
  const lm = landmarks

  if (Math.abs(lm[11].y - lm[12].y) > 0.08)
    msgs.push('Nivelhe os ombros')

  const largOmbros = Math.abs(lm[11].x - lm[12].x)
  const largPulsos = Math.abs(lm[15].x - lm[16].x)
  if (largPulsos < largOmbros * 1.3)
    msgs.push('Abra mais os braços')

  if (Math.abs(lm[15].y - lm[11].y) > 0.12 ||
      Math.abs(lm[16].y - lm[12].y) > 0.12)
    msgs.push('Mantenha os braços horizontais')

  const largQuadril    = Math.abs(lm[23].x - lm[24].x)
  const largTornozelos = Math.abs(lm[27].x - lm[28].x)
  if (largTornozelos < largQuadril * 0.8)
    msgs.push('Abra mais as pernas')

  const criticos  = [11, 12, 15, 16, 23, 24, 27, 28]
  const baixaVis  = criticos.filter(i => (lm[i]?.visibility || 0) < 0.5)
  if (baixaVis.length > 2)
    msgs.push('Recue — corpo não está totalmente visível')

  return { ok: msgs.length === 0, msgs, confianca: 1 - msgs.length / 5 }
}

export function calcularYaw(landmarks) {
  if (!landmarks || landmarks.length < 33) return 0
  const ombroEsq = landmarks[11]
  const ombroDir = landmarks[12]
  const nariz    = landmarks[0]
  const largOmbros = Math.abs(ombroDir.x - ombroEsq.x)
  if (largOmbros < 0.01) return 0
  const centrox = (ombroEsq.x + ombroDir.x) / 2
  const desvio  = (nariz.x - centrox) / largOmbros
  return desvio * 360
}

export function deltaYawCorrigido(yawAnterior, yawAtual) {
  let delta = yawAtual - yawAnterior
  if (delta >  180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

export function calcularTamanhoRosto(landmarks) {
  const olhoEsq = landmarks[33 + 33]
  const olhoDir = landmarks[33 + 263]
  if (!olhoEsq || !olhoDir || !olhoEsq.visibility) return 0
  return Math.sqrt((olhoDir.x - olhoEsq.x)**2 + (olhoDir.y - olhoEsq.y)**2)
}
