var fastn = require('./fastn');

module.exports = function(selectedUser, deleteUser){
    var searchResult = require('./search').result,
        usersService = require('./users');

    return fastn('div', {
            class: fastn.binding('.', 'name', searchResult, usersService.selectedUser, usersService.deletedUsers, function(user, name, searchResult, selectedUser, deletedUsers){
                var classes = ['user'];

                if(searchResult && !~searchResult.indexOf(user)){
                    classes.push('hidden');
                }
                if(user === selectedUser){
                    classes.push('selected');
                }
                if(~deletedUsers.indexOf(user)){
                    classes.push('deleted');
                }
                return classes;
            })
        },

        fastn('img', {
            src: fastn.binding('picture', '.', usersService.selectedUser, function(picture, user, selectedUser){
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

            fastn('button', {class: 'remove'},'Delete')
            .on('click', function(event, scope){
                usersService.deleteUser(scope.get('.'));
            })
        )

    ).on('click', function(event, scope){
        usersService.selectedUser(scope.get('.'));
    });
};