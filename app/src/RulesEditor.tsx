import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { RuleErr, RuleMeta, RuleSet } from './data'
import { useLang, type Dict, type Lang } from './i18n'
import { kztShort } from './format'
import { Switch, ValueChip } from './ui'

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

export function RulesEditor({ meta, profile, draft, onChange, hits, note, api, err, setErr, profileName }: {
  meta: RuleMeta[]; profile: RuleSet; draft: RuleSet; onChange: (r: RuleSet) => void
  hits: Record<string, number> | null; note?: string; api: ApiState
  err: RuleErr | null; setErr: (e: RuleErr | null) => void; profileName: string
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

  return (
    <section data-rules-editor>
      {/* v20-fix D5: шаблон и загрузка в строке заголовка: на 1280x720 они не уходят под край плиты */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="t-title text-ink">{t.rules.title}</h2>
        <div className="flex flex-wrap gap-x-3">
          <button type="button" className="flex min-h-10 items-center gap-1.5 rounded-lg text-[14px] font-medium text-ink-2 hover:text-ink short:min-h-9" title={t.rules.export} aria-label={t.rules.export}
            onClick={() => exportRules(meta, draft, profileName, t.rules.fileName)} data-rules-export>
            <Download size={15} strokeWidth={1.75} aria-hidden />{t.rules.exportShort}
          </button>
          {!ro && (
            <button type="button" className="flex min-h-10 items-center gap-1.5 rounded-lg text-[14px] font-medium text-ink-2 hover:text-ink short:min-h-9" title={t.rules.import}
              onClick={() => file.current?.click()} data-rules-import>
              <Upload size={15} strokeWidth={1.75} aria-hidden />{t.rules.importShort}
            </button>
          )}
        </div>
      </div>
      <p aria-live="polite" className={`text-[15px] leading-snug ${formErr ? 'text-leak' : 'text-ink-2'} ${formErr || msg ? 'mt-1' : ''}`} data-rules-msg>{formErr ?? msg ?? ''}</p>
      {/* v21 (wow-v21, п. 7): главное действие продукта - свой порог; подсказка, пока нет сообщения */}
      {!ro && !formErr && !msg && <p className="t-caption text-ink-3" data-rules-hint>{t.rules.hint}</p>}
      <ul className="@container mt-1">
        {meta.map((m) => {
          const on = m.on_param ? draft[m.on_param] !== false : true
          const v = typeof draft[m.param] === 'number' ? (draft[m.param] as number) : (m.default ?? 0)
          const pv = profile[m.param]
          const changed = typeof pv === 'number' && pv !== v
          const h = hits?.[m.key] ?? 0
          const name = ruleName(m, t)
          const fmt = (x: number) => ruleValue(m, x, t, lang)
          const bad = rowErr === m.param || rowErr === m.on_param
          return (
            <li key={m.key} data-rule={m.key}>
              <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 @sm:gap-x-3 short:min-h-9">
                {m.on_param
                  ? <Switch on={on} set={(x) => set(m.on_param!, x)} label={t.rules.switchAria(name)} disabled={ro} />
                  : <span className="w-9" />}
                <span className={`text-[15px] font-medium leading-tight tracking-[-0.01em] ${on ? 'text-ink' : 'text-ink-3'}`} title={m.title}>{name}</span>
                <span className={on ? '' : 'opacity-45'}>
                  <ValueChip key={gen} value={v} min={m.min ?? 0} max={m.max ?? Number.MAX_SAFE_INTEGER} step={m.step ?? 1} format={fmt}
                    label={t.rules.chipAria(name)} changed={changed} title={changed ? t.rules.was(fmt(pv as number)) : undefined}
                    disabled={ro} onChange={(x) => set(m.param, x)}
                    onInvalid={() => m.min != null && m.max != null && setErr({ code: 'rule_range', param: m.param, min: m.min, max: m.max })} />
                </span>
                {hits ? (
                  <span className="flex min-w-[1.25rem] items-center justify-end gap-1.5 text-[13px] font-medium text-ink-2" title={!on ? t.rules.off : h ? t.rules.fired : t.rules.silent}>
                    <span aria-hidden className={`size-2 shrink-0 rounded-full ${on && h ? 'bg-stop-dot' : 'shadow-[inset_0_0_0_1.5px_var(--color-track)]'}`} />
                    <span className="@max-[22rem]:sr-only">{!on ? t.rules.off : h ? t.rules.fired : t.rules.silent}</span>
                  </span>
                ) : <span />}
              </div>
              {bad && err && <p role="alert" className="pb-1.5 pl-12 text-[13px] font-medium leading-snug text-leak">{ruleErrText(err, meta, t, lang)}</p>}
            </li>
          )
        })}
      </ul>
      {note && <p className="mt-2 text-[15px] leading-snug text-ink-2" data-rules-note>{note}</p>}
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
