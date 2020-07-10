var test = require('tape'),
    createBinding = require('../index')({}).binding,
    Enti = require('enti');

test('invalid path', function(t){
    t.plan(5);

    t.throws(function(){
        createBinding(true);
    });
    t.throws(function(){
        createBinding({});
    });
    t.throws(function(){
        createBinding(function(){});
    });
    t.throws(function(){
        createBinding(null);
    });
    t.throws(function(){
        createBinding(undefined);
    });
});

test('simple binding initialisation', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    var model = {},
        enti = new Enti(model);

    t.equal(binding(), undefined);

    enti.set('foo', 'bar');

    t.equal(binding(), undefined);

    binding.attach(model);

    t.equal(binding(), 'bar');
});

test('initial attach doesnt cause emit', function(t){
    t.plan(1);

    var binding = createBinding('foo');

    binding.on('change', () => t.pass('Recieved change'));

    binding.attach();
    binding.attach({});
});

test('simple binding set', function(t){
    t.plan(2);

    var binding = createBinding('foo');

    binding.attach({});

    t.equal(binding(), undefined);

    binding('bazinga');

    t.equal(binding(), 'bazinga');
});

test('simple binding event', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    var model = {},
        enti = new Enti(model);

    binding.attach(model);

    binding.once('change', function(value){
        t.equal(value, 'bar');
        t.equal(binding(), 'bar');
    });

    enti.set('foo', 'bar');

    binding.once('detach', function(){
        t.equal(binding(), undefined);
    });

    binding.detach();

    enti.set('foo', 'baz');
});

test('no model', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    t.equal(binding(), undefined);

    binding.on('change', function(value){
        t.equal(value, 'bar');
        console.log(value)
    });

    binding('bar');
    console.log(binding())

    t.equal(binding(), 'bar');
});

test('drill get', function(t){
    t.plan(2);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');

    binding.attach(data);

    t.equal(binding(), 123);

    model.set('foo', {
        bar: 456
    });

    t.equal(binding(), 456);
});

test('drill change', function(t){
    t.plan(1);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');

    binding.attach(data);

    binding.on('change', function(){
        t.pass('target changed');
    });

    model.set('foo', {
        bar: 456
    });
});

test('drill attach', function(t){
    t.plan(2);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');


    binding.once('change', function(value){
        t.equal(value, 123);
    });

    binding.attach(data);

    binding.once('change', function(value){
        t.equal(value, 456);
    });

    model.set('foo', {
        bar: 456
    });
});

test('drill set', function(t){
    t.plan(1);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo),
        binding = createBinding('foo.bar');


    fooModel.on('bar', function(value){
        t.equal(value, 456);
    });

    binding.attach(data);

    binding(456);
});

test('drill multiple', function(t){
    t.plan(3);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo),
        binding = createBinding('foo.bar');


    fooModel.once('bar', function(value){
        t.equal(value, 456);
    });

    binding.attach(data);

    binding(456);

    binding.once('change', function(value){
        t.equal(value, 789);
    });

    fooModel.set('bar', 789);

    binding.once('change', function(value){
        t.equal(value, 987);
    });

    binding(987);
});

test('fuse', function(t){
    t.plan(2);

    var data = {
            foo: 1,
            bar: 2,
            baz: 3
        },
        model = new Enti(data),
        binding = createBinding('foo', 'bar', 'baz', function(foo, bar, baz){
            return foo + bar + baz;
        });

    binding.attach(data);

    binding(2);

    binding.once('change', function(value){
        t.equal(value, 7);
    });

    model.set('bar', 3);

    binding.once('change', function(value){
        t.equal(value, 3);
    });

    binding(3);
});

test('fuse destroy inner used', function(t){
    t.plan(4);

    var data1 = {
            foo: 1
        },
        data2 = {
            bar: 1
        },
        innerBinding = createBinding('foo').attach(data1),
        binding = createBinding(innerBinding, 'bar', function(foo, bar){
            return foo + bar;
        });

    // Add a listener to the inner binding
    // This should prevent destruction.
    innerBinding.on('change', function(){
        t.pass('Inner binding changed');
    });

    binding.attach(data2);

    binding.once('change', function(value){
        t.equal(value, 3);
    });

    Enti.set(data1, 'foo', 2);

    binding.once('change', function(value){
        t.fail('No event should occur since the binding is detached');
    });

    binding.destroy();

    t.notOk(innerBinding.destroyed(), 'inner binding should not be destroyed');

    Enti.set(data1, 'foo', 3);
});

test('fuse set', function(t){
    t.plan(1);

    var data = {
        a: 1,
        b: 2,
        c: 3
    };

    var binding = createBinding('a', 'b', 'c', function(a, b, c){
        return a + b + c;
    }, x => x).attach(data);

    binding(2);

    t.equal(data.a, 2);
});

