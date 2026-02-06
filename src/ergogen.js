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
const axios = require('axios');
const stage_configs = require('./stage_configs');
const version = require('../package.json').version

const processBasic = async (raw, debug=false, logger=()=>{}) => {
    const prefix = 'Interpreting format: '
    let empty = true
    let [config, format] = io.interpret(raw, logger)
    let suffix = format
    logger(prefix + suffix)
    
    logger('Preprocessing input...')
    config = prepare.unnest(config)
    config = prepare.inherit(config)
    config = prepare.parameterize(config)
    const results = {}
    if (debug) {
        results.raw = raw;
    }

    results.canonical = u.deepcopy(config)

    if (config.meta && config.meta.engine) {
        logger('Checking compatibility...')
        const engine = u.semver(config.meta.engine, 'config.meta.engine')
        if (!u.satisfies(version, engine)) {
            throw new Error(`Current ergogen version (${version}) doesn\'t satisfy config's engine requirement (${config.meta.engine})!`)
        }
    }
    results.config = config;

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

    logger('Scaffolding PCBs...')
    const pcbs = await pcbs_lib.parse(config, points, units)
    results.pcbs = {}
    for (const [pcb_name, pcb_text] of Object.entries(pcbs)) {
        results.pcbs[pcb_name] = pcb_text
        empty = false
    }
    results.points = points;

    if (!debug && empty) {
        logger('Output would be empty, rerunning in debug mode...')
        return processBasic(raw, true, () => {})
    }
    return results
}

const process = async (raw, debug=false, logger=()=>{}) => {
    const results = await processBasic(raw, debug, logger);
    
    logger('Preview PCBs...')
    const previews = await pcbs_preview_lib.parse(results.canonical, results.pcbs, results.outlines, results.units)
    for (const [pcb_name, preview] of Object.entries(previews)) {
        console.log("preview: " + pcb_name);
        results.pcbs[pcb_name]['preview'] = io.twodee(preview['preview'], debug);
    }
    results.demo = io.twodee(points_lib.visualize(results.points, results.units), debug);

    if (results.canonical?.is_preview === false) {
        logger("Creating KiCad Project...")
        try {
            results.kicad = {};
            for (const [pcb_name, pcb_config] of Object.entries(results.canonical.pcbs)) {
                const response = await axios.post(stage_configs.KICADGEN_API_URL, 
                    {
                        "points": results.points,
                        "pcb" : {
                            "name": pcb_name,
                            "config": pcb_config
                        }
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        responseType: 'arraybuffer'
                    }
                );
                const zipBuffer = Buffer.from(response.data, 'binary').toString('base64');
                results.kicad[pcb_name] = zipBuffer;
            }
            logger("Create KiCad Project without error.")
        } catch (error) {
            console.error('There was a problem with the fetch operation:', error);
        }
    }

    console.log('Modeling cases...')
    const cases = await cases_lib.parse(results.config.cases || {}, results.outlines, previews, results.units)
    results.cases = {}
    for (const [case_name, case_script] of Object.entries(cases)) {
        if (!debug && case_name.startsWith('_')) continue
        results.cases[case_name] = {jscad: case_script}
    }
    console.log('Modeling cases done.')
    return results;
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
    processBasic,
    inject
}
