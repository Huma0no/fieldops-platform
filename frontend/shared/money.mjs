// Dollar amounts for Dispatch and the PWA: "$40.00", and "−$40.00" (minus sign before the
// dollar sign) for negatives. Missing values read "—".
export function formatMoney (value) {
  if (value == null) return '—'
  const cents = Math.round(Number(value) * 100)
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`
  return cents < 0 ? `−${amount}` : amount
}
