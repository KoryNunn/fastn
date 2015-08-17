var is = require('./is'),
    objectAssign = require('object-assign'),
    GENERIC = '_generic';

function inflateProperties(component, settings){
    for(var key in settings){
        var setting = settings[key],
            property = component[key];

        if(is.property(settings[key])){

            if(is.property(property)){
                property.destroy();
            }

            setting.addTo(component, key);

        }else if(is.property(property)){

            if(is.binding(setting)){
                property.binding(setting);
            }else{
                property(setting);
            }

            property.addTo(component, key);
        }
    }
}

function createComponent(type, fastn, settings, children){
    var newSettings = objectAssign({}, settings || {});

    var component;

    if(!(type in fastn.components)){
        if(!(GENERIC in fastn.components)){
            throw new Error('No component of type "' + type + '" is loaded');
        }
        component = fastn.components._generic(type, fastn, newSettings, children);
    }else{
        component = fastn.components[type](type, fastn, newSettings, children);
    }

    component._properties = {};
    inflateProperties(component, newSettings);

    return component;
};

module.exports = createComponent;