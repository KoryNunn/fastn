var crel = require('crel'),
    Enti = require('enti'),
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = genericComponent(type, fastn, settings, children),
        lastValue = {},
        itemModel = new Enti({});

    function update(){
        var value = templater.data(),
            template = templater._settings.template;

        if(!template){
            return;
        }

        if(lastValue === value){
            return;
        }

        lastValue = value;

        if(templater._currentComponent){
            templater.remove(templater._currentComponent);
            templater._currentComponent.destroy();
            templater._currentComponent = null;
        }

        itemModel.set('item', value);

        templater._currentComponent = template(itemModel, templater.scope());

        if(!templater._currentComponent){
            templater._insert(document.createTextNode(''));
            return;
        }
            
        templater._currentComponent._templated = true;

        templater.insert(templater._currentComponent);

        if(fastn.isComponent(templater._currentComponent) && templater._settings.attachTemplates !== false){
            templater._currentComponent.attach(itemModel, true);
        }
    };

    templater.render = function(){
        templater.element = templater.element || document.createTextNode('');
        templater.emit('render');
    };

    templater._insert = function(element){
        if(templater.element && templater.element.parentNode){
            templater.element.parentNode.replaceChild(element, templater.element);
        }
        templater.element = element;
    };
    templater.data.foo = 'bar'; 
    templater.data.on('update', update);
    templater.on('destroy', function(){
        if(fastn.isComponent(templater._currentComponent)){
            templater._currentComponent.destroy();
        }
    });

    return templater;
};