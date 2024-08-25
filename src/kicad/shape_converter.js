const fs = require('fs');
const m = require('makerjs')
const path = require('path');


class CircleStrategy {
    convert(item) {
        const key = 'circle-' + item.uuid;
        var circle = new m.paths.Circle([item.at.x, item.at.y*-1], item.size[0]/2);
        console.log("kicad circle: " + JSON.stringify(item));
        console.log("convert to makerjs circle: "+ JSON.stringify(circle));
        return {[key]: circle};
    }
}

// 策略类 - 处理 RoundRect 类型
class RoundRectStrategy {
    convert(item) {
        // console.log("convert roundrect: " + JSON.stringify(item));
        var key = 'roundrect-' + item.uuid;
        // var roundrect = new m.models.Rectangle(
            // item.size[0], 
            // item.size[1]
        // )
        var roundrect = new m.models.RoundRectangle(
            item.size[0], 
            item.size[1], 
            item.roundrect_rratio * Math.min(item.size[0], item.size[1])
        )
        roundrect.origin = [item.at.x - item.size[0]/2, item.at.y * -1 - item.size[1]/2];
        // m.model.move(roundrect, [item.at.x - item.size[0]/2, item.at.y * -1 - item.size[1]/2]); 
        // m.model.move(roundrect, [item.at.x, item.at.y * -1]); 

        console.log("kicad roundrect: " + JSON.stringify(item));
        console.log("convert to makerjs roundrect: "+ JSON.stringify(roundrect));
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
        const midCoords = item.mid.split(' ').map(Number);

        const res = calculateCircleFromThreePoints(start, {x:midCoords[0], y:midCoords[1] *-1}, end);
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
        var key = 'arc-' + item.uuid;
        console.log("kicad arc: " + JSON.stringify(item));
        console.log("convert to makerjs arc: "+ JSON.stringify(arc));
        return {[key]: arc};
    }
}

class LineStrategy {
    convert(item) {
        var key = 'line-' + item.uuid;
        var line = {
            type: 'line',
            origin: [item.start.x, item.start.y * -1],
            end: [item.end.x, item.end.y * -1]
        }
        console.log("kicad line: " + JSON.stringify(item));
        console.log("convert to makerjs line: "+ JSON.stringify(line));
        return {[key]: line};
    }
}


class ShapeConverter {
    constructor() {
        this.strategies = {
            'circle': new CircleStrategy(),
            'roundrect': new RoundRectStrategy(),
            'line': new LineStrategy(),
            'arc': new ArcStrategy()
        };
    }

    convert(item, shape) {
        // console.log("pad: " + JSON.stringify(item));
        const strategy = this.strategies[item.shape||shape];
        if (!strategy) {
            throw new Error(`Unsupported shape: ${item.shape} or ${shape}`);
        }
        return strategy.convert(item);
    }
}

const shape_converter = new ShapeConverter();

function layerCheck(item) {
    return item.hasOwnProperty('layer') && (item.layer.endsWith("CrtYd") || item.layer.endsWith("Dwgs.User"));
}

// 上下文类 - 负责选择策略
exports.convert = (footprint) => {
    // console.log("footpritn item:" + JSON.stringify(item));
    // const real_shape = item.shape||shape;
    // console.log("real shape: " + real_shape);
    
    const line_list = footprint.fp_line
        .filter((item) => layerCheck(item))
        .flatMap((item) => shape_converter.convert(item, 'line'));
    const pad_list = footprint.pad
        .flatMap((item) => shape_converter.convert(item));
    const arc_list = footprint.fp_arc
        .filter((item) => layerCheck(item))
        .flatMap((item) => shape_converter.convert(item, 'arc'));
    const allItems = Object.assign({}, ...line_list, ...pad_list, ...arc_list);
    // const allItems = Object.assign({}, ...pad_list);

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
