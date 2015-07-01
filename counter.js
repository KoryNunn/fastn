var fastn = require('./fastn'),
    example = require('./example');

module.exports = function(){
    return fastn('section', {class:'counter'},
        fastn('h1', 'Make fast UIs fast'),
        example('codeExamples/counter.js')
    );
};