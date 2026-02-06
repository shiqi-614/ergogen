const { parseContent } = require('./mod_parser');
const { fetchWhat } = require('./fetcher');
const u = require('../utils')
const { Cache } = require('./cache');
const cache = new Cache();

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

async function parsePcbContent(moduleConfig) {
    const key = JSON.stringify(moduleConfig.what);
    console.log("try to get " + key);
    if (cache.has(key)) {
        console.log("get from cache " + key);
        return cache.get(key);
    }

    const response = await fetchWhat(moduleConfig.what)

    const parsed = parseContent(response);

    const footprints = extractFootprints(parsed.footprint);
    const segments = convert2Array(parsed.segment);
    const vias = convert2Array(parsed.via);

    const data = {
        module: {
            footprints: footprints,
            segments: segments,
            vias: vias
        }
    };
    cache.set(key, data);
    return data;
}

module.exports = { parsePcbContent };


