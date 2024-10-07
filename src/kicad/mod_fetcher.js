const fs = require('fs');
const path = require('path');
const { parseContent } = require('./mod_parser');
const { fetchAndCache } = require('./mod_github_fetcher');

const modFolderPath = path.join(__dirname, './ErgoCai.pretty');
const kicadMods = new Map();

const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

// 递归遍历目录
function findKicadModFilesAndParse() {
    const files = fs.readdirSync(modFolderPath);

    files.forEach(file => {
        const filePath = path.join(modFolderPath, file);
        const stats = fs.statSync(filePath);

        if (path.extname(file) === '.kicad_mod') {
            const content = fs.readFileSync(filePath, 'utf-8');
            const baseName = path.basename(file, path.extname(file));
            const jsonContent = parseContent(content);
            
            kicadMods.set(baseName, jsonContent);
            console.log("load data from file: " + baseName);
            // console.log(jsonContent);
        }
    });
}

async function fetchKicadMod(footprint_name) {
    if (isNode) {
        if (kicadMods.size == 0) {
            findKicadModFilesAndParse();
        }
    }
    
    console.log("try to get footprint: " + footprint_name);
    if (kicadMods.has(footprint_name)) {
        console.log("get data from file: " + footprint_name);
        return kicadMods.get(footprint_name);
    } else {
        return fetchAndCache(footprint_name);
    }

}

// 将解析后的JSON内容保存到 .kicad_mod 文件所在目录的 json 文件夹
// function saveJsonContent(filePath, jsonContent) {
    // const dirPath = path.dirname(filePath);
    // const jsonDir = path.join(dirPath, 'json');

    // if (!fs.existsSync(jsonDir)) {
        // fs.mkdirSync(jsonDir); // 如果json文件夹不存在，则创建它
    // }

    // const fileName = path.basename(filePath, '.kicad_mod') + '.json';
    // const jsonFilePath = path.join(jsonDir, fileName);

    // console.log("json file: " + jsonFilePath);
    // fs.writeFileSync(jsonFilePath, JSON.stringify(jsonContent, null, 2), 'utf-8');
// }


// // const kicadModFiles = findKicadModFiles("/Users/jinsongc/Documents/KiCad/8.0/footprints/ErgoCai.pretty");

// console.log('Found .kicad_mod files:');
// // console.log(kicadModFiles);
// //
// const kicadModFiles = ["/Users/jinsongc/Development/ErgoCai.pretty/LED_RGB_5050-6.kicad_mod"];

// kicadModFiles.forEach(filePath => {
    // try {
        // console.log("parsing file: " + filePath);
        // const content = fs.readFileSync(filePath, 'utf-8');
        // const jsonContent = parseContent(content);
        // saveJsonContent(filePath, jsonContent);
    // } catch (e) {
        // console.log("cannot handle file: " + filePath);
        // console.log(e);
    // }
// });

module.exports = { fetchKicadMod };
