module.exports = function(fastn, searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('h1', fastn.binding('users|*.deleted', fastn.binding('result').attach(searchModel),  function(users, results){
            if(!users){
                users = [];
            }

            var result = 'Users (';

            if(results){
                result += 'Showing ' + results.length +' of ';
            }

            result += users.filter(function(user){
                return !user.deleted;
            }).length + ')';

            return result;
        }))
    );
};