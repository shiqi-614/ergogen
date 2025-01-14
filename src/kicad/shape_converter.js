
const fs = require('fs');
const m = require('makerjs')
const path = require('path');

var idx = 0;

function getId(prefix, item) {
    return prefix + '-' + (item.uuid || item.tstamp || ++idx);
}

class FpCircleStrategy {
    convert(item) {
        const key = getId('fpCircle', item);
        const radius = Math.sqrt(Math.pow(item.center.x - item.end.x, 2) + Math.pow(item.center.y - item.end.y, 2));
        var circle = new m.paths.Circle([item.center.x, item.center.y*-1], radius);
        // console.log("kicad fp circle: " + JSON.stringify(item));
        // console.log("convert to makerjs circle: "+ JSON.stringify(circle));
        return {[key]: circle};
    }
}

class CircleStrategy {
    convert(item) {
        const key = getId('circle', item);
        var circle = new m.paths.Circle([item.at.x, item.at.y*-1], item.size.w/2);
        // console.log("kicad circle: " + JSON.stringify(item));
        // console.log("convert to makerjs circle: "+ JSON.stringify(circle));
        return {[key]: circle};
    }
}

class OvalStrategy {
    convert(item) {
        const key = getId('oval', item);
        var oval = new m.models.Oval(item.size.w, item.size.h);
        oval.origin = [item.at.x - item.size.w/2, item.at.y * -1 - item.size.w/2];
        // console.log("kicad oval: " + JSON.stringify(item));
        // console.log("convert to makerjs oval: "+ JSON.stringify(oval));
        return {[key]: oval};
    }
}

// 策略类 - 处理 RoundRect 类型
class RoundRectStrategy {
    convert(item) {
        // console.log("convert roundrect: " + JSON.stringify(item));
        var key = getId('roundrect', item);
        // var roundrect = new m.models.Rectangle(
            // item.size.w, 
            // item.size.h
        // )
        var roundrect = new m.models.RoundRectangle(
            item.size.w, 
            item.size.h, 
            item.roundrect_rratio * Math.min(item.size.w, item.size.h)
        )
        roundrect.origin = [item.at.x - item.size.w/2, item.at.y * -1 - item.size.h/2];
        if (item.at.angle) {
            m.model.rotate(roundrect, item.at.angle, [item.at.x, item.at.y * -1]);
        }
        // console.log("kicad roundrect: " + JSON.stringify(item));
        // console.log("convert to makerjs roundrect: "+ JSON.stringify(roundrect));
        return {[key]: roundrect};
    }
}


function calculateCircleFromThreePoints(p1, p2, p3) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;

    const a = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2;
    const b = (x1 * x1 + y1 * y1) * (y3 - y2) + (x2 * x2 + y2 * y2) * (y1 - y3) + (x3 * x3 + y3 * y3) * (y2 - y1);
    const c = (x1 * x1 + y1 * y1) * (x2 - x3) + (x2 * x2 + y2 * y2) * (x3 - x1) + (x3 * x3 + y3 * y3) * (x1 - x2);
    const d = (x1 * x1 + y1 * y1) * (x3 * y2 - x2 * y3) + (x2 * x2 + y2 * y2) * (x1 * y3 - x3 * y1) + (x3 * x3 + y3 * y3) * (x2 * y1 - x1 * y2);

    const cx = -b / (2 * a);
    const cy = -c / (2 * a);
    const radius = Math.sqrt((b * b + c * c - 4 * a * d) / (4 * a * a));

    return {
        center: { x: cx, y: cy },
        radius: radius
    };
}

class ArcStrategy {
    convert(item) {
        const start = {x:item.start.x, y:item.start.y * -1};
        const end = {x:item.end.x, y:item.end.y * -1};

        // 将 mid 坐标从字符串转换为数字数组
        const mid = item.mid

        const res = calculateCircleFromThreePoints(start, {x:mid.x, y:mid.y *-1}, end);
        // 计算弧的原点，假设弧是圆弧的部分
        const cx = res.center.x;
        const cy = res.center.y;
        // console.log("res is:" + JSON.stringify(res));

        // 计算半径
        const radius = res.radius;

        // 计算起始角度
        const endAngle = Math.atan2(start.y - cy, start.x - cx) * (180 / Math.PI);

        // 计算终止角度
        const startAngle = Math.atan2(end.y - cy, end.x - cx) * (180 / Math.PI);

        const arc = {
            type: 'arc',
            origin: [cx, cy],
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle
        };
        var key = getId('arc', item);
        // console.log("kicad arc: " + JSON.stringify(item));
        // console.log("convert to makerjs arc: "+ JSON.stringify(arc));
        return {[key]: arc};
    }
}

class LineStrategy {
    convert(item) {
        var key = getId('line', item);
        var line = {
            type: 'line',
            origin: [item.start.x, item.start.y * -1],
            end: [item.end.x, item.end.y * -1]
        }
        // console.log("kicad line: " + JSON.stringify(item));
        // console.log("convert to makerjs line: "+ JSON.stringify(line));
        return {[key]: line};
    }
}

