const fs = require('fs');
const path = require('path');
const { extractFootprints } = require('./extract_footprints');

// 将解析后的JSON内容保存到 .kicad_mod 文件所在目录的 json 文件夹
function saveJsonContent(filePath, jsonContent) {
    const dirPath = path.dirname(filePath);
    const jsonDir = path.join(dirPath, 'json');

    if (!fs.existsSync(jsonDir)) {
        fs.mkdirSync(jsonDir); // 如果json文件夹不存在，则创建它
    }

    const fileName = path.basename(filePath, '.kicad_mod') + '.json';
    const jsonFilePath = path.join(jsonDir, fileName);

    console.log("json file: " + jsonFilePath);
    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonContent, null, 2), 'utf-8');
}


// const kicadModFiles = findKicadModFiles("/Users/jinsongc/Documents/KiCad/8.0/footprints/ErgoCai.pretty");

// console.log('Found .kicad_mod files:');
// console.log(kicadModFiles);
//
const kicadPcbFiles = ["/Users/jinsongc/Development/ErgoCai.modules/battery/default_battery/default_battery.kicad_pcb"];

kicadPcbFiles.forEach(filePath => {
    try {
        console.log("parsing file: " + filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const jsonContent = extractFootprints(content);
        saveJsonContent(filePath, jsonContent);
    } catch (e) {
        console.log("cannot handle file: " + filePath);
        console.log(e);
    }
});
