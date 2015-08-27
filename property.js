var Enti = require('enti'),
    WhatChanged = require('what-changed'),
    same = require('same-value'),
    firmer = require('./firmer'),
    createBinding = require('./binding'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    is = require('./is');


function propertyTemplate(value){
    if(!arguments.length){
        return this.binding && this.binding() || this.property._value;
    }

    if(!this.destroyed){

        this.property._value = value;

        if(this.binding){
            this.binding(value);
            return this.property;
        }

        if(!this.hasChanged(value)){
            return this.property;
        }

        this.property.emit('change', this.property._value);
        this.property.update();
    }

    return this.property;
}

function changeChecker(current, changes){
    if(changes){
        var changes = new WhatChanged(current, changes);

        return function(value){
            return Object.keys(changes.update(value)).length > 0;
        };
    }else{
        var lastValue = current;
        return function(newValue){
            if(!same(lastValue, newValue)){
                lastValue = newValue;
                return true;
            }
        };
    }
}

function createProperty(currentValue, changes, updater){
    if(typeof changes === 'function'){
        updater = changes;
        changes = null;
    }

    var model,
        destroyed;

    var propertyScope = {
        property: property,
        hasChanged: changeChecker(currentValue, changes),
        bindingUpdate: function(value){
            if(!propertyScope.hasChanged(value)){
                return;
            }
            property._value = value;
            property.emit('change', property._value);
            property.update();
        }
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
            propertyScope.binding.removeListener('change', propertyScope.bindingUpdate);
        }
        propertyScope.binding = newBinding;
        if(model){
            property.attach(model, property._firm);
        }
        propertyScope.binding.on('change', propertyScope.bindingUpdate);
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
            propertyScope.binding.removeListener('change', propertyScope.bindingUpdate);
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
        component.setProperty(key, property);

        return property;
    };
    property._fastn_property = true;

    return property;
};

module.exports = createProperty;