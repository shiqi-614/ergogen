// The cases (config.cases): each a list of parts, every part a solid that is added to, subtracted from or
// intersected with the parts before it. A part is an outline extruded, the shapes of footprints on the pcbs (their
// courtyards, or the layers it asks for) extruded, or an earlier case. A case mirrored from another (mirror: from:)
// is made of that case's parts, on the mirrored outlines. The solids are built with manifold-3d and come out as STL.
//
// Each result is {stl, parts}: the STL, and for every part what it is and the 2D shape it extruded, for a host that
// shows the parts (ergogen-gui's case editor).

const m = require('makerjs')
const a = require('./assert')
const o = require('./operation')
const Point = require('./point')
const footprint_shape = require('./kicad/footprint_shape')
const u = require('./utils')
const outlines_lib = require('./outlines')
const manifold = require('./manifold')

// What a footprint cuts: its largest circle grown by expand (a round hole stays round), or else its bounding box
// grown by expand on every side
const footprintCut = (extents, expand = 0) => {
    const circles = Object.entries(extents.paths || {}).filter(([, path]) => path.type === 'circle')
    if (circles.length) {
        const [id, largest] = circles.reduce((best, c) => c[1].radius > best[1].radius ? c : best)
        return {paths: {[id]: new m.paths.Circle([...largest.origin], largest.radius + expand)}}
    }
    if (extents.high !== undefined) {
        const rect = new m.models.Rectangle(extents.high[0] - extents.low[0] + expand * 2, extents.high[1] - extents.low[1] + expand * 2)
        m.model.move(rect, [extents.low[0] - expand, extents.low[1] - expand])
        return rect
    }
}

// The entries of dict a part's name picks: the one of that name, or every one a /regex/flags matches
const matching = (dict, pattern) => {
    pattern = pattern.trim()
    if (!pattern.startsWith('/')) return dict[pattern] !== undefined ? [{key: pattern, value: dict[pattern]}] : []
    let regex
    try {
        const parts = pattern.slice(1).trim().split('/')
        const flags = parts.length > 1 ? parts.pop() : ''
        regex = new RegExp(parts.join('/').trim(), flags)
    } catch (e) {
        console.error(`Invalid regex: ${pattern}`, e)
        return []
    }
    return Object.entries(dict).filter(([key]) => regex.test(key)).map(([key, value]) => ({key, value}))
}

// Every footprint of every pcb, by "<pcb>.<footprint>" (module footprints as "<pcb>.modules.<module>.<footprint>")
const allFootprints = previews => {
    const footprints = {}
    for (const [pcb, preview] of Object.entries(previews)) {
        for (const [name, footprint] of Object.entries(preview.footprints)) footprints[`${pcb}.${name}`] = footprint
    }
    return footprints
}

// A part's settings, checked; a string part ("+outline_name") is a shorthand first
const readPart = (part, qname, outlines, solids, units) => {
    if (a.type(part)() === 'string') part = o.operation(part, {outline: Object.keys(outlines), case: Object.keys(solids)}, ['case', 'outline'])
    a.unexpected(part, qname, ['what', 'name', 'extrude', 'shift', 'rotate', 'operation', 'expand', 'layers', 'side', 'asym'])
    return {
        raw: part,
        what: a.in(part.what || 'outline', `${qname}.what`, ['outline', 'case', 'pcb']),
        shift: a.numarr(part.shift || [0, 0, 0], `${qname}.shift`, 3)(units),
        rotate: a.numarr(part.rotate || [0, 0, 0], `${qname}.rotate`, 3)(units),
        operation: a.in(part.operation || 'add', `${qname}.operation`, ['add', 'subtract', 'intersect']),
        asym: part.asym || 'both',
        // a pcb part's footprints: those on the board's front (the cuts through the case over the board), the back
        // (under it: a bottom plate's holes) or both
        side: a.in(part.side || 'front', `${qname}.side`, ['front', 'back', 'both']),
    }
}

// The 2D shapes an outline or pcb part extrudes: the outlines its name picks, or the cuts of the footprints it picks
// on its side of the board (one that draws nothing on the layers is left out)
const partShapes = async (part, qname, sources, layers, expand) => {
    const name = a.sane(part.raw.name, `${qname}.name`, 'string')()
    const picked = matching(part.what === 'outline' ? sources.outlines : sources.footprints, name)
    a.assert(picked.length > 0, `Field "${qname}.name" did not match any outline!`)
    const shapes = []
    for (const {key, value} of picked) {
        if (part.what === 'pcb') {
            const side = (value.config.side || 'front').toLowerCase() === 'back' ? 'back' : 'front'
            if (part.side !== 'both' && part.side !== side) continue
            const [shape, extents] = (await footprint_shape.parse(value.config, layers))()
            if (Object.entries(shape.models).length === 0 && Object.entries(shape.paths).length === 0) continue
            shapes.push({key, outline: new Point(value.point).position(footprintCut(extents, expand))})
        } else {
            // an outline as ergogen makes it, or one that is a model already (the mirrored ones)
            shapes.push({key, outline: value.raw ? value.raw.models.export : value})
        }
    }
    return {name, shapes}
}

// A solid turned about its own middle (in x and y), then shifted
const place = (solid, rotate, shift) => {
    if (solid.isEmpty()) return solid
    const {min, max} = solid.boundingBox()
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2
    const centred = solid.translate([-cx, -cy, 0])
    const rotated = centred.rotate(rotate)
    const placed = rotated.translate([cx + shift[0], cy + shift[1], shift[2]])
    solid.delete(); centred.delete(); rotated.delete()
    return placed
}

