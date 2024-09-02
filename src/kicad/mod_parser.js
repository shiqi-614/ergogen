const fs = require('fs');
const m = require('makerjs')
const path = require('path');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 * 24 * 7});

async function fetchAndCache(footprintName) {
    // 尝试从缓存中获取数据
    const cachedData = cache.get(footprintName);
    
    if (cachedData) {
        console.log('Returning cached data');
        return cachedData;
    }
    
    try {
        // 如果缓存中没有数据，进行HTTP请求
        const url = `https://raw.githubusercontent.com/shiqi-614/ErgoCai.pretty/main/${footprintName}.kicad_mod`;
        const response = await axios.get(url);
        const data = parseContent(response.data);

        // 将数据保存到缓存中
        cache.set(footprintName, data);
        console.log('Fetched and cached data');
        
        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

const listSet = new Set([
    'fp_line',
    'fp_arc',
    'pad',
    'property'
]);

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


module.exports = { fetchAndCache };

// exports.parse = () => {

    // const targetDir = path.join(__dirname, '/../footprints'); // 替换为你的目标目录
    // const kicadModFiles = findKicadModFiles(targetDir);
    // console.log('Found .kicad_mod files:');
    // console.log(kicadModFiles);

    // const result = {};
    // kicadModFiles.forEach(filePath => {
        // try {
            // console.log("parsing file: " + filePath);
            // const content = fs.readFileSync(filePath, 'utf-8');
            // const jsonContent = parseContent(content);
            // const fileName = path.parse(filePath).name;
            // result[fileName] = jsonContent;
            // // saveJsonContent(filePath, jsonContent);
        // } catch (e) {
            // console.log("cannot handle file: " + filePath);
            // console.log(e);
        // }
    // });

    // // for (var key in result) {
        // // console.log(key);
    // // }

    // return result;
// };

function parseContent(content) {
    const result = {};

    const bracketStack = [];
    const contentObjStack = [];
    contentObjStack.push(["root", result]);
    let currentContent = '';
    let curObj = result;
    let isComment = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (isComment) {
            currentContent += char;
            if (char == '"') {
                isComment = false;
            }
        } else {
            if (char === '(') {
                if (currentContent.trim()) {
                    const section  = parseSection(currentContent);
                    if (section) {
                        const {key, data} = section;
                        contentObjStack.push([key, data]);
                        if (listSet.has(key)) {
                            if (!curObj.hasOwnProperty(key)) {
                                curObj[key] = [];
                            }
                            curObj[key].push(data);
                        } else {
                            // console.log(key);
                            // console.log(JSON.stringify(data));
                            // console.log("cur");
                            // console.log(JSON.stringify(curObj));
                            curObj[key] = data;
                        }
                        curObj = data;
                    }
                }
                bracketStack.push(char);
                currentContent = '';
            } else if (char === ')') {
                bracketStack.pop();
                if (currentContent.trim()) {
                    const section  = parseSection(currentContent);
                    if (section) {
                        const {key, data} = section;
                        curObj[key] = data;
                    }
                    // console.log("add ");
                    // console.log("key:" + key+ " obj:" + JSON.stringify(data, null, 2));
                    // console.log("curObj" + JSON.stringify(curObj, null, 2));
                } else {
                    [key, data] =  contentObjStack.pop();
                    // console.log("pop");
                    // console.log("key:" + key+ " obj:" + JSON.stringify(data, null, 2));
                    [key, data] = contentObjStack[contentObjStack.length - 1];
                    // console.log("cur");
                    // console.log("key:" + key+ " obj:" + JSON.stringify(data, null, 2));
                    curObj = data;
                }
                currentContent = '';
            } else {
                currentContent += char;
                if (char == '"') {
                    isComment = true;
                }
            }
        }


        // console.log("root:" + JSON.stringify(result));
    }

    return result;
}


function parseSection(section) {

    const words = section.match(/\b[\w-./]+\b/g);
    let data;
    if (words && words.length >= 1) {
        const key = words[0];
        switch (key) {
            case 'start':
            case 'end':
            case 'at':
                data = parseCoordinates(section);
                return { key, data};
            case 'size':
            case 'xyz':
                data = parseNumList(section);
                return {key, data};
            case 'layer':
            case 'layers':
                data = parseLayers(section);
                return { key, data};
            case 'offset':
            case 'effects':
            case 'fp_line':
            case 'fp_arc':
            case 'scale':
            case 'rotate':
            case 'font':
            case 'stroke':
                data = {};
                return { key, data};
            case 'property':
            case 'fp_text':
                data = {};
                data[words[1]] = data[words[2]];
                return { key, data};
            case 'footprint':
                data = {};
                data['name'] = words[1] ? words[1]: '';
                return { key, data };
            case 'roundrect_rratio':
            case 'thickness':
            case 'width':
                data = parseFloat(words[1]);
                return { key, data };
            case 'version':
            case 'hide':
            case 'generator':
            case 'generator_version':
            case 'type':
            case 'uuid':
                data = words[1];
                return { key, data};
            case 'model':
                data = {};
                data['file'] = words[1];
                return { key, data};
            case 'pad':
                data = {};
                if (words.length == 4) {
                    data["number"] = words[1];
                    data["type"] = words[2];
                    data["shape"] = words[3];
                } else if (words.length == 3) {
                    data["type"] = words[1];
                    data["shape"] = words[2];
                }
                return {key, data};
            default:
                data = section.substr(key.length + 1);
                return { key, data};
        }
    } else {
        return null;
    }
    
}

function parseCoordinates(section) {
    const matches = section.match(/-?\d+(\.\d+)?/g);
    return {
        x: parseFloat(matches[0]),
        y: parseFloat(matches[1]),
        angle: matches[2] ? parseFloat(matches[2]) : undefined
    };
}

function parseNumList(section) {
    const matches = section.match(/-?\d+(\.\d+)?/g);
    return matches.map(Number);
}

function parseLayers(section) {
     const regex = /(\*\.\w+)|"([^"]+)"/g;

    const matches = [];
    let match;
    while ((match = regex.exec(section)) !== null) {
        if (match[1]) {
            // 匹配到 *.Cu 或 *.Mask 的情况
            matches.push(match[1]);
        } else if (match[2]) {
            // 匹配到 "F.Cu"、"F.Paste"、"F.Mask" 的情况
            matches.push(match[2]);
        }
    }

    if (matches.length > 1) {
        return matches;
    } else {
        return matches[0];
    }
    // 用空格分隔并返回结果
}

