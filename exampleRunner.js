var fastn = require('./fastn'),
    examples = require('./examples');

module.exports = function(url){
    var exampleCodeBinding = examples(url);

    return fastn('div', {
            class:'exampleOutput',
            code: exampleCodeBinding
        })
        .on('render', function(){
            var output = this;

            function run(){
                new Function('fastn', 'document', output.code())(fastn, {
                    body: output.element
                });
            }

            if(exampleCodeBinding()){
                run();
            }else{
                exampleCodeBinding.on('change', run);
            }
        });
};