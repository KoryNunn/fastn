var fastn = require('./fastn');

module.exports = function(selectedUser, deleteUser){
    var searchResult = require('./search').result;

    return fastn('div', {
            class: fastn.binding('.', 'name', searchResult, selectedUser, 'deleted', function(user, name, searchResult, selectedUser, deleted){
                var classes = ['user'];

                if(searchResult && !~searchResult.indexOf(user)){
                    classes.push('hidden');
                }
                if(user === selectedUser){
                    classes.push('selected');
                }
                if(deleted){
                    classes.push('deleted');
                }
                return classes;
            })
        },

        fastn('img', { 
            src: fastn.binding('picture.medium')
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
                scope.set('deleted', true);
                deleteUser();
            })
        )

    ).on('click', function(event, scope){
        selectedUser(scope.get('.'));
    });
};