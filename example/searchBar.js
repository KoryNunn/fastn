var fastn = require('./fastn'),
    search = require('./search');

module.exports = function(){
    return fastn('nav', {class: 'search'},
        fastn('label', 'Search'), 
        fastn('input', { 
            value: search.userSearch,
            onkeyup: 'value:value'
        })
    )
};