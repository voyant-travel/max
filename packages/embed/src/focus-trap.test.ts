import { afterEach, describe, expect, it, vi } from "vitest"

import { focusFirst, getFocusable, isolateBackground, trapTab } from "./focus-trap.js"

afterEach(() => {
  document.body.innerHTML = ""
})

function fakeTab(shiftKey = false) {
  const preventDefault = vi.fn()
  return { key: "Tab", shiftKey, preventDefault } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

describe("getFocusable / focusFirst", () => {
  it("returns tabbable descendants and skips aria-hidden", () => {
    const box = document.createElement("div")
    box.innerHTML =
      '<button id="a">a</button><button id="b" aria-hidden="true">b</button><iframe id="f"></iframe>'
    document.body.appendChild(box)
    const ids = getFocusable(box).map((e) => e.id)
    expect(ids).toEqual(["a", "f"])
  })

  it("focuses the first focusable element", () => {
    const box = document.createElement("div")
    box.innerHTML = '<button id="a">a</button><button id="b">b</button>'
    document.body.appendChild(box)
    focusFirst(box)
    expect(document.activeElement?.id).toBe("a")
  })
})

describe("trapTab", () => {
  it("wraps forward from the last element to the first", () => {
    const box = document.createElement("div")
    box.innerHTML = '<button id="a">a</button><button id="b">b</button>'
    document.body.appendChild(box)
    ;(box.querySelector("#b") as HTMLElement).focus()
    const e = fakeTab(false)
    trapTab(box, e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(document.activeElement?.id).toBe("a")
  })

  it("wraps backward from the first element to the last", () => {
    const box = document.createElement("div")
    box.innerHTML = '<button id="a">a</button><button id="b">b</button>'
    document.body.appendChild(box)
    ;(box.querySelector("#a") as HTMLElement).focus()
    const e = fakeTab(true)
    trapTab(box, e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(document.activeElement?.id).toBe("b")
  })
})

describe("isolateBackground", () => {
  it("inerts every sibling up to <body> and restores exactly", () => {
    document.body.innerHTML =
      '<div id="bg1">bg</div><div id="wrap"><div id="inner-sib">x</div><div id="panel"></div></div>'
    const panel = document.getElementById("panel") as HTMLElement
    const preExisting = document.getElementById("bg1") as HTMLElement

    const iso = isolateBackground(panel)
    expect(document.getElementById("bg1")?.hasAttribute("inert")).toBe(true)
    expect(document.getElementById("bg1")?.getAttribute("aria-hidden")).toBe("true")
    expect(document.getElementById("inner-sib")?.hasAttribute("inert")).toBe(true)
    // The panel and its ancestor stay interactive.
    expect(panel.hasAttribute("inert")).toBe(false)
    expect(document.getElementById("wrap")?.hasAttribute("inert")).toBe(false)

    iso.restore()
    expect(preExisting.hasAttribute("inert")).toBe(false)
    expect(preExisting.hasAttribute("aria-hidden")).toBe(false)
    expect(document.getElementById("inner-sib")?.hasAttribute("inert")).toBe(false)
  })

  it("does not touch elements that were already inert", () => {
    document.body.innerHTML = '<div id="bg" inert>bg</div><div id="panel"></div>'
    const bg = document.getElementById("bg") as HTMLElement
    const iso = isolateBackground(document.getElementById("panel") as HTMLElement)
    iso.restore()
    // Pre-existing inert must survive our restore.
    expect(bg.hasAttribute("inert")).toBe(true)
  })

  it("preserves pre-existing aria-hidden and marker values when restoring", () => {
    document.body.innerHTML =
      '<div id="bg" aria-hidden="false" data-max-inert="host-owned">bg</div><div id="panel"></div>'
    const bg = document.getElementById("bg") as HTMLElement
    const iso = isolateBackground(document.getElementById("panel") as HTMLElement)
    expect(bg.getAttribute("aria-hidden")).toBe("true")
    iso.restore()
    expect(bg.hasAttribute("inert")).toBe(false)
    expect(bg.getAttribute("aria-hidden")).toBe("false")
    expect(bg.getAttribute("data-max-inert")).toBe("host-owned")
  })
})
