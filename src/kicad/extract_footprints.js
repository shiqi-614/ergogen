const { parseContent } = require('./mod_parser');

/**
 * 提取所有 footprint 信息
 * @param {string} pcbContent - KiCad PCB 文件内容（文本）
 * @returns {Array<Object>} 所有 footprint 的数组
 */

function extractFootprints(pcbContent) {
    const parsed = parseContent(pcbContent);

    if (!parsed.footprint) return [];

    const footprintsRaw = parsed.footprint;

    // 有可能是单个对象，也可能是数组
    const footprints = Array.isArray(footprintsRaw) ? footprintsRaw : [footprintsRaw];

    const result = {};

    for (const fp of footprints) {
        const referenceObj = (fp.property || fp.fp_text || []).find(p => p.Reference);
        const valueObj = (fp.property || fp.fp_text || []).find(p => p.Value);

        const reference = referenceObj?.Reference || 'UNKNOWN';
        const value = valueObj?.Value;

        const [rawRepo, rawFile] = fp.name.includes(':') ? fp.name.split(':') : ['unknown', fp.name];

        const repo = `shiqi-614/${rawRepo}`;
        const file = `${rawFile}.kicad_mod`;

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

    return {
        kicad: {
            footprints: result
        }
    };
}

module.exports = { extractFootprints };


