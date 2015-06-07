var fastn = require('./fastn'),
    CodeMirror = require('./codeMirror'),
    laidout = require('laidout'),
    codeService = require('./code');

module.exports = function(){
    return fastn('div',
            {
                class: fastn.binding(codeService.errors, function(errors){
                    return ['code', errors ? 'hasError' : ''];
                })
            },
            require('./preamble')()
        )
        .on('render', function(){
            var mirror = CodeMirror(this.element, {
                lineNumbers: true,
                value: codeService.code()
            });

            mirror.on('change', function(event){
                codeService.code(mirror.getValue());
            });

            codeService.code.on('change', function(code){
                if(mirror.getValue() !== code){
                    mirror.setValue(code);
                }
            });

            // CodeMirror does not render correctly when setup out-of-document :/
            laidout(this.element, function(){
                mirror.refresh();
            });
        });
};