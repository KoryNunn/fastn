var fastn = require('../fastn'),
    search = require('./search');

module.exports = function(app){
    return fastn('nav', {class: 'search'},
        fastn('label', 'Search'),
        fastn('input', {
            value: fastn.binding('search'),
            onkeyup: 'value:value'
        })
        .attach()
        .on('keyup', function(event, scope){
            app.users.setSearch(scope.get('search'));
        })
    )
};