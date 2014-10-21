var components = {
    textbox: require('./textbox')
};

var fastn = require('../')(components),
    Enti = require('enti'),
    crel = require('crel');

var model = {};

window.onload = function(){
    var app = fastn('div',
        fastn('a', {href:fastn.binding('y'), innerText:fastn.binding('x')}),
        fastn('textbox', {
            value: fastn.binding('x')
        }),
        fastn('textbox', {
            value: fastn.binding('y')
        })
    );

    app.attach(model);
    app.render();

    crel(document.body, app.element);
};