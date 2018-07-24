var test = require('tape'),
    Enti = require('enti'),
    createFastn = require('./createFastn');

test('value text', function(t){

    t.plan(1);

    var fastn = createFastn();

    var text = fastn('text', {text: 'foo'});

    text.render();

    document.body.appendChild(text.element);

    t.equal(document.body.textContent, 'foo');

    text.element.remove();
    text.destroy();


});

test('bound text', function(t){

    t.plan(1);

    var fastn = createFastn();

    var text = fastn('text', {text: fastn.binding('value')});

    text.attach({
        value: 'foo'
    });
    text.render();

    document.body.appendChild(text.element);

    t.equal(document.body.textContent, 'foo');

    text.element.remove();
    text.destroy();


});

test('bound text changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var text = fastn('text', {text: fastn.binding('value')}),
        model = new Enti({
            value: 'foo'
        });

    text.attach(model);
    text.render();

    document.body.appendChild(text.element);

    t.equal(document.body.textContent, 'foo');

    model.set('value', 'bar');

    t.equal(document.body.textContent, 'bar');

    text.element.remove();
    text.destroy();

});

test('auto binding text', function(t){

    t.plan(2);

    var fastn = createFastn();

    var parent = fastn('span', fastn.binding('value')),
        model = new Enti({
            value: 'foo'
        });

    parent.attach(model);
    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.textContent, 'foo');

    model.set('value', 'bar');

    t.equal(document.body.textContent, 'bar');

    parent.element.remove();
    parent.destroy();

});

test('undefined text', function(t){
    t.plan(1);

    var fastn = createFastn();

    var text = fastn('text', {text: undefined});

    text.render();

    document.body.appendChild(text.element);

    t.equal(document.body.textContent, '');

    text.element.remove();
    text.destroy();
});


test('auto text Date', function(t){

    t.plan(1);

    var fastn = createFastn();

    var date = new Date(),
        parent = fastn('span', date);

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.textContent, date.toString());

    parent.element.remove();
    parent.destroy();

});


test('clone text', function(t){

    t.plan(2);

    var fastn = createFastn();

    var parent = fastn('span', 'text');

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.textContent, 'text');

    parent.element.remove();

    var newParent = parent.clone();
    parent.destroy();

    newParent.render();

    document.body.appendChild(newParent.element);

    t.equal(document.body.textContent, 'text');

    newParent.element.remove();

    newParent.destroy();

});


test('clone text binding', function(t){

    t.plan(2);

    var data = {
        foo: 'bar'
    };

    var fastn = createFastn();

    var binding = fastn.binding('foo').attach(data);

    var parent = fastn('span', binding);

    parent.render();

    document.body.appendChild(parent.element);

    t.equal(document.body.textContent, 'bar');

    parent.element.remove();

    var newParent = parent.clone();
    parent.destroy();

    newParent.render();

    document.body.appendChild(newParent.element);

    t.equal(document.body.textContent, 'bar');

    newParent.element.remove();

    newParent.destroy();

});