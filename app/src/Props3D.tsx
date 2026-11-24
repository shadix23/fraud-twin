import { useMemo } from 'react'
import { Environment, Lightformer, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

// Открытые модели и студийный свет сцены. Авторы и лицензии: app/CREDITS.md.
// Все файлы локальные (public/models), сжаты meshopt + webp: площадка без интернета.

const M = (f: string) => `${import.meta.env.BASE_URL}models/${f}`
export const MODELS = { atm: M('atm.glb'), server: M('server.glb'), laptop: M('laptop.glb'), camera: M('camera.glb'), coin: M('coin.glb'), pile: M('coinpiles.glb'), man: M('man.glb') }
for (const u of Object.values(MODELS)) useGLTF.preload(u, false)

// v20, сцена на светлом (бриф v20, п. «3D-сцена на светлом»): один матовый материал, один свет, без свечения.
// graphite - фигуры и детали, clay - банкомат, сервер, подставки; brand и leak - только по смыслу
export const PAL = { graphite: '#2A2A30', clay: '#C8C8CF', ringRest: '#B9B9C2', brandDot: '#7B6BE8', leakDot: '#F0564A', stopDot: '#3DB86B' }

// ---------- свет: белые софтбоксы, без фона и цветных акцентов ----------
// Окружение рендерится один раз и даёт мягкие блики матовым поверхностям; фон холста прозрачный, его даёт белая плита
export function Studio() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.9}>
      <Lightformer form="rect" intensity={2} color="#FFFFFF" position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[22, 9, 1]} />
      <Lightformer form="rect" intensity={1.2} color="#FFFFFF" position={[-8, 1.5, 3]} rotation-y={Math.PI / 2} scale={[5, 12, 1]} />
      <Lightformer form="rect" intensity={0.8} color="#FFFFFF" position={[8, 1, -2]} rotation-y={-Math.PI / 2} scale={[3, 12, 1]} />
      <Lightformer form="rect" intensity={1} color="#FFFFFF" position={[2, 1, 8]} scale={[14, 4, 1]} />
    </Environment>
  )
}

// ---------- материалы ----------
export const matte = (color: string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })

// модель вписывается в высоту h, основание на y = 0, центр по x/z
function fit(obj: THREE.Object3D, h: number) {
  obj.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(obj), s = new THREE.Vector3(), c = new THREE.Vector3()
  b.getSize(s); b.getCenter(c)
  const k = h / Math.max(1e-6, s.y)
  const g = new THREE.Group(); obj.position.set(-c.x, -b.min.y, -c.z); g.add(obj); g.scale.setScalar(k)
  return g
}

// low-poly модели перекрашиваются в два тона: светлое и среднее - глина, тёмное и экраны - графит. Свечения нет
function restyle(root: THREE.Object3D) {
  const cache = new Map<THREE.Material, THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pick = (src: THREE.Material) => {
      if (cache.has(src)) return cache.get(src)!
      const c = ((src as THREE.MeshStandardMaterial).color ?? new THREE.Color('#888')).clone()
      const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl)
      const screen = hsl.s > 0.35 && hsl.h > 0.3 && hsl.h < 0.75
      const out = screen || hsl.l <= 0.22 ? matte(PAL.graphite, 0.5) : matte(PAL.clay, 0.62)
      cache.set(src, out); return out
    }
    m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material)
  })
  return root
}

function useModel(url: string, h: number, paint: boolean) {
  const g = useGLTF(url, false)
  return useMemo(() => { const o = g.scene.clone(true); if (paint) restyle(o); return fit(o, h) }, [g, h, paint])
}

// подставка узла вывода: глиняный диск с кольцом; кольцо меняет цвет по состоянию (покой, через канал ушли деньги)
export function Plinth({ r = 0.42, ring }: { r?: number; ring?: (m: THREE.MeshStandardMaterial | null) => void }) {
  return (
    <group>
      <mesh position-y={-0.03}><cylinderGeometry args={[r, r * 1.04, 0.06, 48]} /><meshStandardMaterial color={PAL.clay} roughness={0.62} metalness={0} /></mesh>
      <mesh position-y={0.004} rotation-x={-Math.PI / 2}><torusGeometry args={[r * 0.98, 0.022, 10, 64]} /><meshStandardMaterial ref={ring} color={PAL.ringRest} roughness={0.6} metalness={0} /></mesh>
    </group>
  )
}

