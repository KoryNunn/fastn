var is = require('./is'),
    objectAssign = require('object-assign');

function inflateProperties(component, settings){
    for(var key in settings){
        var setting = settings[key],
            property = component[key];

        if(is.property(settings[key])){

            // The componet already has a property at this key.
            // Destroy it.
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

module.exports = function createComponent(type, fastn, settings, children){
    settings = objectAssign({}, settings || {});

    var component;

    if(!(type in fastn.components)){
        if(!('_generic' in fastn.components)){
            throw 'No component of type "' + type + '" is loaded';
        }
        component = fastn.components._generic(type, fastn, settings, children);
    }else{
        component = fastn.components[type](type, fastn, settings, children);
    }

    inflateProperties(component, settings);

    return component;
};
