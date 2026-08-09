// Menu tab badge count — sums pending counts from whichever of Menu's
// contents currently has something pending (today just Transfers; written
// generically so a future Menu item can contribute without changing this).
export function computeMenuBadgeCount (counts) {
  return counts.reduce((sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0), 0)
}
