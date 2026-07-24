// export-militarymap.mjs
// Rebuilds the MilitaryMap (Globe2.tsx) globe in headless Node and writes
// militarymap.glb — a self-contained 3D model:
//   - sphere wrapped in a baked equirectangular map texture
//     (black ocean, #383838 land fills, #5E5E5E borders, 30° graticule,
//     Hoàng Sa / Trường Sa island dot clusters)
//   - 3 marker spheres: China (Beijing), Vietnam (Hà Nội), Hong Kong
//
// Hard config mirrors the Framer canvas setup:
//   Style Solid · Ocean 000000 · Land 383838 · Borders 5E5E5E (0.5px)
//   Grid 5B636A @ 0.18 · Stars off · Atmosphere strength 0 · Labels off
//
// Runtime-only features (auto-rotate 5°/s, drag 0.4 sens, Asia default view,
// shading light) live in militarymap-viewer.html — a GLB can't carry them.
//
// Run: node export-militarymap.mjs

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

// ---- hard config (mirrors the Framer property panel) ----
const CFG = {
    dataUrl: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    texW: 4096,
    texH: 2048,
    ocean: "#000000",
    land: "#383838",
    border: "#5e5e5e",
    gridColor: "#5b636a",
    gridOpacity: 0.18,
    // SVG px → texture px: 0.5px stroke at the component's ~240px globe radius
    // ≈ 0.12° of arc ≈ 1.4px on a 4096-wide equirect texture
    borderPx: 1.6,
    gridPx: 1.4,
    R: 1,
    markerColor: "#99C2FF",
    markerSize: 0.021, // 5px dot at R≈240px
}

// Markers exactly as configured on the canvas (labels are off — dots only)
const MARKERS = [
    { name: "China",    lat: 35.8617, lon: 104.1954 },
    { name: "Vietnam",  lat: 16.0544, lon: 108.2022 },
    { name: "HongKong", lat: 22.3193, lon: 114.1694 },
]

// Hoàng Sa / Trường Sa island dots — verbatim from Globe2.tsx ARCHIPELAGOS
const ISLAND_DOTS = [
    // Hoàng Sa
    [111.5, 17.1, 1.1], [112.27, 16.98, 1.0], [112.33, 16.83, 1.5],
    [112.73, 16.67, 1.2], [111.6, 16.53, 1.3], [111.58, 16.5, 0.9],
    [111.5, 16.45, 1.0], [111.7, 16.45, 1.1], [111.73, 16.47, 0.9],
    [112.03, 16.33, 1.0], [112.5, 16.03, 1.2], [111.2, 15.78, 1.2],
    // Trường Sa
    [114.33, 11.43, 1.1], [114.28, 11.05, 1.0], [114.37, 10.38, 1.4],
    [114.48, 10.37, 0.9], [114.37, 10.18, 1.0], [114.33, 9.88, 1.1],
    [113.7, 8.97, 1.0], [113.98, 8.85, 0.9], [114.65, 8.85, 0.9],
    [113.3, 8.17, 1.2], [112.92, 7.87, 1.1], [112.35, 8.93, 1.0],
    [112.2, 8.87, 1.1], [111.92, 8.64, 1.4],
]

// ---- TopoJSON decoder (ported verbatim from Globe2.tsx) ----
function decArcs(t) {
    const tf = t.transform
    if (!tf) return t.arcs
    const sx = tf.scale[0], sy = tf.scale[1], dx = tf.translate[0], dy = tf.translate[1]
    return t.arcs.map((a) => {
        let x = 0, y = 0
        return a.map((p) => { x += p[0]; y += p[1]; return [x * sx + dx, y * sy + dy] })
    })
}
function resolveRing(idx, arcs) {
    const out = []
    for (const i of idx) {
        const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse()
        for (let j = out.length > 0 ? 1 : 0; j < a.length; j++) out.push(a[j])
    }
    return out
}
function extractFeatures(t) {
    const arcs = decArcs(t)
    const gs = t.objects.countries?.geometries
    if (!gs) return []
    return gs.map((g) => {
        let c = null
        if (g.type === "Polygon") c = g.arcs.map((r) => resolveRing(r, arcs))
        else if (g.type === "MultiPolygon") c = g.arcs.map((p) => p.map((r) => resolveRing(r, arcs)))
        return { id: String(g.id ?? ""), type: g.type, coords: c }
    })
}

// (lat, lon) deg → unit-sphere point; matches three.js SphereGeometry's
// equirect UV layout so markers land exactly on the textured map
function latLonToVec3(lat, lon, r) {
    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lon + 180) * (Math.PI / 180)
    return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
    )
}

