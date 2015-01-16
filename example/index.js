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

var users = [];

for(var i = 0; i < 10; i++){
    users.push({
        "profileImage":"http://4.bp.blogspot.com/-pFbPM7ustIw/UcBZpKQfG2I/AAAAAAAAB7E/Cvb61R1P4c0/s1600/profileholder.gif",
        "firstName": "bob",
        "surname": "down",
        "email": "bob@down.com"
    });
}

window.enti = enti;

window.onload = function(){
    var app = fastn('div',
        require('./userList')(fastn)
    );

    app.attach(model);
    app.render();

    window.app = app;

    setTimeout(function(){
        enti.set('users', users);
    });

    crel(document.body, app.element);
};