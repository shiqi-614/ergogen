// Places each pcb's parts (config.pcbs) on the points: its footprints, from footprint files, and its modules, small
// boards (a .kicad_pcb each) whose footprints, tracks and vias come along. A pcb mirrored from another (mirror:
// from:) takes that pcb's parts, placed on the mirrored points. The KiCad board of each comes later
// (pcbs_preview.js, and kicadgen for the real project).
//
// Each result is {footprints, modules, outlines}: every footprint (or module) placed as {point, config}, and the
// board edge, the pcb's outlines stacked.

const m = require('makerjs')

const u = require('./utils')
const a = require('./assert')
const anchor = require('./anchor').parse
const filter = require('./filter').parse

const {normalizeWhat} = require('./kicad/fetcher')
const {parsePcbContent} = require('./kicad/pcb_extractor')
const outlines_lib = require('./outlines')

// A point of a module's board (a track's end, a via), in the board's coordinates, from where the module is: KiCad's
// y points down, and its angles turn the other way.
const fromModule = (point, at) => {
    const angle = -(at.r || 0) * Math.PI / 180
    return {
        x: at.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
        y: -at.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
    }
}

// --- modules ---

// A module's footprints: those of its board, with the config's own settings for each laid over them
const moduleFootprints = (moduleConfig, board) => {
    const footprints = {}
    for (const content of Object.values(board)) {
        const fromBoard = u.convertArrayFieldToObject(content, 'footprints')
        for (const [name, config] of Object.entries(fromBoard)) {
            footprints[name] = {...config, where: config?.where, what: normalizeWhat(config.what)}
        }
    }
    for (const [name, overrides] of Object.entries(moduleConfig.footprints || {})) {
        footprints[name] = {...(footprints[name] || {}), ...overrides}
    }
    return footprints
}

// A pcb's modules, read from their boards (downloaded together): what each is, where it goes, and what is on it.
// A pcb without modules (or footprints) has none.
const readModules = async (pcbConfig) => {
    pcbConfig.modules = u.convertArrayFieldToObject(pcbConfig, 'modules') || {}
    const entries = Object.entries(pcbConfig.modules)
    const boards = await Promise.all(entries.map(([, config]) => parsePcbContent(config)))
    const modules = {}
    entries.forEach(([name, config], i) => {
        modules[name] = {
            what: config.what,
            where: config.where,
            asym: config.asym || 'both',
            footprints: moduleFootprints(config, boards[i]),
            segments: boards[i].module.segments,
            vias: boards[i].module.vias,
        }
    })
    return modules
}

// Each module at its one point, its footprints, tracks and vias moved along with it. A footprint that can't be placed
// fails the run, or with errors (the tolerant mode) is noted there and left out.
const placeModules = (pcbName, modules, points, units, errors) => {
    const placed = {}
    for (const [name, module] of Object.entries(modules)) {
        const path = `pcbs.${pcbName}.modules.${name}`
        const where = filter(module.where, `${path}.where`, points, units)
        if (where.length !== 1) {
            throw new Error(`Module '${name}' must have exactly one 'where' point (got ${where.length}).`)
        }
        const at = where[0]
        const footprints = {}
        for (const [fpName, config] of Object.entries(module.footprints)) {
            u.attemptSync(errors, `${path}.footprints.${fpName}`, () => {
                footprints[fpName] = {point: u.pointOnModule(at, config.where), config}
            })
        }
        placed[name] = {
            point: at,
            config: {what: module.what},
            footprints,
            segments: (module.segments || []).map(seg => ({...seg, start: fromModule(seg.start, at), end: fromModule(seg.end, at)})),
            vias: (module.vias || []).map(via => ({...via, at: fromModule(via.at, at)})),
        }
    }
    return placed
}

// --- footprints ---

