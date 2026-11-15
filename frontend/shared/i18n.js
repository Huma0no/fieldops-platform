/**
 * shared/i18n.js
 * Shared UI string library (EN/ES) and the global language preference.
 * Component and guide content is authored in their own data files, not here.
 */

const STORAGE_KEY = 'fo:lang'
const LANGUAGES = ['en', 'es']

const STRINGS = {
  en: {
    'guided.title': 'Guided',
    'guided.setup.heading': 'Choose the setup',
    'guided.setup.system': 'System',
    'guided.setup.zones': 'Zones',
    'guided.setup.dapc': 'DAPC + SBD2',
    'guided.setup.yes': 'Yes',
    'guided.setup.no': 'No',
    'guided.setup.start': 'Open',
    'guided.setup.change': 'Change setup',
    'guided.zones.one': '1 zone',
    'guided.zones.other': '{n} zones',
    'guided.zones.twinning': 'This call has {count} thermostats. 4–5 zones (twinning) are not covered; showing {max}.',
    'guided.mode': 'Mode',
    'guided.mode.guided': 'Guided',
    'guided.mode.explore': 'Explore',
    'guided.map': 'System map',
    'guided.stepOf': 'Step {n} of {m}',
    'guided.stepCount': '{m} steps',
    'guided.prev': 'Previous step',
    'guided.next': 'Next step',
    'guided.cable': 'Cable',
    'guided.hint.map': 'Tap an outlined group to go to its step.',
    'guided.hint.step': 'Tap a terminal for details. Double tap or ⤢ for the map.',
    'guided.landscape': 'Better view in landscape',
    'guided.dismiss': 'Dismiss',
    'guided.unavailable': 'Guide not available yet for this combination.',
    'guided.summary.dapc': ' · DAPC',
    'guided.zone': 'Zone {n}',
    'guided.section.power': 'Power & ports',
    'guided.fit': 'Show full drawing',
    'guided.hint.overview': 'Tap a block or device to focus it.',
    'guided.hint.focus': 'Tap a terminal for details. Double tap or ⤢ for the full drawing.',
    'guided.fact.function': 'Function',
    'guided.fact.expected': 'Expected',
    'guided.fact.alternate': 'Alternate',
    'guided.fact.connects': 'Connects to',
    'guided.fact.noConnection': 'No wire in this setup.',
    'guided.fact.source': 'Source',
    'guided.notUsed': 'Not used in communicating setup',
    'guided.notUsedShort': 'Not used',
    'guided.pending': 'Pending',
    'guided.tube': 'Pressure tube',
    'guided.loadError': 'Guided data could not be loaded.',
    'guided.language': 'Language',
  },
  es: {
    'guided.title': 'Guided',
    'guided.setup.heading': 'Elige la configuración',
    'guided.setup.system': 'Sistema',
    'guided.setup.zones': 'Zonas',
    'guided.setup.dapc': 'DAPC + SBD2',
    'guided.setup.yes': 'Sí',
    'guided.setup.no': 'No',
    'guided.setup.start': 'Abrir',
    'guided.setup.change': 'Cambiar configuración',
    'guided.zones.one': '1 zona',
    'guided.zones.other': '{n} zonas',
    'guided.zones.twinning': 'Esta llamada tiene {count} termostatos. 4–5 zonas (twinning) no están cubiertas; se muestran {max}.',
    'guided.mode': 'Modo',
    'guided.mode.guided': 'Guiado',
    'guided.mode.explore': 'Explorar',
    'guided.map': 'Mapa del sistema',
    'guided.stepOf': 'Paso {n} de {m}',
    'guided.stepCount': '{m} pasos',
    'guided.prev': 'Paso anterior',
    'guided.next': 'Paso siguiente',
    'guided.cable': 'Cable',
    'guided.hint.map': 'Toca un grupo marcado para ir a su paso.',
    'guided.hint.step': 'Toca un terminal para ver detalles. Doble toque o ⤢ para el mapa.',
    'guided.landscape': 'Se ve mejor en horizontal',
    'guided.dismiss': 'Cerrar',
    'guided.unavailable': 'Guía aún no disponible para esta combinación.',
    'guided.summary.dapc': ' · DAPC',
    'guided.zone': 'Zona {n}',
    'guided.section.power': 'Alimentación y puertos',
    'guided.fit': 'Ver dibujo completo',
    'guided.hint.overview': 'Toca un bloque o equipo para enfocarlo.',
    'guided.hint.focus': 'Toca un terminal para ver detalles. Doble toque o ⤢ para ver todo.',
    'guided.fact.function': 'Función',
    'guided.fact.expected': 'Esperado',
    'guided.fact.alternate': 'Alterno',
    'guided.fact.connects': 'Conecta con',
    'guided.fact.noConnection': 'Sin cable en esta configuración.',
    'guided.fact.source': 'Fuente',
    'guided.notUsed': 'No se usa en configuración comunicante',
    'guided.notUsedShort': 'No se usa',
    'guided.pending': 'Pendiente',
    'guided.tube': 'Tubo de presión',
    'guided.loadError': 'No se pudieron cargar los datos de Guided.',
    'guided.language': 'Idioma',
  },
}

export function getLanguage () {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.includes(value) ? value : 'en'
  } catch (_) {
    return 'en'
  }
}

export function setLanguage (language) {
  if (!LANGUAGES.includes(language)) return
  try { localStorage.setItem(STORAGE_KEY, language) } catch (_) {}
}

export function t (key, vars = {}, language = getLanguage()) {
  const template = STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}
