const m = require('makerjs')
const a = require('./assert')
const o = require('./operation')
const Point = require('./point')
const footprint_shape = require('./kicad/footprint_shape')
const u = require("./utils");
const outlines_lib = require("./outlines");
const io = require("./io");
const manifold = require("./manifold");


function rectFromExtents(ext, expand = 0) {
    if (ext.paths !== undefined) {
        let maxRadius = -Infinity;
        let maxCirclePath = null;
        let maxCircleId = null;

        for (const pathId in ext.paths) {
            const path = ext.paths[pathId];

            if (path.type === 'circle') {
                const radius = path.radius;
                if (radius > maxRadius) {
                    maxRadius = radius;
                    maxCirclePath = path;
                    maxCircleId = pathId;
                }
            }
        }

        if (maxCirclePath !== null) {
            const expandedRadius = maxCirclePath.radius + expand;
            return {
                paths: {
                    [maxCircleId]: new m.paths.Circle([...maxCirclePath.origin], expandedRadius)
                }
            }
        }
    }
    if (ext.high !== undefined) {
        const w = (ext.high[0] - ext.low[0]) + expand * 2
        const h = (ext.high[1] - ext.low[1]) + expand * 2

        const rect = new m.models.Rectangle(w, h)

        // 左下角往 (-expand, -expand) 移
        m.model.move(rect, [
            ext.low[0] - expand,
            ext.low[1] - expand
        ])

        return rect

    }
}

function resolveFromDict(dict, pattern) {
    pattern = pattern.trim();

    if (!pattern.startsWith('/')) {
        const value = dict[pattern];
        return value !== undefined
            ? [{ key: pattern, value }]
            : [];
    }

    const regexStr = pattern.slice(1).trim();
    let regex;

    try {
        const parts = regexStr.split('/');
        const flags = parts.length > 1 ? parts.pop() : '';
        const regexPattern = parts.join('/').trim();
        regex = new RegExp(regexPattern, flags);
    } catch (e) {
        console.error(`Invalid regex: ${pattern}`, e);
        return [];
    }

    return Object.entries(dict)
        .filter(([key]) => regex.test(key))
        .map(([key, value]) => ({ key, value }));
}

