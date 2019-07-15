var fastn = require('./fastn'),
    cpjax = require('cpjax'),
    debounce = require('debounce'),
    lzutf8 = require('lzutf8'),
    compressionSuffix = '-lzutf8',
    defaultCode,
    codeModel = {
        code: ''
    },
    result = fastn.binding('result').attach(codeModel),
    errors = fastn.binding('errors').attach(codeModel),
    requireModule = require('./requireModule')(window),
    code = fastn.binding('code').attach(codeModel)
    .on('change', debounce(function(code){
        var outputElement = document.createElement('div');

        function run(){
            try {
                var outputComponent = new Function('fastn', 'document', 'require', code)(fastn, {
                    body: outputElement
                }, requireModule.require);
                result(outputComponent || outputElement);
                errors(null);
            } catch (error) {
                if(error.message && error.message.includes(requireModule.MODULE_NOT_LOADED)){
                    setTimeout(run, 200);
                    errors(error.message.replace(requireModule.MODULE_NOT_LOADED, 'loading'));
                    return;
                }

                errors(error);
            }
        }

        run();

        var stringifiedCode = JSON.stringify(code);

        localStorage.setItem('fastnTryCode', stringifiedCode);
        window.location.hash = '#' + lzutf8.compress(stringifiedCode, {outputEncoding: 'Base64'}) + compressionSuffix;
    }, 300));

var storedCode;

function loadFromHash(){
    try{
        var hashSource = window.location.hash.slice(1);
        if(hashSource.slice(-compressionSuffix.length) === compressionSuffix){
            hashSource = lzutf8.decompress(hashSource.slice(0, -compressionSuffix.length), {inputEncoding: 'Base64', outputEncoding: 'String'});
        }else{
            hashSource = atob(window.location.hash.slice(1));
        }
        hashSource = JSON.parse(hashSource);

        if(hashSource !== code()){
            code(hashSource);
        }
    }catch(e){}
}

window.addEventListener('hashchange', loadFromHash);
loadFromHash();

try{
    storedCode = JSON.parse(localStorage.getItem('fastnTryCode'));
}catch(e){}

code(storedCode || '');

cpjax('./demo.js', function(error, data){
    if(error){
        errors(error);
        return;
    }
    if(!storedCode){
        code(data);
    }
    defaultCode = data;
});

module.exports = {
    codeModel: codeModel,
    code: code,
    result: result,
    errors: errors,
    reset: function(){
        code(defaultCode);
    }
};