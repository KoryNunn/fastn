module.exports = function(fastn){
    var selectedUser = fastn.binding('selectedUser').attach({});


    return fastn('list', {items: fastn.binding('users'), template: function(item, key, scope){

        function deleteUser(){
            scope.set('users', scope.get('users').filter(function(user){
                return user !== item;
            }));
        }

        return require('./user.js')(fastn, selectedUser, deleteUser)
    }});
};