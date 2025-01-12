const m = require('makerjs')
const u = require('./utils')
const a = require('./assert')
const prep = require('./prepare')
const anchor_lib = require('./anchor')


// 通用工具函数
const ensureObject = (obj, path) => a.sane(obj || {}, path, 'object')();
const ensureNumber = (val, path, units, defaultValue = 0) =>
    a.sane(val ?? defaultValue, path, 'number')(units);
const ensureBoolean = (val, path, defaultValue = false) =>
    a.sane(val ?? defaultValue, path, 'boolean')();

const pushRotation = (list, angle, origin) => {
    let candidate = origin;
    for (const r of list) {
        candidate = m.point.rotate(candidate, r.angle, r.origin);
    }
    list.push({ angle, origin: candidate });
};

const combineRows = (zoneRows, colRows) =>
    Object.keys(prep.extend(zoneRows, colRows)).length
        ? prep.extend(zoneRows, colRows)
        : { default: {} };


const extendKeyMetaByPriority = (globalKey, zoneKey, colKey, rowConfig, units) => {
    const defaultKey = u.createDefaultKey(units);
    const key = prep.extend(
        defaultKey,
        globalKey,
        zoneKey,
        colKey,
        rowConfig || {}
    );

    key.stagger = a.sane(key.stagger, `${key.name}.stagger`, 'number')(units)
    key.spread = a.sane(key.spread, `${key.name}.spread`, 'number')(units)
    key.splay = a.sane(key.splay, `${key.name}.splay`, 'number')(units)
    key.origin = a.xy(key.origin, `${key.name}.origin`)(units)
    key.orient = a.sane(key.orient, `${key.name}.orient`, 'number')(units)
    key.shift = a.xy(key.shift, `${key.name}.shift`)(units)
    key.rotate = a.sane(key.rotate, `${key.name}.rotate`, 'number')(units)
    key.width = a.sane(key.width, `${key.name}.width`, 'number')(units)
    key.height = a.sane(key.height, `${key.name}.height`, 'number')(units)
    key.padding = a.sane(key.padding, `${key.name}.padding`, 'number')(units)
    key.skip = a.sane(key.skip, `${key.name}.skip`, 'boolean')()
    key.asym = a.asym(key.asym, `${key.name}.asym`)
    return key;
};

const fillNameByTemplate = (key, zone, zoneName, col, colName, row, units) => {
    // Set metadata
    key.zone = zone;
    key.zone.name = zoneName;
    key.col = col;
    key.col.name = colName;
    key.row = row;
    key.column_name = colName;
    key.row_name = row;

    // Process template strings
    Object.entries(key).forEach(([k, v]) => {
        if (a.type(v)(units) === 'string') {
            key[k] = u.template(v, key);
        }
    });
};

const renderZone = (zoneName, zone, zoneAnchor, globalKey, units) => {
    const cols = ensureObject(zone.columns, `points.zones.${zoneName}.columns`);
    const zoneRows = ensureObject(zone.rows, `points.zones.${zoneName}.rows`);
    const zoneKey = ensureObject(zone.key, `points.zones.${zoneName}.key`);

    const points = {};
    const rotations = [{ angle: zoneAnchor.r, origin: zoneAnchor.p }];
    zoneAnchor.r = 0; // Clear rotation


    let firstCol = true;
    Object.entries(cols).forEach(([colName, col]) => {
        col = ensureObject(col, `points.zones.${zoneName}.columns.${colName}`);
        const combinedRows = combineRows(zoneRows, col.rows);
        const keys = Object.keys(combinedRows).map(row => {
            const key = extendKeyMetaByPriority( 
                globalKey,
                zoneKey,
                col.key,
                combinedRows[row],
                units
            );
            fillNameByTemplate(key, zone, zoneName, col, colName, row, units);
            return key;
        });

         // setting up column-level anchor
        if (!firstCol) {
            zoneAnchor.x += keys[0].spread
        }
        zoneAnchor.y += keys[0].stagger
        const colAnchor = zoneAnchor.clone();
        if (keys[0].splay) {
            pushRotation(
                rotations,
                keys[0].splay,
                colAnchor.clone().shift(keys[0].origin, false).p
            );
        }
        let runningAnchor = colAnchor.clone();
        rotations.forEach(r =>
            runningAnchor.rotate(r.angle, r.origin)
        );

        keys.forEach(key => {
            let point = runningAnchor.clone();
            point.r += key.orient;
            point.shift(key.shift);
            point.r += key.rotate;

            point = anchor_lib.parse(key.adjust, `${key.name}.adjust`, {}, point)(units);

            point.meta = key;
            points[key.name] = point;

            runningAnchor.shift([0, key.padding])

        });
        firstCol = false;
    });

    return points;
};

