var Enti = require('enti'),
    genericComponent = require('./genericComponent');

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

function createComponent(fastn, type, settings, children, componets){
    var component;

    if(!(type in componets)){
        component = genericComponent(type, fastn, settings, children);
    }else{
        component = componets[type](fastn, settings, children);
    }


    component._fastn_component = true;

    for(var key in settings){
        if(isBinding(settings[key])){
            var binding = settings[key]._fastn_binding;
            fastn.property(component, key);
            component[key].bind(binding);
            component.on('attach', createAttachCallback(component, key));
        }else if(isProperty(component[key])){
            component[key](settings[key]);
        }
    }

    component.attach = function(data){
        this.emit('attach', data);
    };

    component._children = children.slice();

    component.on('render', function(){
        for(var i = 0; i < component._children.length; i++){
            if(isComponent(component._children[i])){
                component._children[i].render();
            }
        }
    });

    component.on('attach', function(data){
        for(var i = 0; i < component._children.length; i++){
            if(isComponent(component._children[i])){
                component._children[i].attach(data);
            }
        }
    });

    return component;
}

module.exports = function(componets){

    function fastn(type){
        var settings = arguments[1],
            childrenIndex = 2;

        if(isComponent(arguments[1])){
            childrenIndex--;
            settings = null;
        }

        return createComponent(fastn, type, settings, Array.prototype.slice.call(arguments, childrenIndex), componets);
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

    fastn.binding = function(key){
        return {
            _fastn_binding: key
        };
    };

    fastn.isComponent = isComponent;
    fastn.isBinding = isBinding;
    fastn.isProperty = isProperty;

    return fastn;

};