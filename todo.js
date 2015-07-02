var fastn = require('./fastn'),
    example = require('./example');

module.exports = function(){
    return fastn('section', {class:'todo'},
        fastn('h1', 'A todo list, how original!'),
        example('codeExamples/todo.js')
    );
};