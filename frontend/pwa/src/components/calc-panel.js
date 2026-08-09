/**
 * src/components/calc-panel.js
 * Quick Charge Calc — standalone refrigerant-charge estimator, reachable from
 * the bottom nav bar's Calc tab. No visit/system context (unlike Weigh-In's
 * own Approx Adjust oz field). Anchored bottom-right, not a centered modal.
 * See /docs/fieldops/CALC-SPEC.md.
 */

import { getCatalog } from '../lib/db.js'

export function CalcPanel ({ onClose }) {
  const overlay = document.createElement('div')
  overlay.className = 'cp-overlay'
  overlay.addEventListener('click', e => { if (e.target === overlay) onClose() })

  const panel = document.createElement('div')
  panel.className = 'cp-panel'

  const title = document.createElement('h2')
  title.className = 'cp-title'
  title.textContent = 'Quick Charge Calc'
  panel.appendChild(title)

  const ft1Row = document.createElement('div'); ft1Row.className = 'cp-field-row'
  const ft1Lbl = document.createElement('label'); ft1Lbl.className = 'cp-field-label'; ft1Lbl.textContent = 'ft1'
  const ft1Input = document.createElement('input')
  ft1Input.type = 'number'; ft1Input.inputMode = 'decimal'; ft1Input.className = 'cp-field-input'
  ft1Row.appendChild(ft1Lbl); ft1Row.appendChild(ft1Input); panel.appendChild(ft1Row)

  const ft2Row = document.createElement('div'); ft2Row.className = 'cp-field-row'
  const ft2Lbl = document.createElement('label'); ft2Lbl.className = 'cp-field-label'; ft2Lbl.textContent = 'ft2'
  const ft2Input = document.createElement('input')
  ft2Input.type = 'number'; ft2Input.inputMode = 'decimal'; ft2Input.className = 'cp-field-input'
  ft2Row.appendChild(ft2Lbl); ft2Row.appendChild(ft2Input); panel.appendChild(ft2Row)

  const configRow = document.createElement('div'); configRow.className = 'cp-field-row'
  const configLbl = document.createElement('label'); configLbl.className = 'cp-field-label'; configLbl.textContent = 'Config'
  const configSel = document.createElement('select'); configSel.className = 'cp-field-input'
  const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = '— select —'
  configSel.appendChild(emptyOpt)
  configRow.appendChild(configLbl); configRow.appendChild(configSel); panel.appendChild(configRow)

  const resultEl = document.createElement('p'); resultEl.className = 'cp-result'; resultEl.textContent = '—'
  panel.appendChild(resultEl)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'cp-close-btn'; closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', onClose)
  panel.appendChild(closeBtn)

  let linesetConfigs = []

  function updateResult () {
    const cfg = linesetConfigs.find(c => c.config_key === configSel.value)
    const ft1 = parseFloat(ft1Input.value)
    const ft2 = parseFloat(ft2Input.value)
    if (!cfg || isNaN(ft1) || isNaN(ft2)) { resultEl.textContent = '—'; return }
    const actual = Math.abs(ft2 - ft1)
    const adj = Math.round((actual - cfg.reference_length_ft) * cfg.adjust_rate_oz_per_ft * 10) / 10
    if (adj === 0)      resultEl.textContent = 'No adjustment needed'
    else if (adj > 0)   resultEl.textContent = `Add ${adj.toFixed(1)} oz`
    else                resultEl.textContent = `Remove ${Math.abs(adj).toFixed(1)} oz`
  }

  ft1Input.addEventListener('input', updateResult)
  ft2Input.addEventListener('input', updateResult)
  configSel.addEventListener('change', updateResult)

  getCatalog('lineset-configs').then(configs => {
    linesetConfigs = configs ?? []
    linesetConfigs.forEach(cfg => {
      const opt = document.createElement('option'); opt.value = cfg.config_key; opt.textContent = cfg.config_key
      configSel.appendChild(opt)
    })
  })

  overlay.appendChild(panel)
  return overlay
}

export const calcPanelStyles = `
  .cp-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.3);
    z-index: 100;
  }

  .cp-panel {
    position: fixed;
    right: var(--space-4, 16px);
    bottom: calc(56px + env(safe-area-inset-bottom, 0px) + var(--space-3, 12px));
    width: min(280px, calc(100vw - 32px));
    background: var(--fo-panel, var(--surface-1));
    border-radius: var(--fo-radius, 12px);
    box-shadow: var(--fo-shadow-card, 0 8px 32px rgba(0,0,0,0.4));
    padding: var(--space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
  }

  .cp-title {
    font-size: var(--text-md, 15px);
    font-weight: 500;
    color: var(--fo-ink, var(--text-primary));
  }

  .cp-field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 12px);
  }

  .cp-field-label {
    font-size: var(--text-sm, 13px);
    color: var(--fo-ink-soft, var(--text-muted));
  }

  .cp-field-input {
    background: var(--fo-well, var(--surface-2));
    border: 0.5px solid var(--border-default, #444);
    border-radius: var(--fo-radius-sm, 6px);
    color: var(--fo-ink, var(--text-primary));
    font-size: var(--text-base, 14px);
    padding: 6px 10px;
    width: 120px;
    text-align: right;
    outline: none;
  }

  .cp-result {
    font-size: var(--text-base, 14px);
    font-weight: 500;
    color: var(--fo-accent-deep, var(--color-signal));
    text-align: center;
    padding: var(--space-2, 8px) 0;
  }

  .cp-close-btn {
    background: var(--fo-well, var(--surface-2));
    border: none;
    border-radius: var(--fo-radius-sm, 6px);
    color: var(--fo-ink-soft, var(--text-muted));
    font-size: var(--text-sm, 13px);
    font-weight: 500;
    padding: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
`
