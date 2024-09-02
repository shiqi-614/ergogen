const m = require('makerjs')
const fs = require('fs');


class CircleStrategy {
    convert(item) {
        const key = 'circle-' + item.uuid;
        var circle = new m.paths.Circle([item.at.x, item.at.y*-1], item.size[0]/2);
        return {[key]: circle};
    }
}

// 策略类 - 处理 RoundRect 类型
class RoundRectStrategy {
    convert(item) {
        var key = 'roundrect-' + item.uuid;
        var roundrect = new m.models.RoundRectangle(
            item.size[0], 
            item.size[1], 
            item.roundrect_rratio * Math.min(item.size[0], item.size[1])
        )
        roundrect.origin = [item.at.x - item.size[0]/2, item.at.y * -1 - item.size[1]/2];
        // roundrect.origin = [-item.at.x, -item.at.y];
        // console.log("roundrect: "+ JSON.stringify(roundrect));
        return {[key]: roundrect};

    }
}

// 上下文类 - 负责选择策略
class ShapeConverter {
    constructor() {
        this.strategies = {
            'circle': new CircleStrategy(),
            'roundrect': new RoundRectStrategy()
        };
    }

    convert(obj) {
        // console.log("pad: " + JSON.stringify(obj));
        const strategy = this.strategies[obj.shape];
        if (!strategy) {
            throw new Error(`Unsupported shape: ${obj.shape}`);
        }
        return strategy.convert(obj);
    }
}



const content = fs.readFileSync("/Users/jinsongc/Development/ergogen/src/footprints/ErgoCai.pretty/json/SW_Hotswap_Kailh_MX_1.00u.json", 'utf-8');


const jsonObj = JSON.parse(content);
var line_list = jsonObj.footprint.fp_line.flatMap((item) => covertFpLine(item));
var pad_list = jsonObj.footprint.pad.flatMap((item) => convertPad(item));
var arc_list = jsonObj.footprint.fp_arc.flatMap((item) => convertFpArc(item));
var allItems = Object.assign({}, ...line_list, ...pad_list, ...arc_list);
const pathItems = {};
const modelItems = {};

for (const key in allItems) {
    const item = allItems[key];
    if (item.hasOwnProperty("type")) {
        Object.assign(pathItems, {[key]: item});
    } else {
        Object.assign(modelItems, {[key]: item});
    }
}

console.log("path items:");
console.log(JSON.stringify(pathItems));

console.log("models items:");
console.log(JSON.stringify(modelItems));

const res = {
    paths: pathItems,
    models: modelItems
};

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

function convertFpArc(item) {
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
    return {[key]: arc};
}

function covertFpLine(item) {
    var key = 'line-' + item.uuid;
    var line = {
        type: 'line',
        origin: [item.start.x, item.start.y * -1],
        end: [item.end.x, item.end.y * -1]
    }
    return {[key]: line};
}

function convertPad(item) {
    const converter = new ShapeConverter();
    return converter.convert(item);

}

// 转换为 SVG
const svgOptions = {
    stroke: 'black',
    strokeWidth: 0.1  // 这里设置线条粗细
};

// console.log(JSON.stringify(res, null, 2));

var svg = m.exporter.toSVG(res, svgOptions);
fs.writeFileSync('test.svg', svg, 'utf-8');

