var crel = require('crel'),
    WM = require('./weakmap'),
    containerComponent = require('./containerComponent');

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

function keyFor(object, value){
    if(!object || typeof object !== 'object'){
        return false;
    }

    for(var key in object){
        if(object[key] === value){
            return key;
        }
    }

    return false;
}

function values(object){
    if(Array.isArray(object)){
        return object.slice();
    }

    var result = [];

    for(var key in object){
        result.push(object[key]);
    }

    return result;
}

module.exports = function(type, fastn, settings, children){
    var list = containerComponent(type, fastn);
        lastItems = [],
        lastComponents = [];

    function updateItems(value){
        var template = list._settings.template;
        if(!template){
            return;
        }

        var currentItems = values(value);

        for(var i = 0; i < lastItems.length; i++){
            var item = lastItems[i],
                component = lastComponents[i],
                currentIndex = currentItems.indexOf(item);

            if(~currentIndex){
                currentItems.splice(currentIndex,1);
            }else{
                lastItems.splice(i, 1);
                lastComponents.splice(i, 1);
                i--;
                component.emit('destroy');
                if(component.element && component.element.parentNode === list.element){
                    list.remove(component);
                }
            }
        }

        var index = 0,
            newItems = [],
            newComponents = [];

        each(value, function(item){
            var child,
                key = keyFor(lastItems, item);

            if(key === false){
                child = fastn.apply(fastn, [template._type, template._settings].concat(template._children));

                if(item && typeof item === 'object'){
                    child.attach(item);
                }else{
                    child.attach({
                        item: item,
                        key: key  
                    });
                }
                
                newItems.push(item);
                newComponents.push(child);
            }else{
                newItems.push(lastItems[key]);
                lastItems.splice(key,1)

                child = lastComponents[key];
                lastComponents.splice(key,1);
                newComponents.push(child);
            }

            list.insert(child, index);

            index++;
        });

        lastItems = newItems;
        lastComponents = newComponents;
    }

    list.render = function(){
        this.element = crel('div');
        this.on('items', updateItems);
        updateItems(this.items());
        this.emit('render');
    };

    fastn.property(list, 'items');

    return list;
};