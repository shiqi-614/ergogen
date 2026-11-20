const ergogen = require('../../src/ergogen')

describe('Internals', function() {

    it('injection', function() {
        // this fork's footprints are KiCad files: any injection says so
        ergogen.inject.bind(this, 'nonexistent', 'name', 'value').should.throw('is not supported')
    })
})



