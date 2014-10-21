var crel = require('crel'),
    WM = require('./weakmap'),
    EventEmitter = require('events').EventEmitter;

function each(value, fn){
    if(!value || typeof value !== 'object'){
        return;
    }

    var isArray = Array.isArray(value);

    for(var key in value){
        if(isArray && isNaN(key)){
            continue;
        }

        fn(value[key], key);
    }
}

function contains(object, value){
    if(!value || typeof value !== 'object'){
        return;
    }

    for(var key in object){
        if(object[key] === value){
            return true;
        }
    }
}

module.exports = function(fastn, settings, children){
    var list = new EventEmitter(),
        currentItems = [],
        childComponents = [];
        itemsMap = new WM();

    function updateItems(value){
        var template = list._settings.template;
        if(!template){
            return;
        }

        each(currentItems, function(item, index){
            if(!contains(value, item)){
                currentItems.splice(index, 1);
                var oldComponent = childComponents[index];
                childComponents.splice(index, 1);
                oldComponent.emit('destroy');
                if(oldComponent.element && oldComponent.element.parentNode === list.element){
                    list.element.removeChild(oldComponent.element);
                }
            }
        })

        var index = 0;
        each(value, function(item){
            var newChild;

            if(!itemsMap.has(item)){
                newChild = fastn.apply(fastn, [template.type, template._settings].concat(template._children);
                itemsMap.set(item, newChild);
            }else{
                newChild = itemsMap.get(item);
            }

            list.insert(newChild, index);

            index++;
        });

        if(value !== list.element.value){
            list.element.value = value == null ? '' : value;
        }
    }

    list.render = function(){
        this.element = document.createDocumentFragment();
        this.on('items', updateItems);
        updateItems(this.value());
        this.emit('render');
    };

    fastn.property(list, 'items');

    return list;
};