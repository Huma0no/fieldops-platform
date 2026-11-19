/**
 * src/components/calc-panel.js
 * Quick Charge Calc — standalone refrigerant-charge estimator, reachable from
 * the bottom nav bar's Calc tab. No visit/system context (unlike Weigh-In's
 * own Approx Adjust oz field). Anchored bottom-right, not a centered modal.
 * One screen: FT1/FT2 cable marks or the total lineset ft (each clears the
 * other), the same Manufacturer + Factory length controls as Weigh-In, and
 * the breakdown. See /docs/fieldops/CALC-SPEC.md.
 */

import { getCatalog } from '../lib/db.js'
import { calcBreakdown, findManufacturer, lengthOptions, minus, signed } from '../lib/lineset.mjs'

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

  const field = (label, control) => {
    const el = document.createElement('label'); el.className = 'cp-cell'
    const caption = document.createElement('span'); caption.className = 'cp-cap'; caption.textContent = label
    el.appendChild(caption); el.appendChild(control)
    return el
  }
  const input = (placeholder, mode = 'decimal', type = 'number') => {
    const el = document.createElement('input')
    el.type = type; el.inputMode = mode; el.className = 'cp-input'; el.placeholder = placeholder
    return el
  }
  const row = (...cells) => {
    const el = document.createElement('div'); el.className = 'cp-row'
    cells.forEach(c => el.appendChild(c))
    return el
  }

  const ft1 = input('—'); const ft2 = input('—'); const total = input('—')
  panel.appendChild(row(field('FT1 (cable mark)', ft1), field('FT2 (cable mark)', ft2)))
  const or = document.createElement('div'); or.className = 'cp-or'
  const orText = document.createElement('span'); orText.textContent = 'or'; or.appendChild(orText)
  panel.appendChild(or)
  panel.appendChild(field('Total lineset ft', total))

  const makerSel = document.createElement('select'); makerSel.className = 'cp-input'
  const makerText = input('Type brand…', 'text', 'text'); makerText.hidden = true
  const makerBox = document.createElement('div'); makerBox.className = 'cp-maker'
  makerBox.appendChild(makerSel); makerBox.appendChild(makerText)
  const lengthSel = document.createElement('select'); lengthSel.className = 'cp-input'
  const makerCell = field('Manufacturer', makerBox); makerCell.classList.add('cp-cell--wide')
  panel.appendChild(row(makerCell, field('Factory len', lengthSel)))

  const ozft = input('0.6'); const refIn = input('R-…', 'text', 'text'); const lengthIn = input('ft')
  const ozCell = field('oz / ft', ozft); const refCell = field('Refrigerant', refIn); const lenCell = field('Length ft', lengthIn)
  const extraRow = row(ozCell, refCell, lenCell)
  panel.appendChild(extraRow)

  const breakdown = document.createElement('div'); breakdown.className = 'cp-breakdown'
  panel.appendChild(breakdown)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'cp-close-btn'; closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', onClose)
  panel.appendChild(closeBtn)

  let manufacturers = []
  const isNew = () => makerSel.value === '__new'
  const isCustom = () => lengthSel.value === '__custom'

  function fillMakers () {
    makerSel.innerHTML = ''
    ;[...manufacturers.map(m => [m.name, m.name]), ['__new', '+ New']].forEach(([value, text]) => {
      const opt = document.createElement('option'); opt.value = value; opt.textContent = text
      makerSel.appendChild(opt)
    })
  }
  function fillLengths (selected) {
    lengthSel.innerHTML = ''
    lengthOptions(selected).forEach(ft => {
      const opt = document.createElement('option'); opt.value = String(ft); opt.textContent = `${ft} ft`
      lengthSel.appendChild(opt)
    })
    const custom = document.createElement('option'); custom.value = '__custom'; custom.textContent = '+ Custom'
    lengthSel.appendChild(custom)
    lengthSel.value = selected != null ? String(selected) : '__custom'
  }

  function line (text, strong) {
    const el = document.createElement('div')
    el.append(text)
    if (strong != null) { const b = document.createElement('b'); b.textContent = strong; el.appendChild(b) }
    return el
  }

  function update () {
    const maker = isNew() ? null : findManufacturer(manufacturers, makerSel.value)
    makerSel.hidden = isNew(); makerText.hidden = !isNew()
    ozCell.hidden = !isNew(); refCell.hidden = !isNew(); lenCell.hidden = !isCustom()
    extraRow.hidden = !isNew() && !isCustom()
    const ozPerFt = isNew() ? ozft.value : maker?.oz_per_ft
    const baselineFt = isCustom() ? lengthIn.value : lengthSel.value
    const refrigerant = isNew() ? refIn.value.trim() : ''
    const result = calcBreakdown({ ft1: ft1.value, ft2: ft2.value, total: total.value, baselineFt, ozPerFt })
    total.placeholder = result.fromMarks ? `= ${result.marksFt} ft` : '—'

    breakdown.innerHTML = ''
    if (!result.ready) { breakdown.appendChild(line('—')); return }
    if (result.fromMarks) breakdown.appendChild(line(`|${ft1.value} − ${ft2.value}| = ${result.totalFt} ft`))
    breakdown.appendChild(line(`${result.totalFt} ft − ${Number(baselineFt)} ft = `, `${minus(result.extraFt)} ft ${result.short ? 'short' : 'extra'}`))
    breakdown.appendChild(line(`${minus(result.extraFt)} ft × ${Number(ozPerFt)} oz/ft = `, `${minus(result.addOz)} oz`))
    const big = document.createElement('div'); big.className = 'cp-result'
    big.textContent = `${signed(result.addOz)} oz`
    if (refrigerant) { const badge = document.createElement('span'); badge.className = 'cp-ref'; badge.textContent = refrigerant; big.appendChild(badge) }
    breakdown.appendChild(big)
    if (result.short) {
      const warn = document.createElement('div'); warn.className = 'cp-warn'
      warn.textContent = 'Lineset shorter than factory baseline — no refrigerant to add.'
      breakdown.appendChild(warn)
    }
  }

  // FT1/FT2 and Total are mutually exclusive: typing one clears the other.
  ;[ft1, ft2].forEach(el => el.addEventListener('input', () => { total.value = ''; update() }))
  total.addEventListener('input', () => { ft1.value = ''; ft2.value = ''; update() })
  makerSel.addEventListener('change', () => {
    if (isNew()) { update(); makerText.focus(); return }
    fillLengths(Number(findManufacturer(manufacturers, makerSel.value)?.default_length_ft) || null)
    update()
  })
  lengthSel.addEventListener('change', () => { update(); if (isCustom()) lengthIn.focus() })
  ;[ozft, refIn, lengthIn, makerText].forEach(el => el.addEventListener('input', update))

  getCatalog('manufacturers').then(rows => {
    manufacturers = rows ?? []
    fillMakers()
    const first = manufacturers[0]
    if (first) makerSel.value = first.name
    else makerSel.value = '__new'
    fillLengths(first ? Number(first.default_length_ft) : 15)
    update()
  })
  update()

  overlay.appendChild(panel)
  return overlay
}

