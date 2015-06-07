var fastn = require('./fastn'),
    cpjax = require('cpjax'),
    codeModel = {
        code: ''
    },
    result = fastn.binding('result').attach(codeModel),
    errors = fastn.binding('errors').attach(codeModel),
    code = fastn.binding('code').attach(codeModel)
        .on('change', function(code){
            try{
                var resultComponent = new Function('fastn', code)(fastn);
                result(resultComponent);
                errors(null);
            }catch(error){
                errors(error);
            }
        });

cpjax('./demo.js', function(error, data){
    if(error){
        errors(error);
        return;
    }
    code(data);
});

module.exports = {
    codeModel: codeModel,
    code: code,
    result: result,
    errors: errors
};