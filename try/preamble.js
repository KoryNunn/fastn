var fastn = require('./fastn'),
    CodeMirror = require('./codeMirror'),
    codeService = require('./code'),
    cpjax = require('cpjax');

module.exports = function(){

    // Create a standalong binding attached to a new private scope.
    var state = fastn.binding('state').attach();

    return fastn('div', {
            class: fastn.binding(state, function(state){
                return ['preamble', state ? 'expanded' : ''];
            })
        },
            fastn('span', 'Preamble (fastn setup)')
            .on('click', function(){
                state(true);
            })
        )
        .on('render', function(){
            var mirror = CodeMirror(this.element, {
                lineNumbers: true,
                readonly: true
            });

            cpjax('./fastn.js', function(error, data){
                mirror.setValue(data);
            });

            state.on('change', function(){
                mirror.refresh();
                mirror.focus();
            });

            mirror.on('blur', function(){
                state(false);
            });
        });
};