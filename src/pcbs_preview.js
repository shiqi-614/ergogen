const m = require('makerjs')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const Point = require('./point')

const footprint_shape = require('./kicad/footprint_shape')
const outlines_lib = require("./outlines");


exports.parse = async (config, pcbs, outlines, points, units) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}

    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {

        let preview = pcbs[pcb_name]['outlines'].raw;

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
