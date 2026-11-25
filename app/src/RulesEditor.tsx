import { useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ChevronDown, Download, Ellipsis, RotateCcw, Upload } from 'lucide-react'
import type { RuleErr, RuleMeta, RuleSet } from './data'
import { useLang, type Dict, type Lang } from './i18n'
import { kztShort } from './format'
import { ValueChip } from './ui'

// Шаг «Атака», плита «Правила банка» (бриф v20, экран «Атака», F3): шесть правил, тумблер, порог-чип в единицах правила,
// статус точкой и словом. Границы полей из rule_meta (GET /world). Изменённый порог помечен чёрной точкой, профильное значение в подсказке.
// Под списком шаблон JSON и загрузка своего файла. Без сервера (статическая копия) правила только видны.

export type ApiState = 'static' | 'checking' | 'ok' | 'down'

/** Порог правила словами: деньги коротко, остальное числом с единицей на языке интерфейса */
export function ruleValue(m: RuleMeta, v: number, t: Dict, lang: Lang): string {
  if (m.unit === '₸') return kztShort(v, lang)
  if (m.key === 'velocity') return t.rules.perHour(v)
  if (m.key === 'account_age') return t.rules.days(v)
  if (m.key === 'shared_phone') return t.rules.clients(v)
  return `${v} ${m.unit}`
}
export const ruleName = (m: RuleMeta, t: Dict) => t.rules.names[m.key] ?? m.title

/** Изменение правила словами для ленты и подписи запасного прогона: «Лимит перевода: 500 тыс. ₸», «Скорость: выкл.» */
export function changeText(meta: RuleMeta[], param: string, v: number | boolean | null, t: Dict, lang: Lang): string | null {
  const m = meta.find((x) => x.param === param || x.on_param === param)
  if (!m || v == null) return null
  if (typeof v === 'boolean') return `${ruleName(m, t)}: ${v ? t.rules.on : t.rules.offShort}`
  return `${ruleName(m, t)}: ${ruleValue(m, v, t, lang)}`
}

/** Текст ошибки правила: границы берём из ответа 422 или из rule_meta, единицы правила */
export function ruleErrText(err: RuleErr, meta: RuleMeta[], t: Dict, lang: Lang): string {
  if (err.code === 'bad_file') return t.rules.badFile
  if (err.code === 'rule_unknown') return t.rules.unknown(err.params.join(', '))
  const m = meta.find((x) => x.param === err.param || x.on_param === err.param)
  const name = m ? ruleName(m, t) : err.param
  if (err.code === 'rule_type' || !m) return t.rules.type(name)
  return t.rules.range(name, ruleValue(m, err.min, t, lang), ruleValue(m, err.max, t, lang))
}
const errParam = (e: RuleErr | null) => (e && (e.code === 'rule_range' || e.code === 'rule_type') ? e.param : null)

