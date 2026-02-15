import { iconRegistry, FALLBACK_ICON } from '../../assets/toolbar-icons/iconRegistry'

export default function ToolbarIcon({ name, size = 18, className = '' }) {
  const IconContent = iconRegistry[name] || iconRegistry[FALLBACK_ICON]

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      focusable="false"
    >
      <IconContent />
    </svg>
  )
}
