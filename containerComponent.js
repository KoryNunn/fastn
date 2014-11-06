var crel = require('crel'),
    EventEmitter = require('events').EventEmitter;

module.exports = function(type, fastn){
    var container = new EventEmitter();

    container.insert = function(component, index){
        if(crel.isNode(component)){
            var element = component;
            component = new EventEmitter();
            component.element = element;
        }

        if(isNaN(index)){
            index = this._children.length;
        }
        var currentIndex = this._children.indexOf(component);
        if(~currentIndex){
            this._children.splice(currentIndex, 1);
        }
        this._children.splice(index, 0, component);

        if(this.element && !component.element){
            component.render();
        }
        this._insert(component.element, index);
    };

    container._insert = function(element, index){
        if(this.element){
            this.element.insertBefore(element, this.element.childNodes[index]);
        }
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
        if(!element || !container.element || !element.parentNode === container.element){
            return;
        }
        container.element.removeChild(element);
    }

    container.on('render', function(){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].render();
            }

            container._insert(container._children[i].element);
        }
    });

    container.on('attach', function(data, type){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].attach(data, type === true ? 'parent' : type);
            }
        }
    });

    return container;
};