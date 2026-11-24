import { LANGS, type Lang } from './i18n'

// Типы и загрузка данных. Сначала API (если задан VITE_API_URL), при сбое -
// готовые прогоны из public/scenarios. Метка «синтетический банк» есть в обоих.

export type RunKey = 'base' | 'model' | 'hold' | 'model_hold'

export interface RuleMeta {
  key: string; title: string; action: string; param: string; unit: string
  // границы поля приходят из GET /world (бриф v20, контракт): фронт их не хранит. В whatif_meta их нет
  on_param?: string; min?: number; max?: number; step?: number; default?: number
}
// Набор правил, которые правит пользователь: тумблеры (*_on) и пороги шести правил
export type RuleSet = Record<string, number | boolean>
export interface RuleChange { param: string; from: number | boolean | null; to: number | boolean | null }
export interface HonestShort { delayed_per_10k: number; frozen_clients_pct: number; blocked: number }
// Ответ 422 от /redteam или та же проверка на фронте (чип, импорт файла)
export type RuleErr =
  | { code: 'rule_range'; param: string; min: number; max: number }
  | { code: 'rule_unknown'; params: string[] }
  | { code: 'rule_type'; param: string; expected: string }
  | { code: 'bad_file' }

export interface HonestCost {
  honest_watched_tx: number; blocked: number; held: number; suspended: number
  alerts: number; frozen_clients: number; delayed_per_10k: number; frozen_clients_pct: number
}

export interface PresetInfo {
  key: string; title: string; source: string; drops: number
  params: Record<string, unknown>
}

export type Calib = Record<string, number>
export interface CalibField { key: string; target: 'profile' | 'rules'; min: number; max: number; step: number; title: string; unit: string }
export interface CalibPreset { id: string; name: string; note: string; values: Calib }
// Текущий профиль банка: значения ползунков и id готового профиля (если совпал)
export interface Ctx { calib: Calib | null; preset: string | null }
export const DEMO_CTX: Ctx = { calib: null, preset: 'demo' }

export interface Bank {
  synthetic: true
  name: string
  calib: Calib
  calib_preset: string | null
  calib_fields: CalibField[]
  calib_presets: CalibPreset[]
  summary: { clients: number; honest_tx: number; segments: Record<string, number>; honest_by_channel: Record<string, number> }
  segments_ru: Record<string, string>
  cloud: string
  rules: Record<string, number | boolean>
  rule_meta: RuleMeta[]
  whatif_meta: RuleMeta[]
  presets: PresetInfo[]
  honest_cost: Record<RunKey, HonestCost>
  honest_feed?: Record<RunKey, HonestFeed>
  model?: ModelInfo
}

export interface BenchRow {
  key: string; title: string
  pr_auc: { rules: number; heuristic: number; boosting: number }
  rules_pct: number; heuristic_pct: number; boosting_pct: number; honest_per_10k: number
}

export interface ModelInfo {
  name: string; trained: boolean; algo?: string; worlds?: number; rows?: number
  summary?: { pr_auc_mean: Record<string, number>; withdrawn_pct_mean: Record<string, number> }
  benchmark: BenchRow[]; notes?: string[]; threshold?: number
}

export interface RedteamTry { i: number; gen: number; fit: number; pct: number; caught: string; rule: string }

export interface Redteam {
  synthetic: true
  scheme: string
  evals: number
  seconds: number
  base: { fit: number; pct: number; metrics: Metrics }
  best: {
    fit: number; pct: number; metrics: Metrics; params: Record<string, unknown>
    diff: { param: string; title: string; from: string | number; to: string | number }[]
    silent_rules: string[]; recheck_withdrawn_kzt: number[]; hints: string[]
  }
  history: RedteamTry[]
  scenario: Scenario
  // новый контракт POST /redteam; в готовых прогонах этих полей нет
  rules?: RuleSet; rules_changed?: RuleChange[]
  honest?: HonestShort; honest_base?: HonestShort; source?: 'live'
  // v21 (wow-v21, п. 1): поиск мог не дойти до лучшей атаки, тогда доля - нижняя оценка; лучшая атака, пересчитанная на правилах профиля.
  // Поля опциональные: нет поля - пишем как раньше. Имена согласовать с backend (sim/fraudtwin/api.py)
  lower_bound?: boolean; profile_pct?: number | null
}

/** Доля лучшей атаки - нижняя оценка («не меньше»): признак сверху ответа или в best */
export const isLowerBound = (r: Redteam | null | undefined): boolean =>
  !!r && !!(r.lower_bound ?? (r.best as { lower_bound?: boolean }).lower_bound)
