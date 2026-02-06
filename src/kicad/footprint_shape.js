const m = require('makerjs')
const u = require('../utils')
const o = require('../operation')
const { fetchKicadMod, normalizeWhat, fetchWhat } = require('./fetcher');
const kicad_shape_converter = require('./shape_converter')


function flipVertically(res) {
    // 遍历 models 并垂直翻转
    if (res.models) {
        for (let key in res.models) {
            if (res.models.hasOwnProperty(key)) {
                res.models[key] = m.model.mirror(res.models[key], true, false); // 垂直翻转
                res.models[key] = m.model.rotate(res.models[key], 180);
            }
        }
    }

    // 遍历 paths 并垂直翻转
    if (res.paths) {
        for (let key in res.paths) {
            if (res.paths.hasOwnProperty(key)) {
                res.paths[key] = m.path.mirror(res.paths[key], true, false); // 垂直翻转
                res.paths[key] = m.path.rotate(res.paths[key], 180);
            }
        }
    }

    return res;
}


exports.parse = async (footprintConfig, filterLayers = null) => {
    console.log("draw footprint: " + JSON.stringify(footprintConfig.what));
    const jsonObj = await fetchKicadMod(footprintConfig.what);

    let [pathItems, modelItems] = kicad_shape_converter.convert(jsonObj.footprint, filterLayers);
    
    return () => {
        const res = {
            models: u.deepcopy(modelItems),
            paths: u.deepcopy(pathItems)
        };
        if (footprintConfig.side && footprintConfig.side.toLowerCase() === "back") {
            res.layer = "olive";
            flipVertically(res);
        } else {
            res.layer = "aqua";
        }
        const bbox = m.measure.modelExtents(res);
        return [res, bbox];
    };
};
