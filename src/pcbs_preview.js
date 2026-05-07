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

const footprint_shape = require('./kicad/footprint_shape')
const {_parse_axis} = require("./points");
const outlines_lib = require("./outlines");

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


exports.parse = async (config, pcbs, outlines, points, units) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}

    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {

        let preview;
        if (pcb_config.mirror) {
            const origin_config = config.pcbs[pcb_config.mirror.from];
            pcb_config.outlines = origin_config.outlines;
        }
        if (a.type(pcb_config.outlines)() == 'array') {
            pcb_config.outlines = {...pcb_config.outlines}
        }
        const config_outlines = a.typeCheck(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')

        for (const [outline_name, outline] of Object.entries(config_outlines)) {
            const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(outlines))
            const operation = u['stack']
            if (pcb_config.mirror) {
                const { mirror_points, _} = u.splitMirrorPoints(points);
                const mirror_outlines = outlines_lib.parse(config.outlines || {}, mirror_points, units)
                preview = operation(preview, mirror_outlines[ref]);
            } else {
                preview = operation(preview, outlines[ref].yaml)
            }
        }

        const allFootprints = {
          ...Object.fromEntries(
              Object.entries(pcbs[pcb_name].footprints || {}).map(([fpKey, fpEntry]) => {
                return [`footprints.${fpKey}`, fpEntry];
              })
            ),
          ...(pcbs[pcb_name].modules ? Object.fromEntries(
              Object.entries(pcbs[pcb_name].modules).flatMap(([modName, modData]) =>
                Object.entries(modData.footprints || {}).map(([fpKey, fpEntry]) => {
                  const combinedKey = `modules.${modName}.${fpKey}`;
                  return [combinedKey, fpEntry];
                })
              )
            ) : {})
        };

        for (const [name, footprintConfig] of Object.entries(allFootprints)) {
            const footprintPath = `pcbs.${pcb_name}.${name}`;
            a.typeCheck(footprintConfig, footprintPath, 'object');

            try {
                const shape_maker = await footprint_shape.parse(footprintConfig.config);
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

        previews[pcb_name] = {
            'preview': preview,
            'footprints': allFootprints
        };
    }

    return previews;
}
