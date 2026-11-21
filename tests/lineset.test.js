// W3 Weigh-In + Calc lineset math (frontend/pwa/src/lib/lineset.mjs).
describe('Weigh-In + Calc lineset', () => {
  let m
  let visit

  beforeAll(async () => {
    m = await import('../frontend/pwa/src/lib/lineset.mjs')
    visit = await import('../frontend/pwa/src/lib/workspace-visit.mjs')
  })

  const manufacturers = [
    { name: 'Lennox', oz_per_ft: 0.6, default_length_ft: 30 },
    { name: 'Trane', oz_per_ft: 0.47, default_length_ft: 15 },
  ]
  const equipment = [
    { model: 'ML14KC1-018', brand: 'Lennox', refrigerant: 'R-454B', charges: [{ manufacturer: 'Lennox', length_ft: 15, charge_oz: 78 }, { manufacturer: 'Lennox', length_ft: 30, charge_oz: 92 }] },
    { model: 'NOREF-1', brand: 'Acme', refrigerant: null, charges: [] },
  ]

  it('defaults to the outdoor brand, its default length and oz/ft, and the catalog refrigerant', () => {
    expect(m.linesetDefaults({ manufacturers, equipment, outdoorModel: 'ML14KC1-018' }))
      .toEqual({ manufacturer: 'Lennox', factoryLengthFt: 30, ozPerFt: 0.6, refrigerant: 'R-454B' })
    // Brand not a manufacturer, no catalog refrigerant: nothing preselected, the system's refrigerant if any.
    expect(m.linesetDefaults({ manufacturers, equipment, outdoorModel: 'NOREF-1', refrigerant: 'R-32' }))
      .toEqual({ manufacturer: null, factoryLengthFt: null, ozPerFt: null, refrigerant: 'R-32' })
    expect(m.linesetDefaults({ manufacturers, equipment, outdoorModel: 'Typed model' }).refrigerant).toBeNull()
  })

  it('finds the catalog charge for manufacturer + length, else nothing', () => {
    expect(m.catalogCharge(equipment, 'ML14KC1-018', 'Lennox', 30)).toBe(92)
    expect(m.catalogCharge(equipment, 'ML14KC1-018', 'Lennox', '15')).toBe(78)
    expect(m.catalogCharge(equipment, 'ML14KC1-018', 'Lennox', 25)).toBeNull()
    expect(m.catalogCharge(equipment, 'ML14KC1-018', 'Trane', 15)).toBeNull()
    expect(m.catalogCharge(equipment, 'Typed model', 'Lennox', 30)).toBeNull()
  })

  it('offers the standard lengths plus the manufacturer default and saved values', () => {
    expect(m.lengthOptions()).toEqual([10, 15, 25, 30])
    expect(m.lengthOptions(20, null, '30')).toEqual([10, 15, 20, 25, 30])
  })

  it('computes Approx Adjust, subcooling, deviation and the new total', () => {
    expect(m.approxAdjust(55, 30, 0.6)).toBe(15)
    expect(m.approxAdjust(12, 15, 0.47)).toBe(-1.4)
    expect(m.approxAdjust('', 30, 0.6)).toBeNull()
    expect(m.approxAdjust(55, 30, null)).toBeNull()
    expect(m.subcooling(105, 95)).toBe(10)
    expect(m.subcooling(105, null)).toBeNull()
    expect(m.scDeviation(12, 10)).toBe(2)
    expect(m.newTotalOz(133, 15)).toBe(148)
    expect(m.newTotalOz(null, 15)).toBeNull()
    expect(m.formatLbOz(148)).toBe('9 lb 4 oz')
    expect(m.signed(-2.4)).toBe('−2.4')
    expect(m.signed(15)).toBe('+15')
  })

  it('rounds to one decimal, half away from zero (shared with the Company form)', () => {
    expect([2.35, -2.35, 1.45, -1.45, 0.05, -0.04, 12].map(m.round1)).toEqual([2.4, -2.4, 1.5, -1.5, 0.1, 0, 12])
    // A screen value: (lineset − baseline) × oz/ft = (10 − 15) × 0.47 = −2.35 → −2.4.
    expect(m.approxAdjust(10, 15, 0.47)).toBe(-2.4)
    expect(m.subcooling(107.25, 95)).toBe(12.3)
  })

  it('Calc uses the FT1/FT2 marks or the typed total, and flags a short lineset', () => {
    expect(m.calcBreakdown({ ft1: 80, ft2: 25, total: '', baselineFt: 30, ozPerFt: 0.6 }))
      .toEqual({ totalFt: 55, fromMarks: true, marksFt: 55, ready: true, extraFt: 25, addOz: 15, short: false })
    expect(m.calcBreakdown({ ft1: '', ft2: '', total: 20, baselineFt: 30, ozPerFt: 0.6 }))
      .toMatchObject({ totalFt: 20, fromMarks: false, extraFt: -10, addOz: -6, short: true })
    expect(m.calcBreakdown({ ft1: 80, ft2: '', total: '', baselineFt: 30, ozPerFt: 0.6 }).ready).toBe(false)
    expect(m.calcBreakdown({ ft1: '', ft2: '', total: 40, baselineFt: 30, ozPerFt: '' }).ready).toBe(false)
  })

  it('marks a system in the Weigh-In switcher once its essentials are filled', () => {
    const draft = { _weighInData: [
      { systemNumber: 1, linesetLength: 40, adjustedOz: 6, liquidLineTemp: 95, condenserSatTemp: 105 },
      { systemNumber: 2, linesetLength: 40, adjustedOz: null, liquidLineTemp: 95, condenserSatTemp: 105 },
    ] }
    expect(visit.weighInEssentialsFilled(draft, 1)).toBe(true)
    expect(visit.weighInEssentialsFilled(draft, 2)).toBe(false)
    expect(visit.weighInEssentialsFilled(draft, 3)).toBe(false)
  })
})
