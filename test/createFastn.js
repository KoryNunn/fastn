module.exports = function createFastn(){
    var genericComponent = require('../genericComponent'),
        textComponent = require('../textComponent');

    // dont do fancy requestAnimationFrame scheduling that is hard to test.
    genericComponent.updateProperty = function(generic, property, update){
        update();
    };

    genericComponent.createElement = function(tagName){
        if(tagName instanceof Node){
            return tagName;
        }
        return document.createElement(tagName);
    };

    textComponent.createTextNode = document.createTextNode.bind(document);

    return require('../')({
        _generic: genericComponent,
        list: require('../listComponent'),
        templater: require('../templaterComponent'),
        text: textComponent
    });
};