var crel = require('crel'),
    genericComponent = require('../genericComponent'),
    EventEmitter = require('events').EventEmitter;

module.exports = function(type, fastn, settings, children){
    var textbox = genericComponent(type, fastn, settings, children);

    function updateValue(value){
        if(value !== textbox.element.value){
            textbox.element.value = value == null ? '' : value;
        }
    }

    textbox.render = function(){
        this.element = crel('input');
        this.element.addEventListener('keyup', function(){
            if(typeof textbox.value === 'function'){
                textbox.value(textbox.element.value);
            }
        });

        this.on('value', updateValue);
        updateValue(this.value());

        this.emit('render');
    };

    fastn.property(textbox, 'value');

    return textbox;
};