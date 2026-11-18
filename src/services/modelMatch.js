// OCR-aware equipment model matching (route sheet intake). Deterministic.
// OCR confuses look-alike characters, so both sides are folded to one class
// per group (O/0, I/L/1, S/5, B/8) before comparing. Catalog models are base
// models ("5TTR5024") while route sheets print full ones ("5TTR5024A1"), so a
// catalog model matches when it is a prefix of the folded OCR text, allowing
// one extra or missing leading character ("S5TTR5024A1"). Only a single best
// (longest) match is used; anything else stays as the raw text, flagged.

const FOLD = { O: '0', I: '1', L: '1', S: '5', B: '8' };

function fold(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OILSB]/g, ch => FOLD[ch]);
}

// Exact prefix, one extra leading character on the OCR side, or one missing.
function prefixMatches(foldedRaw, foldedModel) {
  return foldedRaw.startsWith(foldedModel)
    || foldedRaw.slice(1).startsWith(foldedModel)
    || foldedRaw.startsWith(foldedModel.slice(1));
}

// models: catalog model strings. Returns { model, raw, matched, ambiguous }.
function matchModel(raw, models) {
  const text = String(raw ?? '').trim();
  const foldedRaw = fold(text);
  if (!foldedRaw) return { model: null, raw: text, matched: false, ambiguous: false };
  let best = [];
  let bestLength = 0;
  for (const model of models) {
    const foldedModel = fold(model);
    if (foldedModel.length < 4 || !prefixMatches(foldedRaw, foldedModel)) continue;
    if (foldedModel.length > bestLength) { best = [model]; bestLength = foldedModel.length; }
    else if (foldedModel.length === bestLength && !best.includes(model)) best.push(model);
  }
  if (best.length === 1) return { model: best[0], raw: text, matched: true, ambiguous: false };
  return { model: null, raw: text, matched: false, ambiguous: best.length > 1 };
}

module.exports = { fold, matchModel };
