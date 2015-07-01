var fastn = require('./fastn'),
    exampleSource = require('./exampleSource');

module.exports = function(){
    return fastn('section', {class:'thisFile'},
        fastn('h1', 'Easily break your code into modules'),
        fastn('p', 'Here\'s the source for this section.'),
        exampleSource('thisFile.js')
    );
};