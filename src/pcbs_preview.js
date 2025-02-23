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

const { fetchKicadMod, normalizeWhat, fetchWhat } = require('./kicad/fetcher');
const kicad_shape_converter = require('./kicad/shape_converter')

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

function flipVertically(res) {
    // 遍历 models 并垂直翻转
    if (res.models) {
        for (let key in res.models) {
            if (res.models.hasOwnProperty(key)) {
                res.models[key] = m.model.mirror(res.models[key], true, false); // 垂直翻转
                res.models[key] = m.model.rotate(res.models[key], 180);
            }
        }
    }

    // 遍历 paths 并垂直翻转
    if (res.paths) {
        for (let key in res.paths) {
            if (res.paths.hasOwnProperty(key)) {
                res.paths[key] = m.path.mirror(res.paths[key], true, false); // 垂直翻转
                res.paths[key] = m.path.rotate(res.paths[key], 180);
            }
        }
    }

    return res;
}

async function footprint_shape(footprintConfig) {
    console.log("draw footprint: " + footprintConfig.what);
    const jsonObj = await fetchKicadMod(footprintConfig.what);

    // console.log(JSON.stringify(jsonObj, null, 2));
    let [pathItems, modelItems] = kicad_shape_converter.convert(jsonObj.footprint);
    return () => {
        const res = {
            models: u.deepcopy(modelItems),
            paths: u.deepcopy(pathItems)
        };
        if (footprintConfig.side && footprintConfig.side.toLowerCase() === "back") {
            res.layer = "olive";
            flipVertically(res);
        } else {
            res.layer = "aqua";
        }
        // console.log("res:" + JSON.stringify(res, null, 2));
        const bbox = m.measure.modelExtents(o);
        return [res, bbox]
    };
}

function setFootprintInPoints(w, footprintConfig) {
    if (footprintConfig.meta && footprintConfig.meta.type) {
        if (!w.meta.footprints) {
            w.meta.footprints = {};
        }
        const type = footprintConfig.meta.type;
        w.meta.footprints[type] = normalizeWhat(footprintConfig.what);
    }

}

async function mergeFootprintsFromModules(pcb_name, pcb_config) {

    pcb_config.footprints = u.convertArrayFieldToObject(pcb_config, 'footprints');
    pcb_config.modules = u.convertArrayFieldToObject(pcb_config, 'modules');

    let footprints = pcb_config.footprints;

    for (const [name, moduleConfig] of Object.entries(pcb_config.modules)) {
        const footprintsFromModule = await getFootprintsFromModule(moduleConfig);

        footprints = {...footprints, ...footprintsFromModule}
    }
    return footprints

}

async function getFootprintsFromModule(moduleConfig) {
    const response = await fetchWhat(moduleConfig.what)
    const data = yaml.load(response)
    
    let footprints = {}
    for (const [name, content] of Object.entries(data)) {
        const subFootprints = u.convertArrayFieldToObject(content, 'footprints')
        for (const [name, footprintConfig] of Object.entries(subFootprints)) {
            footprintConfig.where = u.merge(moduleConfig?.where, footprintConfig?.where);
            footprintConfig.adjust = u.merge(moduleConfig?.adjust, footprintConfig?.adjust);
            if (footprintConfig.side == null) {
                footprintConfig.side = moduleConfig?.side;
            }
            footprints[name] = footprintConfig;
        }
        footprints = {...footprints, ...subFootprints};
    }

    if (moduleConfig.footprints) {
        for (const [name, footprintConfig] of Object.entries(moduleConfig.footprints)) {
            for (const [key, value] of Object.entries(footprintConfig)) {
                if (!footprints[name]) {
                    footprints[name] = {};
                }
                footprints[name][key] = value;

            }
        }
    }
    return footprints;

}

exports.parse = async (config, points, outlines, units) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const results = {}
    results['pcbs'] = {};

    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {

        let pcb = results.pcbs[pcb_name] = {};
        let preview;
        let footprints = pcb['footprints'] = {};


        // outline conversion
        if (a.type(pcb_config.outlines)() == 'array') {
            pcb_config.outlines = {...pcb_config.outlines}
        }
        const config_outlines = a.typeCheck(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')
        const kicad_outlines = {}
        for (const [outline_name, outline] of Object.entries(config_outlines)) {

            const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(outlines))
            const layer = a.typeCheck(outline.layer || 'Edge.Cuts', `pcbs.${pcb_name}.outlines.${outline_name}.outline`, 'string')
            const operation = u[a.in(outline.preview || 'stack', `${outline_name}.operation`, ['add', 'subtract', 'intersect', 'stack'])]
            preview = operation(preview, outlines[ref])
        }

        const allFootprints = await mergeFootprintsFromModules(pcb_name, pcb_config);
        for (const [name, footprintConfig] of Object.entries(allFootprints)) {
            const footprintPath = `pcbs.${pcb_name}.footprints.${name}`
            a.typeCheck(footprintConfig, footprintPath, 'object')
            try {
                footprints[name] = [];
                const where = filter(footprintConfig.where, `${footprintPath}.where`, points, units)
                const originalAdjust = footprintConfig.adjust // need to save, so the delete's don't get rid of it below
                const adjust = start => anchor(originalAdjust || {}, `${footprintPath}.adjust`, points, start)(units)
                const shape_maker = await footprint_shape(footprintConfig)
                for (const w of where) {
                    setFootprintInPoints(w, footprintConfig)
                    const point = adjust(w.clone())
                    let [shape, bbox] = shape_maker() 
                    shape = point.position(shape) // ...actual positioning happens here
                    const operation = u[a.in(footprintConfig.preview || 'stack', `${footprintPath}.operation`, ['add', 'subtract', 'intersect', 'stack'])]
                    preview = operation(preview, shape)
                    footprints[name].push({'point': point, 'config': footprintConfig});
                }   
            } catch (error) {
                console.error('Error place footprint:', error);
            }

            m.model.originate(preview)
            // console.log("final PCB:" + JSON.stringify(results[pcb_name]));
        }
        pcb['preview'] = preview;
    }

    return results
}
