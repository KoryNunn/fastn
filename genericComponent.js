var crel = require('crel'),
    containerComponent = require('./containerComponent');

function createPropertyUpdater(fastn, generic, key, settings){
    var setting = settings[key];

    if(isBinding(setting)){
        setting = fastn.property(setting);
    }

    if(isProperty(setting)){
        component.on('update', function(){
            setting.update();
        });
        component.on('attach', function(object){
            setting.attach(object);
        });
        setting.on('update', function(value){
            if(!generic.element){
                return;
            }
            
            var element = generic.element,
                isProperty = key in element,
                previous = isProperty ? element[key] : element.getAttribute(key);

            if(value == null){
                value = '';
            }

            if(value !== previous){
                if(isProperty){
                    element[key] = value;
                }else{
                    element.setAttribute(key, value);
                }
            }
        });

        generic[key] = setting;
    }
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        initialiseProperty(fastn, generic, key, settings);
    }
}

function addUpdateHandler(generic, eventName, settings){
    generic.element.addEventListener(eventName, function(event){
        generic.emit(eventName, event, generic.scope());
    });
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        this.element = crel(type);

        this.emit('render');
    };

    generic.on('render', function(){
        for(key in this._events){
            if('on' + key.toLowerCase() in generic.element){
                addUpdateHandler(generic, key);
            }
        }
    });

    return generic;
};