const axios = require('axios');

const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1小时，单位为毫秒

function getKey(github) {
    return [github.repo, github.file].join("/");
}

const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com';

async function fetchFromGithub(github) {
    const key = getKey(github);

    if (cache.has(key)) {
        const { timestamp, data } = cache.get(key);
        const now = Date.now();

        // 检查缓存是否在一小时内
        if (now - timestamp < CACHE_DURATION) {
            console.log(`Get data from cache: ${key}`);
            return data;
        } else {
            console.log(`Cache expired for: ${key}`);
            cache.delete(key); // 删除过期缓存
        }
    }

    try {
        const url = `${GITHUB_RAW_BASE_URL}/${github.repo}/main/${github.file}`;
        const response = await axios.get(url);

        // 存储缓存数据和时间戳
        cache.set(key, {
            timestamp: Date.now(),
            data: response
        });

        console.log('Fetched and cached data:', key);

        return response;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        throw error;
    }
}

module.exports = { fetchFromGithub };
