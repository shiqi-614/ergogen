const { fetchFromGithub } = require('./github_fetcher');
const { parseContent } = require('./mod_parser');

const kicadMods = new Map();

async function fetchKicadMod(what) {
    console.log("try to get footprint: " + JSON.stringify(what));
    const normalizedWhat = normalizeWhat(what);
    if (normalizedWhat.github) {
        const response = await fetchFromGithub(normalizedWhat.github);
        const data = parseContent(response.data);
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
                repo: 'shiqi-614/ErgoCai.pretty',
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
