var fastn = require('./fastn'),
    usersModel = require('./users').usersModel;

module.exports = function(searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: '../images/fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('span',
            fastn.binding('users|*', 'deletedUsers|*', require('./search').result,  function(users, deleted, results){
                if(!users){
                    'No users';
                }

                var total = users.filter(function(user){
                        return !~deleted.indexOf(user);
                    }).length;

                var result = '';

                if(results){
                    result += 'Showing ' + results.filter(function(user){
                        return !~deleted.indexOf(user);
                    }).length +' of ';
                }

                result += total;

                return result;
            }),
            ' users'
        ).attach(usersModel),
        require('./searchBar')()
    );
};