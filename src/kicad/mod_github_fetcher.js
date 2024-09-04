const axios = require('axios');
const { parseContent } = require('./mod_parser');

const cache = new Map();

async function fetchAndCache(footprintName) {
    // 尝试从缓存中获取数据
    if (cache.has(footprintName)) {
        console.log("get data from cache: " + footprintName);
        return cache.get(footprintName);
    }
    
    try {
        // 如果缓存中没有数据，进行HTTP请求
        const url = `https://raw.githubusercontent.com/shiqi-614/ErgoCai.pretty/main/${footprintName}.kicad_mod`;
        const response = await axios.get(url);
        // console.log("get from github:" + response.data);
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


module.exports = { fetchAndCache };