export const calcPanelStyles = `
  .cp-overlay {
    position: fixed;
    inset: 0;
    background: var(--fo-scrim);
    z-index: 100;
  }

  .cp-panel {
    position: fixed;
    right: var(--space-4, 16px);
    bottom: calc(56px + env(safe-area-inset-bottom, 0px) + var(--space-3, 12px));
    width: min(340px, calc(100vw - 32px));
    max-height: calc(100vh - 56px - env(safe-area-inset-bottom, 0px) - 40px);
    overflow-y: auto;
    background: var(--fo-panel, var(--surface-1));
    border-radius: var(--fo-radius, 12px);
    box-shadow: var(--fo-shadow-card);
    padding: var(--space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .cp-title {
    font-size: var(--text-md, 15px);
    font-weight: 500;
    color: var(--fo-ink, var(--text-primary));
  }

  .cp-row { display: flex; gap: var(--space-2, 8px); }
  .cp-row[hidden], .cp-cell[hidden] { display: none; }
  .cp-cell { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .cp-cell--wide { flex: 1.4; }

  .cp-cap {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--fo-ink-soft, var(--text-muted));
    white-space: nowrap;
  }

  .cp-input {
    width: 100%;
    min-width: 0;
    height: 40px;
    background: var(--fo-well);
    border: none;
    box-shadow: var(--fo-shadow-well);
    border-radius: var(--fo-radius-sm, 6px);
    color: var(--fo-ink, var(--text-primary));
    font-family: var(--fo-font-mono);
    font-size: var(--text-base, 14px);
    font-weight: 600;
    padding: 0 10px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .cp-input[hidden] { display: none; }

  .cp-or {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 4px 0;
    color: var(--fo-ink-soft, var(--text-muted));
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .1em;
  }
  .cp-or::before, .cp-or::after { content: ""; flex: 1; height: 1px; background: var(--fo-ink-soft); opacity: .3; }

  .cp-breakdown {
    padding: 10px 12px;
    border-radius: var(--fo-radius-sm, 6px);
    background: var(--fo-well);
    box-shadow: var(--fo-shadow-well);
    font-family: var(--fo-font-mono);
    font-size: var(--text-xs, 12px);
    line-height: 1.6;
    color: var(--fo-ink, var(--text-primary));
  }
  .cp-breakdown b { color: var(--fo-accent-deep, var(--color-signal)); }

  .cp-result {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    font-family: var(--fo-font-body);
    font-size: 24px;
    font-weight: 800;
    color: var(--fo-accent-deep, var(--color-signal));
  }

  .cp-ref {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 7px;
    background: var(--fo-panel);
    box-shadow: var(--fo-shadow-raised);
    color: var(--fo-ink);
  }

  .cp-warn { margin-top: 4px; color: var(--fo-no); font-weight: 600; }

  .cp-close-btn {
    background: var(--fo-well);
    box-shadow: var(--fo-shadow-well);
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
