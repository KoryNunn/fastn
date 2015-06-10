module.exports = function createFastn(){
    var genericComponent = require('../genericComponent');

    genericComponent.schedule = function(key, fn){
        fn();
    };

    return require('../')({
            _generic: require('../genericComponent'),
            list: require('../listComponent'),
            templater: require('../templaterComponent'),
            text: require('../textComponent')
        });
};