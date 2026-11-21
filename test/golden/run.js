// A before/after check for refactoring: runs ergogen on the example configs and keeps a summary of everything it
// makes (points, outlines, pcbs and their previews, cases, assemblies, errors), to compare a later run against.
//
//   node test/golden/run.js --save     keep the summaries in test/golden/snapshots
//   node test/golden/run.js --check    run again and list what differs (exit 1 if anything does)
//
// The footprint libraries come from local clones, at their committed HEAD, instead of GitHub (no network, no rate
// limit, and the same files every run): ERGOCAI_LIB and ERGOCAI_MODULES name the clones, ~/Development/ErgoCaiLib and
// ~/Development/ErgoCai.modules by default. The ErgoCai config is ergogen-gui's example as committed (ERGOGEN_GUI).
// GOLDEN_STL_DIR=<dir> also writes each config's case STLs there (the last config's win), to look at.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {execFileSync} = require('child_process')

const root = path.join(__dirname, '..', '..')
const home = os.homedir()
const repos = {
    'shiqi-614/ErgoCaiLib': process.env.ERGOCAI_LIB || path.join(home, 'Development', 'ErgoCaiLib'),
    'shiqi-614/ErgoCai.modules': process.env.ERGOCAI_MODULES || path.join(home, 'Development', 'ErgoCai.modules'),
}
const gui = process.env.ERGOGEN_GUI || path.join(home, 'Development', 'ergogen-gui')
const snapshots = path.join(__dirname, 'snapshots')

// --- GitHub, answered from the local clones ---

const git = (repo, ...args) => execFileSync('git', ['-C', repos[repo], ...args], {maxBuffer: 1 << 28})
const clone = name => {
    const repo = Object.keys(repos).find(r => r.toLowerCase() === name.replace(/\/+$/, '').toLowerCase())
    if (!repo) throw new Error(`no local clone for ${name}`)
    return repo
}
const answer = url => {
    let m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\/main/)
    if (m) return git(clone(m[1]), 'rev-parse', 'HEAD').toString().trim()
    m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\//)
    if (m) {
        const tree = git(clone(m[1]), 'ls-tree', '-r', 'HEAD').toString().trim().split('\n').map(line => {
            const [meta, file] = line.split('\t')
            const [, type, sha] = meta.split(' ')
            return {path: file, type, sha}
        })
        return {truncated: false, tree}
    }
    m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\/(.+)$/)
    if (m) return git(clone(m[1]), 'show', `HEAD:${decodeURIComponent(m[2])}`).toString()
    throw new Error(`unexpected request ${url}`)
}
// every copy of axios ergogen's modules load
for (const from of ['src', 'src/kicad']) {
    const axios = require(require.resolve('axios', {paths: [path.join(root, from)]}))
    axios.get = async url => ({data: answer(url)})
}
// the caches keep nothing between runs
global.localStorage = undefined

// --- the configs ---

const configs = () => {
    const list = []
    // the example as committed: a change someone is still making to it is not this run's business
    let ts = null
    try { ts = execFileSync('git', ['-C', gui, 'show', 'HEAD:src/examples/ErgoCai.ts']).toString() } catch (e) {}
    if (ts) {
        const text = ts.slice(ts.indexOf('`') + 1, ts.lastIndexOf('`')).replace(/\\\$/g, '$').replace(/\\`/g, '`')
        list.push({name: 'ErgoCai', text})
    }
    const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(e => {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.ya?ml$/.test(e.name)) list.push({name: path.relative(path.join(root, 'test'), full), text: fs.readFileSync(full, 'utf8')})
    })
    walk(path.join(root, 'test'))
    return list
}

// --- a summary that stays the same when the results do ---

const sha = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
const summary = value => {
    if (value === null || value === undefined) return value
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : String(value)
    if (typeof value === 'string') return value.length > 160 ? `sha:${sha(value)}:${value.length}` : value
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `bytes:${sha(Buffer.from(value))}:${value.length}`
    if (typeof value === 'function') return 'function'
    if (Array.isArray(value)) return value.map(summary)
    if (typeof value === 'object') {
        const out = {}
        for (const key of Object.keys(value).sort()) out[key] = summary(value[key])
        return out
    }
    return value
}

// as ergogen-gui hands a config over: the sections it knows, each at least empty
const asTheGuiDoes = text => {
    let config
    try { config = require('js-yaml').load(text) } catch (e) { return text }
    if (!config || typeof config !== 'object' || !config.points) return text
    const sections = ['points', 'units', 'variables', 'outlines', 'pcbs', 'cases', 'assemblies']
    return {...Object.fromEntries(sections.map(k => [k, {...config[k]}])), is_preview: true, raw: text}
}

const run = async ({text}) => {
    const ergogen = require(path.join(root, 'src', 'ergogen.js'))
    const log = console.log, error = console.error
    console.log = () => {}
    // GOLDEN_VERBOSE=1 keeps what ergogen logs as an error (a footprint it could not place, say)
    if (!process.env.GOLDEN_VERBOSE) console.error = () => {}
    try {
        const results = await ergogen.process(asTheGuiDoes(text), true, () => {}, {tolerant: true})
        // GOLDEN_STL_DIR=<dir> writes the cases' STLs there too, to look at
        if (process.env.GOLDEN_STL_DIR && results.cases) {
            fs.mkdirSync(process.env.GOLDEN_STL_DIR, {recursive: true})
            for (const [name, made] of Object.entries(results.cases)) {
                if (made.stl) fs.writeFileSync(path.join(process.env.GOLDEN_STL_DIR, `${name}.stl`), made.stl)
            }
        }
        // what is made, not how it was asked for
        delete results.raw
        delete results.config
        delete results.canonical
        return summary(results)
    } catch (e) {
        return {failed: String(e && e.message || e)}
    } finally {
        console.log = log
        console.error = error
    }
}

// the first few places two summaries differ
const differences = (a, b, at = '', out = []) => {
    if (out.length >= 12) return out
    if (JSON.stringify(a) === JSON.stringify(b)) return out
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${at}.${key}`, out)
    } else out.push(`${at}: ${JSON.stringify(a)?.slice(0, 100)} → ${JSON.stringify(b)?.slice(0, 100)}`)
    return out
}

const main = async () => {
    const mode = process.argv[2]
    if (!['--save', '--check'].includes(mode)) throw new Error('usage: node test/golden/run.js --save | --check')
    fs.mkdirSync(snapshots, {recursive: true})
    let differ = 0
    for (const config of configs()) {
        const file = path.join(snapshots, config.name.replace(/[\/\\]/g, '__') + '.json')
        const now = await run(config)
        if (mode === '--save') {
            fs.writeFileSync(file, JSON.stringify(now, null, 1))
            console.log(`saved ${config.name}${now.failed ? ` (fails: ${now.failed.slice(0, 80)})` : ''}`)
            continue
        }
        const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
        const found = before ? differences(before, now) : ['no saved summary']
        if (found.length) {
            differ++
            console.log(`✗ ${config.name}\n    ${found.join('\n    ')}`)
        } else console.log(`✓ ${config.name}`)
    }
    if (mode === '--check') {
        console.log(differ ? `\n${differ} differ` : '\nall the same')
        process.exit(differ ? 1 : 0)
    }
}

main().catch(e => { console.error(e); process.exit(1) })
