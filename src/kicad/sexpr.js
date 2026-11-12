// Minimal KiCad s-expression reader/writer, lossless enough to re-emit footprints.
// A list is an array, a bare atom (symbol or number) is a string and a quoted string is {q: text}.

const TOKEN = /\s*(?:(\()|(\))|"((?:\\.|[^"\\])*)"|([^\s()"]+))/y

const unescape = s => s.replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c)
const escape = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

const parse = exports.parse = (text) => {
    const root = []
    const stack = [root]
    TOKEN.lastIndex = 0
    let m
    while ((m = TOKEN.exec(text))) {
        if (m[1]) {
            const list = []
            stack[stack.length - 1].push(list)
            stack.push(list)
        } else if (m[2]) {
            if (stack.length === 1) throw new Error('Unbalanced ")" in s-expression')
            stack.pop()
        } else if (m[3] !== undefined) {
            stack[stack.length - 1].push({q: unescape(m[3])})
        } else {
            stack[stack.length - 1].push(m[4])
        }
    }
    if (stack.length !== 1) throw new Error('Unterminated s-expression')
    return root
}

const isList = exports.isList = n => Array.isArray(n)
const head = exports.head = n => isList(n) ? n[0] : undefined
// value of an atom or a quoted string
const str = exports.str = n => (n && typeof n === 'object' && !isList(n)) ? n.q : n
const children = exports.children = (n, name) => n.filter(c => head(c) === name)
const child = exports.child = (n, name) => n.find(c => head(c) === name)

const atom = n => typeof n === 'string' ? n : `"${escape(n.q)}"`

// lists nested less than `breakDepth` levels put each child after the leading atoms on its own line
// (order is kept: KiCad's parser is positional in places)
const serialize = exports.serialize = (n, indent = '', breakDepth = 0) => {
    if (!isList(n)) return atom(n)
    if (breakDepth <= 0 || !n.some(isList)) {
        return '(' + n.map(c => serialize(c)).join(' ') + ')'
    }
    const inner = indent + '\t'
    let first = 0
    while (first < n.length && !isList(n[first])) first++
    const lines = n.slice(first).map(c => inner + serialize(c, inner, breakDepth - 1))
    return '(' + n.slice(0, first).map(atom).join(' ') + '\n' + lines.join('\n') + '\n' + indent + ')'
}
