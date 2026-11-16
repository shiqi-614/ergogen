// A KiCad 9 board for previewing a pcb (e.g. in KiCanvas) before KiCad is involved: every library
// footprint is placed the way ergo-kbplacer places it and carries the reference it gets on the real board.
const m = require('makerjs')
const { parse, serialize, isList, head, str, child } = require('./sexpr')
const { fetchWhat, normalizeWhat, checkRepo } = require('./fetcher')
const Cache = require('./cache')

// KicadGen puts one switch SW<index> and one diode D<index> per point into the schematic, taking the
// last footprint whose name starts with "key" / "diode", and kbplacer places only those. kbplacer
// places every other footprint under its ergogen name; module footprints keep their module reference.
const SCHEMATIC_PARTS = [['key', 'SW'], ['diode', 'D']]

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

// in memory, and dropped like the other caches when the repo changes the file (checkRepo)
const footprintCache = new Cache('preview_footprint', undefined, false)

const loadFootprint = async (what) => {
    const github = normalizeWhat(what)?.github
    if (!github) return null
    const key = `${github.repo}/${github.file}`
    await checkRepo(github.repo)
    if (!footprintCache.has(key)) {
        footprintCache.set(key, fetchWhat(what)
            .then(text => {
                if (typeof text !== 'string') throw new Error(`unexpected response for ${key}`)
                return parse(text).find(n => head(n) === 'footprint' || head(n) === 'module') || null
            })
            .catch(error => {
                // a missing file stays missing until its repo changes; anything else is retried on the next build
                if (error.response?.status === 404) {
                    console.error(`Preview board: ${key} not found`)
                    return null
                }
                footprintCache.delete(key)
                throw error
            }))
    }
    return footprintCache.get(key)
}

// Pad nets of a module board: {names: {net code: name}, pins: {reference: pins as placeFootprint takes them}}
const moduleNetCache = new Cache('preview_module_nets', undefined, false)

const loadModuleNets = async (what) => {
    const github = normalizeWhat(what)?.github
    if (!github) return null
    const key = `${github.repo}/${github.file}`
    await checkRepo(github.repo)
    if (!moduleNetCache.has(key)) {
        moduleNetCache.set(key, fetchWhat(what)
            .then(text => {
                if (typeof text !== 'string') throw new Error(`unexpected response for ${key}`)
                const pcb = parse(text).find(n => head(n) === 'kicad_pcb')
                if (!pcb) return null
                const names = {}
                for (const n of pcb.filter(c => head(c) === 'net')) names[n[1]] = str(n[2])
                const pins = {}
                for (const fp of pcb.filter(c => head(c) === 'footprint')) {
                    const ref = fp.find(c => (head(c) === 'property' && str(c[1]) === 'Reference') || (head(c) === 'fp_text' && c[1] === 'reference'))
                    if (!ref) continue
                    const byNumber = pins[str(ref[2])] = {}
                    for (const pad of fp.filter(c => head(c) === 'pad')) {
                        const net = child(pad, 'net')
                        const number = str(pad[1])
                        ;(byNumber[number] = byNumber[number] || []).push({
                            name: net && (net.length > 2 ? str(net[2]) : names[net[1]]),
                            pinfunction: str(child(pad, 'pinfunction')?.[1]),
                            pintype: str(child(pad, 'pintype')?.[1])
                        })
                    }
                }
                return {names, pins}
            })
            .catch(error => {
                moduleNetCache.delete(key)
                throw error
            }))
    }
    return moduleNetCache.get(key)
}

// KicadGen makes every module a sheet named after it, so the module's local nets get that path
const sheetNet = (module, name) => name && name.startsWith('/') ? `/${module}${name}` : name

// KicadGen wires each switch and its diode rows to columns (layout2schematic.place_row_to_column), the row and
// column nets being row_net / column_net if set, else the row / column name (utils.get_zone_row_column_net)
const matrixPins = (prefix, meta) => {
    const link = `Net-(D${meta.index}-A)`
    const row = 'row_net' in meta ? meta.row_net : meta.row_name
    const column = 'column_net' in meta ? meta.column_net : meta.column_name
    return prefix === 'SW'
        ? {'1': [{name: link, pinfunction: '1', pintype: 'passive'}], '2': [{name: row, pinfunction: '2', pintype: 'passive'}]}
        : {'1': [{name: column, pinfunction: 'K', pintype: 'passive'}], '2': [{name: link, pinfunction: 'A', pintype: 'passive'}]}
}

// KicadGen/kbplacer use "<lib dir>:<name>", e.g. ErgoCai.pretty:R_0603_1608Metric
const footprintName = (what) => {
    const file = normalizeWhat(what)?.github?.file || String(what)
    const parts = file.replace(/\.kicad_mod$/, '').split('/')
    return parts.length > 1 ? parts.slice(-2).join(':') : parts[0]
}

const collectParts = (pcb) => {
    const parts = []
    const entries = Object.entries(pcb.footprints || {})
    const role = key => SCHEMATIC_PARTS.find(([prefix]) => key.startsWith(prefix))
    const last = {}
    for (const [key, fp] of entries) {
        const r = role(key)
        if (r) last[`${r[0]}|${fp.point.meta.name}`] = key
    }
    for (const [key, fp] of entries) {
        const r = role(key)
        if (r && last[`${r[0]}|${fp.point.meta.name}`] !== key) continue
        parts.push({what: fp.config.what, point: fp.point, side: fp.config.side,
            reference: r ? r[1] + fp.point.meta.index : key, pins: r && matrixPins(r[1], fp.point.meta)})
    }
    for (const [module, mod] of Object.entries(pcb.modules || {})) {
        for (const [reference, fp] of Object.entries(mod.footprints || {})) {
            parts.push({what: fp.config.what, point: fp.point, side: fp.config.side, reference, value: fp.config.what?.value, module})
        }
    }
    return parts
}

