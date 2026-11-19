// Weigh-In + Calc lineset math (W3): manufacturer + factory length, catalog
// charges per manufacturer + length, Approx Adjust, subcooling and the Calc
// breakdown. Pure functions. Spec: docs/fieldops/workspace/WEIGHIN-SPEC.md,
// docs/fieldops/CALC-SPEC.md, docs/shared/CATALOG.md (Manufacturers).

export const STANDARD_LENGTHS = [10, 15, 25, 30]

const num = value => (value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value))
const round1 = value => Math.round(value * 10) / 10

// Factory length options: the standard lengths plus any other given length
// (a manufacturer's default, a saved value), ascending.
export function lengthOptions (...extra) {
  return [...new Set([...STANDARD_LENGTHS, ...extra.map(num).filter(value => value != null && value > 0)])].sort((a, b) => a - b)
}

export function findManufacturer (manufacturers, name) {
  const key = String(name ?? '').trim().toLowerCase()
  return key ? manufacturers.find(row => row.name.toLowerCase() === key) ?? null : null
}

// Defaults for a system: the outdoor unit's brand when it is a catalog
// manufacturer, that manufacturer's default length and oz/ft, and the
// refrigerant from the outdoor unit's catalog row (else the system's own).
export function linesetDefaults ({ manufacturers = [], equipment = [], outdoorModel = null, refrigerant = null } = {}) {
  const unit = equipment.find(row => row.model === outdoorModel) ?? null
  const maker = findManufacturer(manufacturers, unit?.brand)
  return {
    manufacturer: maker?.name ?? null,
    factoryLengthFt: maker ? Number(maker.default_length_ft) : null,
    ozPerFt: maker ? Number(maker.oz_per_ft) : null,
    refrigerant: unit?.refrigerant ?? refrigerant ?? null,
  }
}

// Catalog factory charge of the outdoor model for manufacturer + length.
export function catalogCharge (equipment, outdoorModel, manufacturer, lengthFt) {
  const unit = equipment.find(row => row.model === outdoorModel)
  const length = num(lengthFt)
  if (!unit || !manufacturer || length == null) return null
  const match = (unit.charges ?? []).find(row => row.manufacturer === manufacturer && Number(row.length_ft) === length)
  return match ? Number(match.charge_oz) : null
}

// (lineset ft − factory length) × oz/ft, one decimal; null until all are known.
export function approxAdjust (linesetFt, baselineFt, ozPerFt) {
  const [lineset, baseline, rate] = [num(linesetFt), num(baselineFt), num(ozPerFt)]
  return lineset == null || baseline == null || rate == null ? null : round1((lineset - baseline) * rate)
}

// Condenser Sat − Liquid Temp.
export function subcooling (condenserSat, liquidTemp) {
  const [sat, liquid] = [num(condenserSat), num(liquidTemp)]
  return sat == null || liquid == null ? null : round1(sat - liquid)
}

export function scDeviation (subcoolingValue, goal) {
  const [measured, target] = [num(subcoolingValue), num(goal)]
  return measured == null || target == null ? null : round1(measured - target)
}

// Factory + Adjusted, or null.
export function newTotalOz (factoryOz, adjustedOz) {
  const [factory, adjusted] = [num(factoryOz), num(adjustedOz)]
  return factory == null || adjusted == null ? null : round1(factory + adjusted)
}

// "9 lb 4 oz" (rounded to the ounce).
export function formatLbOz (oz) {
  const rounded = Math.round(Math.abs(oz))
  return `${oz < 0 ? '−' : ''}${Math.floor(rounded / 16)} lb ${rounded % 16} oz`
}

export const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`
// A value with a true minus sign (−10), as money amounts are shown.
export const minus = value => String(value).replace('-', '−')

// Calc: FT1/FT2 marks (either order) or a typed total; marks win only when
// both are entered and no total is typed (the fields clear each other).
export function calcBreakdown ({ ft1, ft2, total, baselineFt, ozPerFt }) {
  const [a, b, typed] = [num(ft1), num(ft2), num(total)]
  const marks = a != null && b != null ? Math.abs(a - b) : null
  const fromMarks = typed == null && marks != null
  const totalFt = typed ?? marks
  const [baseline, rate] = [num(baselineFt), num(ozPerFt)]
  if (totalFt == null || baseline == null || rate == null) return { totalFt, fromMarks, marksFt: marks, ready: false }
  const extraFt = round1(totalFt - baseline)
  return { totalFt, fromMarks, marksFt: marks, ready: true, extraFt, addOz: round1(extraFt * rate), short: extraFt < 0 }
}
