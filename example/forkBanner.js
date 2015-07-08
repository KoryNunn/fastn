var fastn = require('./fastn');

module.exports = function(){    
    return fastn('div', {class: 'github-fork-ribbon-wrapper bottom'},
        fastn('div', {class: 'github-fork-ribbon'},
            fastn('a', {href: 'https://github.com/KoryNunn/fastn/tree/gh-pages/example'}, 'Fork me')
        )
    );
};