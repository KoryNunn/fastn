var fastn = require('./fastn'),
    userService = require('./users');

var app = fastn('div',
    require('./header')(),
    require('./userList')(),
    require('./forkBanner')()
);

window.onload = function(){

    app.render();

    document.body.appendChild(app.element);

    // Clear the selected user on click anywhere
    // Capture phase to allow bubbled events to set the selected user
    document.addEventListener('click', function(){
        userService.selectedUser(null);
    }, true);
};