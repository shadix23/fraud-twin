import type { Lang } from './i18n'

// Формат по языку (бриф v20, п. 3): RU «4,2 млн ₸», «24,3 на 10 тыс.»; EN «₸4.2M», «24.3 per 10k».
export function kzt(n: number, lang: Lang = 'ru'): string {
  const a = Math.abs(n)
  if (lang === 'en') {
    if (a >= 1_000_000_000) return `₸${(n / 1_000_000_000).toFixed(1)}B`
    if (a >= 1_000_000) return `₸${(n / 1_000_000).toFixed(1)}M`
    if (a >= 1_000) return `₸${Math.round(n / 1_000)}K`
    return `₸${Math.round(n)}`
  }
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace('.', ',')}\u00a0млрд\u00a0₸`
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}\u00a0млн\u00a0₸`
  if (a >= 1_000) return `${Math.round(n / 1_000)}\u00a0тыс.\u00a0₸`
  return `${Math.round(n)} ₸`
}

// Сумма для крупного числа: значение и единица отдельно (единица мельче)
export function kztParts(n: number, lang: Lang = 'ru'): { v: string; u: string; pre: boolean } {
  const m = Math.round(n / 1e5) / 10
  if (m === 0) return { v: '0', u: '₸', pre: lang === 'en' }
  return lang === 'en' ? { v: `${m.toFixed(1)}M`, u: '₸', pre: true } : { v: m.toFixed(1).replace('.', ','), u: 'млн ₸', pre: false }
}

export const num = (n: number, lang: Lang = 'ru', digits = 1) =>
  lang === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ',')
export const per10k = (n: number, lang: Lang = 'ru') => lang === 'en' ? `${num(n, lang)} per 10k` : `${num(n, lang)} на 10 тыс.`
export const intl = (n: number, lang: Lang = 'ru') => n.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')

// Точная сумма: RU «1 250 000 ₸», EN «₸1,250,000»
export function plainKzt(n: number, lang: Lang = 'ru'): string {
  if (lang === 'en') return `₸${n.toLocaleString('en-US')}`
  return n.toLocaleString('ru-RU').replace(/,/g, ' ') + '\u00a0₸'
}

export function clock(min: number): string {
  const m = Math.max(0, Math.floor(min))
  const h = Math.floor(m / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Короткая сумма для чипа правила и ленты раундов: «1 млн ₸», «2,5 млн ₸», «500 тыс. ₸» / «₸1M», «₸500K»
export function kztShort(n: number, lang: Lang = 'ru'): string {
  const a = Math.abs(n)
  const trim = (x: number) => { const s = (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, ''); return lang === 'en' ? s : s.replace('.', ',') }
  if (lang === 'en') return a >= 1e6 ? `₸${trim(n / 1e6)}M` : a >= 1e3 ? `₸${trim(n / 1e3)}K` : `₸${Math.round(n)}`
  return a >= 1e6 ? `${trim(n / 1e6)} млн ₸` : a >= 1e3 ? `${trim(n / 1e3)} тыс. ₸` : `${Math.round(n)} ₸`
}
