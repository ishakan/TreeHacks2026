import React from 'react'

const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const iconRegistry = {
  sketch: () => (
    <>
      <path {...common} d="M4 14.5l6.8-6.8 2.5 2.5L6.5 17H4z" />
      <path {...common} d="M9.6 8.9l2.5 2.5" />
    </>
  ),
  select: () => (
    <>
      <path {...common} d="M4 3l5.8 12 1.8-4.2 4.4-1.6z" />
    </>
  ),
  line: () => <path {...common} d="M4 14L14 4" />,
  circle: () => <circle {...common} cx="9" cy="9" r="5" />,
  rectangle: () => <rect {...common} x="4" y="5" width="10" height="8" rx="1.4" />,
  dimension: () => (
    <>
      <path {...common} d="M4 12h10" />
      <path {...common} d="M4 8v8M14 8v8" />
      <path {...common} d="M6 10l-2 2 2 2M12 10l2 2-2 2" />
    </>
  ),
  constraints: () => (
    <>
      <path {...common} d="M6.5 10.5l2-2a2.5 2.5 0 013.5 3.5l-2 2" />
      <path {...common} d="M11.5 7.5l-2 2a2.5 2.5 0 01-3.5-3.5l2-2" />
    </>
  ),
  extrude: () => (
    <>
      <rect {...common} x="5" y="9" width="8" height="6" rx="1.2" />
      <path {...common} d="M9 3v5M6.8 5.4L9 3l2.2 2.4" />
    </>
  ),
  revolve: () => (
    <>
      <path {...common} d="M9 4a5 5 0 100 10" />
      <path {...common} d="M9 2v4M7 3.8L9 2l2 1.8" />
    </>
  ),
  fillet: () => (
    <>
      <path {...common} d="M4 14V6h8" />
      <path {...common} d="M12 14a4 4 0 01-4-4" />
    </>
  ),
  chamfer: () => (
    <>
      <path {...common} d="M4 14V6h8" />
      <path {...common} d="M9 9l3 3" />
    </>
  ),
  shell: () => (
    <>
      <rect {...common} x="4" y="4" width="10" height="10" rx="1.5" />
      <rect {...common} x="7" y="7" width="4" height="4" rx="0.8" />
    </>
  ),
  draft: () => (
    <>
      <path {...common} d="M5 14h8" />
      <path {...common} d="M6 14l2-8h2l2 8" />
    </>
  ),
  hole: () => (
    <>
      <rect {...common} x="4" y="4" width="10" height="10" rx="1.5" />
      <circle {...common} cx="9" cy="9" r="2.2" />
    </>
  ),
  pattern: () => (
    <>
      <rect {...common} x="4" y="4" width="3" height="3" rx="0.6" />
      <rect {...common} x="11" y="4" width="3" height="3" rx="0.6" />
      <rect {...common} x="4" y="11" width="3" height="3" rx="0.6" />
      <rect {...common} x="11" y="11" width="3" height="3" rx="0.6" />
    </>
  ),
  mirror: () => (
    <>
      <path {...common} d="M9 3v12" />
      <path {...common} d="M6 6l-2 2 2 2M12 6l2 2-2 2" />
    </>
  ),
  booleanCut: () => (
    <>
      <circle {...common} cx="7" cy="9" r="3.2" />
      <circle {...common} cx="11" cy="9" r="3.2" />
      <path {...common} d="M9 5.8v6.4" />
    </>
  ),
  booleanUnion: () => (
    <>
      <circle {...common} cx="7" cy="9" r="3.2" />
      <circle {...common} cx="11" cy="9" r="3.2" />
    </>
  ),
  booleanIntersect: () => (
    <>
      <circle {...common} cx="7" cy="9" r="3.2" />
      <circle {...common} cx="11" cy="9" r="3.2" />
      <path {...common} d="M8.9 6.5c.7.6 1.2 1.5 1.2 2.5s-.5 1.9-1.2 2.5" />
    </>
  ),
  import: () => (
    <>
      <path {...common} d="M9 3v7" />
      <path {...common} d="M6.8 8.2L9 10.6l2.2-2.4" />
      <path {...common} d="M4 13.5h10" />
    </>
  ),
  export: () => (
    <>
      <path {...common} d="M9 10V3" />
      <path {...common} d="M6.8 5.4L9 3l2.2 2.4" />
      <path {...common} d="M4 13.5h10" />
    </>
  ),
  measure: () => (
    <>
      <path {...common} d="M4 12l8-8 2 2-8 8H4z" />
      <path {...common} d="M9.3 6.7l2 2" />
    </>
  ),
  sectionView: () => (
    <>
      <rect {...common} x="4" y="5" width="10" height="8" rx="1.2" />
      <path {...common} d="M4 13l10-8" />
    </>
  ),
  undo: () => (
    <>
      <path {...common} d="M6 6H3v3" />
      <path {...common} d="M3 9a5 5 0 018.2-2.8" />
    </>
  ),
  redo: () => (
    <>
      <path {...common} d="M12 6h3v3" />
      <path {...common} d="M15 9a5 5 0 00-8.2-2.8" />
    </>
  ),
  settings: () => (
    <>
      <circle {...common} cx="9" cy="9" r="2.2" />
      <path {...common} d="M9 3.8v1.6M9 12.6v1.6M14.2 9h1.6M2.2 9h1.6M12.6 5.4l1.1-1.1M4.3 13.7l1.1-1.1M12.6 12.6l1.1 1.1M4.3 4.3l1.1 1.1" />
    </>
  ),
  box: () => (
    <>
      <path {...common} d="M9 3l5 3v6l-5 3-5-3V6z" />
      <path {...common} d="M4 6l5 3 5-3" />
      <path {...common} d="M9 9v6" />
    </>
  ),
  cylinder: () => (
    <>
      <ellipse {...common} cx="9" cy="5.2" rx="4" ry="1.8" />
      <path {...common} d="M5 5.2v6.2c0 1 1.8 1.8 4 1.8s4-.8 4-1.8V5.2" />
    </>
  ),
  sphere: () => (
    <>
      <circle {...common} cx="9" cy="9" r="5" />
      <path {...common} d="M4 9h10M9 4a8 8 0 010 10M9 4a8 8 0 000 10" />
    </>
  ),
  cone: () => (
    <>
      <path {...common} d="M9 4l4 8H5z" />
      <ellipse {...common} cx="9" cy="12" rx="4" ry="1.6" />
    </>
  ),
  clear: () => (
    <>
      <path {...common} d="M5 6h8" />
      <path {...common} d="M6 6l.8 8h4.4l.8-8" />
      <path {...common} d="M7.6 6V4.6h2.8V6" />
    </>
  ),
  finish: () => <path {...common} d="M4 9l3 3 7-7" />,
}

export const FALLBACK_ICON = 'sketch'
