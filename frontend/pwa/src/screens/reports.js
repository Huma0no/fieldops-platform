/**
 * src/screens/reports.js
 * Placeholder — implemented in Phase F4.
 */

import { NavBar, navBarStyles } from "../components/nav-bar.js"

export default function mount (appEl) {
  if (!document.getElementById("styles-placeholder")) {
    const style = document.createElement("style")
    style.id = "styles-placeholder"
    style.textContent = navBarStyles + `
      .screen { display: flex; flex-direction: column; height: 100dvh; background: var(--surface-base); overflow: hidden; }
      .screen-header { display: flex; align-items: center; padding: calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-5) var(--space-3); background: var(--surface-1); border-bottom: 0.5px solid var(--border-subtle); flex-shrink: 0; }
      .screen-title { font-size: var(--text-lg); font-weight: 500; color: var(--text-primary); letter-spacing: -0.01em; }
      .ph-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
      .ph-title { font-size: var(--text-base); font-weight: 500; color: var(--text-secondary); }
      .ph-sub { font-size: var(--text-sm); color: var(--text-disabled); }
    `
    document.head.appendChild(style)
  }

  appEl.innerHTML = ""

  const screen = document.createElement("div")
  screen.className = "screen"

  const header = document.createElement("div")
  header.className = "screen-header"
  const t = document.createElement("h1")
  t.className = "screen-title"
  t.textContent = "Reports"
  header.appendChild(t)
  screen.appendChild(header)

  const body = document.createElement("div")
  body.className = "ph-body"
  body.innerHTML = `<p class=\ph-title\>Coming in Phase F4</p><p class=\ph-sub\>This screen will be built in a future phase.</p>`
  screen.appendChild(body)

  screen.appendChild(NavBar({
    active: "reports",
    onNavigate: route => window.dispatchEvent(new CustomEvent("app:navigate", { detail: { route } }))
  }))

  appEl.appendChild(screen)
}
