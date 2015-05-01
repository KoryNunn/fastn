var crel = require('crel'),
    containerComponent = require('./containerComponent');

var fancyProps = {
    disabled: function(element, value){
        if(arguments.length === 1){
            return element.hasAttribute('disabled');
        }
        if(value){
            element.setAttribute('disabled', 'disabled');
        }else{
            element.removeAttribute('disabled');
        }
    },
    textContent: function(element, value){
        if(arguments.length === 1){
            return element.textContent;
        }
        element.textContent = (value == null ? '' : value);
    },
    value: function(element, value){
        if(element.nodeName === 'INPUT' && element.type === 'date'){
            if(arguments.length === 1){
                return new Date(element.value);
            }
            value = new Date(value);
            if(isNaN(value)){
                element.value = null;
            }else{
                element.value = (value.toJSON() + '').split('T').shift();
            }
            return;
        }

        if(arguments.length === 1){
            return element.value;
        }
        if(value === undefined){
            value = null;
        }
        element.value = value;
    }
};

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && setting || null;

    if(typeof value === 'function'){
        return;
    } 

    if(!property){
        property = fastn.property();
        property(value);
        property.on('update', function(value){
            var element = generic.getContainerElement();

            if(!element){
                return;
            }

            var isProperty = key in element,
                fancyProp = fancyProps[key],
                previous = fancyProp ? fancyProp(element) : isProperty ? element[key] : element.getAttribute(key);

            if(!fancyProp && !isProperty && value == null){
                value = '';
            }

            if(value !== previous){
                if(fancyProp){
                    fancyProp(element, value);
                    return;
                }

                if(isProperty){
                    element[key] = value;
                    return;
                }

                if(typeof value !== 'function' && typeof value !== 'object'){
                    element.setAttribute(key, value);
                }
            }
        });
    }

    if(binding){
        property.binding(binding);
    }

    property.addTo(generic, key);
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        createProperty(fastn, generic, key, settings);
    }
}

function addUpdateHandler(generic, eventName, settings){
    var element = generic.getContainerElement(),
        handler = function(event){
            generic.emit(eventName, event, generic.scope());
        };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function addAutoHandler(generic, key, settings){
    if(!settings[key]){
        return;
    }

    var element = generic.getContainerElement(),
        autoEvent = settings[key].split(':'),
        eventName = key.slice(2);
        
    delete settings[key];

    var handler = function(event){
        generic[autoEvent[0]](element[autoEvent[1]]);
    };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        generic.element = crel(type);

        generic.emit('render');

        return generic;
    };

    generic.on('render', function(){
        var element = generic.getContainerElement();

        for(var key in settings){
            if(key.slice(0,2) === 'on' && key in element){
                addAutoHandler(generic, key, settings);
            }
        }

        for(var key in generic._events){
            if('on' + key.toLowerCase() in element){
                addUpdateHandler(generic, key);
            }
        }
    });

    return generic;
};