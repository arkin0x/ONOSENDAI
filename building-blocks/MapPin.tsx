export const MapPin = ({ color, image }: { color: string; image: string; }) => (
  <svg width="40" height="60" viewBox="0 0 40 60">

    <defs>
      <mask id="pinMask">
        <rect x="0" y="0" width="40" height="60" fill="black" />
        <circle cx="20" cy="20" r="15" fill="white" />
      </mask>
    </defs>

    <path
      fill={color}
      d="M20 8c-7.732 0-14 6.268-14 14 0 15.464 14 30 14 30s14-14.536 14-30c0-7.732-6.268-14-14-14z" />

    <image
      x="5" y="5" width="30" height="30"
      preserveAspectRatio="xMidYMid slice"
      xlinkHref={image}
      mask="url(#pinMask)" />

  </svg>
)
