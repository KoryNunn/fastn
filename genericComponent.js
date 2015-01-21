var crel = require('crel'),
    containerComponent = require('./containerComponent');

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && setting || null;

    if(!property){
        property = fastn.property(value);
    }

    if(binding){
        property.binding(binding);
    }

    generic.on('update', property.update);
    generic.on('attach', property.attach);
    property.on('update', function(value){
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
            }else if(typeof value !== 'function' && typeof value !== 'object'){
                element.setAttribute(key, value);
            }
        }
    });

    generic[key] = property;
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        createProperty(fastn, generic, key, settings);
    }
}

function addUpdateHandler(generic, eventName, settings){
    generic.element.addEventListener(eventName, function(event){
        generic.emit(eventName, event, generic.scope());
    });
}

module.exports = function(type, fastn, settings, children){
    if(children.length === 1 && !fastn.isComponent(children[0])){
        settings.textContent = children.pop();
    }

    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        this.element = crel(type);

        this.emit('render');
    };

    generic.on('render', function(){
        for(var key in this._events){
            if('on' + key.toLowerCase() in generic.element){
                addUpdateHandler(generic, key);
            }
        }
    });

    return generic;
};