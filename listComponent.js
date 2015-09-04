var Map = require('es6-map'),
    WeakMap = require('es6-weak-map'),
    MultiMap = require('multimap'),
    merge = require('flat-merge');

MultiMap.Map = Map;

function each(value, fn){
    if(!value || typeof value !== 'object'){
        return;
    }

    if(Array.isArray(value)){
        for(var i = 0; i < value.length; i++){
            fn(value[i], i)
        }
    }else{
        for(var key in value){
            fn(value[key], key);
        }
    }
}

function keyFor(object, value){
    if(!object || typeof object !== 'object'){
        return false;
    }

    if(Array.isArray(object)){
        var index = object.indexOf(value);
        return index >=0 ? index : false;
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
    settings.tagName = settings.tagName || 'div';

    var list;

    if(!fastn.components._generic){
        list = fastn.base(type, settings, children);
    }else{
        list = fastn.components._generic(type, fastn, settings, children);
    }

    var itemsMap = new MultiMap(),
        dataMap = new WeakMap(),
        lastTemplate,
        existingItem = {};

    function updateItems(){
        var value = list.items(),
            template = list.template(),
            emptyTemplate = list.emptyTemplate(),
            newTemplate = lastTemplate !== template;

        var currentItems = merge(template ? value : []);

        itemsMap.forEach(function(component, item){
            var currentKey = keyFor(currentItems, item);

            if(!newTemplate && currentKey !== false){
                currentItems[currentKey] = [existingItem, item, component];
            }else{
                removeComponent(component);
                itemsMap.delete(item);
            }
        });

        var index = 0;

        function updateItem(item, key){
            var child,
                existing;

            while(index < list._children.length && !list._children[index]._templated){
                index++;
            }

            if(Array.isArray(item) && item[0] === existingItem){
                existing = true;
                child = item[2];
                item = item[1];
            }

            var data;

            if(!existing){
                data = {
                    item: item,
                    key: key
                };

                child = fastn.toComponent(template(new fastn.Model(data), list.scope()));
                if(!child){
                    child = fastn('template');
                }
                child._listItem = item;
                child._templated = true;

                dataMap.set(child, data);
                itemsMap.set(item, child);
            }else{
                data = dataMap.get(child);
                fastn.Model.set(data, 'key', key);
            }

            if(fastn.isComponent(child) && list._settings.attachTemplates !== false){
                child.attach(data, 2);
            }

            list.insert(child, index);
            index++;
        }

        each(currentItems, updateItem);

        lastTemplate = template;

        if(index === 0 && emptyTemplate){
            var child = fastn.toComponent(emptyTemplate(list.scope()));
            if(!child){
                child = fastn('template');
            }
            child._templated = true;

            itemsMap.set({}, child);

            list.insert(child);
        }
    }

    function removeComponent(component){
        list.remove(component);
        component.destroy();
    }

    fastn.property([], settings.itemChanges || 'type keys shallowStructure')
        .addTo(list, 'items')
        .on('change', updateItems);

    fastn.property(undefined, 'value')
        .addTo(list, 'template')
        .on('change', updateItems);

    fastn.property(undefined, 'value')
        .addTo(list, 'emptyTemplate')
        .on('change', updateItems);

    return list;
};