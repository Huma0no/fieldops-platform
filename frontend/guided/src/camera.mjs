// Camera = SVG viewBox. fitBox is pure; animateViewBox drives the transition.

export function fitBox (box, viewportW, viewportH, { pad = 16, minW = 220 } = {}) {
  const aspect = viewportW > 0 && viewportH > 0 ? viewportW / viewportH : 1
  let w = Math.max(box.w + 2 * pad, minW)
  let h = box.h + 2 * pad
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  return {
    x: box.x + box.w / 2 - w / 2,
    y: box.y + box.h / 2 - h / 2,
    w,
    h,
  }
}

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function createCamera (svg, { duration = 350 } = {}) {
  let current = null
  let frame = 0

  function apply (vb) {
    current = vb
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)
  }

  function moveTo (target, { animate = true } = {}) {
    cancelAnimationFrame(frame)
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!current || !animate || reduce) { apply(target); return }
    const from = current
    const start = performance.now()
    const step = now => {
      const t = Math.min(1, (now - start) / duration)
      const k = easeInOutCubic(t)
      apply({
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k,
      })
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  return { moveTo }
}
