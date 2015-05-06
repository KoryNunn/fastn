var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('value data', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: {foo:'bar'},
            template: function(model){
                return fastn.binding('item.foo');
            }
        });

    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        template.element.remove();
        template.destroy();
    });


});


test('bound data', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: fastn.binding('data|*'),
            template: function(model){
                return fastn.binding('item.foo');
            }
        });

    template.attach({
        data: {
            foo: 'bar'
        }
    });
    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        template.element.remove();
        template.destroy();

    });

});


test('bound data changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: fastn.binding('data|*'),
            template: function(model){
                return fastn.binding('item.foo');
            }
        }),
        model = new Enti({
            data: {
                foo: 'bar'
            }
        });

    template.attach(model);
    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        model.set('data.foo', 'baz');

        t.equal(document.body.innerText, 'baz');

        template.element.remove();
        template.destroy();

    });

});

test('null data', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: null,
            template: function(model){}
        });

    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, '');

        template.element.remove();
        template.destroy();

    });

});

test('undefined template', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: null,
            template: function(model){}
        });

    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, '');

        template.element.remove();
        template.destroy();

    });

});