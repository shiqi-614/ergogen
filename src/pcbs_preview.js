const a = require('./assert')
const preview_pcb = require('./kicad/preview_pcb')


// per pcb: its footprints, module footprints included (cases cut holes for them),
// and a KiCad board that previews it (shown with KiCanvas)
exports.parse = async (config, pcbs) => {

    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const previews = {}

    for (const pcb_name of Object.keys(config.pcbs)) {

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
    }

    return previews;
}
