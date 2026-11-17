/**
 * src/components/receipt.js
 * Paper receipt for one Report (docs/mockups/fieldops-ws-receipt-calc-mockup.html).
 * Renders a model from lib/receipt.mjs; `draft` adds the DRAFT stamp.
 */

const money = n => `$${Number(n ?? 0).toFixed(2)}`

function el (tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function treeLines (parent, lines) {
  lines.forEach((line, i) => {
    const row = el('div', 'rcpt-li')
    row.appendChild(el('span', 'rcpt-tree', i === lines.length - 1 ? '└' : '├'))
    row.appendChild(el('span', 'rcpt-t', line.label))
    if (line.amount != null) row.appendChild(el('span', 'rcpt-p', money(line.amount)))
    parent.appendChild(row)
    if (line.adjustedFrom !== undefined) {
      const was = line.adjustedFrom == null ? '' : ` (was ${money(line.adjustedFrom)})`
      parent.appendChild(el('div', 'rcpt-adj', `adjusted by office${was}`))
    }
  })
}

function formatDate (iso) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function Receipt (model, { draft = false } = {}) {
  const receipt = el('div', 'rcpt')
  if (draft) receipt.appendChild(el('span', 'rcpt-draft', 'DRAFT'))

  const head = el('div', 'rcpt-hd')
  head.appendChild(el('b', null, model.street))
  const sub = el('small')
  if (model.place) sub.appendChild(document.createTextNode(model.place))
  const when = [formatDate(model.date), model.technicianName].filter(Boolean).join(' · ')
  if (when) {
    if (model.place) sub.appendChild(document.createElement('br'))
    sub.appendChild(document.createTextNode(when))
  }
  head.appendChild(sub)
  receipt.appendChild(head)

  for (const group of model.groups) {
    receipt.appendChild(el('div', 'rcpt-sec', group.title))
    treeLines(receipt, group.lines)
  }
  if (model.weighIn.length) {
    receipt.appendChild(el('div', 'rcpt-sec', 'WEIGH-IN'))
    treeLines(receipt, model.weighIn.map(label => ({ label })))
  }
  if (model.checklist.length) {
    receipt.appendChild(el('div', 'rcpt-sec', 'CHECKLIST'))
    treeLines(receipt, model.checklist.map(label => ({ label })))
  }
  if (model.notes.trim()) {
    receipt.appendChild(el('div', 'rcpt-sec', 'NOTES'))
    receipt.appendChild(el('div', 'rcpt-note', model.notes))
  }

  const total = el('div', 'rcpt-tot')
  total.appendChild(el('span', 'rcpt-t', 'TOTAL'))
  total.appendChild(el('span', null, money(model.total)))
  receipt.appendChild(total)
  if (model.totalAdjustedFrom !== undefined) {
    const was = model.totalAdjustedFrom == null ? '' : ` (was ${money(model.totalAdjustedFrom)})`
    receipt.appendChild(el('div', 'rcpt-adj', `adjusted by office${was}`))
  }
  return receipt
}

export const receiptStyles = `
  .rcpt{position:relative;background:var(--fo-paper);color:var(--fo-ink);padding:26px 18px 30px;
    font:13px/1.45 var(--fo-font-mono);box-shadow:0 6px 14px var(--fo-panel-lo);
    -webkit-mask:linear-gradient(#000 0 0) top/100% calc(100% - 10px) no-repeat, conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/16px 10px repeat-x;
            mask:linear-gradient(#000 0 0) top/100% calc(100% - 10px) no-repeat, conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/16px 10px repeat-x;}
  .rcpt-hd{text-align:center;border-bottom:1px dashed var(--fo-panel-lo);padding-bottom:10px;margin-bottom:10px;}
  .rcpt-hd b{display:block;font:800 15px var(--fo-font-body);}
  .rcpt-hd small{color:var(--fo-ink-soft);}
  .rcpt-sec{margin:10px 0 2px;font-weight:700;letter-spacing:.06em;font-size:11px;color:var(--fo-ink-soft);}
  .rcpt-li{display:flex;gap:6px;}
  .rcpt-t{flex:1;min-width:0;overflow-wrap:anywhere;}
  .rcpt-tree{color:var(--fo-ink-soft);}
  .rcpt-p{min-width:64px;text-align:right;}
  .rcpt-adj{padding-left:14px;font-size:11px;font-style:italic;color:var(--fo-accent-deep);}
  .rcpt-note{color:var(--fo-ink-soft);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;}
  .rcpt-tot{display:flex;border-top:1px dashed var(--fo-panel-lo);margin-top:12px;padding-top:10px;font-weight:700;font-size:15px;}
  .rcpt-draft{position:absolute;top:8px;right:12px;font:700 10px var(--fo-font-mono);color:var(--fo-accent);
    border:1.5px solid var(--fo-accent);border-radius:6px;padding:2px 6px;transform:rotate(6deg);}
`
