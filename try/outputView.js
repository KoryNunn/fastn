var fastn = require('./fastn'),
    codeService = require('./code');

module.exports = function(){
    var outputComponent = fastn('div', {class: 'output'});

    function update(result){
        outputComponent.empty();
        outputComponent.insert(result);
    }

    codeService.result.on('change', update);

    update(codeService.result() || 'No output..');

    return outputComponent;
};