/** Та же атака на правилах профиля, % (если сервер её пересчитал) */
export const profilePct = (r: Redteam | null | undefined): number | null => {
  const v = r ? r.profile_pct ?? (r.best as { profile_pct?: number | null }).profile_pct : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export interface TxEvent {
  t: number; src: number; dst: number; amount: number
  kind: 'victim' | 'drop' | 'cashout'; chain: number; hop: number
  status: 'ok' | 'blocked' | 'suspended' | 'held' | 'cancelled' | 'frozen_src' | 'frozen_dst'
  rule: string; channel: string
  // лента переводов: риск модели 0..1 и причина словами (sim/fraudtwin/feed.py); в старых прогонах полей нет
  risk?: number | null; why?: string; side?: string
}

// честный перевод, который задела мера: строка из прогона всего честного трафика
export interface HonestRow {
  t: number; src: number; dst: number; amount: number; kind: 'honest'
  status: 'blocked' | 'suspended' | 'held'; rule: string; channel: string; risk: number | null; why: string
}
export interface HonestFeed { rows: HonestRow[]; total: { blocked: number; suspended: number; held: number }; watched: number }

export interface Freeze { t: number; id: number; rule: string; chain: number; balance: number }

export interface Metrics {
  scheme: string; attempted_kzt: number; withdrawn_kzt: number; intercepted_kzt: number
  frozen_kzt: number; prevented_kzt: number; stuck_kzt: number
  withdrawn_by_channel: Record<string, number>
  chains_total: number; chains_caught: number; drops_total: number; drops_frozen: number
  minutes_to_first_freeze: number | null; rule_hits: Record<string, number>; scheme_cost_kzt: number
}

export interface GNode {
  id: number; role: 'drop' | 'victim' | 'honest' | 'trader' | 'sink' | 'atm' | 'ext'
  seg?: string; age?: number; phone_share?: number; chain?: number; layer?: number; label?: string
  x?: number; y?: number
}

export interface GLink { source: number | GNode; target: number | GNode; kind: 'honest' | 'attack' }

export interface Scenario {
  synthetic: true
  scheme: { key: string; title: string; source: string; start_min: number } & Record<string, unknown>
  drops: number
  chains: { id: number; victims: number[]; layers: number[][] }[]
  nodes: GNode[]
  links: GLink[]
  runs: Record<RunKey, { metrics: Metrics; log: TxEvent[]; freezes: Freeze[] }>
  horizon_min: number
}

export const API = import.meta.env.VITE_API_URL as string | undefined
// ссылка на репозиторий появится в «Как устроено», когда её зададут при сборке
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || ''
export const hasApi = !!API

// Свой профиль без сервера посчитать нельзя: это сообщение показываем как есть
export class OfflineError extends Error {
  constructor(lang: Lang) { super(LANGS[lang].errors.offline) }
}

// Готовые прогоны по языку: scenarios/ru и scenarios/en (B2), профили в p_<id> внутри языка
export const readyDir = (ctx: Ctx, lang: Lang) =>
  ctx.preset === 'demo' ? `/scenarios/${lang}` : ctx.preset ? `/scenarios/${lang}/p_${ctx.preset}` : null

// lang уходит в тело каждого POST: сервер переводит тексты, числа те же (бриф v20, п. 3)
async function getJson<T>(ctx: Ctx, lang: Lang, apiPath: string, file: string, body?: object, timeout = 4000): Promise<{ data: T; source: 'api' | 'json' }> {
  if (API) {
    let r: Response | null = null
    try {
      r = await fetch(API + apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, calib: ctx.calib, lang }), signal: AbortSignal.timeout(timeout) })
    } catch { r = null /* сервер недоступен или не успел: готовые прогоны */ }
    if (r?.ok) return { data: (await r.json()) as T, source: 'api' }
    if (r?.status === 422) {
      const detail = await r.json().catch(() => null)
      throw new Error(typeof detail?.detail === 'string' ? detail.detail : LANGS[lang].errors.badCalib)
    }
  }
  const dir = readyDir(ctx, lang)
  if (!dir) throw new OfflineError(lang)
  const r = await fetch(`${dir}/${file}`)
  if (!r.ok) throw new Error(LANGS[lang].errors.load(`${dir}/${file}`))
  return { data: (await r.json()) as T, source: 'json' }
}

export const loadBank = (ctx: Ctx, lang: Lang) => getJson<Bank>(ctx, lang, '/world', 'bank.json', {}, 6000)
export const loadScenario = (key: string, ctx: Ctx, lang: Lang) => getJson<Scenario>(ctx, lang, '/attack', `${key}.json`, { scheme: key })
// Прогрев функции при загрузке страницы (холодный старт на Vercel): ответ за 8 с = сервер жив
export async function warmApi(): Promise<boolean> {
  if (!API) return false
  try { return (await fetch(`${API}/health`, { signal: AbortSignal.timeout(8000) })).ok } catch { return false }
}

