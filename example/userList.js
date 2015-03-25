module.exports = function(fastn, seatchModel, userSearch){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', {items: fastn.binding('users'), template: function(model, scope){

        function deleteUser(){
            var deletedUsers = scope.get('deletedUsers') ||[];
            deletedUsers.push(model.get('item'));
            scope.set('deletedUsers', deletedUsers);
        }

        return require('./user.js')(fastn, userSearch, selectedUser, deleteUser).binding('item');
    }});
};