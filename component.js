var is = require('./is');

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
    var component;

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
                component[key].attach(settings[key]);
            }else{
                component[key](settings[key]);
            }
        }
    }

    component.attach = function(data){
        this._scope = data;
        this.emit('attach', data);
        return this;
    };

    component.detach = function(){
        this._scope = null;
        this.emit('detach');
        return this;
    };

    component.scope = function(){
        return this._scope;
    };

    function emitUpdate(){
        component.emit('update');
    }

    component.on('attach', emitUpdate);
    component.on('render', emitUpdate);

    return component;
}
