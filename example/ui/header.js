var fastn = require('../fastn');

module.exports = function(app){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: '../images/fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('span',
            fastn.binding('users.active|*', 'users.visible|*',  function(active, visible){
                var result = '';

                if(active.length !== visible.length){
                    result += 'Showing ' + visible.length + ' of ';
                }

                result += active.length;

                return result;
            }),
            ' users'
        ).attach(app),
        require('./search')(app)
    );
};