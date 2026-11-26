const ergogen = require('../../src/ergogen')

// A run the way the CLI and the server make it: not in debug mode, not tolerant. One key, no mirror; a "_" outline
// that a case cuts by, and a case and an assembly that use a unit.
describe('Cases, in a run that is neither debug nor tolerant', function() {

    const config = {
        units: {wall: 2},
        points: {zones: {matrix: {}}},
        outlines: {
            _board: [{what: 'rectangle', where: true, size: [20, 20]}],
            plate: [{what: 'rectangle', where: true, size: [10, 10]}],
        },
        cases: {
            base: [{name: '_board', extrude: 'wall + 1'}],
            _spacer: [{name: 'plate', extrude: 'wall'}],
        },
        assemblies: {stack: {stack: ['base', '_spacer']}},
    }

    it('makes the cases of a config with no mirror, by a "_" outline and with units', async function() {
        const results = await ergogen.process(config, false)
        Object.keys(results.cases).should.deep.equal(['base'])
        results.cases.base.stl.length.should.be.above(84)
        results.assemblies.should.have.property('stack')
    })

    it('still leaves the "_" parts and the units out of what it returns, but in debug mode', async function() {
        const plain = await ergogen.process(config, false)
        plain.outlines.should.not.have.property('_board')
        plain.should.not.have.property('units')
        const debug = await ergogen.process(config, true)
        debug.outlines.should.have.property('_board')
        Object.keys(debug.cases).should.have.members(['base', '_spacer'])
        debug.units.wall.should.equal(2)
    })
})
