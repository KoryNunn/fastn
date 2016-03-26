var EventEmitter = require('events');

module.exports = function(){
    var app = new EventEmitter();

    app.users = require('./users')(app);

    app.init = function(){
        app.emit('init');
    };

    return app;
};