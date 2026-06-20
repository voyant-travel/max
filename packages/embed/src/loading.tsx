import type { MaxTheme } from "./types.js"
import { readInitialHostSnapshot } from "./use-host-sync.js"

/** Resolve whether the loading surface should render dark, from the explicit
 *  theme prop, the host page, then `prefers-color-scheme`. */
export function resolveDark(opts: { theme?: MaxTheme; lang?: string }): boolean {
  const snapshot = readInitialHostSnapshot({ theme: opts.theme, lang: opts.lang })
  if (snapshot.theme === "dark") return true
  if (snapshot.theme === "light") return false
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  } catch {
    return false
  }
}

const KEYFRAMES =
  "@keyframes max-spin{to{transform:rotate(360deg)}}" +
  "@keyframes max-twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.6}}"

/**
 * Branded loading state shown over the chat surface until the iframe is ready,
 * so it never flashes blank/white while Max boots. Absolutely positioned — its
 * parent must be a positioned element.
 */
export function LoadingOverlay({ show, dark }: { show: boolean; dark: boolean }) {
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: dark ? "#0b0b0a" : "#ffffff",
          opacity: show ? 1 : 0,
          pointerEvents: show ? "auto" : "none",
          transition: "opacity 240ms ease",
        }}
      >
        <Spinner dark={dark} />
      </div>
    </>
  )
}

/** Spinning ring around the twinkling Max sparkle. */
function Spinner({ dark }: { dark: boolean }) {
  const track = dark ? "rgba(255,255,255,0.12)" : "rgba(15,16,13,0.1)"
  return (
    <div
      style={{
        position: "relative",
        width: 46,
        height: 46,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: `3px solid ${track}`,
          borderTopColor: "#ff5100",
          borderRadius: 9999,
          animation: "max-spin .8s linear infinite",
        }}
      />
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        style={{ animation: "max-twinkle 1.6s ease-in-out infinite" }}
      >
        <path
          d="M5.417 10.833 6.07 12.14c.221.443.332.664.48.856.131.17.283.323.453.454.192.148.413.258.856.48L9.167 14.58l-1.308.654c-.443.221-.664.332-.856.48-.17.131-.323.283-.454.454-.148.192-.258.413-.48.856l-.652 1.307-.654-1.307c-.221-.443-.332-.664-.48-.856a2.5 2.5 0 0 0-.453-.454c-.192-.148-.413-.258-.856-.48L1.667 14.58l1.307-.654c.443-.221.664-.332.856-.48.17-.131.323-.283.454-.454.148-.192.258-.413.48-.856l.653-1.307Z"
          stroke="#ff5100"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.5 1.667l.982 2.553c.235.611.353.917.535 1.174.162.228.361.427.589.589.257.183.563.3 1.174.535L18.334 7.5l-2.554.982c-.611.235-.917.353-1.174.535a2.5 2.5 0 0 0-.589.589c-.182.257-.3.563-.535 1.174L12.5 13.333l-.982-2.553c-.235-.611-.353-.917-.535-1.174a2.5 2.5 0 0 0-.589-.589c-.257-.182-.563-.3-1.174-.535L6.667 7.5l2.553-.982c.611-.235.917-.353 1.174-.535.228-.162.427-.361.589-.589.182-.257.3-.563.535-1.174L12.5 1.667Z"
          stroke="#ff5100"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
