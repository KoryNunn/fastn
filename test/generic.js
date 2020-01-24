var test = require('tape'),
    crel = require('crel'),
    createFastn = require('./createFastn');

test('div', function(t){

    t.plan(2);

    var fastn = createFastn();

    var div = fastn('div');

    div.render();

    document.body.appendChild(div.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'DIV');

    div.element.remove();
    div.destroy();

});

test('special properties - input value - undefined', function(t){

    t.plan(3);

    var fastn = createFastn();

    var input = fastn('input', {value: undefined});

    input.render();

    document.body.appendChild(input.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'INPUT');
    t.equal(document.body.childNodes[0].value, '');

    input.element.remove();
    input.destroy();

});

test('special properties - input value - dates', function(t){

    t.plan(8);

    var fastn = createFastn();

    var input = fastn('input', {
        type: 'date',
        value: new Date('2015/01/01'),
        onchange: 'value:value',
        onclick: 'value:value' // so I can trigger events..
    });

    input.render();

    document.body.appendChild(input.element);

    t.equal(document.body.childNodes.length, 1, 'node added');
    t.equal(document.body.childNodes[0].tagName, 'INPUT', 'correct tagName');
    t.equal(document.body.childNodes[0].value, '2015-01-01', 'correct initial input.value');
    t.deepEqual(input.value(), new Date('2015/01/01'), 'correct initial property()');

    input.value(new Date('2015/02/02'));

    t.equal(document.body.childNodes[0].value, '2015-02-02', 'correctly set new input.value');
    t.deepEqual(input.value(), new Date('2015/02/02'), 'correctly set new property()');

    input.element.value = '2016-02-02';
    input.element.click();

    t.equal(document.body.childNodes[0].value, '2016-02-02', 'correctly set new input.value 2');
    t.deepEqual(input.value(), new Date('2016/02/02'), 'correctly set new property() 2');

    input.element.remove();
    input.destroy();

});

test('special properties - disabled', function(t){

    t.plan(4);

    var fastn = createFastn();

    var button = fastn('button', {
        type: 'button',
        disabled: false
    });

    button.render();

    document.body.appendChild(button.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'BUTTON');
    t.equal(document.body.childNodes[0].getAttribute('disabled'), null);

    button.disabled(true);

    t.equal(document.body.childNodes[0].getAttribute('disabled'), 'disabled');

    button.element.remove();
    button.destroy();

});

test('special properties - textContent', function(t){

    t.plan(4);

    var fastn = createFastn();

    var label = fastn('label', {
        textContent: 'foo'
    });

    label.render();

    document.body.appendChild(label.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'LABEL');
    t.equal(document.body.childNodes[0].textContent, 'foo');

    label.textContent(null);

    t.equal(document.body.childNodes[0].textContent, '');

    label.element.remove();
    label.destroy();

});

test('preexisting element', function(t){

    t.plan(4);

    var fastn = createFastn();

    var element = crel('label'),
        label = fastn(element, {
            textContent: 'foo'
        });

    label.render();

    document.body.appendChild(label.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'LABEL');
    t.equal(document.body.childNodes[0].textContent, 'foo');

    label.textContent(null);

    t.equal(document.body.childNodes[0].textContent, '');

    label.element.remove();
    label.destroy();

});

test('DOM children', function(t){

    t.plan(3);

    var fastn = createFastn();

    var label = fastn('div',
            crel('h1', 'DOM Child')
        );

    label.render();

    document.body.appendChild(label.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'DIV');
    t.equal(document.body.childNodes[0].textContent, 'DOM Child');

    label.element.remove();
    label.destroy();

});

test('same scope', function(t){

    t.plan(4);

    var fastn = createFastn();

    var thing = fastn('label', {}, fastn.binding('x'));

    thing.render();
    document.body.appendChild(thing.element);

    t.equal(document.body.childNodes.length, 1);
    t.equal(document.body.childNodes[0].tagName, 'LABEL');

    thing.attach({
        x: 10
    });

    t.equal(document.body.childNodes[0].textContent, '10');

    thing.attach({
        x: 20
    });

    t.equal(document.body.childNodes[0].textContent, '20');

    thing.element.remove();
    thing.destroy();

});

test('default type', function(t){

    t.plan(1);

    var fastn = createFastn();

    var thing = fastn('_generic').render();

    t.equal(thing.element.tagName, 'DIV');

    thing.destroy();

});

test('override type', function(t){

    t.plan(1);

    var fastn = createFastn();

    var thing = fastn('span:div:section').render();

    t.equal(thing.element.tagName, 'SECTION');

    thing.destroy();

});

test('custom fancyProps', function(t){

    t.plan(3);

    var fastn = createFastn({
        custom: function(fastn, component, type, settings, children){
            // Map all settings to data-{name} as an example
            component.extend('_generic', settings, children);
            component._fancyProps = function(attribute){
                if(attribute === 'ignore'){
                    return;
                }

                return function(component, element, value){
                    if(arguments.length < 3){
                        return element.getAttribute('data-' + attribute);
                    }

                    return element.setAttribute('data-' + attribute, value);
                }
            }
            return component;
        }
    });

    var thing = fastn('div:custom', { property: 'foo', ignore: 'bar' }).render();

    t.equal(thing.element.tagName, 'DIV');
    t.equal(thing.element.getAttribute('data-property'), 'foo');
    t.equal(thing.element.getAttribute('ignore'), 'bar');

    thing.destroy();

});

test('event handling - auto handler', function(t){

    t.plan(1);

    var fastn = createFastn();

    var input = fastn('input', {
        value: 'a',
        onclick: 'value:value',
    });

    input.render();

    document.body.appendChild(input.element);

    input.element.value = 'b';
    input.element.click();

    t.equal(input.value(), 'b')

    input.element.remove();
    input.destroy();

});

test('event handling - function handler', function(t){

    t.plan(1);

    var fastn = createFastn();

    var button = fastn('button', {
        onclick: (event, scope) => t.pass('recieved click')
    });

    button.render();

    document.body.appendChild(button.element);

    button.element.click();

    button.element.remove();
    button.destroy();

});

test('event handling - function handler - this', function(t){

    t.plan(1);

    var fastn = createFastn();

    var input = fastn('input', {
        value: 'a',
        onclick: function(event, scope){ this.value('b') }
    });

    input.render();

    document.body.appendChild(input.element);

    input.element.value = 'b';
    input.element.click();

    t.equal(input.value(), 'b')

    input.element.remove();
    input.destroy();

});

test('event handling - component handler', function(t){

    t.plan(1);

    var fastn = createFastn();

    var button = fastn('button')
        .on('click', (event, scope) => t.pass('recieved click'))

    button.render();

    document.body.appendChild(button.element);

    button.element.click();

    button.element.remove();
    button.destroy();

});

test('event handling - function handler - this', function(t){

    t.plan(1);

    var fastn = createFastn();

    var input = fastn('input', {
        value: 'a'
    })
    .on('click', function(event, scope){ this.value('b') })

    input.render();

    document.body.appendChild(input.element);

    input.element.value = 'b';
    input.element.click();

    t.equal(input.value(), 'b')

    input.element.remove();
    input.destroy();

});