/** Файл правил: { rules: {...} } из шаблона или плоский объект. Та же проверка, что у сервера (коды 422) */
export function parseRulesFile(text: string, meta: RuleMeta[], profile: RuleSet): { rules: RuleSet } | { err: RuleErr } {
  let j: unknown
  try { j = JSON.parse(text) } catch { return { err: { code: 'bad_file' } } }
  const src = j && typeof j === 'object' && 'rules' in j ? (j as { rules: unknown }).rules : j
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { err: { code: 'bad_file' } }
  const known = new Set(Object.keys(profile))
  const entries = Object.entries(src as Record<string, unknown>)
  const bad = entries.map(([k]) => k).filter((k) => !known.has(k))
  if (bad.length) return { err: { code: 'rule_unknown', params: bad } }
  const out: RuleSet = { ...profile }
  for (const [k, v] of entries) {
    if (typeof profile[k] === 'boolean') {
      if (typeof v !== 'boolean') return { err: { code: 'rule_type', param: k, expected: 'bool' } }
      out[k] = v
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { err: { code: 'rule_type', param: k, expected: 'number' } }
    const m = meta.find((x) => x.param === k)
    if (m?.min != null && m.max != null && (v < m.min || v > m.max)) return { err: { code: 'rule_range', param: k, min: m.min, max: m.max } }
    out[k] = v
  }
  return entries.length ? { rules: out } : { err: { code: 'bad_file' } }
}

/** Шаблон: текущие правила редактора и границы каждого порога, чтобы файл можно было править руками */
function exportRules(meta: RuleMeta[], draft: RuleSet, profileName: string, fileName: string) {
  const limits = Object.fromEntries(meta.filter((m) => m.min != null).map((m) => [m.param, { min: m.min, max: m.max, step: m.step, unit: m.unit, rule: m.title }]))
  const body = { format: 'fraud-twin-rules', version: 1, profile: profileName, rules: draft, limits }
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RulesEditor({ meta, profile, draft, onChange, hits, note, api, err, setErr, profileName, onReset }: {
  meta: RuleMeta[]; profile: RuleSet; draft: RuleSet; onChange: (r: RuleSet) => void
  hits: Record<string, number> | null; note?: string; api: ApiState
  err: RuleErr | null; setErr: (e: RuleErr | null) => void; profileName: string
  onReset?: () => void // v22: сброс к профилю в меню «...», есть только когда пороги изменены
}) {
  const { t, lang } = useLang()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // v20-fix D4: после загрузки файла чипы пересоздаются: открытое поле с неверным вводом не остаётся на экране
  const [gen, setGen] = useState(0)
  const ro = api === 'static'
  const rowErr = errParam(err)
  const set = (k: string, v: number | boolean) => {
    if (errParam(err) === k || err?.code === 'rule_unknown' || err?.code === 'bad_file') setErr(null)
    setMsg(null)
    onChange({ ...draft, [k]: v })
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const r = parseRulesFile(await f.text(), meta, profile)
    if ('err' in r) { setErr(r.err); setMsg(null) } else { setErr(null); onChange(r.rules); setMsg(t.rules.loaded); setGen((g) => g + 1) }
    if (file.current) file.current.value = ''
  }
  const formErr = err && !rowErr ? ruleErrText(err, meta, t, lang) : null

  // v22 (п. 4 CHANGES): итог в шапке вместо «молчит / сработало» в каждой строке; на телефоне плита свёрнута в одну строку
  const [open, setOpen] = useState(false)
  const fired = hits ? meta.filter((m) => (m.on_param ? draft[m.on_param] !== false : true) && (hits[m.key] ?? 0) > 0).length : null
  const sum = fired != null ? t.rules.firedN(fired) : null
  const menuItem = 'flex min-h-11 w-full cursor-default items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium outline-none select-none data-[highlighted]:bg-surface-2'

  return (
    <section data-rules-editor>
      {/* v23 (макет Penpot): «Правила банка» и подсказка в строку, сетка 3x2 «название / порог», сработавший порог с красной точкой */}
      <div className="flex items-center justify-between gap-x-3">
        <div className="flex min-w-0 items-baseline gap-x-4 max-lg:hidden">
          <h2 className="rules-title">{t.rules.title}</h2>
          {!ro && <span className="rules-hint truncate">{t.rules.hint}</span>}
        </div>
        <button type="button" className="-my-1 flex min-h-11 flex-1 items-center justify-between gap-3 text-left lg:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-rules-toggle>
          <span className="rules-title !text-[16px]">{t.rules.title}</span>
          <span className="flex items-center gap-2 text-[15px] text-ink-3">{fired != null ? t.rules.firedOf(fired, meta.length) : t.rules.count(meta.length)}
            <ChevronDown size={18} strokeWidth={1.75} className={`text-ink-2 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden /></span>
        </button>
        <div className={`-my-2 -mr-2 flex items-center gap-2 ${open ? '' : 'max-lg:hidden'}`}>
          {sum && <span className="sr-only" data-rules-sum>{sum}</span>}
          <Menu.Root>
            <Menu.Trigger className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-white/80 hover:text-ink data-[popup-open]:bg-white" aria-label={t.rules.menu} title={t.rules.menu} data-rules-menu>
              <Ellipsis size={20} strokeWidth={2} aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="end" className="z-40">
                <Menu.Popup className="w-[min(300px,calc(100vw-24px))] rounded-[20px] bg-surface p-1.5 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none
                  origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
                  <Menu.Item className={menuItem} onClick={() => exportRules(meta, draft, profileName, t.rules.fileName)} data-rules-export>
                    <Download size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden />{t.rules.export}
                  </Menu.Item>
                  {!ro && <Menu.Item className={menuItem} onClick={() => file.current?.click()} data-rules-import>
                    <Upload size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden />{t.rules.import}
                  </Menu.Item>}
                  {!ro && onReset && <Menu.Item className={menuItem} onClick={() => { onReset(); setMsg(null) }} data-rules-reset>
                    <RotateCcw size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden />{t.rules.resetAria}
                  </Menu.Item>}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      <p aria-live="polite" className={`text-[14px] leading-snug ${formErr ? 'text-leak' : 'text-ink-2'} ${formErr || msg ? 'mt-1' : ''}`} data-rules-msg>{formErr ?? msg ?? ''}</p>
      <div className={open || formErr || rowErr ? '' : 'max-lg:hidden'}>
      <ul className="rules-grid mt-3 lg:mt-5">
        {meta.map((m) => {
          const on = m.on_param ? draft[m.on_param] !== false : true
          const v = typeof draft[m.param] === 'number' ? (draft[m.param] as number) : (m.default ?? 0)
          const pv = profile[m.param]
          const changed = typeof pv === 'number' && pv !== v
          const h = hits?.[m.key] ?? 0
          const name = ruleName(m, t)
          const fmt = (x: number) => ruleValue(m, x, t, lang)
          const bad = rowErr === m.param || rowErr === m.on_param
          const hot = !!hits && on && h > 0
          return (
            <li key={m.key} data-rule={m.key} className="rules-cell" data-off={on ? undefined : ''}>
              {/* тумблер правила - само название: нажатие выключает и включает правило, выключенное зачёркнуто */}
              {m.on_param
                ? <button type="button" role="switch" aria-checked={on} aria-label={t.rules.switchAria(name)} title={m.title} disabled={ro}
                    className="rules-name" onClick={() => set(m.on_param!, !on)}><span className="truncate">{name}</span></button>
                : <span className="rules-name" title={m.title}><span className="truncate">{name}</span></span>}
              <div className="rules-val pr-7">
                <ValueChip key={gen} value={v} min={m.min ?? 0} max={m.max ?? Number.MAX_SAFE_INTEGER} step={m.step ?? 1} format={fmt}
                  label={t.rules.chipAria(name)} changed={changed} title={changed ? t.rules.was(fmt(pv as number)) : undefined}
                  disabled={ro} fired={hot} onChange={(x) => set(m.param, x)}
                  onInvalid={() => m.min != null && m.max != null && setErr({ code: 'rule_range', param: m.param, min: m.min, max: m.max })} />
                {hot && <span className="rules-dot ml-auto" role="img" aria-label={t.rules.firedN(1)} title={t.rules.firedN(1)} data-fired-dot />}
              </div>
              {bad && err && <p role="alert" className="pt-1 text-[13px] font-medium leading-snug text-leak">{ruleErrText(err, meta, t, lang)}</p>}
            </li>
          )
        })}
      </ul>
      {note && <p className="mt-2 text-[14px] leading-snug text-ink-2" data-rules-note>{note}</p>}
      </div>
      {ro && <p className="mt-2 text-[15px] leading-snug text-ink-2" data-rules-static>{t.rules.static}</p>}
      {!ro && api === 'down' && <p className="mt-2 text-[15px] leading-snug text-ink-2" data-rules-down>{t.rules.down}</p>}
      <input ref={file} type="file" accept="application/json,.json" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </section>
  )
}

/** Подпись запасного прогона: «лимит перевода 1 млн ₸ вместо 500 тыс. ₸» по каждому изменённому правилу */
export function insteadText(meta: RuleMeta[], param: string, shown: number | boolean | undefined, asked: number | boolean, t: Dict, lang: Lang): string | null {
  const m = meta.find((x) => x.param === param || x.on_param === param)
  if (!m || shown == null) return null
  const f = (v: number | boolean) => (typeof v === 'boolean' ? (v ? t.rules.onFull : t.rules.off) : ruleValue(m, v, t, lang))
  return t.rules.instead(ruleName(m, t), f(shown), f(asked))
}
