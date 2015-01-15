var crel = require('crel'),
    containerComponent = require('./containerComponent');

module.exports = function(type, fastn, settings, children){
    var psudo = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        this.element = document.createDocumentFragment();

        this.emit('render');
    };

    return generic;
};