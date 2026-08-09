// Generate Report justification gate — Cancel-originated visits only.
// Per /docs/fieldops/CANCEL-SPEC.md: blocked only if BOTH Notes and Checklist
// are empty; either one alone is enough to proceed. Never applies to a
// normally-started visit.
export function isCancelJustificationMissing ({ notes, checklist }) {
  const notesEmpty = !notes || notes.trim() === ''
  const checklistEmpty = !Object.values(checklist ?? {}).some(v => v === 'yes' || v === 'no')
  return notesEmpty && checklistEmpty
}
