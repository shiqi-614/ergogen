const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const anchor = require('./anchor').parse
const filter = require('./filter').parse

const { normalizeWhat } = require('./kicad/fetcher');
const { parsePcbContent } = require('./kicad/pcb_extractor')
const outlines_lib = require("./outlines");


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
    for (const [_, content] of Object.entries(data)) {
        const subFootprints = u.convertArrayFieldToObject(content, 'footprints')
        for (const [fpName, footprintConfig] of Object.entries(subFootprints)) {
            const newFootprintConfig = {
              ...footprintConfig,
              // where: u.mergeWhereFromParent(
              //   moduleConfig?.where,
              //   footprintConfig?.where
              // )
              where: footprintConfig?.where
            };
            // newFootprintConfig.adjust = u.merge(moduleConfig?.adjust, footprintConfig?.adjust);
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

        for (const w of moduleWhere) {
            const modulePoint = w;

            if (!newModules[modName]) newModules[modName] = {};
            newModules[modName]['point'] = modulePoint;
            newModules[modName]['config'] = { what: modData.what };
            newModules[modName]['footprints'] = {};

            // 转换 segments
            newModules[modName]['segments'] = (modData.segments || []).map(seg => ({
                ...seg,
                start: transformPoint(seg.start, modulePoint, seg.layer),
                end: transformPoint(seg.end, modulePoint, seg.layer)
            }));

            // 转换 vias
            newModules[modName]['vias'] = (modData.vias || []).map(via => ({
                ...via,
                at: transformPoint(via.at, modulePoint)
            }));

            for (const [fpName, config] of Object.entries(modData.footprints)) {
                const fpPath = `${path}.footprints.${fpName}`;
                try {
                    const fpPoint = u.mergePointFromParent(modulePoint, config.where);
                    newModules[modName]['footprints'][fpName] = { point: fpPoint , config: config };
                } catch (error) {
                    console.error(`Error placing module footprint ${modName}.${fpName}:`, error);
                }
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
                    console.log(`Found footprint key: ${key}`);
                    continue;
                }
                newFootprints[key] = entry;
            }
        } catch (error) {
            console.error(`Error placing footprint ${fpName}:`, error);
        }
    }
    return newFootprints;

}


function getAllPaths(model) {
    const paths = [];
    m.model.walk(model, {
        onPath: function (walkPath) {
            paths.push(walkPath.pathContext);
        }
    });
    return paths;
}

function get_outlines_preview(results, pcb_config, pcb_name, points, units) {
    const config = results.config;
    if (a.type(pcb_config.outlines)() === 'array') {
        pcb_config.outlines = {...pcb_config.outlines}
    }
    const config_outlines = a.typeCheck(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')
    let outline_preview;
    for (const [outline_name, outline] of Object.entries(config_outlines)) {
        const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(results.outlines))
        const operation = u['stack']
        if (pcb_config.mirror) {
            const {mirror_points, _} = u.splitMirrorPoints(points);
            const mirror_outlines = outlines_lib.parse(config.outlines || {}, mirror_points, units)
            outline_preview = operation(outline_preview, mirror_outlines[ref]);
        } else {
            outline_preview = operation(outline_preview, results.outlines[ref].raw)
        }
    }
    return {
        raw: outline_preview,
        paths: getAllPaths(outline_preview),
    }
}

exports.parse = async (results, points, units) => {
    let config = results.config;
    a.typeCheck(config.pcbs || {}, 'pcbs', 'object')
    const pcbs = {}

    const { mirror_points, normal_points } = u.splitMirrorPoints(points);
    for (const [pcb_name, pcb_config] of Object.entries(config.pcbs)) {
        let pcb = pcbs[pcb_name] = {};
        if (pcb_config.mirror) {
            const origin_config = config.pcbs[pcb_config.mirror.from];
            pcb_config['outlines'] = pcb_config['outlines'] || origin_config['outlines'] || {};
            const footprints = u.convertArrayFieldToObject(origin_config, 'footprints');
            const modules = await getModulesFromPcb(origin_config);
            const filteredFootprints = u.filterByAsym(footprints);
            const filteredModules = u.filterByAsym(modules);

            pcb['modules'] = processModules(pcb_name, filteredModules, mirror_points, units);
            pcb['footprints'] = processFootprints(pcb_name, filteredFootprints, mirror_points, units);
            for (const [key, value] of Object.entries(mirror_points)) {
                points[`mirror_${key}`].meta.footprints = value.meta.footprints;
                points[`mirror_${key}`].meta.column_name= value.meta.column_name;
                points[`mirror_${key}`].meta.row_name = value.meta.row_name;
            }

        } else {
            const footprints = u.convertArrayFieldToObject(pcb_config, 'footprints');
            const modules = await getModulesFromPcb(pcb_config);
            const filteredFootprints = u.filterByAsym(footprints, 'clone');
            const filteredModules = u.filterByAsym(modules, 'clone');

            pcb['modules'] = processModules(pcb_name, filteredModules, normal_points, units);
            pcb['footprints'] = processFootprints(pcb_name, filteredFootprints, normal_points, units);
        }
        pcb['outlines'] = get_outlines_preview(results, pcb_config, pcb_name, points, units);
    }

    return pcbs;
};
