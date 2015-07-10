function textComponent(type, fastn, settings, children){
    var text = fastn.base(type, settings, children);

    text.createTextNode = textComponent.createTextNode;
    text.render = function(){
        text.element = text.createTextNode('');
        text.emit('render');
    };

    if(settings.auto && !fastn.isBinding(settings.text) && !fastn.isProperty(settings.text)){
        text.render = function(){
            text.element = text.createTextNode(settings.text);
        };
        return text;
    }

    text.text = fastn.property('');
    text._updateText = function(value){
        if(!text.element){
            return;
        }

        text.element.textContent = (value == null ? '' : value);
    };

    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('update', text.text.update);

    return text;
}

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;