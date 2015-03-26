var test = require('tape'),
    createBinding = require('../binding'),
    createProperty = require('../property'),
    Enti = require('enti');

test('simple property initialisation', function(t){
    t.plan(3);

    var property = createProperty();

    t.equal(property(), undefined);

    property('bar');

    t.equal(property(), 'bar');

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    property('foo');
});

test('bound property', function(t){
    t.plan(5);

    var property = createProperty();

    var binding = createBinding('foo');

    t.equal(property(), undefined);

    property('bar');

    t.equal(property(), 'bar');

    property.binding(binding);

    t.equal(property(), 'bar');

    binding('baz');

    t.equal(property(), 'baz');

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    binding('foo');
});

test('bound property with model', function(t){
    t.plan(1);

    var data = {},
        model = new Enti(data);

    var property = createProperty();

    var binding = createBinding('foo');

    binding.attach(model);

    property.binding(binding);

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    model.set('foo', 'foo');
});

test('bound property with model and drill', function(t){
    t.plan(1);

    var data = {},
        model = new Enti(data);

    var property = createProperty();

    var binding = createBinding('foo.bar');

    binding.attach(model);

    property.binding(binding);

    property.on('change', function(value){
        t.equal(value, 123);
    });

    model.set('foo', {bar: 123});
});