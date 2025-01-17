const fs = require('fs');
const { parseContent } = require('./mod_parser');
const { fetchAndCache } = require('./mod_github_fetcher');
const u = require('../utils')


const kicadMods = new Map();


// 递归遍历目录
function findKicadModFilesAndParse() {
    const path = require('path');
    const modFolderPath = path.join(__dirname, './ErgoCai.pretty');
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
    if (u.isNode()) {
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


module.exports = { fetchKicadMod };
