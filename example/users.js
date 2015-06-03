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
    users: []
});

getUsers(function(error, users){
    if(error){
        return;
    }

    usersModel.set('users', users);
});

module.exports = usersModel;