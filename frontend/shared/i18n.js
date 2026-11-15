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
    'guided.summary': '{zones} zones{dapc} · {system}',
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
    'guided.summary': '{zones} zonas{dapc} · {system}',
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
