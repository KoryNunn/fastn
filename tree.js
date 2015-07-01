var fastn = require('./fastn'),
    example = require('./example');

module.exports = function(){
    return fastn('section', {class:'tree'},
        fastn('h1', 'Solve complex problems easily'),
        example('codeExamples/tree.js')
    );
};