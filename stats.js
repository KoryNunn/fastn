var fastn = require('./fastn');

module.exports = function(){
    return fastn('section', {class:'stats'},
        fastn('h1', 'Light, fast, simple'),
        fastn('p', 'Minified and GZIP\'d, fastn is about 25KB'),
        fastn('p', 'Because fastn doesn\'t try to do too much, it\'s easy to write fast apps'),
        fastn('p', 'With only 3 main parts, fastn is very simple, and easy to learn')
    );
};