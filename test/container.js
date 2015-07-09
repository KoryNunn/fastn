var test = require('tape'),
    createFastn = require('./createFastn');

test('children are added', function(t){

    t.plan(2);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(parent.element.childNodes.length, 1);

    parent.element.remove();
    parent.destroy();

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

    document.body.appendChild(parent.element);

    t.equal(parent.element.childNodes.length, 1);

    parent.element.remove();
    parent.destroy();

});

test('flatten children', function(t){

    t.plan(1);

    var fastn = createFastn();

    var parent = fastn('div',
            [fastn('span'), fastn('span')],
            fastn('span')
        );

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(parent.element.childNodes.length, 3);

    parent.element.remove();
    parent.destroy();

});

test('insert many after current', function(t){

    t.plan(1);

    var fastn = createFastn();

    var parent = fastn('div',
            fastn('span', '1'),
            fastn('span', '2')
        );

    parent.insert(
        fastn('span', '3'),
        fastn('span', '4')
    );

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.textContent, '1234');

    parent.element.remove();
    parent.destroy();

});

test('insert returns container', function(t){

    t.plan(1);

    var fastn = createFastn();

    var container = fastn('div');

    t.equal(container.insert(fastn('span')), container);

    container.destroy();

});