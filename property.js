var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

function getInitialBindingsAndUpdater(args){
    var bindingsIndex = 0,
        bindingsEndIndex = args
}

module.exports = function property(currentValue, updater){
    var binding,
        model;

    function property(value){
        if(!arguments.length){
            return binding && binding() || currentValue;
        }

        if(value === currentValue){
            return property;
        }

        currentValue = value;
        binding && binding(value);
        property.emit('change', value);
        property.update();

        return property;
    }

    for(var emitterKey in EventEmitter.prototype){
        property[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    property.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(binding){
            binding.removeListener('change', property);
            binding.detach(true);
        }
        binding = newBinding;
        property.attach(model);
        property.update();
        return property;
    };
    property.attach = function(object){
        if(binding){
            model = object;
            binding.attach(object, true);
            binding.on('change', property);
        }
        property.update();
        return property;
    };
    property.detach = function(){
        if(binding){
            binding.removeListener('change', property);
            binding.detach(true);
            model = null;
        }
        property.update();
        return property;
    };
    property.update = function(){
        property.emit('update', currentValue);
    };
    property._fastn_property = true;

    return property;
};