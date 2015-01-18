var Enti = require('enti');

module.exports = function(fastn, selectedUser, deleteUser){

    return fastn('div', {
            'class': fastn.fuse(fastn.binding('.'), selectedUser, fastn.binding('deleted'), function(user, selectedUser, deleted){
                return [
                    'user',
                    user === selectedUser ? 'selected' : '',
                    deleted ? 'deleted' : ''
                ].join(' ');
            })
        },

        fastn('img', {src: fastn.fuse(
            fastn.binding('picture'), function(picture){
                return picture && picture.medium;
            })
        }),

        fastn('label', {
            'class': 'name',
            textContent: fastn.fuse(fastn.binding('name'), function(name){
                    if(!name){
                        return 'No name set';
                    }
                    return name.first + ' ' + name.last;
                }
            )
        }),

        fastn('div', {'class': 'details'},

            fastn('p', {'class':'extra'},
                fastn('a', {
                    textContent: fastn.binding('email'),
                    href: fastn.fuse(fastn.binding('email'), function(email){
                        return 'mailto:' + email;
                    })
                }),
                fastn('p', {
                    textContent: fastn.fuse(fastn.binding('cell'), function(cell){
                        return 'Mobile: ' + cell;
                    })
                })
            )

        ),

        fastn('button', {textContent: 'X', 'class': 'remove'})
        .on('click', function(event, scope){
            scope.set('deleted', true);

            setTimeout(function(){
                deleteUser();
            }, 500);
        })

    ).on('click', function(event, scope){
        selectedUser(scope._model);
    });
};