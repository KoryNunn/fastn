var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter;

function createSelfBinding(){
    var value;

    var binding = function(newValue){
        if(!arguments.length){
            return value;
        }

        value = newValue;
    }
    binding._fastn_binding = key;
    binding._firm = false;
    binding.attach = function(object, loose){
        if(loose && binding._firm){
            return;
        }

        binding._firm = !loose;

        value = object;
    };
    binding.detach = function(){};
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    return binding;
}

module.exports = function createBinding(key){
    var model = new Enti(),
        value;

    if(key === '.'){
        return createSelfBinding();
    }

    var binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        model.set(key, newValue);
    };

    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    var handler = function(newValue){
        value = newValue;
        binding.emit('change', value);
    };
    model._events = {};
    model._events[key] = handler


    binding._fastn_binding = key;
    binding._firm = false;
    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && binding._firm){
            binding.emit('attach', object);
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