// узел вывода: модель по каналу
export function ExitProp({ kind }: { kind: string }) {
  const atm = useModel(MODELS.atm, 0.9, true)
  const server = useModel(MODELS.server, 0.95, true)
  const laptop = useModel(MODELS.laptop, 0.44, true)
  const o = kind === 'atm' ? atm : kind === 'crypto' ? laptop : server
  return <primitive object={o} rotation-y={kind === 'crypto' ? -Math.PI / 2.6 : -Math.PI / 2.3} />
}

// кучка монет на подставке вывода: растёт с выведенной суммой; монеты за границей банка матовые leak-dot
function usePaint(o: THREE.Object3D, color: string) {
  return useMemo(() => { const m = matte(color, 0.55); o.traverse((x) => { const y = x as THREE.Mesh; if (y.isMesh) y.material = m }); return o }, [o, color])
}
export function usePile() { return usePaint(useModel(MODELS.pile, 0.22, false), PAL.leakDot) }

// камера наблюдения на границе банка: глина с графитом, как остальные предметы
export function BankCamera() {
  const o = useModel(MODELS.camera, 0.42, true)
  return <primitive object={o} />
}

// ---------- геометрии для инстансов ----------
// монета Quaternius: плоской стороной к оси z, диаметр 1
export function useCoinGeometry() {
  const g = useGLTF(MODELS.coin, false)
  return useMemo(() => {
    const geos: THREE.BufferGeometry[] = []
    g.scene.updateMatrixWorld(true)
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const x = m.geometry.clone(); x.applyMatrix4(m.matrixWorld); for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k); geos.push(x) } })
    const geo = mergeGeometries(geos.map((x) => x.index ? x.toNonIndexed() : x))!
    geo.computeBoundingBox()
    const s = new THREE.Vector3(); geo.boundingBox!.getSize(s)
    const c = new THREE.Vector3(); geo.boundingBox!.getCenter(c); geo.translate(-c.x, -c.y, -c.z)
    if (s.y <= s.x && s.y <= s.z) geo.rotateX(Math.PI / 2); else if (s.x <= s.y && s.x <= s.z) geo.rotateY(Math.PI / 2)
    geo.computeBoundingBox(); geo.boundingBox!.getSize(s)
    geo.scale(1 / Math.max(s.x, s.y), 1 / Math.max(s.x, s.y), 1 / Math.max(s.x, s.y))
    return geo
  }, [g])
}

// силуэт человека: поза Idle из скелета запекается в одну статичную геометрию, высота 1, ступни на y = 0
export function usePersonGeometry() {
  const g = useGLTF(MODELS.man, false)
  return useMemo(() => {
    const root = cloneSkinned(g.scene)
    const clip = g.animations.find((a) => /idle/i.test(a.name)) ?? g.animations[0]
    if (clip) { const mx = new THREE.AnimationMixer(root); mx.clipAction(clip).play(); mx.update(0.35) }
    root.updateMatrixWorld(true)
    const geos: THREE.BufferGeometry[] = []
    const v = new THREE.Vector3()
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isMesh) return
      const src = m.geometry, pos = src.attributes.position
      if (m.isSkinnedMesh) m.skeleton.update()
      const arr = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        if (m.isSkinnedMesh) m.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i)
        v.applyMatrix4(m.matrixWorld); arr.set([v.x, v.y, v.z], i * 3)
      }
      const x = new THREE.BufferGeometry(); x.setAttribute('position', new THREE.BufferAttribute(arr, 3))
      if (src.index) x.setIndex(src.index.clone())
      geos.push(x.index ? x.toNonIndexed() : x)
    })
    const geo = mergeGeometries(geos)!
    geo.computeBoundingBox()
    const b = geo.boundingBox!, s = new THREE.Vector3(); b.getSize(s)
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
    geo.scale(1 / s.y, 1 / s.y, 1 / s.y)
    geo.computeVertexNormals()
    return geo
  }, [g])
}
