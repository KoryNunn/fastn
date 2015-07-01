var fastn = require('./fastn'),
    examples = require('./examples');

module.exports = function(){
    return fastn('section', {class:'setup'},
        fastn('h1', 'Pick your tools'),
        fastn('pre', examples('codeExamples/setupFastn.js'))
    );
};