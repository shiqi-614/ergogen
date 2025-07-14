const { parseContent } = require('./mod_parser');


function convert2Array(item) {
    if (!item) return [];
    return  Array.isArray(item) ? item : [item];
}

function extractFootprints(footprintRaw) {
    const footprints = convert2Array(footprintRaw);

    const result = {};

    for (const fp of footprints) {
        const referenceObj = (fp.property || fp.fp_text || []).find(p => p.Reference);
        const valueObj = (fp.property || fp.fp_text || []).find(p => p.Value);

        const reference = referenceObj?.Reference || 'UNKNOWN';
        console.log("reference:" + reference)
        const value = valueObj?.Value;

        const [rawRepo, rawFile] = fp.name.includes(':') ? fp.name.split(':') : ['unknown', fp.name];

        const repo = `shiqi-614/ErgoCaiLib/`;
        const file = `footprints/${rawRepo}/${rawFile}.kicad_mod`;

        let side = ""
        if (fp.layer === "F.Cu") {
            side = "front";
        } else if (fp.layer === "B.Cu") {
            side = "back";
        }

        result[reference] = {
            what: {
                ...(value && { value }),
                github: {
                    repo,
                    file
                }
            },
            where: {
                shift: [fp.at?.x ?? 0, fp.at?.y * -1 ?? 0],
                rotate: fp.at?.angle ?? 0
            },
            side: side
        };
    }
    return result;
}

function parsePcbContent(pcbContent) {
    const parsed = parseContent(pcbContent);

    const footprints = extractFootprints(parsed.footprint);
    const segments = convert2Array(parsed.segment);
    const vias = convert2Array(parsed.via);

    return {
        module: {
            footprints: footprints,
            segments: segments,
            vias: vias
        }
    };
}

module.exports = { parsePcbContent };


