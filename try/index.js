var fastn = require('./fastn');

var app = fastn('div',
    require('./header')(),
    require('./codeView')(),
    require('./outputView')(),
    require('./forkBanner')()
);

// app.attach();
app.render();

window.onload = function(){


    document.body.appendChild(app.element);
};