var crel = require('crel'),
    EventEmitter = require('events').EventEmitter;

module.exports = function(fastn, settings, children){
    var textbox = new EventEmitter();

    textbox.render = function(){
        this.element = crel('input');
        this.element.addEventListener('keyup', function(){
            if(typeof textbox.value === 'function'){
                textbox.value(textbox.element.value);
            }
        });

        this.on('value', function(value){
            if(value !== textbox.element.value){
                textbox.element.value = value;
            }
        });

        this.emit('render');
    };

    fastn.property(textbox, 'value');

    return textbox;
};