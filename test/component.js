var test = require('tape'),
    Enti = require('enti'),
    createFastn = require('./createFastn');

test('binding', function(t){

    t.plan(2);

    var fastn = createFastn();

    var data = {
            foo:{
                bar:1
            }
        },
        component = fastn('div');

    component.attach(data);

    t.equal(component.scope().get('.'), data);

    component.binding('foo');

    t.equal(component.scope().get('.'), data.foo);
});

test('pre-created component', function(t){

    t.plan(3);

    var fastn = createFastn({
        custom: function(type, fastn, settings, children){
            t.pass('Used custom constructor');
            return fastn('div', settings, children);
        }
    });

    var data = {
            foo:{
                bar:1
            }
        },
        component = fastn('custom');

    component.attach(data);

    t.equal(component.scope().get('.'), data);

    component.binding('foo');

    t.equal(component.scope().get('.'), data.foo);
});