// Whether a case is a prism: every part an extrusion from z = 0 that isn't shifted or rotated, the added ones of one
// height and the others at least as tall. Its solid is then rebuilt as that prism (see manifold.rebuildPrism).
const prismTracker = () => {
    let height = null, prism = true
    return {
        add(part, partHeight, first) {
            if (partHeight === null || part.shift.some(v => v !== 0) || part.rotate.some(v => v !== 0)) prism = false
            else if (first || part.operation === 'add') {
                if (height === null) height = partHeight
                else if (partHeight !== height) prism = false
            } else if (partHeight < height) prism = false
        },
        height: () => prism && height ? height : null,
    }
}

const combine = (result, solid, operation) => {
    if (result === null) return solid
    const next = operation === 'subtract' ? result.subtract(solid) : operation === 'intersect' ? result.intersect(solid) : result.add(solid)
    result.delete(); solid.delete()
    return next
}

// One case's solid and what each of its parts made
const buildCase = async (wasm, caseName, caseConfig, mirrored, sources, solids, units) => {
    const parts = a.sane(a.type(caseConfig)() === 'array' ? {...caseConfig} : caseConfig, `cases.${caseName}`, 'object')()
    const made = []
    const prism = prismTracker()
    let result = null
    for (const [partName, raw] of Object.entries(parts)) {
        const qname = `cases.${caseName}.${partName}`
        const part = readPart(raw, qname, sources.outlines, solids, units)
        let solid, partHeight = null

        if (part.what === 'outline' || part.what === 'pcb') {
            const extrude = partHeight = a.sane(part.raw.extrude || 1, `${qname}.extrude`, 'number')(units)
            const expand = a.sane(part.raw.expand || 0, `${qname}.expand`, 'number')(units)
            a.sane(part.raw.name, `${qname}.name`, 'string')()
            // an outline part is on one half: the source's (asym: source) is left off the mirrored case, the clone's
            // off the case itself
            if (part.what === 'outline' && part.asym === (mirrored ? 'source' : 'clone')) continue
            const {name, shapes} = await partShapes(part, qname, mirrored ? {...sources, outlines: sources.mirrored} : sources,
                part.raw.layers || ['F.CrtYd'], expand)
            const pieces = [], extruded = []
            for (const {key, outline} of shapes) {
                const piece = manifold.extrude(wasm, outline, extrude)
                if (piece) {
                    pieces.push(piece)
                    extruded.push(outline)
                } else if (part.what === 'outline' && m.measure.modelExtents(outline)) {
                    // lines that don't close into a shape are a mistake: the cut would just be missing
                    pieces.forEach(p => p.delete())
                    if (result) result.delete()
                    throw new Error(`Outline "${key}" (${qname}.name) has lines but no closed shape, so there is nothing to extrude!`)
                }
            }
            made.push({part: partName, what: part.what, name, operation: part.operation, extrude, expand, shift: part.shift, rotate: part.rotate,
                matched: pieces.length, outline: extruded.length === 0 ? null
                    : extruded.length === 1 ? extruded[0] : {models: Object.fromEntries(extruded.map((shape, i) => [i, shape]))}})
            // matching nothing, the part adds (or cuts) nothing
            if (pieces.length === 0) continue
            solid = pieces.length === 1 ? pieces[0] : wasm.Manifold.union(pieces)
            if (pieces.length > 1) pieces.forEach(p => p.delete())
        } else {
            a.in(part.raw.name, `${qname}.name`, Object.keys(solids))
            solid = solids[part.raw.name].translate([0, 0, 0])
            made.push({part: partName, what: part.what, name: part.raw.name, operation: part.operation, extrude: null, expand: 0,
                shift: part.shift, rotate: part.rotate, matched: 1, outline: null})
        }

        solid = place(solid, part.rotate, part.shift)
        prism.add(part, partHeight, result === null)
        result = combine(result, solid, part.operation)
    }
    const height = prism.height()
    const finished = !result ? new wasm.Manifold() : height ? manifold.rebuildPrism(result, height) : result
    return {solid: finished, parts: made}
}

exports.parse = async (config, cases_config, outlines, previews, points, units, errors) => {
    a.sane(cases_config, 'cases', 'object')()
    // the mirrored outlines, as io.twodee originates them, without the DXF and SVG it would also render
    const mirrored = {}
    for (const [name, outline] of Object.entries(outlines_lib.mirrored(config.outlines || {}, points, units, errors))) {
        mirrored[name] = {raw: m.model.originate({models: {export: u.deepcopy(outline)}, units: 'mm'})}
    }
    const sources = {outlines, mirrored, footprints: allFootprints(previews)}

    const wasm = await manifold.load()
    // every case's solid stays alive until the last case is built: later cases can be made of earlier ones
    const solids = {}
    const results = {}
    try {
        for (const [name, own] of Object.entries(cases_config)) {
            // with errors (the tolerant mode), a case that fails is left out (cases made of it then fail too) and the
            // others go on
            await u.attempt(errors, `cases.${name}`, async () => {
                const isMirror = !!own.mirror
                const caseConfig = isMirror ? cases_config[own.mirror.from] : own
                const {solid, parts} = await buildCase(wasm, name, caseConfig, isMirror, sources, solids, units)
                solids[name] = solid
                results[name] = {stl: manifold.toStl(solid), parts}
            })
        }
    } finally {
        Object.values(solids).forEach(s => s.delete())
    }
    return results
}