async function main() {
    const { texW: W, texH: H } = CFG
    const X = (lng) => ((lng + 180) / 360) * W
    const Y = (lat) => ((90 - lat) / 180) * H // north at the top; exporter bakes the flip

    console.log("fetching country data…")
    const topo = await (await fetch(CFG.dataUrl)).json()
    const feats = extractFeatures(topo)
    console.log(`${feats.length} country features`)

    // ---- bake the equirect map texture ----
    const cv = createCanvas(W, H)
    const ctx = cv.getContext("2d")

    // ocean
    ctx.fillStyle = CFG.ocean
    ctx.fillRect(0, 0, W, H)

    // graticule UNDER the land (same z-order as the component)
    ctx.strokeStyle = CFG.gridColor
    ctx.globalAlpha = CFG.gridOpacity
    ctx.lineWidth = CFG.gridPx
    ctx.beginPath()
    for (let lat = -60; lat <= 60; lat += 30) {
        ctx.moveTo(0, Y(lat)); ctx.lineTo(W, Y(lat))
    }
    for (let lng = -180; lng < 180; lng += 30) {
        ctx.moveTo(X(lng), Y(80)); ctx.lineTo(X(lng), Y(-80)) // lat ±80 like the component
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    // country polygons — skip Antarctica (id 010) like the component.
    // Each ring is traced at x−W / x / x+W so the ±180° seam stays continuous.
    const polysOf = (f) => (f.type === "Polygon" ? [f.coords] : f.type === "MultiPolygon" ? f.coords : [])
    const traceRing = (ring, dx) => {
        // Unwrap longitudes so rings crossing ±180° (Russia, Fiji) stay
        // continuous instead of streaking across the whole canvas; the
        // −W / +W offset copies repaint whatever spills past the edges.
        let prev = ring[0][0]
        for (let i = 0; i < ring.length; i++) {
            let lng = ring[i][0]
            while (lng - prev > 180) lng -= 360
            while (lng - prev < -180) lng += 360
            prev = lng
            const x = X(lng) + dx
            const y = Y(ring[i][1])
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.closePath()
    }
    ctx.fillStyle = CFG.land
    for (const f of feats) {
        if (String(f.id).padStart(3, "0") === "010") continue
        for (const poly of polysOf(f)) {
            ctx.beginPath()
            for (const dx of [-W, 0, W]) for (const ring of poly) traceRing(ring, dx)
            ctx.fill("evenodd") // outer ring + hole rings in one path
        }
    }
    ctx.strokeStyle = CFG.border
    ctx.lineWidth = CFG.borderPx
    ctx.lineJoin = "round"
    for (const f of feats) {
        if (String(f.id).padStart(3, "0") === "010") continue
        for (const poly of polysOf(f)) {
            ctx.beginPath()
            for (const dx of [-W, 0, W]) for (const ring of poly) traceRing(ring, dx)
            ctx.stroke()
        }
    }

    // Hoàng Sa / Trường Sa dots (border color, like the component)
    ctx.fillStyle = CFG.border
    for (const [lng, lat, r] of ISLAND_DOTS) {
        ctx.beginPath()
        ctx.arc(X(lng), Y(lat), r * 1.4, 0, Math.PI * 2)
        ctx.fill()
    }

    writeFileSync("militarymap-texture-debug.png", cv.toBuffer("image/png"))
    console.log("texture baked (debug copy: militarymap-texture-debug.png)")

    // ---- scene ----
    const root = new THREE.Group()
    root.name = "MilitaryMap"

    // UNLIT materials (KHR_materials_unlit): the source component is a flat
    // SVG — physically-lit materials turn the shadow side near-black and the
    // borders vanish in external viewers. Unlit shows the exact map colors
    // everywhere; the "Globe Shadow" look is a viewer-side overlay.
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const globeMat = new THREE.MeshBasicMaterial({ map: tex })
    const globe = new THREE.Mesh(new THREE.SphereGeometry(CFG.R, 96, 48), globeMat)
    globe.name = "Globe"
    root.add(globe)

    const pinsG = new THREE.Group()
    pinsG.name = "Markers"
    root.add(pinsG)
    const pinGeo = new THREE.SphereGeometry(1, 20, 20)
    const pinMat = new THREE.MeshBasicMaterial({ color: CFG.markerColor })
    for (const m of MARKERS) {
        const mesh = new THREE.Mesh(pinGeo, pinMat)
        mesh.name = `Pin_${m.name}`
        mesh.position.copy(latLonToVec3(m.lat, m.lon, CFG.R * 1.004))
        mesh.scale.setScalar(CFG.markerSize * CFG.R)
        pinsG.add(mesh)
    }

    // ---- export ----
    const scene = new THREE.Scene()
    scene.add(root)
    await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
            scene,
            (result) => {
                const buf = Buffer.from(result)
                writeFileSync("militarymap.glb", buf)
                console.log(`militarymap.glb written (${(buf.length / 1024).toFixed(1)} KB) — markers: ${MARKERS.map((m) => m.name).join(", ")}`)
                resolve()
            },
            (err) => { console.error("GLTF export failed:", err); reject(err) },
            { binary: true, onlyVisible: true }
        )
    })
}

main().catch((e) => { console.error(e); process.exit(1) })
