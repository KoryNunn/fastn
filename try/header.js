var fastn = require('./fastn'),
    codeService = require('./code');

module.exports = function(){
    return fastn('header',
        fastn('h1', 'Fastn try-er..'),
        fastn('div', {class: 'errors'}, codeService.errors)
    );
};