class RectStrategy {
    convert(item) {
        var key = getId('rect', item);
        var rect = new m.models.Rectangle(
            item.size.w, 
            item.size.h
        )
        rect.origin = [item.at.x - item.size.w/2, item.at.y * -1 - item.size.h/2];
        if (item.at.angle) {
            m.model.rotate(rect, item.at.angle, [item.at.x, item.at.y * -1]);
        }
        // console.log("kicad rect: " + JSON.stringify(item));
        // console.log("convert to makerjs rect: "+ JSON.stringify(rect));
        return {[key]: rect};
    }
}

class FpPolyStrategy {
    convert(item) {
        var key = getId('fpPoly', item);
        // Extract the points
        const points = item.pts.xy;

        const model = {
            paths: {}
        };

        // Add lines to the model
        for (let i = 0; i < points.length - 1; i++) {
            const start = [points[i].x, points[i].y * -1];
            const end = [points[i + 1].x, points[i + 1].y * -1];
            model.paths[`line${i + 1}`] = new m.paths.Line(start, end);
        }
        return {[key]: model};
    }
}

class ShapeConverter {
    constructor() {
        this.strategies = {}; // 延迟实例化策略
    }

    _getStrategy(shape) {
        switch (shape) {
            case 'circle':
                return this._initializeStrategy('circle', CircleStrategy);
            case 'roundrect':
                return this._initializeStrategy('roundrect', RoundRectStrategy);
            case 'line':
            case 'fp_line': // 共享 LineStrategy
                return this._initializeStrategy('line', LineStrategy);
            case 'arc':
            case 'fp_arc': // 共享 ArcStrategy
                return this._initializeStrategy('arc', ArcStrategy);
            case 'rect':
                return this._initializeStrategy('rect', RectStrategy);
            case 'fp_circle':
                return this._initializeStrategy('fp_circle', FpCircleStrategy);
            case 'oval':
                return this._initializeStrategy('oval', OvalStrategy);
            case 'fp_poly':
                return this._initializeStrategy('fp_poly', FpPolyStrategy);
            default:
                return null;
        }
    }

    _initializeStrategy(key, StrategyClass) {
        // 如果策略未初始化，则实例化并缓存
        if (!this.strategies[key]) {
            this.strategies[key] = new StrategyClass();
        }
        return this.strategies[key];
    }

    convert(item, shape) {
        const resolvedShape = item.shape || shape;
        // console.log("shape:" + resolvedShape);
        const strategy = this._getStrategy(resolvedShape);

        if (!strategy) {
            throw new Error(`Unsupported shape: ${resolvedShape}`);
        }

        return strategy.convert(item);
    }
}

const shape_converter = new ShapeConverter();

function layerCheck(item) {
    const layersToCheck = [];
    
    if (item.hasOwnProperty('layer')) {
        layersToCheck.push(...(Array.isArray(item.layer) ? item.layer : [item.layer]));
    }

    if (item.hasOwnProperty('layers')) {
        layersToCheck.push(...(Array.isArray(item.layers) ? item.layers : [item.layers]));
    }

    const result = layersToCheck.some(layer => 
        layer.endsWith("CrtYd") || 
        layer.endsWith("Dwgs.User") || 
        layer.endsWith("Fab") || 
        layer.endsWith("Cu") ||
        layer.endsWith("SilkS")
    );

    // Optionally log for debugging (can be removed or controlled via a flag)
    // console.log("result: " + result + JSON.stringify(item, null, 2));

    return result;
}

const SUPPORTED_KICAD_FOOTPRINT_ATTRIBUTES = new Set([
    "fp_line",
    "fp_circle",
    "pad", // pad struct have shape property, will use shape to get converter
    "fp_arc",
    "fp_poly"
]);

exports.convert = (footprint) => {
    // console.log("footpritn item:" + JSON.stringify(item));
    // const real_shape = item.shape||shape;
    // console.log("real shape: " + real_shape);

    // console.log("footprint");   
    // console.log(JSON.stringify(footprint, null, 2));
    var allItems = {};
    Object.entries(footprint).forEach(([key, value]) => {
        if(SUPPORTED_KICAD_FOOTPRINT_ATTRIBUTES.has(key)) {
            const valueList = Array.isArray(value) 
                ? value
                : [value];
            const convertedList = valueList
                .filter(layerCheck) 
                .flatMap(item => shape_converter.convert(item, key)); 

            allItems = { ...allItems, ...Object.assign({}, ...convertedList) };

        }
    });

    const pathItems = {};
    const modelItems = {};

    for (const key in allItems) {
        const item = allItems[key];
        if (!Object.keys(item).length) continue;
        if (item.hasOwnProperty("type")) {
            Object.assign(pathItems, {[key]: item});
        } else {
            Object.assign(modelItems, {[key]: item});
        }
    }
    return [pathItems, modelItems];

}
