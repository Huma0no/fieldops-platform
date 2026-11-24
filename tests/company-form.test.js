// PP-03 Company Google Form prefilled links (frontend/pwa/src/lib/company-form.mjs).
describe('Company Google Form links', () => {
  let m

  beforeAll(async () => {
    m = await import('../frontend/pwa/src/lib/company-form.mjs')
  })

  const reading = (systemNumber, extra = {}) => ({
    systemNumber,
    linesetLength: 55, factoryChargeOz: 120, approxAdjustOz: -2.35, adjustedOz: 15, fanSpeedCfm: 1200,
    liquidLineTemp: 95, suctionLineTemp: 48, condenserSatTemp: 107, subcoolingValue: 12,
    oemSubcoolingGoal: 10, subcoolingDeviation: 2, factoryLengthFt: 30,
    ...extra,
  })
  const params = url => new URL(url).searchParams

  it('formats numbers plainly: ASCII minus, at most one decimal, null when absent', () => {
    // Half away from zero, the same rounding the Weigh-In screen uses.
    expect(m.formNumber(-2.35)).toBe('-2.4')
    expect(m.formNumber(2.35)).toBe('2.4')
    expect(m.formNumber(1.45)).toBe('1.5')
    expect(m.formNumber(-2.34)).toBe('-2.3')
    expect(m.formNumber(15)).toBe('15')
    expect(m.formNumber('7.25')).toBe('7.3')
    expect(m.formNumber(-0.04)).toBe('0')
    expect(m.formNumber(null)).toBeNull()
    expect(m.formNumber('')).toBeNull()
    expect(m.formNumber('abc')).toBeNull()
  })

  it('builds one prefilled link for a single-system visit, with constants and encoded values', () => {
    const [link] = m.companyFormLinks({
      address: { street: '22022 Matera Vista Ln & Co' },
      systems: [{ systemNumber: 1 }],
      weighInData: [reading(1)],
    })
    expect(link.missing).toEqual([])
    expect(link.url.startsWith(`${m.COMPANY_FORM_URL}?usp=pp_url&`)).toBe(true)
    // Values are URL-encoded (spaces, "&", "/").
    expect(link.url).toContain('entry.1124000801=22022%20Matera%20Vista%20Ln%20%26%20Co')
    expect(link.url).toContain('entry.1678145086=3%2F8')
    const p = params(link.url)
    expect(p.get('entry.1124000801')).toBe('22022 Matera Vista Ln & Co') // no suffix with one system
    expect(p.get('entry.284031722')).toBe('Big Tex Air Conditioning')
    expect(p.get('entry.1317202447')).toBe('15 ft.') // always 15 ft., whatever the real length (30 here)
    expect(p.get('entry.1678145086')).toBe('3/8')
    expect(p.get('entry.37391195')).toBe('55')
    expect(p.get('entry.799811941')).toBe('-2.4')
    expect(p.get('entry.1208255497')).toBe('2')
    // Photos (fields 9–10) and test holes (18) are not prefilled.
    expect(p.has('entry.197292571')).toBe(false)
    expect([...p.keys()]).toHaveLength(16)
  })

  it('adds " – System N" to the address when the visit has more than one system', () => {
    const links = m.companyFormLinks({
      address: { street: '100 Oak St' },
      systems: [{ systemNumber: 2 }, { systemNumber: 1 }],
      weighInData: [reading(1), reading(2)],
    })
    expect(links.map(link => link.systemNumber)).toEqual([1, 2])
    expect(params(links[0].url).get('entry.1124000801')).toBe('100 Oak St – System 1')
    expect(links[1].url).toContain('entry.1124000801=100%20Oak%20St%20%E2%80%93%20System%202')
  })

  it('always opens: prefills what exists, leaves missing values empty and names them (FT-05)', () => {
    const links = m.companyFormLinks({
      address: { street: '100 Oak St' },
      systems: [{ systemNumber: 1 }, { systemNumber: 2 }, { systemNumber: 3 }],
      weighInData: [
        reading(1),
        reading(2, { fanSpeedCfm: null, suctionLineTemp: '', factoryChargeOz: undefined }),
      ],
    })
    expect(links[0].missing).toEqual([])
    expect(links[1].missing).toEqual(['Factory charge', 'Fan CFM', 'Suction temp'])
    const partial = params(links[1].url)
    expect(partial.get('entry.37391195')).toBe('55')
    expect(partial.has('entry.1404438998')).toBe(false)
    expect(partial.has('entry.183118902')).toBe(false)
    expect(partial.has('entry.961493071')).toBe(false)
    expect([...partial.keys()]).toHaveLength(13)
    // No Weigh-In at all (a Prestart): address and constants only.
    expect(links[2].missing).toHaveLength(11)
    expect([...params(links[2].url).keys()].sort()).toEqual(['entry.1124000801', 'entry.1317202447', 'entry.1678145086', 'entry.284031722', 'usp'])
    expect(params(links[2].url).get('entry.1124000801')).toBe('100 Oak St – System 3')
    // Server Report rows (snake-case system_number) and a missing address: no address entry.
    const [noAddress] = m.companyFormLinks({ systems: [{ system_number: 1 }], weighInData: [reading(1)] })
    expect(noAddress.missing).toEqual(['Address'])
    expect(noAddress.url.startsWith(`${m.COMPANY_FORM_URL}?usp=pp_url&`)).toBe(true)
    expect(params(noAddress.url).has('entry.1124000801')).toBe(false)
  })
})
