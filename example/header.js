module.exports = function(fastn){
    return fastn('header', {'class':'mainHeader'},
        fastn('h1', fastn.binding('users|*.deleted', function(users){
            if(!users){
                users = [];
            }

            return 'Users (' + users.filter(function(user){
                return !user.deleted;
            }).length + ')';
        }))
    );
};