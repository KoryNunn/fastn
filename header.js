var fastn = require('./fastn');

module.exports = function(searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: './images/fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('h2', {class: 'headline'}, 
            fastn('span', 'Forget frameworks, '),
            fastn('wbr'),
            fastn('span', 'grab a nailgun.')
        )
    );
};