var crel = require('crel'),
    containerComponent = require('./containerComponent');

function createPropertyUpdater(generic, key){
    generic.on(key, function(value){
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
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        fastn.property(generic, key);
        createPropertyUpdater(generic, key);
    }
}

function addUpdateHandler(generic, eventName, settings){
    if(typeof settings[eventName] === 'string' && settings[eventName] in settings){
        generic.element.addEventListener(eventName.slice(2), function(event){
            generic[settings[eventName]](generic.element[settings[eventName]]);
        });
    }
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        this.element = crel(type);

        this.emit('render');
    };

    generic.on('render', function(){
        for(key in settings){
            if(key.match(/^on/) && key in generic.element){
                addUpdateHandler(generic, key, settings);
            }
        }
    });

    return generic;
};