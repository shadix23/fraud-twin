import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Fallback, RuleChange, RuleMeta, RuleSet } from './data'
import { useLang } from './i18n'
import { num } from './format'
import { changeText } from './RulesEditor'

// Состояние раундов (F3): каждый запуск «Проверить мои правила» = раунд. Лента хранит только числа и ключи правил,
// строки собирает фронт (бриф v20, п. 3), поэтому смена языка не требует пересчёта.
// «Выведено» и «Задето честных» стоят рядом в каждой строке: цена защиты видна вместе с дырой. F4 переносит ленту в свою плиту.

export interface Round {
  n: number
  asked: RuleChange[]           // что изменил банк относительно профиля (rules_changed сервера); у запасного прогона пусто
  wanted: RuleSet               // для запасного прогона: какие пороги просили, а показан профиль
  source: 'live' | 'ready'
  fallback: Fallback | null
  pct: number                   // доля выведенного в лучшей попытке ИИ
  withdrawn: number
  honest: number | null         // задержки честных на 10 тыс. при этих правилах
  vsModel?: boolean             // раунд «ИИ против модели» (F5): поиск против включённой модели
  base?: boolean                // v21: строка «Правила профиля», подставленная перед первым раундом со своими порогами
  atLeast?: boolean             // v21: поиск мог не дойти до лучшей атаки, доля - нижняя оценка
  profilePct?: number | null    // v21: эта же атака на правилах профиля, %
}

// 100% без «,0», остальное с одним знаком
const pctText = (v: number, lang: 'ru' | 'en') => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : num(v, lang))

function Delta({ cur, prev, bad }: { cur: number | null; prev: number | null | undefined; bad: string }) {
  const { t } = useLang()
  if (cur == null || prev == null || Math.abs(cur - prev) < 0.05) return null
  const up = cur > prev
  const Icon = up ? ArrowUp : ArrowDown
  return <Icon size={14} strokeWidth={2.25} className={`shrink-0 ${up ? bad : 'text-stop'}`} aria-label={up ? t.rounds.up : t.rounds.down} role="img" />
}

// Лента раундов таблицей без бейджей (бриф v20, референс Stripe Radar): строка на surface-2, номер, что изменил банк,
// доля ушедшего и задетые честные со стрелкой к прошлому раунду. Новый раунд сверху, «Правила профиля» всегда внизу; на экране до 1000 px по высоте (mid) видны последний и профиль
export function Rounds({ rounds, meta }: { rounds: Round[]; meta: RuleMeta[] }) {
  const { t, lang } = useLang()
  if (!rounds.length) return null
  // строка «Правила профиля» остаётся в ленте всегда: точка отсчёта для своих порогов (wow-v21, п. 1)
  const last = rounds.slice(-3)
  const base = rounds[0]
  const shown = (base && !last.includes(base) ? [base, ...rounds.slice(-2)] : last).reverse()
  const wide = shown.some((r) => r.atLeast && r.pct < 99.95)
  const cols = `grid ${wide ? 'grid-cols-[1rem_minmax(0,1fr)_4.5rem_4rem] sm:grid-cols-[1.25rem_minmax(0,1fr)_4.75rem_4.25rem]' : 'grid-cols-[1rem_minmax(0,1fr)_4rem_4rem] sm:grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_4.25rem]'} items-center gap-x-2 whitespace-nowrap sm:gap-x-2.5`
  return (
    <section data-rounds aria-label={t.rounds.title} className="border-t border-line pt-2">
      {/* v22 (п. 5 CHANGES): раунды строками под чертой, шапка колонок только для чтения с экрана и в подсказках */}
      <div className={`${cols} sr-only`} aria-hidden>
        <span className="col-span-2">{t.rounds.title}</span>
        <span className="text-right">{t.rounds.colW}</span>
        <span className="text-right" title={t.rounds.honest}>{t.rounds.colH}</span>
      </div>
      <ol>
        {shown.map((r, k) => {
          const prev = rounds.find((x) => x.n === r.n - 1)
          const words = [...(r.vsModel ? [t.rounds.vsModel] : []), ...r.asked.map((c) => changeText(meta, c.param, c.to, t, lang)).filter(Boolean) as string[]]
          const what = words.length ? words[0] + (words.length > 1 ? ` ${t.rounds.more(words.length - 1)}` : '') : t.rounds.profile
          const cut = what.indexOf(': ')
          const atLeast = r.atLeast && r.pct < 99.95 // «не меньше 100%» не пишем
          const onProf = !r.base && !r.vsModel && r.asked.length && r.profilePct != null ? t.rounds.onProfile(pctText(r.profilePct, lang)) : null // правило в первой строке, значение во второй: порог, который назвали в зале, не обрезается
          return (
            <li key={r.n} className={`${cols} min-h-[34px] py-1 text-[15px] tabular-nums short:min-h-8 ${shown.length === 3 && k === 1 ? 'mid:hidden' : ''}`} data-round={r.n}
              aria-label={`${t.rounds.round(r.n)}: ${words.join(', ') || t.rounds.profile}. ${atLeast ? t.rounds.atLeast + ' ' : ''}${pctText(r.pct, lang)}% ${t.rounds.withdrawn}${onProf ? ` (${onProf})` : ''}${r.honest != null ? `, ${num(r.honest, lang)} ${t.rounds.honest}` : ''}${r.source === 'ready' ? `, ${t.rounds.ready}` : ''}`}>
              <span className="text-[14px] font-medium text-ink-mute" aria-hidden>{r.n}</span>
              <span className="min-w-0 leading-tight" aria-hidden>
                {cut > 0
                  ? <span className="block truncate" title={words.join(', ')}><span className={k === 0 ? 'font-medium text-ink' : 'text-ink-2'}>{what.slice(0, cut)}</span> <span className="text-[14px] text-ink-3">{what.slice(cut + 2)}</span></span>
                  : <span className={`line-clamp-2 whitespace-normal ${k === 0 ? 'font-medium text-ink' : 'text-ink-2'}`} title={words.join(', ') || t.rounds.profile}>{what}</span>}
                {onProf && <span className="t-caption block truncate text-ink-3" title={onProf} data-round-profile>{onProf}</span>}
                {r.source === 'ready' && !r.base && <span className="t-caption block text-ink-3">{t.rounds.ready}</span>}
              </span>
              <span className="flex items-center justify-end gap-1" aria-hidden><b className="font-medium text-leak" title={atLeast ? `${t.rounds.atLeast}, ${t.rounds.colW}` : t.rounds.colW}>{atLeast ? '≥' : ''}{pctText(r.pct, lang)}%</b><Delta cur={r.pct} prev={prev?.pct} bad="text-leak" /></span>
              <span className="flex items-center justify-end gap-1" aria-hidden>{r.honest != null ? <><b className={`font-medium ${k === 0 && prev && r.honest > (prev.honest ?? 0) + 0.05 ? 'text-warn' : 'text-ink-2'}`} title={t.rounds.honest}>{num(r.honest, lang)}</b><Delta cur={r.honest} prev={prev?.honest} bad="text-warn" /></> : <span className="text-ink-3">-</span>}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
