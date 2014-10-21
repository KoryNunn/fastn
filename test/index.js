var components = {
    _generic: require('../genericComponent'),
    textbox: require('./textbox'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    Enti = require('enti'),
    crel = require('crel');

var model = {};

window.onload = function(){
    var app = fastn('div',
        fastn('a', {href:fastn.binding('y'), innerText:fastn.binding('x', 'hello world')}),
        fastn('textbox', {
            value: fastn.binding('x', 15)
        }),
        fastn('textbox', {
            value: fastn.binding('y')
        }),
        fastn('list', {
            items: fastn.binding('items'),
            template: fastn('div')
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