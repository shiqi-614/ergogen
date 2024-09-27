const u = require('./utils')
const io = require('./io')
const prepare = require('./prepare')
const yaml = require('js-yaml')
const units_lib = require('./units')
const points_lib = require('./points')
const outlines_lib = require('./outlines')
const cases_lib = require('./cases')
const pcbs_lib = require('./pcbs')
const pcbs_preview_lib = require('./pcbs_preview')
const fs = require('fs');
// const fetch = require('node-fetch');
// import fetch from 'node-fetch';
const axios = require('axios');



const version = require('../package.json').version

function isNode() {
    return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

const process = async (raw, debug=false, logger=()=>{}) => {

    const prefix = 'Interpreting format: '
    let empty = true
    let [config, format] = io.interpret(raw, logger)
    let suffix = format
    // KLE conversion warrants automaticly engaging debug mode
    // as, usually, we're only interested in the points anyway
    if (format == 'KLE') {
        suffix = `${format} (Auto-debug)`
        debug = true
    }
    logger(prefix + suffix)
    
    logger('Preprocessing input...')
    config = prepare.unnest(config)
    config = prepare.inherit(config)
    config = prepare.parameterize(config)
    const results = {}
    if (debug) {
        results.raw = raw
        results.canonical = u.deepcopy(config)
    }

    if (config.meta && config.meta.engine) {
        logger('Checking compatibility...')
        const engine = u.semver(config.meta.engine, 'config.meta.engine')
        if (!u.satisfies(version, engine)) {
            throw new Error(`Current ergogen version (${version}) doesn\'t satisfy config's engine requirement (${config.meta.engine})!`)
        }
    }

    logger('Calculating variables...')
    const units = units_lib.parse(config)
    if (debug) {
        results.units = units
    }
    
    logger('Parsing points...')
    if (!config.points) {
        throw new Error('Input does not contain a points clause!')
    }
    const points = points_lib.parse(config.points, units)
    if (!Object.keys(points).length) {
        throw new Error('Input does not contain any points!')
    }
    if (debug) {
        results.points = points
        results.demo = io.twodee(points_lib.visualize(points, units), debug)
    }

    logger('Generating outlines...')
    const outlines = outlines_lib.parse(config.outlines || {}, points, units)
    results.outlines = {}
    for (const [name, outline] of Object.entries(outlines)) {
        if (!debug && name.startsWith('_')) continue
        results.outlines[name] = io.twodee(outline, debug)
        empty = false
    }

    logger('Modeling cases...')
    const cases = cases_lib.parse(config.cases || {}, outlines, units)
    results.cases = {}
    for (const [case_name, case_script] of Object.entries(cases)) {
        if (!debug && case_name.startsWith('_')) continue
        results.cases[case_name] = {jscad: case_script}
        empty = false
    }

    // logger('Scaffolding PCBs...')
    // const pcbs = pcbs_lib.parse(config, points, outlines, units)
    // results.pcbs = {}
    // for (const [pcb_name, pcb_text] of Object.entries(pcbs)) {
        // if (!debug && pcb_name.startsWith('_')) continue
        // results.pcbs[pcb_name] = pcb_text
        // empty = false
    // }

    logger('Preview PCBs...')
    const pcbs_preview = await pcbs_preview_lib.parse(config, points, outlines, units)
    results.pcbs_preview = {}
    for (const [pcb_name, pcb_text] of Object.entries(pcbs_preview)) {
        console.log("preview: " + pcb_name);
        // if (!debug && pcb_name.startsWith('_')) continue
        results.pcbs_preview[pcb_name] = io.twodee(pcb_text, debug);
        empty = false
    }
    results.points = points
    results.demo = io.twodee(points_lib.visualize(points, units), debug)

    logger("Creating KiCad Project...")

    try {
        const response = await axios.post('http://127.0.0.1:5001/generate', 
            points,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );
        // console.log('Response:', response.data);
        const buffer = Buffer.from(response.data); // Convert ArrayBuffer to Node.js Buffer
        results.zipBuffer = buffer;

        logger("Create KiCad Project without error.")
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
    }

    if (!debug && empty) {
        logger('Output would be empty, rerunning in debug mode...')
        return process(raw, true, () => {})
    }
    return results
}

const inject = (type, name, value) => {
    if (value === undefined) {
        value = name
        name = type
        type = 'footprint'
    }
    switch (type) {
        case 'footprint':
            return pcbs_lib.inject_footprint(name, value)
        case 'template':
            return pcbs_lib.inject_template(name, value)
        default:
            throw new Error(`Unknown injection type "${type}" with name "${name}" and value "${value}"!`)
    }
}

module.exports = {
    version,
    process,
    inject
}
