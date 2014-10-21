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
        this._children.splice(index, 0, component);
        this._insert(component.element, index);
    };

    container._insert = function(element, index){
        if(this.element){
            this.element.insertBefore(element, this.element.childNodes[index-1]);
        }
    };

    container.on('render', function(){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].render();
            }

            container._insert(container._children[i].element);
        }
    });

    container.on('attach', function(data){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].attach(data);
            }
        }
    });

    return container;
};