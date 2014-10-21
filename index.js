var Enti = require('enti');

function isComponent(thing){
    return thing && typeof thing === 'object' && '_fastn_component' in thing;
}

function isBinding(thing){
    return thing && typeof thing === 'object' && '_fastn_binding' in thing;
}

function isProperty(thing){
    return thing && typeof thing === 'function' && '_fastn_property' in thing;
}

function createAttachCallback(component, key){
    return function(data){
        component[key].attach(data);
    }
}

function createComponent(fastn, type, settings, children, components){
    var component;

    if(!(type in components)){
        if(!('_generic' in components)){
            throw 'No component of type "' + type + '" is loaded';
        }
        component = components._generic(type, fastn, settings, children);
    }else{
        component = components[type](type, fastn, settings, children);
    }

    component._type = type;
    component._settings = settings;
    component._fastn_component = true;
    component._children = children.slice();

    for(var key in settings){
        if(isBinding(settings[key])){
            var binding = settings[key]._fastn_binding;
            fastn.property(component, key);
            component[key].bind(binding);
            component.on('attach', createAttachCallback(component, key));

            settings[key] = settings[key].value;
        }

        if(isProperty(component[key])){
            component[key](settings[key]);
        }
    }

    component.attach = function(data){
        this.emit('attach', data);
    };

    return component;
}

module.exports = function(components){

    function fastn(type){
        var settings = arguments[1],
            childrenIndex = 2;

        if(isComponent(arguments[1])){
            childrenIndex--;
            settings = null;
        }

        return createComponent(fastn, type, settings, Array.prototype.slice.call(arguments, childrenIndex), components);
    }

    fastn.property = function(instance, propertyName){
        var value,
            binding,
            model = new Enti();

        function property(newValue){
            if(!arguments.length){
                return value;
            }

            value = newValue;
            instance.emit(propertyName, value);
            if(binding){
                model.set(binding, value);
            }
        }
        property.attach = function(data){
            model.attach(data);
            if(binding){
                instance.emit(propertyName, model.get(binding));
            }
        };
        property.bind = function(key){
            binding = key;
            model._events = {}
            model._events[key] = function(){
                property.apply(instance, arguments);
            };
        };
        property._fastn_property = true;

        instance[propertyName] = property;
    };

    fastn.binding = function(key, defaultValue){
        return {
            _fastn_binding: key,
            value: defaultValue
        };
    };

    fastn.isComponent = isComponent;
    fastn.isBinding = isBinding;
    fastn.isProperty = isProperty;

    return fastn;

};