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

var pathArray = [ line, circle ];

var svg = m.exporter.toSVG(pathArray);

fs.writeFileSync('test.svg', svg, 'utf-8');




