var fastn = require('./fastn'),
    crel = require('crel');

var app = fastn('div',
    require('./header')(),
    require('./userList')(),
    require('./stats')(),
    require('./forkBanner')()
);

window.onload = function(){
   
    app.render();

    document.body.appendChild(app.element);
};