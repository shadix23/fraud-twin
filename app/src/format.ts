export function kzt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}\u00a0млн\u00a0₸`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}\u00a0тыс.\u00a0₸`
  return `${Math.round(n)} ₸`
}

export function plainKzt(n: number): string {
  return n.toLocaleString('ru-RU').replace(/,/g, ' ') + '\u00a0₸'
}

export function clock(min: number): string {
  const m = Math.max(0, Math.floor(min))
  const h = Math.floor(m / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function ruleValue(v: number | boolean | undefined, unit: string): string {
  if (typeof v !== 'number') return ''
  if (unit === '₸') return plainKzt(v)
  return `${v} ${unit}`
}

export const RULE_RU: Record<string, string> = {
  amount_limit: 'лимит перевода',
  daily_limit: 'суточный лимит',
  velocity: 'скорость',
  new_recipient: 'новый получатель',
  account_age: 'молодой счёт',
  shared_phone: 'общий телефон',
  victim_report: 'заявление жертвы',
  model: 'модель на графе',
  first_hold: 'задержка первого перевода',
}

// Согласование с числом: plural(15464, 'перевод', 'перевода', 'переводов') -> «перевода»
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

export const dec = (n: number) => String(n).replace('.', ',')
