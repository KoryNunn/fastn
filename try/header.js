var fastn = require('./fastn'),
    codeService = require('./code');

module.exports = function(){
    return fastn('header',
        fastn('img', {src: '../images/fastn-sml.png'}),
        fastn('h1', 'Fastn try-er..'),
        fastn('button', {class:'reset'}, 'Reset')
        .on('click', codeService.reset),
        fastn('div', {class: 'errors'}, codeService.errors)
    );
};