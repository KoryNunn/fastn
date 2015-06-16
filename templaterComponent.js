var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = new EventEmitter(),
        lastValue = {},
        itemModel = new fastn.Model({});

    function replaceElement(element){
        if(templater.element && templater.element.parentNode){
            templater.element.parentNode.replaceChild(element, templater.element);
        }
        templater.element = element;
    }

    function update(){
        var value = templater.data(),
            template = templater.template();

        if(!template){
            return;
        }

        lastValue = value;

        itemModel.set('item', value);

        var newComponent = fastn.toComponent(template(itemModel, templater.scope(), templater._currentComponent));

        if(templater._currentComponent && templater._currentComponent !== newComponent){
            if(fastn.isComponent(templater._currentComponent)){
                templater._currentComponent.destroy();
            }
        }

        templater._currentComponent = newComponent;

        if(!newComponent){
            replaceElement(document.createTextNode(''));
            return;
        }

        if(fastn.isComponent(newComponent)){
            if(templater._settings.attachTemplates !== false){
                newComponent.attach(itemModel, 2);
            }else{
                newComponent.attach(templater.scope(), 1);
            }

            if(templater.element && templater.element !== newComponent.element){
                newComponent.element == null && newComponent.render();
                replaceElement(templater._currentComponent.element);
            }
        }
    }

    templater.render = function(){
        var element;
        if(templater._currentComponent){
            templater._currentComponent.render();
            element = templater._currentComponent.element;
        }
        templater.element = element || document.createTextNode('');
        templater.emit('render');
    };

    fastn.property(undefined, settings.dataChanges || 'value structure')
        .addTo(templater, 'data')
        .on('update', update);

    fastn.property(undefined, 'value')
        .addTo(templater, 'template')
        .on('change', update);

    templater.on('destroy', function(){
        if(fastn.isComponent(templater._currentComponent)){
            templater._currentComponent.destroy();
        }
    });

    templater.on('attach', function(data){
        if(fastn.isComponent(templater._currentComponent)){
            templater._currentComponent.attach(data, 1);
        }
    });

    return templater;
};