const edgeCuts = (model) => {
    const items = []
    if (!model) return items
    const xy = p => [num(p[0]), num(-p[1])]
    const style = () => [['stroke', ['width', '0.15'], ['type', 'default']], ['layer', {q: 'Edge.Cuts'}]]
    m.model.walk(model, {
        onPath: wp => {
            const p = m.path.clone(wp.pathContext, wp.offset)
            if (p.type === 'line') {
                items.push(['gr_line', ['start', ...xy(p.origin)], ['end', ...xy(p.end)], ...style()])
            } else if (p.type === 'arc') {
                const start = p.startAngle
                const end = p.endAngle < start ? p.endAngle + 360 : p.endAngle
                const at = a => xy(m.point.add(p.origin, m.point.fromPolar(a * Math.PI / 180, p.radius)))
                items.push(['gr_arc', ['start', ...at(start)], ['mid', ...at((start + end) / 2)], ['end', ...at(end)], ...style()])
            } else if (p.type === 'circle') {
                items.push(['gr_circle', ['center', ...xy(p.origin)], ['end', ...xy([p.origin[0] + p.radius, p.origin[1]])], ...style()])
            }
        }
    })
    return items
}

// module copper, already in board coordinates (pcbs.js processModules); nets: module name -> loadModuleNets result
const moduleCopper = (pcb, nets, code) => {
    const items = []
    for (const [module, mod] of Object.entries(pcb.modules || {})) {
        const net = n => String(code(sheetNet(module, nets[module]?.names[n])))
        for (const s of mod.segments || []) {
            items.push(['segment', ['start', num(s.start.x), num(s.start.y)], ['end', num(s.end.x), num(s.end.y)],
                ['width', num(+s.width)], ['layer', {q: s.layer}], ['net', net(s.net)]])
        }
        for (const v of mod.vias || []) {
            items.push(['via', ['at', num(v.at.x), num(v.at.y)], ['size', num(+v.size.w)], ['drill', num(+v.drill)],
                ['layers', {q: 'F.Cu'}, {q: 'B.Cu'}], ['net', net(v.net)]])
        }
    }
    return items
}

const HEADER = `(kicad_pcb
	(version 20241229)
	(generator "ergogen")
	(generator_version "9.0")
	(general
		(thickness 1.6)
		(legacy_teardrops no)
	)
	(paper "A4")
	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(9 "F.Adhes" user "F.Adhesive")
		(11 "B.Adhes" user "B.Adhesive")
		(13 "F.Paste" user)
		(15 "B.Paste" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(7 "B.SilkS" user "B.Silkscreen")
		(1 "F.Mask" user)
		(3 "B.Mask" user)
		(17 "Dwgs.User" user "User.Drawings")
		(19 "Cmts.User" user "User.Comments")
		(21 "Eco1.User" user "User.Eco1")
		(23 "Eco2.User" user "User.Eco2")
		(25 "Edge.Cuts" user)
		(27 "Margin" user)
		(31 "F.CrtYd" user "F.Courtyard")
		(29 "B.CrtYd" user "B.Courtyard")
		(35 "F.Fab" user)
		(33 "B.Fab" user)
		(39 "User.1" user)
		(41 "User.2" user)
		(43 "User.3" user)
		(45 "User.4" user)
	)
	(setup
		(pad_to_mask_clearance 0)
	)
	(net 0 "")
`

// nets: [name of net 1, name of net 2, ...]
const board = exports.board = (items, nets = []) => HEADER
    + nets.map((name, i) => `\t${serialize(['net', String(i + 1), {q: name}])}\n`).join('')
    + items.map(item => '\t' + serialize(item, '\t', 1)).join('\n') + '\n)\n'

const uuidFor = i => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`

// `pcb` is one entry of pcbs.js's output: {footprints, modules, outlines}
exports.build = async (pcb) => {
    const parts = collectParts(pcb)
    const mods = await Promise.all(parts.map(part => loadFootprint(part.what).catch(error => {
        console.error(`Preview board: cannot fetch footprint for ${part.reference}:`, error.message)
        return null
    })))
    const moduleNets = {}
    await Promise.all(Object.entries(pcb.modules || {}).map(([module, mod]) => loadModuleNets(mod.config && mod.config.what)
        .then(nets => { moduleNets[module] = nets })
        .catch(error => console.error(`Preview board: cannot read the nets of module ${module}:`, error.message))))
    const netNames = []
    const codes = new Map()
    const code = name => {
        if (!name) return 0
        if (!codes.has(name)) codes.set(name, netNames.push(name))
        return codes.get(name)
    }
    const items = parts.map((part, i) => {
        const name = footprintName(part.what)
        let pins = part.pins
        if (part.module) {
            const own = moduleNets[part.module]?.pins[part.reference] || {}
            pins = Object.fromEntries(Object.entries(own).map(([number, list]) =>
                [number, list.map(pin => ({...pin, name: sheetNet(part.module, pin.name)}))]))
        }
        return placeFootprint(mods[i] || placeholder(name), {
            name,
            x: part.point.x,
            y: -part.point.y,
            r: part.point.r || 0,
            back: (part.side || '').toLowerCase() === 'back',
            reference: part.reference,
            value: part.value,
            uuid: uuidFor(i + 1),
            pins,
            code
        })
    })
    items.push(...edgeCuts(pcb.outlines && pcb.outlines.raw), ...moduleCopper(pcb, moduleNets, code))
    return board(items, netNames)
}

exports.placeFootprint = placeFootprint
