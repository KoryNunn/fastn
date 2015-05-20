var components = {
    _generic: require('../genericComponent'),
    list: require('../listComponent'),
    text: require('../textComponent')
};

var fastn = require('../')(components),
    crel = require('crel');

var data = {
        uiState: {
            foo: 'bar'
        }
    },
    model = new fastn.Model(data);

setInterval(function(){
    model.set('attachedEntis', model.attachedCount());
},1000);

var users = require('./users.json');

users = users.map(function(user){
    var user = user.user;
    // user.deleted = false;
    return user;
});

window.onload = function(){
    var searchModel = {
            userSearch: '',
            result: null
        },
        userSearch = fastn.binding('userSearch').attach(searchModel).on('change', function(search){
            if(!search){
                fastn.Model.set(searchModel, 'result', null);
                return;
            }
            fastn.Model.set(searchModel, 'result', users.filter(function(user){
                return user.name && (user.name.first && ~user.name.first.indexOf(search)) || (user.name.last && ~user.name.last.indexOf(search));
            }));
        });

    var app = fastn('div',
        fastn('div',
            'This example has ',
            fastn.binding('attachedEntis'),
            ' attached model instances'
        ),
        require('./header')(fastn, searchModel, userSearch),
        fastn('input', {value: userSearch})
            .on('keyup', function(){
                this.value(this.element.value);
            }),
        require('./userList')(fastn, searchModel, userSearch)
    );

    app.attach(data);
    app.render();

    window.app = app;
    window.model = model;

    setTimeout(function(){
        model.set('users', users);
    });

    crel(document.body, app.element);
};