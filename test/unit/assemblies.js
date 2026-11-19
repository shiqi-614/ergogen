const assemblies = require('../../src/assemblies')

describe('Assemblies', function() {

    // a pcb with one module, at (10, 20) turned 30°
    const pcbs = {board: {modules: {screen: {point: {x: 10, y: 20, r: 30}}}}}
    const parts = part => assemblies.parse({a: {pcb: {name: 'board', z: 0}, parts: [part]}}, {}, pcbs, {})

    it('places a part at a module of the pcb', function() {
        const [placed] = parts({model: 'm/screen.glb', at_module: 'screen', z: 5}).a.parts
        placed.should.deep.equal({name: 'screen.glb', model: 'm/screen.glb', x: 10, y: 20, r: 30, z: 5})
        // or at the board's origin
        parts({model: 'm.glb'}).a.parts[0].should.include({x: 0, y: 0, r: 0, z: 0})
    })

    it('still takes module, its old name, but not both', function() {
        parts({model: 'm.glb', module: 'screen'}).a.parts[0].should.include({x: 10, y: 20})
        ;(() => parts({model: 'm.glb', module: 'screen', at_module: 'screen'})).should.throw('both at_module and module')
        ;(() => parts({model: 'm.glb', at_module: 'nope'})).should.throw('at_module')
    })
})
