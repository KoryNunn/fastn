var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    WhatChanged = require('what-changed'),
    is = require('./is');

module.exports = function createProperty(currentValue, changes){
    var binding,
        model,
        previous = new WhatChanged(currentValue, changes || 'value type reference keys');

    function property(value){
        if(!arguments.length){
            return binding && binding() || property._value;
        }

        if(!Object.keys(previous.update(value)).length){
            return property;
        }

        property._value = value;

        if(binding){
            binding(value);
            property._value = binding();
        }

        property.emit('change', property._value);
        property.update();

        return property;
    }

    property._value = currentValue;

    property._loose = true;

    for(var emitterKey in EventEmitter.prototype){
        property[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    property.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(newBinding === binding){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
        }
        binding = newBinding;
        if(model){
            property.attach(model, property._loose);
        }
        binding.on('change', property);
        property.update();
        return property;
    };
    property.attach = function(object, loose){
        if(loose && !property._loose){
            return property;
        }

        property._loose = loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding){
            model = object;
            binding.attach(object, true);
            property(binding());
        }
        property.update();
        return property;
    };
    property.detach = function(loose){
        if(loose && !component._loose){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
            binding.detach(true);
            model = null;
        }
        property.update();
        return property;
    };
    property.update = function(){
        property.emit('update', property._value);
    };
    property._fastn_property = true;

    return property;
};