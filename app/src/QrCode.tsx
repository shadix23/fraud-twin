import { useMemo } from 'react'
import { qrPath } from './qr'
import type { Lang } from './i18n'

// F8: QR на шаге «Клиент» всегда ведёт на публичный адрес, не на localhost. VITE_PUBLIC_URL переопределяет адрес деплоя
export const PUBLIC_URL = ((import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://fraud-twin.vercel.app').replace(/\/+$/, '')
export const clientUrl = (lang: Lang) => `${PUBLIC_URL}/?lang=${lang}#client`

/** QR одним SVG-путём, белая подложка с тихой зоной 4 модуля внутри viewBox */
export function QrCode({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { d, n } = useMemo(() => qrPath(text), [text])
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} className={`block rounded-2xl bg-white ${className}`} shapeRendering="crispEdges" data-qr={text}>
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#0E0E11" />
    </svg>
  )
}
