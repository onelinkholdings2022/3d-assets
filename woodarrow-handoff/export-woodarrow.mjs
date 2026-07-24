// export-woodarrow.mjs
// Rebuilds the OlcoHero wood planks (file "framer 3d") in headless Node and
// writes wood-arrow.glb — the 6 oak planks only (no text / labels / images).
//
// Bakes BOTH poses and a scroll animation clip:
//   - "before"  : 3 upright barrier columns (2 butted slats each)
//   - "after"   : the 6 planks assembled into the herringbone arrow »
//   - clip "ScrollToArrow": before -> after, using the component's per-plank
//     stagger (delay) + easing (easeInOutCubic position, easeOutBack rotation).
//
// The component's layout constants (stepW, as, bs, lift, endImgH) depend on the
// live viewport. We freeze them to a reference frame so the baked arrow matches
// the reference render:
const FRAME_W = 1440, FRAME_H = 760   // OlcoHero intrinsic size
const SPLIT = 50                       // splitRatio %
const END_IMG_ASPECT = 1.6             // endpoint placeholder aspect (w:h)
const END_IMG_W_FRAC = 0.22            // endpoint wrapper width = 22% of frame
//
// Run: node export-woodarrow.mjs

import * as THREE from "three"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"
import { createCanvas, ImageData as NodeImageData } from "canvas"
import { writeFileSync } from "node:fs"

// --- DOM shims for headless GLTFExporter texture encoding ---
if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = NodeImageData
function makeCanvas(w = 1, h = 1) {
    const c = createCanvas(w, h)
    if (typeof c.toBlob !== "function")
        c.toBlob = (cb, m = "image/png") => cb(new Blob([c.toBuffer(m)], { type: m }))
    return c
}
if (typeof globalThis.document === "undefined") {
    globalThis.document = {
        createElement(t) { if (t === "canvas") return makeCanvas(); throw new Error(t) },
        createElementNS(_n, t) { return this.createElement(t) },
    }
}
if (typeof globalThis.FileReader === "undefined") {
    globalThis.FileReader = class {
        readAsArrayBuffer(b) { b.arrayBuffer().then((buf) => { this.result = buf; this.onloadend && this.onloadend() }) }
    }
}

// ---------- easings (verbatim) ----------
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
const clamp01 = (t) => Math.max(0, Math.min(1, t))

