var fastn = require('./fastn');

module.exports = function(){
    return fastn('nav',
        fastn('a', {href: 'https://github.com/KoryNunn/fastn'},
            fastn('i', {class: 'material-icons'}, 'code'),
            'Source'
        ),
        fastn('a', {href: './try'},
            fastn('i', {class: 'material-icons'}, 'build'),
            'Try It'
        ),
        fastn('a', {href: './example'},
            fastn('i', {class: 'material-icons'}, 'dashboard'),
            'Example App'
        ),
        fastn('a', {href: 'https://twitter.com/fastnjs'},
            fastn('i', {class: 'material-icons twitter'}, 'twitter'),
            'Twitter'
        )
    );
};