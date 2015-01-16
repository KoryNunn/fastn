var Enti = require('enti');

module.exports = function(fastn, selectedUser){
    return fastn('div', {
            'class': fastn.binding(fastn.binding('.'), selectedUser, function(user, selectedUser){
                return ['user', user === selectedUser && 'selected'].join(' ');
            })
        },
        fastn('img', {src: fastn.binding('profileImage')}),
        fastn('div', {'class': 'details'},
            fastn('p', {'class':'primary'},
                fastn('label', {textContent: fastn.binding('firstName')}),
                fastn('input', {value: fastn.binding('firstName')})
                .on('keyup', function(event){
                    this.value(this.element.value);
                }),
                fastn('label', {textContent: fastn.binding('surname')})
            ),
            fastn('p', {'class':'extra'},
                fastn('a', {href: fastn.binding('email'), textContent: fastn.binding('email')})
            )
        )
    ).on('click', function(event, user){
        selectedUser(user);
    });
};