var fastn = require('./fastn'),
    exampleSource = require('./exampleSource');

module.exports = function(){
    return fastn('section', {class:'noHtml'},
        fastn('h1', 'Practically no HTML'),
        fastn('p', 'fastn doesn\'t use templates or HTML, but deals directly with the DOM.'),
        fastn('p', 'Here\'s the index.html file for this page, note the empty <body>'),
        exampleSource('index.html')
    );
};