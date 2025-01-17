const fs = require('fs');
const axios = require('axios');
const u = require('../utils')

function transfer(data) {
    const transformedDict = {};

    console.log("data: " + JSON.stringify(data));
    for (const key in data) {
        const values = data[key];
        values.forEach(value => {
            transformedDict[value] = key;
        });
    }
    console.log("transformedDict: " + JSON.stringify(transformedDict));
    return transformedDict;
}

const fetchFootprintTypes = async () => {

    if (u.isNode()) {
        try {
            const path = require('path');
            const modFolderPath = path.join(__dirname, './ErgoCai.pretty');
            const filePath = path.join(modFolderPath, 'footprintTypes.json');
            const content = fs.readFileSync(filePath, 'utf-8');

            console.log("read types from local file " + content);
            return transfer(JSON.parse(content));
        } catch (error) {
            console.error('Error fetching the JSON from local file:', error);
        }
    }

    try {

        const response = await axios.get('https://raw.githubusercontent.com/shiqi-614/ErgoCai.pretty/main/footprintTypes.json');
        const data = response.data;
        return transfer(data);
    } catch (error) {
        console.error('Error fetching the JSON from network:', error);
        return {};
    }
};


module.exports = {
    fetchFootprintTypes
};
