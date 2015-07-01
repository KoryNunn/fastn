var fastn = require('./fastn'),
    usersModel = require('./users').usersModel;

module.exports = function(searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: '../images/fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('span',
            fastn.binding('users|*.deleted', require('./search').result,  function(users, results){
                if(!users){
                    users = [];
                }

                var total = users.filter(function(user){
                        return !user.deleted;
                    }).length;

                var result = '';

                if(results){
                    result += 'Showing ' + results.length +' of ';
                }

                result += total;

                return result;
            }),
            ' users'
        ).attach(usersModel),
        require('./searchBar')()
    );
};