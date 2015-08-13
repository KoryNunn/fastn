var containerComponent = require('./containerComponent'),
    schedule = require('./schedule'),
    fancyProps = require('./fancyProps'),
    matchDomHandlerName = /^((?:el\.)?)([^. ]+)(?:\.(capture))?$/;

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && (key in settings) ? setting : undefined;

    if(typeof value === 'function'){
        return;
    }

    function update(){
        var element = generic.getContainerElement(),
            value = property();

        if(!element || generic.destroyed()){
            return;
        }

        var isProperty = key in element,
            fancyProp = fancyProps[key],
            previous = fancyProp ? fancyProp(generic, element) : isProperty ? element[key] : element.getAttribute(key);

        if(!fancyProp && !isProperty && value == null){
            value = '';
        }

        if(value !== previous){
            if(fancyProp){
                fancyProp(generic, element, value);
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
    }

    if(!property){
        property = fastn.property(value, function(){
            generic.updateProperty(generic, property, update);
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

function addDomHandler(generic, element, handlerName, eventName, capture){
    var eventParts = handlerName.split('.');

    if(eventParts[0] === 'on'){
        eventParts.shift();
    }

    var handler = function(event){
            generic.emit(handlerName, event, generic.scope());
        };

    element.addEventListener(eventName, handler, capture);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler, capture);
    });
}

function addDomHandlers(generic, element, eventNames){
    var events = eventNames.split(' ');

    for(var i = 0; i < events.length; i++){
        var eventName = events[i],
            match = eventName.match(matchDomHandlerName);

        if(!match){
            continue;
        }

        if(match[1] || 'on' + match[2] in element){
            addDomHandler(generic, element, eventNames, match[2], match[3]);
        }
    }
}

function addAutoHandler(generic, element, key, settings){
    if(!settings[key]){
        return;
    }

    var autoEvent = settings[key].split(':'),
        eventName = key.slice(2);

    delete settings[key];

    var handler = function(event){
        var fancyProp = fancyProps[autoEvent[1]],
            value = fancyProp ? fancyProp(generic, element) : element[autoEvent[1]];

        generic[autoEvent[0]](value);
    };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function genericComponent(type, fastn, settings, children){
    var generic = containerComponent(type, fastn, settings, children);

    generic.updateProperty = genericComponent.updateProperty;
    generic.createElement = genericComponent.createElement;
    createProperties(fastn, generic, settings);

    generic.render = function(){
        generic.element = generic.createElement(settings.tagName || type);

        generic.emit('render');

        return generic;
    };

    generic.on('render', function(){
        var element = generic.getContainerElement();

        for(var key in settings){
            if(key.slice(0,2) === 'on' && key in element){
                addAutoHandler(generic, element, key, settings);
            }
        }

        for(var eventKey in generic._events){
            addDomHandlers(generic, element, eventKey);
        }
    });

    return generic;
}

genericComponent.updateProperty = function(generic, property, update){
    if(typeof document !== 'undefined' && document.contains(generic.element)){
        schedule(property, update);
    }else{
        update();
    }
};

genericComponent.createElement = function(tagName){
    if(tagName instanceof Node){
        return tagName;
    }
    return document.createElement(tagName);
};

module.exports = genericComponent;