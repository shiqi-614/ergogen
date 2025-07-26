const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const prep = require('./prepare')
const anchor = require('./anchor').parse
const filter = require('./filter').parse

const footprint_types = require('./footprints')
const template_types = require('./templates')

const { fetchKicadMod, normalizeWhat, fetchWhat } = require('./kicad/fetcher');
const kicad_shape_converter = require('./kicad/shape_converter')
const { parsePcbContent } = require('./kicad/pcb_extractor')


function setFootprintInPoints(w, fpName, footprintConfig) {
    if (!w.meta.footprints) {
        w.meta.footprints = {};
    }
    w.meta.footprints[fpName] = normalizeWhat(footprintConfig.what);
}

function transformPoint(point, wherePoint, layer = "") {
    try {
        const dx = wherePoint.x;
        const dy = wherePoint.y * -1;
        let angle = wherePoint.r || 0;  // Changed from const to let
        const x = point.x;
        const y = point.y;

        angle *= -1;

        const angleRad = (angle * Math.PI) / 180;

        return {
            x: dx + (x * Math.cos(angleRad) - y * Math.sin(angleRad)),  // Added missing parenthesis
            y: dy + (x * Math.sin(angleRad) + y * Math.cos(angleRad))
        };
    } catch (error) {
        console.error("Error in transformPoint:", error);
        throw error;
    }
}

async function getModulesFromPcb(pcb_config) {
    pcb_config.modules = u.convertArrayFieldToObject(pcb_config, 'modules');
    let modules = {};

    for (const [name, moduleConfig] of Object.entries(pcb_config.modules)) {
        const response = await fetchWhat(moduleConfig.what)
        const data = parsePcbContent(response)
        const footprintsFromModule = await getFootprintsFromModule(moduleConfig, data);
        modules[name] = {
            what: moduleConfig.what,
            where: moduleConfig.where,
            footprints: footprintsFromModule,
            segments: data.module.segments,
            vias: data.module.vias
        }
    }
    return modules;
}

async function getFootprintsFromModule(moduleConfig, data) {
    let footprints = {}
    for (const [name, content] of Object.entries(data)) {
        const subFootprints = u.convertArrayFieldToObject(content, 'footprints')
        for (const [name, footprintConfig] of Object.entries(subFootprints)) {
            footprintConfig.where = u.mergeWhereFromParent(moduleConfig?.where, footprintConfig?.where);
            // footprintConfig.adjust = u.merge(moduleConfig?.adjust, footprintConfig?.adjust);
            footprintConfig.what = normalizeWhat(footprintConfig.what);
            footprints[name] = footprintConfig;
        }
        footprints = {...footprints, ...subFootprints};

    }

    if (moduleConfig.footprints) {
        for (const [name, footprintConfig] of Object.entries(moduleConfig.footprints)) {
            for (const [key, value] of Object.entries(footprintConfig)) {
                if (!footprints[name]) {
                    footprints[name] = {};
                }
                footprints[name][key] = value;
            }
        }
    }
    return footprints;

}

exports.parse = async (config, points, units) => {
    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const pcbs = {}

    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {
        let pcb = pcbs[pcb_name] = {};

        const footprints = u.convertArrayFieldToObject(pcb_config, 'footprints');
        const modules = await getModulesFromPcb(pcb_config);

        const newModules = {};
        const newFootprints = {};

        const processFootprintEntry = (entryName, footprintConfig, pathPrefix, isModule = false) => {
            a.typeCheck(footprintConfig, pathPrefix, 'object');

            const where = filter(footprintConfig.where, `${pathPrefix}.where`, points, units);
            const originalAdjust = footprintConfig.adjust;
            const adjust = start => anchor(originalAdjust || {}, `${pathPrefix}.adjust`, points, start)(units);

            const entries = [];

            for (const w of where) {
                setFootprintInPoints(w, entryName, footprintConfig);
                const point = adjust(w.clone());

                if (!point.meta?.index) {
                    throw new Error(`point.meta.index is undefined for: ${entryName}`);
                }

                const key = isModule ? entryName : entryName + point.meta.index;
                const entry = { point, config: footprintConfig };
                entries.push({ key, entry });
            }

            return entries;
        };

        // 处理模块 footprints
        for (const [modName, modData] of Object.entries(modules)) {
            const path = `pcbs.${pcb_name}.modules.${modName}`;

            const moduleWhere = filter(modData.where, `${path}.where`, points, units);

            // 🚫 限制只允许一个 moduleWhere
            if (moduleWhere.length !== 1) {
                throw new Error(`Module '${modName}' must have exactly one 'where' point (got ${moduleWhere.length}).`);
            }

            const modulePoint = moduleWhere[0].clone();

            if (!newModules[modName]) newModules[modName] = {};
            newModules[modName]['point'] = modulePoint;
            newModules[modName]['config'] = { what: modData.what };
            newModules[modName]['footprints'] = {};

            // 转换 segments
            const transformedSegments = (modData.segments || []).map(seg => ({
                ...seg,
                start: transformPoint(seg.start, modulePoint, seg.layer),
                end: transformPoint(seg.end, modulePoint, seg.layer)
            }));
            newModules[modName]['segments'] = transformedSegments;

            // 转换 vias
            const transformedVias = (modData.vias || []).map(via => ({
                ...via,
                at: transformPoint(via.at, modulePoint)
            }));
            newModules[modName]['vias'] = transformedVias;

            for (const [fpName, config] of Object.entries(modData.footprints)) {
                const fpPath = `${path}.footprints.${fpName}`;
                try {
                    const entries = processFootprintEntry(fpName, config, fpPath, true);

                    for (const { key, entry } of entries) {
                        if (key in newModules[modName]['footprints']) {
                            throw new Error(`Duplicate module footprint key: ${modName}.${key}`);
                        }
                        newModules[modName]['footprints'][key] = entry;
                    }
                } catch (error) {
                    console.error(`Error placing module footprint ${modName}.${fpName}:`, error);
                }
            }
        }

        // 处理普通 footprints
        for (const [fpName, config] of Object.entries(footprints)) {
            const path = `pcbs.${pcb_name}.footprints.${fpName}`;
            try {
                const entries = processFootprintEntry(fpName, config, path, false);
                for (const { key, entry } of entries) {
                    if (key in newFootprints) {
                        throw new Error(`Duplicate footprint key: ${key}`);
                    }
                    newFootprints[key] = entry;
                }
            } catch (error) {
                console.error(`Error placing footprint ${fpName}:`, error);
            }
        }

        pcb['modules'] = newModules;
        pcb['footprints'] = newFootprints;
    }

    return pcbs;
};
