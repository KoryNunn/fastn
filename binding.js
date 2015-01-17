var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter;

module.exports = function createBinding(key, defaultValue, transform){
    if(typeof defaultValue === 'function'){
        transform = defaultValue;
        defaultValue = undefined;
    }

    var model = new Enti(),
        value = defaultValue;

    var binding = function binding(newValue){
        if(!arguments.length){
            if(transform){
                return transform(value);
            }else{
                return value;
            }
        }

        if(transform){
            model.set(key, transform(value, newValue));
        }else{
            model.set(key, newValue);
        }

    };

    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    var handler = function(newValue){
        if(binding.transform){
            value = binding.transform(newValue);
        }else{
            value = newValue;
        }
        binding.emit('change', value);
    };
    model._events = {};
    model._events[key] = handler


    binding._fastn_binding = key;
    binding._defaultValue = defaultValue;
    binding.transform = transform;
    binding._firm = false;
    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && binding._firm){
            return;
        }

        binding._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        model.attach(object);
        handler(model.get(key));
        this._scope = object;
        binding.emit('attach', object);
        return this;
    };
    binding.detach = function(loose){
        if(loose && binding._firm){
            return;
        }

        model.detach();
        handler(undefined);
        this._scope = null;
        binding.emit('detach');
        return this;
    };

    return binding;
};