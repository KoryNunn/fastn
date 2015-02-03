var crel = require('crel'),
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = genericComponent(type, fastn, settings, children),
        currentItem,
        lastValue;

    function update(value){
        var template = templater._settings.template;
        if(!template){
            return;
        }

        if(lastValue === value){
            return;
        }

        lastValue = value;

        if(currentItem){
            templater.remove(currentItem);
        }

        currentItem = template(value, templater.scope()).attach(value);
        currentItem._templated = true;

        templater.insert(currentItem);
    };

    templater.render = function(){
        this.element = crel('span');
        this.data.on('update', update);
        update(this.data());
        this.emit('render');
    };

    templater.data = fastn.property(undefined, update).binding(settings.data);
    templater.on('attach', templater.data.attach);

    return templater;
};