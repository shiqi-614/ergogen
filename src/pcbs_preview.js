// Per pcb: every footprint on it by its place in the config ("footprints.<name>", a module's as
// "modules.<module>.<name>"), for the cases to cut around, and a KiCad board that previews it (kicad/preview_pcb.js,
// shown with KiCanvas). A board that can't be built is logged and left out; the footprints are there all the same.
const a = require('./assert')
const u = require('./utils')
const preview_pcb = require('./kicad/preview_pcb')

const everyFootprint = pcb => {
    const footprints = {}
    for (const [name, footprint] of Object.entries(pcb.footprints || {})) footprints[`footprints.${name}`] = footprint
    for (const [module, placed] of Object.entries(pcb.modules || {})) {
        for (const [name, footprint] of Object.entries(placed.footprints || {})) footprints[`modules.${module}.${name}`] = footprint
    }
    return footprints
}

exports.parse = async (config, pcbs, errors) => {
    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}
    for (const name of Object.keys(config.pcbs || {})) {
        // a pcb that failed (tolerant mode) has nothing to preview
        if (errors && !pcbs[name]) continue
        await u.attempt(errors, `pcbs.${name}`, async () => {
            let kicad_pcb
            try {
                kicad_pcb = await preview_pcb.build(pcbs[name])
            } catch (error) {
                console.error('Error building the KiCad preview board:', error)
            }
            previews[name] = {footprints: everyFootprint(pcbs[name]), kicad_pcb}
        })
    }
    return previews
}
