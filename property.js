var Enti = require('enti'),
    is = require('./is');

function getInitialBindingsAndUpdater(args){
    var bindingsIndex = 0,
        bindingsEndIndex = args
}

module.exports = function property(){
    var firstBindingIndex = is.binding(arguments[0]) ? 0 : 1,
        lastBindingIndex = arguments.length - is.binding(arguments[arguments.length - 1]) ? 2 : 1,
        currentValue = arguments[firstBindingIndex - 1],
        bindings = Array.prototype.slice.call(arguments, firstBindingIndex, lastBindingIndex);

    function defaultGetSet(value){
        if(!arguments.length){
            return bindings[0] && bindings[0]() || currentValue;
        }

        currentValue = value;
        bindings[0] && bindings[0](value);
    }

    function property(){
        var result = defaultGetSet.call(this, arguments);

        if(arguments.length){
            this.emit('change', result);
        }

        return this;
    }

    property.attach = function(object){
        bindings.forEach(function(binding){
            binding.attach(object);
            binding.on('change', property);
        });
        property.update();
    };
    property.detach = function(){
        bindings.forEach(function(binding){
            binding.removeListener('change', property);
        });
        property.update();
    };
    property.update = function(){
        property.emit('update');
    };
    property._fastn_property = true;

    return property;
};