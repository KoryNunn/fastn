var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('children are added', function(t){

    t.plan(2);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(parent.element.childNodes.length, 1);

        parent.element.remove();
        parent.destroy();
    });

});

test('undefined or null children are ignored', function(t){

    t.plan(1);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span'),
            undefined,
            null
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(parent.element.childNodes.length, 1);

        parent.element.remove();
        parent.destroy();
    });

});

test('flatten children', function(t){

    t.plan(1);

    var fastn = createFastn();

    var parent = fastn('div',
            [fastn('span'), fastn('span')],
            fastn('span')
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(parent.element.childNodes.length, 3);

        parent.element.remove();
        parent.destroy();
    });

});