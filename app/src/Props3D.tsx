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

export const PAL = { ivory: '#E8E5F5', bronze: '#7B5CE0', gold: '#A855F7', champagne: '#D6C4FF', graphite: '#17152E', emerald: '#1FCFAE' }

// ---------- свет: студия из софтбоксов вместо ламп ----------
// Отражения в металле и стекле дают Lightformer-ы: широкий верх, узкие боковые, фиолетово-маджентовый акцент. Рендер окружения один раз.
export function Studio() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={1.25}>
      <color attach="background" args={['#1A1640']} />
      <Lightformer form="rect" intensity={2.4} color="#F1EFFA" position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[22, 9, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#F1EFFA" position={[-8, 1.5, 3]} rotation-y={Math.PI / 2} scale={[5, 12, 1]} />
      <Lightformer form="rect" intensity={1.1} color="#CFC8F2" position={[8, 1, -2]} rotation-y={-Math.PI / 2} scale={[3, 12, 1]} />
      <Lightformer form="rect" intensity={2.0} color="#B88CFF" position={[2, 0, 8]} scale={[14, 1.6, 1]} />
      {/* фиолетовая свет-полоса: узкий софтбокс, даёт рамам и монетам металлический блик акцента */}
      <Lightformer form="rect" intensity={3.2} color="#D49BFF" position={[-3, 4.5, 6]} rotation-x={-Math.PI / 5} scale={[18, 0.7, 1]} />
      <Lightformer form="rect" intensity={1.0} color="#B88CFF" position={[0, 2, -8]} rotation-y={Math.PI} scale={[10, 3, 1]} />
    </Environment>
  )
}

// ---------- материалы ----------
export const metal = (color: string, roughness = 0.3) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, clearcoat: 0.4, clearcoatRoughness: 0.2 })

// мягкая тень-пятно: дешевле теневых карт, держит предметы на подставках
let blobTex: THREE.Texture | null = null
export function blobTexture() {
  if (blobTex) return blobTex
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.45, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}

// модель вписывается в высоту h, основание на y = 0, центр по x/z
function fit(obj: THREE.Object3D, h: number) {
  obj.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(obj), s = new THREE.Vector3(), c = new THREE.Vector3()
  b.getSize(s); b.getCenter(c)
  const k = h / Math.max(1e-6, s.y)
  const g = new THREE.Group(); obj.position.set(-c.x, -b.min.y, -c.z); g.add(obj); g.scale.setScalar(k)
  return g
}

// low-poly модели перекрашиваются в палитру по яркости исходного цвета: светлое - слоновая кость, среднее - бронза, тёмное - графит
function restyle(root: THREE.Object3D) {
  const cache = new Map<THREE.Material, THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pick = (src: THREE.Material) => {
      if (cache.has(src)) return cache.get(src)!
      const c = ((src as THREE.MeshStandardMaterial).color ?? new THREE.Color('#888')).clone()
      const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl)
      let out: THREE.Material
      if (hsl.s > 0.35 && hsl.h > 0.3 && hsl.h < 0.75) out = new THREE.MeshStandardMaterial({ color: '#120D2E', emissive: PAL.gold, emissiveIntensity: 0.55, roughness: 0.2 }) // экран
      else if (hsl.l > 0.55) out = new THREE.MeshPhysicalMaterial({ color: PAL.ivory, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.15 })
      else if (hsl.l > 0.22) out = metal(PAL.bronze, 0.32)
      else out = new THREE.MeshPhysicalMaterial({ color: PAL.graphite, metalness: 0.6, roughness: 0.35, clearcoat: 0.5 })
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

// подставка узла вывода: графитовый диск с бронзовым кантом, тень-пятно на нём
export function Plinth({ r = 0.42, ring }: { r?: number; ring?: (m: THREE.MeshStandardMaterial | null) => void }) {
  const tex = blobTexture()
  return (
    <group>
      <mesh position-y={-0.03}><cylinderGeometry args={[r, r * 1.04, 0.06, 48]} /><meshPhysicalMaterial color={PAL.graphite} metalness={0.7} roughness={0.28} clearcoat={0.8} /></mesh>
      <mesh position-y={-0.002} rotation-x={-Math.PI / 2}><torusGeometry args={[r * 0.98, 0.02, 10, 64]} /><meshStandardMaterial ref={ring} color="#3A3666" emissive="#000" roughness={0.3} metalness={0.4} /></mesh>
      <mesh position-y={0.002} rotation-x={-Math.PI / 2}><circleGeometry args={[r * 0.85, 32]} /><meshBasicMaterial map={tex} transparent depthWrite={false} opacity={0.9} /></mesh>
    </group>
  )
}

// узел вывода: модель по каналу
export function ExitProp({ kind }: { kind: string }) {
  const atm = useModel(MODELS.atm, 0.9, true)
  const server = useModel(MODELS.server, 0.95, true)
  const laptop = useModel(MODELS.laptop, 0.44, false)
  const o = kind === 'atm' ? atm : kind === 'crypto' ? laptop : server
  return <primitive object={o} rotation-y={kind === 'crypto' ? -Math.PI / 2.6 : -Math.PI / 2.3} />
}

// кучка монет на подставке вывода: растёт с выведенной суммой
export function usePile() { return useModel(MODELS.pile, 0.22, false) }

// камера наблюдения на границе банка (фотореал Poly Haven)
export function BankCamera() {
  const o = useModel(MODELS.camera, 0.42, false)
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
