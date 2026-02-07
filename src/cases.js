
const m = require('makerjs')
const a = require('./assert')
const o = require('./operation')
const Point = require('./point')
const footprint_shape = require('./kicad/footprint_shape')


function rectFromExtents(ext, expand = 0) {
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

exports.parse = async (config, outlines, previews, units) => {

    const cases_config = a.sane(config, 'cases', 'object')()

    const scripts = {}
    const cases = {}
    const results = {}

    const footprints = {}
    for (let [pcb, data] of Object.entries(previews)) {
        for (let [footprint, obj] of Object.entries(data['footprints'])) {
            footprints[`${pcb}.${footprint}`] = obj;
        }
    }

    const resolve = (case_name, resolved_scripts = new Set(), resolved_cases = new Set()) => {
        for (const o of Object.values(cases[case_name].outline_dependencies)) {
            resolved_scripts.add(o)
        }
        for (const c of Object.values(cases[case_name].case_dependencies)) {
            if (!resolved_cases.has(c)) {
                resolved_cases.add(c)
                resolve(c, resolved_scripts, resolved_cases)
            }
        }

        const result = []
        for (const o of resolved_scripts) {
            result.push(scripts[o] + '\n\n')
        }
        for (const c of resolved_cases) {
            result.push(cases[c].body)
        }
        result.push(cases[case_name].body)
        result.push(`
            function main() {
                return ${case_name}_case_fn();
            }
        `)

        return result.join('')
    }

    for (let [case_name, case_config] of Object.entries(cases_config)) {

        if (a.type(case_config)() === 'array') {
            case_config = { ...case_config }
        }

        const parts = a.sane(case_config, `cases.${case_name}`, 'object')()

        const body = []
        const case_dependencies = []
        const outline_dependencies = []

        let first = true

        for (let [part_name, part] of Object.entries(parts)) {

            if (a.type(part)() === 'string') {
                part = o.operation(part, {
                    outline: Object.keys(outlines),
                    case: Object.keys(cases)
                }, ['case', 'outline'])
            }

            const part_qname = `cases.${case_name}.${part_name}`
            const part_var = `${case_name}__part_${part_name}`

            a.unexpected(part, part_qname, [
                'what', 'name', 'extrude', 'shift', 'rotate', 'operation', 'expand', 'layers'
            ])

            const what = a.in(part.what || 'outline', `${part_qname}.what`, ['outline', 'case', 'pcb'])
            const shift = a.numarr(part.shift || [0, 0, 0], `${part_qname}.shift`, 3)(units)
            const rotate = a.numarr(part.rotate || [0, 0, 0], `${part_qname}.rotate`, 3)(units)
            const operation = a.in(part.operation || 'add', `${part_qname}.operation`, ['add', 'subtract', 'intersect'])

            let base_expr

            if (what === 'outline' || what === 'pcb') {
                const extrude = a.sane(part.extrude || 1, `${part_qname}.extrude`, 'number')(units)
                const expand = a.sane(part.expand || 0, `${name}.expand`, 'number')(units)
                const layers = part.layers || ['F.CrtYd'];
                const name_pattern = a.sane(part.name, `${part_qname}.name`, 'string')()
                const sourceDict = what === 'outline' ? outlines : footprints;
                const resolved = resolveFromDict(sourceDict, name_pattern)
                a.assert(resolved.length > 0,
                    `Field "${part_qname}.name" did not match any outline!`
                )

                const outline_vars = []

                for (let idx = 0; idx < resolved.length; idx++) {
                    const { key, value } = resolved[idx];
                    const safeKey = key.replace(/\./g, '_').replace(/-/g, '_') ;

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
                        outline = value.yaml.models.export;
                    }

                    const extruded_name =
                        `${safeKey}_extrude_` + ('' + extrude).replace(/\D/g, '_')

                    if (!scripts[extruded_name]) {
                        scripts[extruded_name] = m.exporter.toJscadScript(outline, {
                            functionName: `${extruded_name}_outline_fn`,
                            extrude,
                            indent: 4
                        })
                    }

                    outline_dependencies.push(extruded_name)

                    const ov = `${part_var}__outline_${safeKey}`
                    outline_vars.push(ov)

                    body.push(`
                        let ${ov} = ${extruded_name}_outline_fn();
                    `)
                }

                body.push(`
                    let ${part_var} = ${outline_vars[0]};
                `)

                for (let i = 1; i < outline_vars.length; i++) {
                    body.push(`
                        ${part_var} = ${part_var}.union(${outline_vars[i]});
                    `)
                }

                base_expr = part_var

            } else {
                a.in(part.name, `${part_qname}.name`, Object.keys(cases))
                case_dependencies.push(part.name)
                base_expr = `${part.name}_case_fn()`

                body.push(`
                    let ${part_var} = ${base_expr};
                `)
            }

            let op = 'union'
            if (operation === 'subtract') op = 'subtract'
            else if (operation === 'intersect') op = 'intersect'

            let op_statement = `let result = ${part_var};`
            if (!first) {
                op_statement = `result = result.${op}(${part_var});`
            }
            first = false

            body.push(`
                let ${part_var}_bounds = ${part_var}.getBounds();
                let ${part_var}_x =
                    ${part_var}_bounds[0].x +
                    (${part_var}_bounds[1].x - ${part_var}_bounds[0].x) / 2;
                let ${part_var}_y =
                    ${part_var}_bounds[0].y +
                    (${part_var}_bounds[1].y - ${part_var}_bounds[0].y) / 2;

                ${part_var} = translate(
                    [-${part_var}_x, -${part_var}_y, 0],
                    ${part_var}
                );
                ${part_var} = rotate(${JSON.stringify(rotate)}, ${part_var});
                ${part_var} = translate(
                    [${part_var}_x, ${part_var}_y, 0],
                    ${part_var}
                );

                ${part_var} = translate(${JSON.stringify(shift)}, ${part_var});
                ${op_statement}
            `)
        }

        cases[case_name] = {
            body: `
                function ${case_name}_case_fn() {
                    ${body.join('')}
                    return result;
                }
            `,
            case_dependencies,
            outline_dependencies
        }

        results[case_name] = resolve(case_name)
    }

    return results
}
