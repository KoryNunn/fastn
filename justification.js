var fastn = require('./fastn'),
    example = require('./example');

module.exports = function(){
    return fastn('section', {class:'justification'},
        fastn('h1', 'Why fastn?'),
        fastn('h3', 'Fastn is exclusively a data-bound UI tool. It has very few opinions, which allows for it to be used in more flexible ways'),
        fastn('h3', 'You aren\'t even limited to rendering DOM nodes, as fastn can be used with third-party components, and even non-web UI\'s like nativescript.'),
        fastn('h3', 'Creating simple components allows for less coupling to the rest of your application.')
    );
};