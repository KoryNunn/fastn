var Enti = require('enti');

module.exports = function(fastn, userSearch, selectedUser, deleteUser){

    return fastn('div', {
            'class': fastn.fuse('.', userSearch, selectedUser, 'deleted', function(user, search, selectedUser, deleted){
                return [
                    'user',
                    (user && (~user.name.first.indexOf(search) || ~user.name.last.indexOf(search))) ? '' : 'hidden',
                    user === selectedUser ? 'selected' : '',
                    deleted ? 'deleted' : ''
                ].join(' ').trim();
            })
        },

        fastn('img', {src: fastn.fuse('picture', function(picture){
                return picture && picture.medium;
            })
        }),

        fastn('label', {
            'class': 'name',
            textContent: fastn.fuse('name.first', 'name.last', function(firstName, surname){
                return firstName + ' ' + surname;
            })
        }),

        fastn('div', {'class': 'details'},

            fastn('p', {'class':'extra'},
                fastn('a', {
                    textContent: fastn.binding('email'),
                    href: fastn.fuse('email', function(email){
                        return 'mailto:' + email;
                    })
                }),
                fastn('p', {
                    textContent: fastn.fuse('cell', function(cell){
                        return 'Mobile: ' + cell;
                    })
                })
            )

        ),

        fastn('button', {textContent: 'X', 'class': 'remove'})
        .on('click', function(event, scope){
            scope.set('deleted', true);
            deleteUser();
        })

    ).on('click', function(event, scope){
        selectedUser(scope._model);
    });
};