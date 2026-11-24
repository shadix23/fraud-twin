import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Phone from './Phone'
import { LangProvider, useT } from './i18n'

// F8: адрес #client открывает телефонный сценарий без 3D. Основное приложение (и сцена в нём) грузится отдельным чанком
// только когда нужно, поэтому телефон жюри по QR получает маленький первый бандл.
const App = lazy(() => import('./App'))
const isClient = () => location.hash === '#client'

// безопасные зоны iPhone (env(safe-area-inset-*)) работают только с viewport-fit=cover
function fitCover(on: boolean) {
  const m = document.querySelector('meta[name="viewport"]')
  m?.setAttribute('content', `width=device-width, initial-scale=1.0${on ? ', viewport-fit=cover' : ''}`)
}

function Boot() {
  const t = useT()
  return <div className="boot" role="status"><div><b>Fraud <i>Twin</i></b><p>{t.boot}</p></div></div>
}

function Root() {
  const [client, setClient] = useState(isClient)
  useEffect(() => {
    const on = () => setClient(isClient())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => { fitCover(client); if (client) window.scrollTo(0, 0) }, [client])
  return client ? <Phone /> : <Suspense fallback={<Boot />}><App /></Suspense>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Root />
    </LangProvider>
  </StrictMode>,
)