test('filter', function(t){
    t.plan(2);

    var data = {},
        model = new Enti(data),
        binding = createBinding('foo|*');

    binding.attach(data);

    binding.on('change', function(value){
        t.pass();
    });

    model.set('foo', []);

    Enti.set(data.foo, 0, {});
});

test('things', function(t){
    t.plan(2);

    var data = {},
        model = new Enti(data),
        binding = createBinding('foo|*.bar');

    binding.attach(data);

    binding.on('change', function(value){
        t.pass();
    });

    model.set('foo', [{}]);

    Enti.set(data.foo[0], 'bar', true);
});

test('clone', function(t){
    t.plan(4);

    var data1 = {foo:1},
        data2 = {foo:2},
        binding = createBinding('foo');

    binding.attach(data1);

    t.equal(binding(), 1, 'Original binding has correct data');

    var newBinding = binding.clone();

    t.equal(newBinding(), undefined, 'New binding has no data');

    newBinding.attach(data2);

    t.equal(newBinding(), 2, 'New binding has new data');

    t.equal(binding(), 1, 'Original binding still has original data');
});

test('clone with attachment', function(t){
    t.plan(2);

    var data1 = {foo:1},
        binding = createBinding('foo');

    binding.attach(data1);

    t.equal(binding(), 1, 'Original binding has correct data');

    var newBinding = binding.clone(true);

    t.equal(newBinding(), 1, 'New binding has same data');
});

test('clone fuse', function(t){
    t.plan(2);

    var data1 = {foo:1, bar:2},
        binding = createBinding('foo', 'bar', function(foo, bar){
            return foo + bar;
        });

    binding.attach(data1);

    t.equal(binding(), 3, 'Original binding has correct data');

    var newBinding = binding.clone(true);

    t.equal(newBinding(), 3, 'New binding has same data');
});

test('binding as a bindings target', function(t){
    t.plan(1);

    var binding1 = createBinding('foo'),
        binding2 = createBinding('bar');

    binding1(binding2);

    t.equal(binding1(), binding2, 'binding1 value correctly set to binding2');
});

test('binding as own target', function(t){
    t.plan(1);

    var binding = createBinding('foo');

    binding(binding);

    t.equal(binding(), binding, 'binding value correctly set to self');
});

test('value-only binding', function(t){
    t.plan(1);

    var binding = createBinding();

    binding('foo');

    t.equal(binding(), 'foo', 'binding value correctly set to foo');
});

test('value-only binding cannot be attached', function(t){
    t.plan(1);

    var binding = createBinding();

    binding('foo');

    binding.attach({
        value: 'bar'
    });

    t.equal(binding(), 'foo', 'binding value correctly set to foo');
});

test('destroy', function(t){
    t.plan(1);

    var binding = createBinding().on('change', function(){
        t.pass('binding changed');
    });

    binding('foo');

    binding.destroy();

    binding('bar');
});

test('soft destroy', function(t){
    t.plan(2);

    var binding = createBinding().on('change', function(){
        t.pass('binding changed');
    });

    binding('foo');

    binding.destroy(true);

    binding('bar');
});

test('soft destroy 2', function(t){
    t.plan(1);

    function changeHandler(){
        t.pass('binding changed');
    }

    var binding = createBinding().on('change', changeHandler);

    binding('foo');

    binding.removeListener('change', changeHandler);
    binding.destroy(true);

    binding('bar');
});

test('model attach', function(t){
    t.plan(2);

    var model = new Enti();

    var binding = createBinding('a');

    binding.attach(model);

    t.equal(binding(), undefined);

    model.attach({
        a: 2
    });

    t.equal(binding(), 2);

});

test('from', function(t){
    t.plan(3);

    var binding = createBinding(),
        value = 5;

    binding(10);

    var from1 = createBinding.from(binding);
    var from2 = createBinding.from(value);

    t.equal(from1(), 10);
    t.equal(from1, binding);
    t.equal(from2(), 5);

});

test('binding as path', function(t){
    t.plan(1);

    var binding1 = createBinding(),
        binding2 = createBinding(binding1);

    binding1(10);

    t.equal(binding2(), 10);

});

test('detach memory usage', function(t){
    t.plan(1);

    var data = {
        foo: null
    };

    var runs = 0;

    function run(){
        var bindings = [];
        for(var i = 0; i < 1000; i++){
            bindings.push(createBinding('foo').attach(data));
        }

        Enti.set(data, 'foo', runs);

        bindings.map(function(binding){
            binding.detach();
        });

        setTimeout(function(){
            if(runs++ < 10){
                run();
            } else {
                t.pass();
            }
        });
    }

    run();
});