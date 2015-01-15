var crel = require('crel'),
    containerComponent = require('./containerComponent');

function createPropertyUpdater(generic, key){
    generic.on(key, function(value){
        if(!generic.element){
            return;
        }
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
    generic.on('render', function(){
        generic.emit(key, generic[key]());
    });
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        fastn.property(generic, key);
        createPropertyUpdater(generic, key);
    }
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        this.element = crel(type);

        this.emit('render');
    };

    generic.on('render', function(){
        for(key in generic._events){
            if('on' + key in generic.element){
                generic.element.addEventListener(key, function(event){
                    generic.emit(key, event, generic.scope());
                });
            }
        }
    });

    return generic;
};