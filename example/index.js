var components = {
    _generic: require('../genericComponent'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    binding = fastn.binding,
    Enti = require('enti'),
    crel = require('crel');

var model = {
        uiState: {
            foo: 'bar'
        }
    },
    enti = new Enti(model);

window.onload = function(){
    var app = fastn('div',
        require('./userList')(fastn)
    );

    app.attach(model);
    app.render();

    window.app = app;

    setTimeout(function(){
        enti.set('users', require('./users.json'))
    }, 1000);

    crel(document.body, app.element);
};