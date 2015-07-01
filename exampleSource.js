var fastn = require('./fastn'),
    highlight = require('./highlight'),
    laidout = require('laidout'), 
    examples = require('./examples');

module.exports = function(url){
    var exampleCodeBinding = examples(url);
    return fastn('pre', exampleCodeBinding).on('render', function(){
        var element = this.element;

        if(exampleCodeBinding()){
            highlight(element);
        }else{
            exampleCodeBinding.on('change', function(){
                highlight(element);
            });
        }
    });
};