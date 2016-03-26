var fastn = require('../fastn'),
    userService = require('./users');

module.exports = function(app){
    var ui = fastn('div',
        require('./header')(app),
        require('./users')(app),
        require('./forkBanner')()
    ).attach(app);

    window.onload = function(){

        ui.render();

        document.body.appendChild(ui.element);

        // Clear the selected user on click anywhere
        // Capture phase to allow bubbled events to set the selected user
        document.addEventListener('click', function(){
            app.users.setSelected(null);
        }, true);
    };
};