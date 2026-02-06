const axios = require('axios');
const { Cache } = require('./cache');
const gitCache = new Cache();

function getKey(github) {
    return [github.repo, github.file].join("/");
}

const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com';

async function fetchFromGithub(github) {
    const key = getKey(github);

    if (gitCache.has(key)) {
        return gitCache.get(key);
    }

    try {
        const url = `${GITHUB_RAW_BASE_URL}/${github.repo}/main/${github.file}`;
        const response = await axios.get(url);

        // 存储缓存数据和时间戳
        gitCache.set(key, response);

        console.log('Fetched and cached data:', key);

        return response;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        throw error;
    }
}

module.exports = { fetchFromGithub };
