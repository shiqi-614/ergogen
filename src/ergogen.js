// ergogen: a config (YAML, JSON or KLE) in, everything it describes out. In order: the units, the key points, the
// outlines, the pcbs (their parts placed, then a KiCad board each to preview), the KiCad projects (only when asked
// for: a "Generate" on the server, through kicadgen), the cases and the assemblies.
//
// With options.tolerant (ergogen-gui's preview), every outline, pcb, case and assembly is made on its own: one that
// fails is noted in results.errors under its name (e.g. "pcbs.left": the message) and the others are still made.
// Points stay all or nothing, everything else is made of them. Without it, any failure fails the run, as before.
// With options.skip: ['cases'], the cases (the slowest part, solids and STL) and the assemblies made of them are
// left out, for a host that shows something else for now.

const u = require('./utils')
const io = require('./io')
const prepare = require('./prepare')
const units_lib = require('./units')
const points_lib = require('./points')
const outlines_lib = require('./outlines')
const cases_lib = require('./cases')
const assemblies_lib = require('./assemblies')
const pcbs_lib = require('./pcbs')
const pcbs_preview_lib = require('./pcbs_preview')
const axios = require('axios')
const stage_configs = require('./stage_configs')
const github = require('./kicad/github_fetcher')
const version = require('../package.json').version

// the config as read, expanded: dotted keys nested, $extends merged, parameters filled in
const readConfig = (raw, logger) => {
    const [read, format] = io.interpret(raw, logger)
    logger('Interpreting format: ' + format)
    logger('Preprocessing input...')
    return prepare.parameterize(prepare.inherit(prepare.unnest(read)))
}

const checkEngine = (config, logger) => {
    if (!config.meta || !config.meta.engine) return
    logger('Checking compatibility...')
    const engine = u.semver(config.meta.engine, 'config.meta.engine')
    if (!u.satisfies(version, engine)) {
        throw new Error(`Current ergogen version (${version}) doesn't satisfy config's engine requirement (${config.meta.engine})!`)
    }
}

// The units, points, outlines and pcbs (their parts placed). A run that would show nothing (every outline a hidden
// "_" one, no pcbs) is made again in debug mode, which shows everything.
const processBasic = async (raw, debug = false, logger = () => {}, options = {}) => {
    const config = readConfig(raw, logger)
    // the config's text as given: what a host sent along with it (config.raw), or the text itself; none for an object
    const text = config.raw !== undefined ? config.raw : typeof raw === 'string' ? raw : undefined
    const results = text === undefined ? {} : {raw: text}
    delete config.raw
    results.canonical = u.deepcopy(config)
    results.config = config
    if (options.tolerant) results.errors = {}

    checkEngine(config, logger)

    logger('Calculating variables...')
    const units = units_lib.parse(config)
    if (debug) results.units = units

    logger('Parsing points...')
    if (!config.points) throw new Error('Input does not contain a points clause!')
    const points = points_lib.parse(config.points, units)
    if (!Object.keys(points).length) throw new Error('Input does not contain any points!')
    if (debug) {
        results.points = points
        results.demo = io.twodee(points_lib.visualize(points, units), debug)
    }

    logger('Generating outlines...')
    const outlines = outlines_lib.parse(config.outlines || {}, points, units, results.errors)
    results.outlines = {}
    for (const [name, outline] of Object.entries(outlines)) {
        if (!debug && name.startsWith('_')) continue
        results.outlines[name] = io.twodee(outline, debug)
    }

    logger('Scaffolding PCBs...')
    results.pcbs = {...await pcbs_lib.parse(results, points, units)}
    results.points = points

    const empty = !Object.keys(results.outlines).length && !Object.keys(results.pcbs).length
    if (!debug && empty) {
        logger('Output would be empty, rerunning in debug mode...')
        const shown = await processBasic(raw, true, () => {}, options)
        inDebug.add(shown)
        return shown
    }
    if (debug) inDebug.add(results)
    return results
}

// the results made in debug mode, which show the "_" pcbs too
const inDebug = new WeakSet()

// The "_" pcbs, like the "_" outlines and cases, are for the others to use (their footprints for the cases' cuts, the
// assemblies' boards) and left out of what is shown, but in debug mode
const hidePrivate = results => {
    if (inDebug.has(results)) return results
    for (const name of Object.keys(results.pcbs || {})) if (name.startsWith('_')) delete results.pcbs[name]
    return results
}

// The KiCad project of every pcb, from kicadgen (the server's "Generate"): a zip each, base64. A failure is logged
// and leaves the projects out.
const kicadProjects = async (results, logger) => {
    logger('Creating KiCad Project...' + stage_configs.KICADGEN_API_URL)
    try {
        results.kicad = {}
        const {mirror_points, normal_points} = u.splitMirrorPoints(results.points)
        for (const [name, pcbConfig] of Object.entries(results.canonical.pcbs)) {
            // a mirrored pcb is placed on the mirrored points
            const points = pcbConfig.mirror ? mirror_points : normal_points
            const response = await axios.post(stage_configs.KICADGEN_API_URL,
                {points, pcb: {name}, results},
                {headers: {'Content-Type': 'application/json'}, responseType: 'arraybuffer'})
            results.kicad[name] = Buffer.from(response.data, 'binary').toString('base64')
        }
        logger('Create KiCad Project without error.')
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error)
    }
}

// Everything: what processBasic makes, then each pcb's KiCad preview board, the KiCad projects when asked for (a
// config with is_preview: false), the cases and the assemblies
const process = async (raw, debug = false, logger = () => {}, options = {}) => {
    const results = await processBasic(raw, debug, logger, options)

    logger('Preview PCBs...')
    const previews = await pcbs_preview_lib.parse(results.config, results.pcbs, results.errors)
    for (const [name, preview] of Object.entries(previews)) {
        results.pcbs[name].preview = {kicad_pcb: preview.kicad_pcb}
    }
    results.demo = io.twodee(points_lib.visualize(results.points, results.units), inDebug.has(results))

    if (results.canonical?.is_preview === false) await kicadProjects(results, logger)

    if ((options.skip || []).includes('cases')) {
        logger('Leaving out the cases and the assemblies, as asked')
        return hidePrivate(results)
    }

    logger('Modeling cases...')
    const cases = await cases_lib.parse(results.config, results.config.cases || {}, results.outlines, previews, results.points, results.units, results.errors)
    results.cases = {}
    for (const [name, made] of Object.entries(cases)) {
        if (!debug && name.startsWith('_')) continue
        results.cases[name] = {stl: made.stl, parts: made.parts}
    }

    if (results.config.assemblies) {
        logger('Stacking assemblies...')
        results.assemblies = assemblies_lib.parse(results.config.assemblies, results.cases, results.pcbs, units_lib.parse(results.config), results.errors)
    }
    return hidePrivate(results)
}

// Upstream ergogen's footprint and template injection (JavaScript footprints). This fork's footprints are KiCad
// files (what: github), so there is nothing to inject into: a call says so.
const inject = (type, name) => {
    throw new Error(`Injecting ${name === undefined ? 'a footprint' : `the ${type} "${name}"`} is not supported: `
        + 'this ergogen takes its footprints from KiCad files (what: github)')
}

module.exports = {
    version,
    process,
    processBasic,
    inject,
    // the GitHub files the footprints come from, for a host that reads more of those repos (3D models)
    github: {
        checkRepo: github.checkRepo,
        blobOf: github.blobOf,
        rawUrl: github.rawUrl,
    },
}
