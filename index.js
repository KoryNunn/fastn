var Enti = require('enti'),
    merge = require('flat-merge');

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
    return function(data, type){
        component[key].attach(data, type);
    }
}

function dereferenceSettings(settings){
    var result = {},
        keys = Object.keys(settings);

    for(var i = 0; i < keys.length; i++){
        var key = keys[i];
        result[key] = settings[key];
        if(isBinding(result[key])){
            result[key] = merge(null, result[key]);
        }
    }

    return result;
}

function createComponent(fastn, type, settings, children, components){
    var component;

    settings = dereferenceSettings(settings || {});
    children = children.slice();

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
    component._children = children;

    for(var key in settings){
        if(isProperty(component[key])){
            if(isBinding(settings[key])){
                var binding = settings[key]._fastn_binding;
                if(settings[key]._scope){
                    component[key].attach(settings[key]._scope);
                }
                component[key].bind(binding);
                component.on('attach', createAttachCallback(component, key));

                function update(){
                    if(component.element){
                        component.emit('update');
                    }
                }

                component.on('attach', update);
                component.on('render', update);
            }else{
                component[key](settings[key]);
            }
        }
    }

    var attachType;
    component.attach = function(data, type){
        if(type && type !== attachType && attachType === true){
            return;
        }
        attachType = type || true;
        this._scope = data;
        this.emit('attach', data, type || true);
        return this;
    };

    component.scope = function(){
        return this._scope;
    };

    return component;
}

module.exports = function(components){

    function fastn(type){
        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2;

        if(isComponent(args[1])){
            childrenIndex--;
            settings = null;
        }

        return createComponent(fastn, type, settings, args.slice(childrenIndex), components);
    }

    fastn.property = function(instance, propertyName, transform){
        var binding,
            model = new Enti(),
            attachType;

        instance.on('update', function(){
            property._update();
        });

        function property(newValue){
            if(!arguments.length){
                return this._value;
            }

            if(this._value === newValue){
                return
            }

            this._value = newValue;
            instance.emit(propertyName, this._value);
            if(binding){
                model.set(binding, this._value);
            }
        }

        var handler = function(){
            if(instance._settings[propertyName].transform){
                return property.apply(instance, [instance._settings[propertyName].transform(arguments[0])].concat(Array.prototype.slice(arguments, 1)));
            }
            property.apply(instance, arguments);
        };

        property.attach = function(data, type){
            if(type && type !== attachType && attachType === true){
                return;
            }
            attachType = type || true;
            model.attach(data);
            property._update();
        };
        property.detach = function(){
            attachType = null;
            model.detach();
            property._update();
        };
        property.bind = function(newBinding){
            binding = newBinding;
            model._events = {};
            model._events[newBinding] = handler
        };
        property._update = function(){
            if(binding && attachType){
                this._value = model.get(binding);
            }else{
                this._value = isBinding(instance._settings[propertyName]) ? instance._settings[propertyName].value : instance._settings[propertyName];
            }
            var transform = instance._settings[propertyName].transform;
            if(transform){
                this._value = transform(this._value);
            }
            instance.emit(propertyName, this._value);
        };
        property._fastn_property = true;

        instance[propertyName] = property;
    };

    fastn.binding = function(key, transform, defaultValue){
        if(typeof transform !== 'function'){
            defaultValue = transform;
            transform = null;
        }
        return {
            _fastn_binding: key,
            value: defaultValue,
            transform: transform,
            attach: function(model){
                this._scope = model;
                return this;
            }
        };
    };

    fastn.isComponent = isComponent;
    fastn.isBinding = isBinding;
    fastn.isProperty = isProperty;

    return fastn;
};