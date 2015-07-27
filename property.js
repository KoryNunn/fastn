var Enti = require('enti'),
    WhatChanged = require('what-changed'),
    firmer = require('./firmer'),
    createBinding = require('./binding'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    is = require('./is');


function propertyTemplate(value){
    if(!arguments.length){
        return this.binding && this.binding() || this.property._value;
    }

    if(!this.destroyed){

        if(!Object.keys(this.previous.update(value)).length){
            return this.property;
        }

        this.property._value = value;

        if(this.binding){
            this.binding(value);
            this.property._value = this.binding();
        }

        this.property.emit('change', this.property._value);
        this.property.update();
    }

    return this.property;
}

function createProperty(currentValue, changes, updater){
    if(typeof changes === 'function'){
        updater = changes;
        changes = null;
    }

    var binding,
        model,
        destroyed;

    var propertyScope = {
        property: property,
        binding: binding,
        previous: new WhatChanged(currentValue, changes || 'value type reference keys')
    };

    /*
        This very odd pattern has a huge impact on performance
        by removing the hot function out of scope.
    */
    var property = propertyScope.property = propertyTemplate.bind(propertyScope);

    property._value = currentValue;
    property._update = updater;

    property._firm = 1;

    makeFunctionEmitter(property);

    property.binding = function(newBinding){
        if(!arguments.length){
            return propertyScope.binding;
        }

        if(!is.binding(newBinding)){
            newBinding = createBinding(newBinding);
        }

        if(newBinding === propertyScope.binding){
            return property;
        }

        if(propertyScope.binding){
            propertyScope.binding.removeListener('change', property);
        }
        propertyScope.binding = newBinding;
        if(model){
            property.attach(model, property._firm);
        }
        propertyScope.binding.on('change', property);
        property(propertyScope.binding());
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

        if(propertyScope.binding){
            model = object;
            propertyScope.binding.attach(object, 1);
        }

        if(property._events && 'attach' in property._events){
            property.emit('attach', object, 1);
        }

        return property;
    };

    property.detach = function(firm){
        if(firmer(property, firm)){
            return property;
        }

        if(propertyScope.binding){
            propertyScope.binding.removeListener('change', property);
            propertyScope.binding.detach(1);
            model = null;
        }

        if(property._events && 'detach' in property._events){
            property.emit('detach', 1);
        }

        return property;
    };

    property.update = function(){
        if(!destroyed){

            if(property._update){
                property._update(property._value, property);
            }

            property.emit('update', property._value);
        }
        return property;
    };

    property.updater = function(fn){
        if(!arguments.length){
            return property._update;
        }
        property._update = fn;
        return property;
    };

    property.destroy = function(){
        if(!destroyed){
            destroyed = true;

            property
                .removeAllListeners('change')
                .removeAllListeners('update')
                .removeAllListeners('attach');

            property.emit('destroy');
            property.detach();
            if(propertyScope.binding){
                propertyScope.binding.destroy(true);
            }
        }
        return property;
    };

    property.destroyed = function(){
        return destroyed;
    };

    property.addTo = function(component, key){
        component[key] = property;
        return property;
    };
    property._fastn_property = true;

    return property;
};

module.exports = createProperty;