// Company Google Form prefilled links (PP-03): one per system of a Report.
// Map and rules: docs/shared/PHOTOS-GPS-INTEGRATIONS.md (The Company's Google Form).

export const COMPANY_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfUeFILu20Amgas2beSG5wd2ZJfW7sEgvPKUy4BJFjd3sbHLg/viewform'

const ADDRESS_ENTRY = '1124000801'
const CONSTANTS = [
  ['284031722', 'Big Tex Air Conditioning'],
  ['1317202447', '15 ft.'],
  ['1678145086', '3/8'],
]
// The 11 required numeric fields: [entry ID, Weigh-In field, label for the "missing" note].
const READINGS = [
  ['37391195', 'linesetLength', 'Lineset ft'],
  ['961493071', 'factoryChargeOz', 'Factory charge'],
  ['799811941', 'approxAdjustOz', 'Approx adjust'],
  ['1078120223', 'adjustedOz', 'Adjusted oz'],
  ['1404438998', 'fanSpeedCfm', 'Fan CFM'],
  ['1295748710', 'liquidLineTemp', 'Liquid temp'],
  ['183118902', 'suctionLineTemp', 'Suction temp'],
  ['565216059', 'condenserSatTemp', 'Condenser sat'],
  ['119493154', 'subcoolingValue', 'Subcooling'],
  ['375059625', 'oemSubcoolingGoal', 'OEM SC goal'],
  ['1208255497', 'subcoolingDeviation', 'SC deviation'],
]

// Plain number, ASCII "-" for negatives, at most one decimal; null when absent.
export function formNumber (value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = Math.round(number * 10) / 10
  return String(rounded === 0 ? 0 : rounded)
}

const systemNumberOf = row => Number(row?.systemNumber ?? row?.system_number)

// report: a Report (server version or the phone's snapshot) with address,
// systems and weighInData. Returns one entry per system:
// { systemNumber, url | null, missing: [labels] }.
export function companyFormLinks (report) {
  const fromSystems = (report?.systems ?? []).map(systemNumberOf)
  const fromReadings = (report?.weighInData ?? []).map(systemNumberOf)
  const numbers = [...new Set([...fromSystems, ...fromReadings])]
    .filter(n => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
  const street = report?.address?.street ?? ''
  return numbers.map(systemNumber => {
    const row = (report?.weighInData ?? []).find(data => systemNumberOf(data) === systemNumber) ?? {}
    const values = READINGS.map(([entry, field, label]) => ({ entry, label, value: formNumber(row[field]) }))
    const missing = values.filter(v => v.value === null).map(v => v.label)
    if (!street) missing.unshift('Address')
    if (missing.length) return { systemNumber, url: null, missing }
    const address = numbers.length > 1 ? `${street} – System ${systemNumber}` : street
    const params = [[ADDRESS_ENTRY, address], ...CONSTANTS, ...values.map(v => [v.entry, v.value])]
    const query = params.map(([entry, value]) => `entry.${entry}=${encodeURIComponent(value)}`).join('&')
    return { systemNumber, url: `${COMPANY_FORM_URL}?usp=pp_url&${query}`, missing: [] }
  })
}
