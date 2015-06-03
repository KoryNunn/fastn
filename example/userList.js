var fastn = require('./fastn'),
    usersModel = require('./users');

module.exports = function(){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', 
        {
            class: 'users',
            items: fastn.binding('users|*'), 
            template: function(model, scope){

                function deleteUser(){
                    var deletedUsers = scope.get('deletedUsers') ||[];
                    deletedUsers.push(model.get('item'));
                    scope.set('deletedUsers', deletedUsers);
                }

                    return require('./user.js')(selectedUser, deleteUser).binding('item');
            }
        },
        fastn('button', {class: 'add'}, '+')
        .on('click', function(event, scope){
            require('./newUser')(scope);
        })
    )
    .attach(usersModel);
};