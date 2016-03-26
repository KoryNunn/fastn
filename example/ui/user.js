var fastn = require('../fastn');

module.exports = function(app, user){
    var selectedUserBinding = fastn.binding('selectedUser').attach(app.users);

    return fastn('div', {
            class: fastn.binding(
                'removed',
                selectedUserBinding,
                fastn.binding('visible').attach(app.users),
                function(removed, selectedUser, visible){
                    var classes = ['user'];

                    if(!~visible.indexOf(user)){
                        classes.push('hidden');
                    }
                    if(user === selectedUser){
                        classes.push('selected');
                    }
                    if(removed){
                        classes.push('deleted');
                    }
                    return classes;
                }
            )
        },

        fastn('img', {
            src: fastn.binding('picture', '.', selectedUserBinding, function(picture, user, selectedUser){
                return user === selectedUser ? picture.large : picture.medium;
            })
        }),

        fastn('div', {class: 'details'},

            fastn('label', {class: 'name'},
                fastn.binding('name.first'), ' ', fastn.binding('name.last')
            ),

            fastn('div', {class: 'info'},

                fastn('p', {class:'extra'},
                    fastn('a', {
                            href: fastn.binding('email', function(email){
                                return 'mailto:' + email;
                            })
                        },
                        fastn.binding('email')
                    ),
                    fastn('p', fastn.binding('cell', function(cell){
                        return 'Mobile: ' + cell;
                    }))
                )

            ),

            fastn('button', {class: 'remove'},'X')
            .on('click', function(event, scope){
                usersService.deleteUser(scope.get('.'));
            })
        )

    ).on('click', function(event, scope){
        usersService.selectedUser(scope.get('.'));
    });
};