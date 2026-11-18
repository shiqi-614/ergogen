// A KiCad footprint's drawings and pads as makerjs paths and models, for the cases' cut-outs (footprint_shape.js).
// KiCad's y points down and makerjs's up, so every y is flipped.

const m = require('makerjs')

// Every shape gets a key of its own: its KiCad uuid (or tstamp), else a running number
let counter = 0
const keyOf = (prefix, item) => prefix + '-' + (item.uuid || item.tstamp || ++counter)

const up = p => [p.x, -p.y]

// a circle through three points
const circleThrough = (p1, p2, p3) => {
    const {x: x1, y: y1} = p1, {x: x2, y: y2} = p2, {x: x3, y: y3} = p3
    const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3
    const a = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2
    const b = s1 * (y3 - y2) + s2 * (y1 - y3) + s3 * (y2 - y1)
    const c = s1 * (x2 - x3) + s2 * (x3 - x1) + s3 * (x1 - x2)
    const d = s1 * (x3 * y2 - x2 * y3) + s2 * (x1 * y3 - x3 * y1) + s3 * (x2 * y1 - x1 * y2)
    return {center: {x: -b / (2 * a), y: -c / (2 * a)}, radius: Math.sqrt((b * b + c * c - 4 * a * d) / (4 * a * a))}
}

// a pad's rectangle (or rounded one) centred on it, turned as the pad is
const padModel = (model, item) => {
    model.origin = [item.at.x - item.size.w / 2, -item.at.y - item.size.h / 2]
    if (item.at.angle) m.model.rotate(model, item.at.angle, up(item.at))
    return model
}

// one converter per KiCad shape: a pad's by its shape, a drawing's by its kind
const converters = {
    // a drawn circle: its centre and a point on it
    fp_circle: item => ({[keyOf('fpCircle', item)]: new m.paths.Circle(up(item.center),
        Math.sqrt(Math.pow(item.center.x - item.end.x, 2) + Math.pow(item.center.y - item.end.y, 2)))}),
    circle: item => ({[keyOf('circle', item)]: new m.paths.Circle(up(item.at), item.size.w / 2)}),
    oval: item => {
        const oval = new m.models.Oval(item.size.w, item.size.h)
        // its lower left corner, the pad being at its middle
        oval.origin = [item.at.x - item.size.w / 2, -item.at.y - item.size.h / 2]
        return {[keyOf('oval', item)]: oval}
    },
    roundrect: item => {
        const key = keyOf('roundrect', item)
        return {[key]: padModel(new m.models.RoundRectangle(item.size.w, item.size.h, item.roundrect_rratio * Math.min(item.size.w, item.size.h)), item)}
    },
    rect: item => {
        const key = keyOf('rect', item)
        return {[key]: padModel(new m.models.Rectangle(item.size.w, item.size.h), item)}
    },
    // an arc through its start, middle and end
    arc: item => {
        const start = {x: item.start.x, y: -item.start.y}, end = {x: item.end.x, y: -item.end.y}
        const {center, radius} = circleThrough(start, {x: item.mid.x, y: -item.mid.y}, end)
        // makerjs turns counter-clockwise from startAngle: with y flipped, KiCad's end is where it starts
        const arc = {
            type: 'arc', origin: [center.x, center.y], radius,
            startAngle: Math.atan2(end.y - center.y, end.x - center.x) * (180 / Math.PI),
            endAngle: Math.atan2(start.y - center.y, start.x - center.x) * (180 / Math.PI),
        }
        return {[keyOf('arc', item)]: arc}
    },
    line: item => ({[keyOf('line', item)]: {type: 'line', origin: up(item.start), end: up(item.end)}}),
    // a drawn rectangle: two corners
    fp_rect: item => {
        const key = keyOf('fp_rect', item)
        const x0 = Math.min(item.start.x, item.end.x), x1 = Math.max(item.start.x, item.end.x)
        const y0 = Math.min(item.start.y, item.end.y), y1 = Math.max(item.start.y, item.end.y)
        const rect = new m.models.Rectangle(x1 - x0, y1 - y0)
        // its lower left corner, once y is flipped: the lowest x and the highest KiCad y
        rect.origin = [x0, -y1]
        return {[key]: rect}
    },
    // a polygon: its points joined in order (closed when KiCad repeats the first)
    fp_poly: item => {
        const key = keyOf('fpPoly', item)
        const points = item.pts.xy
        const model = {paths: {}}
        for (let i = 0; i < points.length - 1; i++) model.paths[`line${i + 1}`] = new m.paths.Line(up(points[i]), up(points[i + 1]))
        return {[key]: model}
    },
}
converters.fp_line = converters.line
converters.fp_arc = converters.arc

const convertOne = (item, kind) => {
    const shape = item.shape || kind
    const converter = converters[shape]
    if (!converter) throw new Error(`Unsupported shape: ${shape}`)
    return converter(item)
}

// the layers a part's shapes are drawn on, when a case part asks for none
const DRAWING_LAYERS = ['CrtYd', 'Dwgs.User', 'Fab', 'Cu', 'SilkS', 'Edge.Cuts']
const listOf = value => Array.isArray(value) ? value : [value]
const onDrawingLayer = item => [...('layer' in item ? listOf(item.layer) : []), ...('layers' in item ? listOf(item.layers) : [])]
    .some(layer => DRAWING_LAYERS.some(suffix => layer.endsWith(suffix)))

// the parts of a footprint that have a shape (a pad's is its shape property)
const SHAPED = new Set(['fp_line', 'fp_circle', 'pad', 'fp_arc', 'fp_poly', 'fp_rect'])

// A footprint's shapes on the layers asked for (a case part's layers, taken as they are, so a footprint can draw
// what a case needs on any layer, Eco2.User say), or on the drawing layers: [paths, models]
exports.convert = (footprint, filterLayers = null) => {
    const asked = filterLayers && listOf(filterLayers)
    const onAskedLayer = item => item.layer ? asked.includes(item.layer) : item.layers ? asked.some(x => item.layers.includes(x)) : false
    let shapes = {}
    for (const [kind, value] of Object.entries(footprint)) {
        if (!SHAPED.has(kind)) continue
        const converted = listOf(value).filter(asked ? onAskedLayer : onDrawingLayer).flatMap(item => convertOne(item, kind))
        shapes = {...shapes, ...Object.assign({}, ...converted)}
    }
    const paths = {}, models = {}
    for (const [key, shape] of Object.entries(shapes)) {
        if (!Object.keys(shape).length) continue
        if ('type' in shape) paths[key] = shape
        else models[key] = shape
    }
    return [paths, models]
}
