export function routePath() {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  let path = window.location.pathname || '/'
  if (base && path.startsWith(base)) path = path.slice(base.length) || '/'
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

export function routeHref(path) {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const next = path.startsWith('/') ? path : `/${path}`
  return `${base}${next}` || '/'
}
