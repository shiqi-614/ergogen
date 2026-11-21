const ergogen = require('../../src/ergogen')

// the x and z extent of a binary STL
const extent = stl => {
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < view.getUint32(80, true); i++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
        const v = view.getFloat32(84 + 50 * i + 12 + 12 * k + 4 * a, true)
        lo[a] = Math.min(lo[a], v)
        hi[a] = Math.max(hi[a], v)
    }
    return {lo, hi}
}

describe('Cases, mirrored', function() {

    // one key, mirrored 50 mm on, and a square under each; the right case moves its square 3 mm right and 1 mm up
    const config = shift => ({
        points: {zones: {matrix: {}}, mirror: {ref: 'matrix', distance: 50}},
        outlines: {square: [{what: 'rectangle', where: true, size: [5, 5]}]},
        cases: {
            right: [{name: 'square', extrude: 2, shift}],
            left: {mirror: {from: 'right'}},
        },
    })

    it('shifts the mirrored case the other way in x', async function() {
        const moved = (await ergogen.process(config([3, 0, 1]), true)).cases
        const still = (await ergogen.process(config([0, 0, 0]), true)).cases
        const [right, right0] = [extent(moved.right.stl), extent(still.right.stl)]
        const [left, left0] = [extent(moved.left.stl), extent(still.left.stl)]
        ;(right.lo[0] - right0.lo[0]).should.be.closeTo(3, 1e-4)
        ;(left.lo[0] - left0.lo[0]).should.be.closeTo(-3, 1e-4)
        // y and z do not mirror
        left.lo[2].should.be.closeTo(1, 1e-4)
        right.lo[2].should.be.closeTo(1, 1e-4)
        moved.left.parts[0].shift.should.deep.equal([-3, 0, 1])
        moved.right.parts[0].shift.should.deep.equal([3, 0, 1])
    })

    it('turns the mirrored case the other way about z', async function() {
        const cases = (await ergogen.process({...config([0, 0, 0]), cases: {
            right: [{name: 'square', extrude: 2, rotate: [0, 0, 30]}],
            left: {mirror: {from: 'right'}},
        }}, true)).cases
        cases.right.parts[0].rotate.should.deep.equal([0, 0, 30])
        cases.left.parts[0].rotate.should.deep.equal([0, 0, -30])
    })
})
