var Enti = require('enti');    

module.exports = function property(component, propertyName, transform){
    var binding;

    component.on('update', function(){
        property._update();
    });
    component.on('attach', function(object){
        if(binding){
            binding.attach(object, true);
        }
    });

    function property(newValue){
        if(binding){
            binding(newValue);
            component.emit(propertyName, binding());
            return;
        }
        component.emit(propertyName, newValue);
    }

    property.attach = function(newBinding){
        if(binding){
            binding.removeListener(property);
        }
        binding = newBinding;
        binding.on('change', property);
        property._update();
    };
    property.detach = function(){
        binding = null;
        property._update();
    };
    property._update = function(){
        var value;

        if(binding){
            value = binding();
        }

        component.emit(propertyName, value);
    };
    property._fastn_property = true;

    component[propertyName] = property;
};