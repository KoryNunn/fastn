var Enti = require('enti'),
    is = require('./is');

function dereferenceSettings(settings){
    var result = {},
        keys = Object.keys(settings);

    for(var i = 0; i < keys.length; i++){
        var key = keys[i];
        result[key] = settings[key];
        if(is.bindingObject(result[key])){
            result[key] = fastn.binding(
                result[key]._fastn_binding,
                result[key]._defaultValue,
                result[key].transform
            );
        }
    }

    return result;
}

module.exports = function createComponent(type, fastn, settings, children, components){
    var component,
        model = new Enti({});

    settings = dereferenceSettings(settings || {});
    children = children.slice();

    if(!(type in components)){
        if(!('_generic' in components)){
            throw 'No component of type "' + type + '" is loaded';
        }
        component = components._generic(type, fastn, settings, children);
    }else{
        component = components[type](type, fastn, settings, children);
    }

    component._type = type;
    component._settings = settings;
    component._fastn_component = true;
    component._children = children;

    for(var key in settings){
        if(is.property(component[key])){
            if(is.binding(settings[key])){
                component[key].binding(settings[key]);
            }else{
                component[key](settings[key]);
            }
        }
    }

    component.attach = function(data){
        model.attach(data instanceof Enti ? data._model : data);
        this.emit('attach', data);
        return this;
    };

    component.detach = function(){
        model.detach();
        this.emit('detach');
        return this;
    };

    component.scope = function(){
        return model;
    };

    function emitUpdate(){
        component.emit('update');
    }

    component.clone = function(){
        return createComponent(component._type, fastn, component._settings, component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return child.clone();
        }), components);
    };

    component.on('attach', emitUpdate);
    component.on('render', emitUpdate);

    return component;
}
