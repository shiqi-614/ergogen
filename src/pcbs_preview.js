const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const prep = require('./prepare')
const Point = require('./point')
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


exports.parse = async (config, pcbs, outlines, units) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}

    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {

        let preview;
        if (a.type(pcb_config.outlines)() == 'array') {
            pcb_config.outlines = {...pcb_config.outlines}
        }
        const config_outlines = a.typeCheck(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')
        const kicad_outlines = {}
        for (const [outline_name, outline] of Object.entries(config_outlines)) {
            const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(outlines))
            const layer = a.typeCheck(outline.layer || 'Edge.Cuts', `pcbs.${pcb_name}.outlines.${outline_name}.outline`, 'string')
            const operation = u['stack']
            preview = operation(preview, outlines[ref].yaml)
        }

        const allFootprints = {
          ...pcbs[pcb_name].footprints,
          ...Object.fromEntries(
            Object.entries(pcbs[pcb_name].modules).flatMap(([modName, modData]) =>
              Object.entries(modData.footprints).map(([fpKey, fpEntry]) => {
                const combinedKey = `${modName}.${fpKey}`;
                return [combinedKey, fpEntry];
              })
            )
          )
        };

        for (const [name, footprintConfig] of Object.entries(allFootprints)) {
            const footprintPath = `pcbs.${pcb_name}.footprints.${name}`;
            a.typeCheck(footprintConfig, footprintPath, 'object');

            try {
                const shape_maker = await footprint_shape(footprintConfig.config);
                const point = new Point(footprintConfig.point);

                let [shape, bbox] = shape_maker();
                shape = point.position(shape);
                const operation = u['stack'];
                preview = operation(preview, shape);

            } catch (error) {
                console.error('Error placing footprint:', error);
            }

            m.model.originate(preview);
        }

        previews[pcb_name] = preview;
    }

    return previews;
}
