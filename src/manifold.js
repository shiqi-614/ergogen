// Case geometry with manifold-3d (https://github.com/elalish/manifold, Apache-2.0): makerjs outlines are
// extruded into solids, combined, and written out as binary STL.
const m = require('makerjs')

// manifold-3d is WebAssembly, loaded once. A browser host sets window.ergogenManifoldUrl to wherever it
// serves manifold.js (with manifold.wasm next to it); Node imports the package.
let toplevel = null
exports.load = () => {
    if (!toplevel) {
        toplevel = (async () => {
            const url = typeof window !== 'undefined' && window.ergogenManifoldUrl
            const factory = (url ? await import(/* webpackIgnore: true */ url) : await import('manifold-3d')).default
            const wasm = await factory()
            wasm.setup()
            return wasm
        })()
    }
    return toplevel
}

// segments per full circle: the JSCAD default the case scripts used before
const SEGMENTS = 32

const pathPoints = (p) => {
    switch (p.type) {
        case m.pathType.Line:
            return [p.origin, p.end]
        case m.pathType.Circle:
            return m.path.toPoints(p, SEGMENTS)
        case m.pathType.Arc:
            return m.path.toPoints(p, Math.max(2, Math.ceil(SEGMENTS * m.angle.ofArcSpan(p) / 360) + 1))
        default:
            return m.path.toKeyPoints(p)
    }
}

// the closed polygon of an endless chain, in model coordinates
const chainPoints = (chain) => {
    const points = []
    chain.links.forEach((link, i) => {
        const walked = link.walkedPath
        let key = pathPoints(walked.pathContext)
        if (link.reversed) key = key.slice().reverse()
        if (i > 0) key = key.slice(1)
        for (const p of key) {
            const q = m.point.add(p, walked.offset)
            points.push([q[0], q[1]])
        }
    })
    const [first, last] = [points[0], points[points.length - 1]]
    if (points.length > 1 && m.measure.isPointEqual(first, last, 1e-6)) points.pop()
    return points
}

const subtreeContours = (chain, out) => {
    if (!chain.endless) return
    const points = chainPoints(chain)
    if (points.length >= 3) out.push(points)
    for (const inner of chain.contains || []) subtreeContours(inner, out)
}

// The filled 2D region of a makerjs model, as makerjs' JSCAD export defines it: chains nested inside a chain
// alternate between hole and island, separate top-level chains are united. Null when nothing is closed.
const crossSection = (wasm, model) => {
    const regions = []
    for (const chain of m.model.findChains(model, {contain: true})) {
        const contours = []
        subtreeContours(chain, contours)
        if (contours.length) regions.push(wasm.CrossSection.ofPolygons(contours, 'EvenOdd'))
    }
    if (regions.length === 0) return null
    if (regions.length === 1) return regions[0]
    const united = wasm.CrossSection.union(regions)
    regions.forEach(r => r.delete())
    return united
}

// a makerjs model extruded from z = 0 to z = height, or null when it encloses no area
exports.extrude = (wasm, model, height) => {
    const section = crossSection(wasm, model)
    if (!section) return null
    const solid = section.extrude(height)
    section.delete()
    return solid
}

// binary STL of a solid
exports.toStl = (solid) => {
    const {numProp, vertProperties: v, triVerts: t} = solid.getMesh()
    const count = t.length / 3
    const buffer = new ArrayBuffer(84 + 50 * count)
    const view = new DataView(buffer)
    const header = 'ergogen case (manifold-3d)'
    for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i))
    view.setUint32(80, count, true)
    let at = 84
    for (let i = 0; i < count; i++) {
        const corner = k => [0, 1, 2].map(axis => v[t[3 * i + k] * numProp + axis])
        const [a, b, c] = [corner(0), corner(1), corner(2)]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        const len = Math.hypot(n[0], n[1], n[2]) || 1
        for (const value of [n[0] / len, n[1] / len, n[2] / len, ...a, ...b, ...c]) {
            view.setFloat32(at, value, true)
            at += 4
        }
        view.setUint16(at, 0, true)
        at += 2
    }
    return new Uint8Array(buffer)
}
