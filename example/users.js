var cpjax = require('cpjax'),
    fastn = require('./fastn');

function getUsers(callback){
    cpjax({
        url: './users.json',
        dataType: 'json'
    }, function(error, users){
        callback(error, users.map(function(user){
            return user.user;
        }));
    });
};

var usersModel = new fastn.Model({
    users: [],
    deletedUsers: []
});

getUsers(function(error, users){
    if(error){
        return;
    }

    usersModel.set('users', users);
});

function deleteUser(user){
    usersModel.push('deletedUsers', user);
}

function addUser(user){
    usersModel.insert('users', user, 0);
}

module.exports = {
    usersModel: usersModel,
    users: fastn.binding('users|*').attach(usersModel),
    deletedUsers: fastn.binding('deletedUsers|*').attach(usersModel),
    selectedUser: fastn.binding('selected').attach(usersModel),
    deleteUser: deleteUser,
    addUser: addUser
};