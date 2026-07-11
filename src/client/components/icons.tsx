/** Small inline icon set — kept to plain geometric marks that echo the
 * app's corner-frame/blueprint motif rather than a generic icon library,
 * so the few icons in the UI feel drawn for this tool specifically. */

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DotIcon({ size = 8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

/** The app mark: two opposing corner brackets around a dimension line and
 * tick marks — the same "targeting frame" used on panels, scaled up, plus
 * a stand-in for the dimension callouts (e.g. "3391") on a real blueprint. */
export function AppMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M2 8V2H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M26 20V26H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 19L19 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.5 3.2" />
      <path d="M7 15V19H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
