// A footprint's shape on the layers a case part asks for, for the cut it makes (cases.js): its drawings and pads as
// makerjs paths and models (shape_converter.js), turned over when the footprint is on the back.
const m = require('makerjs')
const u = require('../utils')
const {fetchKicadMod} = require('./fetcher')
const kicad_shape_converter = require('./shape_converter')

// on the back: mirrored left to right (mirrored top to bottom, then turned half a turn)
const toTheBack = shape => {
    for (const key of Object.keys(shape.models || {})) shape.models[key] = m.model.rotate(m.model.mirror(shape.models[key], true, false), 180)
    for (const key of Object.keys(shape.paths || {})) shape.paths[key] = m.path.rotate(m.path.mirror(shape.paths[key], true, false), 180)
    return shape
}

// A maker of the footprint's shape: each call a fresh copy, with what bounds it. A mounting hole, or a footprint that
// draws nothing but circles on the layers (a hole drawn on Dwgs.User), is bounded by its own shape, so its cut can
// stay round (cases.js takes its largest circle).
exports.parse = async (footprintConfig, filterLayers = null) => {
    const kicadMod = await fetchKicadMod(footprintConfig.what)
    const [paths, models] = kicad_shape_converter.convert(kicadMod.footprint, filterLayers)
    return () => {
        const shape = {models: u.deepcopy(models), paths: u.deepcopy(paths)}
        if (footprintConfig.side && footprintConfig.side.toLowerCase() === 'back') {
            shape.layer = 'olive'
            toTheBack(shape)
        } else {
            shape.layer = 'aqua'
        }
        const circles = Object.keys(shape.models).length === 0 && Object.keys(shape.paths).length > 0 &&
            Object.values(shape.paths).every(path => path.type === 'circle')
        if (kicadMod.footprint.name.startsWith('MountingHole') || circles) return [shape, shape]
        return [shape, m.measure.modelExtents(shape)]
    }
}
