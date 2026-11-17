/** Shared same-origin API client for Dispatch and FieldOps. */
const BASE_URL = '/api'

async function request (method, path, body = null, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers['X-FieldOps-Request'] = '1'
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  })

  if (response.status === 401) {
    localStorage.removeItem('technician')
    window.dispatchEvent(new CustomEvent('auth:expired'))
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  if (!response.ok) {
    let message = `API error ${response.status}`
    let code = null
    let fields = null
    try {
      const payload = await response.json()
      message = payload.error ?? payload.message ?? message
      code = payload.code ?? null
      fields = Array.isArray(payload.fields) ? payload.fields : null
    } catch (_) {}
    const err = new Error(message)
    err.status = response.status
    if (code) err.code = code
    if (fields) err.fields = fields
    throw err
  }
  if (response.status === 204) return null
  return response.json()
}

async function upload (path, formData) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-FieldOps-Request': '1' },
    body: formData,
  })
  if (response.status === 401) {
    localStorage.removeItem('technician')
    window.dispatchEvent(new CustomEvent('auth:expired'))
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  if (!response.ok) {
    let message = `Upload error ${response.status}`
    try {
      const payload = await response.json()
      message = payload.error ?? payload.message ?? message
    } catch (_) {}
    const err = new Error(message)
    err.status = response.status
    throw err
  }
  return response.json()
}

export const api = {
  get: (path, options) => request('GET', path, null, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  patch: (path, body, options) => request('PATCH', path, body, options),
  delete: (path, options) => request('DELETE', path, null, options),
  upload,
}
