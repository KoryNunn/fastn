var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn){
    var container = new EventEmitter();

    container.insert = function(component, index){
        if(index && typeof index === 'object'){
            component = Array.prototype.slice.call(arguments);
        }

        if(Array.isArray(component)){
            component.forEach(container.insert);
            return container;
        }

        if(crel.isNode(component)){
            var element = component;
            component = fastn(component.tagName);
            component.element = element;
        }

        var currentIndex = container._children.indexOf(component);

        if(!is.component(component)){
            component = fastn('text', {
                text: component
            });

            if(~currentIndex){
                container._children.splice(currentIndex, 1, component);
            }
        }

        if(isNaN(index)){
            index = container._children.length;
        }
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

    var x = 0;

    container._insert = function(element, index){
        if(!container.element){
            return;
        }

        if(container.element.childNodes[index] === element){
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
        container.insert(container._children);
    });

    container.on('attach', function(data, firm){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].attach(data, firm);
            }
        }
    });

    container.on('destroy', function(data, firm){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].destroy(firm);
            }
        }
    });

    return container;
};