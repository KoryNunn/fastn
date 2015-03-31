var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    WhatChanged = require('what-changed'),
    firmer = require('./firmer'),
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

    property._firm = 1;

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
            property.attach(model, property._firm);
        }
        binding.on('change', property);
        property.update();
        return property;
    };
    property.attach = function(object, firm){
        if(firmer(property, firm)){
            return property;
        }

        property._firm = firm;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding){
            model = object;
            binding.attach(object, 1);
            property(binding());
        }else{
            property.update();
        }
        return property;
    };
    property.detach = function(firm){
        if(firmer(property, firm)){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
            binding.detach(1);
            model = null;
        }
        property.update();
        return property;
    };
    property.update = function(){
        if(property._destroyed){
            return;
        }
        property.emit('update', property._value);
        return property;
    };
    property.destroy = function(){
        if(property._destroyed){
            return;
        }
        property._destroyed = true;
        property.emit('destroy');
        property.detach();
        return property;
    };
    property.addTo = function(component, key){
        component[key] = property;
        return property;
    };
    property._fastn_property = true;

    return property;
};