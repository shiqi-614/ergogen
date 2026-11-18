// A library footprint placed on a board, as KiCad writes it into a .kicad_pcb: moved and turned to where it goes,
// flipped to the back when it goes there (mirrored about its own x axis, its layers swapped, as KiCad's
// FOOTPRINT::Flip does), with its reference and value, and its pads on their nets. The footprint is an
// s-expression from sexpr.js; a copy is placed, the library one stays as it is.
const { isList, head, str, child } = require('./sexpr')

const num = v => (Math.round(v * 1e6) / 1e6).toString()
const deg360 = a => num(((a % 360) + 360) % 360)
const deg180 = a => {
    const d = ((a % 360) + 360) % 360
    return num(d > 180 ? d - 360 : d)
}
// keep atoms atoms and quoted strings quoted
const withText = (n, text) => typeof n === 'string' ? text : {q: text}

const flipLayerName = l => l.replace(/^([FB])\./, (_, s) => (s === 'F' ? 'B' : 'F') + '.')
const isSided = l => /^[FB]\./.test(l)

const flipLayers = n => {
    for (const key of ['layer', 'layers']) {
        const c = child(n, key)
        if (!c) continue
        for (let i = 1; i < c.length; i++) c[i] = withText(c[i], flipLayerName(str(c[i])))
    }
}

const negY = p => { p[2] = num(-parseFloat(p[2])) }

const eachPolyPoint = (pts, fn) => {
    for (const p of pts.filter(isList)) {
        if (p[0] === 'xy') fn(p)
        else if (p[0] === 'arc') p.filter(c => isList(c) && ['start', 'mid', 'end'].includes(c[0])).forEach(fn)
    }
}

// Flipping to the back mirrors a footprint about its own x axis (KiCad's FOOTPRINT::Flip),
// i.e. every local y changes sign; the footprint angle is then set as is.
const mirrorShape = n => {
    for (const c of n.filter(isList)) {
        if (['start', 'mid', 'end', 'center'].includes(c[0])) negY(c)
        else if (c[0] === 'pts') eachPolyPoint(c, negY)
    }
    if (n[0].endsWith('_arc')) {
        const s = child(n, 'start'), e = child(n, 'end')
        if (s && e) [s[1], s[2], e[1], e[2]] = [e[1], e[2], s[1], s[2]]
    }
}

const toggleMirror = text => {
    let effects = child(text, 'effects')
    if (!effects) text.push(effects = ['effects'])
    const justify = child(effects, 'justify')
    if (!justify) {
        effects.push(['justify', 'mirror'])
    } else if (justify.includes('mirror')) {
        justify.splice(justify.indexOf('mirror'), 1)
        if (justify.length === 1) effects.splice(effects.indexOf(justify), 1)
    } else {
        justify.push('mirror')
    }
}

// (at x y [angle] [unlocked]): pads and texts store absolute angles in a board file
const placeAt = (n, back, r, flipAngle) => {
    const at = child(n, 'at')
    if (!at) return
    const hasAngle = at.length > 3 && !isNaN(parseFloat(at[3]))
    let a = hasAngle ? parseFloat(at[3]) : 0
    const rest = at.slice(hasAngle ? 4 : 3)
    if (back) {
        negY(at)
        a = flipAngle(a)
    }
    at.splice(3, at.length - 3, deg360(a + r), ...rest)
}

const placeText = (text, back, r) => {
    if (back) {
        const layer = child(text, 'layer')
        if (layer && isSided(str(layer[1]))) toggleMirror(text)
        flipLayers(text)
    }
    placeAt(text, back, r, a => 180 - a)
}

const CHAMFER_FLIP = {top_left: 'bottom_left', bottom_left: 'top_left', top_right: 'bottom_right', bottom_right: 'top_right'}

const placePad = (pad, back, r) => {
    if (back) {
        flipLayers(pad)
        const offset = child(child(pad, 'drill') || [], 'offset')
        if (offset) negY(offset)
        const delta = child(pad, 'rect_delta')
        if (delta) negY(delta)
        const chamfer = child(pad, 'chamfer')
        if (chamfer) for (let i = 1; i < chamfer.length; i++) chamfer[i] = CHAMFER_FLIP[chamfer[i]] || chamfer[i]
        const primitives = child(pad, 'primitives')
        if (primitives) primitives.filter(isList).forEach(mirrorShape)
    }
    placeAt(pad, back, r, a => -a)
}

