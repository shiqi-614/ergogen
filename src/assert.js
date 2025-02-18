const m = require('makerjs');
const u = require('./utils');
const Point = require('./point');
const mathjs = require('mathjs');

const assert = exports.assert = (exp, msg, name, value) => {
    if (!exp) {
        const error = new Error(msg);
        error.code = 'ERR_INVALID_ARG_VALUE';
        error.argumentName = name;
        error.argumentValue = value;
        throw error;
    }
};

const mathnum = exports.mathnum = raw => units => {
    return mathjs.evaluate(`${raw}`, units || {});
};

const type = exports.type = val => units => {
    if (Array.isArray(val)) return 'array';
    if (val === null) return 'null';
    try {
        const num = mathnum(val)(units);
        if (typeof num === 'number') return 'number';
    } catch (err) {}
    return typeof val;
};


const sane = exports.sane = (val, name, _type) => units => {
    assert(type(val)(units) === _type, `Field "${name}" should be of type ${_type}!`, name, val);
    if (_type === 'number') return mathnum(val)(units);
    return val;
};


const typeCheck = exports.typeCheck = (val, name, _type) => {
    const actualType = typeof (val);
    assert(actualType === _type, `Field "${name}" should be of type ${_type}, but got ${actualType}!`, name, val);
    return val;
}


const normalizeValue = exports.normalizeValue = (val, name, _type) => units => {
    typeCheck(val, name, _type); 
    if (_type === 'number') return mathnum(val)(units); 
    return val; 
};

const unexpected = exports.unexpected = (obj, name, expected) => {
    const sane_obj = sane(obj, name, 'object')();
    for (const key of Object.keys(sane_obj)) {
        assert(expected.includes(key), `Unexpected key "${key}" within field "${name}"!`, name, key);
    }
};

const _in = exports.in = (raw, name, arr) => {
    assert(arr.includes(raw), `Field "${name}" should be one of [${arr.join(', ')}]!`, name, raw);
    return raw;
};

const arr = exports.arr = (raw, name, length, _type, _default) => units => {
    assert(type(raw)(units) === 'array', `Field "${name}" should be an array!`, name, raw);
    assert(length === 0 || raw.length === length, `Field "${name}" should be an array of length ${length}!`, name, raw);
    raw = raw.map(val => val === undefined ? _default : val);
    raw.forEach(val => assert(type(val)(units) === _type, `Field "${name}" should contain ${_type}s!`, name, val));
    if (_type === 'number') {
        raw = raw.map(val => mathnum(val)(units));
    }
    return raw;
};

const numarr = exports.numarr = (raw, name, length) => units => arr(raw, name, length, 'number', 0)(units);
const strarr = exports.strarr = (raw, name) => arr(raw, name, 0, 'string', '')();

const xy = exports.xy = (raw, name) => units => numarr(raw, name, 2)(units);

const wh = exports.wh = (raw, name) => units => {
    if (!Array.isArray(raw)) raw = [raw, raw];
    return xy(raw, name)(units);
};

exports.trbl = (raw, name, _default = 0) => units => {
    if (!Array.isArray(raw)) raw = [raw, raw, raw, raw];
    if (raw.length === 2) raw = [raw[1], raw[0], raw[1], raw[0]];
    return arr(raw, name, 4, 'number', _default)(units);
};

exports.asym = (raw, name) => {
    const source_aliases = ['source', 'origin', 'base', 'primary', 'left'];
    const clone_aliases = ['clone', 'image', 'derived', 'secondary', 'right'];
    _in(raw, name, ['both'].concat(source_aliases, clone_aliases));
    if (source_aliases.includes(raw)) return 'source';
    if (clone_aliases.includes(raw)) return 'clone';
    return raw;
};
