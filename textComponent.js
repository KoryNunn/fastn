function updateText(){
    if(!this.element){
        return;
    }

    var value = this.text();

    this.element.textContent = (value == null ? '' : value);
}

function autoRender(content){
    this.element = document.createTextNode(content);
}

function autoText(fastn, content) {
    var text = fastn.base('text');

    text.render = autoRender.bind(text, content);

    return text;
}

function render(){
    this.element = this.createTextNode(this.text());
    this.emit('render');
};

function textComponent(type, fastn, settings, children){
    if(settings.auto){
        delete settings.auto;
        if(!fastn.isBinding(children[0])){
            return autoText(fastn, children[0]);
        }
        settings.text = children.pop();
    }

    var text = fastn.base(type, settings, children);

    text.createTextNode = textComponent.createTextNode;
    text.render = render.bind(text);

    text.text = fastn.property('', updateText.bind(text));

    return text;
}

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;