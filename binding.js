var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter;

function bindify(binding, key){
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }
    binding.setMaxListeners(1000);
    binding.model = new Enti(
        ),
    binding._fastn_binding = key;
    binding._firm = false;

    return binding;
}

function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        resultBinding = createBinding('result'),
        attaching;

    resultBinding.model.set = function(key, value){
        this.emit(key, value);
    };

    function change(){
        if(attaching){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding, index){
        if(typeof binding === 'string'){
            binding = createBinding(binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
        resultBinding.on('detach', binding.detach);
    });

    resultBinding.on('attach', function(object){
        attaching = true;
        bindings.forEach(function(binding){
            binding.attach(object, true);
        });
        attaching = false;
        change();
    });

    return resultBinding;
}

function drill(sourceKey, targetKey){
    var drilledBinding = createBinding(targetKey),
        resultBinding = bindify(function(value, self){
            return drilledBinding.apply(null, arguments);
        }, sourceKey + '.' + targetKey);

    resultBinding.attach = function(object, loose){
        if(loose && resultBinding._firm){
            return resultBinding;
        }

        resultBinding._firm = !loose;

        resultBinding.emit('attach', object);
        return resultBinding;
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
    if(arguments.length > 1){
        return fuseBinding.apply(null, arguments);
    }

    var value;

    var dotIndex = key.indexOf('.');
    if(key.length > 1 && ~dotIndex){
        return drill(key.slice(0, dotIndex), key.slice(dotIndex+1));
    }

    var binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        binding.model.set(key, newValue);
    };
    bindify(binding, key);

    var handler = function(newValue){
        value = newValue;
        binding.emit('change', value);
    };
    binding.model._events = {};
    binding.model._events[key] = handler

    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && binding._firm){
            return binding;
        }

        binding._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        binding.model.attach(object);
        handler(binding.model.get(key));
        binding._scope = object;
        binding.emit('attach', object, true);
        return binding;
    };
    binding.detach = function(loose){
        if(loose && binding._firm){
            return binding;
        }

        binding.model.detach(true);
        handler(undefined);
        binding._scope = null;
        binding.emit('detach');
        return binding;
    };
    binding.drill = function(drillKey){
        return drill(key, drillKey);
    };

    return binding;
}

module.exports = createBinding;