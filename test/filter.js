var test = require('tape'),
    createBinding = require('../binding'),
    Enti = require('enti');

test('single key filter', function(t){
    t.plan(2);

    var binding = createBinding('foo|bar');

    var data = {
            foo:{
                bar: 1,
                baz: 2
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value, target){
        t.equal(value, data.foo);
        t.equal(target, data.foo.bar);
    });

    model.set('majigger', 10);
    fooModel.set('bar', 10);
    fooModel.set('baz', 10);
});

test('wildcard', function(t){
    t.plan(2);

    var binding = createBinding('foo|*');

    var data = {
            foo:[
                {bar:1},
                {bar:1},
                {bar:1},
                {bar:1}
            ]
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value, target){
        t.equal(value, data.foo);
        t.equal(target, data.foo);
    });

    model.set('majigger', 10);

    var lastFoo = {baz:2},
        lastFooModel = new Enti(lastFoo);

    fooModel.push(lastFoo);

    lastFooModel.set('bar', 10);

    lastFooModel.set('bin', 20);
});

test('wildcard 2', function(t){
    t.plan(2);

    var binding = createBinding('foo|*');

    var data = {
            foo:{
                a:1
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value, target){
        t.equal(value, data.foo);
        t.equal(target, data.foo);
    });

    model.set('majigger', 10);

    fooModel.set('b',2);
    fooModel.set('a',2);
});

test('wildcard on array', function(t){
    t.plan(2);

    var binding = createBinding('foo|*');

    var data = {
            foo:[]
        },
        model = new Enti(data);

    binding.attach(data).on('change', function(value, target){
        t.equal(value, data.foo);
        t.equal(target, data.foo);
    });

    model.push('foo', {});
});

test('wildcard.key', function(t){
    t.plan(2);

    var binding = createBinding('foo|*.bar');

    var data = {
            foo:[
                {bar:1},
                {bar:1},
                {bar:1},
                {bar:1}
            ]
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value, target){
        t.equal(value, data.foo);
        t.equal(target, data.foo[4].bar);
    });

    model.set('majigger', 10);

    var lastFoo = {baz:2},
        lastFooModel = new Enti(lastFoo);

    fooModel.push(lastFoo);

    lastFooModel.set('bar', 10);
    lastFooModel.set('bin', 20);
});

test('double wildcard', function(t){
    t.plan(3);

    var binding = createBinding('foo|**');

    var data = {
            foo:[
                {bar:1},
                {bar:1},
                {bar:1},
                {bar:1}
            ]
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value){
        t.equal(value, data.foo);
    });

    model.set('majigger', 10);

    var lastFoo = {baz:2},
        lastFooModel = new Enti(lastFoo);

    fooModel.push(lastFoo);

    lastFooModel.set('bar', 10);
    lastFooModel.set('bin', 20);
});

test('double wildcard replace child', function(t){
    t.plan(4);

    var binding = createBinding('foo|**');

    var data = {
            foo:{
                bar:{
                    baz: 1
                }
            }
        },
        originalBar = data.foo.bar,
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    binding.attach(data).on('change', function(value){
        t.equal(value, data.foo);
        t.notEqual(value.bar, originalBar);
    });

    var newBar = {
            baz: 2
        },
        barModel = new Enti(newBar);

    fooModel.set('bar', newBar);

    barModel.set('baz', 3);
});


test('multiple filtered bindings', function(t){
    t.plan(2);

    var data = {
            foo:[]
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo);

    createBinding('.|**').attach(data).once('change', function(value){
        t.pass('data changed');
    });

    createBinding('foo|*').attach(data).once('change', function(value){
        t.pass('foo changed');
    });

    model.push('foo', {a:1});
});