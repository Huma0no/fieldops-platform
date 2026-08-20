// Shared confirmation used by both FieldOps Cancel entry points.
export const CANCEL_CONFIRMATION = {
  title: 'Cancel this call?',
  body: 'This action is irreversible. Current Service, items, Weigh-In data, and pricing will be cleared. Notes and Checklist will be kept.',
  keepWorking: 'Keep Working',
  confirm: 'Cancel Call',
}

export function showCancelConfirmation (mountEl) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'fo-cancel-confirm-overlay'

    const finish = value => {
      overlay.remove()
      resolve(value)
    }
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(false)
    })

    const modal = document.createElement('div')
    modal.className = 'fo-cancel-confirm-modal'
    const title = document.createElement('h2')
    title.className = 'fo-cancel-confirm-title'
    title.textContent = CANCEL_CONFIRMATION.title
    const note = document.createElement('p')
    note.className = 'fo-cancel-confirm-note'
    note.textContent = CANCEL_CONFIRMATION.body
    const actions = document.createElement('div')
    actions.className = 'fo-cancel-confirm-actions'
    const keepWorking = document.createElement('button')
    keepWorking.className = 'fo-cancel-confirm-btn fo-cancel-confirm-btn--back'
    keepWorking.textContent = CANCEL_CONFIRMATION.keepWorking
    keepWorking.addEventListener('click', () => finish(false))
    const confirm = document.createElement('button')
    confirm.className = 'fo-cancel-confirm-btn fo-cancel-confirm-btn--confirm'
    confirm.textContent = CANCEL_CONFIRMATION.confirm
    confirm.addEventListener('click', () => finish(true))
    actions.append(keepWorking, confirm)
    modal.append(title, note, actions)
    overlay.appendChild(modal)
    mountEl.appendChild(overlay)
  })
}

export const cancelConfirmationStyles = `
  .fo-cancel-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:200;}
  .fo-cancel-confirm-modal{width:100%;background:var(--fo-panel);border-radius:var(--fo-radius-md) var(--fo-radius-md) 0 0;padding:var(--space-5);padding-bottom:calc(var(--space-5) + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:var(--space-3);box-shadow:var(--fo-shadow-card);}
  .fo-cancel-confirm-title{margin:0;font-size:var(--text-md);font-weight:700;color:var(--fo-ink);}
  .fo-cancel-confirm-note{margin:0;font-size:var(--text-sm);line-height:1.45;color:var(--fo-ink-soft);}
  .fo-cancel-confirm-actions{display:flex;gap:var(--space-2);}
  .fo-cancel-confirm-btn{flex:1;border:none;border-radius:var(--fo-radius-sm);padding:var(--space-3);font-family:var(--fo-font-body);font-size:var(--text-base);font-weight:700;cursor:pointer;}
  .fo-cancel-confirm-btn--back{background:var(--fo-well);box-shadow:var(--fo-shadow-well);color:var(--fo-ink-soft);}
  .fo-cancel-confirm-btn--confirm{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-no);}
`
