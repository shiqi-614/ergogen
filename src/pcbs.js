const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const prep = require('./prepare')
const anchor = require('./anchor').parse
const filter = require('./filter').parse


const footprint_types = require('./footprints')
const template_types = require('./templates')

const { fetchFootprintTypes } = require('./kicad/footprint_types');

exports.inject_footprint = (name, fp) => {
    footprint_types[name] = fp
}

exports.inject_template = (name, t) => {
    template_types[name] = t
}

// const footprint_library = kicad_mod_parser.parse();

const outline = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['name', 'origin'])
    a.assert(outlines[config.name], `Field "${name}.name" does not name an existing outline!`)
    const origin = anchor(config.origin || {}, `${name}.origin`, points)(units)
    
    // return shape function and its units
    return [() => {
        let o = u.deepcopy(outlines[config.name])
        o = origin.unposition(o)
        const bbox = m.measure.modelExtents(o)
        return [o, bbox]
    }, units]
} 


exports.parse = async (config, points, outlines, units) => {
            

    const footprintTypes = await fetchFootprintTypes();
    const pcbs = a.sane(config.pcbs || {}, 'pcbs', 'object')()
    const results = {}

    for (const [pcb_name, pcb_config] of Object.entries(pcbs)) {
        results[pcb_name] = {};

        // config sanitization
        a.unexpected(pcb_config, `pcbs.${pcb_name}`, ['outlines', 'footprints', 'references', 'template', 'params'])
        const references = a.sane(pcb_config.references || false, `pcbs.${pcb_name}.references`, 'boolean')()
        const template = template_types[a.in(pcb_config.template || 'kicad5', `pcbs.${pcb_name}.template`, Object.keys(template_types))]


        // generate footprints
        if (a.type(pcb_config.footprints)() == 'array') {
            pcb_config.footprints = {...pcb_config.footprints}
        }

        const footprints_config = a.sane(pcb_config.footprints || {}, `pcbs.${pcb_name}.footprints`, 'object')()
        for (const [f_name, f] of Object.entries(footprints_config)) {
            const name = `pcbs.${pcb_name}.footprints.${f_name}`
            console.log("footprint name: " + name);
            a.sane(f, name, 'object')()
            try {
                const asym = a.asym(f.asym || 'source', `${name}.asym`)
                const where = filter(f.where, `${name}.where`, points, units, asym)
                const original_adjust = f.adjust // need to save, so the delete's don't get rid of it below
                const adjust = start => anchor(original_adjust || {}, `${name}.adjust`, points, start)(units)
                for (const w of where) {
                    const point = adjust(w.clone())
                    point.meta.footprint = f.what;
                    point.meta.name = f_name;
                    point.side = "Front";
                    if (f.side) {
                        point.side = f.side;
                    }
                    var type = "others";
                    if (f.what in footprintTypes) {
                        type = footprintTypes[f.what];
                    } 
                    if (!results[pcb_name][type]) {
                        results[pcb_name][type] = [];
                    }
                    console.log(`add point to ${pcb_name} ${type}`)
                    results[pcb_name][type].push(point);
                }
            } catch (error) {
                console.error('Error place footprint:', error);
            }
        }
    }


    return results
}
