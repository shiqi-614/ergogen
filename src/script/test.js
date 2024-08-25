const m = require('makerjs')
const fs = require('fs');

var line = { 
  type: 'line', 
  origin: [0, 0], 
  end: [50, 50] 
 };

var circle = { 
  type: 'circle', 
  origin: [0, 0],
  radius: 50
 };




const content = fs.readFileSync("/Users/jinsongc/Development/ergogen/src/footprints/ErgoCai.pretty/json/Battery_Holder_18650_Nickel.json", 'utf-8');


const jsonObj = JSON.parse(content);
const fp_line_list = jsonObj.footprint.fp_line;
var line_list = fp_line_list.flatMap((item) => covertFpLine(item));
var pad_list = jsonObj.footprint.pad.flatMap((item) => convertPad(item));

function covertFpLine(item) {
    var line = {
        type: 'line',
        origin: [item.start.x, item.start.y],
        end: [item.end.x, item.end.y]
    }
    return line;
}

function convertPad(item) {
    var circle = {
        type: 'circle', 
        origin: [item.at.x, item.at.y],
        radius: item.size[0]/2
    }
    return circle;
}

console.log(line_list);
console.log(pad_list);


var svg = m.exporter.toSVG(line_list.concat(pad_list));
fs.writeFileSync('test.svg', svg, 'utf-8');

