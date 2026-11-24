import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { BankCamera, ExitProp, PAL, Plinth, Studio, blobTexture, useCoinGeometry, usePersonGeometry, usePile } from './Props3D'
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import type { Freeze, Scenario, TxEvent } from './data'
import { EXIT_ORDER, EXIT_TITLE, LINE_MIN, SPEED, STOP, ease, exitKey } from './sceneShared'
import { kzt } from './format'

// Атака как объект в пространстве. Ось X = глубина пути денег: жертвы -> слой 1 -> слой 2 -> граница банка -> вывод.
// Каждый слой - полупрозрачная плоскость, 12 цепочек прошивают плоскости сеткой 4 x 3.
// Время берём из того же t, что и панель: число «Выведено» и красный на границе совпадают кадр в кадр.

export interface Scene3DProps {
  sc: Scenario; log: TxEvent[]; freezes: Freeze[]; t: number; done: boolean
  playing: boolean; isHole: boolean; covered: boolean; compact: boolean
  // экран клиента: mark - цепочка его перевода (остальные притихают), gone - клиент отменил, цепочка гаснет
  mark?: number | null; gone?: number | null
  aside?: boolean // открыт телефон клиента: кадр уходит в свободную часть сцены
}

// Палитра сцены v11: почти чёрный с фиолетовым отливом и свечения референсов (references/taste/security-alert-glass.md).
// Ключи прежние: emerald = защита (мятно-циановый), gold/champagne/bronze = фиолетовый акцент в трёх ступенях
export const T = {
  bg0: '#080815', bg1: '#0D0C22', plane: '#14123A', frame: '#2E2A63', track: '#36316B', cloud: '#1F1C45',
  ivory: '#F1EFFA', mist: '#B0ABCF', muted: '#948FB8',
  emerald: '#1FCFAE', gold: '#B07CFF', champagne: '#D6C4FF', bronze: '#7B5CE0', risk: '#FF4D6D',
}

const D = 3.4 // шаг между плоскостями
const TAIL_MIN = 0.35 * SPEED // после границы красный хвост долетает до узла вывода
const FLASH_MIN = 0.6 * SPEED // зелёная вспышка заморозки
const CLOUD = 3600
const FLY_MS = 1300 // перелёт камеры между планами шагов (motion п. 5)
const GLINT_MS = 900 // блик по ребру плоскости при её появлении (п. 7)
const DRIFT = (1.5 * Math.PI) / 180 // дрейф в покое: не больше 1,5° за 8 с (п. 6)
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const col = (hex: string) => new THREE.Color(hex)
const K = {
  money: col(T.gold), head: col(T.champagne), leak: col(T.risk), stop: col(T.emerald), node: col(T.muted),
  track: col(T.track), bg: col(T.bg1), cloud: col(T.cloud), plane: col(T.plane), frame: col(T.frame), bank: col(T.bronze),
}
let lastLayers: number | null = null // между монтированиями: чтобы переход «слоёв 2 -> 1» доигрывался

// ---------- раскладка: формула, без случайности ----------
interface Acc { chain: number; col: number; k: number; cnt: number }
function grid(n: number) {
  const nz = Math.max(1, Math.ceil(Math.sqrt(n / 1.4))), ny = Math.ceil(n / nz)
  const cells = Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / nz), c = i % nz
    return { y: ((ny - 1) / 2 - r) * 1.5, z: (c - (nz - 1) / 2) * 1.6 }
  })
  return { ny, nz, cells, H: ny * 1.5 + 0.7, W: nz * 1.6 + 0.7 }
}
// планы камеры для телефона: смещение камеры от цели (x, y, z) и сдвиг цели вправо под суммы
const CAM_M: Record<string, [number, number, number, number]> = { attack: [-3.4, 3.6, 12.6, 1.2], hole: [-2.4, 3.8, 12.2, 0.9], wall: [-4.4, 3.5, 12.8, 0.9] }
const x0Of = (L: number) => -(L * D + 4) / 2
const colX = (j: number, L: number) => x0Of(L) + Math.min(j, L) * D
const bankX = (L: number) => x0Of(L) + L * D + 2.2
const exitXOf = (L: number) => bankX(L) + 1.8

function buildLayout(sc: Scenario) {
  const g = grid(sc.chains.length)
  const L = Math.max(1, ...sc.chains.map((c) => c.layers.length))
  const acc = new Map<number, Acc>()
  sc.chains.forEach((c, i) => {
    c.victims.forEach((id, k) => acc.set(id, { chain: i, col: 0, k, cnt: c.victims.length }))
    c.layers.forEach((ids, j) => ids.forEach((id, k) => acc.set(id, { chain: i, col: j + 1, k, cnt: ids.length })))
  })
  const role = new Map(sc.nodes.map((x) => [x.id, x.role]))
  const exitOf = new Map<number, string>()
  const keys: string[] = []
  const pairs = new Map<string, [number, number]>()
  let maxLog = 1, maxFrz = 1
  for (const r of Object.values(sc.runs)) {
    maxLog = Math.max(maxLog, r.log.length); maxFrz = Math.max(maxFrz, r.freezes.length)
    for (const e of r.log) {
      if (e.kind === 'cashout') { const k = exitKey(role.get(e.dst)); exitOf.set(e.dst, k); if (!keys.includes(k)) keys.push(k) }
      if (acc.has(e.src)) pairs.set(`${e.src}-${e.dst}`, [e.src, e.dst])
    }
  }
  keys.sort((a, b) => EXIT_ORDER.indexOf(a) - EXIT_ORDER.indexOf(b))
  const exits = keys.map((key, k) => ({ key, y: ((keys.length - 1) / 2 - k) * 2.0 }))
  return { g, L, acc, exitOf, exits, tracks: [...pairs.values()], maxLog, maxFrz }
}
type Lay = ReturnType<typeof buildLayout>

function accPos(lay: Lay, a: Acc, L: number, out: THREE.Vector3) {
  const c = lay.g.cells[a.chain]
  const ang = (a.k / a.cnt) * Math.PI * 2 + Math.PI / 2, r = a.cnt > 1 ? 0.27 : 0
  return out.set(colX(a.col, L), c.y + Math.sin(ang) * r, c.z + Math.cos(ang) * r)
}

// подпись для проверки стабильности: позиции первых узлов при итоговой длине
export function layoutSignature(sc: Scenario) {
  const lay = buildLayout(sc), v = new THREE.Vector3()
  return [...lay.acc.values()].slice(0, 4).map((a) => accPos(lay, a, lay.L, v).toArray().map((x) => x.toFixed(2)).join(',')).join(';')
}

