const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const prep = require('./prepare')
const anchor = require('./anchor').parse
const filter = require('./filter').parse
const anchor_lib = require('./anchor')

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
        const data = await parsePcbContent(moduleConfig)
        const footprintsFromModule = await getFootprintsFromModule(moduleConfig, data);
        modules[name] = {
            what: moduleConfig.what,
            where: moduleConfig.where,
            asym: moduleConfig.asym || 'both',
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
        for (const [fpName, footprintConfig] of Object.entries(subFootprints)) {
            const newFootprintConfig = {
              ...footprintConfig,
              where: u.mergeWhereFromParent(
                moduleConfig?.where,
                footprintConfig?.where
              )
            };
            // footprintConfig.adjust = u.merge(moduleConfig?.adjust, footprintConfig?.adjust);
            newFootprintConfig.what = normalizeWhat(footprintConfig.what);
            footprints[fpName] = newFootprintConfig;
        }
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

const processFootprintEntry = (entryName, footprintConfig, pathPrefix, points, units) => {
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

        const existingEntry = entries.find(item => item.key === entryName);
        let key;
        if (existingEntry) {
            key = entryName + '_' + point.meta.index;
        } else {
            key = entryName;
        }
        const entry = { point, config: footprintConfig };
        entries.push({ key, entry });
    }

    return entries;
};

function processModules(pcb_name, modules, points, units) {
    const newModules = {};
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
                const entries = processFootprintEntry(fpName, config, fpPath, points, units);

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
    return newModules;
}


function processFootprints(pcb_name, footprints, points, units) {
    const newFootprints = {};

    for (const [fpName, config] of Object.entries(footprints)) {
        const path = `pcbs.${pcb_name}.footprints.${fpName}`;
        try {
            console.log("current fp " + fpName);
            const entries = processFootprintEntry(fpName, config, path, points, units);
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
    return newFootprints;

}


function filterByAsym(obj, excludeValue = 'source') {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, value]) => value.asym !== excludeValue)
    );
}

exports.parse = async (config, points, units) => {
    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const pcbs = {}

    const { mirror_points, normal_points } = u.splitMirrorPoints(points);
    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {
        let pcb = pcbs[pcb_name] = {};
        if (pcb_config.mirror) {
            const origin_config = config.pcbs[pcb_config.mirror.from];

            const footprints = u.convertArrayFieldToObject(origin_config, 'footprints');
            const modules = await getModulesFromPcb(origin_config);
            const filteredFootprints = filterByAsym(footprints);
            const filteredModules = filterByAsym(modules);

            pcb['modules'] = processModules(pcb_name, filteredModules, mirror_points, units);
            pcb['footprints'] = processFootprints(pcb_name, filteredFootprints, mirror_points, units);
        } else {
            const footprints = u.convertArrayFieldToObject(pcb_config, 'footprints');
            const modules = await getModulesFromPcb(pcb_config);

            pcb['modules'] = processModules(pcb_name, modules, normal_points, units);
            pcb['footprints'] = processFootprints(pcb_name, footprints, normal_points, units);
        }
    }

    return pcbs;
};
