var fastn = require('./fastn'),
    exampleSource = require('./exampleSource');

module.exports = function(){
    return fastn('section', {class:'setup'},
        fastn('h1', 'Pick your tools'),
        exampleSource('codeExamples/setupFastn.js')
    );
};