// ---------- procedural oak texture (512x256) ----------
function makeOakTexture() {
    const c = makeCanvas(512, 256)
    const g = c.getContext("2d")
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, "#c89b6d"); grad.addColorStop(1, "#a97e52")
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256)
    g.strokeStyle = "rgba(138,101,64,0.16)"
    for (let i = 0; i < 26; i++) {
        g.lineWidth = 1 + Math.random() * 1.5
        g.beginPath()
        const y = Math.random() * 256
        g.moveTo(0, y)
        g.bezierCurveTo(128, y + (Math.random() - 0.5) * 24, 384, y + (Math.random() - 0.5) * 24, 512, y + (Math.random() - 0.5) * 16)
        g.stroke()
    }
    for (let k = 0; k < 2; k++) {
        const x = 80 + Math.random() * 350, y = 40 + Math.random() * 170
        const rg = g.createRadialGradient(x, y, 2, x, y, 18)
        rg.addColorStop(0, "rgba(120,85,50,0.35)"); rg.addColorStop(1, "rgba(120,85,50,0)")
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

// ---------- frozen layout constants (from the tick(), at the reference frame) ----------
const sr = Math.min(0.7, Math.max(0.2, SPLIT / 100))
const ndcT = -sr
const aOff = (2.80078 * ndcT - 0.99561) / (-0.99551 - 0.025407 * ndcT)
const VIEW_0 = 0.5359 * (10.4526 + 0.09482 * aOff)
const VIEW_H = 0.5359 * (10.9044 + 0.09482 * aOff)
// endpoint image pixel height at the reference frame
const endImgW = END_IMG_W_FRAC * FRAME_W
const endImgH = endImgW / END_IMG_ASPECT
const targetH = (endImgH / FRAME_H) * VIEW_H
const ARROW_H = 3.07, STRETCH = 1.4
const as = Math.min(1, Math.max(0.2, targetH / ARROW_H))
const bs = Math.min(1.5, Math.max(0.3, ((endImgH / FRAME_H) * VIEW_0) / 1.55))
const lift = (44 / FRAME_H) * VIEW_0
const stepW = (0.12 * FRAME_W) / (FRAME_H / VIEW_0)
const ARROW_C = new THREE.Vector3(0, 0.68, -0.45)

// ---------- build the 6 planks + their two poses ----------
const oak = makeOakTexture()
const FRESH = new THREE.Color(0xffffff)
const DULL = new THREE.Color(0x8f8f8f)
const geo = new THREE.BoxGeometry(1.55, 0.12, 0.62)

const planks = []
for (let b = 0; b < 3; b++) {
    for (let j = 0; j < 2; j++) {
        const dull = 0.25 + b * 0.22
        const mat = new THREE.MeshStandardMaterial({ map: oak, roughness: 0.65, metalness: 0 })
        mat.color.copy(FRESH).lerp(DULL, dull)
        const m = new THREE.Mesh(geo, mat)
        m.name = `Plank_b${b}_j${j}`

        const stand = { p: new THREE.Vector3(0, 0.72, j === 0 ? -0.31 : 0.31), e: new THREE.Euler(0, 0, Math.PI / 2) }
        const ax = (b - 1) * 0.877
        const floor = j === 0
            ? { p: new THREE.Vector3(ax - 0.219, 0.767, 0), e: new THREE.Euler(Math.PI / 2, -Math.PI / 4, 0) }
            : { p: new THREE.Vector3(ax, -0.548, 0), e: new THREE.Euler(Math.PI / 2, Math.PI / 4, 0) }

        planks.push({ mesh: m, mat, stand, floor, delay: (b * 2 + j) * 0.07, dull, b, j })
    }
}

// pose evaluator at transition progress `since` seconds, forward (before->after)
const TRANS = 0.65
const SETTLE = 0.35 + TRANS
const sp = new THREE.Vector3(), tp = new THREE.Vector3(), pos = new THREE.Vector3()
const dimK = 70 / 100 // barrierDim default
function poseAt(pl, since) {
    const raw = clamp01((since - pl.delay) / TRANS)
    const k = raw
    const kp = easeInOutCubic(k)
    const kr = easeOutBack(clamp01(k * 1.05))
    // stand pose (x from stepW, y lifted)
    sp.copy(pl.stand.p)
    sp.x = (pl.b - 1) * stepW
    sp.y += lift
    // arrow pose
    tp.copy(pl.floor.p).multiplyScalar(as).add(ARROW_C)
    pos.lerpVectors(sp, tp, kp)
    const asx = pl.j === 1 ? as * STRETCH : as
    const scale = new THREE.Vector3(bs + (asx - bs) * kp, 1 + (as - 1) * kp, 1 + (as - 1) * kp)
    const rot = new THREE.Euler(pl.floor.e.x * kr, pl.floor.e.y * kr, pl.stand.e.z * (1 - kr))
    return { pos: pos.clone(), scale, rot }
}

// ---------- assemble scene at the AFTER pose (t = SETTLE) ----------
const root = new THREE.Group()
root.name = "WoodArrow"
for (const pl of planks) {
    const after = poseAt(pl, SETTLE)
    pl.mesh.position.copy(after.pos)
    pl.mesh.scale.copy(after.scale)
    pl.mesh.rotation.copy(after.rot)
    pl.mat.color.copy(FRESH).lerp(DULL, pl.dull * dimK * 0) // fully fresh at after
    pl.mesh.castShadow = pl.mesh.receiveShadow = true
    root.add(pl.mesh)
}

// ---------- bake the ScrollToArrow animation clip ----------
// sample the timeline 0..SETTLE at fixed steps; write position/quaternion/scale
// tracks per plank. glTF stores rotation as quaternions.
const FPS = 30
const nFrames = Math.round(SETTLE * FPS) + 1
const times = new Float32Array(nFrames)
for (let f = 0; f < nFrames; f++) times[f] = f / FPS

const tracks = []
const q = new THREE.Quaternion(), e = new THREE.Euler()
for (const pl of planks) {
    const posArr = new Float32Array(nFrames * 3)
    const quatArr = new Float32Array(nFrames * 4)
    const sclArr = new Float32Array(nFrames * 3)
    for (let f = 0; f < nFrames; f++) {
        const s = poseAt(pl, times[f])
        posArr.set([s.pos.x, s.pos.y, s.pos.z], f * 3)
        e.copy(s.rot); q.setFromEuler(e)
        quatArr.set([q.x, q.y, q.z, q.w], f * 4)
        sclArr.set([s.scale.x, s.scale.y, s.scale.z], f * 3)
    }
    const nm = pl.mesh.name
    tracks.push(new THREE.VectorKeyframeTrack(`${nm}.position`, times, posArr))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, times, quatArr))
    tracks.push(new THREE.VectorKeyframeTrack(`${nm}.scale`, times, sclArr))
}
const clip = new THREE.AnimationClip("ScrollToArrow", SETTLE, tracks)

// ---------- export ----------
const scene = new THREE.Scene()
scene.add(root)
new GLTFExporter().parse(
    scene,
    (result) => {
        const buf = Buffer.from(result)
        writeFileSync("wood-arrow.glb", buf)
        console.log(`wood-arrow.glb written (${(buf.length / 1024).toFixed(1)} KB) — planks: ${planks.length}, clip: ${clip.name} ${SETTLE.toFixed(2)}s @${FPS}fps`)
    },
    (err) => { console.error("GLTF export failed:", err); process.exit(1) },
    { binary: true, onlyVisible: true, embedImages: true, animations: [clip] }
)
