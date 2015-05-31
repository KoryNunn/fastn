var fastn = require('./fastn'),
    crel = require('crel');

var model = new fastn.Model({
        users: require('./users.js')
    });

var app = fastn('div',
    require('./header')(),
    require('./userList')(),
    require('./stats')(),
    require('./forkBanner')()
);

app.attach(model);

window.onload = function(){
   
    app.render();

    document.body.appendChild(app.element);
};