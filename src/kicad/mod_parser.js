// A KiCad file (.kicad_mod, .kicad_pcb) read into plain objects, the way shape_converter.js and pcb_extractor.js use
// them: each (key …) becomes a key of its parent, its value parsed by what the key is (coordinates, a size, layers, a
// property …); a key that comes again becomes a list. Text inside quotes is taken as it is.

module.exports = { parseContent };

function parseContent(content) {
    const result = {};

    const bracketStack = [];
    const contentObjStack = [];
    contentObjStack.push(["root", result]);
    let currentContent = '';
    let curObj = result;
    let inString = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (inString) {
            currentContent += char;
            if (char == '"') {
                inString = false;
            }
        } else {
            if (char === '(') {
                if (currentContent.trim()) {;
                    const section  = parseSection(currentContent);
                    if (section) {
                        const {key, data} = section;
                        if (typeof data === 'object' && data !== null) {
                            contentObjStack.push([key, data]);
                            updateOrAppendToKey(curObj, key, data);
                            curObj = data;
                        } else {
                            updateOrAppendToKey(curObj, key, data);
                        }
                    }
                } 
                bracketStack.push(char);
                currentContent = '';
            } else if (char === ')') {
                bracketStack.pop();
                if (currentContent.trim()) {
                    const section  = parseSection(currentContent);
                    if (section) {
                        let {key, data} = section;
                        updateOrAppendToKey(curObj, key, data);
                    }
                } else {
                    if (contentObjStack.length > 0) {
                        contentObjStack.pop();  // the list that just closed

                        if (contentObjStack.length > 0) {
                            const [key, data] = contentObjStack[contentObjStack.length - 1];
                            if (typeof data === 'object' && data !== null) {
                                curObj = data;
                            }
                        } else {
                            curObj = result;  
                        }
                    }
                }
                currentContent = '';
            } else {
                currentContent += char;
                if (char == '"') {
                    inString = true;
                }
            }
        }
    };

    return result;
}


// One (key …) list's own text, without the lists inside it: its key and what it holds
function parseSection(section) {

    const words = section.match(/\b[\w-./]+\b/g);
    let data;
    if (words && words.length >= 1) {
        const key = words[0];
        switch (key) {
            case 'start':
            case 'end':
            case 'at':
            case 'center':
            case 'xy':
            case 'mid':
                data = parseCoordinates(section);
                return { key, data};
            case 'size':
                data = parseSize(section);
                return { key, data};
            case 'xyz':
                data = parseXyz(section);
                return {key, data};
            case 'layer':
            case 'layers':
                data = parseLayers(section);
                return { key, data};
            case 'property':
            case 'fp_text':
                data = {};
                const result = extractProperty(section)
                if (result && result.property) {
                    data[result.property] = result.value;
                }
                return { key, data };
            case 'footprint':
                data = {};
                if (words.length >= 3) {
                    data['name'] = `${words[1]}:${words[2]}`;
                } else {
                    data['name'] = words[1] || '';
                }
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
                data = section.substr(key.length + 1).trim();
                if (!data) {
                    data = {}
                } 
                return { key, data };
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

function parseSize(section) {
    const matches = section.match(/-?\d+(\.\d+)?/g);
    return {
        w: parseFloat(matches[0]),
        h: parseFloat(matches[1]),
    };
}

function parseXyz(section) {
    const matches = section.match(/-?\d+(\.\d+)?/g);
    return {
        x: parseFloat(matches[0]),
        y: parseFloat(matches[1]),
        z: matches[2] ? parseFloat(matches[2]) : undefined
    };
}

function parseLayers(section) {
     const regex = /(\*\.\w+)|"([^"]+)"/g;

    const matches = [];
    let match;
    while ((match = regex.exec(section)) !== null) {
        if (match[1]) {
            // *.Cu, *.Mask: every layer of that kind
            matches.push(match[1]);
        } else if (match[2]) {
            // "F.Cu", "F.Paste", "F.Mask": one layer
            matches.push(match[2]);
        }
    }

    if (matches.length > 1) {
        return matches;
    } else {
        return matches[0];
    }
}

// a key seen once is a value, seen again a list of them
function updateOrAppendToKey(curObj, key, data) {
    if (curObj.hasOwnProperty(key)) {
        if (!Array.isArray(curObj[key])) {
            let tmp = curObj[key];
            curObj[key] = [];
            curObj[key].push(tmp);
        }
        curObj[key].push(data);
    } else {
        curObj[key] = data;
    }
}

// a (property "Name" "value") or (fp_text "name" "value")'s name and value, its spaces squeezed
function extractProperty(input) {
    const match = input.match(/"([\w\s]+)"\s+"([^"]*)"/); 
    if (!match) {
        return null; 
    }

    const property = match[1].trim(); 
    const value = match[2]
        .split(/\s+/) 
        .filter(v => v.length > 0) 
        .join(' '); 

    return { property, value }; // an empty value too
}
