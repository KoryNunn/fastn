function updateText(value){
    if(!this.element){
        return;
    }

    this.element.textContent = (value == null ? '' : value);
}

function autoText(fastn, content) {
    var text = fastn.base('text', null, null);

    text.render = function(){
        text.element = document.createTextNode(content);
    };

    return text;
}

function textComponent(type, fastn, settings, children){
    if(settings.auto){
        delete settings.auto;
        if(!fastn.isBinding(children[0])){
            return autoText(fastn, children[0]);
        }
        settings.text = children[0];
    }

    var text = fastn.base(type, settings, children);

    text.createTextNode = textComponent.createTextNode;
    text.render = function(){
        text.element = text.createTextNode(text.text());
        text.emit('render');
    };

    text.text = fastn.property('');
    text._updateText = updateText.bind(text);

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