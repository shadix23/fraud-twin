import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { dur, ease, flow, prefersReduced } from './motion'

// Хвосты «Перелива» (моушн-бриф, раздел 4 и 6.1): уход старого заголовка и спутников плитки за 140 мс по opacity,
// новый заголовок входит по строкам из-под маски с шагом 90 мс.

const LINE_STEP = 90 // мс между строками заголовка

/** Заголовок шага. id меняется вместе со смыслом шага (не с языком): старый гаснет 140 мс без сдвига,
 *  новый выезжает из-под маски построчно. popLayout: уходящий заголовок снимается с потока, новый не ждёт его */
export function StepHead({ id, text, mute, entered }: { id: string; text: string; mute: string; entered: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial>
      <motion.span key={id} className="block" exit={{ opacity: 0, transition: { duration: dur.exit / 1000, ease: ease.in } }}>
        <HeadLines text={text} mute={mute} start={entered ? flow.head * 1000 : 60} long={!entered} />
      </motion.span>
    </AnimatePresence>
  )
}

/** Слова в своих масках; номер строки считается по положению слова до первой отрисовки.
 *  Анимация живёт только первые 1,4 с: при смене языка новые слова не выезжают, текст меняется на месте */
function HeadLines({ text, mute, start, long }: { text: string; mute: string; start: number; long: boolean }) {
  const box = useRef<HTMLSpanElement>(null)
  const [live, setLive] = useState(() => !prefersReduced())
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !live) return
    const words = [...el.querySelectorAll<HTMLElement>('.hw')]
    let line = -1, top = -Infinity
    for (const w of words) {
      if (w.offsetTop > top + 4) { line++; top = w.offsetTop }
      w.style.setProperty('--d', `${start + line * LINE_STEP}ms`)
    }
    // серая строка: только проявляется, после последней строки (вход 160 мс, смена шага 120 мс)
    el.querySelector<HTMLElement>('.hw-mute')?.style.setProperty('--d', `${start + Math.max(0, line) * LINE_STEP + (long ? 160 : 120)}ms`)
  }, [text, mute, start, long, live])
  useEffect(() => {
    if (!live) return
    const t = setTimeout(() => setLive(false), 1400)
    return () => clearTimeout(t)
  }, [live])
  const words = text.split(' ')
  return (
    <span ref={box} className={`block ${live ? (long ? 'hw-live hw-long' : 'hw-live') : ''}`}>
      <span className="block">
        {words.map((w, i) => <Fragment key={i}><span className="hw"><span>{w}</span></span>{i < words.length - 1 ? ' ' : ''}</Fragment>)}
      </span>
      {mute && <>{' '}<span className="mute hw-mute">{mute}</span></>}
    </span>
  )
}

/** Спутник плитки (надпись, пояснение, второе число). k - ключ шага: при смене старое содержимое гаснет 140 мс по opacity
 *  на том же узле, затем приходит новое и проявляется в свой срок (520 мс от клика, шаг 60 мс) */
export function Sat({ k, i, className = '', children, ...rest }: { k: string | number; i: number; className?: string; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  const [disp, setDisp] = useState(k)
  const last = useRef<ReactNode>(children)
  const swapped = useRef(false)
  if (disp === k) last.current = children
  const out = disp !== k
  useEffect(() => {
    if (!out) return
    const t = setTimeout(() => { swapped.current = true; setDisp(k) }, prefersReduced() ? 0 : dur.exit)
    return () => clearTimeout(t)
  }, [out, k])
  const d = Math.round((flow.sat + i * flow.satStep) * 1000) - (swapped.current ? dur.exit : 0)
  if (out) return last.current ? <div key={String(disp)} className={`${className} sat-out`} {...rest}>{last.current}</div> : null
  return children ? <div key={String(k)} className={`${className} sat-in`} style={{ '--d': `${d}ms` } as CSSProperties} {...rest}>{children}</div> : null
}
