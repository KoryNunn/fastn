var fastn = require('./fastn'),
    exampleSource = require('./exampleSource');

module.exports = function(){
    return fastn('section', {class:'tryIt'},
        fastn('h1', 'Try it'),
        fastn('p', 'Give fastn a go!'),
        fastn('a', {href: 'http://korynunn.github.io/fastn/try/'}, 'Try fastn')
    );
};