export class RuleError extends Error {
  detail: RuleErr
  constructor(detail: RuleErr) { super(detail.code); this.detail = detail }
}
// Почему показан готовый прогон: не успел за 8 с, сети нет, сервер упал, или это статика без сервера
export type Fallback = 'timeout' | 'offline' | 'server' | 'static'
export interface RedteamResult { data: Redteam; source: 'live' | 'ready'; fallback: Fallback | null }

// ИИ-мошенник по правилам пользователя (POST /redteam, бриф v20). rules - только отличия от профиля.
// Живой поиск 1-2,5 с; ждём 8 с, потом ближайший готовый прогон (сейчас один: правила профиля, сетку добавит B3).
// 422 не подменяется готовым прогоном: это ошибка ввода, её показывает редактор правил
export async function runRedteam(key: string, ctx: Ctx, lang: Lang, rules: RuleSet | null, timeout = 8000): Promise<RedteamResult> {
  const over = rules && Object.keys(rules).length ? rules : null
  let fallback: Fallback | null = over ? 'static' : null
  if (API) {
    let r: Response | null = null
    try {
      r = await fetch(`${API}/redteam`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheme: key, calib: ctx.calib, lang, rules: over }), signal: AbortSignal.timeout(timeout) })
    } catch (e) { fallback = (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'offline' }
    if (r?.ok) return { data: (await r.json()) as Redteam, source: 'live', fallback: null }
    if (r?.status === 422) {
      const d = (await r.json().catch(() => null))?.detail
      if (d && typeof d === 'object' && typeof d.code === 'string') throw new RuleError(d as RuleErr)
      throw new Error(typeof d === 'string' ? d : LANGS[lang].errors.badParams)
    }
    if (r) fallback = 'server'
  }
  const dir = readyDir(ctx, lang)
  if (!dir) throw new OfflineError(lang)
  const f = await fetch(`${dir}/redteam_${key}.json`).catch(() => null)
  if (!f?.ok) throw new Error(LANGS[lang].errors.load(`${dir}/redteam_${key}.json`))
  return { data: (await f.json()) as Redteam, source: 'ready', fallback }
}

// Готовый прогон поиска на другом языке: смена языка не должна менять числа уже показанного запасного прогона
export async function loadReadyHole(key: string, ctx: Ctx, lang: Lang): Promise<Redteam> {
  const dir = readyDir(ctx, lang)
  if (!dir) throw new OfflineError(lang)
  const f = await fetch(`${dir}/redteam_${key}.json`)
  if (!f.ok) throw new Error(LANGS[lang].errors.load(`${dir}/redteam_${key}.json`))
  return (await f.json()) as Redteam
}

// Цена мер для честных при своих правилах (F5): POST /whatif по трём мерам, нужен только honest.delayed_per_10k.
// Каждый вызов 0,3-0,5 с. Без сервера или при отказе null: экран берёт цену из профиля и пишет об этом
const MEASURES: [RunKey, RuleSet][] = [['model', { model_on: true }], ['hold', { first_hold_on: true }], ['model_hold', { model_on: true, first_hold_on: true }]]
export async function honestPrices(key: string, ctx: Ctx, lang: Lang, rules: RuleSet): Promise<Partial<Record<RunKey, number>> | null> {
  if (!API) return null
  try {
    const out = await Promise.all(MEASURES.map(async ([k, whatif]) => {
      const r = await fetch(`${API}/whatif`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheme: key, calib: ctx.calib, lang, rules, whatif }), signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json() as { after: { honest: HonestCost } }
      return [k, d.after.honest.delayed_per_10k] as const
    }))
    return Object.fromEntries(out)
  } catch { return null }
}

// Пороги, которые правит пользователь, из правил профиля
export const editable = (meta: RuleMeta[], rules: Record<string, unknown>): RuleSet => {
  const out: RuleSet = {}
  for (const m of meta) {
    if (m.on_param && typeof rules[m.on_param] === 'boolean') out[m.on_param] = rules[m.on_param] as boolean
    if (typeof rules[m.param] === 'number') out[m.param] = rules[m.param] as number
  }
  return out
}
export const rulesDiff = (draft: RuleSet, base: RuleSet): RuleSet =>
  Object.fromEntries(Object.entries(draft).filter(([k, v]) => base[k] !== v))
