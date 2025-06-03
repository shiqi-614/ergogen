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
const { extractFootprints } = require('./kicad/extract_footprints')


function setFootprintInPoints(w, footprintConfig) {
    if (footprintConfig.meta && footprintConfig.meta.type) {
        if (!w.meta.footprints) {
            w.meta.footprints = {};
        }
        const type = footprintConfig.meta.type;
        w.meta.footprints[type] = normalizeWhat(footprintConfig.what);
    }

}

async function getFootprintsFromModules(pcb_config) {
    pcb_config.modules = u.convertArrayFieldToObject(pcb_config, 'modules');
    let footprints = {};

    for (const [name, moduleConfig] of Object.entries(pcb_config.modules)) {
        const footprintsFromModule = await getFootprintsFromModule(moduleConfig);
        footprints = {...footprints, ...footprintsFromModule}
    }
    return footprints
}

async function getFootprintsFromModule(moduleConfig) {
    const response = await fetchWhat(moduleConfig.what)
    const data = extractFootprints(response)
    
    let footprints = {}
    for (const [name, content] of Object.entries(data)) {
        const subFootprints = u.convertArrayFieldToObject(content, 'footprints')
        for (const [name, footprintConfig] of Object.entries(subFootprints)) {
            footprintConfig.where = u.mergeWhereFromParent(moduleConfig?.where, footprintConfig?.where);
            // footprintConfig.adjust = u.merge(moduleConfig?.adjust, footprintConfig?.adjust);
            if (footprintConfig.side == null) {
                footprintConfig.side = moduleConfig?.side;
            }
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
        const modules = await getFootprintsFromModules(pcb_config);

        const allFootprints = { ...modules, ...footprints };
        const newModules = {}; // 使用对象存储 modules
        const newFootprints = {}; // 使用对象存储 footprints

        for (const [name, footprintConfig] of Object.entries(allFootprints)) {
            const footprintPath = `pcbs.${pcb_name}.footprints.${name}`;
            a.typeCheck(footprintConfig, footprintPath, 'object');

            try {
                const isModule = name in modules;

                if (isModule && newModules[name]) {
                    throw new Error(`Duplicate module key: ${name}`);
                }

                const where = filter(footprintConfig.where, `${footprintPath}.where`, points, units);
                const originalAdjust = footprintConfig.adjust;
                const adjust = start => anchor(originalAdjust || {}, `${footprintPath}.adjust`, points, start)(units);

                for (const w of where) {
                    setFootprintInPoints(w, footprintConfig);
                    const point = adjust(w.clone());

                    if (!point.meta?.index) {
                        throw new Error(`point.meta.index is undefined for footprint: ${name}`);
                    }

                    const entry = { point, config: footprintConfig };

                    if (isModule) {
                        newModules[name] = entry; 
                    } else {
                        const key = name + point.meta.index;
                        if (key in newFootprints) {
                            throw new Error(`Duplicate footprint key: ${key}`);
                        }
                        newFootprints[key] = entry; 
                    }
                }
            } catch (error) {
                console.error('Error placing footprint:', error);
            }
        }

        pcb['modules'] = newModules;
        pcb['footprints'] = newFootprints;
    }

    return pcbs 
}
