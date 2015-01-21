var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter;

function bindify(binding, key){
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }
    binding.setMaxListeners(1000);
    binding._fastn_binding = key;
    binding._firm = false;

    return binding;
}

function createSelfBinding(){
    var value;

    var binding = function(newValue){
        if(!arguments.length){
            return value;
        }

        value = newValue;
    }
    bindify(binding, '.');
    binding.attach = function(object, loose){
        if(loose && binding._firm){
            return;
        }

        binding._firm = !loose;

        value = object;
    };
    binding.detach = function(){};

    return binding;
}

function drill(sourceKey, targetKey){
    var drilledBinding = createBinding(targetKey),
        resultBinding = bindify(function(value, self){
            return drilledBinding.apply(null, arguments);
        }, sourceKey + '.' + targetKey);

    resultBinding.attach = function(object, loose){
        if(loose && resultBinding._firm){
            return;
        }

        resultBinding._firm = !loose;

        resultBinding.emit('attach', object);
    };
    resultBinding.detach = resultBinding.emit.bind(null, 'attach');

    var internalChange;
    resultBinding.on('change', function(value){
        if(internalChange){
            internalChange = false;
            return;
        }
        drilledBinding.attach(value);
    });
    drilledBinding.on('change', function(value){
        internalChange = true;
        resultBinding.emit('change', value);
    });
    
    resultBinding.on('attach', function(object){
        drilledBinding.attach(object && object[sourceKey], true);
    });
    resultBinding.on('detach', drilledBinding.detach);

    return resultBinding;
}

function createBinding(key){
    var enti = new Enti(),
        value;

    if(key === '.'){
        return createSelfBinding();
    }

    var dotIndex = key.indexOf('.');
    if(~dotIndex){
        return drill(key.slice(0, dotIndex), key.slice(dotIndex+1));
    }

    var binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        enti.set(key, newValue);
    };
    bindify(binding, key);

    var handler = function(newValue){
        value = newValue;
        binding.emit('change', value);
    };
    enti._events = {};
    enti._events[key] = handler

    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && binding._firm){
            binding.emit('attach', object, loose);
            return;
        }

        binding._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        enti.attach(object);
        handler(enti.get(key));
        this._scope = object;
        binding.emit('attach', object);
        return this;
    };
    binding.detach = function(loose){
        if(loose && binding._firm){
            binding.emit('detach', loose);
            return;
        }

        enti.detach();
        handler(undefined);
        this._scope = null;
        binding.emit('detach');
        return this;
    };
    binding.drill = function(drillKey){
        return drill(key, drillKey);
    };

    binding.attach({}, true);

    return binding;
}

module.exports = createBinding;