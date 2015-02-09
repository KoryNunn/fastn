var crel = require('crel'),
    Enti = require('enti'),
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = genericComponent(type, fastn, settings, children),
        currentItem,
        lastValue = {},
        itemModel = new Enti({});

    function update(){
        var value = templater.data(),
            template = templater._settings.template;

        if(!template){
            return;
        }

        itemModel.set('item', value);

        if(lastValue === value){
            return;
        }

        lastValue = value;

        if(currentItem){
            templater.remove(currentItem);
            currentItem.destroy();
        }

        currentItem = template(itemModel, templater.scope())
            .attach(itemModel, true);
            
        currentItem._templated = true;

        templater.insert(currentItem);
    };

    templater.render = function(){
        templater.element = templater.element || crel('span');
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
    templater.data.on('change', function(data){
        console.log(data);
    });

    return templater;
};