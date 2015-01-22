var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    WhatChanged = require('what-changed'),
    is = require('./is');

module.exports = function property(currentValue, updater){
    var binding,
        model,
        previous = new WhatChanged(currentValue, 'value type reference keys');

    function property(value){
        if(!arguments.length){
            return binding && binding() || currentValue;
        }

        if(!Object.keys(previous.update(value)).length){
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
        }
        binding = newBinding;
        if(model){
            property.attach(model, !property._firm);
        }
        property.update();
        return property;
    };
    property.attach = function(object, loose){
        if(loose && property._firm){
            return property;
        }

        property._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding){
            model = object;
            binding.attach(object, true);
            binding.on('change', property);
            property(binding());
        }
        property.update();
        return property;
    };
    property.detach = function(loose){
        if(loose && component._firm){
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
        property.emit('update', currentValue);
    };
    property._fastn_property = true;

    return property;
};