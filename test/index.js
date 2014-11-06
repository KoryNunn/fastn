var components = {
    _generic: require('../genericComponent'),
    textbox: require('./textbox'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    binding = fastn.binding,
    Enti = require('enti'),
    crel = require('crel');

var model = {};

var x = {foo:'bar'},
    y = new Enti(x);

window.y = y;

window.onload = function(){
    var app = fastn('div',
        fastn('a', {href: binding('y'), innerText: binding('x', 'hello world')}),
        fastn('textbox', {value: binding('x', 15)}),
        fastn('textbox', {value: binding('y')}),
        fastn('list', {
            items: binding('items'),
            template: function(item, key){
                return fastn('div',
                    fastn('span', {innerText: binding('item')}),
                    fastn('span', {innerText: binding('a')})
                );
            }
        }),
        fastn('div',
            fastn('textbox', {value: binding('filter')}),
            fastn('span', {innerText: binding('foo', null).attach(x)})
        ).attach({filter: 'bob'}),
        fastn('form',
            fastn('h1',
                fastn('span', {innerText: 'hello '}),
                fastn('span', {innerText: binding('name', function(value){
                    return value == null ? 'User' : value;
                })})
            ),
            fastn('textbox', {value: binding('name'), 'class': 'majigger'})
        ).attach({name: null})
    );

    // app.attach(model);
    app.render();

    setTimeout(function(){
        app.attach({
            x:5,
            y:10,
            items:[
                {'a':1},
                {'a':2},
                {'a':3}
            ]
        });
    },1000);

    window.app = app;

    crel(document.body, app.element);
};