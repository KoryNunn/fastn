var crel = require('crel'),
    containerComponent = require('./containerComponent'),
    EventEmitter = require('events').EventEmitter;

function createPropertyUpdater(generic, key){
    generic.on(key, function(value){
        var element = generic.element,
            isProperty = key in element,
            previous = isProperty ? element[key] : element.getAttribute(key);

        if(value == null){
            value = '';
        }

        if(value !== previous){
            if(isProperty){
                element[key] = value;
            }else{ 
                element.setAttribute(key, value);
            }
        }
    });
    generic.emit(key, generic[key]());
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    for(var key in settings){
        fastn.property(generic, key);
    }

    generic.render = function(){
        this.element = crel(type);

        for(var key in this){
            if(fastn.isProperty(this[key])){
                createPropertyUpdater(generic, key);
            }
        }

        this.emit('render');
    };

    return generic;
};