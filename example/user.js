var Enti = require('enti');

module.exports = function(fastn){
    return fastn('div', {'class': 'user'
            // 'class': [fastn.binding('user'), fastn.binding('uiState.selectedUser'), function(user, selectedUser){
            //     return ['user', user === selectedUser && 'selected'].join(' ');
            // }]
        },
        fastn('img', {src: fastn.binding('profileImage')}),
        fastn('div', {'class': 'details'},
            fastn('p', {'class':'primary'},
                fastn('label', {textContent: fastn.binding('firstName')}),
                fastn('input', {value: fastn.binding('firstName')}),
                fastn('label', {textContent: fastn.binding('surname')})
            ),
            fastn('p', {'class':'extra'},
                fastn('a', {href: fastn.binding('email'), textContent: fastn.binding('email')})
            )
        )
    ).on('click', function(event, scope){
        if(this['class']() === 'user selected'){
            this['class']('user');
            return;
        }
        this['class']('user selected');
    });
};