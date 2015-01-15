module.exports = function(fastn){
    return fastn('list', {items: fastn.binding('users'), template: function(item, key, scope){
        return require('./user.js')(fastn)
    }});
};