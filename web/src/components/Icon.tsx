import type { ReactNode } from 'react'

// One small, consistent icon set for the whole app (24px grid, 2px round strokes).
const PATHS: Record<string, ReactNode> = {
  today: <><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1.2" /></>,
  customers: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.3A6.5 6.5 0 0 1 21.5 20" /></>,
  work: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M8.5 10h7" /><path d="M8.5 14h7" /><path d="M8.5 18h4" /></>,
  inbox: <path d="M21 15a3 3 0 0 1-3 3H9l-5 3.5V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />,
  alpha: <><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" /><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  arrowRight: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 6.5-2.5 7.5-2.5 9h17c0-1.5-2.5-2.5-2.5-9" /><path d="M10 21h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></>,
  moon: <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z" />,
  signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" /></>,
  calendar: <><path d="M8 2.5v4M16 2.5v4" /><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10.5h18" /></>,
  board: <><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="9.5" y="4" width="5" height="10" rx="1.2" /><rect x="16" y="4" width="5" height="13" rx="1.2" /></>,
  vehicle: <><path d="M5 12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12" /><rect x="3" y="12" width="18" height="6" rx="1.8" /><circle cx="7.5" cy="15" r=".6" /><circle cx="16.5" cy="15" r=".6" /><path d="M6 18v2M18 18v2" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.2 5L3.5 17.3a1.8 1.8 0 0 0 0 2.6l.6.6a1.8 1.8 0 0 0 2.6 0l6-6a4 4 0 0 0 5-5.2l-2.6 2.6-2.4-.6-.6-2.4z" />,
  doc: <><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 2.5v5h5" /><path d="M9 13h6M9 17h4" /></>,
  invoice: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8h5M9.5 12h5M9.5 16h3" /></>,
  bolt: <path d="M13 2.5L4.5 13.5H11l-1 8L19.5 10H13z" />,
  shield: <path d="M12 21.5s8-3.8 8-10v-6l-8-3-8 3v6c0 6.2 8 10 8 10z" />,
  manual: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" /><path d="M8.5 7h7M8.5 11h7" /></>,
  parts: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  box: <><path d="M21 8l-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  inspect: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8.5l1.5 1.5L14 6.5" /><path d="M9 14.5h6M9 18h4" /></>,
  phone: <path d="M21.5 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.6 5.2 2 2 0 0 1 4.6 3h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.5 10.6a16 16 0 0 0 5.9 5.9l1.2-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z" />,
  voicemail: <><circle cx="6.5" cy="12" r="3.5" /><circle cx="17.5" cy="12" r="3.5" /><path d="M6.5 15.5h11" /></>,
  growth: <><path d="M3 20h18" /><path d="M6 16l4.5-4.5 3 3L20 8" /><path d="M15 8h5v5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>,
  reports: <><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7.5" y="11" width="3" height="6" rx=".8" /><rect x="12.5" y="7" width="3" height="10" rx=".8" /><rect x="17.5" y="13" width="2.5" height="4" rx=".8" /></>,
  rocket: <><path d="M5 15c-1.2 1.2-1.7 3.4-1.7 5 1.6 0 3.8-.5 5-1.7" /><path d="M9.5 15L6 11.5l4.2-6.2C12.3 2.2 15.4 1.3 20 1.3c0 4.6-.9 7.7-4 9.8z" /><circle cx="15.2" cy="6.8" r="1.2" /><path d="M9.5 15l-1 5 5-1" /></>,
  tools: <><path d="M14.7 6.3a4 4 0 0 0-5.2 5L3.5 17.3a1.8 1.8 0 0 0 0 2.6l.6.6a1.8 1.8 0 0 0 2.6 0l6-6" /><path d="M17 3l4 4M15 9l5-5" /></>,
  staff: <><circle cx="12" cy="7.5" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" /><path d="M9.5 3.5h5" /></>,
  plug: <><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></>,
  send: <><path d="M21 3L10.5 13.5" /><path d="M21 3l-6.5 18-4-7.5L3 9.5z" /></>,
  edit: <><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 7.5l3 3" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  dollar: <><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2s1 1.7 2.8 2.1 2.8.9 2.8 2.1-1.2 2-2.8 2c-1.4 0-2.5-.6-3-1.6" /><path d="M12 6v1.7M12 16.3V18" /></>,
  alert: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.3" r=".6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".6" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></>,
  download: <><path d="M12 3.5v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20.5h16" /></>,
  print: <><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><rect x="7" y="14" width="10" height="6.5" rx="1" /></>,
  pen: <><path d="M3 21l1.2-4.6L16.5 4.1a2.1 2.1 0 0 1 3 3L7.2 19.8z" /><path d="M14.5 6.2l3 3" /></>,
  filter: <path d="M3.5 5h17l-6.5 8v6l-4-2v-4z" />,
  back: <><path d="M10 5l-7 7 7 7" /><path d="M3 12h18" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.2L3.5 9" /><path d="M3.5 4v5h5" /><path d="M4 13a8 8 0 0 0 14.5 4.2l2-2.2" /><path d="M20.5 20v-5h-5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>,
  play: <path d="M7 4.5v15l13-7.5z" />,
  pause: <><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 9" /></>,
  upload: <><path d="M12 15.5v-12" /><path d="M7 8l5-5 5 5" /><path d="M4 20.5h16" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.6 2.6 3.9 5.6 3.9 9S14.6 18.4 12 21c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" /></>,
  tag: <><path d="M3 12.5V4h8.5l9 9a1.8 1.8 0 0 1 0 2.600l-5.9 5.900a1.8 1.8 0 0 1-2.6 0z" /><circle cx="7.5" cy="8.5" r="1.2" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14c1 1.5 2.3 2.2 4 2.200s3-.7 4-2.2" /><path d="M9 9.500h.01M15 9.500h.01" /></>,
  meh: <><circle cx="12" cy="12" r="9" /><path d="M8.5 15.500h7" /><path d="M9 9.500h.01M15 9.500h.01" /></>,
  frown: <><circle cx="12" cy="12" r="9" /><path d="M8 16.500c1-1.5 2.3-2.2 4-2.200s3 .7 4 2.2" /><path d="M9 9.500h.01M15 9.500h.01" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  map: <><path d="M12 21s7-6.1 7-11.500A7 7 0 0 0 5 9.500C5 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9" /><path d="M16 7l3 3" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  repeat: <><path d="M17 3l4 4-4 4" /><path d="M3 11V9a2 2 0 0 1 2-2h16" /><path d="M7 21l-4-4 4-4" /><path d="M21 13v2a2 2 0 0 1-2 2H3" /></>,
  wifiOff: <><path d="M3 3l18 18" /><path d="M8.5 16.400a5 5 0 0 1 7 0" /><path d="M5 12.900a10 10 0 0 1 5.1-2.7" /><path d="M2 8.800a15 15 0 0 1 4.2-2.6" /><circle cx="12" cy="20" r=".6" /></>,
  thumbsUp: <><path d="M7 10v11H3V10z" /><path d="M7 10l4-7c1.7 0 3 1.3 3 3v4h5.500a2 2 0 0 1 2 2.300l-1.3 7.500a2 2 0 0 1-2 1.700H7" /></>,
  stepMinus: <path d="M5 12h14" />,
  openExternal: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v4.500a1.500 1.500 0 0 1-1.500 1.500h-11A1.500 1.500 0 0 1 4 18.500v-11A1.500 1.500 0 0 1 5.500 6H10" /></>,
  sparkle: <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.900L12 18l-1.9-5.6-5.6-1.9 5.6-1.900z" />,
  chatStop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  chatVolume: <><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" /><path d="M15.500 9a4 4 0 0 1 0 6" /><path d="M18 6.500a8 8 0 0 1 0 11" /></>,
  video: <><rect x="2.500" y="6" width="13" height="12" rx="2" /><path d="M15.500 10.500l6-3.500v10l-6-3.500" /></>,
  expand: <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>,
  compress: <><path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  circle: <circle cx="12" cy="12" r="8" />,
  arrowUpRight: <><path d="M7 17L17 7" /><path d="M8 7h9v9" /></>,
}

export type IconName = keyof typeof PATHS | (string & {})

export default function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.9 }: { name: IconName; className?: string; strokeWidth?: number }) {
  const body = PATHS[name]
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {body ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  )
}
