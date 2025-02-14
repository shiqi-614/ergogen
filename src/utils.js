const m = require('makerjs')

const deepcopy = exports.deepcopy = value => {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

const array = exports.array = (obj) => {

}
const convertArrayFieldToObject = exports.convertArrayFieldToObject = (data, fieldName)  => {
    if (data[fieldName] && Array.isArray(data[fieldName])) {
        data[fieldName] = { ...data[fieldName] };
    } 
    return data[fieldName];
}

const merge = exports.merge = (whereParent, whereChild) => {
    if (whereParent == null && whereChild == null) {
        return null;
    }
    const where = deepcopy(whereParent);
    where.rotate = combineNumber(whereParent?.rotate ?? 0,  whereChild?.rotate ?? 0);
    where.shift = combineNumber(whereParent?.shift ?? 0, whereChild?.shift ?? 0);
    return where;
}

function combineNumber(obj1, obj2) {
    const shift1 = obj1 ?? 0;
    const shift2 = obj2 ?? 0;

    // If both shifts are numbers
    if (typeof shift1 === 'number' && typeof shift2 === 'number') {
        return shift1 + shift2;
    }

    // If one or both shifts are arrays
    const array1 = Array.isArray(shift1) ? shift1 : [shift1];
    const array2 = Array.isArray(shift2) ? shift2 : [shift2];

    // Find the maximum length of the two arrays
    const maxLength = Math.max(array1.length, array2.length);

    // Create a new array by adding corresponding elements
    const result = [];
    for (let i = 0; i < maxLength; i++) {
        const val1 = array1[i] || 0; // Default to 0 if array1 is shorter
        const val2 = array2[i] || 0; // Default to 0 if array2 is shorter
        result.push(val1 + val2);
    }

    return result;
}

const deep = exports.deep = (obj, key, val) => {
    const levels = key.split('.')
    const last = levels.pop()
    let step = obj
    for (const level of levels) {
        step[level] = step[level] || {}
        step = step[level]
    }
    if (val === undefined) return step[last]
    step[last] = val
    return obj
}

exports.template = (str, vals={}) => {
    const regex = /\{\{([^}]*)\}\}/g
    let res = str
    let shift = 0
    for (const match of str.matchAll(regex)) {
        const replacement = (deep(vals, match[1]) || '') + ''
        res = res.substring(0, match.index + shift)
            + replacement
            + res.substring(match.index + shift + match[0].length)
        shift += replacement.length - match[0].length
    }
    return res
}

const eq = exports.eq = (a=[], b=[]) => {
    return a[0] === b[0] && a[1] === b[1]
}

const line = exports.line = (a, b) => {
    return new m.paths.Line(a, b)
}

exports.circle = (p, r) => {
    return {paths: {circle: new m.paths.Circle(p, r)}}
}

exports.rect = (w, h, o=[0, 0]) => {
    const res = {
        top:    line([0, h], [w, h]),
        right:  line([w, h], [w, 0]),
        bottom: line([w, 0], [0, 0]),
        left:   line([0, 0], [0, h])
    }
    return m.model.move({paths: res}, o)
}

exports.poly = (arr) => {
    let counter = 0
    let prev = arr[arr.length - 1]
    const res = {
        paths: {}
    }
    for (const p of arr) {
        if (eq(prev, p)) continue
        res.paths['p' + (++counter)] = line(prev, p)
        prev = p
    }
    return res
}

exports.bbox = (arr) => {
    let minx = Infinity
    let miny = Infinity
    let maxx = -Infinity
    let maxy = -Infinity
    for (const p of arr) {
        minx = Math.min(minx, p[0])
        miny = Math.min(miny, p[1])
        maxx = Math.max(maxx, p[0])
        maxy = Math.max(maxy, p[1])
    }
    return {low: [minx, miny], high: [maxx, maxy]}
}

const farPoint = exports.farPoint = [1234.1234, 2143.56789]

exports.union = exports.add = (a, b) => {
    return m.model.combine(a, b, false, true, false, true, {
        farPoint
    })
}

exports.subtract = (a, b) => {
    return m.model.combine(a, b, false, true, true, false, {
        farPoint
    })
}

exports.intersect = (a, b) => {
    return m.model.combine(a, b, true, false, true, false, {
        farPoint
    })
}

exports.stack = (a, b) => {
    return {
        models: {
            a, b
        }
    }
}

const semver = exports.semver = (str, name='') => {
    let main = str.split('-')[0]
    if (main.startsWith('v')) {
        main = main.substring(1)
    }
    while (main.split('.').length < 3) {
        main += '.0'
    }
    if (/^\d+\.\d+\.\d+$/.test(main)) {
        const parts = main.split('.').map(part => parseInt(part, 10))
        return {major: parts[0], minor: parts[1], patch: parts[2]}
    } else throw new Error(`Invalid semver "${str}" at ${name}!`)
}

const satisfies = exports.satisfies = (current, expected) => {
    if (current.major === undefined) current = semver(current)
    if (expected.major === undefined) expected = semver(expected)
    return current.major === expected.major && (
        current.minor > expected.minor || (
            current.minor === expected.minor && 
            current.patch >= expected.patch
        )
    )
}

exports.createDefaultKey = (units) => ({
    stagger: units.$default_stagger,
    spread: units.$default_spread,
    splay: units.$default_splay,
    origin: [0, 0],
    orient: 0,
    shift: [0, 0],
    rotate: 0,
    adjust: {},
    width: units.$default_width,
    height: units.$default_height,
    padding: units.$default_padding,
    autobind: units.$default_autobind,
    skip: false,
    asym: 'both',
    colrow: '{{col.name}}_{{row}}',
    name: '{{zone.name}}_{{colrow}}',
});

exports.isNode = () =>
    typeof process !== "undefined" && 
    process.versions?.node != null;
