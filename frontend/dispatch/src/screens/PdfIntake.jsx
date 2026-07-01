/**
 * src/screens/PdfIntake.jsx
 * F5 — PDF Intake workflow for the Dispatch panel.
 *
 * Three stages:
 *   1. Upload   — drag-and-drop or file picker, POST /api/dispatch/parse-pdf
 *   2. Review   — call by call, GET batch/:id/call/:index, Confirm / Skip
 *   3. Release  — POST batch/:id/release-to-lobby
 */

import { useState, useRef, useCallback } from 'react'
import { api } from '@shared/api.js'
import AddressModal from '../components/AddressModal.jsx'

// ── Stage constants ────────────────────────────────────────
const STAGE = { UPLOAD: 'upload', REVIEW: 'review', DONE: 'done' }

// ── Field labels for the review form ──────────────────────
const FIELD_LABELS = {
  scheduledTime:           'Scheduled time',
  address:                 'Address',
  city:                    'City',
  subdivision:             'Subdivision',
  orderNumber:             'Order #',
  builder:                 'Builder',
  builderContactName:      'Contact name',
  builderContactPhone:     'Contact phone',
  workType:                'Work type',
  preSpecifiedThermostat:  'Thermostat',
  companyNotes:            'Company notes',
}

export default function PdfIntake () {
  const [stage, setStage]           = useState(STAGE.UPLOAD)
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [batch, setBatch]           = useState(null)       // { batchId, totalCalls }
  const [callIndex, setCallIndex]   = useState(1)          // 1-based
  const [call, setCall]             = useState(null)        // current call draft
  const [loadingCall, setLoadingCall] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [skipping, setSkipping]     = useState(false)
  const [releasing, setReleasing]   = useState(false)
  const [releaseResult, setReleaseResult] = useState(null)
  const [addressModal, setAddressModal] = useState(null)   // { extracted, existing, onResolve }
  const [fields, setFields]         = useState({})         // editable form state
  const [pdfUrl, setPdfUrl]         = useState(null)       // object URL for PDF preview
  const fileInputRef = useRef(null)
  const dropRef      = useRef(null)

  // ── Upload ───────────────────────────────────────────────

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Please select a PDF file.')
      return
    }
    setUploading(true)
    setUploadError('')

    // Show PDF preview
    const objectUrl = URL.createObjectURL(file)
    setPdfUrl(objectUrl)

    const form = new FormData()
    form.append('pdf', file)
    form.append('filename', file.name)

    try {
      const data = await api.upload('/dispatch/parse-pdf', form)
      setBatch({ batchId: data.batchId, totalCalls: data.totalCalls })
      setStage(STAGE.REVIEW)
      loadCall(data.batchId, 1)
    } catch (err) {
      setUploadError('Extraction failed. Check your connection and try again.')
      console.error('parse-pdf failed:', err)
    } finally {
      setUploading(false)
    }
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }, [handleFile])

  const onDragOver = (e) => e.preventDefault()

  // ── Load call ────────────────────────────────────────────

  async function loadCall (batchId, index) {
    setLoadingCall(true)
    setCall(null)
    try {
      const data = await api.get(`/dispatch/batch/${batchId}/call/${index}`)
      setCall(data)
      setFields(flattenCall(data.extracted))
    } catch (err) {
      console.error('load call failed:', err)
    } finally {
      setLoadingCall(false)
    }
  }

  function flattenCall (extracted) {
    if (!extracted) return {}
    return {
      scheduledTime:          extracted.scheduledTime          ?? '',
      address:                extracted.address                ?? '',
      city:                   extracted.city                   ?? '',
      subdivision:            extracted.subdivision            ?? '',
      orderNumber:            extracted.orderNumber            ?? '',
      builder:                extracted.builder                ?? '',
      builderContactName:     extracted.builderContactName     ?? '',
      builderContactPhone:    extracted.builderContactPhone    ?? '',
      workType:               extracted.workType               ?? '',
      preSpecifiedThermostat: extracted.preSpecifiedThermostat ?? '',
      preIdentifiedAccessories: (extracted.preIdentifiedAccessories ?? []).join(', '),
      companyNotes:           extracted.companyNotes           ?? '',
    }
  }

  // ── Confirm ──────────────────────────────────────────────

  async function handleConfirm () {
    setConfirming(true)
    try {
      const body = {
        ...fields,
        preIdentifiedAccessories: fields.preIdentifiedAccessories
          ? fields.preIdentifiedAccessories.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        systems: call?.extracted?.systems ?? [],
      }

      const result = await api.post(
        `/dispatch/batch/${batch.batchId}/call/${callIndex}/confirm`,
        body
      )

      if (result.comparisonRequired) {
        // Address partial match — show modal
        setAddressModal({
          extracted:  fields.address,
          existing:   result.existingAddress,
          onResolve:  async (action) => {
            setAddressModal(null)
            await api.post(`/addresses/${result.addressId}/resolve-comparison`, {
              action,
              incomingData: body,
            })
            advanceCall()
          },
          onCancel: () => setAddressModal(null),
        })
        return
      }

      advanceCall()
    } catch (err) {
      console.error('confirm failed:', err)
    } finally {
      setConfirming(false)
    }
  }

  // ── Skip ─────────────────────────────────────────────────

  async function handleSkip () {
    setSkipping(true)
    try {
      await api.post(`/dispatch/batch/${batch.batchId}/call/${callIndex}/skip`)
      advanceCall()
    } catch (err) {
      console.error('skip failed:', err)
    } finally {
      setSkipping(false)
    }
  }

  // ── Advance or finish ─────────────────────────────────────

  function advanceCall () {
    const next = callIndex + 1
    if (next > batch.totalCalls) {
      setStage(STAGE.DONE)
    } else {
      setCallIndex(next)
      loadCall(batch.batchId, next)
    }
  }

  // ── Release ──────────────────────────────────────────────

  async function handleRelease () {
    setReleasing(true)
    try {
      const result = await api.post(`/dispatch/batch/${batch.batchId}/release-to-lobby`)
      if (result.mismatch) {
        setReleaseResult({ mismatch: true, expected: result.expected, actual: result.actual })
      } else {
        setReleaseResult({ success: true, count: result.releasedCount })
      }
    } catch (err) {
      console.error('release failed:', err)
    } finally {
      setReleasing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {stage === STAGE.UPLOAD && (
        <UploadStage
          uploading={uploading}
          error={uploadError}
          dropRef={dropRef}
          fileInputRef={fileInputRef}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onFile={handleFile}
        />
      )}

      {stage === STAGE.REVIEW && (
        <ReviewStage
          batch={batch}
          callIndex={callIndex}
          call={call}
          loading={loadingCall}
          fields={fields}
          onFieldChange={(key, val) => setFields(f => ({ ...f, [key]: val }))}
          onConfirm={handleConfirm}
          onSkip={handleSkip}
          confirming={confirming}
          skipping={skipping}
          pdfUrl={pdfUrl}
        />
      )}

      {stage === STAGE.DONE && (
        <DoneStage
          batch={batch}
          onRelease={handleRelease}
          releasing={releasing}
          result={releaseResult}
        />
      )}

      {addressModal && (
        <AddressModal
          extracted={addressModal.extracted}
          existing={addressModal.existing}
          onResolve={addressModal.onResolve}
          onCancel={addressModal.onCancel}
        />
      )}
    </div>
  )
}

