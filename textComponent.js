var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

function textComponent(type, fastn, settings, children){
    var text = fastn.base(type, settings, children);

    text.createTextNode = textComponent.createTextNode;
    text.text = fastn.property('');
    text._updateText = function(value){
        if(!text.element){
            return;
        }

        text.element.textContent = value;
    };
    text.render = function(){
        text.element = text.createTextNode('');
        text.emit('render');
    };
    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('update', text.text.update);

    return text;
};

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;