const parse_axis = exports._parse_axis = (config, name, points, units) => {
    if (!['number', 'undefined'].includes(a.type(config)(units))) {
        const mirror_obj = a.sane(config, name, 'object')()
        const distance = a.sane(mirror_obj.distance || 0, `${name}.distance`, 'number')(units)
        delete mirror_obj.distance
        let axis = anchor_lib.parse(mirror_obj, name, points)(units).x
        axis += distance / 2
        return axis
    } else return config
}

const perform_mirror = exports._perform_mirror = (point, axis) => {
    point.meta.mirrored = false
    if (point.meta.asym == 'source') return ['', null]
    const mp = point.clone().mirror(axis)
    const mirrored_name = `mirror_${point.meta.name}`
    mp.meta = prep.extend(mp.meta, mp.meta.mirror || {})
    mp.meta.name = mirrored_name
    mp.meta.colrow = `mirror_${mp.meta.colrow}`
    mp.meta.mirrored = true
    if (point.meta.asym == 'clone') {
        point.meta.skip = true
    }
    return [mirrored_name, mp]
}

const perform_autobind = exports._perform_autobind = (points, units) => {

    const bounds = {}
    const col_lists = {}
    const mirrorzone = p => (p.meta.mirrored ? 'mirror_' : '') + p.meta.zone.name

    // round one: get column upper/lower bounds and per-zone column lists
    for (const p of Object.values(points)) {

        const zone = mirrorzone(p)
        const col = p.meta.col.name

        if (!bounds[zone]) bounds[zone] = {}
        if (!bounds[zone][col]) bounds[zone][col] = {min: Infinity, max: -Infinity}
        if (!col_lists[zone]) col_lists[zone] = Object.keys(p.meta.zone.columns)

        bounds[zone][col].min = Math.min(bounds[zone][col].min, p.y)
        bounds[zone][col].max = Math.max(bounds[zone][col].max, p.y)
    }

    // round two: apply autobind as appropriate
    for (const p of Object.values(points)) {

        const autobind = a.sane(p.meta.autobind, `${p.meta.name}.autobind`, 'number')(units)
        if (!autobind) continue

        const zone = mirrorzone(p)
        const col = p.meta.col.name
        const col_list = col_lists[zone]
        const col_bounds = bounds[zone][col]

        
        // specify default as -1, so we can recognize where it was left undefined even after number-ification
        const bind = p.meta.bind = a.trbl(p.meta.bind, `${p.meta.name}.bind`, -1)(units)

        // up
        if (bind[0] == -1) {
            if (p.y < col_bounds.max) bind[0] = autobind
            else bind[0] = 0
        }

        // down
        if (bind[2] == -1) {
            if (p.y > col_bounds.min) bind[2] = autobind
            else bind[2] = 0
        }

        // left
        if (bind[3] == -1) {
            bind[3] = 0
            const col_index = col_list.indexOf(col)
            if (col_index > 0) {
                const left = bounds[zone][col_list[col_index - 1]]
                if (left && p.y >= left.min && p.y <= left.max) {
                    bind[3] = autobind
                }
            }
        }

        // right
        if (bind[1] == -1) {
            bind[1] = 0
            const col_index = col_list.indexOf(col)
            if (col_index < col_list.length - 1) {
                const right = bounds[zone][col_list[col_index + 1]]
                if (right && p.y >= right.min && p.y <= right.max) {
                    bind[1] = autobind
                }
            }
        }
    }
}