// A footprint entry on each of its where points (adjusted). Each point notes the footprint it carries, for the points'
// metadata.
const placeEntry = (name, config, path, points, units) => {
    a.typeCheck(config, path, 'object')
    const where = filter(config.where, `${path}.where`, points, units)
    const adjust = start => anchor(config.adjust || {}, `${path}.adjust`, points, start)(units)
    const placed = []
    for (const w of where) {
        w.meta.footprints = w.meta.footprints || {}
        w.meta.footprints[name] = normalizeWhat(config.what)
        const point = adjust(w.clone())
        // the entry's first placement takes its name, the others its name and their key's index (a point that is no
        // key, a footprint at a coordinate say, has none: its place in the entry's list then)
        const index = point.meta?.index ?? placed.length
        const key = placed.some(p => p.key === name) ? `${name}_${index}` : name
        placed.push({key, entry: {point, config}})
    }
    return placed
}

// Every footprint entry placed, the first of a key kept. One that can't be placed fails the run, or with errors (the
// tolerant mode) is noted there and left out.
const placeFootprints = (pcbName, footprints, points, units, errors) => {
    const placed = {}
    for (const [name, config] of Object.entries(footprints)) {
        const path = `pcbs.${pcbName}.footprints.${name}`
        u.attemptSync(errors, path, () => {
            for (const {key, entry} of placeEntry(name, config, path, points, units)) {
                if (!(key in placed)) placed[key] = entry
            }
        })
    }
    return placed
}

// --- the board edge ---

const pathsOf = model => {
    const paths = []
    m.model.walk(model, {onPath: walk => paths.push(walk.pathContext)})
    return paths
}

// The pcb's outlines (pcbs.<pcb>.outlines, each naming one) stacked into its board edge; a mirrored pcb's are mirrored
const boardEdge = (results, pcbConfig, pcbName, points, units) => {
    if (a.type(pcbConfig.outlines)() === 'array') pcbConfig.outlines = {...pcbConfig.outlines}
    const entries = a.typeCheck(pcbConfig.outlines || {}, `pcbs.${pcbName}.outlines`, 'object')
    let edge
    for (const [key, entry] of Object.entries(entries)) {
        const name = a.in(entry.outline, `pcbs.${pcbName}.outlines.${key}.outline`, Object.keys(results.outlines))
        const outline = pcbConfig.mirror
            ? u.deepcopy(outlines_lib.mirrored(results.config.outlines || {}, points, units, results.errors)[name])
            : results.outlines[name].raw
        edge = u.stack(edge, outline)
    }
    return {raw: edge, paths: pathsOf(edge)}
}

// --- every pcb ---

exports.parse = async (results, points, units) => {
    const config = results.config
    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const pcbs = {}
    const {mirror_points, normal_points} = u.splitMirrorPoints(points)

    // a config without pcbs has none
    for (const [name, pcbConfig] of Object.entries(config.pcbs || {})) {
        // with results.errors (the tolerant mode), a pcb that fails is left out and the others go on
        await u.attempt(results.errors, `pcbs.${name}`, async () => {
            const mirrored = !!pcbConfig.mirror
            // a mirrored pcb has the parts of the pcb it mirrors, on the mirrored points, but the source half's own
            // (asym: source); the other way round, an unmirrored one leaves out the clone half's
            const source = mirrored ? config.pcbs[pcbConfig.mirror.from] : pcbConfig
            const onPoints = mirrored ? mirror_points : normal_points
            const leaveOut = mirrored ? 'source' : 'clone'
            if (mirrored) pcbConfig.outlines = pcbConfig.outlines || source.outlines || {}

            const footprints = u.convertArrayFieldToObject(source, 'footprints') || {}
            const modules = await readModules(source)
            const pcb = pcbs[name] = {}
            pcb.modules = placeModules(name, u.filterByAsym(modules, leaveOut), onPoints, units, results.errors)
            pcb.footprints = placeFootprints(name, u.filterByAsym(footprints, leaveOut), onPoints, units, results.errors)
            if (mirrored) {
                // the mirrored points carry the footprints placed on them, like the points they mirror
                for (const [key, point] of Object.entries(mirror_points)) {
                    const original = points[`mirror_${key}`].meta
                    original.footprints = point.meta.footprints
                    original.column_name = point.meta.column_name
                    original.row_name = point.meta.row_name
                }
            }
            pcb.outlines = boardEdge(results, pcbConfig, name, points, units)
        })
        if (results.errors && results.errors[`pcbs.${name}`]) delete pcbs[name]
    }
    return pcbs
}
