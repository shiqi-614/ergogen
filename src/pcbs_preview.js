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

const { fetchKicadMod } = require('./kicad/mod_fetcher');
const { fetchFootprintTypes } = require('./kicad/footprint_types');
const kicad_shape_converter = require('./kicad/shape_converter')

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

async function footprint_shape(name) {
    console.log("draw footprint: " + name);
    const jsonObj = await fetchKicadMod(name);

    // console.log(JSON.stringify(jsonObj, null, 2));
    let [pathItems, modelItems] = kicad_shape_converter.convert(jsonObj.footprint);
    return () => {
        const res = {
            models: u.deepcopy(modelItems),
            paths: u.deepcopy(pathItems)
        };
        // console.log("res:" + JSON.stringify(res, null, 2));
        const bbox = m.measure.modelExtents(o);
        return [res, bbox]
    };
}


exports.parse = async (config, points, outlines, units) => {
            

    const footprintTypes = await fetchFootprintTypes();
    const pcbs = a.sane(config.pcbs || {}, 'pcbs', 'object')()
    const results = {}

    for (const [pcb_name, pcb_config] of Object.entries(pcbs)) {

        // config sanitization
        a.unexpected(pcb_config, `pcbs.${pcb_name}`, ['outlines', 'footprints', 'references', 'template', 'params'])
        const references = a.sane(pcb_config.references || false, `pcbs.${pcb_name}.references`, 'boolean')()
        const template = template_types[a.in(pcb_config.template || 'kicad5', `pcbs.${pcb_name}.template`, Object.keys(template_types))]

        // outline conversion
        if (a.type(pcb_config.outlines)() == 'array') {
            pcb_config.outlines = {...pcb_config.outlines}
        }
        const config_outlines = a.sane(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')()
        const kicad_outlines = {}
        for (const [outline_name, outline] of Object.entries(config_outlines)) {

            const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(outlines))
            const layer = a.sane(outline.layer || 'Edge.Cuts', `pcbs.${pcb_name}.outlines.${outline_name}.outline`, 'string')()
            const operation = u[a.in(outline.preview || 'stack', `${outline_name}.operation`, ['add', 'subtract', 'intersect', 'stack'])]
            results[pcb_name] = operation(results[pcb_name], outlines[ref])
        }

        // generate footprints
        if (a.type(pcb_config.footprints)() == 'array') {
            pcb_config.footprints = {...pcb_config.footprints}
        }
        // console.log("types");
        // console.log(JSON.stringify(footprintTypes));

        const footprints_config = a.sane(pcb_config.footprints || {}, `pcbs.${pcb_name}.footprints`, 'object')()
        for (const [f_name, f] of Object.entries(footprints_config)) {
            const name = `pcbs.${pcb_name}.footprints.${f_name}`
            // console.log("footprint f: " + JSON.stringify(f));
            a.sane(f, name, 'object')()
            try {
                const asym = a.asym(f.asym || 'source', `${name}.asym`)
                const where = filter(f.where, `${name}.where`, points, units, asym)
                const original_adjust = f.adjust // need to save, so the delete's don't get rid of it below
                const adjust = start => anchor(original_adjust || {}, `${name}.adjust`, points, start)(units)
                const shape_maker = await footprint_shape(f.what)
                for (const w of where) {
                    if (!w.meta.footprints) {
                        w.meta.footprints = {};
                    }
                    if (f.what in footprintTypes) {
                        const type = footprintTypes[f.what];
                        w.meta.footprints[type] = f.what;
                    }
                    const point = adjust(w.clone())
                    let [shape, bbox] = shape_maker(point) // point is passed for mirroring metadata only...
                    // console.log("share: " + JSON.stringify(shape, null, 2));
                    if (f.side == "Back") {
                        shape.layer = "olive";
                    } else {
                        shape.layer = "aqua";
                    }
                    shape = point.position(shape) // ...actual positioning happens here
                    const operation = u[a.in(f.preview || 'stack', `${f_name}.operation`, ['add', 'subtract', 'intersect', 'stack'])]
                    results[pcb_name] = operation(results[pcb_name], shape)
                    // console.log("preview shape: " + JSON.stringify(shape));
                }   
            } catch (error) {
                console.error('Error place footprint:', error);
            }

            // m.model.simplify(results[pcb_name]);
            m.model.originate(results[pcb_name])
            // console.log("final PCB:" + JSON.stringify(results[pcb_name]));
        }
    }

    return results
}
