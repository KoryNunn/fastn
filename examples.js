var fastn = require('./fastn'),
    examplesModel = new fastn.Model(),
    cpjax = require('cpjax');

exampleBindings = {};

module.exports = function(url){
    if(exampleBindings[url]){
        return exampleBindings[url];
    }
    var exampleBinding = fastn.binding(url.replace(/\./g, '-')).attach(examplesModel);

    cpjax(url, function(error, data){
        exampleBinding(error || data);
    });

    return exampleBindings[url] = exampleBinding;
};