exports.parse = (config, units) => {

    // config sanitization
    a.unexpected(config, 'points', ['zones', 'key', 'rotate', 'mirror'])
    const zones = a.sane(config.zones, 'points.zones', 'object')()
    const global_key = a.sane(config.key || {}, 'points.key', 'object')()
    const global_rotate = a.sane(config.rotate || 0, 'points.rotate', 'number')(units)
    const global_mirror = config.mirror
    let points = {}

    // rendering zones
    for (let [zone_name, zone] of Object.entries(zones)) {

        // zone sanitization
        zone = a.sane(zone || {}, `points.zones.${zone_name}`, 'object')()

        // extracting keys that are handled here, not at the zone render level
        const anchor = anchor_lib.parse(zone.anchor || {}, `points.zones.${zone_name}.anchor`, points)(units)
        const rotate = a.sane(zone.rotate || 0, `points.zones.${zone_name}.rotate`, 'number')(units)
        const mirror = zone.mirror
        delete zone.anchor
        delete zone.rotate
        delete zone.mirror

        // creating new points
        let new_points = renderZone(zone_name, zone, anchor, global_key, units)

        // simplifying the names in individual point "zones" and single-key columns
        while (Object.keys(new_points).some(k => k.endsWith('_default'))) {
            for (const key of Object.keys(new_points).filter(k => k.endsWith('_default'))) {
                const new_key = key.slice(0, -8)
                new_points[new_key] = new_points[key]
                new_points[new_key].meta.name = new_key
                delete new_points[key]
            }
        }

        // adjusting new points
        for (const [new_name, new_point] of Object.entries(new_points)) {
            
            // issuing a warning for duplicate keys
            if (Object.keys(points).includes(new_name)) {
                throw new Error(`Key "${new_name}" defined more than once!`)
            }

            // per-zone rotation
            if (rotate) {
                new_point.rotate(rotate)
            }
        }

        // adding new points so that they can be referenced from now on
        points = Object.assign(points, new_points)

        // per-zone mirroring for the new keys
        const axis = parse_axis(mirror, `points.zones.${zone_name}.mirror`, points, units)
        if (axis !== undefined) {
            const mirrored_points = {}
            for (const new_point of Object.values(new_points)) {
                const [mname, mp] = perform_mirror(new_point, axis)
                if (mp) {
                    mirrored_points[mname] = mp
                }
            }
            points = Object.assign(points, mirrored_points)
        }
    }

    // applying global rotation
    for (const point of Object.values(points)) {
        if (global_rotate) {
            point.rotate(global_rotate)
        }
    }

    // global mirroring for points that haven't been mirrored yet
    const global_axis = parse_axis(global_mirror, `points.mirror`, points, units)
    const global_mirrored_points = {}
    for (const point of Object.values(points)) {
        if (global_axis !== undefined && point.meta.mirrored === undefined) {
            const [mname, mp] = perform_mirror(point, global_axis)
            if (mp) {
                global_mirrored_points[mname] = mp
            }
        }
    }
    points = Object.assign(points, global_mirrored_points)

    // removing temporary points
    const filtered = {}
    for (const [k, p] of Object.entries(points)) {
        if (p.meta.skip) continue
        filtered[k] = p
    }

    // apply autobind
    perform_autobind(filtered, units)

    // done
    return filtered
}

exports.visualize = (points, units) => {
    const models = {}
    for (const [pname, p] of Object.entries(points)) {
        const w = p.meta.width
        const h = p.meta.height
        const rect = u.rect(w, h, [-w/2, -h/2])
        models[pname] = p.position(rect)
    }
    return {models: models}
}
