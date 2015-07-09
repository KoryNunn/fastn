function insertChild(fastn, container, child, index){
    var currentIndex = container._children.indexOf(child),
        newComponent = fastn.toComponent(child);

    if(!fastn.isComponent(child)){
        if(~currentIndex){
            container._children.splice(currentIndex, 1, newComponent);
        }
    }

    if(currentIndex !== index){
        if(~currentIndex){
            container._children.splice(currentIndex, 1);
        }
        container._children.splice(index, 0, newComponent);
    }

    if(container.getContainerElement() && !newComponent.element){
        newComponent.render();
    }

    newComponent.attach(container.scope(), 1);

    container._insert(newComponent.element, index);

    return container;
}

function getContainerElement(){
    return this.containerElement || this.element;
}

function insert(child, index){
    var component = child,
        container = this.container,
        fastn = this.fastn;

    if(index && typeof index === 'object'){
        component = Array.prototype.slice.call(arguments);
    }

    if(isNaN(index)){
        index = container._children.length;
    }

    if(Array.isArray(component)){
        component.forEach(function(component, i){
            container.insert(component, i + index);
        });
        return container;
    }

    insertChild(fastn, container, component, index);
}

module.exports = function(type, fastn, settings, children){
    var container = fastn.base(type, settings, children);

    container.insert = insert.bind({
        container: container,
        fastn: fastn
    });

    container._insert = function(element, index){
        var containerElement = container.getContainerElement();
        if(!containerElement){
            return;
        }

        if(containerElement.childNodes[index] === element){
            return;
        }

        containerElement.insertBefore(element, containerElement.childNodes[index]);
    };

    container.remove = function(component){
        var index = container._children.indexOf(component);
        if(~index){
            container._children.splice(index,1);
        }

        component.detach(1);

        if(component.element){
            container._remove(component.element);
        }
    };

    container._remove = function(element){
        var containerElement = container.getContainerElement();

        if(!element || !containerElement || element.parentNode !== containerElement){
            return;
        }

        containerElement.removeChild(element);
    };

    container.empty = function(){
        while(container._children.length){
            container._remove(container._children.pop().detach(1).element);
        }
    };

    container.getContainerElement = getContainerElement.bind(container);

    container.on('render', function(){
        container.insert(container._children, 0);
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