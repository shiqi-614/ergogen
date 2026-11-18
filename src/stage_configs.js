// Where kicadgen (which makes the KiCad projects) answers: on this machine while developing, else the server's
// container. The stage is NODE_ENV in Node, window.stage in a browser, production without either.
const stage_configs = {
    development: {
        KICADGEN_API_URL: 'http://127.0.0.1:5001/generate',
    },
    production: {
        KICADGEN_API_URL: 'http://kicadgen:5001/generate',
    },
}

const stage = () => {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) return process.env.NODE_ENV
    if (typeof window !== 'undefined' && window.stage) return window.stage
    return 'production'
}

module.exports = stage_configs[stage()]
