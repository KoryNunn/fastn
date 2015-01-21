var Enti = require('enti'),
    createBinding = require('./binding'),
    EventEmitter = require('events').EventEmitter;

module.exports = function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        resultBinding = createBinding('result').attach({}),
        attaching;

    function change(){
        if(attaching){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding, index){
        if(typeof binding === 'string'){
            binding = createBinding(binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
        resultBinding.on('attach', function(object){
            attaching = true;
            binding.attach(object, true);
            attaching = false;
            change();
        });
        resultBinding.on('detach', binding.detach);
    });

    return resultBinding;
};