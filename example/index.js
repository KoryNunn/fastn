var components = {
    _generic: require('../genericComponent'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    Enti = require('enti'),
    crel = require('crel');

var model = {
        uiState: {
            foo: 'bar'
        }
    },
    enti = new Enti(model);

var users = require('./users.json').map(function(user){
    return user.user;
});

window.enti = enti;

window.onload = function(){
    var app = fastn('div',
        // require('./userList')(fastn),
        require('./header')(fastn)
    );

    app.attach(model);
    app.render();

    window.app = app;
    window.enti = enti;

    setTimeout(function(){
        enti.set('users', users);
    });

    crel(document.body, app.element);
};