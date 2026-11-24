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

    it('turns a part on its place by rotate', function() {
        parts({model: 'm.glb', at_module: 'screen', rotate: 180}).a.parts[0].should.include({x: 10, y: 20, r: 210})
    })

    it('still takes module, its old name, but not both', function() {
        parts({model: 'm.glb', module: 'screen'}).a.parts[0].should.include({x: 10, y: 20})
        ;(() => parts({model: 'm.glb', module: 'screen', at_module: 'screen'})).should.throw('both at_module and module')
        ;(() => parts({model: 'm.glb', at_module: 'nope'})).should.throw('at_module')
    })

    it('places a part where an anchor says, a point of the layout shifted and turned', function() {
        const Point = require('../../src/point')
        const points = {key: new Point(100, 50, 90)}
        const where = w => assemblies.parse({a: {parts: [{model: 'm.glb', where: w, rotate: 10}]}}, {}, {}, {}, undefined, points).a.parts[0]
        // shifted in the point's own frame (turned 90°), then the part's rotate on top
        const placed = where({ref: 'key', shift: [5, 0], rotate: -90})
        placed.x.should.be.closeTo(100, 1e-9)
        placed.y.should.be.closeTo(55, 1e-9)
        placed.r.should.equal(10)
        ;(() => parts({model: 'm.glb', at_module: 'screen', where: {ref: 'key'}})).should.throw('both where and at_module')
        ;(() => where({ref: 'nope'})).should.throw('Unknown point reference')
    })
})
