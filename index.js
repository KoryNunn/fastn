var fastn = require('./fastn');

var app = fastn('div',
    require('./header')(),
    fastn('div', {class: 'content'},
        fastn('p', {class: 'hook'}, 'A javascript tool for building user interfaces'),
        require('./setup')(),
        require('./counter')(),
        require('./todo')(),
        require('./tree')(),
        require('./thisFile')(),
        require('./noHtml')(),
        require('./stats')(),
        require('./getIt')(),
        require('./tryIt')()
    ),
    require('./forkBanner')()
);

window.onload = function(){

    app.render();

    document.body.appendChild(app.element);

};