exports.parse = async (config, cases_config, outlines, previews, points, units) => {


    a.sane(cases_config, 'cases', 'object')()

    const footprints = {}
    for (let [pcb, data] of Object.entries(previews)) {
        for (let [footprint, obj] of Object.entries(data['footprints'])) {
            footprints[`${pcb}.${footprint}`] = obj;
        }
    }

    const mirror_outlines = {}
    const { mirror_points, _} = u.splitMirrorPoints(points);
    const mirror_outlines_raw = outlines_lib.parse(config.outlines || {}, mirror_points, units)

    for (const [name, outline] of Object.entries(mirror_outlines_raw)) {
        mirror_outlines[name] = io.twodee(outline)
    }

    const wasm = await manifold.load()
    // every case's solid stays alive until the last case is built: later cases can reuse earlier ones
    const solids = {}
    const results = {}

    try {
    for (let [case_name, case_config] of Object.entries(cases_config)) {
        let mirrored = false;
        if (case_config.mirror) {
            const origin_config = cases_config[case_config.mirror.from];
            mirrored = true;
            case_config = origin_config;
        }

        if (a.type(case_config)() === 'array') {
            case_config = { ...case_config }
        }

        const parts = a.sane(case_config, `cases.${case_name}`, 'object')()

        let result = null

        for (let [part_name, part] of Object.entries(parts)) {

            if (a.type(part)() === 'string') {
                part = o.operation(part, {
                    outline: Object.keys(outlines),
                    case: Object.keys(solids)
                }, ['case', 'outline'])
            }

            const part_qname = `cases.${case_name}.${part_name}`

            a.unexpected(part, part_qname, [
                'what', 'name', 'extrude', 'shift', 'rotate', 'operation', 'expand', 'layers', 'asym'
            ])

            const what = a.in(part.what || 'outline', `${part_qname}.what`, ['outline', 'case', 'pcb'])
            const shift = a.numarr(part.shift || [0, 0, 0], `${part_qname}.shift`, 3)(units)
            const rotate = a.numarr(part.rotate || [0, 0, 0], `${part_qname}.rotate`, 3)(units)
            const operation = a.in(part.operation || 'add', `${part_qname}.operation`, ['add', 'subtract', 'intersect'])
            const asym = part.asym || 'both'; // 默认值为 'both'

            let solid = null

            if (what === 'outline' || what === 'pcb') {
                const extrude = a.sane(part.extrude || 1, `${part_qname}.extrude`, 'number')(units)
                const expand = a.sane(part.expand || 0, `${part_qname}.expand`, 'number')(units)
                const layers = part.layers || ['F.CrtYd'];
                const name_pattern = a.sane(part.name, `${part_qname}.name`, 'string')()
                let sourceDict;
                if (what === 'outline') {
                    if (mirrored) {
                        if (asym === 'source') {
                            continue;
                        } else {
                            sourceDict = mirror_outlines;
                        }
                    } else {
                        if (asym === 'clone') {
                            continue;
                        } else {
                            sourceDict = outlines;
                        }
                    }
                } else {
                    sourceDict = footprints;
                }

                const resolved = resolveFromDict(sourceDict, name_pattern)
                a.assert(resolved.length > 0,
                    `Field "${part_qname}.name" did not match any outline!`
                )

                const pieces = []

                for (let idx = 0; idx < resolved.length; idx++) {
                    const { key, value } = resolved[idx];

                    let outline;
                    if (what === 'pcb') {
                        if (value.config.side === "back") {
                            continue;
                        }
                        const shape_maker = await footprint_shape.parse(value.config, layers);
                        const point = new Point(value.point);
                        let [shape, bbox] = shape_maker();
                        if (Object.entries(shape.models).length == 0 && Object.entries(shape.paths).length == 0) {
                            continue;
                        }
                        outline = rectFromExtents(bbox, expand);
                        outline= point.position(outline);

                    } else {
                        // 根据是否有 yaml 属性来获取 outline
                        outline = value.raw? value.raw.models.export : value;
                    }

                    const piece = manifold.extrude(wasm, outline, extrude)
                    if (piece) pieces.push(piece)
                }

                if (pieces.length === 0) {
                    continue; // 跳过没有有效 outline 的部分
                }

                solid = pieces.length === 1 ? pieces[0] : wasm.Manifold.union(pieces)
                if (pieces.length > 1) pieces.forEach(p => p.delete())

            } else {
                a.in(part.name, `${part_qname}.name`, Object.keys(solids))
                solid = solids[part.name].translate([0, 0, 0])
            }

            // rotate about the part's own centre (in x and y), then shift it
            if (!solid.isEmpty()) {
                const {min, max} = solid.boundingBox()
                const cx = (min[0] + max[0]) / 2
                const cy = (min[1] + max[1]) / 2
                const centred = solid.translate([-cx, -cy, 0])
                const rotated = centred.rotate(rotate)
                const placed = rotated.translate([cx + shift[0], cy + shift[1], shift[2]])
                solid.delete(); centred.delete(); rotated.delete()
                solid = placed
            }

            if (result === null) {
                result = solid
            } else {
                const next = operation === 'subtract' ? result.subtract(solid)
                    : operation === 'intersect' ? result.intersect(solid)
                    : result.add(solid)
                result.delete(); solid.delete()
                result = next
            }
        }

        solids[case_name] = result || new wasm.Manifold()
        results[case_name] = manifold.toStl(solids[case_name])
    }
    } finally {
        Object.values(solids).forEach(s => s.delete())
    }

    return results;
}
