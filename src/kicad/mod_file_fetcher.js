const fs = require('fs');
const path = require('path');
const { parseContent } = require('./mod_parser');


// 递归遍历目录
function findKicadModFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            findKicadModFiles(filePath, fileList); // 递归处理子目录
        } else if (path.extname(file) === '.kicad_mod') {
            fileList.push(filePath); // 找到.kicad_mod文件
        }
    });

    return fileList;
}

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

console.log('Found .kicad_mod files:');
// console.log(kicadModFiles);
//
const kicadModFiles = ["/Users/jinsongc/Documents/KiCad/8.0/footprints/ErgoCai.pretty/LED_RGB_5050-6.kicad_mod"];

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
