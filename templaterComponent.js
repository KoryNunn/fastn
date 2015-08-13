module.exports = function(type, fastn, settings, children){
    var templater = fastn.base(type, settings, children),
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

        itemModel.set('item', value);

        var newComponent = template && fastn.toComponent(template(itemModel, templater.scope(), templater._currentComponent));

        if(templater._currentComponent && templater._currentComponent !== newComponent){
            if(fastn.isComponent(templater._currentComponent)){
                templater._currentComponent.destroy();
            }
        }

        templater._currentComponent = newComponent;

        if(!newComponent){
            replaceElement(templater.emptyElement);
            return;
        }

        if(fastn.isComponent(newComponent)){
            if(templater._settings.attachTemplates !== false){
                newComponent.attach(itemModel, 2);
            }else{
                newComponent.attach(templater.scope(), 1);
            }

            if(templater.element && templater.element !== newComponent.element){
                if(newComponent.element == null){
                    newComponent.render();
                }
                replaceElement(templater._currentComponent.element);
            }
        }
    }

    templater.render = function(){
        var element;
        templater.emptyElement = document.createTextNode('');
        if(templater._currentComponent){
            templater._currentComponent.render();
            element = templater._currentComponent.element;
        }
        templater.element = element || templater.emptyElement;
        templater.emit('render');
    };

    fastn.property(undefined, settings.dataChanges || 'value structure')
        .addTo(templater, 'data')
        .on('change', update);

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