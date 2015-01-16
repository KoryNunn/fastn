module.exports = function(fastn){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', {items: fastn.binding('users'), template: function(item, key, scope){
        return require('./user.js')(fastn, selectedUser)
    }});
};