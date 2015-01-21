module.exports = function(fastn){

    return fastn('header', {'class':'mainHeader'},
        fastn('h1', fastn.fuse('users|*.deleted', 'deletedUsers', function(users, deleted){
            if(!users){
                users = [];
            }
            if(!deleted){
                deleted = [];
            }

            return 'Users (' + users.filter(function(user){
                return !~deleted.indexOf(user);
            }).length + ')';
        }))
    );
};