// ---------- толстые линии одной геометрией ----------
class Segs {
  obj: LineSegments2; pos: Float32Array; colr: Float32Array; n = 0; max: number; width: number
  constructor(max: number, width: number) {
    this.max = max; this.width = width
    const g = new LineSegmentsGeometry()
    g.setPositions(new Float32Array(max * 6)); g.setColors(new Float32Array(max * 6))
    const m = new LineMaterial({ linewidth: width, vertexColors: true, depthWrite: false }) // без записи глубины одинаковые пути не дробятся на пунктир
    this.obj = new LineSegments2(g, m); this.obj.frustumCulled = false
    this.pos = (g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.array as Float32Array
    this.colr = (g.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.array as Float32Array
    g.instanceCount = 0
  }
  push(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color) {
    if (this.n >= this.max) return
    const i = this.n * 6, p = this.pos, q = this.colr
    p[i] = a.x; p[i + 1] = a.y; p[i + 2] = a.z; p[i + 3] = b.x; p[i + 4] = b.y; p[i + 5] = b.z
    q[i] = q[i + 3] = c.r; q[i + 1] = q[i + 4] = c.g; q[i + 2] = q[i + 5] = c.b
    this.n++
  }
  commit(dpr: number) {
    const g = this.obj.geometry
    ;(g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true
    ;(g.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true
    g.instanceCount = this.n
    this.obj.material.linewidth = this.width * dpr
    this.n = 0
  }
  dispose() { this.obj.geometry.dispose(); this.obj.material.dispose() }
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(geo, mat, n)
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  m.frustumCulled = false; m.count = 0
  return m
}

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

type Live = { current: Scene3DProps }
// подписи - обычный DOM поверх холста; позиции ставит кадр, React их не перерисовывает
interface Dom { head: (HTMLDivElement | null)[]; bank: HTMLDivElement | null; exit: (HTMLDivElement | null)[]; exitSum: (HTMLSpanElement | null)[]; note: HTMLDivElement | null; noteIn: HTMLDivElement | null }
const LABEL = 'pointer-events-none absolute left-0 top-0 whitespace-nowrap select-none will-change-transform [text-shadow:0_0_3px_#080815,0_0_8px_#080815]'
const REFOCUS = '|refocus' // после снятия фокуса камера плавно возвращается к плану шага

export default function Scene3D(props: Scene3DProps) {
  const live = useRef(props)
  live.current = props
  const miss = useRef<() => void>(() => {})
  const sc = props.sc
  const sig = useMemo(() => layoutSignature(sc), [sc])
  const lay = useMemo(() => buildLayout(sc), [sc])
  const dom = useRef<Dom>({ head: [], bank: null, exit: [], exitSum: [], note: null, noteIn: null })
  const n = sc.chains.length
  const P = Math.max(2, lay.L)
  const headers = [
    { text: 'Жертвы', n: sc.chains.reduce((a, c) => a + c.victims.length, 0) },
    ...Array.from({ length: P }, (_, j) => ({ text: `Дропы, слой ${j + 1}`, n: sc.chains.reduce((a, c) => a + (c.layers[j]?.length ?? 0), 0) })),
  ]
  const compact = props.compact
  return (
    <div className="absolute inset-0 overflow-hidden" data-layout={sig} data-scene3d>
      <Canvas frameloop={props.covered ? 'demand' : 'always'} dpr={[1, 2]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 200, position: [-6, 5, 12] }} role="img"
        aria-label={`${n} цепочек атаки в трёх измерениях: жертвы, слои дропов, граница банка, вывод`}
        onPointerMissed={() => miss.current()}>
        <World sc={sc} lay={lay} live={live} compact={compact} miss={miss} dom={dom} />
        {/* очень лёгкое свечение у монет и головок (фиолет ярче порога, розово-красный нет), виньетка вместо градиента фона */}
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <Bloom mipmapBlur luminanceThreshold={0.42} luminanceSmoothing={0.25} intensity={0.7} radius={0.6} />
          <Vignette offset={0.3} darkness={0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>
      {/* телефон: те же подписи, короче и без счётчиков, чтобы четыре слоя читались на 375 px */}
      {headers.map((h, j) => (
        <div key={`h${j}`} ref={(d) => { dom.current.head[j] = d }} data-label className={`${LABEL} text-center ${compact ? 'text-[14px]' : 'text-[16px]'} font-medium leading-tight text-[#F1EFFA]`}>
          {compact ? (j === 0 ? h.text : `Дропы ${j}`) : h.text}{!compact && <div className="text-[14px] font-normal tabular-nums text-[#948FB8]">{h.n}</div>}
        </div>
      ))}
      <div ref={(d) => { dom.current.bank = d }} data-label className={`${LABEL} ${compact ? 'text-[14px]' : 'text-[16px]'} font-medium tracking-[0.01em] text-[#C39BFF]`}>Граница банка</div>
      {lay.exits.map((x, k) => (
        <div key={x.key} ref={(d) => { dom.current.exit[k] = d }} data-label className={`${LABEL} ${compact ? 'rounded-md bg-[#0B0A20]/80 px-1.5' : 'pl-3'} text-[16px] font-medium leading-tight text-[#F1EFFA]`}>
          <div className={compact ? 'text-[14px] font-normal' : props.aside ? 'text-[14px]' : undefined}>{EXIT_TITLE[x.key]}</div>
          <span ref={(s) => { dom.current.exitSum[k] = s }} className={`${compact ? 'text-[17px]' : props.aside ? 'text-[18px]' : 'text-[20px]'} font-semibold tabular-nums text-[#948FB8]`}>0 ₸</span>
        </div>
      ))}
      <div ref={(d) => { dom.current.note = d }} className={LABEL} role="status">
        <div ref={(d) => { dom.current.noteIn = d }} className="rounded-md bg-[#1D1A44]/90 px-2.5 py-1 text-[16px] text-[#F1EFFA] [text-shadow:none]" style={{ opacity: 0 }} />
      </div>
    </div>
  )
}

function World({ sc, lay, live, compact, miss, dom }: {
  sc: Scenario; lay: Lay; live: Live; compact: boolean; miss: { current: () => void }; dom: { current: Dom }
}) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null
  const reduced = useMemo(reducedMotion, [])
  const P = Math.max(2, lay.L) // плоскостей слоёв не меньше двух: слой 2 сворачивается, а не пропадает скачком

  // ---------- объекты, которые обновляются каждый кадр ----------
  const parts = useMemo(() => {
    // счета: шарики, пока грузится модель, затем силуэты людей на графитовых подставках (Props3D)
    const nodes = instanced(new THREE.SphereGeometry(0.11, 18, 12), new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.25 }), lay.acc.size)
    const bases = instanced(new THREE.CylinderGeometry(0.08, 0.086, 0.02, 28), new THREE.MeshPhysicalMaterial({ color: PAL.graphite, metalness: 0.8, roughness: 0.25, clearcoat: 1 }), lay.acc.size)
    bases.instanceColor = null
    // деньги в пути: металлические монеты; свечение берут из своего цвета, фиолет выходит за порог bloom, красное нет
    const coinMat = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.2 })
    coinMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vColor.rgb * 1.4;\n#endif') }
    const dots = instanced(new THREE.SphereGeometry(1, 12, 8), coinMat, lay.maxLog * 4)
    const bars = instanced(new THREE.BoxGeometry(0.06, 0.46, 0.06), new THREE.MeshBasicMaterial(), lay.maxLog * 2 + 8)
    const rings = instanced(new THREE.RingGeometry(0.84, 1, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false }), (lay.maxFrz + lay.maxLog) * 2)
    const cloud = instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: K.cloud, depthWrite: false }), CLOUD)
    cloud.instanceColor = null; cloud.renderOrder = -2 // фон: точки не перекрывают линии и узлы
    const tracks = new Segs(lay.tracks.length * 18 + 4, 1.5)
    const gold = new Segs(lay.maxLog * 18 + 4, 2.25)
    const red = new Segs(lay.maxLog * 20 + 4, 3.5)
    const glint = new Segs(64, 2)
    const r = rng(7)
    const g = () => { let s = 0; for (let k = 0; k < 4; k++) s += r(); return (s - 2) / 2 } // почти нормальное
    const cloudPts = Array.from({ length: CLOUD }, () => [r(), g() * 3.1, g() * 2.7, 0.018 + r() * 0.02])
    return { nodes, bases, dots, bars, rings, cloud, tracks, gold, red, glint, cloudPts }
  }, [lay])
  useEffect(() => () => {
    for (const m of [parts.nodes, parts.bases, parts.dots, parts.bars, parts.rings, parts.cloud]) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
    parts.tracks.dispose(); parts.gold.dispose(); parts.red.dispose(); parts.glint.dispose()
  }, [parts])

  // плоскость слоя: заливка + рамка + перекрестья под каждую цепочку
  const planes = useMemo(() => Array.from({ length: P + 1 }, (_, j) => {
    const { H, W, cells } = lay.g
    // слой - лист дымчатого стекла в графитовой металлической раме: блики студии скользят по нему при облёте
    const fill = new THREE.MeshPhysicalMaterial({ color: '#221E52', transparent: true, opacity: 0.42, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false, side: THREE.DoubleSide })
    // рама слоя: фиолетовый металл (акцент чуть приглушён, чтобы граница банка оставалась главной)
    const rim = new THREE.MeshPhysicalMaterial({ color: '#8F72F0', metalness: 0.9, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12, emissive: '#3A1F8C', emissiveIntensity: 0.55, transparent: true })
    const geo = new LineSegmentsGeometry()
    const pts: number[] = []
    for (const c of cells) pts.push(0, c.y - 0.12, c.z, 0, c.y + 0.12, c.z, 0, c.y, c.z - 0.12, 0, c.y, c.z + 0.12)
    geo.setPositions(pts)
    const frame = new LineMaterial({ color: K.frame.getHex(), linewidth: 1.25, transparent: true, opacity: 1, depthWrite: false })
    return { fill, rim, geo, frame, j, H, W, line: new LineSegments2(geo, frame) }
  }), [lay, P])
  useEffect(() => () => planes.forEach((p) => { p.fill.dispose(); p.rim.dispose(); p.geo.dispose(); p.frame.dispose() }), [planes])
  // граница банка: светлая фиолетовая рама и стекло с индиго-оттенком, чуть больше слоёв; над ней камера наблюдения
  const bank = useMemo(() => {
    const { H, W } = lay.g, y = H / 2 + 0.3, z = W / 2 + 0.3
    // рама границы: полированная светлая лаванда, ярче рам слоёв
    const rim = new THREE.MeshPhysicalMaterial({ color: '#B79CFF', metalness: 1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#5A2BC0', emissiveIntensity: 0.62 })
    const fill = new THREE.MeshPhysicalMaterial({ color: '#1E1A55', transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, side: THREE.DoubleSide })
    return { rim, fill, y, z }
  }, [lay])
  useEffect(() => () => { bank.rim.dispose(); bank.fill.dispose() }, [bank])
  for (const o of planes.map((p) => p.line)) o.frustumCulled = false
  const floorTex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const x = c.getContext('2d')!, g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(48,30,120,0.55)'); g.addColorStop(0.5, 'rgba(26,18,72,0.3)'); g.addColorStop(1, 'rgba(10,8,30,0)')
    x.fillStyle = g; x.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  const floorRef = useRef<THREE.Group>(null)
  const ringMat = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const pileRefs = useRef<(THREE.Group | null)[]>([])
  const propsOn = useRef(false)

  const planeRefs = useRef<(THREE.Group | null)[]>([])
  const bankRef = useRef<THREE.Group>(null)
  const exitRefs = useRef<(THREE.Group | null)[]>([])
  const hitRefs = useRef<(THREE.Mesh | null)[]>([])
  const focus = useRef<number | null>(null)
  const goneK = useRef(0)
  const room = useRef({ s: 1, x: 0, y: 0, ts: 1, tx: 0, ty: 0, at: 0, w: 0, h: 0 })
  const hover = useRef<number | null>(null)
  const Lf = useRef(lastLayers ?? lay.L)
  const cloudL = useRef(-1)
  const tracksSig = useRef('')
  const dragging = useRef(false)
  const lastTouch = useRef(0)
  const drift = useRef(0)
  const glintAt = useRef(0)
  const noteShown = useRef<number | null>(null)
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null>(null)
  const shotKey = useRef('')

  useEffect(() => { glintAt.current = performance.now() + 250 }, [lay]) // блик по рёбрам при появлении слоёв
  // шейдеры частиц, колец и красных линий собираем заранее: иначе первый вывод даёт подвисание кадра
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    for (const m of [parts.dots, parts.bars, parts.rings]) m.count = 1
    parts.gold.obj.geometry.instanceCount = 1; parts.red.obj.geometry.instanceCount = 1
    gl.compile(scene, camera)
  }, [parts, gl, scene, camera])

  // ---------- камера: планы под шаги ----------
  const shotFor = (key: string, L: number, out: { p: THREE.Vector3; t: THREE.Vector3 }) => {
    const mid = (x0Of(L) + exitXOf(L)) / 2
    // кадр под ширину: на узкой сцене камера отходит дальше
    const fit = Math.max(1, 1.38 / Math.max(0.5, camera.aspect))
    if (compact) {
      // телефон: вид почти спереди, путь денег идёт во всю ширину экрана, слои не слипаются; справа место под суммы вывода
      const k = CAM_M[key] ?? CAM_M.attack
      out.t.set(mid + k[3], -0.1, 0); out.p.set(k[0], k[1], k[2]).multiplyScalar(fit * (1 + 0.32 * Math.max(0, L - 1))).add(out.t) // длинная цепочка: камера дальше, жертвы остаются в кадре
      return out
    }
    if (key === 'wall') { const x1 = colX(1, L); out.t.set(x1 + 0.8, 0.2, 0); out.p.set(-9.6, 4.0, 9.6).multiplyScalar(fit).add(out.t) }
    else if (key === 'hole') { out.t.set(mid + 0.4, -0.3, 0); out.p.set(-2.2, 6.4, 15.2).multiplyScalar(fit).add(out.t) }
    else { out.t.set(mid + 0.5, -0.3, 0); out.p.set(-6.8, 5.6, 15.4).multiplyScalar(fit).add(out.t) }
    return out
  }
  const flyTo = (p: THREE.Vector3, t: THREE.Vector3, dur: number) => {
    const c = controls
    if (!c || reduced || dur <= 0) { camera.position.copy(p); c?.target.copy(t); camera.lookAt(t); c?.update(); anim.current = null; return }
    anim.current = { p0: camera.position.clone(), t0: c.target.clone(), p1: p.clone(), t1: t.clone(), start: performance.now(), dur }
  }

  useEffect(() => {
    const c = controls
    if (!c) return
    const on = () => { dragging.current = true; anim.current = null; lastTouch.current = performance.now() }
    const off = () => { dragging.current = false; lastTouch.current = performance.now() }
    c.addEventListener('start', on); c.addEventListener('end', off)
    return () => { c.removeEventListener('start', on); c.removeEventListener('end', off) }
  }, [controls])

  const unfocus = () => { if (focus.current != null) { focus.current = null; shotKey.current = REFOCUS } }
  miss.current = unfocus
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') unfocus() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const pick = (i: number) => {
    if (focus.current === i) { unfocus(); return }
    focus.current = i
    const c = lay.g.cells[i], L = lay.L
    const t = new THREE.Vector3((colX(0, L) + exitXOf(L)) / 2, c.y * 0.6, c.z * 0.6) // весь путь цепочки до вывода в кадре
    const off = camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).setLength(13.5 * Math.max(1, 1.38 / Math.max(0.5, camera.aspect)))
    flyTo(t.clone().add(off), t, 1000)
  }

  // ---------- кадр ----------
  const v = useMemo(() => ({
    a: new THREE.Vector3(), b: new THREE.Vector3(), p: new THREE.Vector3(), e: new THREE.Vector3(), q: new THREE.Vector3(), w: new THREE.Vector3(),
    s: new THREE.Vector3(), c: new THREE.Color(), m: new THREE.Matrix4(), one: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0),
    qs: new THREE.Quaternion(), qc: new THREE.Quaternion(), yaw: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.5), s2: new THREE.Vector3(),
    shot: { p: new THREE.Vector3(), t: new THREE.Vector3() }, accP: new Map<number, THREE.Vector3>(), exitP: [] as THREE.Vector3[],
    sums: {} as Record<string, number>, frozen: new Map<number, number>(), lastText: [] as string[], lastNote: '',
  }), [])

  useFrame((state, dt) => {
    const pr = live.current
    const { log, freezes, done, isHole } = pr
    const T_ = done ? Infinity : pr.t
    const dpr = gl.getPixelRatio()
    const now = performance.now()
    const { width: SW, height: SH } = state.size
    // подпись к точке пространства: сдвиг dx/dy задаёт, какой стороной она прилегает к точке
    const place = (el: HTMLElement | null | undefined, x: number, y: number, z: number, dx: string, dy: string, clampW = 0, fitRight = false) => {
      if (!el) return
      v.e.set(x, y, z).project(camera)
      let px = ((v.e.x + 1) / 2) * SW, py = ((1 - v.e.y) / 2) * SH
      if (clampW) { px = Math.min(SW - clampW / 2 - 12, Math.max(clampW / 2 + 12, px)); py = Math.max(py, 60) } // плашка не уходит за край сцены
      if (fitRight) px = dx === '0' ? Math.min(px, SW - el.offsetWidth - 8) : Math.max(px, el.offsetWidth / 2 + 6) // телефон: сумма у выхода не режется правым краем, подпись слоя левым
      el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) translate(${dx},${dy})`
      el.style.visibility = v.e.z < 1 ? 'visible' : 'hidden'
    }

    // телефон клиента открыт: кадр сжимается и встаёт левее телефона и ниже заметки для жюри, сцена остаётся целой
    const R = room.current
    if (now - R.at > 200) {
      R.at = now; R.ts = 1; R.tx = 0; R.ty = 0
      // [data-cover]: карточка клиента справа или текст входа слева; уже 1024 они закрывают сцену целиком
      const ph = pr.aside && !compact && window.innerWidth >= 1024 ? document.querySelector<HTMLElement>('[data-cover]') : null
      if (ph && ph.dataset.cover === 'left') {
        const cr = gl.domElement.getBoundingClientRect(), pb = ph.getBoundingClientRect()
        const x0 = pb.right - cr.left + 8
        R.ts = Math.min(1, Math.max(0.5, (SW - x0 - 8) / (SW * 0.79)))
        R.tx = (x0 + SW - 8) / 2 - SW / 2
      } else if (ph) {
        const cr = gl.domElement.getBoundingClientRect(), pb = ph.getBoundingClientRect()
        const nb = document.querySelector('.client-note')?.getBoundingClientRect()
        const x1 = pb.left - cr.left - 8, y0 = nb ? Math.max(0, nb.bottom - cr.top) : 0
        R.ts = Math.min(1, Math.max(0.5, Math.min((x1 - 8) / (SW * 0.88), (SH - y0) / (SH * 0.9)))) // сцена с подписями выхода занимает около 88% ширины и 90% высоты кадра
        R.tx = (8 + x1) / 2 - SW / 2 + 0.02 * SW * R.ts; R.ty = (y0 + SH) / 2 - SH / 2
        // подписи выходов не сжимаются вместе со сценой: сверяем их правый край с карточкой по факту, чтобы «Другой банк» не уходил под неё
        const hd = dom.current.head[0], hb = hd?.getBoundingClientRect()
        let ea = -Infinity, lw = 0
        for (let k = 0; k < lay.exits.length; k++) { const b = dom.current.exit[k]?.getBoundingClientRect(); if (b) { ea = Math.max(ea, b.left - cr.left); lw = Math.max(lw, b.width) } }
        if (hb && lw && R.s > 0) {
          const un = (px: number) => (px - SW / 2 - R.x) / R.s + SW / 2 // где точка стояла бы без сжатия кадра
          const h0 = un(hb.left + hb.width / 2 - cr.left), span = un(ea) - h0
          if (span > 50) {
            const edge = 0.1 * SW // плоскость жертв в перспективе выступает левее своей подписи: оставляем ей место, чтобы угол не резался краем
            R.ts = Math.min(R.ts, Math.max(0.42, (x1 - 8 - lw - hb.width / 2) / (span + edge)))
            const pad = Math.max(0, (x1 - 8 - (span + edge) * R.ts - lw - hb.width / 2) / 2)
            R.tx = 8 + edge * R.ts + pad + hb.width / 2 - SW / 2 - (h0 - SW / 2) * R.ts
          }
        }
      }
    }
    if (R.s !== R.ts || R.x !== R.tx || R.y !== R.ty || R.w !== SW || R.h !== SH) {
      const k = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 6)
      R.s += (R.ts - R.s) * k; R.x += (R.tx - R.x) * k; R.y += (R.ty - R.y) * k
      if (Math.abs(R.ts - R.s) < 0.002 && Math.abs(R.tx - R.x) < 0.5 && Math.abs(R.ty - R.y) < 0.5) { R.s = R.ts; R.x = R.tx; R.y = R.ty }
      R.w = SW; R.h = SH
      if (R.s === 1 && R.x === 0 && R.y === 0) camera.clearViewOffset()
      else camera.setViewOffset(SW, SH, SW / 2 - (SW / 2 + R.x) / R.s, SH / 2 - (SH / 2 + R.y) / R.s, SW / R.s, SH / R.s)
    }

    // длина цепочек плавно идёт к числу слоёв текущей схемы
    const target = lay.L
    if (reduced) Lf.current = target
    else { Lf.current += (target - Lf.current) * (1 - Math.exp(-Math.min(dt, 0.05) * 2.6)); if (Math.abs(target - Lf.current) < 0.002) Lf.current = target }
    lastLayers = target
    const L = Lf.current

    // план камеры: атака, дыра (цепочки короче) или стена остановок (при мере ничего не дошло до вывода)
    const wall = isHole && !log.some((e) => e.kind === 'cashout' && e.status === 'ok')
    const key = `${sc.scheme.key}|${isHole ? (wall ? 'wall' : 'hole') : 'attack'}`
    if (controls && focus.current == null && key !== shotKey.current) {
      const first = shotKey.current === ''
      shotKey.current = key
      shotFor(key.split('|')[1], target, v.shot)
      flyTo(v.shot.p, v.shot.t, first ? 0 : FLY_MS)
    }
    if (anim.current && controls) {
      const A = anim.current, k = ease(Math.min(1, (now - A.start) / A.dur))
      camera.position.lerpVectors(A.p0, A.p1, k); controls.target.lerpVectors(A.t0, A.t1, k); camera.lookAt(controls.target)
      if (k >= 1) anim.current = null
    }
    if (controls) {
      // во время атаки облёт от трёх четвертей к боковому виду: к концу видна вся длина пути
      controls.autoRotate = pr.playing && !reduced && !anim.current && !dragging.current && focus.current == null
      controls.autoRotateSpeed = -0.4
      // в покое едва заметное дыхание камеры; после касания мыши ждём 3 с
      const d = DRIFT * 0.5 * Math.sin((now / 16000) * Math.PI * 2)
      const idle = !pr.playing && !reduced && !anim.current && !dragging.current && focus.current == null && now - lastTouch.current > 3000
      if (idle) {
        camera.position.sub(controls.target).applyAxisAngle(v.up, d - drift.current).add(controls.target)
        camera.lookAt(controls.target)
      }
      drift.current = d
    }

    // плоскости и граница банка
    for (let j = 0; j <= P; j++) {
      const g = planeRefs.current[j], pl = planes[j]
      const vis = j === 0 ? 1 : Math.min(1, Math.max(0, L - j + 1))
      if (g) { g.position.x = colX(j, L); g.visible = vis > 0.01 }
      pl.fill.opacity = 0.42 * vis; pl.rim.opacity = vis; pl.frame.opacity = vis; pl.frame.linewidth = 1.25 * dpr
      const h = dom.current.head[j]
      if (h) { h.style.opacity = String(vis < 0.6 ? 0 : (vis - 0.6) / 0.4); place(h, colX(j, L), lay.g.H / 2 + 0.3, 0, '-50%', '-100%', 0, compact && j === 0) }
    }
    const bx = bankX(L)
    if (bankRef.current) bankRef.current.position.x = bx
    floorRef.current?.position.set((x0Of(L) + exitXOf(L)) / 2, -bank.y - 0.75, 0)
    place(dom.current.bank, bx, -bank.y - 0.2, 0, '-50%', '0') // под рамкой: заголовки слоёв сверху, подпись границы снизу, не пересекаются
    const ex = exitXOf(L)
    lay.exits.forEach((x, k) => {
      exitRefs.current[k]?.position.set(ex, x.y, 0)
      ;(v.exitP[k] ??= new THREE.Vector3()).set(ex, x.y, 0)
    })

    // блик: светлая лаванда один раз проходит по верхнему ребру каждой плоскости
    if (!reduced) {
      const edges = [...planes.map((p, j) => ({ x: colX(j, L), y: lay.g.H / 2, z: lay.g.W / 2, on: j === 0 || L - j + 1 > 0.5 })), { x: bx, y: bank.y, z: bank.z, on: true }]
      edges.forEach((ed, i) => {
        const k = (now - glintAt.current - i * 110) / GLINT_MS
        if (k < 0 || k > 1 || !ed.on) return
        const head = ease(k) * 1.3, fade = Math.sin(Math.PI * k)
        for (let s = 0; s < 6; s++) {
          const u0 = Math.min(1, Math.max(0, head - 0.3 + (s * 0.3) / 6)), u1 = Math.min(1, Math.max(0, head - 0.3 + ((s + 1) * 0.3) / 6))
          if (u1 <= u0) continue
          v.a.set(ed.x, ed.y, -ed.z + 2 * ed.z * u0); v.b.set(ed.x, ed.y, -ed.z + 2 * ed.z * u1)
          parts.glint.push(v.a, v.b, v.c.copy(K.head).lerp(K.bg, 1 - fade * ((s + 1) / 6)))
        }
      })
    }
    parts.glint.commit(dpr)

    // облако честных клиентов: внутри банка, перестраивается только при смене длины
    if (Math.abs(cloudL.current - L) > 0.001) {
      cloudL.current = L
      const xa = x0Of(L) - 1.6, xb = bx - 0.25
      parts.cloudPts.forEach(([u, y, z, s], i) => {
        v.p.set(xa + u * (xb - xa), y, z); v.s.setScalar(s)
        parts.cloud.setMatrixAt(i, v.m.compose(v.p, v.one, v.s))
      })
      parts.cloud.count = CLOUD; parts.cloud.instanceMatrix.needsUpdate = true
    }

    // позиции счетов
    for (const [id, a] of lay.acc) {
      let p = v.accP.get(id)
      if (!p) { p = new THREE.Vector3(); v.accP.set(id, p) }
      accPos(lay, a, L, p)
    }
    const markI = pr.mark != null ? sc.chains.findIndex((c) => c.id === pr.mark) : -1
    const goneI = pr.gone != null ? sc.chains.findIndex((c) => c.id === pr.gone) : -1
    goneK.current = goneI < 0 ? 0 : reduced ? 1 : Math.min(1, goneK.current + dt / 0.9) // за 900 мс фиолет возвращается к клиенту, цепочка гаснет
    const back = 1 - ease(goneK.current)
    const dim = (ci: number) => {
      const k = focus.current != null ? (ci === focus.current ? 1 : 0.14) : hover.current != null ? (ci === hover.current ? 1 : 0.3) : markI >= 0 ? (ci === markI ? 1 : 0.32) : 1
      return ci === goneI ? k * (1 - 0.92 * ease(goneK.current)) : k
    }
    const tint = (base: THREE.Color, k: number) => v.c.copy(base).lerp(K.bg, 1 - k)

    // точка на пути перевода: прямая между слоями; к выводу - дуга до границы банка, затем хвост к узлу
    const crossing = (A: THREE.Vector3, E: THREE.Vector3, out: THREE.Vector3) => out.set(bx, A.y + (E.y - A.y) * 0.55, A.z + (E.z - A.z) * 0.55)
    const onCurve = (A: THREE.Vector3, Pp: THREE.Vector3, u: number, out: THREE.Vector3) => {
      const cx = A.x + (Pp.x - A.x) * 0.55, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u
      return out.set(w0 * A.x + w1 * cx + w2 * Pp.x, w0 * A.y + w1 * A.y + w2 * Pp.y, w0 * A.z + w1 * A.z + w2 * Pp.z)
    }
    const draw = (s: Segs, f: (u: number, o: THREE.Vector3) => THREE.Vector3, u1: number, steps: number, c: THREE.Color) => {
      if (u1 <= 0) return
      const n = Math.max(1, Math.ceil(u1 * steps))
      f(0, v.q)
      for (let i = 1; i <= n; i++) { f((u1 * i) / n, v.w); s.push(v.q, v.w, c); v.q.copy(v.w) }
    }

    // дорожки: все пути схемы во всех прогонах, тонко и тихо
    const tsig = `${L.toFixed(3)}|${focus.current}|${hover.current}|${markI}|${goneI}|${goneK.current.toFixed(2)}`
    if (tsig !== tracksSig.current) {
      tracksSig.current = tsig
      for (const [s, d] of lay.tracks) {
        const A = v.accP.get(s)!, c = tint(K.track, dim(lay.acc.get(s)!.chain))
        const B = v.accP.get(d)
        if (B) { parts.tracks.push(A, B, c); continue }
        const E = v.exitP[lay.exits.findIndex((x) => x.key === lay.exitOf.get(d))]
        if (!E) continue
        const Pp = crossing(A, E, new THREE.Vector3())
        draw(parts.tracks, (u, o) => onCurve(A, Pp, u, o), 1, 14, c); parts.tracks.push(Pp, E, c)
      }
      parts.tracks.commit(dpr)
    }

    // заморозки к этому моменту
    v.frozen.clear()
    for (const f of freezes) if (f.t <= T_ && !v.frozen.has(f.id)) v.frozen.set(f.id, f.t)

    let np = 0, nb = 0, nr = 0
    const camQ = camera.quaternion
    const on = propsOn.current
    // монета смотрит в камеру и вращается вокруг вертикали: блик студии пробегает по ребру
    const putDot = (p: THREE.Vector3, s: number, c: THREE.Color) => {
      if (on) { v.qs.setFromAxisAngle(v.up, now / 380 + p.x * 1.7); v.qc.copy(camQ).multiply(v.qs); v.s.setScalar(s * 2.5) } else v.s.setScalar(s)
      parts.dots.setMatrixAt(np, v.m.compose(p, on ? v.qc : v.one, v.s)); parts.dots.setColorAt(np++, c)
    }
    const putBar = (p: THREE.Vector3, c: THREE.Color) => { v.s.setScalar(1); parts.bars.setMatrixAt(nb, v.m.compose(p, camQ, v.s)); parts.bars.setColorAt(nb++, c) }
    const putRing = (p: THREE.Vector3, r: number, c: THREE.Color) => { v.s.setScalar(r); parts.rings.setMatrixAt(nr, v.m.compose(p, camQ, v.s)); parts.rings.setColorAt(nr++, c) }
    for (const k in v.sums) v.sums[k] = 0

    for (const e of log) {
      if (e.t > T_) continue
      const a = lay.acc.get(e.src); if (!a) continue
      const A = v.accP.get(e.src)!
      const mine = a.chain === goneI && a.col === 0 // отменённый перевод клиента
      const kd = mine ? Math.max(dim(a.chain), back > 0 ? 1 : 0) : dim(a.chain)
      const stopped = STOP.has(e.status)
      if (e.status === 'frozen_src' && v.frozen.has(e.src)) continue // деньги с замороженного счёта не ушли
      const exitK = lay.exitOf.get(e.dst)
      const isOut = exitK != null && !lay.acc.has(e.dst)
      const atFrozen = stopped && !isOut && v.frozen.has(e.dst)
      const end = stopped ? (isOut ? 0 : atFrozen ? 1 : 0.9) : 1
      const p = T_ === Infinity ? 1 : ease((T_ - e.t) / LINE_MIN)
      const arrived = p >= 1
      const okOut = isOut && !stopped
      let f: (u: number, o: THREE.Vector3) => THREE.Vector3
      let E: THREE.Vector3 | undefined, Pp: THREE.Vector3 | undefined
      if (isOut) {
        E = v.exitP[lay.exits.findIndex((x) => x.key === exitK)]; if (!E) continue
        const A0 = A, P0 = crossing(A, E, new THREE.Vector3())
        Pp = P0
        f = (u, o) => onCurve(A0, P0, u, o)
      } else {
        const B = v.accP.get(e.dst); if (!B) continue
        f = (u, o) => o.lerpVectors(A, B, u)
      }
      if (end > 0) {
        // в пути фиолет, дошедшее остаётся следом в 35%, ушедшее за границу красное
        const trail = mine && back < 1 ? 1 : a.chain === markI ? 0.9 : 0.35 // цепочка перевода клиента заметнее остальных
        const c = okOut && arrived ? tint(K.leak, kd) : arrived ? tint(K.money, trail * kd) : tint(K.money, kd)
        draw(okOut && arrived ? parts.red : parts.gold, f, p * end * (mine ? back : 1), isOut ? 14 : 1, c)
        if (mine && back < 1 && back > 0) putDot(f(p * end * back, v.b), 0.085, K.head)
      }
      if (!arrived && end > 0) {
        // головка лавандой, за ней два фиолетовых шага
        ;[0, 0.035, 0.07].forEach((d, i) => { const u = p * end - d; if (u >= 0) putDot(f(u, v.b), [0.085, 0.062, 0.045][i], tint(i ? K.money : K.head, kd)) })
      }
      if (okOut && arrived && E && Pp) {
        // граница пройдена: красная черта на плоскости банка, хвост долетает до вывода
        v.sums[exitK!] = (v.sums[exitK!] ?? 0) + e.amount
        putBar(Pp, tint(K.leak, kd))
        const q = T_ === Infinity ? 1 : ease((T_ - e.t - LINE_MIN) / TAIL_MIN)
        const P0 = Pp, E0 = E
        draw(parts.red, (u, o) => o.lerpVectors(P0, E0, u), q, 1, tint(K.leak, kd))
        if (q < 1) putDot(v.b.lerpVectors(P0, E0, q), 0.08, tint(K.leak, kd))
      }
      if (stopped && arrived && !atFrozen && !(mine && back < 1)) {
        const head = isOut ? v.b.copy(A).add(v.e.set(0.35, 0, 0)) : f(0.9, v.b)
        putBar(head, tint(K.stop, kd))
        const age = T_ === Infinity ? Infinity : T_ - e.t - LINE_MIN
        if (age < FLASH_MIN) { const k = age / FLASH_MIN; putRing(head, 0.16 + 0.42 * ease(k), tint(K.stop, (1 - k) * kd)) }
      }
    }

    // счета: нейтральные, замороженный зеленеет, вокруг кольцо; в момент заморозки кольцо расходится и гаснет
    let i = 0
    for (const [id, a] of lay.acc) {
      const saved = a.chain === goneI && a.col === 0 // клиент отменил: его счёт остаётся светлым, деньги при нём
      const P0 = v.accP.get(id)!, kd = saved ? 1 : a.chain === goneI ? Math.max(dim(a.chain), 0.3) : dim(a.chain), ft = v.frozen.get(id)
      const sz = saved ? 1 + 0.25 * (1 - back) : 1
      if (on) {
        // человек стоит на подставке, грудь на уровне точки счёта: пути денег входят в фигуру
        v.p.set(P0.x, P0.y - 0.25 * sz, P0.z); v.s.setScalar(0.5 * sz)
        parts.nodes.setMatrixAt(i, v.m.compose(v.p, v.yaw, v.s))
        parts.bases.setMatrixAt(i, v.m.compose(v.p, v.one, v.s2.setScalar(sz)))
      } else { v.s.setScalar(sz); parts.nodes.setMatrixAt(i, v.m.compose(P0, v.one, v.s)) }
      parts.nodes.setColorAt(i++, saved ? v.c.copy(K.node).lerp(K.head, 1 - back) : tint(ft != null ? K.stop : K.node, kd))
      if (saved && back < 0.45 && goneK.current < 1) { const k = 1 - back / 0.45; putRing(P0, 0.15 + 0.17 * ease(k), tint(K.head, 0.7 * (1 - k))) }
      if (ft != null) {
        putRing(P0, 0.24, tint(K.stop, kd))
        const age = T_ === Infinity ? Infinity : T_ - ft
        if (age < FLASH_MIN) { const k = age / FLASH_MIN; putRing(P0, 0.24 + 0.5 * ease(k), tint(K.stop, (1 - k) * kd)) }
      }
    }
    parts.nodes.count = i; parts.bases.count = on ? i : 0; parts.bases.instanceMatrix.needsUpdate = true; parts.dots.count = np; parts.bars.count = nb; parts.rings.count = nr
    for (const m of [parts.nodes, parts.dots, parts.bars, parts.rings]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true }
    parts.gold.commit(dpr); parts.red.commit(dpr)

    // узлы вывода и суммы у них: только то, что пересекло границу
    lay.exits.forEach((x, k) => {
      const sum = v.sums[x.key] ?? 0
      // кант подставки краснеет, когда через канал ушли деньги; кучка монет растёт с суммой
      const rm = ringMat.current[k]
      if (rm) { rm.emissive.copy(sum ? K.leak : K.bg); rm.emissiveIntensity = sum ? 2.2 : 0; rm.color.copy(sum ? K.leak : K.track) }
      const pile = pileRefs.current[k]
      if (pile) { const ps = sum ? 0.45 + 0.55 * Math.min(1, Math.sqrt(sum / 4e6)) : 0; pile.scale.setScalar(Math.max(1e-3, ps)); pile.visible = ps > 0 }
      place(dom.current.exit[k], ex + (compact ? 0.55 : 0.72), x.y, 0, '0', '-50%', 0, compact) // на телефоне подпись ближе: справа нет места
      const txt = sum ? kzt(sum) : '0 ₸'
      const el = dom.current.exitSum[k]
      if (el && v.lastText[k] !== txt) { v.lastText[k] = txt; el.textContent = txt; el.style.color = sum ? T.risk : T.muted }
    })

    // полосы для клика и наведения на цепочку
    lay.g.cells.forEach((c, ci) => {
      const h = hitRefs.current[ci]; if (!h) return
      const xa = colX(0, L) - 0.4, xb = colX(lay.L, L) + 0.4
      h.position.set((xa + xb) / 2, c.y, c.z); h.scale.set(xb - xa, 1, 1)
    })

    // плашка цепочки (выбранной или под курсором): появление 160 мс, уход 100 мс (п. 10)
    const out = dom.current.note, inn = dom.current.noteIn
    if (out && inn) {
      const fi = focus.current ?? hover.current
      if (fi !== noteShown.current) {
        noteShown.current = fi
        inn.style.transition = fi != null ? 'opacity 160ms cubic-bezier(0.16,1,0.3,1), transform 160ms cubic-bezier(0.16,1,0.3,1)' : 'opacity 100ms cubic-bezier(0.4,0,1,1), transform 100ms cubic-bezier(0.4,0,1,1)'
        inn.style.opacity = fi != null ? '1' : '0'
        inn.style.transform = fi != null ? 'translateY(0)' : 'translateY(4px)'
      }
      if (fi != null) {
        const c = lay.g.cells[fi], id = sc.chains[fi].id
        place(out, colX(lay.L, L), c.y + 0.4, c.z, '-50%', '-100%', inn.offsetWidth || 1)
        let sOut = 0, sStop = 0
        for (const e of log) if (e.chain === id && e.t <= T_) {
          if (e.kind === 'cashout' && e.status === 'ok' && (T_ === Infinity || e.t + LINE_MIN <= T_)) sOut += e.amount
          if (STOP.has(e.status)) sStop += e.amount
        }
        const html = `Цепочка ${fi + 1}: выведено <b style="color:${T.risk};font-weight:600">${kzt(sOut)}</b>, остановлено <b style="color:${T.emerald};font-weight:600">${kzt(sStop)}</b>`
        if (v.lastNote !== html) { v.lastNote = html; inn.innerHTML = html }
      }
    }
  })

  return (
    <>
      <Suspense fallback={null}><Studio /></Suspense>
      <Soft><Suspense fallback={null}><Swap parts={parts} on={propsOn} /></Suspense></Soft>
      <ambientLight intensity={0.8} />
      <directionalLight position={[-4, 8, 6]} intensity={1.1} color="#F3EEFF" />
      <group ref={floorRef}>
        <mesh rotation-x={-Math.PI / 2} renderOrder={-3}><circleGeometry args={[15, 64]} /><meshBasicMaterial map={floorTex} transparent depthWrite={false} /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.01} scale={[1.6, 0.7, 1]} renderOrder={-3}><circleGeometry args={[6, 48]} /><meshBasicMaterial map={blobTexture()} transparent opacity={0.55} depthWrite={false} /></mesh>
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} enablePan={false} minDistance={5} maxDistance={34}
        maxPolarAngle={Math.PI * 0.64} minPolarAngle={Math.PI * 0.08} />

      <primitive object={parts.cloud} />
      {planes.map((pl) => (
        <group key={pl.j} ref={(g) => { planeRefs.current[pl.j] = g }}>
          <mesh rotation={[0, Math.PI / 2, 0]} material={pl.fill} renderOrder={-1}><planeGeometry args={[lay.g.W, lay.g.H]} /></mesh>
          <Frame H={pl.H} W={pl.W} t={0.045} mat={pl.rim} />
        </group>
      ))}
      <group ref={bankRef}>
        <mesh rotation={[0, Math.PI / 2, 0]} material={bank.fill} renderOrder={-1}><planeGeometry args={[bank.z * 2, bank.y * 2]} /></mesh>
        <Frame H={bank.y * 2} W={bank.z * 2} t={0.085} mat={bank.rim} />
        <group position={[0, bank.y + 0.04, bank.z - 0.45]} rotation-y={Math.PI / 2}><Soft><Suspense fallback={null}><BankCamera /></Suspense></Soft></group>
      </group>
      <primitive object={parts.bases} />
      <primitive object={parts.tracks.obj} />
      <primitive object={parts.glint.obj} />
      <primitive object={parts.gold.obj} />
      <primitive object={parts.red.obj} />
      <primitive object={parts.nodes} />
      <primitive object={parts.dots} />
      <primitive object={parts.bars} />
      <primitive object={parts.rings} />

      {lay.exits.map((x, k) => (
        <group key={x.key} ref={(g) => { exitRefs.current[k] = g }}>
          <group position-y={-0.6} scale={1.22}>
            <Plinth ring={(m) => { ringMat.current[k] = m }} />
            <Soft><Suspense fallback={null}>
              <ExitProp kind={x.key} />
              <group ref={(g) => { pileRefs.current[k] = g }} position={[0.18, 0, 0.2]} visible={false}><Pile /></group>
            </Suspense></Soft>
          </group>
        </group>
      ))}

      {lay.g.cells.map((_, ci) => (
        <mesh key={ci} ref={(m) => { hitRefs.current[ci] = m }}
          onClick={(e) => { e.stopPropagation(); pick(ci) }}
          onPointerOver={(e) => { e.stopPropagation(); hover.current = ci; document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { if (hover.current === ci) hover.current = null; document.body.style.cursor = '' }}>
          <boxGeometry args={[1, 0.8, 0.8]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  )
}

// рама слоя: четыре металлических бруска по периметру листа
function Frame({ H, W, t, mat }: { H: number; W: number; t: number; mat: THREE.Material }) {
  return (
    <group>
      <mesh material={mat} position={[0, H / 2, 0]}><boxGeometry args={[t, t, W + t]} /></mesh>
      <mesh material={mat} position={[0, -H / 2, 0]}><boxGeometry args={[t, t, W + t]} /></mesh>
      <mesh material={mat} position={[0, 0, W / 2]}><boxGeometry args={[t, H - t, t]} /></mesh>
      <mesh material={mat} position={[0, 0, -W / 2]}><boxGeometry args={[t, H - t, t]} /></mesh>
    </group>
  )
}

function Pile() { return <primitive object={usePile()} /> }

// модели загрузились: шарики счетов становятся людьми, точки денег - монетами
// Модель не догрузилась (сеть на телефоне): сцена остаётся, пропадает только этот предмет, счета рисуются шариками
class Soft extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

function Swap({ parts, on }: { parts: { nodes: THREE.InstancedMesh; dots: THREE.InstancedMesh }; on: { current: boolean } }) {
  const person = usePersonGeometry(), coin = useCoinGeometry()
  useEffect(() => {
    const a = parts.nodes.geometry, b = parts.dots.geometry
    parts.nodes.geometry = person; parts.dots.geometry = coin; on.current = true
    return () => { parts.nodes.geometry = a; parts.dots.geometry = b; on.current = false }
  }, [parts, person, coin, on])
  return null
}
