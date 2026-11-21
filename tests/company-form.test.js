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
    expect(m.formNumber(-2.35)).toBe('-2.3')
    expect(m.formNumber(-2.36)).toBe('-2.4')
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
    expect(p.get('entry.799811941')).toBe('-2.3')
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

  it('disables a system whose required values are missing and names them', () => {
    const links = m.companyFormLinks({
      address: { street: '100 Oak St' },
      systems: [{ systemNumber: 1 }, { systemNumber: 2 }, { systemNumber: 3 }],
      weighInData: [
        reading(1),
        reading(2, { fanSpeedCfm: null, suctionLineTemp: '', factoryChargeOz: undefined }),
      ],
    })
    expect(links[0].url).not.toBeNull()
    expect(links[1]).toEqual({ systemNumber: 2, url: null, missing: ['Factory charge', 'Fan CFM', 'Suction temp'] })
    // No Weigh-In at all: every required value is missing.
    expect(links[2].url).toBeNull()
    expect(links[2].missing).toHaveLength(11)
    // Server Report rows (snake-case system_number) and a missing address.
    const [noAddress] = m.companyFormLinks({ systems: [{ system_number: 1 }], weighInData: [reading(1)] })
    expect(noAddress).toEqual({ systemNumber: 1, url: null, missing: ['Address'] })
  })
})
