var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn, settings){
    var text = new EventEmitter();

    text.text = fastn.property('');
    text._updateText = function(value){
        if(!text.element){
            return;
        }

        text.element.textContent = value;
    };
    text.render = function(){
        text.element = document.createTextNode('');
        text.emit('render');
    };
    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('update', text.text.update);

    return text;
};