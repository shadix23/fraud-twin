import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ru } from './ru'
import { en } from './en'

// Свой словарь без библиотек (бриф v20, п. 3). Язык: ?lang= -> localStorage -> язык браузера (ru и kk дают RU, остальное EN)
export type Dict = typeof ru
export type Lang = 'ru' | 'en'
export const LANGS: Record<Lang, Dict> = { ru, en }
const KEY = 'ft-lang'
const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in LANGS

export function detectLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (isLang(q)) return q
    const s = localStorage.getItem(KEY)
    if (isLang(s)) return s
  } catch { /* приватный режим без localStorage: решает браузер */ }
  const nav = (navigator.languages?.length ? navigator.languages : [navigator.language]).map((l) => l.toLowerCase().slice(0, 2))
  return nav[0] === 'ru' || nav[0] === 'kk' ? 'ru' : 'en'
}

// Множественное число на язык: ru три формы, en две
export function plural(lang: Lang, n: number, forms: readonly string[]): string {
  if (lang === 'en') return Math.abs(n) === 1 ? forms[0] : forms[1] ?? forms[0]
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b === 1) return forms[0]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}

interface Ctx { lang: Lang; t: Dict; setLang: (l: Lang) => void }
const LangCtx = createContext<Ctx>({ lang: 'ru', t: ru, setLang: () => {} })

function apply(l: Lang) {
  document.documentElement.lang = l
  document.title = LANGS[l].meta.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', LANGS[l].meta.description)
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(detectLang)
  useEffect(() => { apply(lang) }, [lang])
  const setLang = useCallback((l: Lang) => {
    set(l)
    try { localStorage.setItem(KEY, l) } catch { /* без памяти: язык живёт до перезагрузки */ }
    // ?lang= в адресе главнее памяти: переписываем его, чтобы перезагрузка не вернула старый язык
    const u = new URL(location.href)
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(history.state, '', u) }
  }, [])
  const value = useMemo(() => ({ lang, t: LANGS[lang], setLang }), [lang, setLang])
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>
}

export const useLang = () => useContext(LangCtx)
export const useT = () => useContext(LangCtx).t
