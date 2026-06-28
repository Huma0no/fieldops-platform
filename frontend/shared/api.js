/**
 * shared/api.js
 * Authenticated fetch wrapper — single path for all API calls.
 * Both PWA and Dispatch import this module.
 *
 * Usage:
 *   import { api } from '../../shared/api.js'
 *   const data = await api.post('/auth/redeem-invite', { inviteCode })
 *   const visits = await api.get('/visits/mine')
 */

const BASE_URL = '/api'

function getToken () {
  return localStorage.getItem('deviceToken')
}

function buildHeaders (extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function request (method, path, body = null, options = {}) {
  const url = `${BASE_URL}${path}`
  const config = {
    method,
    headers: buildHeaders(options.headers ?? {}),
  }
  if (body !== null) {
    config.body = JSON.stringify(body)
  }

  const response = await fetch(url, config)

  if (response.status === 401) {
    // Token revoked or expired — clear auth and notify the app
    localStorage.removeItem('deviceToken')
    localStorage.removeItem('technician')
    window.dispatchEvent(new CustomEvent('auth:expired'))
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }

  if (!response.ok) {
    let message = `API error ${response.status}`
    try {
      const payload = await response.json()
      message = payload.error ?? payload.message ?? message
    } catch (_) { /* response body was not JSON */ }
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  // 204 No Content — return null
  if (response.status === 204) return null

  return response.json()
}

async function upload (path, formData) {
  const url = `${BASE_URL}${path}`
  const token = getToken()
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    let message = `Upload error ${response.status}`
    try {
      const payload = await response.json()
      message = payload.error ?? payload.message ?? message
    } catch (_) { /* non-JSON */ }
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  return response.json()
}

export const api = {
  get:    (path, options)        => request('GET',    path, null, options),
  post:   (path, body, options)  => request('POST',   path, body, options),
  put:    (path, body, options)  => request('PUT',    path, body, options),
  patch:  (path, body, options)  => request('PATCH',  path, body, options),
  delete: (path, options)        => request('DELETE', path, null, options),
  upload: (path, formData)       => upload(path, formData),
}
