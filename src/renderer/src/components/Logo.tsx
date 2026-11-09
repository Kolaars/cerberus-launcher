export function LogoMark({
  size = 24,
  className
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <g stroke="#08080e" strokeWidth="1.3" strokeLinejoin="round">
        <path d="M3 11.2 9.2 6.6l2 11-3.4 5.6L3 19.1v-7.9Z" />
        <path d="M29 11.2l-6.2-4.6-2 11 3.4 5.6 4.8-4.1v-7.9Z" />
        <path d="M10.9 5.4h10.2l2 13.4L16 25.2l-7.1-6.4 2-13.4Z" />
      </g>
      <circle cx="6.7" cy="14.9" r="0.95" fill="#09090e" />
      <circle cx="16" cy="13.9" r="1.05" fill="#09090e" />
      <circle cx="25.3" cy="14.9" r="0.95" fill="#09090e" />
    </svg>
  )
}
