module.exports = function createFastn(){
    return require('../')({
            _generic: require('../genericComponent'),
            list: require('../listComponent'),
            templater: require('../templaterComponent'),
            text: require('../textComponent')
        });
};