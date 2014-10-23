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

window.onload = function(){
    var app = fastn('div',
        fastn('a', {href: binding('y'), innerText: binding('x', 'hello world')}),
        fastn('textbox', {value: binding('x', 15)}),
        fastn('textbox', {value: binding('y')}),
        fastn('list', {
            items: binding('items'),
            template: fastn('span', {innerText: binding('item')}),
            template: fastn('span', {innerText: binding('a')})
        })
    );

    app.attach(model);
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