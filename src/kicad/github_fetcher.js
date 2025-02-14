const axios = require('axios');

const cache = new Map();

function getKey(github) {
    return [github.repo,  github.file].join("/")
}

const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com';

async function fetchFromGithub(github) {
    const key = getKey(github);

    if (cache.has(key)) {
        console.log(`Get data from cache: ${key}`);
        return cache.get(key);
    }

    try {
        const url = `${GITHUB_RAW_BASE_URL}/${github.repo}/main/${github.file}`;
        const response = await axios.get(url);

        cache.set(key, response);
        console.log('Fetched and cached data:', key);

        return response;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        throw error; 
    }
}

module.exports = { fetchFromGithub };
