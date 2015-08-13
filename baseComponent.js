var is = require('./is'),
    EventEmitter = require('events').EventEmitter;

function flatten(item){
    return Array.isArray(item) ? item.reduce(function(result, element){
        if(element == null){
            return result;
        }
        return result.concat(flatten(element));
    },[]) : item;
}

function attachProperties(object, firm){
    for(var key in this){
        if(is.property(this[key])){
            this[key].attach(object, firm);
        }
    }
}

function onRender(){

    // Ensure all bindings are somewhat attached just before rendering
    this.attach(undefined, 0);

    for(var key in this){
        if(is.property(this[key])){
            this[key].update();
        }
    }
}

function detachProperties(firm){
    for(var key in this){
        if(is.property(this[key])){
            this[key].detach(firm);
        }
    }
}

function destroyProperties(){
    for(var key in this){
        if(is.property(this[key])){
            this[key].destroy();
        }
    }
}

function FastnComponent(type, fastn, settings, children){
    var component = this,
        scope = new fastn.Model(false),
        binding = fastn.binding('.'),
        destroyed;

    binding._default_binding = true;

    component._type = type;
    component._settings = settings || {};
    component._children = flatten(children || []);

    component.attach = function(object, firm){
        binding.attach(object, firm);
        return component;
    };

    component.detach = function(firm){
        binding.detach(firm);
        return component;
    };

    component.scope = function(){
        return scope;
    };

    component.destroy = function(){
        if(destroyed){
            return;
        }
        destroyed = true;

        component
            .removeAllListeners('render')
            .removeAllListeners('attach');

        component.emit('destroy');
        component.element = null;
        scope.destroy();
        binding.destroy();

        return component;
    };

    component.destroyed = function(){
        return destroyed;
    };

    var lastBound;
    function emitAttach(){
        var newBound = binding();
        if(newBound !== lastBound){
            lastBound = newBound;
            scope.attach(lastBound);
            component.emit('attach', lastBound, 1);
        }
    }

    function emitDetach(){
        component.emit('detach', 1);
    }

    component.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(!is.binding(newBinding)){
            newBinding = fastn.binding(newBinding);
        }

        if(binding && binding !== newBinding){
            newBinding.attach(binding._model, binding._firm);
            binding.removeListener('change', emitAttach);
        }

        binding = newBinding;

        binding.on('change', emitAttach);
        binding.on('detach', emitDetach);

        emitAttach();

        return component;
    };

    component.clone = function(){
        return fastn(component._type, component._settings, component._children.filter(function(child){
                return !child._templated;
            }).map(function(child){
                return child.clone();
            })
        );
    };

    component.children = function(){
        return component._children.slice();
    };

    component.on('attach', attachProperties.bind(this));
    component.on('render', onRender.bind(this));
    component.on('detach', detachProperties.bind(this));
    component.once('destroy', destroyProperties.bind(this));

    component.binding(binding);

    if(fastn.debug){
        component.on('render', function(){
            if(component.element && typeof component.element === 'object'){
                component.element._component = component;
            }
        });
    }
}
FastnComponent.prototype = Object.create(EventEmitter.prototype);
FastnComponent.prototype.constructor = FastnComponent;
FastnComponent.prototype._fastn_component = true;

module.exports = FastnComponent;