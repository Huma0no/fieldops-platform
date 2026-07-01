/**
 * src/components/correction-modal.js
 * Modal for technician to submit a correction request on a completed visit.
 */

const CORRECTABLE_FIELDS = [
  { key: 'service',     label: 'Service' },
  { key: 'thermostat',  label: 'Thermostat' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'fixes',       label: 'Fixes' },
  { key: 'weighin',     label: 'Weigh-in data' },
  { key: 'notes',       label: 'Notes' },
  { key: 'equipment',   label: 'Equipment models' },
]

export function CorrectionModal ({ visitId, onSubmit, onCancel }) {
  const overlay = document.createElement('div')
  overlay.className = 'cm-overlay'
  overlay.addEventListener('click', e => { if (e.target === overlay) onCancel() })

  const modal = document.createElement('div')
  modal.className = 'cm-modal'

  // Title
  const title = document.createElement('h2')
  title.className = 'cm-title'
  title.textContent = 'Request correction'
  modal.appendChild(title)

  const sub = document.createElement('p')
  sub.className = 'cm-sub'
  sub.textContent = 'Select the fields that need correction and describe what changed.'
  modal.appendChild(sub)

  // Field checkboxes
  const fieldSection = document.createElement('div')
  fieldSection.className = 'cm-fields'

  const selectedFields = new Set()

  CORRECTABLE_FIELDS.forEach(({ key, label }) => {
    const row = document.createElement('label')
    row.className = 'cm-field-row'

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.value = key
    cb.addEventListener('change', () => {
      if (cb.checked) selectedFields.add(key)
      else selectedFields.delete(key)
    })

    const lbl = document.createElement('span')
    lbl.textContent = label

    row.appendChild(cb)
    row.appendChild(lbl)
    fieldSection.appendChild(row)
  })

  modal.appendChild(fieldSection)

  // Reason textarea
  const reasonLabel = document.createElement('label')
  reasonLabel.className = 'cm-label'
  reasonLabel.textContent = 'Reason'
  modal.appendChild(reasonLabel)

  const reason = document.createElement('textarea')
  reason.className = 'cm-textarea'
  reason.placeholder = 'Describe what needs to be corrected and why…'
  reason.rows = 4
  modal.appendChild(reason)

  // Error
  const error = document.createElement('p')
  error.className = 'cm-error'
  error.id = 'cm-error'
  modal.appendChild(error)

  // Actions
  const actions = document.createElement('div')
  actions.className = 'cm-actions'

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'cm-btn cm-btn--secondary'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', onCancel)

  const submitBtn = document.createElement('button')
  submitBtn.className = 'cm-btn cm-btn--primary'
  submitBtn.textContent = 'Submit request'
  submitBtn.addEventListener('click', async () => {
    if (selectedFields.size === 0) {
      error.textContent = 'Select at least one field to correct.'
      return
    }
    if (!reason.value.trim()) {
      error.textContent = 'Please describe what needs to be corrected.'
      return
    }
    submitBtn.disabled = true
    submitBtn.textContent = 'Submitting…'
    error.textContent = ''
    await onSubmit({
      visitId,
      fields: [...selectedFields],
      reason: reason.value.trim(),
    })
  })

  actions.appendChild(cancelBtn)
  actions.appendChild(submitBtn)
  modal.appendChild(actions)

  overlay.appendChild(modal)
  return overlay
}

export const correctionModalStyles = `
  .cm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: flex-end;
    z-index: 100;
  }

  .cm-modal {
    width: 100%;
    background: var(--surface-1);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: var(--space-5);
    padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 85dvh;
    overflow-y: auto;
  }

  .cm-title {
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--text-primary);
  }

  .cm-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin-top: -8px;
  }

  .cm-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    border: 0.5px solid var(--border-subtle);
  }

  .cm-field-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-base);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .cm-field-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--color-signal);
  }

  .cm-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
  }

  .cm-textarea {
    width: 100%;
    background: var(--surface-2);
    border: 0.5px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    padding: var(--space-3);
    resize: none;
    outline: none;
    line-height: 1.5;
  }

  .cm-textarea:focus { border-color: var(--color-signal); }

  .cm-error {
    font-size: var(--text-sm);
    color: var(--color-heat);
    min-height: 18px;
  }

  .cm-actions {
    display: flex;
    gap: var(--space-2);
  }

  .cm-btn {
    flex: 1;
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: 500;
    padding: var(--space-3);
    cursor: pointer;
    border: none;
    -webkit-tap-highlight-color: transparent;
  }

  .cm-btn--primary   { background: var(--color-signal); color: #fff; }
  .cm-btn--secondary { background: var(--surface-3); color: var(--text-secondary); }
  .cm-btn:disabled   { opacity: 0.6; cursor: not-allowed; }
`
