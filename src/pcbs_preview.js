const a = require('./assert')
const u = require('./utils')
const preview_pcb = require('./kicad/preview_pcb')


// per pcb: its footprints, module footprints included (cases cut holes for them),
// and a KiCad board that previews it (shown with KiCanvas)
exports.parse = async (config, pcbs, errors) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}

    for (const pcb_name of Object.keys(config.pcbs)) {
        // a pcb that failed (tolerant mode) has nothing to preview
        if (errors && !pcbs[pcb_name]) continue
        await u.attempt(errors, `pcbs.${pcb_name}`, async () => {

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

            let kicad_pcb;
            try {
                kicad_pcb = await preview_pcb.build(pcbs[pcb_name]);
            } catch (error) {
                console.error('Error building the KiCad preview board:', error);
            }

            previews[pcb_name] = {
                'footprints': allFootprints,
                'kicad_pcb': kicad_pcb
            };
        })
    }

    return previews;
}
