module.exports = function(fastn, userSearch){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', {items: fastn.binding('users'), template: function(item, key, scope){

        function deleteUser(){
            var deletedUsers = scope.get('deletedUsers') ||[];
            deletedUsers.push(item);
            scope.set('deletedUsers', deletedUsers);
        }

        return require('./user.js')(fastn, userSearch, selectedUser, deleteUser);
    }});
};