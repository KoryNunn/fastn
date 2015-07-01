var fastn = require('./fastn'),
    exampleSource = require('./exampleSource'),
    exampleRunner = require('./exampleRunner');

module.exports = function(url){
    return fastn('div', {class:'example'},
        exampleSource(url),
        exampleRunner(url)
    );
};