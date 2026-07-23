function bridge() {
  return typeof window !== 'undefined' && !!window.Scan3DBridge
    ? window.Scan3DBridge : null
}

export function isConfigured() {
  const b = bridge()
  if (b) try { return b.isConfigured() } catch {}
  return !!localStorage.getItem('genesis_configured')
}

export function getApiUrl() {
  const b = bridge()
  if (b) try { return b.getApiUrl() } catch {}
  return localStorage.getItem('genesis_api_url') || ''
}

export function setApiUrl(url) {
  const limpo = url.trim().replace(/\/+$/, '')
  const b = bridge()
  if (b) try { b.setApiUrl(limpo); return } catch {}
  localStorage.setItem('genesis_api_url', limpo)
}

export function getColmapUrl() {
  const b = bridge()
  if (b) try { return b.getColmapUrl() } catch {}
  return localStorage.getItem('genesis_colmap_url') || ''
}

export function setColmapUrl(url) {
  const limpo = url.trim().replace(/\/+$/, '')
  const b = bridge()
  if (b) try { b.setColmapUrl(limpo); return } catch {}
  localStorage.setItem('genesis_colmap_url', limpo)
}
