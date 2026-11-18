// CP3000 route sheet parser (deterministic, no AI). Input: OCR pages
// ({ lines: [{ text, confidence }] }). Output: one call per job block with the
// Intake fields, the raw OCR text behind each catalog match (`ocr`), and the
// fields Dispatch must check before Confirm (`flags`). Nothing is invented: a field that was not
// read stays empty and flagged.
const { matchModel } = require('./modelMatch');

const LOW_CONFIDENCE = 80;
// Bullets and stray marks the printer leaves at line ends (not "*": notes use it).
const STRAY_MARKS = /[\s•«»+·]+$/u;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// Phone: the trailing run of digits/spaces/dashes on the city line.
const PHONE_TAIL = /([(\d][\d\s().-]{7,}\d)\s*$/;
const TIME_LINE = /^(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\b\s*(.*)$/i;
// Job numbers are 6–9 digits; notes mention part numbers like "#1210".
const JOB_LINE = /^#\s*(\d{6,9})\b\s*(.*)$/;
const EQUIPMENT = /\b(HEATER|FURN|FURNACE)\s*#|\b(COIL|EVAP)\s*#|\bUNIT\s*#/i;
const BUILD_STEP = /^(ROUGH|TRIM|SET)\b\s*:?\s*(.*)$/i;
// Page furniture: everything before the ROUTE header line, plus these.
const PAGE_FURNITURE = /^(EMPLOYEE SCHEDULE|HVAC\s+SERVICE)$|SCHEDULE for .*Page\s+\d+\s+of\s+\d+|^Page\s+\d+\s+of\s+\d+$/i;
const PAYMENT = /\b(ALL PAYMENT TYPES|WARRANTY)\b/i;

function clean(text) {
  return String(text ?? '').replace(STRAY_MARKS, '').trim();
}

// Columns are separated by runs of 2+ spaces in the OCR text.
function columns(text) {
  return text.split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
}

function parseHeader(text) {
  const route = text.match(/^(.*?)['’]S ROUTE for \w+,?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  const page = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (!route && !page) return null;
  let date = null;
  if (route) {
    const month = MONTHS.indexOf(route[2].toLowerCase());
    if (month >= 0) date = `${route[4]}-${String(month + 1).padStart(2, '0')}-${String(route[3]).padStart(2, '0')}`;
  }
  return { technician: route ? route[1].trim() : null, date, page: page ? Number(page[1]) : null, pages: page ? Number(page[2]) : null };
}

function to24h(time) {
  const m = time.match(/(\d{1,2}):(\d{2})\s*([AP])/i);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

// Models may contain single slashes ("CK40HT-51/61C-71"); "//" separates fields.
function parseEquipment(text) {
  const grab = label => {
    const m = text.match(new RegExp(`\\b(?:${label})\\s*#\\s*([A-Z0-9](?:[A-Z0-9\\-.()*]|/(?!/))*)`, 'i'));
    return m ? m[1].replace(/\/+$/, '') : null;
  };
  return { indoor: grab('HEATER|FURNACE|FURN'), coil: grab('COIL|EVAP'), outdoor: grab('UNIT') };
}

// "ROUGH JULIO C LOPEZ 4/24/26" (one per line; a colon is optional).
function parseBuildStep(text) {
  const m = text.match(BUILD_STEP);
  return `${m[1].toUpperCase()}: ${m[2].trim()}`;
}

// Split all pages into call blocks. A block starts at a time line, or at a
// job-number line when its time line was not read.
function splitBlocks(pages) {
  const header = {};
  const blocks = [];
  let current = null;
  for (const page of pages) {
    const hasRouteHeader = page.lines.some(line => /ROUTE for/i.test(line.text));
    let inBody = !hasRouteHeader;
    for (const line of page.lines) {
      const text = clean(line.text);
      if (!text) continue;
      if (/ROUTE for/i.test(text)) {
        const h = parseHeader(text);
        header.technician ??= h?.technician;
        header.date ??= h?.date;
        inBody = true;
        continue;
      }
      if (!inBody || PAGE_FURNITURE.test(text)) continue;
      const entry = { text, confidence: line.confidence ?? 100 };
      if (TIME_LINE.test(text)) {
        current = { timeLine: entry, lines: [] };
        blocks.push(current);
        continue;
      }
      if (JOB_LINE.test(text) && !(current && current.lines.length === 0 && current.timeLine)) {
        current = { timeLine: null, lines: [entry] };
        blocks.push(current);
        continue;
      }
      if (current) current.lines.push(entry);
    }
  }
  return { header, blocks };
}

function parseBlock(block, header, catalog) {
  const call = {
    scheduledTime: '', address: '', city: '', state: '', zip: '', subdivision: '', orderNumber: '',
    builder: '', builderContactName: '', builderContactPhone: '', workType: '',
    companyNotes: '', preSpecifiedThermostat: '', preIdentifiedAccessories: [], systems: [],
  };
  const flags = {};
  const ocr = {}; // raw OCR text behind a confident catalog match (shown, not flagged)
  const flag = (field, reason) => { flags[field] = flags[field] ? `${flags[field]}; ${reason}` : reason; };
  const lowConfidence = (entry, fields) => {
    if (entry && entry.confidence < LOW_CONFIDENCE) fields.forEach(field => flag(field, `low OCR confidence (${Math.round(entry.confidence)}%)`));
  };
  const extra = [];

  // Time + builder + work description line.
  if (block.timeLine) {
    const m = block.timeLine.text.match(TIME_LINE);
    const time = to24h(m[1]);
    const [builder, ...rest] = columns(m[2]);
    if (header.date && time) call.scheduledTime = `${header.date}T${time}:00`;
    else flag('scheduledTime', 'route date or time not read');
    if (builder) call.builder = builder;
    if (rest.length) extra.push(`Job type: ${rest.join(' ').replace(/\s*~+\s*/g, ' ')}`);
    lowConfidence(block.timeLine, ['scheduledTime', 'builder']);
  } else {
    flag('scheduledTime', 'time line not read');
  }

  const lines = block.lines;
  let i = 0;
  // Job number, street, subdivision, payment type.
  const job = lines[i] && lines[i].text.match(JOB_LINE);
  if (job) {
    call.orderNumber = job[1];
    let rest = job[2];
    const payment = rest.match(PAYMENT);
    if (payment) {
      extra.push(`Payment: ${payment[1].toUpperCase()}`);
      rest = rest.replace(PAYMENT, '').trim();
    }
    const [street, subdivision] = columns(rest);
    call.address = street ?? '';
    call.subdivision = subdivision ?? '';
    if (!street) flag('address', 'street not read');
    lowConfidence(lines[i], ['orderNumber', 'address', 'subdivision']);
    i++;
  } else {
    flag('orderNumber', 'job number line not read');
  }

  // City ST [ZIP] · builder · contact name · phone (single spaces in the source).
  if (lines[i] && !/(Called In By|PROBLEM|IMPORTANT NOTES)\s*:/i.test(lines[i].text) && !EQUIPMENT.test(lines[i].text)) {
    let text = lines[i].text;
    const phone = text.match(PHONE_TAIL);
    if (phone) {
      call.builderContactPhone = phone[1].trim();
      if (phone[1].replace(/\D/g, '').length !== 10) flag('builderContactPhone', 'not 10 digits — check the number');
      text = text.slice(0, phone.index).trim();
    } else {
      flag('builderContactPhone', 'not read');
    }
    // The ZIP may come out of OCR glued to the next word ("77002STONEBRIDGE").
    const place = text.match(/^(.*?)[,\s]+([A-Z]{2})(?:\s+(\d{5}))?\s*(\S.*)$/i);
    if (place) {
      call.city = place[1].trim();
      call.state = place[2].toUpperCase();
      call.zip = place[3] ?? '';
      let rest = place[4].trim();
      const known = [call.builder, ...catalog.builders].filter(Boolean)
        .filter(name => rest.toUpperCase().startsWith(`${name.toUpperCase()} `))
        .sort((a, b) => b.length - a.length)[0];
      if (known) {
        if (!call.builder) call.builder = known;
        rest = rest.slice(known.length).trim();
      } else {
        const [first, ...others] = rest.split(/\s+/);
        if (!call.builder) { call.builder = first; flag('builder', 'guessed from the address line'); }
        else extra.push(`Builder (address line): ${first}`);
        rest = others.join(' ');
      }
      call.builderContactName = rest;
    } else {
      call.city = text;
      flag('city', 'city line not understood');
    }
    lowConfidence(lines[i], ['city', 'builderContactName', 'builderContactPhone']);
    i++;
  }

  const notes = [];
  let inNotes = false;
  for (; i < lines.length; i++) {
    const { text } = lines[i];
    const calledIn = text.match(/Called In By\s*:\s*(.*)$/i);
    if (calledIn) { extra.push(`Called in by: ${calledIn[1]}`); inNotes = false; continue; }
    const problem = text.match(/PROBLEM\s*:\s*(.*)$/i);
    if (problem) {
      call.workType = problem[1];
      lowConfidence(lines[i], ['workType']);
      inNotes = false;
      continue;
    }
    if (/^IMPORTANT NOTES\s*:/i.test(text)) { notes.push(text.replace(/^IMPORTANT NOTES\s*:\s*/i, '')); inNotes = true; continue; }
    if (EQUIPMENT.test(text)) {
      inNotes = false;
      const eq = parseEquipment(text);
      const system = { indoorModel: '', coilModel: eq.coil ?? '', outdoorModel: '' };
      const index = call.systems.length;
      // Coils have no catalog to check OCR against: always shown for checking.
      flag(`systems.${index}.coilModel`, eq.coil ? `not in catalog — OCR read "${eq.coil}"` : 'not read');
      for (const [key, raw, models] of [['indoorModel', eq.indoor, catalog.indoor], ['outdoorModel', eq.outdoor, catalog.outdoor]]) {
        if (!raw) { flag(`systems.${index}.${key}`, 'not read'); continue; }
        const match = matchModel(raw, models);
        if (match.matched) {
          system[key] = match.model;
          if (match.model !== raw) ocr[`systems.${index}.${key}`] = raw;
        } else {
          system[key] = raw;
          flag(`systems.${index}.${key}`, match.ambiguous ? `several catalog models fit "${raw}"` : `not in catalog — OCR read "${raw}"`);
        }
      }
      if (lines[i].confidence < LOW_CONFIDENCE) flag(`systems.${index}`, `low OCR confidence (${Math.round(lines[i].confidence)}%)`);
      call.systems.push(system);
      continue;
    }
    if (/^M#/i.test(text)) {
      inNotes = false;
      extra.push(`Extra equipment: ${text}`);
      for (const token of text.matchAll(/M#\s*([A-Z0-9\-/]+)(?:\([A-Z]+\))?\s*([A-Z]+)?/gi)) {
        const accessory = catalog.accessories.find(name => [token[1], token[2]].some(t => t && name.toUpperCase() === t.toUpperCase()));
        if (accessory && !call.preIdentifiedAccessories.includes(accessory)) call.preIdentifiedAccessories.push(accessory);
      }
      if (call.preIdentifiedAccessories.length) flag('preIdentifiedAccessories', 'suggested from the extra-equipment line — check');
      continue;
    }
    if (BUILD_STEP.test(text)) { inNotes = false; extra.push(parseBuildStep(text)); continue; }
    if (inNotes) { notes.push(text); continue; }
    extra.push(text);
  }

  for (const [field, value] of Object.entries(call)) {
    if (typeof value === 'string' && /\.{3}$|…$/.test(value)) flag(field, 'truncated in the source');
  }
  if (!call.systems.length) flag('systems', 'no equipment line read');
  const routeInfo = [header.technician && `Route: ${header.technician}`].filter(Boolean);
  call.companyNotes = [
    notes.join('\n'),
    [...routeInfo, ...extra].length ? `From route sheet:\n${[...routeInfo, ...extra].join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  call.systemCount = Math.max(1, call.systems.length);
  return { ...call, flags, ocr };
}

// catalog: { indoor: [models], outdoor: [models], accessories: [item names], builders: [names] }
function parseRoute(pages, catalog) {
  const { header, blocks } = splitBlocks(pages);
  const calls = blocks
    .filter(block => block.timeLine || (block.lines[0] && JOB_LINE.test(block.lines[0].text)))
    .map(block => parseBlock(block, header, catalog));
  return { route: header, calls };
}

module.exports = { parseRoute, columns, parseHeader, clean };
