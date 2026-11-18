// A KiCad 9 board for previewing a pcb (e.g. in KiCanvas) before KiCad is involved: every library
// footprint is placed the way ergo-kbplacer places it (place_footprint.js) and carries the reference it gets on the
// real board, its pads on the nets KicadGen's schematic gives them; module boards bring their tracks and vias; the
// board edge is the pcb's outlines.
const m = require('makerjs')
const { parse, serialize, head, str, child } = require('./sexpr')
const { num, placeFootprint, placeholder } = require('./place_footprint')
const { fetchWhat, normalizeWhat, checkRepo } = require('./fetcher')
const Cache = require('./cache')

// KicadGen puts one switch SW<index> and one diode D<index> per point into the schematic, taking the
// last footprint whose name starts with "key" / "diode", and kbplacer places only those. kbplacer
// places every other footprint under its ergogen name; module footprints keep their module reference.
const SCHEMATIC_PARTS = [['key', 'SW'], ['diode', 'D']]

// A file a footprint's (or a module's) what names, read and parsed once: kept in memory, and dropped like the other
// caches when its repo changes the file (checkRepo). onError decides what a failed read leaves: a value to keep,
// or a throw (and the next build reads it again).
const cachedRead = (cache, readFrom, onError) => async (what) => {
    const github = normalizeWhat(what)?.github
    if (!github) return null
    const key = `${github.repo}/${github.file}`
    await checkRepo(github.repo)
    if (!cache.has(key)) {
        cache.set(key, fetchWhat(what)
            .then(text => {
                if (typeof text !== 'string') throw new Error(`unexpected response for ${key}`)
                return readFrom(parse(text))
            })
            .catch(error => {
                const kept = onError(error, key)
                if (kept !== undefined) return kept
                cache.delete(key)
                throw error
            }))
    }
    return cache.get(key)
}

// A library footprint: the footprint (or old-style module) in its .kicad_mod. A missing file stays missing until its
// repo changes; anything else is read again on the next build.
const loadFootprint = cachedRead(new Cache('preview_footprint', undefined, false),
    nodes => nodes.find(n => head(n) === 'footprint' || head(n) === 'module') || null,
    (error, key) => {
        if (error.response?.status !== 404) return undefined
        console.error(`Preview board: ${key} not found`)
        return null
    })

// A module board's pad nets, from its .kicad_pcb: {names: {net code: name}, pins: {reference: {pad number: [pin of
// the 1st pad with that number, of the 2nd, ...]}}}, a pin being {name, pinfunction, pintype}
const loadModuleNets = cachedRead(new Cache('preview_module_nets', undefined, false), nodes => {
    const pcb = nodes.find(n => head(n) === 'kicad_pcb')
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
}, () => undefined)

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
