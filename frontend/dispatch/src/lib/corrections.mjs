// Opens the Correction for a report: reuses the visit's open correction when
// there is one (the server allows only one open correction per visit),
// otherwise creates it. Returns the correction detail.
export async function openCorrectionFor (api, visitId) {
  const existing = await api.get(`/dispatch/corrections?visitId=${encodeURIComponent(visitId)}&status=open`)
  const correction = existing?.[0] ?? await api.post('/dispatch/corrections', { visitId })
  const id = correction.correctionId ?? correction.id
  return api.get(`/dispatch/corrections/${id}`)
}
