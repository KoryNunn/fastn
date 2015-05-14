var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js'),
    createFastn = require('./createFastn');

test('value items', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: [1,2,3,4],
            template: function(model){
                return fastn.binding('item');
            }
        });

    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        list.element.remove();
        list.destroy();
    });


});


test('bound items', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        });

    list.attach({
        items: [1,2,3,4]
    });
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        list.element.remove();
        list.destroy();

    });

});


test('bound items changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.set('items.1', 5);

        t.equal(document.body.innerText, '1534');

        list.element.remove();
        list.destroy();

    });

});

test('bound items add', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.set('items.4', 5);

        t.equal(document.body.innerText, '12345');

        list.element.remove();
        list.destroy();

    });

});

test('bound items remove', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.remove('items.3');

        t.equal(document.body.innerText, '123');

        list.element.remove();
        list.destroy();

    });

});

test('null items', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: null,
            template: function(model){
                return fastn.binding('item');
            }
        });

    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '');

        list.element.remove();
        list.destroy();
    });


});

test('null template', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: [1,2,3,4],
            template: function(model){}
        });

    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '');

        list.element.remove();
        list.destroy();
    });


});

test('array to undefined', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.remove('items');

        t.equal(document.body.innerText, '');

        list.element.remove();
        list.destroy();

    });

});