export function logC(nivel, modulo, mensagem, dados) {
  const linha = `[${modulo}] ${mensagem}`
  const fn = nivel === 'ERROR' ? console.error : nivel === 'WARN' ? console.warn : console.log
  fn(linha, dados ?? '')

  if (typeof window !== 'undefined' && window.Scan3DBridge) {
    try {
      window.Scan3DBridge.log(modulo.toUpperCase(), mensagem + (dados ? ' | ' + JSON.stringify(dados) : ''))
    } catch { /* ignora */ }
  }
}
