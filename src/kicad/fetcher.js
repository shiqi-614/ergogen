// The footprints' files on GitHub (fetched through github_fetcher.js): a footprint's what is a path in ErgoCaiLib,
// or {github: {repo, file}}; a .kicad_mod is parsed (mod_parser.js) and kept.
const {fetchFromGithub, checkRepo} = require('./github_fetcher')
const {parseContent} = require('./mod_parser')
const u = require('../utils')
const Cache = require('./cache')
const modCache = new Cache('kicad_mod')

// a footprint's what as {github: {repo, file}}: a plain path is one in ErgoCaiLib
function normalizeWhat(what) {
    if (typeof what === 'string') return {github: {repo: 'shiqi-614/ErgoCaiLib', file: what}}
    if (what.github) return {github: {...what.github}}
}

// A footprint's .kicad_mod, parsed; the parsed copy goes when its repo changes the file (checkRepo)
async function fetchKicadMod(what) {
    const {github} = normalizeWhat(what)
    if (!github) return
    const key = u.getGithubKey(github)
    await checkRepo(github.repo)
    if (modCache.has(key)) return modCache.get(key)
    const data = parseContent((await fetchFromGithub(github)).data)
    modCache.set(key, data)
    return data
}

// a file what names, as text
async function fetchWhat(what) {
    const {github} = normalizeWhat(what)
    if (github) return (await fetchFromGithub(github)).data
}

module.exports = {fetchKicadMod, normalizeWhat, fetchWhat, checkRepo}
