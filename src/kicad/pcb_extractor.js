// A module's board (a .kicad_pcb in a GitHub repo): its footprints, as pcbs.js places them (each where it is on the
// module board, in ErgoCaiLib), and its tracks and vias. Read once, and again when its repo changes the file.
const {parseContent} = require('./mod_parser')
const {fetchWhat, checkRepo, normalizeWhat} = require('./fetcher')
const u = require('../utils')
const Cache = require('./cache')
const pcbCache = new Cache('kicad_pcb')

const listOf = item => !item ? [] : Array.isArray(item) ? item : [item]

// The board's footprints by reference: their library footprint (a "lib:name" is ErgoCaiLib's footprints/lib/name),
// value, place on the board (KiCad's y down, so flipped) and side
function extractFootprints(raw) {
    const result = {}
    for (const fp of listOf(raw)) {
        const fields = fp.property || fp.fp_text || []
        const reference = fields.find(p => p.Reference)?.Reference || 'UNKNOWN'
        const value = fields.find(p => p.Value)?.Value
        const [lib, name] = fp.name.includes(':') ? fp.name.split(':') : ['unknown', fp.name]
        result[reference] = {
            what: {...(value && {value}), github: {repo: 'shiqi-614/ErgoCaiLib/', file: `footprints/${lib}/${name}.kicad_mod`}},
            where: {shift: [fp.at?.x ?? 0, -(fp.at?.y ?? 0)], rotate: fp.at?.angle ?? 0},
            side: fp.layer === 'F.Cu' ? 'front' : fp.layer === 'B.Cu' ? 'back' : '',
        }
    }
    return result
}

async function parsePcbContent(moduleConfig) {
    const key = u.getGithubKey(normalizeWhat(moduleConfig.what).github)
    // drops the parsed copy too if the repo has changed the file
    await checkRepo(normalizeWhat(moduleConfig.what).github.repo)
    if (pcbCache.has(key)) return pcbCache.get(key)
    const parsed = parseContent(await fetchWhat(moduleConfig.what))
    const data = {module: {footprints: extractFootprints(parsed.footprint), segments: listOf(parsed.segment), vias: listOf(parsed.via)}}
    pcbCache.set(key, data)
    return data
}

module.exports = {parsePcbContent}
