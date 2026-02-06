const { fetchFromGithub } = require('./github_fetcher');
const { parseContent } = require('./mod_parser');
const u = require('../utils')
const { Cache } = require('./cache');
const modCache = new Cache();


async function fetchKicadMod(what) {
    console.log("try to get footprint: " + JSON.stringify(what));
    const normalizedWhat = normalizeWhat(what);
    if (normalizedWhat.github) {
        const key = u.getGithubKey(normalizedWhat.github);
        if (modCache.has(key)) {
            return modCache.get(key);
        }
        const response = await fetchFromGithub(normalizedWhat.github);
        const data = parseContent(response.data);
        modCache.set(key, data);
        return data;
    }
}

async function fetchWhat(what) {
    const normalizedWhat = normalizeWhat(what);
    if (normalizedWhat.github) {
        const response = await fetchFromGithub(normalizedWhat.github);
        return response.data;
    }
}

function normalizeWhat(what) {
    if ('string' === typeof what) {
        return {
            github: {
                repo: 'shiqi-614/ErgoCaiLib',
                file: what
            }
        };
         
    } else if (what.github) {
        return {
            github: { ...what.github }
        };
    }
}


module.exports = { fetchKicadMod, normalizeWhat, fetchWhat };
