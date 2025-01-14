const fs = require('fs');
const path = require('path');
const { parseContent } = require('./mod_parser');

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
const kicadModFiles = ["/Users/jinsongc/Development/ErgoCai.pretty/SW_Hotswap_Kailh_MX_1.00u.kicad_mod"];

kicadModFiles.forEach(filePath => {
    try {
        console.log("parsing file: " + filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const jsonContent = parseContent(content);
        saveJsonContent(filePath, jsonContent);
    } catch (e) {
        console.log("cannot handle file: " + filePath);
        console.log(e);
    }
});