export const sameRules = (a: RuleSet, b: RuleSet) =>
  Object.keys({ ...a, ...b }).every((k) => a[k] === b[k])
// Отчёт: 5 схем, поиск дыр против правил и против модели, ~15 с без кэша
export const loadReport = (ctx: Ctx, lang: Lang) => getJson<Report>(ctx, lang, '/report', 'report.json', {}, 40000)

export const runKey = (model: boolean, hold: boolean): RunKey =>
  model && hold ? 'model_hold' : model ? 'model' : hold ? 'hold' : 'base'

export interface ShortMetrics {
  withdrawn: number; intercepted: number; attempted: number
  chains_caught: number; chains_total: number; rule_hits: Record<string, number>
}

export interface ReportScheme {
  key: string; title: string; source: string
  lib: Record<RunKey, ShortMetrics>; hole: Record<RunKey, ShortMetrics>
  rematch: { withdrawn: number; attempted: number; pct: number; diff: Redteam['best']['diff'] }
  diff: Redteam['best']['diff']; silent_rules: string[]; hints: string[]; evals: number
  recheck_withdrawn: number[]
  lower_bound?: boolean
}

export interface Report {
  synthetic: true
  bank: { name: string; calib: Calib; preset: string | null; clients: number; honest_tx: number; rules: Record<string, number> }
  summary: { schemes: number; holes_found: number; attempted: number; lib_withdrawn: number; hole_withdrawn: number
    lib_pct: number; hole_pct: number; rematch_withdrawn: number; rematch_pct: number
    // v21: знаменатель дыр и обхода модели - попытки ПО НАЙДЕННЫМ схемам (attempted остался для библиотеки и lib_pct)
    hole_attempted?: number; rematch_attempted?: number; lower_bound?: boolean }
  schemes: ReportScheme[]
  measures: { key: RunKey; title: string; lib_withdrawn: number; hole_withdrawn: number
    delayed_per_10k: number; frozen_clients: number; frozen_clients_pct: number }[]
  recommendations: { title: string; text: string; where?: string[]; kind: string }[]
  caveats: string[]
}

// Экран клиента: та же модель смотрит на карту получателя до перевода (hackathon/client-screen.md)
export type ClientLevel = 'high' | 'medium' | 'low' | 'blocked'
export interface ClientButton { id: string; label: string; primary?: boolean; quiet?: boolean }
export interface ClientCase {
  transfer: { amount: number; time: string; new_recipient: boolean; recipient: { name: string; phone_mask: string; card_mask: string } }
  risk: { score: number; level: ClientLevel; basis: 'flow' | 'no_history' | 'blocked' }
  reasons: { key: string; text: string }[]
  action?: string
  screen: { title: string; subtitle?: string; question?: string; buttons?: ClientButton[]; footnote?: string; button?: string }
}
export interface ClientCheck {
  synthetic: true; note: string
  scheme: { key: string; title: string; hole: boolean }
  demo: string
  cases: Record<string, ClientCase | undefined>
  after: Record<string, string>
  stats: { honest: { high_per_10k: number; honest_p2p_tx: number } } & Record<string, unknown>
  robust?: { honest_worlds: number; honest: { high_per_10k: number; honest_p2p_tx: number }; victims: { first_on_card_silent_pct: number; repeat_on_card_covered_pct: number } }
}

// Демо: GET /client-check (дыра student_crypto), до 1 с; иначе готовый файл. Нет и его - null, экран покажет обычный «отправлен»
export async function loadClientCheck(scheme: string, ctx: Ctx, lang: Lang): Promise<{ data: ClientCheck | null; robust: ClientCheck['robust'] | null }> {
  const demo = scheme === 'student_crypto' && ctx.preset === 'demo'
  const file = demo ? fetch(`/scenarios/${lang}/client_check.json`).then((r) => (r.ok ? (r.json() as Promise<ClientCheck>) : null)).catch(() => null) : Promise.resolve(null)
  let live: ClientCheck | null = null
  if (API) {
    try {
      const r = demo
        ? await fetch(`${API}/client-check?lang=${lang}`, { signal: AbortSignal.timeout(1000) })
        : await fetch(`${API}/client-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheme, calib: ctx.calib, hole: true, lang }), signal: AbortSignal.timeout(2500) })
      if (r.ok) live = (await r.json()) as ClientCheck
    } catch { live = null /* сервер не ответил: готовый файл */ }
  }
  const f = await file
  // демо-схема: готовый файл - тот же экспорт, что у телефона жюри (#client) и в отчёте; живой ответ короче (без robust) и расходится в числах
  return { data: demo ? f ?? live : live ?? f, robust: f?.robust ?? null }
}
