var fastn = require('./fastn'),
    usersService = require('./users');

module.exports = function(){
    return fastn('list',
        {
            insertionFrameTime: 64, // Drop at most 4 frames while rendering items
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