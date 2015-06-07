var fastn = require('./fastn'),
    codeService = require('./code');

module.exports = function(){
    var outputComponent = fastn('div', {class: 'output'});

    codeService.result.on('change', function(result){
        outputComponent.empty();
        outputComponent.insert(result);
    });

    return outputComponent;
};