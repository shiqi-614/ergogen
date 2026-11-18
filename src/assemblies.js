// How case parts and a board fit together, for showing them together (ergogen-gui's 3D board view):
// config.assemblies, each a stack of case parts from the bottom up, every part sitting on the one below it, and
// the board it holds.
//
//   assemblies:
//     right:
//       stack: [right_buttom, right_gap, ...]   # an entry can also be {name, gap, z}: space below the part, or
//                                               # the height of its bottom (the parts above stack on from there)
//       pcb:                                    # or just its name, to lie at z = 0
//         name: ergo_cai_right
//         top: right_gap                        # its top level with that part's top; or `on: <part>`, lying on
//                                               # it; or `z: <height>` of its bottom. `shift` moves it up or down
//       parts:                                  # other 3D models, e.g. a module board on standoffs
//         - name: e-paper
//           model: "${ERGOCAI_MODULES}/e-paper/2.13inch/2.13inch.glb"   # a model path, as footprints name them
//           module: e-paper                     # at that module of the pcb, turned with it
//           z: 30                               # the height of the model's z = 0
//
// Each result is {pcb, layers: [{name, z, height}], parts: [{name, model, x, y, r, z}]}, z being a bottom's height,
// and pcb null or {name, z, thickness, shift, top, on}: how it was placed, for a host that moves it and writes the
// config back. A case part's height is the top of its solid, which cases.js extrudes up from z = 0.
const a = require('./assert')
const u = require('./utils')

// the preview board's thickness (kicad/preview_pcb.js)
const PCB_THICKNESS = 1.6

const stlTop = (stl) => {
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    const count = view.getUint32(80, true)
    let top = 0
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) top = Math.max(top, view.getFloat32(84 + 50 * i + 12 + 12 * k + 8, true))
    }
    return top
}

const parseStack = (stack, name, cases, units) => {
    const layers = []
    let z = 0
    stack.forEach((raw, i) => {
        const entry = a.type(raw)() === 'string' ? {name: raw} : raw
        const qname = `${name}.stack[${i}]`
        a.sane(entry, qname, 'object')()
        a.unexpected(entry, qname, ['name', 'gap', 'z'])
        const part = a.in(entry.name, `${qname}.name`, Object.keys(cases))
        if (entry.z !== undefined) z = a.sane(entry.z, `${qname}.z`, 'number')(units)
        z += a.sane(entry.gap || 0, `${qname}.gap`, 'number')(units)
        const height = stlTop(cases[part].stl)
        layers.push({name: part, z, height})
        z += height
    })
    return layers
}

const parsePcb = (raw, name, layers, pcbs, units) => {
    const pcb = a.type(raw)() === 'string' ? {name: raw} : raw
    a.sane(pcb, name, 'object')()
    a.unexpected(pcb, name, ['name', 'top', 'on', 'z', 'shift'])
    const pcb_name = a.in(pcb.name, `${name}.name`, Object.keys(pcbs))
    const placing = ['top', 'on', 'z'].filter(key => pcb[key] !== undefined)
    a.assert(placing.length <= 1, `Field "${name}" can only have one of top, on and z!`)
    const layer = key => {
        const part = a.in(pcb[key], `${name}.${key}`, layers.map(l => l.name))
        return layers.find(l => l.name === part)
    }
    let z = 0
    if (pcb.top !== undefined) {
        const l = layer('top')
        z = l.z + l.height - PCB_THICKNESS
    } else if (pcb.on !== undefined) {
        const l = layer('on')
        z = l.z + l.height
    } else if (pcb.z !== undefined) {
        z = a.sane(pcb.z, `${name}.z`, 'number')(units)
    }
    const shift = a.sane(pcb.shift || 0, `${name}.shift`, 'number')(units)
    return {name: pcb_name, z: z + shift, thickness: PCB_THICKNESS, shift, top: pcb.top || null, on: pcb.on || null}
}

const parseParts = (raw, name, pcb, pcbs, units) => a.sane(raw, name, 'array')().map((part, i) => {
    const qname = `${name}[${i}]`
    a.sane(part, qname, 'object')()
    a.unexpected(part, qname, ['name', 'model', 'module', 'z'])
    const model = a.sane(part.model, `${qname}.model`, 'string')()
    let [x, y, r] = [0, 0, 0]
    if (part.module !== undefined) {
        a.assert(pcb, `Field "${qname}.module" needs the assembly's pcb!`)
        const modules = pcbs[pcb.name].modules || {}
        const point = modules[a.in(part.module, `${qname}.module`, Object.keys(modules))].point
        ;[x, y, r] = [point.x, point.y, point.r || 0]
    }
    return {name: part.name || model.split('/').pop(), model, x, y, r, z: a.sane(part.z || 0, `${qname}.z`, 'number')(units)}
})

// cases: ergogen's case results ({name: {stl}}), pcbs: its pcb results
exports.parse = (config, cases, pcbs, units, errors) => {
    a.sane(config, 'assemblies', 'object')()
    const results = {}
    for (const [name, assembly] of Object.entries(config)) {
        const qname = `assemblies.${name}`
        // with errors (the tolerant mode), an assembly that fails is left out and the others go on
        u.attemptSync(errors, qname, () => {
            a.sane(assembly, qname, 'object')()
            a.unexpected(assembly, qname, ['stack', 'pcb', 'parts'])
            const layers = parseStack(a.sane(assembly.stack || [], `${qname}.stack`, 'array')(), qname, cases, units)
            const pcb = assembly.pcb === undefined ? null : parsePcb(assembly.pcb, `${qname}.pcb`, layers, pcbs, units)
            const parts = parseParts(assembly.parts || [], `${qname}.parts`, pcb, pcbs, units)
            results[name] = {pcb, layers, parts}
        })
    }
    return results
}
