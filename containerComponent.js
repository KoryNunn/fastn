var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn){
    var container = new EventEmitter();

    container.insert = function(component, index){
        if(crel.isNode(component)){
            var element = component;
            component = new EventEmitter();
            component.element = element;
        }

        if(isNaN(index)){
            index = container._children.length;
        }
        var currentIndex = container._children.indexOf(component);
        if(currentIndex !== index){
            if(~currentIndex){
                container._children.splice(currentIndex, 1);
            }
            container._children.splice(index, 0, component);
        }

        if(container.element && !component.element){
            component.render();
        }

        component.attach(container.scope(), 1);
        
        container._insert(component.element, index);

        return container;
    };

    container._insert = function(element, index){
        if(!container.element){
            return;
        }
        
        container.element.insertBefore(element, container.element.childNodes[index]);
    };

    container.remove = function(component){
        var index = container._children.indexOf(component);
        if(~index){
            container._children.splice(index,1);
        }

        if(component.element){
            container._remove(component.element);
        }
    };

    container._remove = function(element){
        if(!element || !container.element || element.parentNode !== container.element){
            return;
        }
        container.element.removeChild(element);
    }

    container.on('render', function(){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i]) && !container._children[i].element){
                container._children[i].render();
            }

            container._insert(container._children[i].element);
        }
    });

    container.on('attach', function(data, loose){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].attach(data, loose);
            }
        }
    });

    container.on('destroy', function(data, loose){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].destroy();
            }
        }
    });

    return container;
};