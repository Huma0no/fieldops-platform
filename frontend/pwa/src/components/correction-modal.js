/**
 * src/components/correction-modal.js
 * Modal for technician to submit a correction request on a completed visit.
 * One-way free-text message to the Dispatcher/Ledger — not a proposed field-change payload.
 */

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
  sub.textContent = 'Describe what needs to be corrected on this visit.'
  modal.appendChild(sub)

  // Message textarea
  const messageLabel = document.createElement('label')
  messageLabel.className = 'cm-label'
  messageLabel.textContent = 'Message'
  modal.appendChild(messageLabel)

  const message = document.createElement('textarea')
  message.className = 'cm-textarea'
  message.placeholder = 'Describe what needs to be corrected and why…'
  message.rows = 4
  modal.appendChild(message)

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
    if (!message.value.trim()) {
      error.textContent = 'Please describe what needs to be corrected.'
      return
    }
    submitBtn.disabled = true
    submitBtn.textContent = 'Submitting…'
    error.textContent = ''

    try {
      await onSubmit({ visitId, message: message.value.trim() })
    } catch (err) {
      error.textContent = err.message ?? 'Submission failed.'
      submitBtn.disabled = false
      submitBtn.textContent = 'Submit request'
    }
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
