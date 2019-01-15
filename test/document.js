module.exports = function(){
    var MockBrowser = require('mock-browser').mocks.MockBrowser;
    var mock = new MockBrowser();

    global.document = mock.getDocument();
    global.window = mock.getWindow();
    global.Node = global.window.Node;
    global.HTMLElement = global.window.HTMLElement;

    var eventNames = require('./eventNames');

    Object.defineProperty(global.HTMLElement.prototype, 'value', {
        get: function() {
            return this._value;
        },
        set: function(value) {
            this._value = (value == null ? '' : value).toString();
        }
    });

    global.HTMLElement.prototype.value = null;

    global.Node.prototype.remove = function(){
        if(this.parentNode){
            this.parentNode.removeChild(this);
        }
    };

    global.Node.prototype.addEventListener = function(eventName, handler){
        this._events = this._events || {};
        this._events[eventName] = this._events[eventName] || [];
        this._events[eventName].push(handler);
    };
    global.Node.prototype.removeEventListener = function(eventName, handler){
        this._events && this._events[eventName] && this._events[eventName].splice(
            this._events[eventName].indexOf(handler), 1
        );
    };

    global.Node.prototype._emit = function(eventName){
        this._events && this._events[eventName] && this._events[eventName].map(function(handler){
            handler({target: this});
        }, this);
    };

    global.Node.prototype.click = function(){
        this._emit('click');
    };

    eventNames.map(function(eventName){
        global.Node.prototype[eventName] = undefined;
    });

    global.document = document;
};