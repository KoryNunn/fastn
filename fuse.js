var Enti = require('enti'),
    createBinding = require('./binding'),
    EventEmitter = require('events').EventEmitter;

module.exports = function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        resultBinding = createBinding('result').attach({});

    function change(){
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding){
        binding.on('change', change);
        resultBinding.on('attach', binding.attach);
        resultBinding.on('detach', binding.detach);
    });

    return resultBinding;
};