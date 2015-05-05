var crel = require('crel'),
    Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = new EventEmitter(),
        lastValue = {},
        itemModel = new Enti({});

    function replaceElement(element){
        if(templater.element && templater.element.parentNode){
            templater.element.parentNode.replaceChild(element, templater.element);
        }
        templater.element = element;
    }

    function update(){
        var value = templater.data(),
            template = templater._settings.template;

        if(!template){
            return;
        }

        lastValue = value;

        if(templater._currentComponent){
            if(fastn.isComponent(templater._currentComponent)){
                templater._currentComponent.destroy();
            }
            templater._currentComponent = null;
        }

        itemModel.set('item', value);

        templater._currentComponent = fastn.toComponent(template(itemModel, templater.scope(), templater._currentComponent));

        if(!templater._currentComponent){
            replaceElement(document.createTextNode(''));
            return;
        }

        if(fastn.isComponent(templater._currentComponent)){
            if(templater._settings.attachTemplates !== false){
                templater._currentComponent.attach(itemModel, 2);
            }else{
                templater._currentComponent.attach(templater.scope(), 1);
            }

            if(templater.element){
                templater._currentComponent.render();
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
        .binding(settings.data)
        .on('change', update);

    templater.on('destroy', function(){
        if(fastn.isComponent(templater._currentComponent)){
            templater._currentComponent.destroy();
        }
    });

    return templater;
};