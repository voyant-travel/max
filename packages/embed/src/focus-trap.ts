/**
 * Minimal, dependency-free focus management for the expanded/full-page panel.
 *
 * The expanded launcher is a modal surface, so it needs the usual dialog
 * affordances: the background must be made inert (non-focusable, hidden from AT),
 * focus must move into the panel, Tab must cycle within it, and on close focus
 * must return to where it was. These helpers are shared by {@link MaxLauncher} and
 * mirrored (in plain JS) by the `<script>` loader.
 */

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

/** The tab-order focusable descendants of `container`, in DOM order. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  )
}

/** Move focus to the first focusable element in `container`, else the container. */
export function focusFirst(container: HTMLElement): void {
  const [first] = getFocusable(container)
  const target = first ?? container
  try {
    target.focus()
  } catch {
    /* focus can throw on detached nodes */
  }
}

/**
 * Keep Tab / Shift+Tab within `container` by wrapping at the ends. Call from a
 * `keydown` handler when `event.key === "Tab"`.
 */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  const focusable = getFocusable(container)
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = (container.getRootNode() as Document | ShadowRoot).activeElement
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Make everything outside `target` inert: walk from `target` up to `<body>` and
 * mark every sibling at each level `inert` (and `aria-hidden`). Returns a
 * `restore()` that undoes exactly what it changed (it never touches nodes that
 * were already inert). This isolates the background for a modal without needing
 * a portal.
 */
export function isolateBackground(target: HTMLElement): { restore: () => void } {
  if (typeof document === "undefined") return { restore: () => {} }
  const changed: Array<{
    element: HTMLElement
    inert: string | null
    ariaHidden: string | null
    marker: string | null
  }> = []
  const body = document.body
  let node: HTMLElement | null = target
  while (node && node !== body) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) break
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue
      if (!(sibling instanceof HTMLElement)) continue
      if (sibling.hasAttribute("inert")) continue
      changed.push({
        element: sibling,
        inert: sibling.getAttribute("inert"),
        ariaHidden: sibling.getAttribute("aria-hidden"),
        marker: sibling.getAttribute("data-max-inert"),
      })
      sibling.setAttribute("inert", "")
      sibling.setAttribute("aria-hidden", "true")
      sibling.setAttribute("data-max-inert", "")
    }
    node = parent
  }
  return {
    restore() {
      for (const previous of changed) {
        restoreAttribute(previous.element, "inert", previous.inert)
        restoreAttribute(previous.element, "aria-hidden", previous.ariaHidden)
        restoreAttribute(previous.element, "data-max-inert", previous.marker)
      }
    },
  }
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}
