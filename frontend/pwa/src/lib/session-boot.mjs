/**
 * src/lib/session-boot.mjs
 * Decides the first screen at startup from the stored technician and /auth/me.
 *
 * Offline-first: only a 401 (expired or revoked session) sends the technician to
 * sign in. Any other failure (no network, server unreachable) keeps the app usable
 * with local data; the next request after reconnecting gets the 401 if the session
 * has ended, and local drafts and pending submissions are kept for after sign-in.
 */

const FIELDOPS_ROLES = ['TECHNICIAN', 'technician']

// Returns { screen: 'app' | 'passwordChange' | 'auth', user?, store?, clear? }
export async function resolveBootScreen (storedTechnician, fetchMe) {
  if (!storedTechnician) return { screen: 'auth' }
  if (!FIELDOPS_ROLES.includes(storedTechnician.role)) return { screen: 'auth', clear: true }
  try {
    const { user } = await fetchMe()
    if (user.role !== 'TECHNICIAN') return { screen: 'auth', clear: true }
    return { screen: 'app', user, store: true }
  } catch (err) {
    if (err?.status === 401) return { screen: 'auth' }
    return { screen: storedTechnician.mustChangePassword ? 'passwordChange' : 'app', user: storedTechnician }
  }
}