// unlike everything else in a footprint, zone outlines are stored in board coordinates
const placeZone = (zone, back, x, y, r) => {
    const layers = child(zone, 'layers')
    // the preview board has 2 copper layers
    if (layers) layers.splice(1, layers.length, ...layers.slice(1).filter(l => !/^In\d+\.Cu$/.test(str(l))))
    if (back) flipLayers(zone)
    const rad = r * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad)
    const move = p => {
        const px = parseFloat(p[1]), py = (back ? -1 : 1) * parseFloat(p[2])
        p[1] = num(x + px * cos + py * sin)
        p[2] = num(y + py * cos - px * sin)
    }
    for (const poly of zone.filter(c => isList(c) && (c[0] === 'polygon' || c[0] === 'filled_polygon'))) {
        const pts = child(poly, 'pts')
        if (pts) eachPolyPoint(pts, move)
    }
}

const GRAPHICS = ['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly', 'fp_curve']
// library-only header items, and groups (they would point at the uuids dropped below)
const DROP = ['version', 'generator', 'generator_version', 'tedit', 'tstamp', 'uuid', 'at', 'group']

const clone = n => isList(n) ? n.map(clone) : (typeof n === 'string' ? n : {q: n.q})

// KiCad assigns fresh ids to items without one; library ids would repeat in every copy of a footprint
const stripIds = n => {
    for (let i = n.length - 1; i >= 0; i--) {
        if (!isList(n[i])) continue
        if (n[i][0] === 'uuid' || n[i][0] === 'tstamp') n.splice(i, 1)
        else stripIds(n[i])
    }
}

const setField = (body, field, text) => {
    for (const c of body) {
        if ((head(c) === 'property' && str(c[1]) === field) || (head(c) === 'fp_text' && c[1] === field.toLowerCase())) {
            c[2] = {q: text}
        }
    }
}

// pin: {name, pinfunction, pintype} as the schematic gives them; `code` numbers a net name
const setPadNet = (pad, pin, code) => {
    for (const key of ['net', 'pinfunction', 'pintype']) {
        const i = pad.findIndex(c => head(c) === key)
        if (i >= 0) pad.splice(i, 1)
    }
    if (pin.name) pad.push(['net', String(code(pin.name)), {q: pin.name}])
    if (pin.pinfunction) pad.push(['pinfunction', {q: pin.pinfunction}])
    if (pin.pintype) pad.push(['pintype', {q: pin.pintype}])
}

// pins: {pad number: [pin of the 1st pad with that number, of the 2nd, ...]}; a single pin covers all of them
const placeFootprint = (mod, {name, x, y, r, back, reference, value, uuid, pins, code}) => {
    const body = mod.slice(2).filter(c => !(isList(c) && DROP.includes(c[0]))).map(clone)
    stripIds(body)
    const seen = {}
    for (const c of body.filter(isList)) {
        if (c[0] === 'layer') { if (back) c[1] = withText(c[1], flipLayerName(str(c[1]))) }
        else if (GRAPHICS.includes(c[0])) { if (back) { flipLayers(c); mirrorShape(c) } }
        else if (c[0] === 'fp_text' || c[0] === 'property') placeText(c, back, r)
        else if (c[0] === 'pad') {
            placePad(c, back, r)
            const number = str(c[1])
            const list = pins && pins[number]
            seen[number] = (seen[number] || 0) + 1
            const pin = list && list[Math.min(seen[number], list.length) - 1]
            if (pin) setPadNet(c, pin, code)
        }
        else if (c[0] === 'zone') placeZone(c, back, x, y, r)
    }
    setField(body, 'Reference', reference)
    if (value) setField(body, 'Value', value)
    const layer = body.findIndex(c => head(c) === 'layer')
    body.splice(layer + 1, 0, ['uuid', {q: uuid}], ['at', num(x), num(y), deg180(r)])
    return ['footprint', {q: name}, ...body]
}

// stands in for a footprint that could not be fetched, so its label still shows where it goes
const placeholder = (name) => ['footprint', {q: name}, ['layer', {q: 'F.Cu'}],
    ['property', {q: 'Reference'}, {q: 'REF**'}, ['at', '0', '0', '0'], ['layer', {q: 'F.SilkS'}],
        ['effects', ['font', ['size', '1', '1'], ['thickness', '0.15']]]],
    ['property', {q: 'Value'}, {q: `${name} (not found)`}, ['at', '0', '2', '0'], ['layer', {q: 'F.Fab'}],
        ['effects', ['font', ['size', '0.8', '0.8'], ['thickness', '0.12']]]],
    ['fp_circle', ['center', '0', '0'], ['end', '1.5', '0'], ['stroke', ['width', '0.12'], ['type', 'solid']], ['layer', {q: 'F.Fab'}]]]

module.exports = {num, placeFootprint, placeholder}
