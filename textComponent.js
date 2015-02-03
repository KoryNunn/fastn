var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn){
    var text = new EventEmitter();

    text.text = fastn.property('');
    text._updateText = function(){
        if(!text.element){
            return;
        }

        text.element.value = value;
    };
    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('render', function(){
        text._updateText(text.text());
    });
    text.on('update', text.text.update);

    return text;
};