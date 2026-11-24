import { useCallback, useRef } from 'react'

// Свет за курсором (Siriva useCardLight.ts): пишет --mx/--my раз в кадр, только для мыши и без reduced motion.
// Возвращает обработчик onPointerMove для элемента с классом .lit
export function useCardLight<T extends HTMLElement>() {
  const frame = useRef(0)
  return useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const x = e.clientX, y = e.clientY
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${x - r.left}px`)
      el.style.setProperty('--my', `${y - r.top}px`)
    })
  }, [])
}
