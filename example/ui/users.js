var fastn = require('../fastn'),
    usersService = require('./users');

module.exports = function(app){
    return fastn('list',
        {
            class: 'users',
            items: fastn.binding('users.active|*'),
            template: function(model, scope){
                var user = model.get('item');

                return require('./user.js')(app, user).binding('item');
            }
        },
        fastn('button', {class: 'add'}, '+')
        .on('click', function(event, scope){
            app.users.create();
        })
    );
};