// ── Upload stage ───────────────────────────────────────────

function UploadStage ({ uploading, error, dropRef, fileInputRef, onDrop, onDragOver, onFile }) {
  return (
    <div style={styles.center}>
      <div style={styles.uploadCard}>
        <h1 style={styles.uploadTitle}>PDF Intake</h1>
        <p style={styles.uploadSub}>Upload today's route sheet to extract service calls.</p>

        <div
          ref={dropRef}
          style={styles.dropZone}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div style={styles.uploadProgress}>
              <div style={styles.spinner} />
              <p style={styles.uploadProgressText}>Extracting calls…</p>
              <p style={styles.uploadProgressSub}>This usually takes 3–8 seconds.</p>
            </div>
          ) : (
            <>
              <p style={styles.dropIcon}>📄</p>
              <p style={styles.dropText}>Drop PDF here or click to browse</p>
              <p style={styles.dropSub}>PDF files only</p>
            </>
          )}
        </div>

        {error && <p style={styles.errorText}>{error}</p>}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => onFile(e.target.files[0])}
        />
      </div>
    </div>
  )
}

// ── Review stage ───────────────────────────────────────────

function ReviewStage ({ batch, callIndex, call, loading, fields, onFieldChange, onConfirm, onSkip, confirming, skipping, pdfUrl }) {
  const pct = Math.round(((callIndex - 1) / batch.totalCalls) * 100)

  return (
    <div style={styles.reviewLayout}>

      {/* Left — PDF preview */}
      <div style={styles.pdfPane}>
        <p style={styles.pdfLabel}>Original PDF</p>
        {pdfUrl ? (
          <iframe src={pdfUrl} style={styles.pdfFrame} title="Route sheet PDF" />
        ) : (
          <div style={styles.pdfPlaceholder}>PDF preview unavailable</div>
        )}
      </div>

      {/* Right — Review form */}
      <div style={styles.formPane}>

        {/* Progress */}
        <div style={styles.progressWrap}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <p style={styles.progressLabel}>
            Reviewing call {callIndex} of {batch.totalCalls}
          </p>
        </div>

        {loading ? (
          <div style={styles.loadingCall}>Loading call…</div>
        ) : (
          <>
            {/* Systems — read-only reference */}
            {call?.extracted?.systems?.length > 0 && (
              <div style={styles.systemsBox}>
                {call.extracted.systems.map((sys, i) => (
                  <div key={i} style={styles.systemRow}>
                    {call.extracted.systems.length > 1 && (
                      <p style={styles.systemLabel}>System {i + 1}</p>
                    )}
                    <p style={styles.systemLine}>Indoor: {sys.indoorModel ?? '—'}</p>
                    <p style={styles.systemLine}>Outdoor: {sys.outdoorModel ?? '—'}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Editable fields */}
            <div style={styles.fieldsGrid}>
              {Object.entries(FIELD_LABELS).map(([key, label]) => (
                <div key={key} style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>{label}</label>
                  {key === 'companyNotes' ? (
                    <textarea
                      style={styles.fieldTextarea}
                      value={fields[key] ?? ''}
                      onChange={e => onFieldChange(key, e.target.value)}
                      rows={4}
                    />
                  ) : (
                    <input
                      style={styles.fieldInput}
                      value={fields[key] ?? ''}
                      onChange={e => onFieldChange(key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {/* Accessories — editable as comma-separated */}
              <div style={styles.fieldRow}>
                <label style={styles.fieldLabel}>Accessories</label>
                <input
                  style={styles.fieldInput}
                  value={fields.preIdentifiedAccessories ?? ''}
                  onChange={e => onFieldChange('preIdentifiedAccessories', e.target.value)}
                  placeholder="Comma-separated"
                />
              </div>
            </div>

            {/* Actions */}
            <div style={styles.reviewActions}>
              <button
                style={styles.skipBtn}
                onClick={onSkip}
                disabled={skipping || confirming}
              >
                {skipping ? 'Skipping…' : 'Skip'}
              </button>
              <button
                style={styles.confirmBtn}
                onClick={onConfirm}
                disabled={confirming || skipping}
              >
                {confirming ? 'Confirming…' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Done / Release stage ───────────────────────────────────

function DoneStage ({ batch, onRelease, releasing, result }) {
  if (result?.success) {
    return (
      <div style={styles.center}>
        <div style={styles.doneCard}>
          <p style={styles.doneIcon}>✓</p>
          <h2 style={styles.doneTitle}>{result.count} visit{result.count !== 1 ? 's' : ''} released to Lobby</h2>
          <p style={styles.doneSub}>Technicians can now claim their calls.</p>
        </div>
      </div>
    )
  }

  if (result?.mismatch) {
    return (
      <div style={styles.center}>
        <div style={styles.doneCard}>
          <p style={styles.doneIcon}>⚠</p>
          <h2 style={styles.doneTitle}>Count mismatch — not released</h2>
          <p style={styles.doneSub}>
            Expected {result.expected} visits, found {result.actual}. Contact support.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.center}>
      <div style={styles.doneCard}>
        <p style={styles.doneIcon}>📋</p>
        <h2 style={styles.doneTitle}>All calls reviewed</h2>
        <p style={styles.doneSub}>
          Ready to release confirmed calls to the Lobby.
        </p>
        <button
          style={styles.releaseBtn}
          onClick={onRelease}
          disabled={releasing}
        >
          {releasing ? 'Releasing…' : 'Release to Lobby'}
        </button>
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────

const styles = {
  page: {
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface-base)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },

  // Upload
  uploadCard: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  uploadTitle: {
    fontSize: '22px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  uploadSub: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  dropZone: {
    border: '1.5px dashed var(--border-default)',
    borderRadius: '12px',
    padding: '48px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    background: 'var(--surface-1)',
    transition: 'border-color 100ms',
  },
  dropIcon:   { fontSize: '40px', lineHeight: 1 },
  dropText:   { fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' },
  dropSub:    { fontSize: '12px', color: 'var(--text-disabled)' },
  uploadProgress: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
  },
  uploadProgressText: { fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' },
  uploadProgressSub:  { fontSize: '12px', color: 'var(--text-muted)' },
  errorText: { fontSize: '13px', color: 'var(--color-heat)' },

  spinner: {
    width: '28px',
    height: '28px',
    border: '2.5px solid var(--surface-3)',
    borderTopColor: 'var(--color-signal)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },

  // Review layout
  reviewLayout: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  pdfPane: {
    flex: '0 0 50%',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '0.5px solid var(--border-subtle)',
    padding: '16px',
    gap: '8px',
    background: 'var(--surface-1)',
  },
  pdfLabel: {
    fontSize: '11px',
    color: 'var(--text-disabled)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  pdfFrame: {
    flex: 1,
    border: 'none',
    borderRadius: '8px',
    background: '#fff',
  },
  pdfPlaceholder: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    color: 'var(--text-disabled)',
  },

  formPane: {
    flex: '0 0 50%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '16px',
    gap: '12px',
  },

  // Progress
  progressWrap: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 },
  progressBar: {
    height: '3px',
    borderRadius: '2px',
    background: 'var(--surface-3)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--color-signal)',
    transition: 'width 200ms ease',
  },
  progressLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },

  loadingCall: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },

  // Systems box
  systemsBox: {
    background: 'var(--surface-2)',
    borderRadius: '8px',
    padding: '10px 12px',
    border: '0.5px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flexShrink: 0,
  },
  systemRow:  { display: 'flex', flexDirection: 'column', gap: '2px' },
  systemLabel:{ fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' },
  systemLine: { fontSize: '12px', color: 'var(--text-secondary)' },

  // Fields
  fieldsGrid: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  fieldLabel: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontWeight: 500,
  },
  fieldInput: {
    background: 'var(--surface-2)',
    border: '0.5px solid var(--border-default)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    padding: '6px 10px',
    outline: 'none',
    fontFamily: 'var(--font-sans)',
  },
  fieldTextarea: {
    background: 'var(--surface-2)',
    border: '0.5px solid var(--border-default)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    padding: '6px 10px',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'var(--font-sans)',
    lineHeight: 1.5,
  },

  // Review actions
  reviewActions: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0,
    paddingTop: '4px',
  },
  skipBtn: {
    flex: '0 0 auto',
    background: 'var(--surface-3)',
    color: 'var(--text-secondary)',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    padding: '10px 20px',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    background: 'var(--color-signal)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    padding: '10px',
    cursor: 'pointer',
  },

  // Done
  doneCard: {
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
  },
  doneIcon:  { fontSize: '48px', lineHeight: 1 },
  doneTitle: { fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' },
  doneSub:   { fontSize: '14px', color: 'var(--text-muted)' },
  releaseBtn: {
    marginTop: '8px',
    background: 'var(--color-signal)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    padding: '12px 32px',
    cursor: 'pointer',
  },
}
