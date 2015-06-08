var fastn = require('./fastn'),
    usersService = require('./users');

module.exports = function(){
    return fastn('list',
        {
            class: 'users',
            items: usersService.users,
            template: function(model, scope){
                return require('./user.js')().binding('item');
            }
        },
        fastn('button', {class: 'add'}, '+')
        .on('click', function(event, scope){
            require('./newUser')();
        })
    );
};