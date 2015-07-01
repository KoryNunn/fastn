var fastn = require('./fastn'),
    exampleSource = require('./exampleSource');

module.exports = function(){
    return fastn('section', {class:'getIt'},
        fastn('h1', 'Get it'),
        fastn('h2', 'NPM'),
        exampleSource('codeExamples/install.txt'),
        fastn('h2', 'Github'),
        fastn('a', {href: 'https://github.com/korynunn/fastn'}, 'https://github.com/korynunn/fastn')
    );
};