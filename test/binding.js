var test = require('tape'),
    createBinding = require('../binding'),
    Enti = require('enti');

test('simple binding initialisation', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    var model = new Enti();

    t.equal(binding(), undefined);

    model.set('foo', 'bar');

    t.equal(binding(), undefined);

    binding.attach(model);

    t.equal(binding(), 'bar');
});

test('simple binding default', function(t){
    t.plan(3);

    var binding = createBinding('foo', 'baz');

    var model = new Enti();

    t.equal(binding(), 'baz');

    model.set('foo', 'bar');

    t.equal(binding(), 'baz');

    binding.attach(model);

    t.equal(binding(), 'bar');
});

test('simple binding set', function(t){
    t.plan(3);

    var binding = createBinding('foo', 'baz');

    var model = new Enti();

    t.equal(binding(), 'baz');

    binding.attach(model);

    t.equal(binding(), undefined);

    binding('bazinga');

    t.equal(binding(), 'bazinga');
});

test('simple binding event', function(t){
    t.plan(2);

    var binding = createBinding('foo', 'baz');

    var model = new Enti();

    binding.attach(model);

    binding.once('change', function(value){
        t.equal(value, 'bar');
    });

    model.set('foo', 'bar');

    binding.once('change', function(value){
        t.equal(value, undefined);
    });

    binding.detach();

    model.set('foo', 'baz');
});

test('transform binding get', function(t){
    t.plan(1);

    var binding = createBinding('foo', 'baz', function(currentValue, newValue){
        if(arguments.length < 2){
            return currentValue + ' - majigger';
        }

        return newValue + ' - whatsits';
    });

    var model = new Enti();

    binding.attach(model);

    binding.on('change', function(value){
        t.equal(value, 'bar - majigger');
    });

    model.set('foo', 'bar');
});

test('transform binding set', function(t){
    t.plan(1);

    var binding = createBinding('foo', 'baz', function(currentValue, newValue){
        if(arguments.length < 2){
            return currentValue + ' - majigger';
        }

        return newValue.split(' - majigger')[0];
    });

    var model = new Enti();

    binding.attach(model);

    binding.on('change', function(value){
        t.equal(model.get('foo'), 'bar');
    });

    binding('bar - majigger');
});

test('no model', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    t.equal(binding(), undefined);

    binding.on('change', function(value){
        t.equal(value, 'bar');
    });

    binding('bar');

    t.equal(binding(), 'bar');
});