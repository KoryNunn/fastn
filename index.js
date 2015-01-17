var merge = require('flat-merge'),
    createComponent = require('./component'),
    createProperty = require('./property'),
    createBinding = require('./binding');
    fuseBinding = require('./fuse');
    is = require('./is');

module.exports = function(components){

    function fastn(type){
        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2;

        if(is.component(args[1])){
            childrenIndex--;
            settings = null;
        }

        return createComponent(type, fastn, settings, args.slice(childrenIndex), components);
    }

    fastn.property = createProperty;

    fastn.binding = createBinding;

    fastn.fuse = fuseBinding;

    fastn.isComponent = is.component;
    fastn.isBinding = is.binding;
    fastn.isBindingObject = is.bindingObject;
    fastn.isProperty = is.property;

    return fastn;
};