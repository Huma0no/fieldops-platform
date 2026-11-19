describe('Dispatch money format', () => {
  let formatMoney

  beforeAll(async () => {
    ({ formatMoney } = await import('../frontend/dispatch/src/lib/money.mjs'))
  })

  it('puts the minus sign before the dollar sign', () => {
    expect(formatMoney(-40)).toBe('−$40.00')
    expect(formatMoney('-1234.5')).toBe('−$1234.50')
  })

  it('formats positives, zero and missing values', () => {
    expect(formatMoney(40)).toBe('$40.00')
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(-0.004)).toBe('$0.00')
    expect(formatMoney(null)).toBe('—')
  })
})
