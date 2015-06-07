var fastn = require('./fastn'),
    CodeMirror = require('codemirror'),
    codeService = require('./code');

module.exports = function(){
    return fastn('div', {
            class: fastn.binding(codeService.errors, function(errors){
                return ['code', errors ? 'hasError' : ''];
            })
        })
        .on('render', function(){
            var mirror = CodeMirror(this.element, {
                value: codeService.code(),
                mode: 'javascript'
            });

            mirror.on('change', function(event){
                codeService.code(mirror.getValue());
            });

            // Kinda dodgy.
            codeService.code.once('change', function(code){
                mirror.setValue(code);
            });
        });
};