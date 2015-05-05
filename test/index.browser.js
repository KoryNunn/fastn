(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Enti = require('enti'),
    is = require('./is'),
    firmer = require('./firmer'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    same = require('same-value');

function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        updateTransform,
        resultBinding = createBinding('result'),
        selfChanging;

    if(typeof bindings[bindings.length-1] === 'function' && !is.binding(bindings[bindings.length-1])){
        updateTransform = transform;
        transform = bindings.pop();
    }

    resultBinding._model._events = {};
    resultBinding._set = function(value){
        if(updateTransform){
            selfChanging = true;
            var newValue = updateTransform(value);
            if(!same(newValue, bindings[0]())){
                bindings[0](newValue);
                resultBinding._change(newValue);
            }
            selfChanging = false;
        }else{
            resultBinding._change(value);
        }
    };

    function change(){
        if(selfChanging){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding, index){
        if(typeof binding === 'string'){
            binding = createBinding(binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
        resultBinding.on('detach', binding.detach);
    });

    var lastAttached;
    resultBinding.on('attach', function(object){
        selfChanging = true;
        bindings.forEach(function(binding){
            binding.attach(object, 1);
        });
        selfChanging = false;
        if(lastAttached !== object){
            change();
        }
        lastAttached = object;
    });

    return resultBinding;
}

function createBinding(keyAndFilter){
    if(arguments.length > 1){
        return fuseBinding.apply(null, arguments);
    }

    if(keyAndFilter == null){
        throw "bindings must be created with a key (and or filter)";
    }

    var keyAndFilterParts = (keyAndFilter + '').split('|'),
        key = keyAndFilterParts[0],
        filter = keyAndFilterParts[1] ? ((key === '.' ? '' : key + '.') + keyAndFilterParts[1]) : key;

    if(filter === '.'){
        filter = '*';
    }

    var value,
        binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        if(key === '.'){
            return;
        }

        binding._set(newValue);
    };
    makeFunctionEmitter(binding);
    binding.setMaxListeners(10000);
    binding._model = new Enti(false);
    binding._fastn_binding = key;
    binding._firm = 1;
    binding._model._events = {};

    binding.attach = function(object, firm){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(firmer(binding, firm)){
            return binding;
        }

        binding._firm = firm;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding._model.get('.') === object){
            return binding;
        }

        binding._model.attach(object);
        binding._change(binding._model.get(key));
        binding.emit('attach', object, 1);
        return binding;
    };
    binding.detach = function(firm){
        if(firmer(binding, firm)){
            return binding;
        }

        value = undefined;
        binding._model.detach();
        binding.emit('detach', 1);
        return binding;
    };
    binding._set = function(newValue){
        if(same(binding._model.get(key), newValue)){
            return;
        }
        if(!binding._model.isAttached()){
            binding._model.attach(binding._model.get('.'));
        }
        binding._model.set(key, newValue);
    };
    binding._change = function(newValue){
        value = newValue;
        binding.emit('change', binding());
    };
    binding.clone = function(){
        return createBinding.apply(null, args);
    };
    binding.destroy = function(soft){
        if(binding._destroyed){
            return;
        }
        if(soft && (!binding._events || binding._events.change)){
            return;
        }
        binding._destroyed = true;
        binding.emit('destroy');
        binding.detach();
        binding._model.destroy();
    };

    binding._model._events[filter] = function(){
        binding._change(binding._model.get(key));
    };

    return binding;
}

module.exports = createBinding;
},{"./firmer":4,"./is":7,"./makeFunctionEmitter":9,"enti":16,"same-value":169}],2:[function(require,module,exports){
var Enti = require('enti'),
    createBinding = require('./binding'),
    is = require('./is');

function dereferenceSettings(settings){
    var result = {},
        keys = Object.keys(settings);

    for(var i = 0; i < keys.length; i++){
        var key = keys[i];
        result[key] = settings[key];
        if(is.bindingObject(result[key])){
            result[key] = fastn.binding(
                result[key]._fastn_binding,
                result[key]._defaultValue,
                result[key].transform
            );
        }
    }

    return result;
}

function flatten(item){
    return Array.isArray(item) ? item.reduce(function(result, element){
        if(element == null){
            return result;
        }
        return result.concat(flatten(element));
    },[]) : item;
}

function forEachProperty(component, call, args){
    var keys = Object.keys(component);

    for(var i = 0; i < keys.length; i++){
        var property = component[keys[i]];

        if(!is.property(property)){
            continue;
        }

        property[call].apply(null, args);
    }
}

function inflateProperties(component, settings){
    for(var key in settings){
        if(is.property(settings[key])){
            component[key] = settings[key];
        }else if(is.property(component[key])){
            if(is.binding(settings[key])){
                component[key].binding(settings[key]);
            }else{
                component[key](settings[key]);
            }
            component[key].addTo(component, key);
        }
    }
}

module.exports = function createComponent(type, fastn, settings, children, components){
    var component,
        binding,
        scope = new Enti(false);

    settings = dereferenceSettings(settings || {});
    children = flatten(children);

    if(!(type in components)){
        if(!('_generic' in components)){
            throw 'No component of type "' + type + '" is loaded';
        }
        component = components._generic(type, fastn, settings, children);
    }else{
        component = components[type](type, fastn, settings, children);
    }

    if(is.component(component)){
        // The component constructor returned a ready-to-go component.
        return component;
    }

    component._type = type;
    component._settings = settings;
    component._fastn_component = true;
    component._children = children;

    component.attach = function(object, firm){
        binding.attach(object, firm);
        return component;
    };

    component.detach = function(firm){
        binding.detach(firm);
        component.emit('detach', 1);
        return component;
    };

    component.scope = function(){
        return scope;
    };

    component.destroy = function(){
        if(component._destroyed){
            return;
        }
        component._destroyed = true;
        component.emit('destroy');
        component.element = null;
        scope.destroy();
        binding.destroy();
        return component;
    };

    var lastBound;
    function emitAttach(){
        var newBound = binding();
        if(newBound !== lastBound){
            lastBound = newBound;
            scope.attach(lastBound);
            component.emit('attach', lastBound, 1);
        }
    }

    component.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(!is.binding(newBinding)){
            newBinding = createBinding(newBinding);
        }

        if(binding){
            newBinding.attach(binding.model, binding._firm);
            binding.removeListener('change', emitAttach);
        }

        binding = newBinding;

        binding.on('change', emitAttach);
        emitAttach(binding());

        return component;
    };

    component.clone = function(){
        return createComponent(component._type, fastn, component._settings, component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return child.clone();
        }), components);
    };

    component.children = function(){
        return component._children.slice();
    };

    inflateProperties(component, settings);

    component.on('attach', function(){
        forEachProperty(component, 'attach', arguments);
    });
    component.on('render', function(){
        forEachProperty(component, 'update', arguments);
    });
    component.on('detach', function(){
        forEachProperty(component, 'detach', arguments);
    });
    component.once('destroy', function(){
        forEachProperty(component, 'destroy', arguments);
    });

    var defaultBinding = createBinding('.');
    defaultBinding._default_binding = true;

    component.binding(defaultBinding);

    if(fastn.debug){
        component.on('render', function(){
            if(component.element && typeof component.element === 'object'){
                component.element._component = component;
            }
        });
    }

    return component;
};

},{"./binding":1,"./is":7,"enti":16}],3:[function(require,module,exports){
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

        var currentIndex = container._children.indexOf(component),
            newComponent = fastn.toComponent(component);

        if(!is.component(component)){
            if(~currentIndex){
                container._children.splice(currentIndex, 1, newComponent);
            }
        }

        if(isNaN(index)){
            index = container._children.length;
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
    };

    var x = 0;

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
    }

    container.empty = function(){
        while(container._children.length){
            container._remove(container._children.pop().detach(1).element);
        }
    };

    container.getContainerElement = function(){
        return container.containerElement || container.element;
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
},{"./is":7,"crel":10,"events":207}],4:[function(require,module,exports){
// Is the entity firmer than the new firmness
module.exports = function(entity, firm){
    if(firm != null && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
}
},{}],5:[function(require,module,exports){
var crel = require('crel'),
    containerComponent = require('./containerComponent');

var fancyProps = {
    disabled: function(element, value){
        if(arguments.length === 1){
            return element.hasAttribute('disabled');
        }
        if(value){
            element.setAttribute('disabled', 'disabled');
        }else{
            element.removeAttribute('disabled');
        }
    },
    textContent: function(element, value){
        if(arguments.length === 1){
            return element.textContent;
        }
        element.textContent = (value == null ? '' : value);
    },
    value: function(element, value){
        if(element.nodeName === 'INPUT' && element.type === 'date'){
            if(arguments.length === 1){
                return new Date(element.value);
            }
            value = new Date(value);
            if(isNaN(value)){
                element.value = null;
            }else{
                element.value = (value.toJSON() + '').split('T').shift();
            }
            return;
        }

        if(arguments.length === 1){
            return element.value;
        }
        if(value === undefined){
            value = null;
        }
        element.value = value;
    }
};

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && setting;

    if(typeof value === 'function'){
        return;
    }

    if(!property){
        property = fastn.property();
        property(value);
        property.on('update', function(value){
            var element = generic.getContainerElement();

            if(!element){
                return;
            }

            var isProperty = key in element,
                fancyProp = fancyProps[key],
                previous = fancyProp ? fancyProp(element) : isProperty ? element[key] : element.getAttribute(key);

            if(!fancyProp && !isProperty && value == null){
                value = '';
            }

            if(value !== previous){
                if(fancyProp){
                    fancyProp(element, value);
                    return;
                }

                if(isProperty){
                    element[key] = value;
                    return;
                }

                if(typeof value !== 'function' && typeof value !== 'object'){
                    element.setAttribute(key, value);
                }
            }
        });
    }

    if(binding){
        property.binding(binding);
    }

    property.addTo(generic, key);
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        createProperty(fastn, generic, key, settings);
    }
}

function addUpdateHandler(generic, eventName, settings){
    var element = generic.getContainerElement(),
        handler = function(event){
            generic.emit(eventName, event, generic.scope());
        };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function addAutoHandler(generic, key, settings){
    if(!settings[key]){
        return;
    }

    var element = generic.getContainerElement(),
        autoEvent = settings[key].split(':'),
        eventName = key.slice(2);

    delete settings[key];

    var handler = function(event){
        var fancyProp = fancyProps[autoEvent[1]],
            value = fancyProp ? fancyProp(element) : element[autoEvent[1]];

        generic[autoEvent[0]](value);
    };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

module.exports = function(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        generic.element = crel(type);

        generic.emit('render');

        return generic;
    };

    generic.on('render', function(){
        var element = generic.getContainerElement();

        for(var key in settings){
            if(key.slice(0,2) === 'on' && key in element){
                addAutoHandler(generic, key, settings);
            }
        }

        for(var key in generic._events){
            if('on' + key.toLowerCase() in element){
                addUpdateHandler(generic, key);
            }
        }
    });

    return generic;
};
},{"./containerComponent":3,"crel":10}],6:[function(require,module,exports){
var merge = require('flat-merge'),
    createComponent = require('./component'),
    createProperty = require('./property'),
    createBinding = require('./binding'),
    crel = require('crel'),
    is = require('./is');

module.exports = function(components, debug){

    function fastn(type){
        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2;

        if(is.component(args[1]) || Array.isArray(args[1]) || typeof args[1] !== 'object' || !args[1]){
            childrenIndex--;
            settings = null;
        }

        return createComponent(type, fastn, settings, args.slice(childrenIndex), components);
    }

    fastn.debug = debug;

    fastn.property = createProperty;

    fastn.binding = createBinding;

    fastn.toComponent = function(component){
        if(is.component(component)){
            return component;
        }
        if(typeof component !== 'object'){
            return fastn('text', {text: component});
        }
        if(crel.isElement(component)){
            return fastn(component);
        }
        if(crel.isNode(component)){
            return fastn('text', {text: component.textContent});
        }
    };

    fastn.isComponent = is.component;
    fastn.isBinding = is.binding;
    fastn.isDefaultBinding = is.defaultBinding;
    fastn.isBindingObject = is.bindingObject;
    fastn.isProperty = is.property;

    return fastn;
};
},{"./binding":1,"./component":2,"./is":7,"./property":187,"crel":10,"flat-merge":168}],7:[function(require,module,exports){

function isComponent(thing){
    return thing && typeof thing === 'object' && '_fastn_component' in thing;
}

function isBindingObject(thing){
    return thing && typeof thing === 'object' && '_fastn_binding' in thing;
}

function isBinding(thing){
    return thing && typeof thing === 'function' && '_fastn_binding' in thing;
}

function isProperty(thing){
    return thing && typeof thing === 'function' && '_fastn_property' in thing;
}

function isDefaultBinding(thing){
    return thing && typeof thing === 'function' && '_fastn_binding' in thing && '_default_binding' in thing;
}

module.exports = {
    component: isComponent,
    bindingObject: isBindingObject,
    binding: isBinding,
    defaultBinding: isDefaultBinding,
    property: isProperty
};
},{}],8:[function(require,module,exports){
var crel = require('crel'),
    Enti = require('enti'),
    Map = require('es6-map'),
    genericComponent = require('./genericComponent');

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
    var list = genericComponent(type, fastn, settings, children),
        itemsMap = new Map();

    function updateItems(value){
        var template = list._settings.template;
        if(!template){
            return;
        }

        var items = values(value);
            currentItems = items.slice();

        itemsMap.forEach(function(component, item){
            var currentIndex = currentItems.indexOf(item);

            if(~currentIndex){
                currentItems.splice(currentIndex,1);
            }else{
                list.removeItem(item, itemsMap);
            }
        });

        var index = 0,
            newItems = [],
            newComponents = [];

        each(value, function(item, key){
            while(index < list._children.length && list._children[index]._templated && !~items.indexOf(list._children[index]._listItem)){
                index++
            }

            var child,
                model = new Enti({
                    item: item,
                    key: key
                });

            if(!itemsMap.has(item)){
                child = fastn.toComponent(template(model, list.scope()));
                child._listItem = item;
                child._templated = true;

                itemsMap.set(item, child);
            }else{
                child = itemsMap.get(item);
            }

            if(fastn.isComponent(child) && list._settings.attachTemplates !== false){
                child.attach(model, 2);
            }

            list.insert(child, index);
            index++;
        });
    }

    list.removeItem = function(item, itemsMap){
        var component = itemsMap.get(item)
        list.remove(component);
        component.destroy();
        itemsMap.delete(item);
    }

    list.render = function(){
        this.element = crel(settings.tagName || 'div');
        this.emit('render');
    };

    fastn.property([], settings.itemChanges || 'structure')
        .addTo(list, 'items')
        .binding(settings.items)
        .on('update', updateItems);

    return list;
};
},{"./genericComponent":5,"crel":10,"enti":16,"es6-map":113}],9:[function(require,module,exports){
/**

    This function is used to add EventEmitter methods to functions,
    which cannot be added in the usual, Constructor.prototype fassion.

*/

var EventEmitter = require('events').EventEmitter;

var functionEmitterPrototype = function(){};
for(var key in EventEmitter.prototype){
    functionEmitterPrototype[key] = EventEmitter.prototype[key];
}

module.exports = function makeFunctionEmitter(object){
    if(Object.setPrototypeOf){
        Object.setPrototypeOf(object, functionEmitterPrototype);
    }else if(__proto__ in object){
        object.__proto__ = functionEmitterPrototype;
    }else{
        for(var key in functionEmitterPrototype){
            object[key] = functionEmitterPrototype[key];
        }
    }
};
},{"events":207}],10:[function(require,module,exports){
//Copyright (C) 2012 Kory Nunn

//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/*

    This code is not formatted for readability, but rather run-speed and to assist compilers.

    However, the code's intention should be transparent.

    *** IE SUPPORT ***

    If you require this library to work in IE7, add the following after declaring crel.

    var testDiv = document.createElement('div'),
        testLabel = document.createElement('label');

    testDiv.setAttribute('class', 'a');
    testDiv['className'] !== 'a' ? crel.attrMap['class'] = 'className':undefined;
    testDiv.setAttribute('name','a');
    testDiv['name'] !== 'a' ? crel.attrMap['name'] = function(element, value){
        element.id = value;
    }:undefined;


    testLabel.setAttribute('for', 'a');
    testLabel['htmlFor'] !== 'a' ? crel.attrMap['for'] = 'htmlFor':undefined;



*/

(function (root, factory) {
    if (typeof exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        root.crel = factory();
    }
}(this, function () {
    var fn = 'function',
        obj = 'object',
        nodeType = 'nodeType',
        textContent = 'textContent',
        setAttribute = 'setAttribute',
        attrMapString = 'attrMap',
        isNodeString = 'isNode',
        isElementString = 'isElement',
        d = typeof document === obj ? document : {},
        isType = function(a, type){
            return typeof a === type;
        },
        isNode = typeof Node === fn ? function (object) {
            return object instanceof Node;
        } :
        // in IE <= 8 Node is an object, obviously..
        function(object){
            return object &&
                isType(object, obj) &&
                (nodeType in object) &&
                isType(object.ownerDocument,obj);
        },
        isElement = function (object) {
            return crel[isNodeString](object) && object[nodeType] === 1;
        },
        isArray = function(a){
            return a instanceof Array;
        },
        appendChild = function(element, child) {
          if(!crel[isNodeString](child)){
              child = d.createTextNode(child);
          }
          element.appendChild(child);
        };


    function crel(){
        var args = arguments, //Note: assigned to a variable to assist compilers. Saves about 40 bytes in closure compiler. Has negligable effect on performance.
            element = args[0],
            child,
            settings = args[1],
            childIndex = 2,
            argumentsLength = args.length,
            attributeMap = crel[attrMapString];

        element = crel[isElementString](element) ? element : d.createElement(element);
        // shortcut
        if(argumentsLength === 1){
            return element;
        }

        if(!isType(settings,obj) || crel[isNodeString](settings) || isArray(settings)) {
            --childIndex;
            settings = null;
        }

        // shortcut if there is only one child that is a string
        if((argumentsLength - childIndex) === 1 && isType(args[childIndex], 'string') && element[textContent] !== undefined){
            element[textContent] = args[childIndex];
        }else{
            for(; childIndex < argumentsLength; ++childIndex){
                child = args[childIndex];

                if(child == null){
                    continue;
                }

                if (isArray(child)) {
                  for (var i=0; i < child.length; ++i) {
                    appendChild(element, child[i]);
                  }
                } else {
                  appendChild(element, child);
                }
            }
        }

        for(var key in settings){
            if(!attributeMap[key]){
                element[setAttribute](key, settings[key]);
            }else{
                var attr = attributeMap[key];
                if(typeof attr === fn){
                    attr(element, settings[key]);
                }else{
                    element[setAttribute](attr, settings[key]);
                }
            }
        }

        return element;
    }

    // Used for mapping one kind of attribute to the supported version of that in bad browsers.
    crel[attrMapString] = {};

    crel[isElementString] = isElement;

    crel[isNodeString] = isNode;

    return crel;
}));

},{}],11:[function(require,module,exports){
var doc = {
    document: typeof document !== 'undefined' ? document : null,
    setDocument: function(d){
        this.document = d;
    }
};

var arrayProto = [],
    isList = require('./isList'),
    getTargets = require('./getTargets')(doc.document),
    getTarget = require('./getTarget')(doc.document),
    space = ' ';


///[README.md]

function isIn(array, item){
    for(var i = 0; i < array.length; i++) {
        if(item === array[i]){
            return true;
        }
    }
}

/**

    ## .find

    finds elements that match the query within the scope of target

        //fluent
        doc(target).find(query);

        //legacy
        doc.find(target, query);
*/

function find(target, query){
    target = getTargets(target);
    if(query == null){
        return target;
    }

    if(isList(target)){
        var results = [];
        for (var i = 0; i < target.length; i++) {
            var subResults = doc.find(target[i], query);
            for(var j = 0; j < subResults.length; j++) {
                if(!isIn(results, subResults[j])){
                    results.push(subResults[j]);
                }
            }
        }
        return results;
    }

    return target ? target.querySelectorAll(query) : [];
}

/**

    ## .findOne

    finds the first element that matches the query within the scope of target

        //fluent
        doc(target).findOne(query);

        //legacy
        doc.findOne(target, query);
*/

function findOne(target, query){
    target = getTarget(target);
    if(query == null){
        return target;
    }

    if(isList(target)){
        var result;
        for (var i = 0; i < target.length; i++) {
            result = findOne(target[i], query);
            if(result){
                break;
            }
        }
        return result;
    }

    return target ? target.querySelector(query) : null;
}

/**

    ## .closest

    recurses up the DOM from the target node, checking if the current element matches the query

        //fluent
        doc(target).closest(query);

        //legacy
        doc.closest(target, query);
*/

function closest(target, query){
    target = getTarget(target);

    if(isList(target)){
        target = target[0];
    }

    while(
        target &&
        target.ownerDocument &&
        !is(target, query)
    ){
        target = target.parentNode;
    }

    return target === doc.document && target !== query ? null : target;
}

/**

    ## .is

    returns true if the target element matches the query

        //fluent
        doc(target).is(query);

        //legacy
        doc.is(target, query);
*/

function is(target, query){
    target = getTarget(target);

    if(isList(target)){
        target = target[0];
    }

    if(!target.ownerDocument || typeof query !== 'string'){
        return target === query;
    }

    if(target === query){
        return true;
    }

    var parentless = !target.parentNode;

    if(parentless){
        // Give the element a parent so that .querySelectorAll can be used
        document.createDocumentFragment().appendChild(target);
    }

    var result = arrayProto.indexOf.call(find(target.parentNode, query), target) >= 0;

    if(parentless){
        target.parentNode.removeChild(target);
    }

    return result;
}

/**

    ## .addClass

    adds classes to the target

        //fluent
        doc(target).addClass(query);

        //legacy
        doc.addClass(target, query);
*/

function addClass(target, classes){
    target = getTargets(target);

    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            addClass(target[i], classes);
        }
        return this;
    }
    if(!classes){
        return this;
    }

    var classes = classes.split(space),
        currentClasses = target.classList ? null : target.className.split(space);

    for(var i = 0; i < classes.length; i++){
        var classToAdd = classes[i];
        if(!classToAdd || classToAdd === space){
            continue;
        }
        if(target.classList){
            target.classList.add(classToAdd);
        } else if(!currentClasses.indexOf(classToAdd)>=0){
            currentClasses.push(classToAdd);
        }
    }
    if(!target.classList){
        target.className = currentClasses.join(space);
    }
    return this;
}

/**

    ## .removeClass

    removes classes from the target

        //fluent
        doc(target).removeClass(query);

        //legacy
        doc.removeClass(target, query);
*/

function removeClass(target, classes){
    target = getTargets(target);

    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            removeClass(target[i], classes);
        }
        return this;
    }

    if(!classes){
        return this;
    }

    var classes = classes.split(space),
        currentClasses = target.classList ? null : target.className.split(space);

    for(var i = 0; i < classes.length; i++){
        var classToRemove = classes[i];
        if(!classToRemove || classToRemove === space){
            continue;
        }
        if(target.classList){
            target.classList.remove(classToRemove);
            continue;
        }
        var removeIndex = currentClasses.indexOf(classToRemove);
        if(removeIndex >= 0){
            currentClasses.splice(removeIndex, 1);
        }
    }
    if(!target.classList){
        target.className = currentClasses.join(space);
    }
    return this;
}

function addEvent(settings){
    var target = getTarget(settings.target);
    if(target){
        target.addEventListener(settings.event, settings.callback, false);
    }else{
        console.warn('No elements matched the selector, so no events were bound.');
    }
}

/**

    ## .on

    binds a callback to a target when a DOM event is raised.

        //fluent
        doc(target/proxy).on(events, target[optional], callback);

    note: if a target is passed to the .on function, doc's target will be used as the proxy.

        //legacy
        doc.on(events, target, query, proxy[optional]);
*/

function on(events, target, callback, proxy){

    proxy = getTargets(proxy);

    if(!proxy){
        target = getTargets(target);
        // handles multiple targets
        if(isList(target)){
            var multiRemoveCallbacks = [];
            for (var i = 0; i < target.length; i++) {
                multiRemoveCallbacks.push(on(events, target[i], callback, proxy));
            }
            return function(){
                while(multiRemoveCallbacks.length){
                    multiRemoveCallbacks.pop();
                }
            };
        }
    }

    // handles multiple proxies
    // Already handles multiple proxies and targets,
    // because the target loop calls this loop.
    if(isList(proxy)){
        var multiRemoveCallbacks = [];
        for (var i = 0; i < proxy.length; i++) {
            multiRemoveCallbacks.push(on(events, target, callback, proxy[i]));
        }
        return function(){
            while(multiRemoveCallbacks.length){
                multiRemoveCallbacks.pop();
            }
        };
    }

    var removeCallbacks = [];

    if(typeof events === 'string'){
        events = events.split(space);
    }

    for(var i = 0; i < events.length; i++){
        var eventSettings = {};
        if(proxy){
            if(proxy === true){
                proxy = doc.document;
            }
            eventSettings.target = proxy;
            eventSettings.callback = function(event){
                var closestTarget = closest(event.target, target);
                if(closestTarget){
                    callback(event, closestTarget);
                }
            };
        }else{
            eventSettings.target = target;
            eventSettings.callback = callback;
        }

        eventSettings.event = events[i];

        addEvent(eventSettings);

        removeCallbacks.push(eventSettings);
    }

    return function(){
        while(removeCallbacks.length){
            var removeCallback = removeCallbacks.pop();
            getTarget(removeCallback.target).removeEventListener(removeCallback.event, removeCallback.callback);
        }
    }
}

/**

    ## .off

    removes events assigned to a target.

        //fluent
        doc(target/proxy).off(events, target[optional], callback);

    note: if a target is passed to the .on function, doc's target will be used as the proxy.

        //legacy
        doc.off(events, target, callback, proxy);
*/

function off(events, target, callback, proxy){
    if(isList(target)){
        for (var i = 0; i < target.length; i++) {
            off(events, target[i], callback, proxy);
        }
        return this;
    }
    if(proxy instanceof Array){
        for (var i = 0; i < proxy.length; i++) {
            off(events, target, callback, proxy[i]);
        }
        return this;
    }

    if(typeof events === 'string'){
        events = events.split(space);
    }

    if(typeof callback !== 'function'){
        proxy = callback;
        callback = null;
    }

    proxy = proxy ? getTarget(proxy) : doc.document;

    var targets = typeof target === 'string' ? find(target, proxy) : [target];

    for(var targetIndex = 0; targetIndex < targets.length; targetIndex++){
        var currentTarget = targets[targetIndex];

        for(var i = 0; i < events.length; i++){
            currentTarget.removeEventListener(events[i], callback);
        }
    }
    return this;
}

/**

    ## .append

    adds elements to a target

        //fluent
        doc(target).append(children);

        //legacy
        doc.append(target, children);
*/

function append(target, children){
    var target = getTarget(target),
        children = getTarget(children);

    if(isList(target)){
        target = target[0];
    }

    if(isList(children)){
        for (var i = 0; i < children.length; i++) {
            append(target, children[i]);
        }
        return;
    }

    target.appendChild(children);
}

/**

    ## .prepend

    adds elements to the front of a target

        //fluent
        doc(target).prepend(children);

        //legacy
        doc.prepend(target, children);
*/

function prepend(target, children){
    var target = getTarget(target),
        children = getTarget(children);

    if(isList(target)){
        target = target[0];
    }

    if(isList(children)){
        //reversed because otherwise the would get put in in the wrong order.
        for (var i = children.length -1; i; i--) {
            prepend(target, children[i]);
        }
        return;
    }

    target.insertBefore(children, target.firstChild);
}

/**

    ## .isVisible

    checks if an element or any of its parents display properties are set to 'none'

        //fluent
        doc(target).isVisible();

        //legacy
        doc.isVisible(target);
*/

function isVisible(target){
    var target = getTarget(target);
    if(!target){
        return;
    }
    if(isList(target)){
        var i = -1;

        while (target[i++] && isVisible(target[i])) {}
        return target.length >= i;
    }
    while(target.parentNode && target.style.display !== 'none'){
        target = target.parentNode;
    }

    return target === doc.document;
}

/**

    ## .indexOfElement

    returns the index of the element within it's parent element.

        //fluent
        doc(target).indexOfElement();

        //legacy
        doc.indexOfElement(target);

*/

function indexOfElement(target) {
    target = getTargets(target);
    if(!target){
        return;
    }

    if(isList(target)){
        target = target[0];
    }

    var i = -1;

    var parent = target.parentElement;

    if(!parent){
        return i;
    }

    while(parent.children[++i] !== target){}

    return i;
}


/**

    ## .ready

    call a callback when the document is ready.

    returns -1 if there is no parentElement on the target.

        //fluent
        doc().ready(callback);

        //legacy
        doc.ready(callback);
*/

function ready(callback){
    if(doc.document && doc.document.readyState === 'complete'){
        callback();
    }else if(window.attachEvent){
        document.attachEvent("onreadystatechange", callback);
        window.attachEvent("onLoad",callback);
    }else if(document.addEventListener){
        document.addEventListener("DOMContentLoaded",callback,false);
    }
}

doc.find = find;
doc.findOne = findOne;
doc.closest = closest;
doc.is = is;
doc.addClass = addClass;
doc.removeClass = removeClass;
doc.off = off;
doc.on = on;
doc.append = append;
doc.prepend = prepend;
doc.isVisible = isVisible;
doc.ready = ready;
doc.indexOfElement = indexOfElement;

module.exports = doc;
},{"./getTarget":13,"./getTargets":14,"./isList":15}],12:[function(require,module,exports){
var doc = require('./doc'),
    isList = require('./isList'),
    getTargets = require('./getTargets')(doc.document),
    flocProto = [];

function Floc(items){
    this.push.apply(this, items);
}
Floc.prototype = flocProto;
flocProto.constructor = Floc;

function floc(target){
    var instance = getTargets(target);

    if(!isList(instance)){
        if(instance){
            instance = [instance];
        }else{
            instance = [];
        }
    }
    return new Floc(instance);
}

var returnsSelf = 'addClass removeClass append prepend'.split(' ');

for(var key in doc){
    if(typeof doc[key] === 'function'){
        floc[key] = doc[key];
        flocProto[key] = (function(key){
            var instance = this;
            // This is also extremely dodgy and fast
            return function(a,b,c,d,e,f){
                var result = doc[key](this, a,b,c,d,e,f);

                if(result !== doc && isList(result)){
                    return floc(result);
                }
                if(returnsSelf.indexOf(key) >=0){
                    return instance;
                }
                return result;
            };
        }(key));
    }
}
flocProto.on = function(events, target, callback){
    var proxy = this;
    if(typeof target === 'function'){
        callback = target;
        target = this;
        proxy = null;
    }
    doc.on(events, target, callback, proxy);
    return this;
};

flocProto.off = function(events, target, callback){
    var reference = this;
    if(typeof target === 'function'){
        callback = target;
        target = this;
        reference = null;
    }
    doc.off(events, target, callback, reference);
    return this;
};

flocProto.ready = function(callback){
    doc.ready(callback);
    return this;
};

flocProto.addClass = function(className){
    doc.addClass(this, className);
    return this;
};

flocProto.removeClass = function(className){
    doc.removeClass(this, className);
    return this;
};

module.exports = floc;
},{"./doc":11,"./getTargets":14,"./isList":15}],13:[function(require,module,exports){
var singleId = /^#\w+$/;

module.exports = function(document){
    return function getTarget(target){
        if(typeof target === 'string'){
            if(singleId.exec(target)){
                return document.getElementById(target.slice(1));
            }
            return document.querySelector(target);
        }

        return target;
    };
};
},{}],14:[function(require,module,exports){

var singleClass = /^\.\w+$/,
    singleId = /^#\w+$/,
    singleTag = /^\w+$/;

module.exports = function(document){
    return function getTargets(target){
        if(typeof target === 'string'){
            if(singleId.exec(target)){
                // If you have more than 1 of the same id in your page,
                // thats your own stupid fault.
                return [document.getElementById(target.slice(1))];
            }
            if(singleTag.exec(target)){
                return document.getElementsByTagName(target);
            }
            if(singleClass.exec(target)){
                return document.getElementsByClassName(target.slice(1));
            }
            return document.querySelectorAll(target);
        }

        return target;
    };
};
},{}],15:[function(require,module,exports){
module.exports = function isList(object){
    return object != null && typeof object === 'object' && 'length' in object && !('nodeType' in object) && object.self != object; // in IE8, window.self is window, but it is not === window, but it is == window......... WTF!?
}
},{}],16:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    Set = require('es6-set'),
    WeakMap = require('es6-weak-map');

function toArray(items){
    return Array.prototype.slice.call(items);
}

function lastKey(path){
    path+='';
    var match = path.match(/(?:.*\.)?([^.]*)$/);
    return match && match[1];
}

var dotRegex = /\./i;

function matchDeep(path){
    return (path + '').match(dotRegex);
}

function isDeep(path){
    return ~(path + '').indexOf('.');
}

var attachedEnties = new Set(),
    trackedObjects = new WeakMap();

function leftAndRest(path){
    var match = matchDeep(path);
    if(match){
        return [path.slice(0, match.index), path.slice(match.index+1)];
    }
    return path;
}

function isWildcardKey(key){
    return key.charAt(0) === '*';
}

function isFeralcardKey(key){
    return key === '**';
}

function addHandler(object, key, handler){
    var trackedKeys = trackedObjects.get(object);

    if(trackedKeys == null){
        trackedKeys = {};
        trackedObjects.set(object, trackedKeys);
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        handlers = new Set();
        trackedKeys[key] = handlers;
    }

    handlers.add(handler);
}

function removeHandler(object, key, handler){
    var trackedKeys = trackedObjects.get(object);

    if(trackedKeys == null){
        return;
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        return;
    }

    handlers.delete(handler);
}

function trackObjects(enti, eventName, weakMap, handler, object, key, path){
    if(!object || typeof object !== 'object'){
        return;
    }

    var eventKey = key === '**' ? '*' : key,
        target = object[key],
        targetIsObject = target && typeof target === 'object';

    if(targetIsObject && weakMap.has(target)){
        return;
    }

    var handle = function(value, event, emitKey){
        if(enti._trackedObjects[eventName] !== weakMap){
            if(targetIsObject){
                weakMap.delete(target);
            }
            removeHandler(object, eventKey, handle);
            return;
        }

        if(eventKey !== '*' && typeof object[eventKey] === 'object' && object[eventKey] !== target){
            if(targetIsObject){
                weakMap.delete(target);
            }
            removeHandler(object, eventKey, handle);
            trackObjects(enti, eventName, weakMap, handler, object, key, path);
            return;
        }

        if(eventKey === '*'){
            trackKeys(object, key, path);
        }

        if(!weakMap.has(object)){
            return;
        }

        handler(value, event, emitKey);
    }

    function trackKeys(target, root, rest){
        var keys = Object.keys(target);
        for(var i = 0; i < keys.length; i++){
            if(isFeralcardKey(root)){
                trackObjects(enti, eventName, weakMap, handler, target, keys[i], '**' + (rest ? '.' : '') + (rest || ''));
            }else{
                trackObjects(enti, eventName, weakMap, handler, target, keys[i], rest);
            }
        }
    }

    addHandler(object, eventKey, handle);

    if(!targetIsObject){
        return;
    }

    // This would obviously be better implemented with a WeakSet,
    // But I'm trying to keep filesize down, and I don't really want another
    // polyfill when WeakMap works well enough for the task.
    weakMap.set(target, null);

    if(!path){
        return;
    }

    var rootAndRest = leftAndRest(path),
        root,
        rest;

    if(!Array.isArray(rootAndRest)){
        root = rootAndRest;
    }else{
        root = rootAndRest[0];
        rest = rootAndRest[1];
    }

    if(targetIsObject && isWildcardKey(root)){
        trackKeys(target, root, rest);
    }

    trackObjects(enti, eventName, weakMap, handler, target, root, rest);
}

function trackPath(enti, eventName){
    var entiTrackedObjects = enti._trackedObjects[eventName];

    if(!entiTrackedObjects){
        entiTrackedObjects = new WeakMap();
        enti._trackedObjects[eventName] = entiTrackedObjects;
    }

    var handler = function(value, event, emitKey){
        if(enti._emittedEvents[eventName] === emitKey){
            return;
        }
        enti._emittedEvents[eventName] = emitKey;
        enti.emit(eventName, value, event);
    }

    trackObjects(enti, eventName, entiTrackedObjects, handler, enti, '_model', eventName);
}

function trackPaths(enti, target){
    if(!enti._events){
        return;
    }

    for(var key in enti._events){
        // Bailout if the event is a single key,
        // and the target isnt the same as the entis _model
        if(enti._model !== target && !isDeep(key)){
            continue;
        }

        trackPath(enti, key);
    }
}

function emitEvent(object, key, value, emitKey){

    attachedEnties.forEach(function(enti){
        trackPaths(enti, object);
    });

    var trackedKeys = trackedObjects.get(object);

    if(!trackedKeys){
        return;
    }

    var event = {
        value: value,
        key: key,
        object: object
    };

    if(trackedKeys[key]){
        trackedKeys[key].forEach(function(handler){
            if(trackedKeys[key].has(handler)){
                handler(value, event, emitKey);
            }
        });
    }

    if(trackedKeys['*']){
        trackedKeys['*'].forEach(function(handler){
            if(trackedKeys['*'].has(handler)){
                handler(value, event, emitKey);
            }
        });
    }
}

function emit(events){
    var emitKey = {};
    events.forEach(function(event){
        emitEvent(event[0], event[1], event[2], emitKey);
    });
}

function Enti(model){
    var detached = model === false;

    if(!model || (typeof model !== 'object' && typeof model !== 'function')){
        model = {};
    }

    this._trackedObjects = {};
    this._emittedEvents = {};
    if(detached){
        this._model = {};
    }else{
        this.attach(model);
    }
}
Enti.get = function(model, key){
    if(!model || typeof model !== 'object'){
        return;
    }

    if(key === '.'){
        return model;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.get(model[path[0]], path[1]);
    }

    return model[key];
};
Enti.set = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.set(model[path[0]], path[1], value);
    }

    var original = model[key];

    if(typeof value !== 'object' && value === original){
        return;
    }

    var keysChanged = !(key in model);

    model[key] = value;

    var events = [[model, key, value]];

    if(keysChanged){
        if(Array.isArray(model)){
            events.push([model, 'length', model.length]);
        }
    }

    emit(events);
};
Enti.push = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target;
    if(arguments.length < 3){
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.push(model[path[0]], path[1], value);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw 'The target is not an array.';
    }

    target.push(value);

    var events = [
        [target, target.length-1, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.insert = function(model, key, value, index){
    if(!model || typeof model !== 'object'){
        return;
    }


    var target;
    if(arguments.length < 4){
        index = value;
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.insert(model[path[0]], path[1], value, index);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw 'The target is not an array.';
    }

    target.splice(index, 0, value);

    var events = [
        [target, index, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.remove = function(model, key, subKey){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.remove(model[path[0]], path[1], subKey);
    }

    // Remove a key off of an object at 'key'
    if(subKey != null){
        Enti.remove(model[key], subKey);
        return;
    }

    if(key === '.'){
        throw '. (self) is not a valid key to remove';
    }

    var events = [];

    if(Array.isArray(model)){
        model.splice(key, 1);
        events.push([model, 'length', model.length]);
    }else{
        delete model[key];
        events.push([model, key]);
    }

    emit(events);
};
Enti.move = function(model, key, index){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.move(model[path[0]], path[1], index);
    }

    var model = model;

    if(key === index){
        return;
    }

    if(!Array.isArray(model)){
        throw 'The model is not an array.';
    }

    var item = model[key];

    model.splice(key, 1);

    model.splice(index - (index > key ? 0 : 1), 0, item);

    emit([model, index, item]);
};
Enti.update = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target,
        isArray = Array.isArray(value);

    if(arguments.length < 3){
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.update(model[path[0]], path[1], value);
        }

        target = model[key];

        if(target == null){
            model[key] = isArray ? [] : {};
        }
    }

    if(typeof value !== 'object'){
        throw 'The value is not an object.';
    }

    if(typeof target !== 'object'){
        throw 'The target is not an object.';
    }

    var events = [];

    function updateTarget(target, value){
        for(var key in value){
            if(target[key] && typeof target[key] === 'object'){
                updateTarget(target[key], value[key]);
                continue;
            }
            target[key] = value[key];
            events.push([target, key, value[key]]);
        }

        if(Array.isArray(target)){
            events.push([target, 'length', target.length]);
        }
    }

    updateTarget(target, value);

    emit(events);
};
Enti.prototype = Object.create(EventEmitter.prototype);
Enti.prototype.constructor = Enti;
Enti.prototype.attach = function(model){
    if(this._model !== model){
        this.detach();
    }

    if(!attachedEnties.has(this)){
        attachedEnties.add(this);
    }
    this._attached = true;
    this._model = model;
};
Enti.prototype.detach = function(){
    if(attachedEnties.has(this)){
        attachedEnties.delete(this);
    }

    this._trackedObjects = {};
    this._emittedEvents = {};
    this._model = {};
    this._attached = false;
};
Enti.prototype.destroy = function(){
    this.detach();
    this._events = null;
}
Enti.prototype.get = function(key){
    return Enti.get(this._model, key);
};

Enti.prototype.set = function(key, value){
    return Enti.set(this._model, key, value);
};

Enti.prototype.push = function(key, value){
    return Enti.push.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.insert = function(key, value, index){
    return Enti.insert.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.remove = function(key, subKey){
    return Enti.remove.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.move = function(key, index){
    return Enti.move.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.update = function(key, index){
    return Enti.update.apply(null, [this._model].concat(toArray(arguments)));
};
Enti.prototype.isAttached = function(){
    return this._attached;
};
Enti.prototype.attachedCount = function(){
    return attachedEnties.size;
};

module.exports = Enti;

},{"es6-set":17,"es6-weak-map":70,"events":207}],17:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Set : require('./polyfill');

},{"./is-implemented":18,"./polyfill":69}],18:[function(require,module,exports){
'use strict';

module.exports = function () {
	var set, iterator, result;
	if (typeof Set !== 'function') return false;
	set = new Set(['raz', 'dwa', 'trzy']);
	if (set.size !== 3) return false;
	if (typeof set.add !== 'function') return false;
	if (typeof set.clear !== 'function') return false;
	if (typeof set.delete !== 'function') return false;
	if (typeof set.entries !== 'function') return false;
	if (typeof set.forEach !== 'function') return false;
	if (typeof set.has !== 'function') return false;
	if (typeof set.keys !== 'function') return false;
	if (typeof set.values !== 'function') return false;

	iterator = set.values();
	result = iterator.next();
	if (result.done !== false) return false;
	if (result.value !== 'raz') return false;
	return true;
};

},{}],19:[function(require,module,exports){
// Exports true if environment provides native `Set` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Set === 'undefined') return false;
	return (Object.prototype.toString.call(Set.prototype) === '[object Set]');
}());

},{}],20:[function(require,module,exports){
'use strict';

var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
  , contains          = require('es5-ext/string/#/contains')
  , d                 = require('d')
  , Iterator          = require('es6-iterator')
  , toStringTagSymbol = require('es6-symbol').toStringTag

  , defineProperty = Object.defineProperty
  , SetIterator;

SetIterator = module.exports = function (set, kind) {
	if (!(this instanceof SetIterator)) return new SetIterator(set, kind);
	Iterator.call(this, set.__setData__, set);
	if (!kind) kind = 'value';
	else if (contains.call(kind, 'key+value')) kind = 'key+value';
	else kind = 'value';
	defineProperty(this, '__kind__', d('', kind));
};
if (setPrototypeOf) setPrototypeOf(SetIterator, Iterator);

SetIterator.prototype = Object.create(Iterator.prototype, {
	constructor: d(SetIterator),
	_resolve: d(function (i) {
		if (this.__kind__ === 'value') return this.__list__[i];
		return [this.__list__[i], this.__list__[i]];
	}),
	toString: d(function () { return '[object Set Iterator]'; })
});
defineProperty(SetIterator.prototype, toStringTagSymbol,
	d('c', 'Set Iterator'));

},{"d":22,"es5-ext/object/set-prototype-of":44,"es5-ext/string/#/contains":49,"es6-iterator":56,"es6-symbol":65}],21:[function(require,module,exports){
'use strict';

var copy       = require('es5-ext/object/copy')
  , map        = require('es5-ext/object/map')
  , callable   = require('es5-ext/object/valid-callable')
  , validValue = require('es5-ext/object/valid-value')

  , bind = Function.prototype.bind, defineProperty = Object.defineProperty
  , hasOwnProperty = Object.prototype.hasOwnProperty
  , define;

define = function (name, desc, bindTo) {
	var value = validValue(desc) && callable(desc.value), dgs;
	dgs = copy(desc);
	delete dgs.writable;
	delete dgs.value;
	dgs.get = function () {
		if (hasOwnProperty.call(this, name)) return value;
		desc.value = bind.call(value, (bindTo == null) ? this : this[bindTo]);
		defineProperty(this, name, desc);
		return this[name];
	};
	return dgs;
};

module.exports = function (props/*, bindTo*/) {
	var bindTo = arguments[1];
	return map(props, function (desc, name) {
		return define(name, desc, bindTo);
	});
};

},{"es5-ext/object/copy":34,"es5-ext/object/map":42,"es5-ext/object/valid-callable":47,"es5-ext/object/valid-value":48}],22:[function(require,module,exports){
'use strict';

var assign        = require('es5-ext/object/assign')
  , normalizeOpts = require('es5-ext/object/normalize-options')
  , isCallable    = require('es5-ext/object/is-callable')
  , contains      = require('es5-ext/string/#/contains')

  , d;

d = module.exports = function (dscr, value/*, options*/) {
	var c, e, w, options, desc;
	if ((arguments.length < 2) || (typeof dscr !== 'string')) {
		options = value;
		value = dscr;
		dscr = null;
	} else {
		options = arguments[2];
	}
	if (dscr == null) {
		c = w = true;
		e = false;
	} else {
		c = contains.call(dscr, 'c');
		e = contains.call(dscr, 'e');
		w = contains.call(dscr, 'w');
	}

	desc = { value: value, configurable: c, enumerable: e, writable: w };
	return !options ? desc : assign(normalizeOpts(options), desc);
};

d.gs = function (dscr, get, set/*, options*/) {
	var c, e, options, desc;
	if (typeof dscr !== 'string') {
		options = set;
		set = get;
		get = dscr;
		dscr = null;
	} else {
		options = arguments[3];
	}
	if (get == null) {
		get = undefined;
	} else if (!isCallable(get)) {
		options = get;
		get = set = undefined;
	} else if (set == null) {
		set = undefined;
	} else if (!isCallable(set)) {
		options = set;
		set = undefined;
	}
	if (dscr == null) {
		c = true;
		e = false;
	} else {
		c = contains.call(dscr, 'c');
		e = contains.call(dscr, 'e');
	}

	desc = { get: get, set: set, configurable: c, enumerable: e };
	return !options ? desc : assign(normalizeOpts(options), desc);
};

},{"es5-ext/object/assign":31,"es5-ext/object/is-callable":37,"es5-ext/object/normalize-options":43,"es5-ext/string/#/contains":49}],23:[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

'use strict';

var value = require('../../object/valid-value');

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":48}],24:[function(require,module,exports){
'use strict';

var toPosInt = require('../../number/to-pos-integer')
  , value    = require('../../object/valid-value')

  , indexOf = Array.prototype.indexOf
  , hasOwnProperty = Object.prototype.hasOwnProperty
  , abs = Math.abs, floor = Math.floor;

module.exports = function (searchElement/*, fromIndex*/) {
	var i, l, fromIndex, val;
	if (searchElement === searchElement) { //jslint: ignore
		return indexOf.apply(this, arguments);
	}

	l = toPosInt(value(this).length);
	fromIndex = arguments[1];
	if (isNaN(fromIndex)) fromIndex = 0;
	else if (fromIndex >= 0) fromIndex = floor(fromIndex);
	else fromIndex = toPosInt(this.length) - floor(abs(fromIndex));

	for (i = fromIndex; i < l; ++i) {
		if (hasOwnProperty.call(this, i)) {
			val = this[i];
			if (val !== val) return i; //jslint: ignore
		}
	}
	return -1;
};

},{"../../number/to-pos-integer":29,"../../object/valid-value":48}],25:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Math.sign
	: require('./shim');

},{"./is-implemented":26,"./shim":27}],26:[function(require,module,exports){
'use strict';

module.exports = function () {
	var sign = Math.sign;
	if (typeof sign !== 'function') return false;
	return ((sign(10) === 1) && (sign(-20) === -1));
};

},{}],27:[function(require,module,exports){
'use strict';

module.exports = function (value) {
	value = Number(value);
	if (isNaN(value) || (value === 0)) return value;
	return (value > 0) ? 1 : -1;
};

},{}],28:[function(require,module,exports){
'use strict';

var sign = require('../math/sign')

  , abs = Math.abs, floor = Math.floor;

module.exports = function (value) {
	if (isNaN(value)) return 0;
	value = Number(value);
	if ((value === 0) || !isFinite(value)) return value;
	return sign(value) * floor(abs(value));
};

},{"../math/sign":25}],29:[function(require,module,exports){
'use strict';

var toInteger = require('./to-integer')

  , max = Math.max;

module.exports = function (value) { return max(0, toInteger(value)); };

},{"./to-integer":28}],30:[function(require,module,exports){
// Internal method, used by iteration functions.
// Calls a function for each key-value pair found in object
// Optionally takes compareFn to iterate object in specific order

'use strict';

var isCallable = require('./is-callable')
  , callable   = require('./valid-callable')
  , value      = require('./valid-value')

  , call = Function.prototype.call, keys = Object.keys
  , propertyIsEnumerable = Object.prototype.propertyIsEnumerable;

module.exports = function (method, defVal) {
	return function (obj, cb/*, thisArg, compareFn*/) {
		var list, thisArg = arguments[2], compareFn = arguments[3];
		obj = Object(value(obj));
		callable(cb);

		list = keys(obj);
		if (compareFn) {
			list.sort(isCallable(compareFn) ? compareFn.bind(obj) : undefined);
		}
		return list[method](function (key, index) {
			if (!propertyIsEnumerable.call(obj, key)) return defVal;
			return call.call(cb, thisArg, obj[key], key, obj, index);
		});
	};
};

},{"./is-callable":37,"./valid-callable":47,"./valid-value":48}],31:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.assign
	: require('./shim');

},{"./is-implemented":32,"./shim":33}],32:[function(require,module,exports){
'use strict';

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== 'function') return false;
	obj = { foo: 'raz' };
	assign(obj, { bar: 'dwa' }, { trzy: 'trzy' });
	return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
};

},{}],33:[function(require,module,exports){
'use strict';

var keys  = require('../keys')
  , value = require('../valid-value')

  , max = Math.max;

module.exports = function (dest, src/*, …srcn*/) {
	var error, i, l = max(arguments.length, 2), assign;
	dest = Object(value(dest));
	assign = function (key) {
		try { dest[key] = src[key]; } catch (e) {
			if (!error) error = e;
		}
	};
	for (i = 1; i < l; ++i) {
		src = arguments[i];
		keys(src).forEach(assign);
	}
	if (error !== undefined) throw error;
	return dest;
};

},{"../keys":39,"../valid-value":48}],34:[function(require,module,exports){
'use strict';

var assign = require('./assign')
  , value  = require('./valid-value');

module.exports = function (obj) {
	var copy = Object(value(obj));
	if (copy !== obj) return copy;
	return assign({}, obj);
};

},{"./assign":31,"./valid-value":48}],35:[function(require,module,exports){
// Workaround for http://code.google.com/p/v8/issues/detail?id=2804

'use strict';

var create = Object.create, shim;

if (!require('./set-prototype-of/is-implemented')()) {
	shim = require('./set-prototype-of/shim');
}

module.exports = (function () {
	var nullObject, props, desc;
	if (!shim) return create;
	if (shim.level !== 1) return create;

	nullObject = {};
	props = {};
	desc = { configurable: false, enumerable: false, writable: true,
		value: undefined };
	Object.getOwnPropertyNames(Object.prototype).forEach(function (name) {
		if (name === '__proto__') {
			props[name] = { configurable: true, enumerable: false, writable: true,
				value: undefined };
			return;
		}
		props[name] = desc;
	});
	Object.defineProperties(nullObject, props);

	Object.defineProperty(shim, 'nullPolyfill', { configurable: false,
		enumerable: false, writable: false, value: nullObject });

	return function (prototype, props) {
		return create((prototype === null) ? nullObject : prototype, props);
	};
}());

},{"./set-prototype-of/is-implemented":45,"./set-prototype-of/shim":46}],36:[function(require,module,exports){
'use strict';

module.exports = require('./_iterate')('forEach');

},{"./_iterate":30}],37:[function(require,module,exports){
// Deprecated

'use strict';

module.exports = function (obj) { return typeof obj === 'function'; };

},{}],38:[function(require,module,exports){
'use strict';

var map = { function: true, object: true };

module.exports = function (x) {
	return ((x != null) && map[typeof x]) || false;
};

},{}],39:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.keys
	: require('./shim');

},{"./is-implemented":40,"./shim":41}],40:[function(require,module,exports){
'use strict';

module.exports = function () {
	try {
		Object.keys('primitive');
		return true;
	} catch (e) { return false; }
};

},{}],41:[function(require,module,exports){
'use strict';

var keys = Object.keys;

module.exports = function (object) {
	return keys(object == null ? object : Object(object));
};

},{}],42:[function(require,module,exports){
'use strict';

var callable = require('./valid-callable')
  , forEach  = require('./for-each')

  , call = Function.prototype.call;

module.exports = function (obj, cb/*, thisArg*/) {
	var o = {}, thisArg = arguments[2];
	callable(cb);
	forEach(obj, function (value, key, obj, index) {
		o[key] = call.call(cb, thisArg, value, key, obj, index);
	});
	return o;
};

},{"./for-each":36,"./valid-callable":47}],43:[function(require,module,exports){
'use strict';

var forEach = Array.prototype.forEach, create = Object.create;

var process = function (src, obj) {
	var key;
	for (key in src) obj[key] = src[key];
};

module.exports = function (options/*, …options*/) {
	var result = create(null);
	forEach.call(arguments, function (options) {
		if (options == null) return;
		process(Object(options), result);
	});
	return result;
};

},{}],44:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.setPrototypeOf
	: require('./shim');

},{"./is-implemented":45,"./shim":46}],45:[function(require,module,exports){
'use strict';

var create = Object.create, getPrototypeOf = Object.getPrototypeOf
  , x = {};

module.exports = function (/*customCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf
	  , customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== 'function') return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), x)) === x;
};

},{}],46:[function(require,module,exports){
// Big thanks to @WebReflection for sorting this out
// https://gist.github.com/WebReflection/5593554

'use strict';

var isObject      = require('../is-object')
  , value         = require('../valid-value')

  , isPrototypeOf = Object.prototype.isPrototypeOf
  , defineProperty = Object.defineProperty
  , nullDesc = { configurable: true, enumerable: false, writable: true,
		value: undefined }
  , validate;

validate = function (obj, prototype) {
	value(obj);
	if ((prototype === null) || isObject(prototype)) return obj;
	throw new TypeError('Prototype must be null or an object');
};

module.exports = (function (status) {
	var fn, set;
	if (!status) return null;
	if (status.level === 2) {
		if (status.set) {
			set = status.set;
			fn = function (obj, prototype) {
				set.call(validate(obj, prototype), prototype);
				return obj;
			};
		} else {
			fn = function (obj, prototype) {
				validate(obj, prototype).__proto__ = prototype;
				return obj;
			};
		}
	} else {
		fn = function self(obj, prototype) {
			var isNullBase;
			validate(obj, prototype);
			isNullBase = isPrototypeOf.call(self.nullPolyfill, obj);
			if (isNullBase) delete self.nullPolyfill.__proto__;
			if (prototype === null) prototype = self.nullPolyfill;
			obj.__proto__ = prototype;
			if (isNullBase) defineProperty(self.nullPolyfill, '__proto__', nullDesc);
			return obj;
		};
	}
	return Object.defineProperty(fn, 'level', { configurable: false,
		enumerable: false, writable: false, value: status.level });
}((function () {
	var x = Object.create(null), y = {}, set
	  , desc = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');

	if (desc) {
		try {
			set = desc.set; // Opera crashes at this point
			set.call(x, y);
		} catch (ignore) { }
		if (Object.getPrototypeOf(x) === y) return { set: set, level: 2 };
	}

	x.__proto__ = y;
	if (Object.getPrototypeOf(x) === y) return { level: 2 };

	x = {};
	x.__proto__ = y;
	if (Object.getPrototypeOf(x) === y) return { level: 1 };

	return false;
}())));

require('../create');

},{"../create":35,"../is-object":38,"../valid-value":48}],47:[function(require,module,exports){
'use strict';

module.exports = function (fn) {
	if (typeof fn !== 'function') throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],48:[function(require,module,exports){
'use strict';

module.exports = function (value) {
	if (value == null) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{}],49:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? String.prototype.contains
	: require('./shim');

},{"./is-implemented":50,"./shim":51}],50:[function(require,module,exports){
'use strict';

var str = 'razdwatrzy';

module.exports = function () {
	if (typeof str.contains !== 'function') return false;
	return ((str.contains('dwa') === true) && (str.contains('foo') === false));
};

},{}],51:[function(require,module,exports){
'use strict';

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],52:[function(require,module,exports){
'use strict';

var toString = Object.prototype.toString

  , id = toString.call('');

module.exports = function (x) {
	return (typeof x === 'string') || (x && (typeof x === 'object') &&
		((x instanceof String) || (toString.call(x) === id))) || false;
};

},{}],53:[function(require,module,exports){
'use strict';

var setPrototypeOf = require('es5-ext/object/set-prototype-of')
  , contains       = require('es5-ext/string/#/contains')
  , d              = require('d')
  , Iterator       = require('./')

  , defineProperty = Object.defineProperty
  , ArrayIterator;

ArrayIterator = module.exports = function (arr, kind) {
	if (!(this instanceof ArrayIterator)) return new ArrayIterator(arr, kind);
	Iterator.call(this, arr);
	if (!kind) kind = 'value';
	else if (contains.call(kind, 'key+value')) kind = 'key+value';
	else if (contains.call(kind, 'key')) kind = 'key';
	else kind = 'value';
	defineProperty(this, '__kind__', d('', kind));
};
if (setPrototypeOf) setPrototypeOf(ArrayIterator, Iterator);

ArrayIterator.prototype = Object.create(Iterator.prototype, {
	constructor: d(ArrayIterator),
	_resolve: d(function (i) {
		if (this.__kind__ === 'value') return this.__list__[i];
		if (this.__kind__ === 'key+value') return [i, this.__list__[i]];
		return i;
	}),
	toString: d(function () { return '[object Array Iterator]'; })
});

},{"./":56,"d":22,"es5-ext/object/set-prototype-of":44,"es5-ext/string/#/contains":49}],54:[function(require,module,exports){
'use strict';

var callable = require('es5-ext/object/valid-callable')
  , isString = require('es5-ext/string/is-string')
  , get      = require('./get')

  , isArray = Array.isArray, call = Function.prototype.call;

module.exports = function (iterable, cb/*, thisArg*/) {
	var mode, thisArg = arguments[2], result, doBreak, broken, i, l, char, code;
	if (isArray(iterable)) mode = 'array';
	else if (isString(iterable)) mode = 'string';
	else iterable = get(iterable);

	callable(cb);
	doBreak = function () { broken = true; };
	if (mode === 'array') {
		iterable.some(function (value) {
			call.call(cb, thisArg, value, doBreak);
			if (broken) return true;
		});
		return;
	}
	if (mode === 'string') {
		l = iterable.length;
		for (i = 0; i < l; ++i) {
			char = iterable[i];
			if ((i + 1) < l) {
				code = char.charCodeAt(0);
				if ((code >= 0xD800) && (code <= 0xDBFF)) char += iterable[++i];
			}
			call.call(cb, thisArg, char, doBreak);
			if (broken) break;
		}
		return;
	}
	result = iterable.next();

	while (!result.done) {
		call.call(cb, thisArg, result.value, doBreak);
		if (broken) return;
		result = iterable.next();
	}
};

},{"./get":55,"es5-ext/object/valid-callable":47,"es5-ext/string/is-string":52}],55:[function(require,module,exports){
'use strict';

var isString = require('es5-ext/string/is-string')
  , ArrayIterator  = require('./array')
  , StringIterator = require('./string')
  , iterable       = require('./valid-iterable')
  , iteratorSymbol = require('es6-symbol').iterator;

module.exports = function (obj) {
	if (typeof iterable(obj)[iteratorSymbol] === 'function') return obj[iteratorSymbol]();
	if (isString(obj)) return new StringIterator(obj);
	return new ArrayIterator(obj);
};

},{"./array":53,"./string":63,"./valid-iterable":64,"es5-ext/string/is-string":52,"es6-symbol":58}],56:[function(require,module,exports){
'use strict';

var clear    = require('es5-ext/array/#/clear')
  , assign   = require('es5-ext/object/assign')
  , callable = require('es5-ext/object/valid-callable')
  , value    = require('es5-ext/object/valid-value')
  , d        = require('d')
  , autoBind = require('d/auto-bind')
  , Symbol   = require('es6-symbol')

  , defineProperty = Object.defineProperty
  , defineProperties = Object.defineProperties
  , Iterator;

module.exports = Iterator = function (list, context) {
	if (!(this instanceof Iterator)) return new Iterator(list, context);
	defineProperties(this, {
		__list__: d('w', value(list)),
		__context__: d('w', context),
		__nextIndex__: d('w', 0)
	});
	if (!context) return;
	callable(context.on);
	context.on('_add', this._onAdd);
	context.on('_delete', this._onDelete);
	context.on('_clear', this._onClear);
};

defineProperties(Iterator.prototype, assign({
	constructor: d(Iterator),
	_next: d(function () {
		var i;
		if (!this.__list__) return;
		if (this.__redo__) {
			i = this.__redo__.shift();
			if (i !== undefined) return i;
		}
		if (this.__nextIndex__ < this.__list__.length) return this.__nextIndex__++;
		this._unBind();
	}),
	next: d(function () { return this._createResult(this._next()); }),
	_createResult: d(function (i) {
		if (i === undefined) return { done: true, value: undefined };
		return { done: false, value: this._resolve(i) };
	}),
	_resolve: d(function (i) { return this.__list__[i]; }),
	_unBind: d(function () {
		this.__list__ = null;
		delete this.__redo__;
		if (!this.__context__) return;
		this.__context__.off('_add', this._onAdd);
		this.__context__.off('_delete', this._onDelete);
		this.__context__.off('_clear', this._onClear);
		this.__context__ = null;
	}),
	toString: d(function () { return '[object Iterator]'; })
}, autoBind({
	_onAdd: d(function (index) {
		if (index >= this.__nextIndex__) return;
		++this.__nextIndex__;
		if (!this.__redo__) {
			defineProperty(this, '__redo__', d('c', [index]));
			return;
		}
		this.__redo__.forEach(function (redo, i) {
			if (redo >= index) this.__redo__[i] = ++redo;
		}, this);
		this.__redo__.push(index);
	}),
	_onDelete: d(function (index) {
		var i;
		if (index >= this.__nextIndex__) return;
		--this.__nextIndex__;
		if (!this.__redo__) return;
		i = this.__redo__.indexOf(index);
		if (i !== -1) this.__redo__.splice(i, 1);
		this.__redo__.forEach(function (redo, i) {
			if (redo > index) this.__redo__[i] = --redo;
		}, this);
	}),
	_onClear: d(function () {
		if (this.__redo__) clear.call(this.__redo__);
		this.__nextIndex__ = 0;
	})
})));

defineProperty(Iterator.prototype, Symbol.iterator, d(function () {
	return this;
}));
defineProperty(Iterator.prototype, Symbol.toStringTag, d('', 'Iterator'));

},{"d":22,"d/auto-bind":21,"es5-ext/array/#/clear":23,"es5-ext/object/assign":31,"es5-ext/object/valid-callable":47,"es5-ext/object/valid-value":48,"es6-symbol":58}],57:[function(require,module,exports){
'use strict';

var isString       = require('es5-ext/string/is-string')
  , iteratorSymbol = require('es6-symbol').iterator

  , isArray = Array.isArray;

module.exports = function (value) {
	if (value == null) return false;
	if (isArray(value)) return true;
	if (isString(value)) return true;
	return (typeof value[iteratorSymbol] === 'function');
};

},{"es5-ext/string/is-string":52,"es6-symbol":58}],58:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":59,"./polyfill":61}],59:[function(require,module,exports){
'use strict';

module.exports = function () {
	var symbol;
	if (typeof Symbol !== 'function') return false;
	symbol = Symbol('test symbol');
	try { String(symbol); } catch (e) { return false; }
	if (typeof Symbol.iterator === 'symbol') return true;

	// Return 'true' for polyfills
	if (typeof Symbol.isConcatSpreadable !== 'object') return false;
	if (typeof Symbol.iterator !== 'object') return false;
	if (typeof Symbol.toPrimitive !== 'object') return false;
	if (typeof Symbol.toStringTag !== 'object') return false;
	if (typeof Symbol.unscopables !== 'object') return false;

	return true;
};

},{}],60:[function(require,module,exports){
'use strict';

module.exports = function (x) {
	return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
};

},{}],61:[function(require,module,exports){
'use strict';

var d              = require('d')
  , validateSymbol = require('./validate-symbol')

  , create = Object.create, defineProperties = Object.defineProperties
  , defineProperty = Object.defineProperty, objPrototype = Object.prototype
  , Symbol, HiddenSymbol, globalSymbols = create(null);

var generateName = (function () {
	var created = create(null);
	return function (desc) {
		var postfix = 0, name;
		while (created[desc + (postfix || '')]) ++postfix;
		desc += (postfix || '');
		created[desc] = true;
		name = '@@' + desc;
		defineProperty(objPrototype, name, d.gs(null, function (value) {
			defineProperty(this, name, d(value));
		}));
		return name;
	};
}());

HiddenSymbol = function Symbol(description) {
	if (this instanceof HiddenSymbol) throw new TypeError('TypeError: Symbol is not a constructor');
	return Symbol(description);
};
module.exports = Symbol = function Symbol(description) {
	var symbol;
	if (this instanceof Symbol) throw new TypeError('TypeError: Symbol is not a constructor');
	symbol = create(HiddenSymbol.prototype);
	description = (description === undefined ? '' : String(description));
	return defineProperties(symbol, {
		__description__: d('', description),
		__name__: d('', generateName(description))
	});
};
defineProperties(Symbol, {
	for: d(function (key) {
		if (globalSymbols[key]) return globalSymbols[key];
		return (globalSymbols[key] = Symbol(String(key)));
	}),
	keyFor: d(function (s) {
		var key;
		validateSymbol(s);
		for (key in globalSymbols) if (globalSymbols[key] === s) return key;
	}),
	hasInstance: d('', Symbol('hasInstance')),
	isConcatSpreadable: d('', Symbol('isConcatSpreadable')),
	iterator: d('', Symbol('iterator')),
	match: d('', Symbol('match')),
	replace: d('', Symbol('replace')),
	search: d('', Symbol('search')),
	species: d('', Symbol('species')),
	split: d('', Symbol('split')),
	toPrimitive: d('', Symbol('toPrimitive')),
	toStringTag: d('', Symbol('toStringTag')),
	unscopables: d('', Symbol('unscopables'))
});
defineProperties(HiddenSymbol.prototype, {
	constructor: d(Symbol),
	toString: d('', function () { return this.__name__; })
});

defineProperties(Symbol.prototype, {
	toString: d(function () { return 'Symbol (' + validateSymbol(this).__description__ + ')'; }),
	valueOf: d(function () { return validateSymbol(this); })
});
defineProperty(Symbol.prototype, Symbol.toPrimitive, d('',
	function () { return validateSymbol(this); }));
defineProperty(Symbol.prototype, Symbol.toStringTag, d('c', 'Symbol'));

defineProperty(HiddenSymbol.prototype, Symbol.toPrimitive,
	d('c', Symbol.prototype[Symbol.toPrimitive]));
defineProperty(HiddenSymbol.prototype, Symbol.toStringTag,
	d('c', Symbol.prototype[Symbol.toStringTag]));

},{"./validate-symbol":62,"d":22}],62:[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":60}],63:[function(require,module,exports){
// Thanks @mathiasbynens
// http://mathiasbynens.be/notes/javascript-unicode#iterating-over-symbols

'use strict';

var setPrototypeOf = require('es5-ext/object/set-prototype-of')
  , d              = require('d')
  , Iterator       = require('./')

  , defineProperty = Object.defineProperty
  , StringIterator;

StringIterator = module.exports = function (str) {
	if (!(this instanceof StringIterator)) return new StringIterator(str);
	str = String(str);
	Iterator.call(this, str);
	defineProperty(this, '__length__', d('', str.length));

};
if (setPrototypeOf) setPrototypeOf(StringIterator, Iterator);

StringIterator.prototype = Object.create(Iterator.prototype, {
	constructor: d(StringIterator),
	_next: d(function () {
		if (!this.__list__) return;
		if (this.__nextIndex__ < this.__length__) return this.__nextIndex__++;
		this._unBind();
	}),
	_resolve: d(function (i) {
		var char = this.__list__[i], code;
		if (this.__nextIndex__ === this.__length__) return char;
		code = char.charCodeAt(0);
		if ((code >= 0xD800) && (code <= 0xDBFF)) return char + this.__list__[this.__nextIndex__++];
		return char;
	}),
	toString: d(function () { return '[object String Iterator]'; })
});

},{"./":56,"d":22,"es5-ext/object/set-prototype-of":44}],64:[function(require,module,exports){
'use strict';

var isIterable = require('./is-iterable');

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":57}],65:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./is-implemented":66,"./polyfill":67,"dup":58}],66:[function(require,module,exports){
'use strict';

module.exports = function () {
	var symbol;
	if (typeof Symbol !== 'function') return false;
	symbol = Symbol('test symbol');
	try { String(symbol); } catch (e) { return false; }
	if (typeof Symbol.iterator === 'symbol') return true;

	// Return 'true' for polyfills
	if (typeof Symbol.isConcatSpreadable !== 'object') return false;
	if (typeof Symbol.isRegExp !== 'object') return false;
	if (typeof Symbol.iterator !== 'object') return false;
	if (typeof Symbol.toPrimitive !== 'object') return false;
	if (typeof Symbol.toStringTag !== 'object') return false;
	if (typeof Symbol.unscopables !== 'object') return false;

	return true;
};

},{}],67:[function(require,module,exports){
'use strict';

var d = require('d')

  , create = Object.create, defineProperties = Object.defineProperties
  , generateName, Symbol;

generateName = (function () {
	var created = create(null);
	return function (desc) {
		var postfix = 0;
		while (created[desc + (postfix || '')]) ++postfix;
		desc += (postfix || '');
		created[desc] = true;
		return '@@' + desc;
	};
}());

module.exports = Symbol = function (description) {
	var symbol;
	if (this instanceof Symbol) {
		throw new TypeError('TypeError: Symbol is not a constructor');
	}
	symbol = create(Symbol.prototype);
	description = (description === undefined ? '' : String(description));
	return defineProperties(symbol, {
		__description__: d('', description),
		__name__: d('', generateName(description))
	});
};

Object.defineProperties(Symbol, {
	create: d('', Symbol('create')),
	hasInstance: d('', Symbol('hasInstance')),
	isConcatSpreadable: d('', Symbol('isConcatSpreadable')),
	isRegExp: d('', Symbol('isRegExp')),
	iterator: d('', Symbol('iterator')),
	toPrimitive: d('', Symbol('toPrimitive')),
	toStringTag: d('', Symbol('toStringTag')),
	unscopables: d('', Symbol('unscopables'))
});

defineProperties(Symbol.prototype, {
	properToString: d(function () {
		return 'Symbol (' + this.__description__ + ')';
	}),
	toString: d('', function () { return this.__name__; })
});
Object.defineProperty(Symbol.prototype, Symbol.toPrimitive, d('',
	function (hint) {
		throw new TypeError("Conversion of symbol objects is not allowed");
	}));
Object.defineProperty(Symbol.prototype, Symbol.toStringTag, d('c', 'Symbol'));

},{"d":22}],68:[function(require,module,exports){
'use strict';

var d        = require('d')
  , callable = require('es5-ext/object/valid-callable')

  , apply = Function.prototype.apply, call = Function.prototype.call
  , create = Object.create, defineProperty = Object.defineProperty
  , defineProperties = Object.defineProperties
  , hasOwnProperty = Object.prototype.hasOwnProperty
  , descriptor = { configurable: true, enumerable: false, writable: true }

  , on, once, off, emit, methods, descriptors, base;

on = function (type, listener) {
	var data;

	callable(listener);

	if (!hasOwnProperty.call(this, '__ee__')) {
		data = descriptor.value = create(null);
		defineProperty(this, '__ee__', descriptor);
		descriptor.value = null;
	} else {
		data = this.__ee__;
	}
	if (!data[type]) data[type] = listener;
	else if (typeof data[type] === 'object') data[type].push(listener);
	else data[type] = [data[type], listener];

	return this;
};

once = function (type, listener) {
	var once, self;

	callable(listener);
	self = this;
	on.call(this, type, once = function () {
		off.call(self, type, once);
		apply.call(listener, this, arguments);
	});

	once.__eeOnceListener__ = listener;
	return this;
};

off = function (type, listener) {
	var data, listeners, candidate, i;

	callable(listener);

	if (!hasOwnProperty.call(this, '__ee__')) return this;
	data = this.__ee__;
	if (!data[type]) return this;
	listeners = data[type];

	if (typeof listeners === 'object') {
		for (i = 0; (candidate = listeners[i]); ++i) {
			if ((candidate === listener) ||
					(candidate.__eeOnceListener__ === listener)) {
				if (listeners.length === 2) data[type] = listeners[i ? 0 : 1];
				else listeners.splice(i, 1);
			}
		}
	} else {
		if ((listeners === listener) ||
				(listeners.__eeOnceListener__ === listener)) {
			delete data[type];
		}
	}

	return this;
};

emit = function (type) {
	var i, l, listener, listeners, args;

	if (!hasOwnProperty.call(this, '__ee__')) return;
	listeners = this.__ee__[type];
	if (!listeners) return;

	if (typeof listeners === 'object') {
		l = arguments.length;
		args = new Array(l - 1);
		for (i = 1; i < l; ++i) args[i - 1] = arguments[i];

		listeners = listeners.slice();
		for (i = 0; (listener = listeners[i]); ++i) {
			apply.call(listener, this, args);
		}
	} else {
		switch (arguments.length) {
		case 1:
			call.call(listeners, this);
			break;
		case 2:
			call.call(listeners, this, arguments[1]);
			break;
		case 3:
			call.call(listeners, this, arguments[1], arguments[2]);
			break;
		default:
			l = arguments.length;
			args = new Array(l - 1);
			for (i = 1; i < l; ++i) {
				args[i - 1] = arguments[i];
			}
			apply.call(listeners, this, args);
		}
	}
};

methods = {
	on: on,
	once: once,
	off: off,
	emit: emit
};

descriptors = {
	on: d(on),
	once: d(once),
	off: d(off),
	emit: d(emit)
};

base = defineProperties({}, descriptors);

module.exports = exports = function (o) {
	return (o == null) ? create(base) : defineProperties(Object(o), descriptors);
};
exports.methods = methods;

},{"d":22,"es5-ext/object/valid-callable":47}],69:[function(require,module,exports){
'use strict';

var clear          = require('es5-ext/array/#/clear')
  , eIndexOf       = require('es5-ext/array/#/e-index-of')
  , setPrototypeOf = require('es5-ext/object/set-prototype-of')
  , callable       = require('es5-ext/object/valid-callable')
  , d              = require('d')
  , ee             = require('event-emitter')
  , Symbol         = require('es6-symbol')
  , iterator       = require('es6-iterator/valid-iterable')
  , forOf          = require('es6-iterator/for-of')
  , Iterator       = require('./lib/iterator')
  , isNative       = require('./is-native-implemented')

  , call = Function.prototype.call, defineProperty = Object.defineProperty
  , SetPoly, getValues;

module.exports = SetPoly = function (/*iterable*/) {
	var iterable = arguments[0];
	if (!(this instanceof SetPoly)) return new SetPoly(iterable);
	if (this.__setData__ !== undefined) {
		throw new TypeError(this + " cannot be reinitialized");
	}
	if (iterable != null) iterator(iterable);
	defineProperty(this, '__setData__', d('c', []));
	if (!iterable) return;
	forOf(iterable, function (value) {
		if (eIndexOf.call(this, value) !== -1) return;
		this.push(value);
	}, this.__setData__);
};

if (isNative) {
	if (setPrototypeOf) setPrototypeOf(SetPoly, Set);
	SetPoly.prototype = Object.create(Set.prototype, {
		constructor: d(SetPoly)
	});
}

ee(Object.defineProperties(SetPoly.prototype, {
	add: d(function (value) {
		if (this.has(value)) return this;
		this.emit('_add', this.__setData__.push(value) - 1, value);
		return this;
	}),
	clear: d(function () {
		if (!this.__setData__.length) return;
		clear.call(this.__setData__);
		this.emit('_clear');
	}),
	delete: d(function (value) {
		var index = eIndexOf.call(this.__setData__, value);
		if (index === -1) return false;
		this.__setData__.splice(index, 1);
		this.emit('_delete', index, value);
		return true;
	}),
	entries: d(function () { return new Iterator(this, 'key+value'); }),
	forEach: d(function (cb/*, thisArg*/) {
		var thisArg = arguments[1], iterator, result, value;
		callable(cb);
		iterator = this.values();
		result = iterator._next();
		while (result !== undefined) {
			value = iterator._resolve(result);
			call.call(cb, thisArg, value, value, this);
			result = iterator._next();
		}
	}),
	has: d(function (value) {
		return (eIndexOf.call(this.__setData__, value) !== -1);
	}),
	keys: d(getValues = function () { return this.values(); }),
	size: d.gs(function () { return this.__setData__.length; }),
	values: d(function () { return new Iterator(this); }),
	toString: d(function () { return '[object Set]'; })
}));
defineProperty(SetPoly.prototype, Symbol.iterator, d(getValues));
defineProperty(SetPoly.prototype, Symbol.toStringTag, d('c', 'Set'));

},{"./is-native-implemented":19,"./lib/iterator":20,"d":22,"es5-ext/array/#/clear":23,"es5-ext/array/#/e-index-of":24,"es5-ext/object/set-prototype-of":44,"es5-ext/object/valid-callable":47,"es6-iterator/for-of":54,"es6-iterator/valid-iterable":64,"es6-symbol":65,"event-emitter":68}],70:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ?
		WeakMap : require('./polyfill');

},{"./is-implemented":71,"./polyfill":112}],71:[function(require,module,exports){
'use strict';

module.exports = function () {
	var map;
	if (typeof WeakMap !== 'function') return false;
	map = new WeakMap();
	if (typeof map.set !== 'function') return false;
	if (map.set({}, 1) !== map) return false;
	if (typeof map.clear !== 'function') return false;
	if (typeof map.delete !== 'function') return false;
	if (typeof map.has !== 'function') return false;

	return true;
};

},{}],72:[function(require,module,exports){
// Exports true if environment provides native `WeakMap` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof WeakMap === 'undefined') return false;
	return (Object.prototype.toString.call(WeakMap.prototype) ===
			'[object WeakMap]');
}());

},{}],73:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"dup":21,"es5-ext/object/copy":80,"es5-ext/object/map":88,"es5-ext/object/valid-callable":93,"es5-ext/object/valid-value":95}],74:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22,"es5-ext/object/assign":77,"es5-ext/object/is-callable":83,"es5-ext/object/normalize-options":89,"es5-ext/string/#/contains":96}],75:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../object/valid-value":95,"dup":23}],76:[function(require,module,exports){
arguments[4][30][0].apply(exports,arguments)
},{"./is-callable":83,"./valid-callable":93,"./valid-value":95,"dup":30}],77:[function(require,module,exports){
arguments[4][31][0].apply(exports,arguments)
},{"./is-implemented":78,"./shim":79,"dup":31}],78:[function(require,module,exports){
arguments[4][32][0].apply(exports,arguments)
},{"dup":32}],79:[function(require,module,exports){
arguments[4][33][0].apply(exports,arguments)
},{"../keys":85,"../valid-value":95,"dup":33}],80:[function(require,module,exports){
arguments[4][34][0].apply(exports,arguments)
},{"./assign":77,"./valid-value":95,"dup":34}],81:[function(require,module,exports){
arguments[4][35][0].apply(exports,arguments)
},{"./set-prototype-of/is-implemented":91,"./set-prototype-of/shim":92,"dup":35}],82:[function(require,module,exports){
arguments[4][36][0].apply(exports,arguments)
},{"./_iterate":76,"dup":36}],83:[function(require,module,exports){
arguments[4][37][0].apply(exports,arguments)
},{"dup":37}],84:[function(require,module,exports){
arguments[4][38][0].apply(exports,arguments)
},{"dup":38}],85:[function(require,module,exports){
arguments[4][39][0].apply(exports,arguments)
},{"./is-implemented":86,"./shim":87,"dup":39}],86:[function(require,module,exports){
arguments[4][40][0].apply(exports,arguments)
},{"dup":40}],87:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"dup":41}],88:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"./for-each":82,"./valid-callable":93,"dup":42}],89:[function(require,module,exports){
arguments[4][43][0].apply(exports,arguments)
},{"dup":43}],90:[function(require,module,exports){
arguments[4][44][0].apply(exports,arguments)
},{"./is-implemented":91,"./shim":92,"dup":44}],91:[function(require,module,exports){
arguments[4][45][0].apply(exports,arguments)
},{"dup":45}],92:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"../create":81,"../is-object":84,"../valid-value":95,"dup":46}],93:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"dup":47}],94:[function(require,module,exports){
'use strict';

var isObject = require('./is-object');

module.exports = function (value) {
	if (!isObject(value)) throw new TypeError(value + " is not an Object");
	return value;
};

},{"./is-object":84}],95:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}],96:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"./is-implemented":97,"./shim":98,"dup":49}],97:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],98:[function(require,module,exports){
arguments[4][51][0].apply(exports,arguments)
},{"dup":51}],99:[function(require,module,exports){
arguments[4][52][0].apply(exports,arguments)
},{"dup":52}],100:[function(require,module,exports){
arguments[4][53][0].apply(exports,arguments)
},{"./":103,"d":74,"dup":53,"es5-ext/object/set-prototype-of":90,"es5-ext/string/#/contains":96}],101:[function(require,module,exports){
arguments[4][54][0].apply(exports,arguments)
},{"./get":102,"dup":54,"es5-ext/object/valid-callable":93,"es5-ext/string/is-string":99}],102:[function(require,module,exports){
arguments[4][55][0].apply(exports,arguments)
},{"./array":100,"./string":105,"./valid-iterable":106,"dup":55,"es5-ext/string/is-string":99,"es6-symbol":107}],103:[function(require,module,exports){
arguments[4][56][0].apply(exports,arguments)
},{"d":74,"d/auto-bind":73,"dup":56,"es5-ext/array/#/clear":75,"es5-ext/object/assign":77,"es5-ext/object/valid-callable":93,"es5-ext/object/valid-value":95,"es6-symbol":107}],104:[function(require,module,exports){
arguments[4][57][0].apply(exports,arguments)
},{"dup":57,"es5-ext/string/is-string":99,"es6-symbol":107}],105:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./":103,"d":74,"dup":63,"es5-ext/object/set-prototype-of":90}],106:[function(require,module,exports){
arguments[4][64][0].apply(exports,arguments)
},{"./is-iterable":104,"dup":64}],107:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./is-implemented":108,"./polyfill":110,"dup":58}],108:[function(require,module,exports){
arguments[4][59][0].apply(exports,arguments)
},{"dup":59}],109:[function(require,module,exports){
arguments[4][60][0].apply(exports,arguments)
},{"dup":60}],110:[function(require,module,exports){
arguments[4][61][0].apply(exports,arguments)
},{"./validate-symbol":111,"d":74,"dup":61}],111:[function(require,module,exports){
arguments[4][62][0].apply(exports,arguments)
},{"./is-symbol":109,"dup":62}],112:[function(require,module,exports){
'use strict';

var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
  , object            = require('es5-ext/object/valid-object')
  , value             = require('es5-ext/object/valid-value')
  , d                 = require('d')
  , getIterator       = require('es6-iterator/get')
  , forOf             = require('es6-iterator/for-of')
  , toStringTagSymbol = require('es6-symbol').toStringTag
  , isNative          = require('./is-native-implemented')

  , isArray = Array.isArray, defineProperty = Object.defineProperty, random = Math.random
  , hasOwnProperty = Object.prototype.hasOwnProperty
  , genId, WeakMapPoly;

genId = (function () {
	var generated = Object.create(null);
	return function () {
		var id;
		do { id = random().toString(36).slice(2); } while (generated[id]);
		generated[id] = true;
		return id;
	};
}());

module.exports = WeakMapPoly = function (/*iterable*/) {
	var iterable = arguments[0];
	if (!(this instanceof WeakMapPoly)) return new WeakMapPoly(iterable);
	if (this.__weakMapData__ !== undefined) {
		throw new TypeError(this + " cannot be reinitialized");
	}
	if (iterable != null) {
		if (!isArray(iterable)) iterable = getIterator(iterable);
	}
	defineProperty(this, '__weakMapData__', d('c', '$weakMap$' + genId()));
	if (!iterable) return;
	forOf(iterable, function (val) {
		value(val);
		this.set(val[0], val[1]);
	}, this);
};

if (isNative) {
	if (setPrototypeOf) setPrototypeOf(WeakMapPoly, WeakMap);
	WeakMapPoly.prototype = Object.create(WeakMap.prototype, {
		constructor: d(WeakMapPoly)
	});
}

Object.defineProperties(WeakMapPoly.prototype, {
	clear: d(function () {
		defineProperty(this, '__weakMapData__', d('c', '$weakMap$' + genId()));
	}),
	delete: d(function (key) {
		if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
			delete key[this.__weakMapData__];
			return true;
		}
		return false;
	}),
	get: d(function (key) {
		if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
			return key[this.__weakMapData__];
		}
	}),
	has: d(function (key) {
		return hasOwnProperty.call(object(key), this.__weakMapData__);
	}),
	set: d(function (key, value) {
		defineProperty(object(key), this.__weakMapData__, d('c', value));
		return this;
	}),
	toString: d(function () { return '[object WeakMap]'; })
});
defineProperty(WeakMapPoly.prototype, toStringTagSymbol, d('c', 'WeakMap'));

},{"./is-native-implemented":72,"d":74,"es5-ext/object/set-prototype-of":90,"es5-ext/object/valid-object":94,"es5-ext/object/valid-value":95,"es6-iterator/for-of":101,"es6-iterator/get":102,"es6-symbol":107}],113:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Map : require('./polyfill');

},{"./is-implemented":114,"./polyfill":167}],114:[function(require,module,exports){
'use strict';

module.exports = function () {
	var map, iterator, result;
	if (typeof Map !== 'function') return false;
	try {
		// WebKit doesn't support arguments and crashes
		map = new Map([['raz', 'one'], ['dwa', 'two'], ['trzy', 'three']]);
	} catch (e) {
		return false;
	}
	if (map.size !== 3) return false;
	if (typeof map.clear !== 'function') return false;
	if (typeof map.delete !== 'function') return false;
	if (typeof map.entries !== 'function') return false;
	if (typeof map.forEach !== 'function') return false;
	if (typeof map.get !== 'function') return false;
	if (typeof map.has !== 'function') return false;
	if (typeof map.keys !== 'function') return false;
	if (typeof map.set !== 'function') return false;
	if (typeof map.values !== 'function') return false;

	iterator = map.entries();
	result = iterator.next();
	if (result.done !== false) return false;
	if (!result.value) return false;
	if (result.value[0] !== 'raz') return false;
	if (result.value[1] !== 'one') return false;
	return true;
};

},{}],115:[function(require,module,exports){
// Exports true if environment provides native `Map` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Map === 'undefined') return false;
	return (Object.prototype.toString.call(Map.prototype) === '[object Map]');
}());

},{}],116:[function(require,module,exports){
'use strict';

module.exports = require('es5-ext/object/primitive-set')('key',
	'value', 'key+value');

},{"es5-ext/object/primitive-set":141}],117:[function(require,module,exports){
'use strict';

var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
  , d                 = require('d')
  , Iterator          = require('es6-iterator')
  , toStringTagSymbol = require('es6-symbol').toStringTag
  , kinds             = require('./iterator-kinds')

  , defineProperties = Object.defineProperties
  , unBind = Iterator.prototype._unBind
  , MapIterator;

MapIterator = module.exports = function (map, kind) {
	if (!(this instanceof MapIterator)) return new MapIterator(map, kind);
	Iterator.call(this, map.__mapKeysData__, map);
	if (!kind || !kinds[kind]) kind = 'key+value';
	defineProperties(this, {
		__kind__: d('', kind),
		__values__: d('w', map.__mapValuesData__)
	});
};
if (setPrototypeOf) setPrototypeOf(MapIterator, Iterator);

MapIterator.prototype = Object.create(Iterator.prototype, {
	constructor: d(MapIterator),
	_resolve: d(function (i) {
		if (this.__kind__ === 'value') return this.__values__[i];
		if (this.__kind__ === 'key') return this.__list__[i];
		return [this.__list__[i], this.__values__[i]];
	}),
	_unBind: d(function () {
		this.__values__ = null;
		unBind.call(this);
	}),
	toString: d(function () { return '[object Map Iterator]'; })
});
Object.defineProperty(MapIterator.prototype, toStringTagSymbol,
	d('c', 'Map Iterator'));

},{"./iterator-kinds":116,"d":119,"es5-ext/object/set-prototype-of":142,"es6-iterator":154,"es6-symbol":163}],118:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"dup":21,"es5-ext/object/copy":131,"es5-ext/object/map":139,"es5-ext/object/valid-callable":145,"es5-ext/object/valid-value":146}],119:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22,"es5-ext/object/assign":128,"es5-ext/object/is-callable":134,"es5-ext/object/normalize-options":140,"es5-ext/string/#/contains":147}],120:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../object/valid-value":146,"dup":23}],121:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../number/to-pos-integer":126,"../../object/valid-value":146,"dup":24}],122:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"./is-implemented":123,"./shim":124,"dup":25}],123:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"dup":26}],124:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27}],125:[function(require,module,exports){
arguments[4][28][0].apply(exports,arguments)
},{"../math/sign":122,"dup":28}],126:[function(require,module,exports){
arguments[4][29][0].apply(exports,arguments)
},{"./to-integer":125,"dup":29}],127:[function(require,module,exports){
arguments[4][30][0].apply(exports,arguments)
},{"./is-callable":134,"./valid-callable":145,"./valid-value":146,"dup":30}],128:[function(require,module,exports){
arguments[4][31][0].apply(exports,arguments)
},{"./is-implemented":129,"./shim":130,"dup":31}],129:[function(require,module,exports){
arguments[4][32][0].apply(exports,arguments)
},{"dup":32}],130:[function(require,module,exports){
arguments[4][33][0].apply(exports,arguments)
},{"../keys":136,"../valid-value":146,"dup":33}],131:[function(require,module,exports){
arguments[4][34][0].apply(exports,arguments)
},{"./assign":128,"./valid-value":146,"dup":34}],132:[function(require,module,exports){
arguments[4][35][0].apply(exports,arguments)
},{"./set-prototype-of/is-implemented":143,"./set-prototype-of/shim":144,"dup":35}],133:[function(require,module,exports){
arguments[4][36][0].apply(exports,arguments)
},{"./_iterate":127,"dup":36}],134:[function(require,module,exports){
arguments[4][37][0].apply(exports,arguments)
},{"dup":37}],135:[function(require,module,exports){
arguments[4][38][0].apply(exports,arguments)
},{"dup":38}],136:[function(require,module,exports){
arguments[4][39][0].apply(exports,arguments)
},{"./is-implemented":137,"./shim":138,"dup":39}],137:[function(require,module,exports){
arguments[4][40][0].apply(exports,arguments)
},{"dup":40}],138:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"dup":41}],139:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"./for-each":133,"./valid-callable":145,"dup":42}],140:[function(require,module,exports){
arguments[4][43][0].apply(exports,arguments)
},{"dup":43}],141:[function(require,module,exports){
'use strict';

var forEach = Array.prototype.forEach, create = Object.create;

module.exports = function (arg/*, …args*/) {
	var set = create(null);
	forEach.call(arguments, function (name) { set[name] = true; });
	return set;
};

},{}],142:[function(require,module,exports){
arguments[4][44][0].apply(exports,arguments)
},{"./is-implemented":143,"./shim":144,"dup":44}],143:[function(require,module,exports){
arguments[4][45][0].apply(exports,arguments)
},{"dup":45}],144:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"../create":132,"../is-object":135,"../valid-value":146,"dup":46}],145:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"dup":47}],146:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}],147:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"./is-implemented":148,"./shim":149,"dup":49}],148:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],149:[function(require,module,exports){
arguments[4][51][0].apply(exports,arguments)
},{"dup":51}],150:[function(require,module,exports){
arguments[4][52][0].apply(exports,arguments)
},{"dup":52}],151:[function(require,module,exports){
arguments[4][53][0].apply(exports,arguments)
},{"./":154,"d":119,"dup":53,"es5-ext/object/set-prototype-of":142,"es5-ext/string/#/contains":147}],152:[function(require,module,exports){
arguments[4][54][0].apply(exports,arguments)
},{"./get":153,"dup":54,"es5-ext/object/valid-callable":145,"es5-ext/string/is-string":150}],153:[function(require,module,exports){
arguments[4][55][0].apply(exports,arguments)
},{"./array":151,"./string":161,"./valid-iterable":162,"dup":55,"es5-ext/string/is-string":150,"es6-symbol":156}],154:[function(require,module,exports){
arguments[4][56][0].apply(exports,arguments)
},{"d":119,"d/auto-bind":118,"dup":56,"es5-ext/array/#/clear":120,"es5-ext/object/assign":128,"es5-ext/object/valid-callable":145,"es5-ext/object/valid-value":146,"es6-symbol":156}],155:[function(require,module,exports){
arguments[4][57][0].apply(exports,arguments)
},{"dup":57,"es5-ext/string/is-string":150,"es6-symbol":156}],156:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./is-implemented":157,"./polyfill":159,"dup":58}],157:[function(require,module,exports){
arguments[4][59][0].apply(exports,arguments)
},{"dup":59}],158:[function(require,module,exports){
arguments[4][60][0].apply(exports,arguments)
},{"dup":60}],159:[function(require,module,exports){
arguments[4][61][0].apply(exports,arguments)
},{"./validate-symbol":160,"d":119,"dup":61}],160:[function(require,module,exports){
arguments[4][62][0].apply(exports,arguments)
},{"./is-symbol":158,"dup":62}],161:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./":154,"d":119,"dup":63,"es5-ext/object/set-prototype-of":142}],162:[function(require,module,exports){
arguments[4][64][0].apply(exports,arguments)
},{"./is-iterable":155,"dup":64}],163:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./is-implemented":164,"./polyfill":165,"dup":58}],164:[function(require,module,exports){
arguments[4][66][0].apply(exports,arguments)
},{"dup":66}],165:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"d":119,"dup":67}],166:[function(require,module,exports){
arguments[4][68][0].apply(exports,arguments)
},{"d":119,"dup":68,"es5-ext/object/valid-callable":145}],167:[function(require,module,exports){
'use strict';

var clear          = require('es5-ext/array/#/clear')
  , eIndexOf       = require('es5-ext/array/#/e-index-of')
  , setPrototypeOf = require('es5-ext/object/set-prototype-of')
  , callable       = require('es5-ext/object/valid-callable')
  , validValue     = require('es5-ext/object/valid-value')
  , d              = require('d')
  , ee             = require('event-emitter')
  , Symbol         = require('es6-symbol')
  , iterator       = require('es6-iterator/valid-iterable')
  , forOf          = require('es6-iterator/for-of')
  , Iterator       = require('./lib/iterator')
  , isNative       = require('./is-native-implemented')

  , call = Function.prototype.call, defineProperties = Object.defineProperties
  , MapPoly;

module.exports = MapPoly = function (/*iterable*/) {
	var iterable = arguments[0], keys, values;
	if (!(this instanceof MapPoly)) return new MapPoly(iterable);
	if (this.__mapKeysData__ !== undefined) {
		throw new TypeError(this + " cannot be reinitialized");
	}
	if (iterable != null) iterator(iterable);
	defineProperties(this, {
		__mapKeysData__: d('c', keys = []),
		__mapValuesData__: d('c', values = [])
	});
	if (!iterable) return;
	forOf(iterable, function (value) {
		var key = validValue(value)[0];
		value = value[1];
		if (eIndexOf.call(keys, key) !== -1) return;
		keys.push(key);
		values.push(value);
	}, this);
};

if (isNative) {
	if (setPrototypeOf) setPrototypeOf(MapPoly, Map);
	MapPoly.prototype = Object.create(Map.prototype, {
		constructor: d(MapPoly)
	});
}

ee(defineProperties(MapPoly.prototype, {
	clear: d(function () {
		if (!this.__mapKeysData__.length) return;
		clear.call(this.__mapKeysData__);
		clear.call(this.__mapValuesData__);
		this.emit('_clear');
	}),
	delete: d(function (key) {
		var index = eIndexOf.call(this.__mapKeysData__, key);
		if (index === -1) return false;
		this.__mapKeysData__.splice(index, 1);
		this.__mapValuesData__.splice(index, 1);
		this.emit('_delete', index, key);
		return true;
	}),
	entries: d(function () { return new Iterator(this, 'key+value'); }),
	forEach: d(function (cb/*, thisArg*/) {
		var thisArg = arguments[1], iterator, result;
		callable(cb);
		iterator = this.entries();
		result = iterator._next();
		while (result !== undefined) {
			call.call(cb, thisArg, this.__mapValuesData__[result],
				this.__mapKeysData__[result], this);
			result = iterator._next();
		}
	}),
	get: d(function (key) {
		var index = eIndexOf.call(this.__mapKeysData__, key);
		if (index === -1) return;
		return this.__mapValuesData__[index];
	}),
	has: d(function (key) {
		return (eIndexOf.call(this.__mapKeysData__, key) !== -1);
	}),
	keys: d(function () { return new Iterator(this, 'key'); }),
	set: d(function (key, value) {
		var index = eIndexOf.call(this.__mapKeysData__, key), emit;
		if (index === -1) {
			index = this.__mapKeysData__.push(key) - 1;
			emit = true;
		}
		this.__mapValuesData__[index] = value;
		if (emit) this.emit('_add', index, key);
		return this;
	}),
	size: d.gs(function () { return this.__mapKeysData__.length; }),
	values: d(function () { return new Iterator(this, 'value'); }),
	toString: d(function () { return '[object Map]'; })
}));
Object.defineProperty(MapPoly.prototype, Symbol.iterator, d(function () {
	return this.entries();
}));
Object.defineProperty(MapPoly.prototype, Symbol.toStringTag, d('c', 'Map'));

},{"./is-native-implemented":115,"./lib/iterator":117,"d":119,"es5-ext/array/#/clear":120,"es5-ext/array/#/e-index-of":121,"es5-ext/object/set-prototype-of":142,"es5-ext/object/valid-callable":145,"es5-ext/object/valid-value":146,"es6-iterator/for-of":152,"es6-iterator/valid-iterable":162,"es6-symbol":163,"event-emitter":166}],168:[function(require,module,exports){
function flatMerge(a,b){
    if(!b || typeof b !== 'object'){
        b = {};
    }

    if(!a || typeof a !== 'object'){
        a = new b.constructor();
    }

    var result = new a.constructor(),
        aKeys = Object.keys(a),
        bKeys = Object.keys(b);

    for(var i = 0; i < aKeys.length; i++){
        result[aKeys[i]] = a[aKeys[i]];
    }

    for(var i = 0; i < bKeys.length; i++){
        result[bKeys[i]] = b[bKeys[i]];
    }

    return result;
}

module.exports = flatMerge;
},{}],169:[function(require,module,exports){
module.exports = function isSame(a, b){
    if(a === b){
        return true;
    }

    if(
        typeof a !== typeof b || 
        typeof a === 'object' && 
        !(a instanceof Date && b instanceof Date)
    ){
        return false;
    }

    return a + '' === b + '';
};
},{}],170:[function(require,module,exports){
(function (process){
var defined = require('defined');
var createDefaultStream = require('./lib/default_stream');
var Test = require('./lib/test');
var createResult = require('./lib/results');
var through = require('through');

var canEmitExit = typeof process !== 'undefined' && process
    && typeof process.on === 'function' && process.browser !== true
;
var canExit = typeof process !== 'undefined' && process
    && typeof process.exit === 'function'
;

var nextTick = typeof setImmediate !== 'undefined'
    ? setImmediate
    : process.nextTick
;

exports = module.exports = (function () {
    var harness;
    var lazyLoad = function () {
        return getHarness().apply(this, arguments);
    };
    
    lazyLoad.only = function () {
        return getHarness().only.apply(this, arguments);
    };
    
    lazyLoad.createStream = function (opts) {
        if (!opts) opts = {};
        if (!harness) {
            var output = through();
            getHarness({ stream: output, objectMode: opts.objectMode });
            return output;
        }
        return harness.createStream(opts);
    };
    
    return lazyLoad
    
    function getHarness (opts) {
        if (!opts) opts = {};
        opts.autoclose = !canEmitExit;
        if (!harness) harness = createExitHarness(opts);
        return harness;
    }
})();

function createExitHarness (conf) {
    if (!conf) conf = {};
    var harness = createHarness({
        autoclose: defined(conf.autoclose, false)
    });
    
    var stream = harness.createStream({ objectMode: conf.objectMode });
    var es = stream.pipe(conf.stream || createDefaultStream());
    if (canEmitExit) {
        es.on('error', function (err) { harness._exitCode = 1 });
    }
    
    var ended = false;
    stream.on('end', function () { ended = true });
    
    if (conf.exit === false) return harness;
    if (!canEmitExit || !canExit) return harness;

    var inErrorState = false;

    process.on('exit', function (code) {
        // let the process exit cleanly.
        if (code !== 0) {
            return
        }

        if (!ended) {
            var only = harness._results._only;
            for (var i = 0; i < harness._tests.length; i++) {
                var t = harness._tests[i];
                if (only && t.name !== only) continue;
                t._exit();
            }
        }
        harness.close();
        process.exit(code || harness._exitCode);
    });
    
    return harness;
}

exports.createHarness = createHarness;
exports.Test = Test;
exports.test = exports; // tap compat
exports.test.skip = Test.skip;

var exitInterval;

function createHarness (conf_) {
    if (!conf_) conf_ = {};
    var results = createResult();
    if (conf_.autoclose !== false) {
        results.once('done', function () { results.close() });
    }
    
    var test = function (name, conf, cb) {
        var t = new Test(name, conf, cb);
        test._tests.push(t);
        
        (function inspectCode (st) {
            st.on('test', function sub (st_) {
                inspectCode(st_);
            });
            st.on('result', function (r) {
                if (!r.ok) test._exitCode = 1
            });
        })(t);
        
        results.push(t);
        return t;
    };
    test._results = results;
    
    test._tests = [];
    
    test.createStream = function (opts) {
        return results.createStream(opts);
    };
    
    var only = false;
    test.only = function (name) {
        if (only) throw new Error('there can only be one only test');
        results.only(name);
        only = true;
        return test.apply(null, arguments);
    };
    test._exitCode = 0;
    
    test.close = function () { results.close() };
    
    return test;
}

}).call(this,require('_process'))

},{"./lib/default_stream":171,"./lib/results":172,"./lib/test":173,"_process":211,"defined":177,"through":181}],171:[function(require,module,exports){
(function (process){
var through = require('through');
var fs = require('fs');

module.exports = function () {
    var line = '';
    var stream = through(write, flush);
    return stream;
    
    function write (buf) {
        for (var i = 0; i < buf.length; i++) {
            var c = typeof buf === 'string'
                ? buf.charAt(i)
                : String.fromCharCode(buf[i])
            ;
            if (c === '\n') flush();
            else line += c;
        }
    }
    
    function flush () {
        if (fs.writeSync && /^win/.test(process.platform)) {
            try { fs.writeSync(1, line + '\n'); }
            catch (e) { stream.emit('error', e) }
        }
        else {
            try { console.log(line) }
            catch (e) { stream.emit('error', e) }
        }
        line = '';
    }
};

}).call(this,require('_process'))

},{"_process":211,"fs":201,"through":181}],172:[function(require,module,exports){
(function (process){
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var through = require('through');
var resumer = require('resumer');
var inspect = require('object-inspect');
var nextTick = typeof setImmediate !== 'undefined'
    ? setImmediate
    : process.nextTick
;

module.exports = Results;
inherits(Results, EventEmitter);

function Results () {
    if (!(this instanceof Results)) return new Results;
    this.count = 0;
    this.fail = 0;
    this.pass = 0;
    this._stream = through();
    this.tests = [];
}

Results.prototype.createStream = function (opts) {
    if (!opts) opts = {};
    var self = this;
    var output, testId = 0;
    if (opts.objectMode) {
        output = through();
        self.on('_push', function ontest (t, extra) {
            if (!extra) extra = {};
            var id = testId++;
            t.once('prerun', function () {
                var row = {
                    type: 'test',
                    name: t.name,
                    id: id
                };
                if (has(extra, 'parent')) {
                    row.parent = extra.parent;
                }
                output.queue(row);
            });
            t.on('test', function (st) {
                ontest(st, { parent: id });
            });
            t.on('result', function (res) {
                res.test = id;
                res.type = 'assert';
                output.queue(res);
            });
            t.on('end', function () {
                output.queue({ type: 'end', test: id });
            });
        });
        self.on('done', function () { output.queue(null) });
    }
    else {
        output = resumer();
        output.queue('TAP version 13\n');
        self._stream.pipe(output);
    }
    
    nextTick(function next() {
        var t;
        while (t = getNextTest(self)) {
            t.run();
            if (!t.ended) return t.once('end', function(){ nextTick(next); });
        }
        self.emit('done');
    });
    
    return output;
};

Results.prototype.push = function (t) {
    var self = this;
    self.tests.push(t);
    self._watch(t);
    self.emit('_push', t);
};

Results.prototype.only = function (name) {
    if (this._only) {
        self.count ++;
        self.fail ++;
        write('not ok ' + self.count + ' already called .only()\n');
    }
    this._only = name;
};

Results.prototype._watch = function (t) {
    var self = this;
    var write = function (s) { self._stream.queue(s) };
    t.once('prerun', function () {
        write('# ' + t.name + '\n');
    });
    
    t.on('result', function (res) {
        if (typeof res === 'string') {
            write('# ' + res + '\n');
            return;
        }
        write(encodeResult(res, self.count + 1));
        self.count ++;

        if (res.ok) self.pass ++
        else self.fail ++
    });
    
    t.on('test', function (st) { self._watch(st) });
};

Results.prototype.close = function () {
    var self = this;
    if (self.closed) self._stream.emit('error', new Error('ALREADY CLOSED'));
    self.closed = true;
    var write = function (s) { self._stream.queue(s) };
    
    write('\n1..' + self.count + '\n');
    write('# tests ' + self.count + '\n');
    write('# pass  ' + self.pass + '\n');
    if (self.fail) write('# fail  ' + self.fail + '\n')
    else write('\n# ok\n')

    self._stream.queue(null);
};

function encodeResult (res, count) {
    var output = '';
    output += (res.ok ? 'ok ' : 'not ok ') + count;
    output += res.name ? ' ' + res.name.toString().replace(/\s+/g, ' ') : '';
    
    if (res.skip) output += ' # SKIP';
    else if (res.todo) output += ' # TODO';
    
    output += '\n';
    if (res.ok) return output;
    
    var outer = '  ';
    var inner = outer + '  ';
    output += outer + '---\n';
    output += inner + 'operator: ' + res.operator + '\n';
    
    if (has(res, 'expected') || has(res, 'actual')) {
        var ex = inspect(res.expected);
        var ac = inspect(res.actual);
        
        if (Math.max(ex.length, ac.length) > 65) {
            output += inner + 'expected:\n' + inner + '  ' + ex + '\n';
            output += inner + 'actual:\n' + inner + '  ' + ac + '\n';
        }
        else {
            output += inner + 'expected: ' + ex + '\n';
            output += inner + 'actual:   ' + ac + '\n';
        }
    }
    if (res.at) {
        output += inner + 'at: ' + res.at + '\n';
    }
    if (res.operator === 'error' && res.actual && res.actual.stack) {
        var lines = String(res.actual.stack).split('\n');
        output += inner + 'stack:\n';
        output += inner + '  ' + lines[0] + '\n';
        for (var i = 1; i < lines.length; i++) {
            output += inner + lines[i] + '\n';
        }
    }
    
    output += outer + '...\n';
    return output;
}

function getNextTest (results) {
    if (!results._only) {
        return results.tests.shift();
    }
    
    do {
        var t = results.tests.shift();
        if (!t) continue;
        if (results._only === t.name) {
            return t;
        }
    } while (results.tests.length !== 0)
}

function has (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'))

},{"_process":211,"events":207,"inherits":178,"object-inspect":179,"resumer":180,"through":181}],173:[function(require,module,exports){
(function (process,__dirname){
var deepEqual = require('deep-equal');
var defined = require('defined');
var path = require('path');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

module.exports = Test;

var nextTick = typeof setImmediate !== 'undefined'
    ? setImmediate
    : process.nextTick
;

inherits(Test, EventEmitter);

var getTestArgs = function (name_, opts_, cb_) {
    var name = '(anonymous)';
    var opts = {};
    var cb;

    for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        var t = typeof arg;
        if (t === 'string') {
            name = arg;
        }
        else if (t === 'object') {
            opts = arg || opts;
        }
        else if (t === 'function') {
            cb = arg;
        }
    }
    return { name: name, opts: opts, cb: cb };
};

function Test (name_, opts_, cb_) {
    if (! (this instanceof Test)) {
        return new Test(name_, opts_, cb_);
    }

    var args = getTestArgs(name_, opts_, cb_);

    this.readable = true;
    this.name = args.name || '(anonymous)';
    this.assertCount = 0;
    this.pendingCount = 0;
    this._skip = args.opts.skip || false;
    this._plan = undefined;
    this._cb = args.cb;
    this._progeny = [];
    this._ok = true;

    if (args.opts.timeout !== undefined) {
        this.timeoutAfter(args.opts.timeout);
    }

    for (var prop in this) {
        this[prop] = (function bind(self, val) {
            if (typeof val === 'function') {
                return function bound() {
                    return val.apply(self, arguments);
                };
            }
            else return val;
        })(this, this[prop]);
    }
}

Test.prototype.run = function () {
    if (!this._cb || this._skip) {
        return this._end();
    }
    this.emit('prerun');
    this._cb(this);
    this.emit('run');
};

Test.prototype.test = function (name, opts, cb) {
    var self = this;
    var t = new Test(name, opts, cb);
    this._progeny.push(t);
    this.pendingCount++;
    this.emit('test', t);
    t.on('prerun', function () {
        self.assertCount++;
    })
    
    if (!self._pendingAsserts()) {
        nextTick(function () {
            self._end();
        });
    }
    
    nextTick(function() {
        if (!self._plan && self.pendingCount == self._progeny.length) {
            self._end();
        }
    });
};

Test.prototype.comment = function (msg) {
    this.emit('result', msg.trim().replace(/^#\s*/, ''));
};

Test.prototype.plan = function (n) {
    this._plan = n;
    this.emit('plan', n);
};

Test.prototype.timeoutAfter = function(ms) {
    if (!ms) throw new Error('timeoutAfter requires a timespan');
    var self = this;
    var timeout = setTimeout(function() {
        self.fail('test timed out after ' + ms + 'ms');
        self.end();
    }, ms);
    this.once('end', function() {
        clearTimeout(timeout);
    });
}

Test.prototype.end = function (err) { 
    var self = this;
    if (arguments.length >= 1) {
        this.ifError(err);
    }
    
    if (this.calledEnd) {
        this.fail('.end() called twice');
    }
    this.calledEnd = true;
    this._end();
};

Test.prototype._end = function (err) {
    var self = this;
    if (this._progeny.length) {
        var t = this._progeny.shift();
        t.on('end', function () { self._end() });
        t.run();
        return;
    }
    
    if (!this.ended) this.emit('end');
    var pendingAsserts = this._pendingAsserts();
    if (!this._planError && this._plan !== undefined && pendingAsserts) {
        this._planError = true;
        this.fail('plan != count', {
            expected : this._plan,
            actual : this.assertCount
        });
    }
    this.ended = true;
};

Test.prototype._exit = function () {
    if (this._plan !== undefined &&
        !this._planError && this.assertCount !== this._plan) {
        this._planError = true;
        this.fail('plan != count', {
            expected : this._plan,
            actual : this.assertCount,
            exiting : true
        });
    }
    else if (!this.ended) {
        this.fail('test exited without ending', {
            exiting: true
        });
    }
};

Test.prototype._pendingAsserts = function () {
    if (this._plan === undefined) {
        return 1;
    }
    else {
        return this._plan - (this._progeny.length + this.assertCount);
    }
};

Test.prototype._assert = function assert (ok, opts) {
    var self = this;
    var extra = opts.extra || {};
    
    var res = {
        id : self.assertCount ++,
        ok : Boolean(ok),
        skip : defined(extra.skip, opts.skip),
        name : defined(extra.message, opts.message, '(unnamed assert)'),
        operator : defined(extra.operator, opts.operator)
    };
    if (has(opts, 'actual') || has(extra, 'actual')) {
        res.actual = defined(extra.actual, opts.actual);
    }
    if (has(opts, 'expected') || has(extra, 'expected')) {
        res.expected = defined(extra.expected, opts.expected);
    }
    this._ok = Boolean(this._ok && ok);
    
    if (!ok) {
        res.error = defined(extra.error, opts.error, new Error(res.name));
    }
    
    if (!ok) {
        var e = new Error('exception');
        var err = (e.stack || '').split('\n');
        var dir = path.dirname(__dirname) + '/';
        
        for (var i = 0; i < err.length; i++) {
            var m = /^[^\s]*\s*\bat\s+(.+)/.exec(err[i]);
            if (!m) {
                continue;
            }
            
            var s = m[1].split(/\s+/);
            var filem = /(\/[^:\s]+:(\d+)(?::(\d+))?)/.exec(s[1]);
            if (!filem) {
                filem = /(\/[^:\s]+:(\d+)(?::(\d+))?)/.exec(s[2]);
                
                if (!filem) {
                    filem = /(\/[^:\s]+:(\d+)(?::(\d+))?)/.exec(s[3]);

                    if (!filem) {
                        continue;
                    }
                }
            }
            
            if (filem[1].slice(0, dir.length) === dir) {
                continue;
            }
            
            res.functionName = s[0];
            res.file = filem[1];
            res.line = Number(filem[2]);
            if (filem[3]) res.column = filem[3];
            
            res.at = m[1];
            break;
        }
    }

    self.emit('result', res);
    
    var pendingAsserts = self._pendingAsserts();
    if (!pendingAsserts) {
        if (extra.exiting) {
            self._end();
        } else {
            nextTick(function () {
                self._end();
            });
        }
    }
    
    if (!self._planError && pendingAsserts < 0) {
        self._planError = true;
        self.fail('plan != count', {
            expected : self._plan,
            actual : self._plan - pendingAsserts
        });
    }
};

Test.prototype.fail = function (msg, extra) {
    this._assert(false, {
        message : msg,
        operator : 'fail',
        extra : extra
    });
};

Test.prototype.pass = function (msg, extra) {
    this._assert(true, {
        message : msg,
        operator : 'pass',
        extra : extra
    });
};

Test.prototype.skip = function (msg, extra) {
    this._assert(true, {
        message : msg,
        operator : 'skip',
        skip : true,
        extra : extra
    });
};

Test.prototype.ok
= Test.prototype['true']
= Test.prototype.assert
= function (value, msg, extra) {
    this._assert(value, {
        message : msg,
        operator : 'ok',
        expected : true,
        actual : value,
        extra : extra
    });
};

Test.prototype.notOk
= Test.prototype['false']
= Test.prototype.notok
= function (value, msg, extra) {
    this._assert(!value, {
        message : msg,
        operator : 'notOk',
        expected : false,
        actual : value,
        extra : extra
    });
};

Test.prototype.error
= Test.prototype.ifError
= Test.prototype.ifErr
= Test.prototype.iferror
= function (err, msg, extra) {
    this._assert(!err, {
        message : defined(msg, String(err)),
        operator : 'error',
        actual : err,
        extra : extra
    });
};

Test.prototype.equal
= Test.prototype.equals
= Test.prototype.isEqual
= Test.prototype.is
= Test.prototype.strictEqual
= Test.prototype.strictEquals
= function (a, b, msg, extra) {
    this._assert(a === b, {
        message : defined(msg, 'should be equal'),
        operator : 'equal',
        actual : a,
        expected : b,
        extra : extra
    });
};

Test.prototype.notEqual
= Test.prototype.notEquals
= Test.prototype.notStrictEqual
= Test.prototype.notStrictEquals
= Test.prototype.isNotEqual
= Test.prototype.isNot
= Test.prototype.not
= Test.prototype.doesNotEqual
= Test.prototype.isInequal
= function (a, b, msg, extra) {
    this._assert(a !== b, {
        message : defined(msg, 'should not be equal'),
        operator : 'notEqual',
        actual : a,
        notExpected : b,
        extra : extra
    });
};

Test.prototype.deepEqual
= Test.prototype.deepEquals
= Test.prototype.isEquivalent
= Test.prototype.same
= function (a, b, msg, extra) {
    this._assert(deepEqual(a, b, { strict: true }), {
        message : defined(msg, 'should be equivalent'),
        operator : 'deepEqual',
        actual : a,
        expected : b,
        extra : extra
    });
};

Test.prototype.deepLooseEqual
= Test.prototype.looseEqual
= Test.prototype.looseEquals
= function (a, b, msg, extra) {
    this._assert(deepEqual(a, b), {
        message : defined(msg, 'should be equivalent'),
        operator : 'deepLooseEqual',
        actual : a,
        expected : b,
        extra : extra
    });
};

Test.prototype.notDeepEqual
= Test.prototype.notEquivalent
= Test.prototype.notDeeply
= Test.prototype.notSame
= Test.prototype.isNotDeepEqual
= Test.prototype.isNotDeeply
= Test.prototype.isNotEquivalent
= Test.prototype.isInequivalent
= function (a, b, msg, extra) {
    this._assert(!deepEqual(a, b, { strict: true }), {
        message : defined(msg, 'should not be equivalent'),
        operator : 'notDeepEqual',
        actual : a,
        notExpected : b,
        extra : extra
    });
};

Test.prototype.notDeepLooseEqual
= Test.prototype.notLooseEqual
= Test.prototype.notLooseEquals
= function (a, b, msg, extra) {
    this._assert(!deepEqual(a, b), {
        message : defined(msg, 'should be equivalent'),
        operator : 'notDeepLooseEqual',
        actual : a,
        expected : b,
        extra : extra
    });
};

Test.prototype['throws'] = function (fn, expected, msg, extra) {
    if (typeof expected === 'string') {
        msg = expected;
        expected = undefined;
    }

    var caught = undefined;

    try {
        fn();
    } catch (err) {
        caught = { error : err };
        var message = err.message;
        delete err.message;
        err.message = message;
    }

    var passed = caught;

    if (expected instanceof RegExp) {
        passed = expected.test(caught && caught.error);
        expected = String(expected);
    }

    if (typeof expected === 'function') {
        passed = caught.error instanceof expected;
        caught.error = caught.error.constructor;
    }

    this._assert(passed, {
        message : defined(msg, 'should throw'),
        operator : 'throws',
        actual : caught && caught.error,
        expected : expected,
        error: !passed && caught && caught.error,
        extra : extra
    });
};

Test.prototype.doesNotThrow = function (fn, expected, msg, extra) {
    if (typeof expected === 'string') {
        msg = expected;
        expected = undefined;
    }
    var caught = undefined;
    try {
        fn();
    }
    catch (err) {
        caught = { error : err };
    }
    this._assert(!caught, {
        message : defined(msg, 'should not throw'),
        operator : 'throws',
        actual : caught && caught.error,
        expected : expected,
        error : caught && caught.error,
        extra : extra
    });
};

function has (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

Test.skip = function (name_, _opts, _cb) {
    var args = getTestArgs.apply(null, arguments);
    args.opts.skip = true;
    return Test(args.name, args.opts, args.cb);
};

// vim: set softtabstop=4 shiftwidth=4:


}).call(this,require('_process'),"/node_modules/tape/lib")

},{"_process":211,"deep-equal":174,"defined":177,"events":207,"inherits":178,"path":210}],174:[function(require,module,exports){
var pSlice = Array.prototype.slice;
var objectKeys = require('./lib/keys.js');
var isArguments = require('./lib/is_arguments.js');

var deepEqual = module.exports = function (actual, expected, opts) {
  if (!opts) opts = {};
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();

  // 7.3. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (typeof actual != 'object' && typeof expected != 'object') {
    return opts.strict ? actual === expected : actual == expected;

  // 7.4. For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected, opts);
  }
}

function isUndefinedOrNull(value) {
  return value === null || value === undefined;
}

function isBuffer (x) {
  if (!x || typeof x !== 'object' || typeof x.length !== 'number') return false;
  if (typeof x.copy !== 'function' || typeof x.slice !== 'function') {
    return false;
  }
  if (x.length > 0 && typeof x[0] !== 'number') return false;
  return true;
}

function objEquiv(a, b, opts) {
  var i, key;
  if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return deepEqual(a, b, opts);
  }
  if (isBuffer(a)) {
    if (!isBuffer(b)) {
      return false;
    }
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b);
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!deepEqual(a[key], b[key], opts)) return false;
  }
  return typeof a === typeof b;
}

},{"./lib/is_arguments.js":175,"./lib/keys.js":176}],175:[function(require,module,exports){
var supportsArgumentsClass = (function(){
  return Object.prototype.toString.call(arguments)
})() == '[object Arguments]';

exports = module.exports = supportsArgumentsClass ? supported : unsupported;

exports.supported = supported;
function supported(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
};

exports.unsupported = unsupported;
function unsupported(object){
  return object &&
    typeof object == 'object' &&
    typeof object.length == 'number' &&
    Object.prototype.hasOwnProperty.call(object, 'callee') &&
    !Object.prototype.propertyIsEnumerable.call(object, 'callee') ||
    false;
};

},{}],176:[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],177:[function(require,module,exports){
module.exports = function () {
    for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== undefined) return arguments[i];
    }
};

},{}],178:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],179:[function(require,module,exports){
module.exports = function inspect_ (obj, opts, depth, seen) {
    if (!opts) opts = {};
    
    var maxDepth = opts.depth === undefined ? 5 : opts.depth;
    if (depth === undefined) depth = 0;
    if (depth > maxDepth && maxDepth > 0) return '...';
    
    if (seen === undefined) seen = [];
    else if (indexOf(seen, obj) >= 0) {
        return '[Circular]';
    }
    
    function inspect (value, from) {
        if (from) {
            seen = seen.slice();
            seen.push(from);
        }
        return inspect_(value, opts, depth + 1, seen);
    }
    
    if (typeof obj === 'string') {
        return inspectString(obj);
    }
    else if (typeof obj === 'function') {
        var name = nameOf(obj);
        return '[Function' + (name ? ': ' + name : '') + ']';
    }
    else if (obj === null) {
        return 'null';
    }
    else if (isElement(obj)) {
        var s = '<' + String(obj.nodeName).toLowerCase();
        var attrs = obj.attributes || [];
        for (var i = 0; i < attrs.length; i++) {
            s += ' ' + attrs[i].name + '="' + quote(attrs[i].value) + '"';
        }
        s += '>';
        if (obj.childNodes && obj.childNodes.length) s += '...';
        s += '</' + String(obj.tagName).toLowerCase() + '>';
        return s;
    }
    else if (isArray(obj)) {
        if (obj.length === 0) return '[]';
        var xs = Array(obj.length);
        for (var i = 0; i < obj.length; i++) {
            xs[i] = has(obj, i) ? inspect(obj[i], obj) : '';
        }
        return '[ ' + xs.join(', ') + ' ]';
    }
    else if (typeof obj === 'object' && typeof obj.inspect === 'function') {
        return obj.inspect();
    }
    else if (typeof obj === 'object' && !isDate(obj) && !isRegExp(obj)) {
        var xs = [], keys = [];
        for (var key in obj) {
            if (has(obj, key)) keys.push(key);
        }
        keys.sort();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (/[^\w$]/.test(key)) {
                xs.push(inspect(key) + ': ' + inspect(obj[key], obj));
            }
            else xs.push(key + ': ' + inspect(obj[key], obj));
        }
        if (xs.length === 0) return '{}';
        return '{ ' + xs.join(', ') + ' }';
    }
    else return String(obj);
};

function quote (s) {
    return String(s).replace(/"/g, '&quot;');
}

function isArray (obj) {
    return {}.toString.call(obj) === '[object Array]';
}

function isDate (obj) {
    return {}.toString.call(obj) === '[object Date]';
}

function isRegExp (obj) {
    return {}.toString.call(obj) === '[object RegExp]';
}

function has (obj, key) {
    if (!{}.hasOwnProperty) return key in obj;
    return {}.hasOwnProperty.call(obj, key);
}

function nameOf (f) {
    if (f.name) return f.name;
    var m = f.toString().match(/^function\s*([\w$]+)/);
    if (m) return m[1];
}

function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0, l = xs.length; i < l; i++) {
        if (xs[i] === x) return i;
    }
    return -1;
}

function isElement (x) {
    if (!x || typeof x !== 'object') return false;
    if (typeof HTMLElement !== 'undefined') {
        return x instanceof HTMLElement;
    }
    else return typeof x.nodeName === 'string'
        && typeof x.getAttribute === 'function'
    ;
}

function inspectString (str) {
    var s = str.replace(/(['\\])/g, '\\$1').replace(/[\x00-\x1f]/g, lowbyte);
    return "'" + s + "'";
    
    function lowbyte (c) {
        var n = c.charCodeAt(0);
        var x = { 8: 'b', 9: 't', 10: 'n', 12: 'f', 13: 'r' }[n];
        if (x) return '\\' + x;
        return '\\x' + (n < 0x10 ? '0' : '') + n.toString(16);
    }
}

},{}],180:[function(require,module,exports){
(function (process){
var through = require('through');
var nextTick = typeof setImmediate !== 'undefined'
    ? setImmediate
    : process.nextTick
;

module.exports = function (write, end) {
    var tr = through(write, end);
    tr.pause();
    var resume = tr.resume;
    var pause = tr.pause;
    var paused = false;
    
    tr.pause = function () {
        paused = true;
        return pause.apply(this, arguments);
    };
    
    tr.resume = function () {
        paused = false;
        return resume.apply(this, arguments);
    };
    
    nextTick(function () {
        if (!paused) tr.resume();
    });
    
    return tr;
};

}).call(this,require('_process'))

},{"_process":211,"through":181}],181:[function(require,module,exports){
(function (process){
var Stream = require('stream')

// through
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)

exports = module.exports = through
through.through = through

//create a readable writable stream.

function through (write, end, opts) {
  write = write || function (data) { this.queue(data) }
  end = end || function () { this.queue(null) }

  var ended = false, destroyed = false, buffer = [], _ended = false
  var stream = new Stream()
  stream.readable = stream.writable = true
  stream.paused = false

//  stream.autoPause   = !(opts && opts.autoPause   === false)
  stream.autoDestroy = !(opts && opts.autoDestroy === false)

  stream.write = function (data) {
    write.call(this, data)
    return !stream.paused
  }

  function drain() {
    while(buffer.length && !stream.paused) {
      var data = buffer.shift()
      if(null === data)
        return stream.emit('end')
      else
        stream.emit('data', data)
    }
  }

  stream.queue = stream.push = function (data) {
//    console.error(ended)
    if(_ended) return stream
    if(data === null) _ended = true
    buffer.push(data)
    drain()
    return stream
  }

  //this will be registered as the first 'end' listener
  //must call destroy next tick, to make sure we're after any
  //stream piped from here.
  //this is only a problem if end is not emitted synchronously.
  //a nicer way to do this is to make sure this is the last listener for 'end'

  stream.on('end', function () {
    stream.readable = false
    if(!stream.writable && stream.autoDestroy)
      process.nextTick(function () {
        stream.destroy()
      })
  })

  function _end () {
    stream.writable = false
    end.call(stream)
    if(!stream.readable && stream.autoDestroy)
      stream.destroy()
  }

  stream.end = function (data) {
    if(ended) return
    ended = true
    if(arguments.length) stream.write(data)
    _end() // will emit or queue
    return stream
  }

  stream.destroy = function () {
    if(destroyed) return
    destroyed = true
    ended = true
    buffer.length = 0
    stream.writable = stream.readable = false
    stream.emit('close')
    return stream
  }

  stream.pause = function () {
    if(stream.paused) return
    stream.paused = true
    return stream
  }

  stream.resume = function () {
    if(stream.paused) {
      stream.paused = false
      stream.emit('resume')
    }
    drain()
    //may have become paused again,
    //as drain emits 'data'.
    if(!stream.paused)
      stream.emit('drain')
    return stream
  }
  return stream
}


}).call(this,require('_process'))

},{"_process":211,"stream":223}],182:[function(require,module,exports){
var clone = require('clone'),
    deepEqual = require('deep-equal');

function keysAreDifferent(keys1, keys2){
    if(keys1 === keys2){
        return;
    }
    if(!keys1 || !keys2 || keys1.length !== keys2.length){
        return true;
    }
    for(var i = 0; i < keys1.length; i++){
        if(!~keys2.indexOf(keys1[i])){
            return true;
        }
    }
}

function getKeys(value){
    if(!value || typeof value !== 'object'){
        return;
    }

    return Object.keys(value);
}

function WhatChanged(value, changesToTrack){
    this._changesToTrack = {};

    if(changesToTrack == null){
        changesToTrack = 'value type keys structure reference';
    }

    if(typeof changesToTrack !== 'string'){
        throw 'changesToTrack must be of type string';
    }

    changesToTrack = changesToTrack.split(' ');

    for (var i = 0; i < changesToTrack.length; i++) {
        this._changesToTrack[changesToTrack[i]] = true;
    };

    this.update(value);
}
WhatChanged.prototype.update = function(value){
    var result = {},
        changesToTrack = this._changesToTrack,
        newKeys = getKeys(value);

    if('value' in changesToTrack && value+'' !== this._lastReference+''){
        result.value = true;
    }
    if('type' in changesToTrack && typeof value !== typeof this._lastValue){
        result.type = true;
    }
    if('keys' in changesToTrack && keysAreDifferent(this._lastKeys, getKeys(value))){
        result.keys = true;
    }

    if(value !== null && typeof value === 'object'){
        var lastValue = this._lastValue;

        if('shallowStructure' in changesToTrack && (!lastValue || typeof lastValue !== 'object' || Object.keys(value).some(function(key, index){
            return value[key[index]] !== lastValue[key[index]];
        }))){
            result.shallowStructure = true;
        }
        if('structure' in changesToTrack && !deepEqual(value, lastValue)){
            result.structure = true;
        }
        if('reference' in changesToTrack && value !== this._lastReference){
            result.reference = true;
        }
    }

    this._lastValue = 'structure' in changesToTrack ? clone(value) : 'shallowStructure' in changesToTrack ? clone(value, true, 1): value;
    this._lastReference = value;
    this._lastKeys = newKeys;

    return result;
};

module.exports = WhatChanged;
},{"clone":183,"deep-equal":184}],183:[function(require,module,exports){
(function (Buffer){
var clone = (function() {
'use strict';

/**
 * Clones (copies) an Object using deep copying.
 *
 * This function supports circular references by default, but if you are certain
 * there are no circular references in your object, you can save some CPU time
 * by calling clone(obj, false).
 *
 * Caution: if `circular` is false and `parent` contains circular references,
 * your program may enter an infinite loop and crash.
 *
 * @param `parent` - the object to be cloned
 * @param `circular` - set to true if the object to be cloned may contain
 *    circular references. (optional - true by default)
 * @param `depth` - set to a number if the object is only to be cloned to
 *    a particular depth. (optional - defaults to Infinity)
 * @param `prototype` - sets the prototype to be used when cloning an object.
 *    (optional - defaults to parent prototype).
*/
function clone(parent, circular, depth, prototype) {
  var filter;
  if (typeof circular === 'object') {
    depth = circular.depth;
    prototype = circular.prototype;
    filter = circular.filter;
    circular = circular.circular
  }
  // maintain two arrays for circular references, where corresponding parents
  // and children have the same index
  var allParents = [];
  var allChildren = [];

  var useBuffer = typeof Buffer != 'undefined';

  if (typeof circular == 'undefined')
    circular = true;

  if (typeof depth == 'undefined')
    depth = Infinity;

  // recurse this function so we don't reset allParents and allChildren
  function _clone(parent, depth) {
    // cloning null always returns null
    if (parent === null)
      return null;

    if (depth == 0)
      return parent;

    var child;
    var proto;
    if (typeof parent != 'object') {
      return parent;
    }

    if (clone.__isArray(parent)) {
      child = [];
    } else if (clone.__isRegExp(parent)) {
      child = new RegExp(parent.source, __getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (clone.__isDate(parent)) {
      child = new Date(parent.getTime());
    } else if (useBuffer && Buffer.isBuffer(parent)) {
      child = new Buffer(parent.length);
      parent.copy(child);
      return child;
    } else {
      if (typeof prototype == 'undefined') {
        proto = Object.getPrototypeOf(parent);
        child = Object.create(proto);
      }
      else {
        child = Object.create(prototype);
        proto = prototype;
      }
    }

    if (circular) {
      var index = allParents.indexOf(parent);

      if (index != -1) {
        return allChildren[index];
      }
      allParents.push(parent);
      allChildren.push(child);
    }

    for (var i in parent) {
      var attrs;
      if (proto) {
        attrs = Object.getOwnPropertyDescriptor(proto, i);
      }

      if (attrs && attrs.set == null) {
        continue;
      }
      child[i] = _clone(parent[i], depth - 1);
    }

    return child;
  }

  return _clone(parent, depth);
}

/**
 * Simple flat clone using prototype, accepts only objects, usefull for property
 * override on FLAT configuration object (no nested props).
 *
 * USE WITH CAUTION! This may not behave as you wish if you do not know how this
 * works.
 */
clone.clonePrototype = function clonePrototype(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

// private utility functions

function __objToStr(o) {
  return Object.prototype.toString.call(o);
};
clone.__objToStr = __objToStr;

function __isDate(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Date]';
};
clone.__isDate = __isDate;

function __isArray(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Array]';
};
clone.__isArray = __isArray;

function __isRegExp(o) {
  return typeof o === 'object' && __objToStr(o) === '[object RegExp]';
};
clone.__isRegExp = __isRegExp;

function __getRegExpFlags(re) {
  var flags = '';
  if (re.global) flags += 'g';
  if (re.ignoreCase) flags += 'i';
  if (re.multiline) flags += 'm';
  return flags;
};
clone.__getRegExpFlags = __getRegExpFlags;

return clone;
})();

if (typeof module === 'object' && module.exports) {
  module.exports = clone;
}

}).call(this,require("buffer").Buffer)

},{"buffer":203}],184:[function(require,module,exports){
arguments[4][174][0].apply(exports,arguments)
},{"./lib/is_arguments.js":185,"./lib/keys.js":186,"dup":174}],185:[function(require,module,exports){
arguments[4][175][0].apply(exports,arguments)
},{"dup":175}],186:[function(require,module,exports){
arguments[4][176][0].apply(exports,arguments)
},{"dup":176}],187:[function(require,module,exports){
var Enti = require('enti'),
    WhatChanged = require('what-changed'),
    firmer = require('./firmer'),
    createBinding = require('./binding'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    is = require('./is');

module.exports = function createProperty(currentValue, changes){
    var binding,
        model,
        attaching,
        previous = new WhatChanged(currentValue, changes || 'value type reference keys');

    function property(value){
        if(!arguments.length){
            return binding && binding() || property._value;
        }

        if(attaching){
            return property;
        }

        if(!Object.keys(previous.update(value)).length){
            return property;
        }

        if(!property._destroyed){
            property._value = value;

            if(binding){
                binding(value);
                property._value = binding();
            }

            property.emit('change', property._value);
            property.update();
        }

        return property;
    }

    property._value = currentValue;

    property._firm = 1;

    makeFunctionEmitter(property);

    property.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(!is.binding(newBinding)){
            newBinding = createBinding(newBinding);
        }

        if(newBinding === binding){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
        }
        binding = newBinding;
        if(model){
            property.attach(model, property._firm);
        }
        binding.on('change', property);
        property.update();
        return property;
    };
    property.attach = function(object, firm){
        if(firmer(property, firm)){
            return property;
        }

        property._firm = firm;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding){
            model = object;
            attaching = true;
            binding.attach(object, 1);
            attaching = false;
            property(binding());
        }else{
            property.update();
        }
        return property;
    };
    property.detach = function(firm){
        if(firmer(property, firm)){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
            binding.detach(1);
            model = null;
        }
        property.update();
        return property;
    };
    property.update = function(){
        if(!property._destroyed){
            property.emit('update', property._value);
        }
        return property;
    };
    property.destroy = function(){
        if(!property._destroyed){
            property._destroyed = true;
            property.emit('destroy');
            property.detach();
            if(binding){
                binding.destroy(true);
            }
        }
        return property;
    };
    property.addTo = function(component, key){
        component[key] = property;
        return property;
    };
    property._fastn_property = true;

    return property;
};
},{"./binding":1,"./firmer":4,"./is":7,"./makeFunctionEmitter":9,"enti":16,"what-changed":182}],188:[function(require,module,exports){
var crel = require('crel'),
    Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    genericComponent = require('./genericComponent');

module.exports = function(type, fastn, settings, children){
    var templater = new EventEmitter(),
        lastValue = {},
        itemModel = new Enti({});

    function replaceElement(element){
        if(templater.element && templater.element.parentNode){
            templater.element.parentNode.replaceChild(element, templater.element);
        }
        templater.element = element;
    }

    function update(){
        var value = templater.data(),
            template = templater._settings.template;

        if(!template){
            return;
        }

        lastValue = value;

        if(templater._currentComponent){
            if(fastn.isComponent(templater._currentComponent)){
                templater._currentComponent.destroy();
            }
            templater._currentComponent = null;
        }

        itemModel.set('item', value);

        templater._currentComponent = fastn.toComponent(template(itemModel, templater.scope(), templater._currentComponent));

        if(!templater._currentComponent){
            replaceElement(document.createTextNode(''));
            return;
        }

        if(fastn.isComponent(templater._currentComponent)){
            if(templater._settings.attachTemplates !== false){
                templater._currentComponent.attach(itemModel, 2);
            }else{
                templater._currentComponent.attach(templater.scope(), 1);
            }

            if(templater.element){
                templater._currentComponent.render();
                replaceElement(templater._currentComponent.element);
            }
        }
    }

    templater.render = function(){
        var element;
        if(templater._currentComponent){
            templater._currentComponent.render();
            element = templater._currentComponent.element;
        }
        templater.element = element || document.createTextNode('');
        templater.emit('render');
    };

    fastn.property(undefined, settings.dataChanges || 'value structure')
        .addTo(templater, 'data')
        .binding(settings.data)
        .on('change', update);

    templater.on('destroy', function(){
        if(fastn.isComponent(templater._currentComponent)){
            templater._currentComponent.destroy();
        }
    });

    return templater;
};
},{"./genericComponent":5,"crel":10,"enti":16,"events":207}],189:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js'),
    createFastn = require('./createFastn');

test('manual attach', function(t){

    t.plan(3);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.attach({
        foo:'bar'
    });

    t.deepEqual(parent.scope().get('.'), {
        foo:'bar'
    });

    t.deepEqual(child.scope().get('.'), {
        foo:'bar'
    });

    t.equal(parent.scope().get('.'), child.scope().get('.'));

});

test('weak attach attempt', function(t){

    t.plan(3);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.attach({
        foo:'bar'
    });

    child.attach({
        baz: 'inga'
    }, 0);

    t.deepEqual(parent.scope().get('.'), {
        foo:'bar'
    });

    t.deepEqual(child.scope().get('.'), {
        foo:'bar'
    });

    t.equal(parent.scope().get('.'), child.scope().get('.'));
});

test('firmer attach attempt', function(t){

    t.plan(3);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.attach({
        foo:'bar'
    });

    child.attach({
        baz: 'inga'
    }, 1);

    t.deepEqual(parent.scope().get('.'), {
        foo:'bar'
    });

    t.deepEqual(child.scope().get('.'), {
        baz:'inga'
    });

    t.notEqual(parent.scope().get('.'), child.scope().get('.'));
});

test('firmest attach', function(t){

    t.plan(3);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.attach({
        foo:'bar'
    });

    child.attach({
        baz: 'inga'
    });

    t.deepEqual(parent.scope().get('.'), {
        foo:'bar'
    });

    t.deepEqual(child.scope().get('.'), {
        baz:'inga'
    });

    t.notEqual(parent.scope().get('.'), child.scope().get('.'));
});

},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],190:[function(require,module,exports){
var test = require('tape'),
    createBinding = require('../binding'),
    Enti = require('enti');

test('simple binding initialisation', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    var model = {},
        enti = new Enti(model);

    t.equal(binding(), undefined);

    enti.set('foo', 'bar');

    t.equal(binding(), undefined);

    binding.attach(model);

    t.equal(binding(), 'bar');
});

test('simple binding set', function(t){
    t.plan(2);

    var binding = createBinding('foo');

    binding.attach({});

    t.equal(binding(), undefined);

    binding('bazinga');

    t.equal(binding(), 'bazinga');
});

test('simple binding event', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    var model = {},
        enti = new Enti(model);

    binding.attach(model);

    binding.once('change', function(value){
        t.equal(value, 'bar');
        t.equal(binding(), 'bar');
    });

    enti.set('foo', 'bar');

    binding.once('detach', function(){
        t.equal(binding(), undefined);
    });

    binding.detach();

    enti.set('foo', 'baz');
});

test('no model', function(t){
    t.plan(3);

    var binding = createBinding('foo');

    t.equal(binding(), undefined);

    binding.on('change', function(value){
        t.equal(value, 'bar');
    });

    binding('bar');

    t.equal(binding(), 'bar');
});

test('drill get', function(t){
    t.plan(2);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');

    binding.attach(data);

    t.equal(binding(), 123);

    model.set('foo', {
        bar: 456
    });

    t.equal(binding(), 456);
});

test('drill change', function(t){
    t.plan(1);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');

    binding.attach(data);

    binding.on('change', function(){
        t.pass('target changed');
    });

    model.set('foo', {
        bar: 456
    });
});

test('drill attach', function(t){
    t.plan(2);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        binding = createBinding('foo.bar');


    binding.once('change', function(value){
        t.equal(value, 123);
    });

    binding.attach(data);

    binding.once('change', function(value){
        t.equal(value, 456);
    });

    model.set('foo', {
        bar: 456
    });
});

test('drill set', function(t){
    t.plan(1);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo),
        binding = createBinding('foo.bar');


    fooModel.on('bar', function(value){
        t.equal(value, 456);
    });

    binding.attach(data);

    binding(456);
});

test('drill multiple', function(t){
    t.plan(3);

    var data = {
            foo: {
                bar: 123
            }
        },
        model = new Enti(data),
        fooModel = new Enti(data.foo),
        binding = createBinding('foo.bar');


    fooModel.once('bar', function(value){
        t.equal(value, 456);
    });

    binding.attach(data);

    binding(456);

    binding.once('change', function(value){
        t.equal(value, 789);
    });

    fooModel.set('bar', 789);

    binding.once('change', function(value){
        t.equal(value, 987);
    });

    binding(987);
});

test('fuse', function(t){
    t.plan(2);

    var data = {
            foo: 1,
            bar: 2,
            baz: 3
        },
        model = new Enti(data),
        binding = createBinding('foo', 'bar', 'baz', function(foo, bar, baz){
            return foo + bar + baz;
        });

    binding.attach(data);

    binding(2);

    binding.once('change', function(value){
        t.equal(value, 7);
    });

    model.set('bar', 3);

    binding.once('change', function(value){
        t.equal(value, 3);
    });

    binding(3);
});

test('filter', function(t){
    t.plan(2);

    var data = {},
        model = new Enti(data),
        binding = createBinding('foo|*');

    binding.attach(data);

    binding.on('change', function(value){
        t.pass();
    });

    model.set('foo', []);

    Enti.set(data.foo, 0, {});
});

test('things', function(t){
    t.plan(2);

    var data = {},
        model = new Enti(data),
        binding = createBinding('foo|*.bar');

    binding.attach(data);

    binding.on('change', function(value){
        t.pass();
    });

    model.set('foo', [{}]);

    Enti.set(data.foo[0], 'bar', true);
});

},{"../binding":1,"enti":16,"tape":170}],191:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('children are added', function(t){

    t.plan(2);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span')
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(parent.element.childNodes.length, 1);

        parent.element.remove();
        parent.destroy();
    });

});

test('undefined or null children are ignored', function(t){

    t.plan(1);

    var fastn = createFastn();

    var child,
        parent = fastn('div',
            child = fastn('span'),
            undefined,
            null
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(parent.element.childNodes.length, 1);

        parent.element.remove();
        parent.destroy();
    });

});

test('flatten children', function(t){

    t.plan(1);

    var fastn = createFastn();

    var parent = fastn('div',
            [fastn('span'), fastn('span')],
            fastn('span')
        );

    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(parent.element.childNodes.length, 3);

        parent.element.remove();
        parent.destroy();
    });

});
},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],192:[function(require,module,exports){
module.exports = function createFastn(){
    return require('../')({
            _generic: require('../genericComponent'),
            list: require('../listComponent'),
            templater: require('../templaterComponent'),
            text: require('../textComponent')
        });
};
},{"../":6,"../genericComponent":5,"../listComponent":8,"../templaterComponent":188,"../textComponent":200}],193:[function(require,module,exports){
var test = require('tape'),
    firmer = require('../firmer');

test('default (0) firmness', function(t){

    t.plan(2);

    var entitiy = {_firm:0};

    t.notOk(firmer(entitiy, 1));
    t.notOk(firmer(entitiy, 0));
});

test('template (1) firmness', function(t){

    t.plan(2);

    var entitiy = {_firm:1};

    t.notOk(firmer(entitiy, 1));
    t.ok(firmer(entitiy, 0));
});

test('custom (2) firmness', function(t){

    t.plan(2);

    var entitiy = {_firm:2};

    t.ok(firmer(entitiy, 1));
    t.ok(firmer(entitiy, 0));
});

test('attach() (undefined) firmness', function(t){

    t.plan(3);

    var entitiy = {_firm:undefined};

    t.ok(firmer(entitiy, 0));
    t.ok(firmer(entitiy, 1));
    t.ok(firmer(entitiy, Infinity));
});
},{"../firmer":4,"tape":170}],194:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('div', function(t){

    t.plan(2);

    var fastn = createFastn();

    var div = fastn('div');

    div.render();

    doc.ready(function(){
        document.body.appendChild(div.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(document.body.childNodes[0].tagName, 'DIV');

        div.element.remove();
        div.destroy();
    });

});

test('special properties - input value - undefined', function(t){

    t.plan(3);

    var fastn = createFastn();

    var input = fastn('input', {value: undefined});

    input.render();

    doc.ready(function(){
        document.body.appendChild(input.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(document.body.childNodes[0].tagName, 'INPUT');
        t.equal(document.body.childNodes[0].value, '');

        input.element.remove();
        input.destroy();
    });

});

test('special properties - input value - dates', function(t){

    t.plan(8);

    var fastn = createFastn();

    var input = fastn('input', {
        type: 'date',
        value: new Date('2015-01-01'),
        onchange: 'value:value',
        onclick: 'value:value' // so I can trigger events..
    });

    input.render();

    doc.ready(function(){
        document.body.appendChild(input.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(document.body.childNodes[0].tagName, 'INPUT');
        t.equal(document.body.childNodes[0].value, '2015-01-01');
        t.deepEqual(input.value(), new Date('2015-01-01'));

        input.value(new Date('2015-02-02'));

        t.equal(document.body.childNodes[0].value, '2015-02-02');
        t.deepEqual(input.value(), new Date('2015-02-02'));

        input.element.value = '2016-02-02';
        input.element.click();

        t.equal(document.body.childNodes[0].value, '2016-02-02');
        t.deepEqual(input.value(), new Date('2016-02-02'));

        input.element.remove();
        input.destroy();
    });

});

test('special properties - disabled', function(t){

    t.plan(4);

    var fastn = createFastn();

    var button = fastn('button', {
        type: 'button',
        disabled: false
    });

    button.render();

    doc.ready(function(){
        document.body.appendChild(button.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(document.body.childNodes[0].tagName, 'BUTTON');
        t.equal(document.body.childNodes[0].getAttribute('disabled'), null);

        button.disabled(true);

        t.equal(document.body.childNodes[0].getAttribute('disabled'), 'disabled');

        button.element.remove();
        button.destroy();
    });

});

test('special properties - textContent', function(t){

    t.plan(4);

    var fastn = createFastn();

    var label = fastn('label', {
        textContent: 'foo'
    });

    label.render();

    doc.ready(function(){
        document.body.appendChild(label.element);

        t.equal(document.body.childNodes.length, 1);
        t.equal(document.body.childNodes[0].tagName, 'LABEL');
        t.equal(document.body.childNodes[0].textContent, 'foo');

        label.textContent(null);

        t.equal(document.body.childNodes[0].textContent, '');

        label.element.remove();
        label.destroy();
    });

});
},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],195:[function(require,module,exports){
require('./firmer.js');
require('./binding.js');
require('./property.js');
require('./text.js');
require('./list.js');
require('./templater.js');
require('./container.js');
require('./generic.js');
require('./attach.js');

},{"./attach.js":189,"./binding.js":190,"./container.js":191,"./firmer.js":193,"./generic.js":194,"./list.js":196,"./property.js":197,"./templater.js":198,"./text.js":199}],196:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js'),
    createFastn = require('./createFastn');

test('value items', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: [1,2,3,4],
            template: function(model){
                return fastn.binding('item');
            }
        });

    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        list.element.remove();
        list.destroy();
    });


});


test('bound items', function(t){

    t.plan(1);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        });

    list.attach({
        items: [1,2,3,4]
    });
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        list.element.remove();
        list.destroy();

    });

});


test('bound items changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.set('items.1', 5);

        t.equal(document.body.innerText, '1534');

        list.element.remove();
        list.destroy();

    });

});

test('bound items add', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.set('items.4', 5);

        t.equal(document.body.innerText, '12345');

        list.element.remove();
        list.destroy();

    });

});

test('bound items remove', function(t){

    t.plan(2);

    var fastn = createFastn();

    var list = fastn('list', {
            items: fastn.binding('items|*'),
            template: function(model){
                return fastn.binding('item');
            }
        }),
        model = new Enti({
            items: [1,2,3,4]
        });

    list.attach(model);
    list.render();

    doc.ready(function(){

        document.body.appendChild(list.element);

        t.equal(document.body.innerText, '1234');

        model.remove('items.3');

        t.equal(document.body.innerText, '123');

        list.element.remove();
        list.destroy();

    });

});
},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],197:[function(require,module,exports){
var test = require('tape'),
    createBinding = require('../binding'),
    createProperty = require('../property'),
    Enti = require('enti');

test('simple property initialisation', function(t){
    t.plan(3);

    var property = createProperty();

    t.equal(property(), undefined);

    property('bar');

    t.equal(property(), 'bar');

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    property('foo');
});

test('bound property', function(t){
    t.plan(5);

    var property = createProperty();

    var binding = createBinding('foo');

    t.equal(property(), undefined);

    property('bar');

    t.equal(property(), 'bar');

    property.binding(binding);

    t.equal(property(), 'bar');

    binding('baz');

    t.equal(property(), 'baz');

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    binding('foo');
});

test('bound property with model', function(t){
    t.plan(1);

    var data = {},
        model = new Enti(data);

    var property = createProperty();

    var binding = createBinding('foo');

    binding.attach(model);

    property.binding(binding);

    property.on('change', function(value){
        t.equal(value, 'foo');
    });

    model.set('foo', 'foo');
});

test('bound property with model and drill', function(t){
    t.plan(1);

    var data = {},
        model = new Enti(data);

    var property = createProperty();

    var binding = createBinding('foo.bar');

    binding.attach(model);

    property.binding(binding);

    property.on('change', function(value){
        t.equal(value, 123);
    });

    model.set('foo', {bar: 123});
});
},{"../binding":1,"../property":187,"enti":16,"tape":170}],198:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('value data', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: {foo:'bar'},
            template: function(model){
                return fastn.binding('item.foo');
            }
        });

    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        template.element.remove();
        template.destroy();
    });


});


test('bound data', function(t){

    t.plan(1);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: fastn.binding('data|*'),
            template: function(model){
                return fastn.binding('item.foo');
            }
        });

    template.attach({
        data: {
            foo: 'bar'
        }
    });
    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        template.element.remove();
        template.destroy();

    });

});


test('bound data changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var template = fastn('templater', {
            data: fastn.binding('data|*'),
            template: function(model){
                return fastn.binding('item.foo');
            }
        }),
        model = new Enti({
            data: {
                foo: 'bar'
            }
        });

    template.attach(model);
    template.render();

    doc.ready(function(){

        document.body.appendChild(template.element);

        t.equal(document.body.innerText, 'bar');

        model.set('data.foo', 'baz');

        t.equal(document.body.innerText, 'baz');

        template.element.remove();
        template.destroy();

    });

});
},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],199:[function(require,module,exports){
var test = require('tape'),
    Enti = require('enti'),
    doc = require('doc-js')
    createFastn = require('./createFastn');

test('value text', function(t){

    t.plan(1);

    var fastn = createFastn();

    var text = fastn('text', {text: 'foo'});

    text.render();

    doc.ready(function(){
        document.body.appendChild(text.element);

        t.equal(document.body.innerText, 'foo');

        text.element.remove();
        text.destroy();
    });


});

test('bound text', function(t){

    t.plan(1);

    var fastn = createFastn();

    var text = fastn('text', {text: fastn.binding('value')});

    text.attach({
        value: 'foo'
    });
    text.render();

    doc.ready(function(){
        document.body.appendChild(text.element);

        t.equal(document.body.innerText, 'foo');

        text.element.remove();
        text.destroy();
    });


});

test('bound text changing', function(t){

    t.plan(2);

    var fastn = createFastn();

    var text = fastn('text', {text: fastn.binding('value')}),
        model = new Enti({
            value: 'foo'
        });

    text.attach(model);
    text.render();

    doc.ready(function(){
        document.body.appendChild(text.element);

        t.equal(document.body.innerText, 'foo');

        model.set('value', 'bar');

        t.equal(document.body.innerText, 'bar');

        text.element.remove();
        text.destroy();
    });


});

test('auto binding text', function(t){

    t.plan(2);

    var fastn = createFastn();

    var parent = fastn('span', fastn.binding('value')),
        model = new Enti({
            value: 'foo'
        });

    parent.attach(model);
    parent.render();

    doc.ready(function(){
        document.body.appendChild(parent.element);

        t.equal(document.body.innerText, 'foo');

        model.set('value', 'bar');

        t.equal(document.body.innerText, 'bar');

        parent.element.remove();
        parent.destroy();
    });


});
},{"./createFastn":192,"doc-js":12,"enti":16,"tape":170}],200:[function(require,module,exports){
var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn, settings){
    var text = new EventEmitter();

    text.text = fastn.property('');
    text._updateText = function(value){
        if(!text.element){
            return;
        }

        text.element.textContent = value;
    };
    text.render = function(){
        text.element = document.createTextNode('');
        text.emit('render');
    };
    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('update', text.text.update);

    return text;
};
},{"./is":7,"crel":10,"events":207}],201:[function(require,module,exports){

},{}],202:[function(require,module,exports){
arguments[4][201][0].apply(exports,arguments)
},{"dup":201}],203:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {
    return fromTypedArray(that, object)
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = String(string)

  if (string.length === 0) return 0

  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      return string.length
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return string.length * 2
    case 'hex':
      return string.length >>> 1
    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(string).length
    case 'base64':
      return base64ToBytes(string).length
    default:
      return string.length
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":204,"ieee754":205,"is-array":206}],204:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],205:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],206:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],207:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],208:[function(require,module,exports){
arguments[4][178][0].apply(exports,arguments)
},{"dup":178}],209:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],210:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":211}],211:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],212:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":213}],213:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))

},{"./_stream_readable":215,"./_stream_writable":217,"_process":211,"core-util-is":218,"inherits":208}],214:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":216,"core-util-is":218,"inherits":208}],215:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;


/*<replacement>*/
var debug = require('util');
if (debug && debug.debuglog) {
  debug = debug.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/


util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  var Duplex = require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (util.isString(chunk) && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (util.isNullOrUndefined(chunk)) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (isNaN(n) || util.isNull(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (!util.isNumber(n) || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (util.isNull(ret)) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (!util.isNull(ret))
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      process.nextTick(function() {
        emitReadable_(stream);
      });
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      debug('false write response, pause',
            src._readableState.awaitDrain);
      src._readableState.awaitDrain++;
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EE.listenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        var self = this;
        process.nextTick(function() {
          debug('readable nexttick read 0');
          self.read(0);
        });
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    if (!state.reading) {
      debug('resume read 0');
      this.read(0);
    }
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    process.nextTick(function() {
      resume_(stream, state);
    });
  }
}

function resume_(stream, state) {
  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);
    if (!chunk || !state.objectMode && !chunk.length)
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (util.isFunction(stream[i]) && util.isUndefined(this[i])) {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))

},{"./_stream_duplex":213,"_process":211,"buffer":203,"core-util-is":218,"events":207,"inherits":208,"isarray":209,"stream":223,"string_decoder/":224,"util":202}],216:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (!util.isNullOrUndefined(data))
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('prefinish', function() {
    if (util.isFunction(this._flush))
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (!util.isNull(ts.writechunk) && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":213,"core-util-is":218,"inherits":208}],217:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (util.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (!util.isFunction(cb))
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.buffer.length)
      clearBuffer(this, state);
  }
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      util.isString(chunk)) {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (util.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, false, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      state.pendingcb--;
      cb(er);
    });
  else {
    state.pendingcb--;
    cb(er);
  }

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.buffer.length) {
      clearBuffer(stream, state);
    }

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  if (stream._writev && state.buffer.length > 1) {
    // Fast case, write everything using _writev()
    var cbs = [];
    for (var c = 0; c < state.buffer.length; c++)
      cbs.push(state.buffer[c].callback);

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    doWrite(stream, state, true, state.length, state.buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
    state.buffer = [];
  } else {
    // Slow case, write chunks one-by-one
    for (var c = 0; c < state.buffer.length; c++) {
      var entry = state.buffer[c];
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);

      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        c++;
        break;
      }
    }

    if (c < state.buffer.length)
      state.buffer = state.buffer.slice(c);
    else
      state.buffer.length = 0;
  }

  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));

};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (util.isFunction(chunk)) {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (!util.isNullOrUndefined(chunk))
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else
      prefinish(stream, state);
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))

},{"./_stream_duplex":213,"_process":211,"buffer":203,"core-util-is":218,"inherits":208,"stream":223}],218:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,require("buffer").Buffer)

},{"buffer":203}],219:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":214}],220:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = require('stream');
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":213,"./lib/_stream_passthrough.js":214,"./lib/_stream_readable.js":215,"./lib/_stream_transform.js":216,"./lib/_stream_writable.js":217,"stream":223}],221:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":216}],222:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":217}],223:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":207,"inherits":208,"readable-stream/duplex.js":212,"readable-stream/passthrough.js":219,"readable-stream/readable.js":220,"readable-stream/transform.js":221,"readable-stream/writable.js":222}],224:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":203}]},{},[195])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJiaW5kaW5nLmpzIiwiY29tcG9uZW50LmpzIiwiY29udGFpbmVyQ29tcG9uZW50LmpzIiwiZmlybWVyLmpzIiwiZ2VuZXJpY0NvbXBvbmVudC5qcyIsImluZGV4LmpzIiwiaXMuanMiLCJsaXN0Q29tcG9uZW50LmpzIiwibWFrZUZ1bmN0aW9uRW1pdHRlci5qcyIsIm5vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCJub2RlX21vZHVsZXMvZG9jLWpzL2RvYy5qcyIsIm5vZGVfbW9kdWxlcy9kb2MtanMvZmx1ZW50LmpzIiwibm9kZV9tb2R1bGVzL2RvYy1qcy9nZXRUYXJnZXQuanMiLCJub2RlX21vZHVsZXMvZG9jLWpzL2dldFRhcmdldHMuanMiLCJub2RlX21vZHVsZXMvZG9jLWpzL2lzTGlzdC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L2lzLW5hdGl2ZS1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L2xpYi9pdGVyYXRvci5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9kL2F1dG8tYmluZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9kL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvYXJyYXkvIy9jbGVhci5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvZS1pbmRleC1vZi5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L21hdGgvc2lnbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L21hdGgvc2lnbi9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L21hdGgvc2lnbi9zaGltLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLWludGVnZXIuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9udW1iZXIvdG8tcG9zLWludGVnZXIuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvX2l0ZXJhdGUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jb3B5LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2NyZWF0ZS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9mb3ItZWFjaC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9pcy1jYWxsYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9pcy1vYmplY3QuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL2lzLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9tYXAuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvbm9ybWFsaXplLW9wdGlvbnMuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2Yvc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC12YWx1ZS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9zaGltLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZy5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvYXJyYXkuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2Zvci1vZi5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvZ2V0LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaXMtaXRlcmFibGUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtc3ltYm9sLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvdmFsaWRhdGUtc3ltYm9sLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9zdHJpbmcuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL3ZhbGlkLWl0ZXJhYmxlLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9ldmVudC1lbWl0dGVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvcG9seWZpbGwuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvaXMtbmF0aXZlLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtb2JqZWN0LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9wb2x5ZmlsbC5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VzNi1tYXAvaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZXM2LW1hcC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3Ita2luZHMuanMiLCJub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3IuanMiLCJub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvcHJpbWl0aXZlLXNldC5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL3BvbHlmaWxsLmpzIiwibm9kZV9tb2R1bGVzL2ZsYXQtbWVyZ2UvaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2FtZS12YWx1ZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy90YXBlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3RhcGUvbGliL2RlZmF1bHRfc3RyZWFtLmpzIiwibm9kZV9tb2R1bGVzL3RhcGUvbGliL3Jlc3VsdHMuanMiLCJub2RlX21vZHVsZXMvdGFwZS9saWIvdGVzdC5qcyIsIm5vZGVfbW9kdWxlcy90YXBlL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3RhcGUvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIm5vZGVfbW9kdWxlcy90YXBlL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2xpYi9rZXlzLmpzIiwibm9kZV9tb2R1bGVzL3RhcGUvbm9kZV9tb2R1bGVzL2RlZmluZWQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvdGFwZS9ub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy90YXBlL25vZGVfbW9kdWxlcy9vYmplY3QtaW5zcGVjdC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy90YXBlL25vZGVfbW9kdWxlcy9yZXN1bWVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3RhcGUvbm9kZV9tb2R1bGVzL3Rocm91Z2gvaW5kZXguanMiLCJub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvY2xvbmUvY2xvbmUuanMiLCJwcm9wZXJ0eS5qcyIsInRlbXBsYXRlckNvbXBvbmVudC5qcyIsInRlc3QvYXR0YWNoLmpzIiwidGVzdC9iaW5kaW5nLmpzIiwidGVzdC9jb250YWluZXIuanMiLCJ0ZXN0L2NyZWF0ZUZhc3RuLmpzIiwidGVzdC9maXJtZXIuanMiLCJ0ZXN0L2dlbmVyaWMuanMiLCJ0ZXN0L2luZGV4LmpzIiwidGVzdC9saXN0LmpzIiwidGVzdC9wcm9wZXJ0eS5qcyIsInRlc3QvdGVtcGxhdGVyLmpzIiwidGVzdC90ZXh0LmpzIiwidGV4dENvbXBvbmVudC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L2xpYi9fZW1wdHkuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaXMtYXJyYXkvaW5kZXguanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9pc2FycmF5L2luZGV4LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3BhdGgtYnJvd3NlcmlmeS9pbmRleC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2R1cGxleC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL19zdHJlYW1fZHVwbGV4LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvX3N0cmVhbV9wYXNzdGhyb3VnaC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL19zdHJlYW1fcmVhZGFibGUuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX3RyYW5zZm9ybS5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL19zdHJlYW1fd3JpdGFibGUuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL25vZGVfbW9kdWxlcy9jb3JlLXV0aWwtaXMvbGliL3V0aWwuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL3Bhc3N0aHJvdWdoLmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9yZWFkYWJsZS5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vdHJhbnNmb3JtLmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS93cml0YWJsZS5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9zdHJlYW0tYnJvd3NlcmlmeS9pbmRleC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9zdHJpbmdfZGVjb2Rlci9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDemtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTs7QUNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvaEJBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9FQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQzVJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUM3TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2hmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9IQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDNUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2xGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7O0FDaEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25KQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7Ozs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3Q0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDN1NBO0FBQ0E7QUFDQTtBQUNBOzs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTs7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDekZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3Y3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNqTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDN2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMxR0E7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7O0FDREE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9IQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBtYWtlRnVuY3Rpb25FbWl0dGVyID0gcmVxdWlyZSgnLi9tYWtlRnVuY3Rpb25FbWl0dGVyJyksXG4gICAgc2FtZSA9IHJlcXVpcmUoJ3NhbWUtdmFsdWUnKTtcblxuZnVuY3Rpb24gZnVzZUJpbmRpbmcoKXtcbiAgICB2YXIgYmluZGluZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZygncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIGlmKHR5cGVvZiBiaW5kaW5nc1tiaW5kaW5ncy5sZW5ndGgtMV0gPT09ICdmdW5jdGlvbicgJiYgIWlzLmJpbmRpbmcoYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdKSl7XG4gICAgICAgIHVwZGF0ZVRyYW5zZm9ybSA9IHRyYW5zZm9ybTtcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCk7XG4gICAgfVxuXG4gICAgcmVzdWx0QmluZGluZy5fbW9kZWwuX2V2ZW50cyA9IHt9O1xuICAgIHJlc3VsdEJpbmRpbmcuX3NldCA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICB2YXIgbmV3VmFsdWUgPSB1cGRhdGVUcmFuc2Zvcm0odmFsdWUpO1xuICAgICAgICAgICAgaWYoIXNhbWUobmV3VmFsdWUsIGJpbmRpbmdzWzBdKCkpKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nc1swXShuZXdWYWx1ZSk7XG4gICAgICAgICAgICAgICAgcmVzdWx0QmluZGluZy5fY2hhbmdlKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHJlc3VsdEJpbmRpbmcuX2NoYW5nZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlKCl7XG4gICAgICAgIGlmKHNlbGZDaGFuZ2luZyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0QmluZGluZyh0cmFuc2Zvcm0uYXBwbHkobnVsbCwgYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmcoKTtcbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcsIGluZGV4KXtcbiAgICAgICAgaWYodHlwZW9mIGJpbmRpbmcgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgICAgIGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKGJpbmRpbmcpO1xuICAgICAgICAgICAgYmluZGluZ3Muc3BsaWNlKGluZGV4LDEsYmluZGluZyk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgY2hhbmdlKTtcbiAgICAgICAgcmVzdWx0QmluZGluZy5vbignZGV0YWNoJywgYmluZGluZy5kZXRhY2gpO1xuICAgIH0pO1xuXG4gICAgdmFyIGxhc3RBdHRhY2hlZDtcbiAgICByZXN1bHRCaW5kaW5nLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihvYmplY3Qpe1xuICAgICAgICBzZWxmQ2hhbmdpbmcgPSB0cnVlO1xuICAgICAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCAxKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICBpZihsYXN0QXR0YWNoZWQgIT09IG9iamVjdCl7XG4gICAgICAgICAgICBjaGFuZ2UoKTtcbiAgICAgICAgfVxuICAgICAgICBsYXN0QXR0YWNoZWQgPSBvYmplY3Q7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0QmluZGluZztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhrZXlBbmRGaWx0ZXIpe1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPiAxKXtcbiAgICAgICAgcmV0dXJuIGZ1c2VCaW5kaW5nLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgaWYoa2V5QW5kRmlsdGVyID09IG51bGwpe1xuICAgICAgICB0aHJvdyBcImJpbmRpbmdzIG11c3QgYmUgY3JlYXRlZCB3aXRoIGEga2V5IChhbmQgb3IgZmlsdGVyKVwiO1xuICAgIH1cblxuICAgIHZhciBrZXlBbmRGaWx0ZXJQYXJ0cyA9IChrZXlBbmRGaWx0ZXIgKyAnJykuc3BsaXQoJ3wnKSxcbiAgICAgICAga2V5ID0ga2V5QW5kRmlsdGVyUGFydHNbMF0sXG4gICAgICAgIGZpbHRlciA9IGtleUFuZEZpbHRlclBhcnRzWzFdID8gKChrZXkgPT09ICcuJyA/ICcnIDoga2V5ICsgJy4nKSArIGtleUFuZEZpbHRlclBhcnRzWzFdKSA6IGtleTtcblxuICAgIGlmKGZpbHRlciA9PT0gJy4nKXtcbiAgICAgICAgZmlsdGVyID0gJyonO1xuICAgIH1cblxuICAgIHZhciB2YWx1ZSxcbiAgICAgICAgYmluZGluZyA9IGZ1bmN0aW9uIGJpbmRpbmcobmV3VmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihrZXkgPT09ICcuJyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLl9zZXQobmV3VmFsdWUpO1xuICAgIH07XG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlcihiaW5kaW5nKTtcbiAgICBiaW5kaW5nLnNldE1heExpc3RlbmVycygxMDAwMCk7XG4gICAgYmluZGluZy5fbW9kZWwgPSBuZXcgRW50aShmYWxzZSk7XG4gICAgYmluZGluZy5fZmFzdG5fYmluZGluZyA9IGtleTtcbiAgICBiaW5kaW5nLl9maXJtID0gMTtcbiAgICBiaW5kaW5nLl9tb2RlbC5fZXZlbnRzID0ge307XG5cbiAgICBiaW5kaW5nLmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgZmlybSl7XG5cbiAgICAgICAgLy8gSWYgdGhlIGJpbmRpbmcgaXMgYmVpbmcgYXNrZWQgdG8gYXR0YWNoIGxvb3NseSB0byBhbiBvYmplY3QsXG4gICAgICAgIC8vIGJ1dCBpdCBoYXMgYWxyZWFkeSBiZWVuIGRlZmluZWQgYXMgYmVpbmcgZmlybWx5IGF0dGFjaGVkLCBkbyBub3QgYXR0YWNoLlxuICAgICAgICBpZihmaXJtZXIoYmluZGluZywgZmlybSkpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLl9maXJtID0gZmlybTtcblxuICAgICAgICBpZihvYmplY3QgaW5zdGFuY2VvZiBFbnRpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IG9iamVjdC5fbW9kZWw7XG4gICAgICAgIH1cblxuICAgICAgICBpZighKG9iamVjdCBpbnN0YW5jZW9mIE9iamVjdCkpe1xuICAgICAgICAgICAgb2JqZWN0ID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nLl9tb2RlbC5nZXQoJy4nKSA9PT0gb2JqZWN0KXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5fbW9kZWwuYXR0YWNoKG9iamVjdCk7XG4gICAgICAgIGJpbmRpbmcuX2NoYW5nZShiaW5kaW5nLl9tb2RlbC5nZXQoa2V5KSk7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnYXR0YWNoJywgb2JqZWN0LCAxKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBpZihmaXJtZXIoYmluZGluZywgZmlybSkpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgYmluZGluZy5fbW9kZWwuZGV0YWNoKCk7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnZGV0YWNoJywgMSk7XG4gICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgIH07XG4gICAgYmluZGluZy5fc2V0ID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICBpZihzYW1lKGJpbmRpbmcuX21vZGVsLmdldChrZXkpLCBuZXdWYWx1ZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuYXR0YWNoKGJpbmRpbmcuX21vZGVsLmdldCgnLicpKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLl9tb2RlbC5zZXQoa2V5LCBuZXdWYWx1ZSk7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9jaGFuZ2UgPSBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgIHZhbHVlID0gbmV3VmFsdWU7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnY2hhbmdlJywgYmluZGluZygpKTtcbiAgICB9O1xuICAgIGJpbmRpbmcuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQmluZGluZy5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9O1xuICAgIGJpbmRpbmcuZGVzdHJveSA9IGZ1bmN0aW9uKHNvZnQpe1xuICAgICAgICBpZihiaW5kaW5nLl9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKHNvZnQgJiYgKCFiaW5kaW5nLl9ldmVudHMgfHwgYmluZGluZy5fZXZlbnRzLmNoYW5nZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcuX2Rlc3Ryb3llZCA9IHRydWU7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICBiaW5kaW5nLmRldGFjaCgpO1xuICAgICAgICBiaW5kaW5nLl9tb2RlbC5kZXN0cm95KCk7XG4gICAgfTtcblxuICAgIGJpbmRpbmcuX21vZGVsLl9ldmVudHNbZmlsdGVyXSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGJpbmRpbmcuX2NoYW5nZShiaW5kaW5nLl9tb2RlbC5nZXQoa2V5KSk7XG4gICAgfTtcblxuICAgIHJldHVybiBiaW5kaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZUJpbmRpbmc7IiwidmFyIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhzZXR0aW5ncyk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICByZXN1bHRba2V5XSA9IHNldHRpbmdzW2tleV07XG4gICAgICAgIGlmKGlzLmJpbmRpbmdPYmplY3QocmVzdWx0W2tleV0pKXtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZmFzdG4uYmluZGluZyhcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZmFzdG5fYmluZGluZyxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZGVmYXVsdFZhbHVlLFxuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldLnRyYW5zZm9ybVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW4oaXRlbSl7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoaXRlbSkgPyBpdGVtLnJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGVsZW1lbnQpe1xuICAgICAgICBpZihlbGVtZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0LmNvbmNhdChmbGF0dGVuKGVsZW1lbnQpKTtcbiAgICB9LFtdKSA6IGl0ZW07XG59XG5cbmZ1bmN0aW9uIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsIGNhbGwsIGFyZ3Mpe1xuICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMoY29tcG9uZW50KTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgdmFyIHByb3BlcnR5ID0gY29tcG9uZW50W2tleXNbaV1dO1xuXG4gICAgICAgIGlmKCFpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBwcm9wZXJ0eVtjYWxsXS5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgaWYoaXMucHJvcGVydHkoc2V0dGluZ3Nba2V5XSkpe1xuICAgICAgICAgICAgY29tcG9uZW50W2tleV0gPSBzZXR0aW5nc1trZXldO1xuICAgICAgICB9ZWxzZSBpZihpcy5wcm9wZXJ0eShjb21wb25lbnRba2V5XSkpe1xuICAgICAgICAgICAgaWYoaXMuYmluZGluZyhzZXR0aW5nc1trZXldKSl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50W2tleV0uYmluZGluZyhzZXR0aW5nc1trZXldKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudFtrZXldKHNldHRpbmdzW2tleV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29tcG9uZW50W2tleV0uYWRkVG8oY29tcG9uZW50LCBrZXkpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuLCBjb21wb25lbnRzKXtcbiAgICB2YXIgY29tcG9uZW50LFxuICAgICAgICBiaW5kaW5nLFxuICAgICAgICBzY29wZSA9IG5ldyBFbnRpKGZhbHNlKTtcblxuICAgIHNldHRpbmdzID0gZGVyZWZlcmVuY2VTZXR0aW5ncyhzZXR0aW5ncyB8fCB7fSk7XG4gICAgY2hpbGRyZW4gPSBmbGF0dGVuKGNoaWxkcmVuKTtcblxuICAgIGlmKCEodHlwZSBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgIGlmKCEoJ19nZW5lcmljJyBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgICAgICB0aHJvdyAnTm8gY29tcG9uZW50IG9mIHR5cGUgXCInICsgdHlwZSArICdcIiBpcyBsb2FkZWQnO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHMuX2dlbmVyaWModHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHNbdHlwZV0odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfVxuXG4gICAgaWYoaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAvLyBUaGUgY29tcG9uZW50IGNvbnN0cnVjdG9yIHJldHVybmVkIGEgcmVhZHktdG8tZ28gY29tcG9uZW50LlxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5fdHlwZSA9IHR5cGU7XG4gICAgY29tcG9uZW50Ll9zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgIGNvbXBvbmVudC5fZmFzdG5fY29tcG9uZW50ID0gdHJ1ZTtcbiAgICBjb21wb25lbnQuX2NoaWxkcmVuID0gY2hpbGRyZW47XG5cbiAgICBjb21wb25lbnQuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcbiAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCBmaXJtKTtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBiaW5kaW5nLmRldGFjaChmaXJtKTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2RldGFjaCcsIDEpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuc2NvcGUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gc2NvcGU7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5kZXN0cm95ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoY29tcG9uZW50Ll9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5fZGVzdHJveWVkID0gdHJ1ZTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgY29tcG9uZW50LmVsZW1lbnQgPSBudWxsO1xuICAgICAgICBzY29wZS5kZXN0cm95KCk7XG4gICAgICAgIGJpbmRpbmcuZGVzdHJveSgpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICB2YXIgbGFzdEJvdW5kO1xuICAgIGZ1bmN0aW9uIGVtaXRBdHRhY2goKXtcbiAgICAgICAgdmFyIG5ld0JvdW5kID0gYmluZGluZygpO1xuICAgICAgICBpZihuZXdCb3VuZCAhPT0gbGFzdEJvdW5kKXtcbiAgICAgICAgICAgIGxhc3RCb3VuZCA9IG5ld0JvdW5kO1xuICAgICAgICAgICAgc2NvcGUuYXR0YWNoKGxhc3RCb3VuZCk7XG4gICAgICAgICAgICBjb21wb25lbnQuZW1pdCgnYXR0YWNoJywgbGFzdEJvdW5kLCAxKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbXBvbmVudC5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICAgICAgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcuYXR0YWNoKGJpbmRpbmcubW9kZWwsIGJpbmRpbmcuX2Zpcm0pO1xuICAgICAgICAgICAgYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgZW1pdEF0dGFjaCk7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nID0gbmV3QmluZGluZztcblxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBlbWl0QXR0YWNoKTtcbiAgICAgICAgZW1pdEF0dGFjaChiaW5kaW5nKCkpO1xuXG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5jbG9uZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjcmVhdGVDb21wb25lbnQoY29tcG9uZW50Ll90eXBlLCBmYXN0biwgY29tcG9uZW50Ll9zZXR0aW5ncywgY29tcG9uZW50Ll9jaGlsZHJlbi5maWx0ZXIoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuICFjaGlsZC5fdGVtcGxhdGVkO1xuICAgICAgICB9KS5tYXAoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuIGNoaWxkLmNsb25lKCk7XG4gICAgICAgIH0pLCBjb21wb25lbnRzKTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmNoaWxkcmVuID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudC5fY2hpbGRyZW4uc2xpY2UoKTtcbiAgICB9O1xuXG4gICAgaW5mbGF0ZVByb3BlcnRpZXMoY29tcG9uZW50LCBzZXR0aW5ncyk7XG5cbiAgICBjb21wb25lbnQub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsICdhdHRhY2gnLCBhcmd1bWVudHMpO1xuICAgIH0pO1xuICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yRWFjaFByb3BlcnR5KGNvbXBvbmVudCwgJ3VwZGF0ZScsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG4gICAgY29tcG9uZW50Lm9uKCdkZXRhY2gnLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnZGV0YWNoJywgYXJndW1lbnRzKTtcbiAgICB9KTtcbiAgICBjb21wb25lbnQub25jZSgnZGVzdHJveScsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsICdkZXN0cm95JywgYXJndW1lbnRzKTtcbiAgICB9KTtcblxuICAgIHZhciBkZWZhdWx0QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJy4nKTtcbiAgICBkZWZhdWx0QmluZGluZy5fZGVmYXVsdF9iaW5kaW5nID0gdHJ1ZTtcblxuICAgIGNvbXBvbmVudC5iaW5kaW5nKGRlZmF1bHRCaW5kaW5nKTtcblxuICAgIGlmKGZhc3RuLmRlYnVnKXtcbiAgICAgICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgaWYoY29tcG9uZW50LmVsZW1lbnQgJiYgdHlwZW9mIGNvbXBvbmVudC5lbGVtZW50ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50LmVsZW1lbnQuX2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn07XG4iLCJ2YXIgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4pe1xuICAgIHZhciBjb250YWluZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICBjb250YWluZXIuaW5zZXJ0ID0gZnVuY3Rpb24oY29tcG9uZW50LCBpbmRleCl7XG4gICAgICAgIGlmKGluZGV4ICYmIHR5cGVvZiBpbmRleCA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgY29tcG9uZW50ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkoY29tcG9uZW50KSl7XG4gICAgICAgICAgICBjb21wb25lbnQuZm9yRWFjaChjb250YWluZXIuaW5zZXJ0KTtcbiAgICAgICAgICAgIHJldHVybiBjb250YWluZXI7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY3VycmVudEluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5pbmRleE9mKGNvbXBvbmVudCksXG4gICAgICAgICAgICBuZXdDb21wb25lbnQgPSBmYXN0bi50b0NvbXBvbmVudChjb21wb25lbnQpO1xuXG4gICAgICAgIGlmKCFpcy5jb21wb25lbnQoY29tcG9uZW50KSl7XG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShjdXJyZW50SW5kZXgsIDEsIG5ld0NvbXBvbmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZihpc05hTihpbmRleCkpe1xuICAgICAgICAgICAgaW5kZXggPSBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgICBpZihjdXJyZW50SW5kZXggIT09IGluZGV4KXtcbiAgICAgICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgbmV3Q29tcG9uZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCkgJiYgIW5ld0NvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIG5ld0NvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5ld0NvbXBvbmVudC5hdHRhY2goY29udGFpbmVyLnNjb3BlKCksIDEpO1xuICAgICAgICBcbiAgICAgICAgY29udGFpbmVyLl9pbnNlcnQobmV3Q29tcG9uZW50LmVsZW1lbnQsIGluZGV4KTtcblxuICAgICAgICByZXR1cm4gY29udGFpbmVyO1xuICAgIH07XG5cbiAgICB2YXIgeCA9IDA7XG5cbiAgICBjb250YWluZXIuX2luc2VydCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGluZGV4KXtcbiAgICAgICAgdmFyIGNvbnRhaW5lckVsZW1lbnQgPSBjb250YWluZXIuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuICAgICAgICBpZighY29udGFpbmVyRWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihjb250YWluZXJFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdID09PSBlbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29udGFpbmVyRWxlbWVudC5pbnNlcnRCZWZvcmUoZWxlbWVudCwgY29udGFpbmVyRWxlbWVudC5jaGlsZE5vZGVzW2luZGV4XSk7XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5yZW1vdmUgPSBmdW5jdGlvbihjb21wb25lbnQpe1xuICAgICAgICB2YXIgaW5kZXggPSBjb250YWluZXIuX2NoaWxkcmVuLmluZGV4T2YoY29tcG9uZW50KTtcbiAgICAgICAgaWYofmluZGV4KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50LmRldGFjaCgxKTtcblxuICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBjb250YWluZXIuX3JlbW92ZShjb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9yZW1vdmUgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgdmFyIGNvbnRhaW5lckVsZW1lbnQgPSBjb250YWluZXIuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuXG4gICAgICAgIGlmKCFlbGVtZW50IHx8ICFjb250YWluZXJFbGVtZW50IHx8IGVsZW1lbnQucGFyZW50Tm9kZSAhPT0gY29udGFpbmVyRWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50LnJlbW92ZUNoaWxkKGVsZW1lbnQpO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5lbXB0eSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHdoaWxlKGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbnRhaW5lci5fY2hpbGRyZW4ucG9wKCkuZGV0YWNoKDEpLmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lci5jb250YWluZXJFbGVtZW50IHx8IGNvbnRhaW5lci5lbGVtZW50O1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgY29udGFpbmVyLmluc2VydChjb250YWluZXIuX2NoaWxkcmVuKTtcbiAgICB9KTtcblxuICAgIGNvbnRhaW5lci5vbignYXR0YWNoJywgZnVuY3Rpb24oZGF0YSwgZmlybSl7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbnRhaW5lci5fY2hpbGRyZW5baV0pKXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuW2ldLmF0dGFjaChkYXRhLCBmaXJtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oZGF0YSwgZmlybSl7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbnRhaW5lci5fY2hpbGRyZW5baV0pKXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuW2ldLmRlc3Ryb3koZmlybSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb250YWluZXI7XG59OyIsIi8vIElzIHRoZSBlbnRpdHkgZmlybWVyIHRoYW4gdGhlIG5ldyBmaXJtbmVzc1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbnRpdHksIGZpcm0pe1xuICAgIGlmKGZpcm0gIT0gbnVsbCAmJiAoZW50aXR5Ll9maXJtID09PSB1bmRlZmluZWQgfHwgZmlybSA8IGVudGl0eS5fZmlybSkpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59IiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgY29udGFpbmVyQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9jb250YWluZXJDb21wb25lbnQnKTtcblxudmFyIGZhbmN5UHJvcHMgPSB7XG4gICAgZGlzYWJsZWQ6IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSl7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUpe1xuICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHRleHRDb250ZW50OiBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dENvbnRlbnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihlbGVtZW50Lm5vZGVOYW1lID09PSAnSU5QVVQnICYmIGVsZW1lbnQudHlwZSA9PT0gJ2RhdGUnKXtcbiAgICAgICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpe1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgRGF0ZShlbGVtZW50LnZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhbHVlID0gbmV3IERhdGUodmFsdWUpO1xuICAgICAgICAgICAgaWYoaXNOYU4odmFsdWUpKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGVsZW1lbnQudmFsdWUgPSAodmFsdWUudG9KU09OKCkgKyAnJykuc3BsaXQoJ1QnKS5zaGlmdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSl7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZih2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBlbGVtZW50LnZhbHVlID0gdmFsdWU7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoZmFzdG4sIGdlbmVyaWMsIGtleSwgc2V0dGluZ3Mpe1xuICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XSxcbiAgICAgICAgYmluZGluZyA9IGZhc3RuLmlzQmluZGluZyhzZXR0aW5nKSAmJiBzZXR0aW5nLFxuICAgICAgICBwcm9wZXJ0eSA9IGZhc3RuLmlzUHJvcGVydHkoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgdmFsdWUgPSAhYmluZGluZyAmJiAhcHJvcGVydHkgJiYgc2V0dGluZztcblxuICAgIGlmKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZighcHJvcGVydHkpe1xuICAgICAgICBwcm9wZXJ0eSA9IGZhc3RuLnByb3BlcnR5KCk7XG4gICAgICAgIHByb3BlcnR5KHZhbHVlKTtcbiAgICAgICAgcHJvcGVydHkub24oJ3VwZGF0ZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgICAgIGlmKCFlbGVtZW50KXtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBpc1Byb3BlcnR5ID0ga2V5IGluIGVsZW1lbnQsXG4gICAgICAgICAgICAgICAgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1trZXldLFxuICAgICAgICAgICAgICAgIHByZXZpb3VzID0gZmFuY3lQcm9wID8gZmFuY3lQcm9wKGVsZW1lbnQpIDogaXNQcm9wZXJ0eSA/IGVsZW1lbnRba2V5XSA6IGVsZW1lbnQuZ2V0QXR0cmlidXRlKGtleSk7XG5cbiAgICAgICAgICAgIGlmKCFmYW5jeVByb3AgJiYgIWlzUHJvcGVydHkgJiYgdmFsdWUgPT0gbnVsbCl7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSAnJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYodmFsdWUgIT09IHByZXZpb3VzKXtcbiAgICAgICAgICAgICAgICBpZihmYW5jeVByb3Ape1xuICAgICAgICAgICAgICAgICAgICBmYW5jeVByb3AoZWxlbWVudCwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYoaXNQcm9wZXJ0eSl7XG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYodHlwZW9mIHZhbHVlICE9PSAnZnVuY3Rpb24nICYmIHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICBwcm9wZXJ0eS5iaW5kaW5nKGJpbmRpbmcpO1xuICAgIH1cblxuICAgIHByb3BlcnR5LmFkZFRvKGdlbmVyaWMsIGtleSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnRpZXMoZmFzdG4sIGdlbmVyaWMsIHNldHRpbmdzKXtcbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIGNyZWF0ZVByb3BlcnR5KGZhc3RuLCBnZW5lcmljLCBrZXksIHNldHRpbmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGFkZFVwZGF0ZUhhbmRsZXIoZ2VuZXJpYywgZXZlbnROYW1lLCBzZXR0aW5ncyl7XG4gICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmdldENvbnRhaW5lckVsZW1lbnQoKSxcbiAgICAgICAgaGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgICAgIGdlbmVyaWMuZW1pdChldmVudE5hbWUsIGV2ZW50LCBnZW5lcmljLnNjb3BlKCkpO1xuICAgICAgICB9O1xuXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG5cbiAgICBnZW5lcmljLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZEF1dG9IYW5kbGVyKGdlbmVyaWMsIGtleSwgc2V0dGluZ3Mpe1xuICAgIGlmKCFzZXR0aW5nc1trZXldKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5nZXRDb250YWluZXJFbGVtZW50KCksXG4gICAgICAgIGF1dG9FdmVudCA9IHNldHRpbmdzW2tleV0uc3BsaXQoJzonKSxcbiAgICAgICAgZXZlbnROYW1lID0ga2V5LnNsaWNlKDIpO1xuXG4gICAgZGVsZXRlIHNldHRpbmdzW2tleV07XG5cbiAgICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgdmFyIGZhbmN5UHJvcCA9IGZhbmN5UHJvcHNbYXV0b0V2ZW50WzFdXSxcbiAgICAgICAgICAgIHZhbHVlID0gZmFuY3lQcm9wID8gZmFuY3lQcm9wKGVsZW1lbnQpIDogZWxlbWVudFthdXRvRXZlbnRbMV1dO1xuXG4gICAgICAgIGdlbmVyaWNbYXV0b0V2ZW50WzBdXSh2YWx1ZSk7XG4gICAgfTtcblxuICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuXG4gICAgZ2VuZXJpYy5vbignZGVzdHJveScsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuICAgIHZhciBnZW5lcmljID0gY29udGFpbmVyQ29tcG9uZW50KHR5cGUsIGZhc3RuKTtcblxuICAgIGNyZWF0ZVByb3BlcnRpZXMoZmFzdG4sIGdlbmVyaWMsIHNldHRpbmdzKTtcblxuICAgIGdlbmVyaWMucmVuZGVyID0gZnVuY3Rpb24oKXtcbiAgICAgICAgZ2VuZXJpYy5lbGVtZW50ID0gY3JlbCh0eXBlKTtcblxuICAgICAgICBnZW5lcmljLmVtaXQoJ3JlbmRlcicpO1xuXG4gICAgICAgIHJldHVybiBnZW5lcmljO1xuICAgIH07XG5cbiAgICBnZW5lcmljLm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgICAgIGlmKGtleS5zbGljZSgwLDIpID09PSAnb24nICYmIGtleSBpbiBlbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRBdXRvSGFuZGxlcihnZW5lcmljLCBrZXksIHNldHRpbmdzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZvcih2YXIga2V5IGluIGdlbmVyaWMuX2V2ZW50cyl7XG4gICAgICAgICAgICBpZignb24nICsga2V5LnRvTG93ZXJDYXNlKCkgaW4gZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkVXBkYXRlSGFuZGxlcihnZW5lcmljLCBrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gZ2VuZXJpYztcbn07IiwidmFyIG1lcmdlID0gcmVxdWlyZSgnZmxhdC1tZXJnZScpLFxuICAgIGNyZWF0ZUNvbXBvbmVudCA9IHJlcXVpcmUoJy4vY29tcG9uZW50JyksXG4gICAgY3JlYXRlUHJvcGVydHkgPSByZXF1aXJlKCcuL3Byb3BlcnR5JyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMjtcblxuICAgICAgICBpZihpcy5jb21wb25lbnQoYXJnc1sxXSkgfHwgQXJyYXkuaXNBcnJheShhcmdzWzFdKSB8fCB0eXBlb2YgYXJnc1sxXSAhPT0gJ29iamVjdCcgfHwgIWFyZ3NbMV0pe1xuICAgICAgICAgICAgY2hpbGRyZW5JbmRleC0tO1xuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGFyZ3Muc2xpY2UoY2hpbGRyZW5JbmRleCksIGNvbXBvbmVudHMpO1xuICAgIH1cblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG5cbiAgICBmYXN0bi5wcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5O1xuXG4gICAgZmFzdG4uYmluZGluZyA9IGNyZWF0ZUJpbmRpbmc7XG5cbiAgICBmYXN0bi50b0NvbXBvbmVudCA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIGlmKGlzLmNvbXBvbmVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYodHlwZW9mIGNvbXBvbmVudCAhPT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCd0ZXh0Jywge3RleHQ6IGNvbXBvbmVudH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNFbGVtZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKGNvbXBvbmVudCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoY3JlbC5pc05vZGUoY29tcG9uZW50KSl7XG4gICAgICAgICAgICByZXR1cm4gZmFzdG4oJ3RleHQnLCB7dGV4dDogY29tcG9uZW50LnRleHRDb250ZW50fSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZmFzdG4uaXNDb21wb25lbnQgPSBpcy5jb21wb25lbnQ7XG4gICAgZmFzdG4uaXNCaW5kaW5nID0gaXMuYmluZGluZztcbiAgICBmYXN0bi5pc0RlZmF1bHRCaW5kaW5nID0gaXMuZGVmYXVsdEJpbmRpbmc7XG4gICAgZmFzdG4uaXNCaW5kaW5nT2JqZWN0ID0gaXMuYmluZGluZ09iamVjdDtcbiAgICBmYXN0bi5pc1Byb3BlcnR5ID0gaXMucHJvcGVydHk7XG5cbiAgICByZXR1cm4gZmFzdG47XG59OyIsIlxuZnVuY3Rpb24gaXNDb21wb25lbnQodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fY29tcG9uZW50JyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNCaW5kaW5nT2JqZWN0KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnb2JqZWN0JyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmcodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdmdW5jdGlvbicgJiYgJ19mYXN0bl9iaW5kaW5nJyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNQcm9wZXJ0eSh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX3Byb3BlcnR5JyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNEZWZhdWx0QmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nICYmICdfZGVmYXVsdF9iaW5kaW5nJyBpbiB0aGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgY29tcG9uZW50OiBpc0NvbXBvbmVudCxcbiAgICBiaW5kaW5nT2JqZWN0OiBpc0JpbmRpbmdPYmplY3QsXG4gICAgYmluZGluZzogaXNCaW5kaW5nLFxuICAgIGRlZmF1bHRCaW5kaW5nOiBpc0RlZmF1bHRCaW5kaW5nLFxuICAgIHByb3BlcnR5OiBpc1Byb3BlcnR5XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgTWFwID0gcmVxdWlyZSgnZXM2LW1hcCcpLFxuICAgIGdlbmVyaWNDb21wb25lbnQgPSByZXF1aXJlKCcuL2dlbmVyaWNDb21wb25lbnQnKTtcblxuZnVuY3Rpb24gZWFjaCh2YWx1ZSwgZm4pe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG5cbiAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgIGlmKGlzQXJyYXkgJiYgaXNOYU4oa2V5KSl7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZuKHZhbHVlW2tleV0sIGtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBrZXlGb3Iob2JqZWN0LCB2YWx1ZSl7XG4gICAgaWYoIW9iamVjdCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGtleSBpbiBvYmplY3Qpe1xuICAgICAgICBpZihvYmplY3Rba2V5XSA9PT0gdmFsdWUpe1xuICAgICAgICAgICAgcmV0dXJuIGtleTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gdmFsdWVzKG9iamVjdCl7XG4gICAgaWYoQXJyYXkuaXNBcnJheShvYmplY3QpKXtcbiAgICAgICAgcmV0dXJuIG9iamVjdC5zbGljZSgpO1xuICAgIH1cblxuICAgIHZhciByZXN1bHQgPSBbXTtcblxuICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgIHJlc3VsdC5wdXNoKG9iamVjdFtrZXldKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuICAgIHZhciBsaXN0ID0gZ2VuZXJpY0NvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKSxcbiAgICAgICAgaXRlbXNNYXAgPSBuZXcgTWFwKCk7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVJdGVtcyh2YWx1ZSl7XG4gICAgICAgIHZhciB0ZW1wbGF0ZSA9IGxpc3QuX3NldHRpbmdzLnRlbXBsYXRlO1xuICAgICAgICBpZighdGVtcGxhdGUpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW1zID0gdmFsdWVzKHZhbHVlKTtcbiAgICAgICAgICAgIGN1cnJlbnRJdGVtcyA9IGl0ZW1zLnNsaWNlKCk7XG5cbiAgICAgICAgaXRlbXNNYXAuZm9yRWFjaChmdW5jdGlvbihjb21wb25lbnQsIGl0ZW0pe1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGN1cnJlbnRJdGVtcy5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXMuc3BsaWNlKGN1cnJlbnRJbmRleCwxKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGxpc3QucmVtb3ZlSXRlbShpdGVtLCBpdGVtc01hcCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBpbmRleCA9IDAsXG4gICAgICAgICAgICBuZXdJdGVtcyA9IFtdLFxuICAgICAgICAgICAgbmV3Q29tcG9uZW50cyA9IFtdO1xuXG4gICAgICAgIGVhY2godmFsdWUsIGZ1bmN0aW9uKGl0ZW0sIGtleSl7XG4gICAgICAgICAgICB3aGlsZShpbmRleCA8IGxpc3QuX2NoaWxkcmVuLmxlbmd0aCAmJiBsaXN0Ll9jaGlsZHJlbltpbmRleF0uX3RlbXBsYXRlZCAmJiAhfml0ZW1zLmluZGV4T2YobGlzdC5fY2hpbGRyZW5baW5kZXhdLl9saXN0SXRlbSkpe1xuICAgICAgICAgICAgICAgIGluZGV4KytcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGNoaWxkLFxuICAgICAgICAgICAgICAgIG1vZGVsID0gbmV3IEVudGkoe1xuICAgICAgICAgICAgICAgICAgICBpdGVtOiBpdGVtLFxuICAgICAgICAgICAgICAgICAgICBrZXk6IGtleVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZighaXRlbXNNYXAuaGFzKGl0ZW0pKXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGZhc3RuLnRvQ29tcG9uZW50KHRlbXBsYXRlKG1vZGVsLCBsaXN0LnNjb3BlKCkpKTtcbiAgICAgICAgICAgICAgICBjaGlsZC5fbGlzdEl0ZW0gPSBpdGVtO1xuICAgICAgICAgICAgICAgIGNoaWxkLl90ZW1wbGF0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgaXRlbXNNYXAuc2V0KGl0ZW0sIGNoaWxkKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNoaWxkID0gaXRlbXNNYXAuZ2V0KGl0ZW0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjaGlsZCkgJiYgbGlzdC5fc2V0dGluZ3MuYXR0YWNoVGVtcGxhdGVzICE9PSBmYWxzZSl7XG4gICAgICAgICAgICAgICAgY2hpbGQuYXR0YWNoKG1vZGVsLCAyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGlzdC5pbnNlcnQoY2hpbGQsIGluZGV4KTtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGxpc3QucmVtb3ZlSXRlbSA9IGZ1bmN0aW9uKGl0ZW0sIGl0ZW1zTWFwKXtcbiAgICAgICAgdmFyIGNvbXBvbmVudCA9IGl0ZW1zTWFwLmdldChpdGVtKVxuICAgICAgICBsaXN0LnJlbW92ZShjb21wb25lbnQpO1xuICAgICAgICBjb21wb25lbnQuZGVzdHJveSgpO1xuICAgICAgICBpdGVtc01hcC5kZWxldGUoaXRlbSk7XG4gICAgfVxuXG4gICAgbGlzdC5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICB0aGlzLmVsZW1lbnQgPSBjcmVsKHNldHRpbmdzLnRhZ05hbWUgfHwgJ2RpdicpO1xuICAgICAgICB0aGlzLmVtaXQoJ3JlbmRlcicpO1xuICAgIH07XG5cbiAgICBmYXN0bi5wcm9wZXJ0eShbXSwgc2V0dGluZ3MuaXRlbUNoYW5nZXMgfHwgJ3N0cnVjdHVyZScpXG4gICAgICAgIC5hZGRUbyhsaXN0LCAnaXRlbXMnKVxuICAgICAgICAuYmluZGluZyhzZXR0aW5ncy5pdGVtcylcbiAgICAgICAgLm9uKCd1cGRhdGUnLCB1cGRhdGVJdGVtcyk7XG5cbiAgICByZXR1cm4gbGlzdDtcbn07IiwiLyoqXG5cbiAgICBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gYWRkIEV2ZW50RW1pdHRlciBtZXRob2RzIHRvIGZ1bmN0aW9ucyxcbiAgICB3aGljaCBjYW5ub3QgYmUgYWRkZWQgaW4gdGhlIHVzdWFsLCBDb25zdHJ1Y3Rvci5wcm90b3R5cGUgZmFzc2lvbi5cblxuKi9cblxudmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxudmFyIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSA9IGZ1bmN0aW9uKCl7fTtcbmZvcih2YXIga2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1ha2VGdW5jdGlvbkVtaXR0ZXIob2JqZWN0KXtcbiAgICBpZihPYmplY3Quc2V0UHJvdG90eXBlT2Ype1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2Yob2JqZWN0LCBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUpO1xuICAgIH1lbHNlIGlmKF9fcHJvdG9fXyBpbiBvYmplY3Qpe1xuICAgICAgICBvYmplY3QuX19wcm90b19fID0gZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlO1xuICAgIH1lbHNle1xuICAgICAgICBmb3IodmFyIGtleSBpbiBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUpe1xuICAgICAgICAgICAgb2JqZWN0W2tleV0gPSBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGVba2V5XTtcbiAgICAgICAgfVxuICAgIH1cbn07IiwiLy9Db3B5cmlnaHQgKEMpIDIwMTIgS29yeSBOdW5uXHJcblxyXG4vL1Blcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XHJcblxyXG4vL1RoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxyXG5cclxuLy9USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cclxuXHJcbi8qXHJcblxyXG4gICAgVGhpcyBjb2RlIGlzIG5vdCBmb3JtYXR0ZWQgZm9yIHJlYWRhYmlsaXR5LCBidXQgcmF0aGVyIHJ1bi1zcGVlZCBhbmQgdG8gYXNzaXN0IGNvbXBpbGVycy5cclxuXHJcbiAgICBIb3dldmVyLCB0aGUgY29kZSdzIGludGVudGlvbiBzaG91bGQgYmUgdHJhbnNwYXJlbnQuXHJcblxyXG4gICAgKioqIElFIFNVUFBPUlQgKioqXHJcblxyXG4gICAgSWYgeW91IHJlcXVpcmUgdGhpcyBsaWJyYXJ5IHRvIHdvcmsgaW4gSUU3LCBhZGQgdGhlIGZvbGxvd2luZyBhZnRlciBkZWNsYXJpbmcgY3JlbC5cclxuXHJcbiAgICB2YXIgdGVzdERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG4gICAgICAgIHRlc3RMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xhYmVsJyk7XHJcblxyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgJ2EnKTtcclxuICAgIHRlc3REaXZbJ2NsYXNzTmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2NsYXNzJ10gPSAnY2xhc3NOYW1lJzp1bmRlZmluZWQ7XHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnbmFtZScsJ2EnKTtcclxuICAgIHRlc3REaXZbJ25hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWyduYW1lJ10gPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XHJcbiAgICAgICAgZWxlbWVudC5pZCA9IHZhbHVlO1xyXG4gICAgfTp1bmRlZmluZWQ7XHJcblxyXG5cclxuICAgIHRlc3RMYWJlbC5zZXRBdHRyaWJ1dGUoJ2ZvcicsICdhJyk7XHJcbiAgICB0ZXN0TGFiZWxbJ2h0bWxGb3InXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydmb3InXSA9ICdodG1sRm9yJzp1bmRlZmluZWQ7XHJcblxyXG5cclxuXHJcbiovXHJcblxyXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmNyZWwgPSBmYWN0b3J5KCk7XHJcbiAgICB9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG4gICAgdmFyIGZuID0gJ2Z1bmN0aW9uJyxcclxuICAgICAgICBvYmogPSAnb2JqZWN0JyxcclxuICAgICAgICBub2RlVHlwZSA9ICdub2RlVHlwZScsXHJcbiAgICAgICAgdGV4dENvbnRlbnQgPSAndGV4dENvbnRlbnQnLFxyXG4gICAgICAgIHNldEF0dHJpYnV0ZSA9ICdzZXRBdHRyaWJ1dGUnLFxyXG4gICAgICAgIGF0dHJNYXBTdHJpbmcgPSAnYXR0ck1hcCcsXHJcbiAgICAgICAgaXNOb2RlU3RyaW5nID0gJ2lzTm9kZScsXHJcbiAgICAgICAgaXNFbGVtZW50U3RyaW5nID0gJ2lzRWxlbWVudCcsXHJcbiAgICAgICAgZCA9IHR5cGVvZiBkb2N1bWVudCA9PT0gb2JqID8gZG9jdW1lbnQgOiB7fSxcclxuICAgICAgICBpc1R5cGUgPSBmdW5jdGlvbihhLCB0eXBlKXtcclxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhID09PSB0eXBlO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNOb2RlID0gdHlwZW9mIE5vZGUgPT09IGZuID8gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgTm9kZTtcclxuICAgICAgICB9IDpcclxuICAgICAgICAvLyBpbiBJRSA8PSA4IE5vZGUgaXMgYW4gb2JqZWN0LCBvYnZpb3VzbHkuLlxyXG4gICAgICAgIGZ1bmN0aW9uKG9iamVjdCl7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3QsIG9iaikgJiZcclxuICAgICAgICAgICAgICAgIChub2RlVHlwZSBpbiBvYmplY3QpICYmXHJcbiAgICAgICAgICAgICAgICBpc1R5cGUob2JqZWN0Lm93bmVyRG9jdW1lbnQsb2JqKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzRWxlbWVudCA9IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGNyZWxbaXNOb2RlU3RyaW5nXShvYmplY3QpICYmIG9iamVjdFtub2RlVHlwZV0gPT09IDE7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0FycmF5ID0gZnVuY3Rpb24oYSl7XHJcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcHBlbmRDaGlsZCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGNoaWxkKSB7XHJcbiAgICAgICAgICBpZighY3JlbFtpc05vZGVTdHJpbmddKGNoaWxkKSl7XHJcbiAgICAgICAgICAgICAgY2hpbGQgPSBkLmNyZWF0ZVRleHROb2RlKGNoaWxkKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGVsZW1lbnQuYXBwZW5kQ2hpbGQoY2hpbGQpO1xyXG4gICAgICAgIH07XHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGNyZWwoKXtcclxuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cywgLy9Ob3RlOiBhc3NpZ25lZCB0byBhIHZhcmlhYmxlIHRvIGFzc2lzdCBjb21waWxlcnMuIFNhdmVzIGFib3V0IDQwIGJ5dGVzIGluIGNsb3N1cmUgY29tcGlsZXIuIEhhcyBuZWdsaWdhYmxlIGVmZmVjdCBvbiBwZXJmb3JtYW5jZS5cclxuICAgICAgICAgICAgZWxlbWVudCA9IGFyZ3NbMF0sXHJcbiAgICAgICAgICAgIGNoaWxkLFxyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IGFyZ3NbMV0sXHJcbiAgICAgICAgICAgIGNoaWxkSW5kZXggPSAyLFxyXG4gICAgICAgICAgICBhcmd1bWVudHNMZW5ndGggPSBhcmdzLmxlbmd0aCxcclxuICAgICAgICAgICAgYXR0cmlidXRlTWFwID0gY3JlbFthdHRyTWFwU3RyaW5nXTtcclxuXHJcbiAgICAgICAgZWxlbWVudCA9IGNyZWxbaXNFbGVtZW50U3RyaW5nXShlbGVtZW50KSA/IGVsZW1lbnQgOiBkLmNyZWF0ZUVsZW1lbnQoZWxlbWVudCk7XHJcbiAgICAgICAgLy8gc2hvcnRjdXRcclxuICAgICAgICBpZihhcmd1bWVudHNMZW5ndGggPT09IDEpe1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCFpc1R5cGUoc2V0dGluZ3Msb2JqKSB8fCBjcmVsW2lzTm9kZVN0cmluZ10oc2V0dGluZ3MpIHx8IGlzQXJyYXkoc2V0dGluZ3MpKSB7XHJcbiAgICAgICAgICAgIC0tY2hpbGRJbmRleDtcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gc2hvcnRjdXQgaWYgdGhlcmUgaXMgb25seSBvbmUgY2hpbGQgdGhhdCBpcyBhIHN0cmluZ1xyXG4gICAgICAgIGlmKChhcmd1bWVudHNMZW5ndGggLSBjaGlsZEluZGV4KSA9PT0gMSAmJiBpc1R5cGUoYXJnc1tjaGlsZEluZGV4XSwgJ3N0cmluZycpICYmIGVsZW1lbnRbdGV4dENvbnRlbnRdICE9PSB1bmRlZmluZWQpe1xyXG4gICAgICAgICAgICBlbGVtZW50W3RleHRDb250ZW50XSA9IGFyZ3NbY2hpbGRJbmRleF07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGZvcig7IGNoaWxkSW5kZXggPCBhcmd1bWVudHNMZW5ndGg7ICsrY2hpbGRJbmRleCl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYoY2hpbGQgPT0gbnVsbCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGNoaWxkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGRbaV0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcclxuICAgICAgICAgICAgaWYoIWF0dHJpYnV0ZU1hcFtrZXldKXtcclxuICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShrZXksIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlTWFwW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZih0eXBlb2YgYXR0ciA9PT0gZm4pe1xyXG4gICAgICAgICAgICAgICAgICAgIGF0dHIoZWxlbWVudCwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50W3NldEF0dHJpYnV0ZV0oYXR0ciwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZWQgZm9yIG1hcHBpbmcgb25lIGtpbmQgb2YgYXR0cmlidXRlIHRvIHRoZSBzdXBwb3J0ZWQgdmVyc2lvbiBvZiB0aGF0IGluIGJhZCBicm93c2Vycy5cclxuICAgIGNyZWxbYXR0ck1hcFN0cmluZ10gPSB7fTtcclxuXHJcbiAgICBjcmVsW2lzRWxlbWVudFN0cmluZ10gPSBpc0VsZW1lbnQ7XHJcblxyXG4gICAgY3JlbFtpc05vZGVTdHJpbmddID0gaXNOb2RlO1xyXG5cclxuICAgIHJldHVybiBjcmVsO1xyXG59KSk7XHJcbiIsInZhciBkb2MgPSB7XHJcbiAgICBkb2N1bWVudDogdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50IDogbnVsbCxcclxuICAgIHNldERvY3VtZW50OiBmdW5jdGlvbihkKXtcclxuICAgICAgICB0aGlzLmRvY3VtZW50ID0gZDtcclxuICAgIH1cclxufTtcclxuXHJcbnZhciBhcnJheVByb3RvID0gW10sXHJcbiAgICBpc0xpc3QgPSByZXF1aXJlKCcuL2lzTGlzdCcpLFxyXG4gICAgZ2V0VGFyZ2V0cyA9IHJlcXVpcmUoJy4vZ2V0VGFyZ2V0cycpKGRvYy5kb2N1bWVudCksXHJcbiAgICBnZXRUYXJnZXQgPSByZXF1aXJlKCcuL2dldFRhcmdldCcpKGRvYy5kb2N1bWVudCksXHJcbiAgICBzcGFjZSA9ICcgJztcclxuXHJcblxyXG4vLy9bUkVBRE1FLm1kXVxyXG5cclxuZnVuY3Rpb24gaXNJbihhcnJheSwgaXRlbSl7XHJcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYXJyYXkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBpZihpdGVtID09PSBhcnJheVtpXSl7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmZpbmRcclxuXHJcbiAgICBmaW5kcyBlbGVtZW50cyB0aGF0IG1hdGNoIHRoZSBxdWVyeSB3aXRoaW4gdGhlIHNjb3BlIG9mIHRhcmdldFxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLmZpbmQocXVlcnkpO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5maW5kKHRhcmdldCwgcXVlcnkpO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gZmluZCh0YXJnZXQsIHF1ZXJ5KXtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldHModGFyZ2V0KTtcclxuICAgIGlmKHF1ZXJ5ID09IG51bGwpe1xyXG4gICAgICAgIHJldHVybiB0YXJnZXQ7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgIHZhciByZXN1bHRzID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHN1YlJlc3VsdHMgPSBkb2MuZmluZCh0YXJnZXRbaV0sIHF1ZXJ5KTtcclxuICAgICAgICAgICAgZm9yKHZhciBqID0gMDsgaiA8IHN1YlJlc3VsdHMubGVuZ3RoOyBqKyspIHtcclxuICAgICAgICAgICAgICAgIGlmKCFpc0luKHJlc3VsdHMsIHN1YlJlc3VsdHNbal0pKXtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goc3ViUmVzdWx0c1tqXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRhcmdldCA/IHRhcmdldC5xdWVyeVNlbGVjdG9yQWxsKHF1ZXJ5KSA6IFtdO1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAuZmluZE9uZVxyXG5cclxuICAgIGZpbmRzIHRoZSBmaXJzdCBlbGVtZW50IHRoYXQgbWF0Y2hlcyB0aGUgcXVlcnkgd2l0aGluIHRoZSBzY29wZSBvZiB0YXJnZXRcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5maW5kT25lKHF1ZXJ5KTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MuZmluZE9uZSh0YXJnZXQsIHF1ZXJ5KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIGZpbmRPbmUodGFyZ2V0LCBxdWVyeSl7XHJcbiAgICB0YXJnZXQgPSBnZXRUYXJnZXQodGFyZ2V0KTtcclxuICAgIGlmKHF1ZXJ5ID09IG51bGwpe1xyXG4gICAgICAgIHJldHVybiB0YXJnZXQ7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgIHZhciByZXN1bHQ7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gZmluZE9uZSh0YXJnZXRbaV0sIHF1ZXJ5KTtcclxuICAgICAgICAgICAgaWYocmVzdWx0KXtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRhcmdldCA/IHRhcmdldC5xdWVyeVNlbGVjdG9yKHF1ZXJ5KSA6IG51bGw7XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5jbG9zZXN0XHJcblxyXG4gICAgcmVjdXJzZXMgdXAgdGhlIERPTSBmcm9tIHRoZSB0YXJnZXQgbm9kZSwgY2hlY2tpbmcgaWYgdGhlIGN1cnJlbnQgZWxlbWVudCBtYXRjaGVzIHRoZSBxdWVyeVxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLmNsb3Nlc3QocXVlcnkpO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5jbG9zZXN0KHRhcmdldCwgcXVlcnkpO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gY2xvc2VzdCh0YXJnZXQsIHF1ZXJ5KXtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpO1xyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB0YXJnZXQgPSB0YXJnZXRbMF07XHJcbiAgICB9XHJcblxyXG4gICAgd2hpbGUoXHJcbiAgICAgICAgdGFyZ2V0ICYmXHJcbiAgICAgICAgdGFyZ2V0Lm93bmVyRG9jdW1lbnQgJiZcclxuICAgICAgICAhaXModGFyZ2V0LCBxdWVyeSlcclxuICAgICl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0LnBhcmVudE5vZGU7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRhcmdldCA9PT0gZG9jLmRvY3VtZW50ICYmIHRhcmdldCAhPT0gcXVlcnkgPyBudWxsIDogdGFyZ2V0O1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAuaXNcclxuXHJcbiAgICByZXR1cm5zIHRydWUgaWYgdGhlIHRhcmdldCBlbGVtZW50IG1hdGNoZXMgdGhlIHF1ZXJ5XHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldCkuaXMocXVlcnkpO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5pcyh0YXJnZXQsIHF1ZXJ5KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIGlzKHRhcmdldCwgcXVlcnkpe1xyXG4gICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0KHRhcmdldCk7XHJcblxyXG4gICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgIHRhcmdldCA9IHRhcmdldFswXTtcclxuICAgIH1cclxuXHJcbiAgICBpZighdGFyZ2V0Lm93bmVyRG9jdW1lbnQgfHwgdHlwZW9mIHF1ZXJ5ICE9PSAnc3RyaW5nJyl7XHJcbiAgICAgICAgcmV0dXJuIHRhcmdldCA9PT0gcXVlcnk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYodGFyZ2V0ID09PSBxdWVyeSl7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHBhcmVudGxlc3MgPSAhdGFyZ2V0LnBhcmVudE5vZGU7XHJcblxyXG4gICAgaWYocGFyZW50bGVzcyl7XHJcbiAgICAgICAgLy8gR2l2ZSB0aGUgZWxlbWVudCBhIHBhcmVudCBzbyB0aGF0IC5xdWVyeVNlbGVjdG9yQWxsIGNhbiBiZSB1c2VkXHJcbiAgICAgICAgZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpLmFwcGVuZENoaWxkKHRhcmdldCk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IGFycmF5UHJvdG8uaW5kZXhPZi5jYWxsKGZpbmQodGFyZ2V0LnBhcmVudE5vZGUsIHF1ZXJ5KSwgdGFyZ2V0KSA+PSAwO1xyXG5cclxuICAgIGlmKHBhcmVudGxlc3Mpe1xyXG4gICAgICAgIHRhcmdldC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRhcmdldCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmFkZENsYXNzXHJcblxyXG4gICAgYWRkcyBjbGFzc2VzIHRvIHRoZSB0YXJnZXRcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5hZGRDbGFzcyhxdWVyeSk7XHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLmFkZENsYXNzKHRhcmdldCwgcXVlcnkpO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gYWRkQ2xhc3ModGFyZ2V0LCBjbGFzc2VzKXtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldHModGFyZ2V0KTtcclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgYWRkQ2xhc3ModGFyZ2V0W2ldLCBjbGFzc2VzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICB9XHJcbiAgICBpZighY2xhc3Nlcyl7XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGNsYXNzZXMgPSBjbGFzc2VzLnNwbGl0KHNwYWNlKSxcclxuICAgICAgICBjdXJyZW50Q2xhc3NlcyA9IHRhcmdldC5jbGFzc0xpc3QgPyBudWxsIDogdGFyZ2V0LmNsYXNzTmFtZS5zcGxpdChzcGFjZSk7XHJcblxyXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGNsYXNzZXMubGVuZ3RoOyBpKyspe1xyXG4gICAgICAgIHZhciBjbGFzc1RvQWRkID0gY2xhc3Nlc1tpXTtcclxuICAgICAgICBpZighY2xhc3NUb0FkZCB8fCBjbGFzc1RvQWRkID09PSBzcGFjZSl7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZih0YXJnZXQuY2xhc3NMaXN0KXtcclxuICAgICAgICAgICAgdGFyZ2V0LmNsYXNzTGlzdC5hZGQoY2xhc3NUb0FkZCk7XHJcbiAgICAgICAgfSBlbHNlIGlmKCFjdXJyZW50Q2xhc3Nlcy5pbmRleE9mKGNsYXNzVG9BZGQpPj0wKXtcclxuICAgICAgICAgICAgY3VycmVudENsYXNzZXMucHVzaChjbGFzc1RvQWRkKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZighdGFyZ2V0LmNsYXNzTGlzdCl7XHJcbiAgICAgICAgdGFyZ2V0LmNsYXNzTmFtZSA9IGN1cnJlbnRDbGFzc2VzLmpvaW4oc3BhY2UpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn1cclxuXHJcbi8qKlxyXG5cclxuICAgICMjIC5yZW1vdmVDbGFzc1xyXG5cclxuICAgIHJlbW92ZXMgY2xhc3NlcyBmcm9tIHRoZSB0YXJnZXRcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5yZW1vdmVDbGFzcyhxdWVyeSk7XHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLnJlbW92ZUNsYXNzKHRhcmdldCwgcXVlcnkpO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gcmVtb3ZlQ2xhc3ModGFyZ2V0LCBjbGFzc2VzKXtcclxuICAgIHRhcmdldCA9IGdldFRhcmdldHModGFyZ2V0KTtcclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgcmVtb3ZlQ2xhc3ModGFyZ2V0W2ldLCBjbGFzc2VzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoIWNsYXNzZXMpe1xyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjbGFzc2VzID0gY2xhc3Nlcy5zcGxpdChzcGFjZSksXHJcbiAgICAgICAgY3VycmVudENsYXNzZXMgPSB0YXJnZXQuY2xhc3NMaXN0ID8gbnVsbCA6IHRhcmdldC5jbGFzc05hbWUuc3BsaXQoc3BhY2UpO1xyXG5cclxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjbGFzc2VzLmxlbmd0aDsgaSsrKXtcclxuICAgICAgICB2YXIgY2xhc3NUb1JlbW92ZSA9IGNsYXNzZXNbaV07XHJcbiAgICAgICAgaWYoIWNsYXNzVG9SZW1vdmUgfHwgY2xhc3NUb1JlbW92ZSA9PT0gc3BhY2Upe1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYodGFyZ2V0LmNsYXNzTGlzdCl7XHJcbiAgICAgICAgICAgIHRhcmdldC5jbGFzc0xpc3QucmVtb3ZlKGNsYXNzVG9SZW1vdmUpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIHJlbW92ZUluZGV4ID0gY3VycmVudENsYXNzZXMuaW5kZXhPZihjbGFzc1RvUmVtb3ZlKTtcclxuICAgICAgICBpZihyZW1vdmVJbmRleCA+PSAwKXtcclxuICAgICAgICAgICAgY3VycmVudENsYXNzZXMuc3BsaWNlKHJlbW92ZUluZGV4LCAxKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZighdGFyZ2V0LmNsYXNzTGlzdCl7XHJcbiAgICAgICAgdGFyZ2V0LmNsYXNzTmFtZSA9IGN1cnJlbnRDbGFzc2VzLmpvaW4oc3BhY2UpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFkZEV2ZW50KHNldHRpbmdzKXtcclxuICAgIHZhciB0YXJnZXQgPSBnZXRUYXJnZXQoc2V0dGluZ3MudGFyZ2V0KTtcclxuICAgIGlmKHRhcmdldCl7XHJcbiAgICAgICAgdGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXIoc2V0dGluZ3MuZXZlbnQsIHNldHRpbmdzLmNhbGxiYWNrLCBmYWxzZSk7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ05vIGVsZW1lbnRzIG1hdGNoZWQgdGhlIHNlbGVjdG9yLCBzbyBubyBldmVudHMgd2VyZSBib3VuZC4nKTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLm9uXHJcblxyXG4gICAgYmluZHMgYSBjYWxsYmFjayB0byBhIHRhcmdldCB3aGVuIGEgRE9NIGV2ZW50IGlzIHJhaXNlZC5cclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0L3Byb3h5KS5vbihldmVudHMsIHRhcmdldFtvcHRpb25hbF0sIGNhbGxiYWNrKTtcclxuXHJcbiAgICBub3RlOiBpZiBhIHRhcmdldCBpcyBwYXNzZWQgdG8gdGhlIC5vbiBmdW5jdGlvbiwgZG9jJ3MgdGFyZ2V0IHdpbGwgYmUgdXNlZCBhcyB0aGUgcHJveHkuXHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLm9uKGV2ZW50cywgdGFyZ2V0LCBxdWVyeSwgcHJveHlbb3B0aW9uYWxdKTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIG9uKGV2ZW50cywgdGFyZ2V0LCBjYWxsYmFjaywgcHJveHkpe1xyXG5cclxuICAgIHByb3h5ID0gZ2V0VGFyZ2V0cyhwcm94eSk7XHJcblxyXG4gICAgaWYoIXByb3h5KXtcclxuICAgICAgICB0YXJnZXQgPSBnZXRUYXJnZXRzKHRhcmdldCk7XHJcbiAgICAgICAgLy8gaGFuZGxlcyBtdWx0aXBsZSB0YXJnZXRzXHJcbiAgICAgICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgICAgICB2YXIgbXVsdGlSZW1vdmVDYWxsYmFja3MgPSBbXTtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIG11bHRpUmVtb3ZlQ2FsbGJhY2tzLnB1c2gob24oZXZlbnRzLCB0YXJnZXRbaV0sIGNhbGxiYWNrLCBwcm94eSkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICAgICAgd2hpbGUobXVsdGlSZW1vdmVDYWxsYmFja3MubGVuZ3RoKXtcclxuICAgICAgICAgICAgICAgICAgICBtdWx0aVJlbW92ZUNhbGxiYWNrcy5wb3AoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaGFuZGxlcyBtdWx0aXBsZSBwcm94aWVzXHJcbiAgICAvLyBBbHJlYWR5IGhhbmRsZXMgbXVsdGlwbGUgcHJveGllcyBhbmQgdGFyZ2V0cyxcclxuICAgIC8vIGJlY2F1c2UgdGhlIHRhcmdldCBsb29wIGNhbGxzIHRoaXMgbG9vcC5cclxuICAgIGlmKGlzTGlzdChwcm94eSkpe1xyXG4gICAgICAgIHZhciBtdWx0aVJlbW92ZUNhbGxiYWNrcyA9IFtdO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJveHkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgbXVsdGlSZW1vdmVDYWxsYmFja3MucHVzaChvbihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5W2ldKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICB3aGlsZShtdWx0aVJlbW92ZUNhbGxiYWNrcy5sZW5ndGgpe1xyXG4gICAgICAgICAgICAgICAgbXVsdGlSZW1vdmVDYWxsYmFja3MucG9wKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByZW1vdmVDYWxsYmFja3MgPSBbXTtcclxuXHJcbiAgICBpZih0eXBlb2YgZXZlbnRzID09PSAnc3RyaW5nJyl7XHJcbiAgICAgICAgZXZlbnRzID0gZXZlbnRzLnNwbGl0KHNwYWNlKTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgZXZlbnRzLmxlbmd0aDsgaSsrKXtcclxuICAgICAgICB2YXIgZXZlbnRTZXR0aW5ncyA9IHt9O1xyXG4gICAgICAgIGlmKHByb3h5KXtcclxuICAgICAgICAgICAgaWYocHJveHkgPT09IHRydWUpe1xyXG4gICAgICAgICAgICAgICAgcHJveHkgPSBkb2MuZG9jdW1lbnQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZXZlbnRTZXR0aW5ncy50YXJnZXQgPSBwcm94eTtcclxuICAgICAgICAgICAgZXZlbnRTZXR0aW5ncy5jYWxsYmFjayA9IGZ1bmN0aW9uKGV2ZW50KXtcclxuICAgICAgICAgICAgICAgIHZhciBjbG9zZXN0VGFyZ2V0ID0gY2xvc2VzdChldmVudC50YXJnZXQsIHRhcmdldCk7XHJcbiAgICAgICAgICAgICAgICBpZihjbG9zZXN0VGFyZ2V0KXtcclxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhldmVudCwgY2xvc2VzdFRhcmdldCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGV2ZW50U2V0dGluZ3MudGFyZ2V0ID0gdGFyZ2V0O1xyXG4gICAgICAgICAgICBldmVudFNldHRpbmdzLmNhbGxiYWNrID0gY2FsbGJhY2s7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBldmVudFNldHRpbmdzLmV2ZW50ID0gZXZlbnRzW2ldO1xyXG5cclxuICAgICAgICBhZGRFdmVudChldmVudFNldHRpbmdzKTtcclxuXHJcbiAgICAgICAgcmVtb3ZlQ2FsbGJhY2tzLnB1c2goZXZlbnRTZXR0aW5ncyk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZ1bmN0aW9uKCl7XHJcbiAgICAgICAgd2hpbGUocmVtb3ZlQ2FsbGJhY2tzLmxlbmd0aCl7XHJcbiAgICAgICAgICAgIHZhciByZW1vdmVDYWxsYmFjayA9IHJlbW92ZUNhbGxiYWNrcy5wb3AoKTtcclxuICAgICAgICAgICAgZ2V0VGFyZ2V0KHJlbW92ZUNhbGxiYWNrLnRhcmdldCkucmVtb3ZlRXZlbnRMaXN0ZW5lcihyZW1vdmVDYWxsYmFjay5ldmVudCwgcmVtb3ZlQ2FsbGJhY2suY2FsbGJhY2spO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLm9mZlxyXG5cclxuICAgIHJlbW92ZXMgZXZlbnRzIGFzc2lnbmVkIHRvIGEgdGFyZ2V0LlxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQvcHJveHkpLm9mZihldmVudHMsIHRhcmdldFtvcHRpb25hbF0sIGNhbGxiYWNrKTtcclxuXHJcbiAgICBub3RlOiBpZiBhIHRhcmdldCBpcyBwYXNzZWQgdG8gdGhlIC5vbiBmdW5jdGlvbiwgZG9jJ3MgdGFyZ2V0IHdpbGwgYmUgdXNlZCBhcyB0aGUgcHJveHkuXHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLm9mZihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIG9mZihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5KXtcclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhcmdldC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBvZmYoZXZlbnRzLCB0YXJnZXRbaV0sIGNhbGxiYWNrLCBwcm94eSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgfVxyXG4gICAgaWYocHJveHkgaW5zdGFuY2VvZiBBcnJheSl7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcm94eS5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBvZmYoZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCBwcm94eVtpXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKHR5cGVvZiBldmVudHMgPT09ICdzdHJpbmcnKXtcclxuICAgICAgICBldmVudHMgPSBldmVudHMuc3BsaXQoc3BhY2UpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJyl7XHJcbiAgICAgICAgcHJveHkgPSBjYWxsYmFjaztcclxuICAgICAgICBjYWxsYmFjayA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcHJveHkgPSBwcm94eSA/IGdldFRhcmdldChwcm94eSkgOiBkb2MuZG9jdW1lbnQ7XHJcblxyXG4gICAgdmFyIHRhcmdldHMgPSB0eXBlb2YgdGFyZ2V0ID09PSAnc3RyaW5nJyA/IGZpbmQodGFyZ2V0LCBwcm94eSkgOiBbdGFyZ2V0XTtcclxuXHJcbiAgICBmb3IodmFyIHRhcmdldEluZGV4ID0gMDsgdGFyZ2V0SW5kZXggPCB0YXJnZXRzLmxlbmd0aDsgdGFyZ2V0SW5kZXgrKyl7XHJcbiAgICAgICAgdmFyIGN1cnJlbnRUYXJnZXQgPSB0YXJnZXRzW3RhcmdldEluZGV4XTtcclxuXHJcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGV2ZW50cy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgICAgICAgIGN1cnJlbnRUYXJnZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudHNbaV0sIGNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcztcclxufVxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLmFwcGVuZFxyXG5cclxuICAgIGFkZHMgZWxlbWVudHMgdG8gYSB0YXJnZXRcclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5hcHBlbmQoY2hpbGRyZW4pO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5hcHBlbmQodGFyZ2V0LCBjaGlsZHJlbik7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBjaGlsZHJlbil7XHJcbiAgICB2YXIgdGFyZ2V0ID0gZ2V0VGFyZ2V0KHRhcmdldCksXHJcbiAgICAgICAgY2hpbGRyZW4gPSBnZXRUYXJnZXQoY2hpbGRyZW4pO1xyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB0YXJnZXQgPSB0YXJnZXRbMF07XHJcbiAgICB9XHJcblxyXG4gICAgaWYoaXNMaXN0KGNoaWxkcmVuKSl7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZHJlbi5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICBhcHBlbmQodGFyZ2V0LCBjaGlsZHJlbltpXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0YXJnZXQuYXBwZW5kQ2hpbGQoY2hpbGRyZW4pO1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAucHJlcGVuZFxyXG5cclxuICAgIGFkZHMgZWxlbWVudHMgdG8gdGhlIGZyb250IG9mIGEgdGFyZ2V0XHJcblxyXG4gICAgICAgIC8vZmx1ZW50XHJcbiAgICAgICAgZG9jKHRhcmdldCkucHJlcGVuZChjaGlsZHJlbik7XHJcblxyXG4gICAgICAgIC8vbGVnYWN5XHJcbiAgICAgICAgZG9jLnByZXBlbmQodGFyZ2V0LCBjaGlsZHJlbik7XHJcbiovXHJcblxyXG5mdW5jdGlvbiBwcmVwZW5kKHRhcmdldCwgY2hpbGRyZW4pe1xyXG4gICAgdmFyIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpLFxyXG4gICAgICAgIGNoaWxkcmVuID0gZ2V0VGFyZ2V0KGNoaWxkcmVuKTtcclxuXHJcbiAgICBpZihpc0xpc3QodGFyZ2V0KSl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0WzBdO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKGlzTGlzdChjaGlsZHJlbikpe1xyXG4gICAgICAgIC8vcmV2ZXJzZWQgYmVjYXVzZSBvdGhlcndpc2UgdGhlIHdvdWxkIGdldCBwdXQgaW4gaW4gdGhlIHdyb25nIG9yZGVyLlxyXG4gICAgICAgIGZvciAodmFyIGkgPSBjaGlsZHJlbi5sZW5ndGggLTE7IGk7IGktLSkge1xyXG4gICAgICAgICAgICBwcmVwZW5kKHRhcmdldCwgY2hpbGRyZW5baV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGFyZ2V0Lmluc2VydEJlZm9yZShjaGlsZHJlbiwgdGFyZ2V0LmZpcnN0Q2hpbGQpO1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAuaXNWaXNpYmxlXHJcblxyXG4gICAgY2hlY2tzIGlmIGFuIGVsZW1lbnQgb3IgYW55IG9mIGl0cyBwYXJlbnRzIGRpc3BsYXkgcHJvcGVydGllcyBhcmUgc2V0IHRvICdub25lJ1xyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYyh0YXJnZXQpLmlzVmlzaWJsZSgpO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5pc1Zpc2libGUodGFyZ2V0KTtcclxuKi9cclxuXHJcbmZ1bmN0aW9uIGlzVmlzaWJsZSh0YXJnZXQpe1xyXG4gICAgdmFyIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpO1xyXG4gICAgaWYoIXRhcmdldCl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYoaXNMaXN0KHRhcmdldCkpe1xyXG4gICAgICAgIHZhciBpID0gLTE7XHJcblxyXG4gICAgICAgIHdoaWxlICh0YXJnZXRbaSsrXSAmJiBpc1Zpc2libGUodGFyZ2V0W2ldKSkge31cclxuICAgICAgICByZXR1cm4gdGFyZ2V0Lmxlbmd0aCA+PSBpO1xyXG4gICAgfVxyXG4gICAgd2hpbGUodGFyZ2V0LnBhcmVudE5vZGUgJiYgdGFyZ2V0LnN0eWxlLmRpc3BsYXkgIT09ICdub25lJyl7XHJcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0LnBhcmVudE5vZGU7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRhcmdldCA9PT0gZG9jLmRvY3VtZW50O1xyXG59XHJcblxyXG4vKipcclxuXHJcbiAgICAjIyAuaW5kZXhPZkVsZW1lbnRcclxuXHJcbiAgICByZXR1cm5zIHRoZSBpbmRleCBvZiB0aGUgZWxlbWVudCB3aXRoaW4gaXQncyBwYXJlbnQgZWxlbWVudC5cclxuXHJcbiAgICAgICAgLy9mbHVlbnRcclxuICAgICAgICBkb2ModGFyZ2V0KS5pbmRleE9mRWxlbWVudCgpO1xyXG5cclxuICAgICAgICAvL2xlZ2FjeVxyXG4gICAgICAgIGRvYy5pbmRleE9mRWxlbWVudCh0YXJnZXQpO1xyXG5cclxuKi9cclxuXHJcbmZ1bmN0aW9uIGluZGV4T2ZFbGVtZW50KHRhcmdldCkge1xyXG4gICAgdGFyZ2V0ID0gZ2V0VGFyZ2V0cyh0YXJnZXQpO1xyXG4gICAgaWYoIXRhcmdldCl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKGlzTGlzdCh0YXJnZXQpKXtcclxuICAgICAgICB0YXJnZXQgPSB0YXJnZXRbMF07XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGkgPSAtMTtcclxuXHJcbiAgICB2YXIgcGFyZW50ID0gdGFyZ2V0LnBhcmVudEVsZW1lbnQ7XHJcblxyXG4gICAgaWYoIXBhcmVudCl7XHJcbiAgICAgICAgcmV0dXJuIGk7XHJcbiAgICB9XHJcblxyXG4gICAgd2hpbGUocGFyZW50LmNoaWxkcmVuWysraV0gIT09IHRhcmdldCl7fVxyXG5cclxuICAgIHJldHVybiBpO1xyXG59XHJcblxyXG5cclxuLyoqXHJcblxyXG4gICAgIyMgLnJlYWR5XHJcblxyXG4gICAgY2FsbCBhIGNhbGxiYWNrIHdoZW4gdGhlIGRvY3VtZW50IGlzIHJlYWR5LlxyXG5cclxuICAgIHJldHVybnMgLTEgaWYgdGhlcmUgaXMgbm8gcGFyZW50RWxlbWVudCBvbiB0aGUgdGFyZ2V0LlxyXG5cclxuICAgICAgICAvL2ZsdWVudFxyXG4gICAgICAgIGRvYygpLnJlYWR5KGNhbGxiYWNrKTtcclxuXHJcbiAgICAgICAgLy9sZWdhY3lcclxuICAgICAgICBkb2MucmVhZHkoY2FsbGJhY2spO1xyXG4qL1xyXG5cclxuZnVuY3Rpb24gcmVhZHkoY2FsbGJhY2spe1xyXG4gICAgaWYoZG9jLmRvY3VtZW50ICYmIGRvYy5kb2N1bWVudC5yZWFkeVN0YXRlID09PSAnY29tcGxldGUnKXtcclxuICAgICAgICBjYWxsYmFjaygpO1xyXG4gICAgfWVsc2UgaWYod2luZG93LmF0dGFjaEV2ZW50KXtcclxuICAgICAgICBkb2N1bWVudC5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLCBjYWxsYmFjayk7XHJcbiAgICAgICAgd2luZG93LmF0dGFjaEV2ZW50KFwib25Mb2FkXCIsY2FsbGJhY2spO1xyXG4gICAgfWVsc2UgaWYoZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcil7XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixjYWxsYmFjayxmYWxzZSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmRvYy5maW5kID0gZmluZDtcclxuZG9jLmZpbmRPbmUgPSBmaW5kT25lO1xyXG5kb2MuY2xvc2VzdCA9IGNsb3Nlc3Q7XHJcbmRvYy5pcyA9IGlzO1xyXG5kb2MuYWRkQ2xhc3MgPSBhZGRDbGFzcztcclxuZG9jLnJlbW92ZUNsYXNzID0gcmVtb3ZlQ2xhc3M7XHJcbmRvYy5vZmYgPSBvZmY7XHJcbmRvYy5vbiA9IG9uO1xyXG5kb2MuYXBwZW5kID0gYXBwZW5kO1xyXG5kb2MucHJlcGVuZCA9IHByZXBlbmQ7XHJcbmRvYy5pc1Zpc2libGUgPSBpc1Zpc2libGU7XHJcbmRvYy5yZWFkeSA9IHJlYWR5O1xyXG5kb2MuaW5kZXhPZkVsZW1lbnQgPSBpbmRleE9mRWxlbWVudDtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZG9jOyIsInZhciBkb2MgPSByZXF1aXJlKCcuL2RvYycpLFxyXG4gICAgaXNMaXN0ID0gcmVxdWlyZSgnLi9pc0xpc3QnKSxcclxuICAgIGdldFRhcmdldHMgPSByZXF1aXJlKCcuL2dldFRhcmdldHMnKShkb2MuZG9jdW1lbnQpLFxyXG4gICAgZmxvY1Byb3RvID0gW107XHJcblxyXG5mdW5jdGlvbiBGbG9jKGl0ZW1zKXtcclxuICAgIHRoaXMucHVzaC5hcHBseSh0aGlzLCBpdGVtcyk7XHJcbn1cclxuRmxvYy5wcm90b3R5cGUgPSBmbG9jUHJvdG87XHJcbmZsb2NQcm90by5jb25zdHJ1Y3RvciA9IEZsb2M7XHJcblxyXG5mdW5jdGlvbiBmbG9jKHRhcmdldCl7XHJcbiAgICB2YXIgaW5zdGFuY2UgPSBnZXRUYXJnZXRzKHRhcmdldCk7XHJcblxyXG4gICAgaWYoIWlzTGlzdChpbnN0YW5jZSkpe1xyXG4gICAgICAgIGlmKGluc3RhbmNlKXtcclxuICAgICAgICAgICAgaW5zdGFuY2UgPSBbaW5zdGFuY2VdO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IFtdO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBuZXcgRmxvYyhpbnN0YW5jZSk7XHJcbn1cclxuXHJcbnZhciByZXR1cm5zU2VsZiA9ICdhZGRDbGFzcyByZW1vdmVDbGFzcyBhcHBlbmQgcHJlcGVuZCcuc3BsaXQoJyAnKTtcclxuXHJcbmZvcih2YXIga2V5IGluIGRvYyl7XHJcbiAgICBpZih0eXBlb2YgZG9jW2tleV0gPT09ICdmdW5jdGlvbicpe1xyXG4gICAgICAgIGZsb2Nba2V5XSA9IGRvY1trZXldO1xyXG4gICAgICAgIGZsb2NQcm90b1trZXldID0gKGZ1bmN0aW9uKGtleSl7XHJcbiAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XHJcbiAgICAgICAgICAgIC8vIFRoaXMgaXMgYWxzbyBleHRyZW1lbHkgZG9kZ3kgYW5kIGZhc3RcclxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKGEsYixjLGQsZSxmKXtcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBkb2Nba2V5XSh0aGlzLCBhLGIsYyxkLGUsZik7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYocmVzdWx0ICE9PSBkb2MgJiYgaXNMaXN0KHJlc3VsdCkpe1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmbG9jKHJlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZihyZXR1cm5zU2VsZi5pbmRleE9mKGtleSkgPj0wKXtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0oa2V5KSk7XHJcbiAgICB9XHJcbn1cclxuZmxvY1Byb3RvLm9uID0gZnVuY3Rpb24oZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrKXtcclxuICAgIHZhciBwcm94eSA9IHRoaXM7XHJcbiAgICBpZih0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKXtcclxuICAgICAgICBjYWxsYmFjayA9IHRhcmdldDtcclxuICAgICAgICB0YXJnZXQgPSB0aGlzO1xyXG4gICAgICAgIHByb3h5ID0gbnVsbDtcclxuICAgIH1cclxuICAgIGRvYy5vbihldmVudHMsIHRhcmdldCwgY2FsbGJhY2ssIHByb3h5KTtcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuZmxvY1Byb3RvLm9mZiA9IGZ1bmN0aW9uKGV2ZW50cywgdGFyZ2V0LCBjYWxsYmFjayl7XHJcbiAgICB2YXIgcmVmZXJlbmNlID0gdGhpcztcclxuICAgIGlmKHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicpe1xyXG4gICAgICAgIGNhbGxiYWNrID0gdGFyZ2V0O1xyXG4gICAgICAgIHRhcmdldCA9IHRoaXM7XHJcbiAgICAgICAgcmVmZXJlbmNlID0gbnVsbDtcclxuICAgIH1cclxuICAgIGRvYy5vZmYoZXZlbnRzLCB0YXJnZXQsIGNhbGxiYWNrLCByZWZlcmVuY2UpO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5mbG9jUHJvdG8ucmVhZHkgPSBmdW5jdGlvbihjYWxsYmFjayl7XHJcbiAgICBkb2MucmVhZHkoY2FsbGJhY2spO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5mbG9jUHJvdG8uYWRkQ2xhc3MgPSBmdW5jdGlvbihjbGFzc05hbWUpe1xyXG4gICAgZG9jLmFkZENsYXNzKHRoaXMsIGNsYXNzTmFtZSk7XHJcbiAgICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbmZsb2NQcm90by5yZW1vdmVDbGFzcyA9IGZ1bmN0aW9uKGNsYXNzTmFtZSl7XHJcbiAgICBkb2MucmVtb3ZlQ2xhc3ModGhpcywgY2xhc3NOYW1lKTtcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmbG9jOyIsInZhciBzaW5nbGVJZCA9IC9eI1xcdyskLztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihkb2N1bWVudCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldFRhcmdldCh0YXJnZXQpe1xuICAgICAgICBpZih0eXBlb2YgdGFyZ2V0ID09PSAnc3RyaW5nJyl7XG4gICAgICAgICAgICBpZihzaW5nbGVJZC5leGVjKHRhcmdldCkpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCh0YXJnZXQuc2xpY2UoMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IodGFyZ2V0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0YXJnZXQ7XG4gICAgfTtcbn07IiwiXG52YXIgc2luZ2xlQ2xhc3MgPSAvXlxcLlxcdyskLyxcbiAgICBzaW5nbGVJZCA9IC9eI1xcdyskLyxcbiAgICBzaW5nbGVUYWcgPSAvXlxcdyskLztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihkb2N1bWVudCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGdldFRhcmdldHModGFyZ2V0KXtcbiAgICAgICAgaWYodHlwZW9mIHRhcmdldCA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgaWYoc2luZ2xlSWQuZXhlYyh0YXJnZXQpKXtcbiAgICAgICAgICAgICAgICAvLyBJZiB5b3UgaGF2ZSBtb3JlIHRoYW4gMSBvZiB0aGUgc2FtZSBpZCBpbiB5b3VyIHBhZ2UsXG4gICAgICAgICAgICAgICAgLy8gdGhhdHMgeW91ciBvd24gc3R1cGlkIGZhdWx0LlxuICAgICAgICAgICAgICAgIHJldHVybiBbZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQodGFyZ2V0LnNsaWNlKDEpKV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihzaW5nbGVUYWcuZXhlYyh0YXJnZXQpKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUodGFyZ2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHNpbmdsZUNsYXNzLmV4ZWModGFyZ2V0KSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRvY3VtZW50LmdldEVsZW1lbnRzQnlDbGFzc05hbWUodGFyZ2V0LnNsaWNlKDEpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKHRhcmdldCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGFyZ2V0O1xuICAgIH07XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNMaXN0KG9iamVjdCl7XHJcbiAgICByZXR1cm4gb2JqZWN0ICE9IG51bGwgJiYgdHlwZW9mIG9iamVjdCA9PT0gJ29iamVjdCcgJiYgJ2xlbmd0aCcgaW4gb2JqZWN0ICYmICEoJ25vZGVUeXBlJyBpbiBvYmplY3QpICYmIG9iamVjdC5zZWxmICE9IG9iamVjdDsgLy8gaW4gSUU4LCB3aW5kb3cuc2VsZiBpcyB3aW5kb3csIGJ1dCBpdCBpcyBub3QgPT09IHdpbmRvdywgYnV0IGl0IGlzID09IHdpbmRvdy4uLi4uLi4uLiBXVEYhP1xyXG59IiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBTZXQgPSByZXF1aXJlKCdlczYtc2V0JyksXG4gICAgV2Vha01hcCA9IHJlcXVpcmUoJ2VzNi13ZWFrLW1hcCcpO1xuXG5mdW5jdGlvbiB0b0FycmF5KGl0ZW1zKXtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoaXRlbXMpO1xufVxuXG5mdW5jdGlvbiBsYXN0S2V5KHBhdGgpe1xuICAgIHBhdGgrPScnO1xuICAgIHZhciBtYXRjaCA9IHBhdGgubWF0Y2goLyg/Oi4qXFwuKT8oW14uXSopJC8pO1xuICAgIHJldHVybiBtYXRjaCAmJiBtYXRjaFsxXTtcbn1cblxudmFyIGRvdFJlZ2V4ID0gL1xcLi9pO1xuXG5mdW5jdGlvbiBtYXRjaERlZXAocGF0aCl7XG4gICAgcmV0dXJuIChwYXRoICsgJycpLm1hdGNoKGRvdFJlZ2V4KTtcbn1cblxuZnVuY3Rpb24gaXNEZWVwKHBhdGgpe1xuICAgIHJldHVybiB+KHBhdGggKyAnJykuaW5kZXhPZignLicpO1xufVxuXG52YXIgYXR0YWNoZWRFbnRpZXMgPSBuZXcgU2V0KCksXG4gICAgdHJhY2tlZE9iamVjdHMgPSBuZXcgV2Vha01hcCgpO1xuXG5mdW5jdGlvbiBsZWZ0QW5kUmVzdChwYXRoKXtcbiAgICB2YXIgbWF0Y2ggPSBtYXRjaERlZXAocGF0aCk7XG4gICAgaWYobWF0Y2gpe1xuICAgICAgICByZXR1cm4gW3BhdGguc2xpY2UoMCwgbWF0Y2guaW5kZXgpLCBwYXRoLnNsaWNlKG1hdGNoLmluZGV4KzEpXTtcbiAgICB9XG4gICAgcmV0dXJuIHBhdGg7XG59XG5cbmZ1bmN0aW9uIGlzV2lsZGNhcmRLZXkoa2V5KXtcbiAgICByZXR1cm4ga2V5LmNoYXJBdCgwKSA9PT0gJyonO1xufVxuXG5mdW5jdGlvbiBpc0ZlcmFsY2FyZEtleShrZXkpe1xuICAgIHJldHVybiBrZXkgPT09ICcqKic7XG59XG5cbmZ1bmN0aW9uIGFkZEhhbmRsZXIob2JqZWN0LCBrZXksIGhhbmRsZXIpe1xuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYodHJhY2tlZEtleXMgPT0gbnVsbCl7XG4gICAgICAgIHRyYWNrZWRLZXlzID0ge307XG4gICAgICAgIHRyYWNrZWRPYmplY3RzLnNldChvYmplY3QsIHRyYWNrZWRLZXlzKTtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlcnMgPSB0cmFja2VkS2V5c1trZXldO1xuXG4gICAgaWYoIWhhbmRsZXJzKXtcbiAgICAgICAgaGFuZGxlcnMgPSBuZXcgU2V0KCk7XG4gICAgICAgIHRyYWNrZWRLZXlzW2tleV0gPSBoYW5kbGVycztcbiAgICB9XG5cbiAgICBoYW5kbGVycy5hZGQoaGFuZGxlcik7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUhhbmRsZXIob2JqZWN0LCBrZXksIGhhbmRsZXIpe1xuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYodHJhY2tlZEtleXMgPT0gbnVsbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlcnMgPSB0cmFja2VkS2V5c1trZXldO1xuXG4gICAgaWYoIWhhbmRsZXJzKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGhhbmRsZXJzLmRlbGV0ZShoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tPYmplY3RzKGVudGksIGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgb2JqZWN0LCBrZXksIHBhdGgpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50S2V5ID0ga2V5ID09PSAnKionID8gJyonIDoga2V5LFxuICAgICAgICB0YXJnZXQgPSBvYmplY3Rba2V5XSxcbiAgICAgICAgdGFyZ2V0SXNPYmplY3QgPSB0YXJnZXQgJiYgdHlwZW9mIHRhcmdldCA9PT0gJ29iamVjdCc7XG5cbiAgICBpZih0YXJnZXRJc09iamVjdCAmJiB3ZWFrTWFwLmhhcyh0YXJnZXQpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGUgPSBmdW5jdGlvbih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpe1xuICAgICAgICBpZihlbnRpLl90cmFja2VkT2JqZWN0c1tldmVudE5hbWVdICE9PSB3ZWFrTWFwKXtcbiAgICAgICAgICAgIGlmKHRhcmdldElzT2JqZWN0KXtcbiAgICAgICAgICAgICAgICB3ZWFrTWFwLmRlbGV0ZSh0YXJnZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVtb3ZlSGFuZGxlcihvYmplY3QsIGV2ZW50S2V5LCBoYW5kbGUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXZlbnRLZXkgIT09ICcqJyAmJiB0eXBlb2Ygb2JqZWN0W2V2ZW50S2V5XSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0W2V2ZW50S2V5XSAhPT0gdGFyZ2V0KXtcbiAgICAgICAgICAgIGlmKHRhcmdldElzT2JqZWN0KXtcbiAgICAgICAgICAgICAgICB3ZWFrTWFwLmRlbGV0ZSh0YXJnZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVtb3ZlSGFuZGxlcihvYmplY3QsIGV2ZW50S2V5LCBoYW5kbGUpO1xuICAgICAgICAgICAgdHJhY2tPYmplY3RzKGVudGksIGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgb2JqZWN0LCBrZXksIHBhdGgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXZlbnRLZXkgPT09ICcqJyl7XG4gICAgICAgICAgICB0cmFja0tleXMob2JqZWN0LCBrZXksIHBhdGgpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIXdlYWtNYXAuaGFzKG9iamVjdCkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaGFuZGxlcih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRyYWNrS2V5cyh0YXJnZXQsIHJvb3QsIHJlc3Qpe1xuICAgICAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHRhcmdldCk7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGlzRmVyYWxjYXJkS2V5KHJvb3QpKXtcbiAgICAgICAgICAgICAgICB0cmFja09iamVjdHMoZW50aSwgZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCB0YXJnZXQsIGtleXNbaV0sICcqKicgKyAocmVzdCA/ICcuJyA6ICcnKSArIChyZXN0IHx8ICcnKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0cmFja09iamVjdHMoZW50aSwgZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCB0YXJnZXQsIGtleXNbaV0sIHJlc3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkSGFuZGxlcihvYmplY3QsIGV2ZW50S2V5LCBoYW5kbGUpO1xuXG4gICAgaWYoIXRhcmdldElzT2JqZWN0KXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFRoaXMgd291bGQgb2J2aW91c2x5IGJlIGJldHRlciBpbXBsZW1lbnRlZCB3aXRoIGEgV2Vha1NldCxcbiAgICAvLyBCdXQgSSdtIHRyeWluZyB0byBrZWVwIGZpbGVzaXplIGRvd24sIGFuZCBJIGRvbid0IHJlYWxseSB3YW50IGFub3RoZXJcbiAgICAvLyBwb2x5ZmlsbCB3aGVuIFdlYWtNYXAgd29ya3Mgd2VsbCBlbm91Z2ggZm9yIHRoZSB0YXNrLlxuICAgIHdlYWtNYXAuc2V0KHRhcmdldCwgbnVsbCk7XG5cbiAgICBpZighcGF0aCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcm9vdEFuZFJlc3QgPSBsZWZ0QW5kUmVzdChwYXRoKSxcbiAgICAgICAgcm9vdCxcbiAgICAgICAgcmVzdDtcblxuICAgIGlmKCFBcnJheS5pc0FycmF5KHJvb3RBbmRSZXN0KSl7XG4gICAgICAgIHJvb3QgPSByb290QW5kUmVzdDtcbiAgICB9ZWxzZXtcbiAgICAgICAgcm9vdCA9IHJvb3RBbmRSZXN0WzBdO1xuICAgICAgICByZXN0ID0gcm9vdEFuZFJlc3RbMV07XG4gICAgfVxuXG4gICAgaWYodGFyZ2V0SXNPYmplY3QgJiYgaXNXaWxkY2FyZEtleShyb290KSl7XG4gICAgICAgIHRyYWNrS2V5cyh0YXJnZXQsIHJvb3QsIHJlc3QpO1xuICAgIH1cblxuICAgIHRyYWNrT2JqZWN0cyhlbnRpLCBldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIHRhcmdldCwgcm9vdCwgcmVzdCk7XG59XG5cbmZ1bmN0aW9uIHRyYWNrUGF0aChlbnRpLCBldmVudE5hbWUpe1xuICAgIHZhciBlbnRpVHJhY2tlZE9iamVjdHMgPSBlbnRpLl90cmFja2VkT2JqZWN0c1tldmVudE5hbWVdO1xuXG4gICAgaWYoIWVudGlUcmFja2VkT2JqZWN0cyl7XG4gICAgICAgIGVudGlUcmFja2VkT2JqZWN0cyA9IG5ldyBXZWFrTWFwKCk7XG4gICAgICAgIGVudGkuX3RyYWNrZWRPYmplY3RzW2V2ZW50TmFtZV0gPSBlbnRpVHJhY2tlZE9iamVjdHM7XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpe1xuICAgICAgICBpZihlbnRpLl9lbWl0dGVkRXZlbnRzW2V2ZW50TmFtZV0gPT09IGVtaXRLZXkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGVudGkuX2VtaXR0ZWRFdmVudHNbZXZlbnROYW1lXSA9IGVtaXRLZXk7XG4gICAgICAgIGVudGkuZW1pdChldmVudE5hbWUsIHZhbHVlLCBldmVudCk7XG4gICAgfVxuXG4gICAgdHJhY2tPYmplY3RzKGVudGksIGV2ZW50TmFtZSwgZW50aVRyYWNrZWRPYmplY3RzLCBoYW5kbGVyLCBlbnRpLCAnX21vZGVsJywgZXZlbnROYW1lKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tQYXRocyhlbnRpLCB0YXJnZXQpe1xuICAgIGlmKCFlbnRpLl9ldmVudHMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yKHZhciBrZXkgaW4gZW50aS5fZXZlbnRzKXtcbiAgICAgICAgLy8gQmFpbG91dCBpZiB0aGUgZXZlbnQgaXMgYSBzaW5nbGUga2V5LFxuICAgICAgICAvLyBhbmQgdGhlIHRhcmdldCBpc250IHRoZSBzYW1lIGFzIHRoZSBlbnRpcyBfbW9kZWxcbiAgICAgICAgaWYoZW50aS5fbW9kZWwgIT09IHRhcmdldCAmJiAhaXNEZWVwKGtleSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICB0cmFja1BhdGgoZW50aSwga2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGVtaXRFdmVudChvYmplY3QsIGtleSwgdmFsdWUsIGVtaXRLZXkpe1xuXG4gICAgYXR0YWNoZWRFbnRpZXMuZm9yRWFjaChmdW5jdGlvbihlbnRpKXtcbiAgICAgICAgdHJhY2tQYXRocyhlbnRpLCBvYmplY3QpO1xuICAgIH0pO1xuXG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZighdHJhY2tlZEtleXMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50ID0ge1xuICAgICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICAgIGtleToga2V5LFxuICAgICAgICBvYmplY3Q6IG9iamVjdFxuICAgIH07XG5cbiAgICBpZih0cmFja2VkS2V5c1trZXldKXtcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XS5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZXIpe1xuICAgICAgICAgICAgaWYodHJhY2tlZEtleXNba2V5XS5oYXMoaGFuZGxlcikpe1xuICAgICAgICAgICAgICAgIGhhbmRsZXIodmFsdWUsIGV2ZW50LCBlbWl0S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZEtleXNbJyonXSl7XG4gICAgICAgIHRyYWNrZWRLZXlzWycqJ10uZm9yRWFjaChmdW5jdGlvbihoYW5kbGVyKXtcbiAgICAgICAgICAgIGlmKHRyYWNrZWRLZXlzWycqJ10uaGFzKGhhbmRsZXIpKXtcbiAgICAgICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW1pdChldmVudHMpe1xuICAgIHZhciBlbWl0S2V5ID0ge307XG4gICAgZXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBlbWl0RXZlbnQoZXZlbnRbMF0sIGV2ZW50WzFdLCBldmVudFsyXSwgZW1pdEtleSk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIEVudGkobW9kZWwpe1xuICAgIHZhciBkZXRhY2hlZCA9IG1vZGVsID09PSBmYWxzZTtcblxuICAgIGlmKCFtb2RlbCB8fCAodHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kZWwgIT09ICdmdW5jdGlvbicpKXtcbiAgICAgICAgbW9kZWwgPSB7fTtcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja2VkT2JqZWN0cyA9IHt9O1xuICAgIHRoaXMuX2VtaXR0ZWRFdmVudHMgPSB7fTtcbiAgICBpZihkZXRhY2hlZCl7XG4gICAgICAgIHRoaXMuX21vZGVsID0ge307XG4gICAgfWVsc2V7XG4gICAgICAgIHRoaXMuYXR0YWNoKG1vZGVsKTtcbiAgICB9XG59XG5FbnRpLmdldCA9IGZ1bmN0aW9uKG1vZGVsLCBrZXkpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKGtleSA9PT0gJy4nKXtcbiAgICAgICAgcmV0dXJuIG1vZGVsO1xuICAgIH1cblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkuZ2V0KG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxba2V5XTtcbn07XG5FbnRpLnNldCA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHZhbHVlKXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgIHJldHVybiBFbnRpLnNldChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xuICAgIH1cblxuICAgIHZhciBvcmlnaW5hbCA9IG1vZGVsW2tleV07XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnICYmIHZhbHVlID09PSBvcmlnaW5hbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIga2V5c0NoYW5nZWQgPSAhKGtleSBpbiBtb2RlbCk7XG5cbiAgICBtb2RlbFtrZXldID0gdmFsdWU7XG5cbiAgICB2YXIgZXZlbnRzID0gW1ttb2RlbCwga2V5LCB2YWx1ZV1dO1xuXG4gICAgaWYoa2V5c0NoYW5nZWQpe1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KG1vZGVsKSl7XG4gICAgICAgICAgICBldmVudHMucHVzaChbbW9kZWwsICdsZW5ndGgnLCBtb2RlbC5sZW5ndGhdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLnB1c2ggPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldDtcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgMyl7XG4gICAgICAgIHZhbHVlID0ga2V5O1xuICAgICAgICBrZXkgPSAnLic7XG4gICAgICAgIHRhcmdldCA9IG1vZGVsO1xuICAgIH1lbHNle1xuICAgICAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICAgICAgcmV0dXJuIEVudGkucHVzaChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcbiAgICB9XG5cbiAgICBpZighQXJyYXkuaXNBcnJheSh0YXJnZXQpKXtcbiAgICAgICAgdGhyb3cgJ1RoZSB0YXJnZXQgaXMgbm90IGFuIGFycmF5Lic7XG4gICAgfVxuXG4gICAgdGFyZ2V0LnB1c2godmFsdWUpO1xuXG4gICAgdmFyIGV2ZW50cyA9IFtcbiAgICAgICAgW3RhcmdldCwgdGFyZ2V0Lmxlbmd0aC0xLCB2YWx1ZV0sXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxuICAgIF07XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5pbnNlcnQgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSwgaW5kZXgpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuXG4gICAgdmFyIHRhcmdldDtcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgNCl7XG4gICAgICAgIGluZGV4ID0gdmFsdWU7XG4gICAgICAgIHZhbHVlID0ga2V5O1xuICAgICAgICBrZXkgPSAnLic7XG4gICAgICAgIHRhcmdldCA9IG1vZGVsO1xuICAgIH1lbHNle1xuICAgICAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICAgICAgcmV0dXJuIEVudGkuaW5zZXJ0KG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCB2YWx1ZSwgaW5kZXgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcbiAgICB9XG5cbiAgICBpZighQXJyYXkuaXNBcnJheSh0YXJnZXQpKXtcbiAgICAgICAgdGhyb3cgJ1RoZSB0YXJnZXQgaXMgbm90IGFuIGFycmF5Lic7XG4gICAgfVxuXG4gICAgdGFyZ2V0LnNwbGljZShpbmRleCwgMCwgdmFsdWUpO1xuXG4gICAgdmFyIGV2ZW50cyA9IFtcbiAgICAgICAgW3RhcmdldCwgaW5kZXgsIHZhbHVlXSxcbiAgICAgICAgW3RhcmdldCwgJ2xlbmd0aCcsIHRhcmdldC5sZW5ndGhdXG4gICAgXTtcblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLnJlbW92ZSA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHN1YktleSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5yZW1vdmUobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHN1YktleSk7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIGEga2V5IG9mZiBvZiBhbiBvYmplY3QgYXQgJ2tleSdcbiAgICBpZihzdWJLZXkgIT0gbnVsbCl7XG4gICAgICAgIEVudGkucmVtb3ZlKG1vZGVsW2tleV0sIHN1YktleSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihrZXkgPT09ICcuJyl7XG4gICAgICAgIHRocm93ICcuIChzZWxmKSBpcyBub3QgYSB2YWxpZCBrZXkgdG8gcmVtb3ZlJztcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRzID0gW107XG5cbiAgICBpZihBcnJheS5pc0FycmF5KG1vZGVsKSl7XG4gICAgICAgIG1vZGVsLnNwbGljZShrZXksIDEpO1xuICAgICAgICBldmVudHMucHVzaChbbW9kZWwsICdsZW5ndGgnLCBtb2RlbC5sZW5ndGhdKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgZGVsZXRlIG1vZGVsW2tleV07XG4gICAgICAgIGV2ZW50cy5wdXNoKFttb2RlbCwga2V5XSk7XG4gICAgfVxuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkubW92ZSA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIGluZGV4KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgIHJldHVybiBFbnRpLm1vdmUobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIGluZGV4KTtcbiAgICB9XG5cbiAgICB2YXIgbW9kZWwgPSBtb2RlbDtcblxuICAgIGlmKGtleSA9PT0gaW5kZXgpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkobW9kZWwpKXtcbiAgICAgICAgdGhyb3cgJ1RoZSBtb2RlbCBpcyBub3QgYW4gYXJyYXkuJztcbiAgICB9XG5cbiAgICB2YXIgaXRlbSA9IG1vZGVsW2tleV07XG5cbiAgICBtb2RlbC5zcGxpY2Uoa2V5LCAxKTtcblxuICAgIG1vZGVsLnNwbGljZShpbmRleCAtIChpbmRleCA+IGtleSA/IDAgOiAxKSwgMCwgaXRlbSk7XG5cbiAgICBlbWl0KFttb2RlbCwgaW5kZXgsIGl0ZW1dKTtcbn07XG5FbnRpLnVwZGF0ZSA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHZhbHVlKXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0LFxuICAgICAgICBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG5cbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgMyl7XG4gICAgICAgIHZhbHVlID0ga2V5O1xuICAgICAgICBrZXkgPSAnLic7XG4gICAgICAgIHRhcmdldCA9IG1vZGVsO1xuICAgIH1lbHNle1xuICAgICAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICAgICAgcmV0dXJuIEVudGkudXBkYXRlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCB2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0YXJnZXQgPSBtb2RlbFtrZXldO1xuXG4gICAgICAgIGlmKHRhcmdldCA9PSBudWxsKXtcbiAgICAgICAgICAgIG1vZGVsW2tleV0gPSBpc0FycmF5ID8gW10gOiB7fTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnVGhlIHZhbHVlIGlzIG5vdCBhbiBvYmplY3QuJztcbiAgICB9XG5cbiAgICBpZih0eXBlb2YgdGFyZ2V0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBvYmplY3QuJztcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRzID0gW107XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVUYXJnZXQodGFyZ2V0LCB2YWx1ZSl7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgICAgIGlmKHRhcmdldFtrZXldICYmIHR5cGVvZiB0YXJnZXRba2V5XSA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIHVwZGF0ZVRhcmdldCh0YXJnZXRba2V5XSwgdmFsdWVba2V5XSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0YXJnZXRba2V5XSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCBrZXksIHZhbHVlW2tleV1dKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlVGFyZ2V0KHRhcmdldCwgdmFsdWUpO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShFdmVudEVtaXR0ZXIucHJvdG90eXBlKTtcbkVudGkucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gRW50aTtcbkVudGkucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKG1vZGVsKXtcbiAgICBpZih0aGlzLl9tb2RlbCAhPT0gbW9kZWwpe1xuICAgICAgICB0aGlzLmRldGFjaCgpO1xuICAgIH1cblxuICAgIGlmKCFhdHRhY2hlZEVudGllcy5oYXModGhpcykpe1xuICAgICAgICBhdHRhY2hlZEVudGllcy5hZGQodGhpcyk7XG4gICAgfVxuICAgIHRoaXMuX2F0dGFjaGVkID0gdHJ1ZTtcbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsO1xufTtcbkVudGkucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCl7XG4gICAgaWYoYXR0YWNoZWRFbnRpZXMuaGFzKHRoaXMpKXtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuZGVsZXRlKHRoaXMpO1xuICAgIH1cblxuICAgIHRoaXMuX3RyYWNrZWRPYmplY3RzID0ge307XG4gICAgdGhpcy5fZW1pdHRlZEV2ZW50cyA9IHt9O1xuICAgIHRoaXMuX21vZGVsID0ge307XG4gICAgdGhpcy5fYXR0YWNoZWQgPSBmYWxzZTtcbn07XG5FbnRpLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKXtcbiAgICB0aGlzLmRldGFjaCgpO1xuICAgIHRoaXMuX2V2ZW50cyA9IG51bGw7XG59XG5FbnRpLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xuICAgIHJldHVybiBFbnRpLmdldCh0aGlzLl9tb2RlbCwga2V5KTtcbn07XG5cbkVudGkucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHJldHVybiBFbnRpLnNldCh0aGlzLl9tb2RlbCwga2V5LCB2YWx1ZSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgcmV0dXJuIEVudGkucHVzaC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUsIGluZGV4KXtcbiAgICByZXR1cm4gRW50aS5pbnNlcnQuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihrZXksIHN1YktleSl7XG4gICAgcmV0dXJuIEVudGkucmVtb3ZlLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUubW92ZSA9IGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLm1vdmUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihrZXksIGluZGV4KXtcbiAgICByZXR1cm4gRW50aS51cGRhdGUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuRW50aS5wcm90b3R5cGUuaXNBdHRhY2hlZCA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaGVkO1xufTtcbkVudGkucHJvdG90eXBlLmF0dGFjaGVkQ291bnQgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiBhdHRhY2hlZEVudGllcy5zaXplO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBFbnRpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gU2V0IDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHNldCwgaXRlcmF0b3IsIHJlc3VsdDtcblx0aWYgKHR5cGVvZiBTZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c2V0ID0gbmV3IFNldChbJ3JheicsICdkd2EnLCAndHJ6eSddKTtcblx0aWYgKHNldC5zaXplICE9PSAzKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmFkZCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5jbGVhciAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5kZWxldGUgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuZW50cmllcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5mb3JFYWNoICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmhhcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5rZXlzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LnZhbHVlcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG5cdGl0ZXJhdG9yID0gc2V0LnZhbHVlcygpO1xuXHRyZXN1bHQgPSBpdGVyYXRvci5uZXh0KCk7XG5cdGlmIChyZXN1bHQuZG9uZSAhPT0gZmFsc2UpIHJldHVybiBmYWxzZTtcblx0aWYgKHJlc3VsdC52YWx1ZSAhPT0gJ3JheicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIHRydWU7XG59O1xuIiwiLy8gRXhwb3J0cyB0cnVlIGlmIGVudmlyb25tZW50IHByb3ZpZGVzIG5hdGl2ZSBgU2V0YCBpbXBsZW1lbnRhdGlvbixcbi8vIHdoYXRldmVyIHRoYXQgaXMuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIFNldCA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoU2V0LnByb3RvdHlwZSkgPT09ICdbb2JqZWN0IFNldF0nKTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNvbnRhaW5zICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG4gICwgZCAgICAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvcicpXG4gICwgdG9TdHJpbmdUYWdTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykudG9TdHJpbmdUYWdcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgU2V0SXRlcmF0b3I7XG5cblNldEl0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc2V0LCBraW5kKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBTZXRJdGVyYXRvcikpIHJldHVybiBuZXcgU2V0SXRlcmF0b3Ioc2V0LCBraW5kKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBzZXQuX19zZXREYXRhX18sIHNldCk7XG5cdGlmICgha2luZCkga2luZCA9ICd2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleSt2YWx1ZScpKSBraW5kID0gJ2tleSt2YWx1ZSc7XG5cdGVsc2Uga2luZCA9ICd2YWx1ZSc7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2tpbmRfXycsIGQoJycsIGtpbmQpKTtcbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFNldEl0ZXJhdG9yLCBJdGVyYXRvcik7XG5cblNldEl0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFNldEl0ZXJhdG9yKSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ3ZhbHVlJykgcmV0dXJuIHRoaXMuX19saXN0X19baV07XG5cdFx0cmV0dXJuIFt0aGlzLl9fbGlzdF9fW2ldLCB0aGlzLl9fbGlzdF9fW2ldXTtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFNldCBJdGVyYXRvcl0nOyB9KVxufSk7XG5kZWZpbmVQcm9wZXJ0eShTZXRJdGVyYXRvci5wcm90b3R5cGUsIHRvU3RyaW5nVGFnU3ltYm9sLFxuXHRkKCdjJywgJ1NldCBJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNvcHkgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9jb3B5JylcbiAgLCBtYXAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvbWFwJylcbiAgLCBjYWxsYWJsZSAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbGlkVmFsdWUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG5cbiAgLCBiaW5kID0gRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZGVmaW5lO1xuXG5kZWZpbmUgPSBmdW5jdGlvbiAobmFtZSwgZGVzYywgYmluZFRvKSB7XG5cdHZhciB2YWx1ZSA9IHZhbGlkVmFsdWUoZGVzYykgJiYgY2FsbGFibGUoZGVzYy52YWx1ZSksIGRncztcblx0ZGdzID0gY29weShkZXNjKTtcblx0ZGVsZXRlIGRncy53cml0YWJsZTtcblx0ZGVsZXRlIGRncy52YWx1ZTtcblx0ZGdzLmdldCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKSkgcmV0dXJuIHZhbHVlO1xuXHRcdGRlc2MudmFsdWUgPSBiaW5kLmNhbGwodmFsdWUsIChiaW5kVG8gPT0gbnVsbCkgPyB0aGlzIDogdGhpc1tiaW5kVG9dKTtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCBuYW1lLCBkZXNjKTtcblx0XHRyZXR1cm4gdGhpc1tuYW1lXTtcblx0fTtcblx0cmV0dXJuIGRncztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHByb3BzLyosIGJpbmRUbyovKSB7XG5cdHZhciBiaW5kVG8gPSBhcmd1bWVudHNbMV07XG5cdHJldHVybiBtYXAocHJvcHMsIGZ1bmN0aW9uIChkZXNjLCBuYW1lKSB7XG5cdFx0cmV0dXJuIGRlZmluZShuYW1lLCBkZXNjLCBiaW5kVG8pO1xuXHR9KTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc3NpZ24gICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvYXNzaWduJylcbiAgLCBub3JtYWxpemVPcHRzID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvbm9ybWFsaXplLW9wdGlvbnMnKVxuICAsIGlzQ2FsbGFibGUgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9pcy1jYWxsYWJsZScpXG4gICwgY29udGFpbnMgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuXG4gICwgZDtcblxuZCA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRzY3IsIHZhbHVlLyosIG9wdGlvbnMqLykge1xuXHR2YXIgYywgZSwgdywgb3B0aW9ucywgZGVzYztcblx0aWYgKChhcmd1bWVudHMubGVuZ3RoIDwgMikgfHwgKHR5cGVvZiBkc2NyICE9PSAnc3RyaW5nJykpIHtcblx0XHRvcHRpb25zID0gdmFsdWU7XG5cdFx0dmFsdWUgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbMl07XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB3ID0gdHJ1ZTtcblx0XHRlID0gZmFsc2U7XG5cdH0gZWxzZSB7XG5cdFx0YyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2MnKTtcblx0XHRlID0gY29udGFpbnMuY2FsbChkc2NyLCAnZScpO1xuXHRcdHcgPSBjb250YWlucy5jYWxsKGRzY3IsICd3Jyk7XG5cdH1cblxuXHRkZXNjID0geyB2YWx1ZTogdmFsdWUsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSwgd3JpdGFibGU6IHcgfTtcblx0cmV0dXJuICFvcHRpb25zID8gZGVzYyA6IGFzc2lnbihub3JtYWxpemVPcHRzKG9wdGlvbnMpLCBkZXNjKTtcbn07XG5cbmQuZ3MgPSBmdW5jdGlvbiAoZHNjciwgZ2V0LCBzZXQvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCBvcHRpb25zLCBkZXNjO1xuXHRpZiAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSBnZXQ7XG5cdFx0Z2V0ID0gZHNjcjtcblx0XHRkc2NyID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRvcHRpb25zID0gYXJndW1lbnRzWzNdO1xuXHR9XG5cdGlmIChnZXQgPT0gbnVsbCkge1xuXHRcdGdldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShnZXQpKSB7XG5cdFx0b3B0aW9ucyA9IGdldDtcblx0XHRnZXQgPSBzZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoc2V0ID09IG51bGwpIHtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoIWlzQ2FsbGFibGUoc2V0KSkge1xuXHRcdG9wdGlvbnMgPSBzZXQ7XG5cdFx0c2V0ID0gdW5kZWZpbmVkO1xuXHR9XG5cdGlmIChkc2NyID09IG51bGwpIHtcblx0XHRjID0gdHJ1ZTtcblx0XHRlID0gZmFsc2U7XG5cdH0gZWxzZSB7XG5cdFx0YyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2MnKTtcblx0XHRlID0gY29udGFpbnMuY2FsbChkc2NyLCAnZScpO1xuXHR9XG5cblx0ZGVzYyA9IHsgZ2V0OiBnZXQsIHNldDogc2V0LCBjb25maWd1cmFibGU6IGMsIGVudW1lcmFibGU6IGUgfTtcblx0cmV0dXJuICFvcHRpb25zID8gZGVzYyA6IGFzc2lnbihub3JtYWxpemVPcHRzKG9wdGlvbnMpLCBkZXNjKTtcbn07XG4iLCIvLyBJbnNwaXJlZCBieSBHb29nbGUgQ2xvc3VyZTpcbi8vIGh0dHA6Ly9jbG9zdXJlLWxpYnJhcnkuZ29vZ2xlY29kZS5jb20vc3ZuL2RvY3MvXG4vLyBjbG9zdXJlX2dvb2dfYXJyYXlfYXJyYXkuanMuaHRtbCNnb29nLmFycmF5LmNsZWFyXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHZhbHVlID0gcmVxdWlyZSgnLi4vLi4vb2JqZWN0L3ZhbGlkLXZhbHVlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YWx1ZSh0aGlzKS5sZW5ndGggPSAwO1xuXHRyZXR1cm4gdGhpcztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b1Bvc0ludCA9IHJlcXVpcmUoJy4uLy4uL251bWJlci90by1wb3MtaW50ZWdlcicpXG4gICwgdmFsdWUgICAgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKVxuXG4gICwgaW5kZXhPZiA9IEFycmF5LnByb3RvdHlwZS5pbmRleE9mXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgYWJzID0gTWF0aC5hYnMsIGZsb29yID0gTWF0aC5mbG9vcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc2VhcmNoRWxlbWVudC8qLCBmcm9tSW5kZXgqLykge1xuXHR2YXIgaSwgbCwgZnJvbUluZGV4LCB2YWw7XG5cdGlmIChzZWFyY2hFbGVtZW50ID09PSBzZWFyY2hFbGVtZW50KSB7IC8vanNsaW50OiBpZ25vcmVcblx0XHRyZXR1cm4gaW5kZXhPZi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuXHR9XG5cblx0bCA9IHRvUG9zSW50KHZhbHVlKHRoaXMpLmxlbmd0aCk7XG5cdGZyb21JbmRleCA9IGFyZ3VtZW50c1sxXTtcblx0aWYgKGlzTmFOKGZyb21JbmRleCkpIGZyb21JbmRleCA9IDA7XG5cdGVsc2UgaWYgKGZyb21JbmRleCA+PSAwKSBmcm9tSW5kZXggPSBmbG9vcihmcm9tSW5kZXgpO1xuXHRlbHNlIGZyb21JbmRleCA9IHRvUG9zSW50KHRoaXMubGVuZ3RoKSAtIGZsb29yKGFicyhmcm9tSW5kZXgpKTtcblxuXHRmb3IgKGkgPSBmcm9tSW5kZXg7IGkgPCBsOyArK2kpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBpKSkge1xuXHRcdFx0dmFsID0gdGhpc1tpXTtcblx0XHRcdGlmICh2YWwgIT09IHZhbCkgcmV0dXJuIGk7IC8vanNsaW50OiBpZ25vcmVcblx0XHR9XG5cdH1cblx0cmV0dXJuIC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE1hdGguc2lnblxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHNpZ24gPSBNYXRoLnNpZ247XG5cdGlmICh0eXBlb2Ygc2lnbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKChzaWduKDEwKSA9PT0gMSkgJiYgKHNpZ24oLTIwKSA9PT0gLTEpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdHZhbHVlID0gTnVtYmVyKHZhbHVlKTtcblx0aWYgKGlzTmFOKHZhbHVlKSB8fCAodmFsdWUgPT09IDApKSByZXR1cm4gdmFsdWU7XG5cdHJldHVybiAodmFsdWUgPiAwKSA/IDEgOiAtMTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzaWduID0gcmVxdWlyZSgnLi4vbWF0aC9zaWduJylcblxuICAsIGFicyA9IE1hdGguYWJzLCBmbG9vciA9IE1hdGguZmxvb3I7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmIChpc05hTih2YWx1ZSkpIHJldHVybiAwO1xuXHR2YWx1ZSA9IE51bWJlcih2YWx1ZSk7XG5cdGlmICgodmFsdWUgPT09IDApIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcblx0cmV0dXJuIHNpZ24odmFsdWUpICogZmxvb3IoYWJzKHZhbHVlKSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9JbnRlZ2VyID0gcmVxdWlyZSgnLi90by1pbnRlZ2VyJylcblxuICAsIG1heCA9IE1hdGgubWF4O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkgeyByZXR1cm4gbWF4KDAsIHRvSW50ZWdlcih2YWx1ZSkpOyB9O1xuIiwiLy8gSW50ZXJuYWwgbWV0aG9kLCB1c2VkIGJ5IGl0ZXJhdGlvbiBmdW5jdGlvbnMuXG4vLyBDYWxscyBhIGZ1bmN0aW9uIGZvciBlYWNoIGtleS12YWx1ZSBwYWlyIGZvdW5kIGluIG9iamVjdFxuLy8gT3B0aW9uYWxseSB0YWtlcyBjb21wYXJlRm4gdG8gaXRlcmF0ZSBvYmplY3QgaW4gc3BlY2lmaWMgb3JkZXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNDYWxsYWJsZSA9IHJlcXVpcmUoJy4vaXMtY2FsbGFibGUnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICAgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGtleXMgPSBPYmplY3Qua2V5c1xuICAsIHByb3BlcnR5SXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCBkZWZWYWwpIHtcblx0cmV0dXJuIGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcsIGNvbXBhcmVGbiovKSB7XG5cdFx0dmFyIGxpc3QsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIGNvbXBhcmVGbiA9IGFyZ3VtZW50c1szXTtcblx0XHRvYmogPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdFx0Y2FsbGFibGUoY2IpO1xuXG5cdFx0bGlzdCA9IGtleXMob2JqKTtcblx0XHRpZiAoY29tcGFyZUZuKSB7XG5cdFx0XHRsaXN0LnNvcnQoaXNDYWxsYWJsZShjb21wYXJlRm4pID8gY29tcGFyZUZuLmJpbmQob2JqKSA6IHVuZGVmaW5lZCk7XG5cdFx0fVxuXHRcdHJldHVybiBsaXN0W21ldGhvZF0oZnVuY3Rpb24gKGtleSwgaW5kZXgpIHtcblx0XHRcdGlmICghcHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmosIGtleSkpIHJldHVybiBkZWZWYWw7XG5cdFx0XHRyZXR1cm4gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCBvYmpba2V5XSwga2V5LCBvYmosIGluZGV4KTtcblx0XHR9KTtcblx0fTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3QuYXNzaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgYXNzaWduID0gT2JqZWN0LmFzc2lnbiwgb2JqO1xuXHRpZiAodHlwZW9mIGFzc2lnbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRvYmogPSB7IGZvbzogJ3JheicgfTtcblx0YXNzaWduKG9iaiwgeyBiYXI6ICdkd2EnIH0sIHsgdHJ6eTogJ3RyenknIH0pO1xuXHRyZXR1cm4gKG9iai5mb28gKyBvYmouYmFyICsgb2JqLnRyenkpID09PSAncmF6ZHdhdHJ6eSc7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyAgPSByZXF1aXJlKCcuLi9rZXlzJylcbiAgLCB2YWx1ZSA9IHJlcXVpcmUoJy4uL3ZhbGlkLXZhbHVlJylcblxuICAsIG1heCA9IE1hdGgubWF4O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkZXN0LCBzcmMvKiwg4oCmc3JjbiovKSB7XG5cdHZhciBlcnJvciwgaSwgbCA9IG1heChhcmd1bWVudHMubGVuZ3RoLCAyKSwgYXNzaWduO1xuXHRkZXN0ID0gT2JqZWN0KHZhbHVlKGRlc3QpKTtcblx0YXNzaWduID0gZnVuY3Rpb24gKGtleSkge1xuXHRcdHRyeSB7IGRlc3Rba2V5XSA9IHNyY1trZXldOyB9IGNhdGNoIChlKSB7XG5cdFx0XHRpZiAoIWVycm9yKSBlcnJvciA9IGU7XG5cdFx0fVxuXHR9O1xuXHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSB7XG5cdFx0c3JjID0gYXJndW1lbnRzW2ldO1xuXHRcdGtleXMoc3JjKS5mb3JFYWNoKGFzc2lnbik7XG5cdH1cblx0aWYgKGVycm9yICE9PSB1bmRlZmluZWQpIHRocm93IGVycm9yO1xuXHRyZXR1cm4gZGVzdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc3NpZ24gPSByZXF1aXJlKCcuL2Fzc2lnbicpXG4gICwgdmFsdWUgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0dmFyIGNvcHkgPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdGlmIChjb3B5ICE9PSBvYmopIHJldHVybiBjb3B5O1xuXHRyZXR1cm4gYXNzaWduKHt9LCBvYmopO1xufTtcbiIsIi8vIFdvcmthcm91bmQgZm9yIGh0dHA6Ly9jb2RlLmdvb2dsZS5jb20vcC92OC9pc3N1ZXMvZGV0YWlsP2lkPTI4MDRcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgc2hpbTtcblxuaWYgKCFyZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2YvaXMtaW1wbGVtZW50ZWQnKSgpKSB7XG5cdHNoaW0gPSByZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2Yvc2hpbScpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBudWxsT2JqZWN0LCBwcm9wcywgZGVzYztcblx0aWYgKCFzaGltKSByZXR1cm4gY3JlYXRlO1xuXHRpZiAoc2hpbS5sZXZlbCAhPT0gMSkgcmV0dXJuIGNyZWF0ZTtcblxuXHRudWxsT2JqZWN0ID0ge307XG5cdHByb3BzID0ge307XG5cdGRlc2MgPSB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKE9iamVjdC5wcm90b3R5cGUpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcblx0XHRpZiAobmFtZSA9PT0gJ19fcHJvdG9fXycpIHtcblx0XHRcdHByb3BzW25hbWVdID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHRcdFx0dmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRwcm9wc1tuYW1lXSA9IGRlc2M7XG5cdH0pO1xuXHRPYmplY3QuZGVmaW5lUHJvcGVydGllcyhudWxsT2JqZWN0LCBwcm9wcyk7XG5cblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHNoaW0sICdudWxsUG9seWZpbGwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IG51bGxPYmplY3QgfSk7XG5cblx0cmV0dXJuIGZ1bmN0aW9uIChwcm90b3R5cGUsIHByb3BzKSB7XG5cdFx0cmV0dXJuIGNyZWF0ZSgocHJvdG90eXBlID09PSBudWxsKSA/IG51bGxPYmplY3QgOiBwcm90b3R5cGUsIHByb3BzKTtcblx0fTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9faXRlcmF0ZScpKCdmb3JFYWNoJyk7XG4iLCIvLyBEZXByZWNhdGVkXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7IHJldHVybiB0eXBlb2Ygb2JqID09PSAnZnVuY3Rpb24nOyB9O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgbWFwID0geyBmdW5jdGlvbjogdHJ1ZSwgb2JqZWN0OiB0cnVlIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICgoeCAhPSBudWxsKSAmJiBtYXBbdHlwZW9mIHhdKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Qua2V5c1xuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dHJ5IHtcblx0XHRPYmplY3Qua2V5cygncHJpbWl0aXZlJyk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyA9IE9iamVjdC5rZXlzO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmplY3QpIHtcblx0cmV0dXJuIGtleXMob2JqZWN0ID09IG51bGwgPyBvYmplY3QgOiBPYmplY3Qob2JqZWN0KSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBmb3JFYWNoICA9IHJlcXVpcmUoJy4vZm9yLWVhY2gnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbyA9IHt9LCB0aGlzQXJnID0gYXJndW1lbnRzWzJdO1xuXHRjYWxsYWJsZShjYik7XG5cdGZvckVhY2gob2JqLCBmdW5jdGlvbiAodmFsdWUsIGtleSwgb2JqLCBpbmRleCkge1xuXHRcdG9ba2V5XSA9IGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGtleSwgb2JqLCBpbmRleCk7XG5cdH0pO1xuXHRyZXR1cm4gbztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2gsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG5cbnZhciBwcm9jZXNzID0gZnVuY3Rpb24gKHNyYywgb2JqKSB7XG5cdHZhciBrZXk7XG5cdGZvciAoa2V5IGluIHNyYykgb2JqW2tleV0gPSBzcmNba2V5XTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMvKiwg4oCmb3B0aW9ucyovKSB7XG5cdHZhciByZXN1bHQgPSBjcmVhdGUobnVsbCk7XG5cdGZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uIChvcHRpb25zKSB7XG5cdFx0aWYgKG9wdGlvbnMgPT0gbnVsbCkgcmV0dXJuO1xuXHRcdHByb2Nlc3MoT2JqZWN0KG9wdGlvbnMpLCByZXN1bHQpO1xuXHR9KTtcblx0cmV0dXJuIHJlc3VsdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGdldFByb3RvdHlwZU9mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mXG4gICwgeCA9IHt9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgvKmN1c3RvbUNyZWF0ZSovKSB7XG5cdHZhciBzZXRQcm90b3R5cGVPZiA9IE9iamVjdC5zZXRQcm90b3R5cGVPZlxuXHQgICwgY3VzdG9tQ3JlYXRlID0gYXJndW1lbnRzWzBdIHx8IGNyZWF0ZTtcblx0aWYgKHR5cGVvZiBzZXRQcm90b3R5cGVPZiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gZ2V0UHJvdG90eXBlT2Yoc2V0UHJvdG90eXBlT2YoY3VzdG9tQ3JlYXRlKG51bGwpLCB4KSkgPT09IHg7XG59O1xuIiwiLy8gQmlnIHRoYW5rcyB0byBAV2ViUmVmbGVjdGlvbiBmb3Igc29ydGluZyB0aGlzIG91dFxuLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vV2ViUmVmbGVjdGlvbi81NTkzNTU0XG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGlzT2JqZWN0ICAgICAgPSByZXF1aXJlKCcuLi9pcy1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgPSByZXF1aXJlKCcuLi92YWxpZC12YWx1ZScpXG5cbiAgLCBpc1Byb3RvdHlwZU9mID0gT2JqZWN0LnByb3RvdHlwZS5pc1Byb3RvdHlwZU9mXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBudWxsRGVzYyA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0dmFsdWU6IHVuZGVmaW5lZCB9XG4gICwgdmFsaWRhdGU7XG5cbnZhbGlkYXRlID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdHZhbHVlKG9iaik7XG5cdGlmICgocHJvdG90eXBlID09PSBudWxsKSB8fCBpc09iamVjdChwcm90b3R5cGUpKSByZXR1cm4gb2JqO1xuXHR0aHJvdyBuZXcgVHlwZUVycm9yKCdQcm90b3R5cGUgbXVzdCBiZSBudWxsIG9yIGFuIG9iamVjdCcpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKHN0YXR1cykge1xuXHR2YXIgZm4sIHNldDtcblx0aWYgKCFzdGF0dXMpIHJldHVybiBudWxsO1xuXHRpZiAoc3RhdHVzLmxldmVsID09PSAyKSB7XG5cdFx0aWYgKHN0YXR1cy5zZXQpIHtcblx0XHRcdHNldCA9IHN0YXR1cy5zZXQ7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHRzZXQuY2FsbCh2YWxpZGF0ZShvYmosIHByb3RvdHlwZSksIHByb3RvdHlwZSk7XG5cdFx0XHRcdHJldHVybiBvYmo7XG5cdFx0XHR9O1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSkuX19wcm90b19fID0gcHJvdG90eXBlO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0Zm4gPSBmdW5jdGlvbiBzZWxmKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHR2YXIgaXNOdWxsQmFzZTtcblx0XHRcdHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKTtcblx0XHRcdGlzTnVsbEJhc2UgPSBpc1Byb3RvdHlwZU9mLmNhbGwoc2VsZi5udWxsUG9seWZpbGwsIG9iaik7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVsZXRlIHNlbGYubnVsbFBvbHlmaWxsLl9fcHJvdG9fXztcblx0XHRcdGlmIChwcm90b3R5cGUgPT09IG51bGwpIHByb3RvdHlwZSA9IHNlbGYubnVsbFBvbHlmaWxsO1xuXHRcdFx0b2JqLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdGlmIChpc051bGxCYXNlKSBkZWZpbmVQcm9wZXJ0eShzZWxmLm51bGxQb2x5ZmlsbCwgJ19fcHJvdG9fXycsIG51bGxEZXNjKTtcblx0XHRcdHJldHVybiBvYmo7XG5cdFx0fTtcblx0fVxuXHRyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGZuLCAnbGV2ZWwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IHN0YXR1cy5sZXZlbCB9KTtcbn0oKGZ1bmN0aW9uICgpIHtcblx0dmFyIHggPSBPYmplY3QuY3JlYXRlKG51bGwpLCB5ID0ge30sIHNldFxuXHQgICwgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoT2JqZWN0LnByb3RvdHlwZSwgJ19fcHJvdG9fXycpO1xuXG5cdGlmIChkZXNjKSB7XG5cdFx0dHJ5IHtcblx0XHRcdHNldCA9IGRlc2Muc2V0OyAvLyBPcGVyYSBjcmFzaGVzIGF0IHRoaXMgcG9pbnRcblx0XHRcdHNldC5jYWxsKHgsIHkpO1xuXHRcdH0gY2F0Y2ggKGlnbm9yZSkgeyB9XG5cdFx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgc2V0OiBzZXQsIGxldmVsOiAyIH07XG5cdH1cblxuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAyIH07XG5cblx0eCA9IHt9O1xuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAxIH07XG5cblx0cmV0dXJuIGZhbHNlO1xufSgpKSkpO1xuXG5yZXF1aXJlKCcuLi9jcmVhdGUnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZm4pIHtcblx0aWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IFR5cGVFcnJvcihmbiArIFwiIGlzIG5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRyZXR1cm4gZm47XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB1c2UgbnVsbCBvciB1bmRlZmluZWRcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBTdHJpbmcucHJvdG90eXBlLmNvbnRhaW5zXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzdHIgPSAncmF6ZHdhdHJ6eSc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIHN0ci5jb250YWlucyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKChzdHIuY29udGFpbnMoJ2R3YScpID09PSB0cnVlKSAmJiAoc3RyLmNvbnRhaW5zKCdmb28nKSA9PT0gZmFsc2UpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpbmRleE9mID0gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hTdHJpbmcvKiwgcG9zaXRpb24qLykge1xuXHRyZXR1cm4gaW5kZXhPZi5jYWxsKHRoaXMsIHNlYXJjaFN0cmluZywgYXJndW1lbnRzWzFdKSA+IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZ1xuXG4gICwgaWQgPSB0b1N0cmluZy5jYWxsKCcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKHR5cGVvZiB4ID09PSAnc3RyaW5nJykgfHwgKHggJiYgKHR5cGVvZiB4ID09PSAnb2JqZWN0JykgJiZcblx0XHQoKHggaW5zdGFuY2VvZiBTdHJpbmcpIHx8ICh0b1N0cmluZy5jYWxsKHgpID09PSBpZCkpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNvbnRhaW5zICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgQXJyYXlJdGVyYXRvcjtcblxuQXJyYXlJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFyciwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgQXJyYXlJdGVyYXRvcikpIHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihhcnIsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIGFycik7XG5cdGlmICgha2luZCkga2luZCA9ICd2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleSt2YWx1ZScpKSBraW5kID0gJ2tleSt2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleScpKSBraW5kID0gJ2tleSc7XG5cdGVsc2Uga2luZCA9ICd2YWx1ZSc7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2tpbmRfXycsIGQoJycsIGtpbmQpKTtcbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKEFycmF5SXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuQXJyYXlJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChBcnJheUl0ZXJhdG9yKSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ3ZhbHVlJykgcmV0dXJuIHRoaXMuX19saXN0X19baV07XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICdrZXkrdmFsdWUnKSByZXR1cm4gW2ksIHRoaXMuX19saXN0X19baV1dO1xuXHRcdHJldHVybiBpO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgQXJyYXkgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGdldCAgICAgID0gcmVxdWlyZSgnLi9nZXQnKVxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXksIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoaXRlcmFibGUsIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbW9kZSwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgcmVzdWx0LCBkb0JyZWFrLCBicm9rZW4sIGksIGwsIGNoYXIsIGNvZGU7XG5cdGlmIChpc0FycmF5KGl0ZXJhYmxlKSkgbW9kZSA9ICdhcnJheSc7XG5cdGVsc2UgaWYgKGlzU3RyaW5nKGl0ZXJhYmxlKSkgbW9kZSA9ICdzdHJpbmcnO1xuXHRlbHNlIGl0ZXJhYmxlID0gZ2V0KGl0ZXJhYmxlKTtcblxuXHRjYWxsYWJsZShjYik7XG5cdGRvQnJlYWsgPSBmdW5jdGlvbiAoKSB7IGJyb2tlbiA9IHRydWU7IH07XG5cdGlmIChtb2RlID09PSAnYXJyYXknKSB7XG5cdFx0aXRlcmFibGUuc29tZShmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgcmV0dXJuIHRydWU7XG5cdFx0fSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cdGlmIChtb2RlID09PSAnc3RyaW5nJykge1xuXHRcdGwgPSBpdGVyYWJsZS5sZW5ndGg7XG5cdFx0Zm9yIChpID0gMDsgaSA8IGw7ICsraSkge1xuXHRcdFx0Y2hhciA9IGl0ZXJhYmxlW2ldO1xuXHRcdFx0aWYgKChpICsgMSkgPCBsKSB7XG5cdFx0XHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0XHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIGNoYXIgKz0gaXRlcmFibGVbKytpXTtcblx0XHRcdH1cblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgY2hhciwgZG9CcmVhayk7XG5cdFx0XHRpZiAoYnJva2VuKSBicmVhaztcblx0XHR9XG5cdFx0cmV0dXJuO1xuXHR9XG5cdHJlc3VsdCA9IGl0ZXJhYmxlLm5leHQoKTtcblxuXHR3aGlsZSAoIXJlc3VsdC5kb25lKSB7XG5cdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCByZXN1bHQudmFsdWUsIGRvQnJlYWspO1xuXHRcdGlmIChicm9rZW4pIHJldHVybjtcblx0XHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cdH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N0cmluZyA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgQXJyYXlJdGVyYXRvciAgPSByZXF1aXJlKCcuL2FycmF5JylcbiAgLCBTdHJpbmdJdGVyYXRvciA9IHJlcXVpcmUoJy4vc3RyaW5nJylcbiAgLCBpdGVyYWJsZSAgICAgICA9IHJlcXVpcmUoJy4vdmFsaWQtaXRlcmFibGUnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0aWYgKHR5cGVvZiBpdGVyYWJsZShvYmopW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG9ialtpdGVyYXRvclN5bWJvbF0oKTtcblx0aWYgKGlzU3RyaW5nKG9iaikpIHJldHVybiBuZXcgU3RyaW5nSXRlcmF0b3Iob2JqKTtcblx0cmV0dXJuIG5ldyBBcnJheUl0ZXJhdG9yKG9iaik7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGFzc2lnbiAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvYXNzaWduJylcbiAgLCBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCBkICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGF1dG9CaW5kID0gcmVxdWlyZSgnZC9hdXRvLWJpbmQnKVxuICAsIFN5bWJvbCAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIEl0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEl0ZXJhdG9yID0gZnVuY3Rpb24gKGxpc3QsIGNvbnRleHQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBJdGVyYXRvcihsaXN0LCBjb250ZXh0KTtcblx0ZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG5cdFx0X19saXN0X186IGQoJ3cnLCB2YWx1ZShsaXN0KSksXG5cdFx0X19jb250ZXh0X186IGQoJ3cnLCBjb250ZXh0KSxcblx0XHRfX25leHRJbmRleF9fOiBkKCd3JywgMClcblx0fSk7XG5cdGlmICghY29udGV4dCkgcmV0dXJuO1xuXHRjYWxsYWJsZShjb250ZXh0Lm9uKTtcblx0Y29udGV4dC5vbignX2FkZCcsIHRoaXMuX29uQWRkKTtcblx0Y29udGV4dC5vbignX2RlbGV0ZScsIHRoaXMuX29uRGVsZXRlKTtcblx0Y29udGV4dC5vbignX2NsZWFyJywgdGhpcy5fb25DbGVhcik7XG59O1xuXG5kZWZpbmVQcm9wZXJ0aWVzKEl0ZXJhdG9yLnByb3RvdHlwZSwgYXNzaWduKHtcblx0Y29uc3RydWN0b3I6IGQoSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIHtcblx0XHRcdGkgPSB0aGlzLl9fcmVkb19fLnNoaWZ0KCk7XG5cdFx0XHRpZiAoaSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gaTtcblx0XHR9XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19saXN0X18ubGVuZ3RoKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRuZXh0OiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX2NyZWF0ZVJlc3VsdCh0aGlzLl9uZXh0KCkpOyB9KSxcblx0X2NyZWF0ZVJlc3VsdDogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmIChpID09PSB1bmRlZmluZWQpIHJldHVybiB7IGRvbmU6IHRydWUsIHZhbHVlOiB1bmRlZmluZWQgfTtcblx0XHRyZXR1cm4geyBkb25lOiBmYWxzZSwgdmFsdWU6IHRoaXMuX3Jlc29sdmUoaSkgfTtcblx0fSksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7IHJldHVybiB0aGlzLl9fbGlzdF9fW2ldOyB9KSxcblx0X3VuQmluZDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dGhpcy5fX2xpc3RfXyA9IG51bGw7XG5cdFx0ZGVsZXRlIHRoaXMuX19yZWRvX187XG5cdFx0aWYgKCF0aGlzLl9fY29udGV4dF9fKSByZXR1cm47XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xuXHRcdHRoaXMuX19jb250ZXh0X18gPSBudWxsO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgSXRlcmF0b3JdJzsgfSlcbn0sIGF1dG9CaW5kKHtcblx0X29uQWRkOiBkKGZ1bmN0aW9uIChpbmRleCkge1xuXHRcdGlmIChpbmRleCA+PSB0aGlzLl9fbmV4dEluZGV4X18pIHJldHVybjtcblx0XHQrK3RoaXMuX19uZXh0SW5kZXhfXztcblx0XHRpZiAoIXRoaXMuX19yZWRvX18pIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX3JlZG9fXycsIGQoJ2MnLCBbaW5kZXhdKSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuX19yZWRvX18uZm9yRWFjaChmdW5jdGlvbiAocmVkbywgaSkge1xuXHRcdFx0aWYgKHJlZG8gPj0gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSArK3JlZG87XG5cdFx0fSwgdGhpcyk7XG5cdFx0dGhpcy5fX3JlZG9fXy5wdXNoKGluZGV4KTtcblx0fSksXG5cdF9vbkRlbGV0ZTogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHR2YXIgaTtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0LS10aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSByZXR1cm47XG5cdFx0aSA9IHRoaXMuX19yZWRvX18uaW5kZXhPZihpbmRleCk7XG5cdFx0aWYgKGkgIT09IC0xKSB0aGlzLl9fcmVkb19fLnNwbGljZShpLCAxKTtcblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID4gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSAtLXJlZG87XG5cdFx0fSwgdGhpcyk7XG5cdH0pLFxuXHRfb25DbGVhcjogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIGNsZWFyLmNhbGwodGhpcy5fX3JlZG9fXyk7XG5cdFx0dGhpcy5fX25leHRJbmRleF9fID0gMDtcblx0fSlcbn0pKSk7XG5cbmRlZmluZVByb3BlcnR5KEl0ZXJhdG9yLnByb3RvdHlwZSwgU3ltYm9sLml0ZXJhdG9yLCBkKGZ1bmN0aW9uICgpIHtcblx0cmV0dXJuIHRoaXM7XG59KSk7XG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnJywgJ0l0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxzZTtcblx0aWYgKGlzQXJyYXkodmFsdWUpKSByZXR1cm4gdHJ1ZTtcblx0aWYgKGlzU3RyaW5nKHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdHJldHVybiAodHlwZW9mIHZhbHVlW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJyk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gU3ltYm9sIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHR5cGVvZiBTeW1ib2wgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c3ltYm9sID0gU3ltYm9sKCd0ZXN0IHN5bWJvbCcpO1xuXHR0cnkgeyBTdHJpbmcoc3ltYm9sKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgPT09ICdzeW1ib2wnKSByZXR1cm4gdHJ1ZTtcblxuXHQvLyBSZXR1cm4gJ3RydWUnIGZvciBwb2x5ZmlsbHNcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNDb25jYXRTcHJlYWRhYmxlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9QcmltaXRpdmUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvU3RyaW5nVGFnICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC51bnNjb3BhYmxlcyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICh4ICYmICgodHlwZW9mIHggPT09ICdzeW1ib2wnKSB8fCAoeFsnQEB0b1N0cmluZ1RhZyddID09PSAnU3ltYm9sJykpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIHZhbGlkYXRlU3ltYm9sID0gcmVxdWlyZSgnLi92YWxpZGF0ZS1zeW1ib2wnKVxuXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksIG9ialByb3RvdHlwZSA9IE9iamVjdC5wcm90b3R5cGVcbiAgLCBTeW1ib2wsIEhpZGRlblN5bWJvbCwgZ2xvYmFsU3ltYm9scyA9IGNyZWF0ZShudWxsKTtcblxudmFyIGdlbmVyYXRlTmFtZSA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBjcmVhdGVkID0gY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKGRlc2MpIHtcblx0XHR2YXIgcG9zdGZpeCA9IDAsIG5hbWU7XG5cdFx0d2hpbGUgKGNyZWF0ZWRbZGVzYyArIChwb3N0Zml4IHx8ICcnKV0pICsrcG9zdGZpeDtcblx0XHRkZXNjICs9IChwb3N0Zml4IHx8ICcnKTtcblx0XHRjcmVhdGVkW2Rlc2NdID0gdHJ1ZTtcblx0XHRuYW1lID0gJ0BAJyArIGRlc2M7XG5cdFx0ZGVmaW5lUHJvcGVydHkob2JqUHJvdG90eXBlLCBuYW1lLCBkLmdzKG51bGwsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgbmFtZSwgZCh2YWx1ZSkpO1xuXHRcdH0pKTtcblx0XHRyZXR1cm4gbmFtZTtcblx0fTtcbn0oKSk7XG5cbkhpZGRlblN5bWJvbCA9IGZ1bmN0aW9uIFN5bWJvbChkZXNjcmlwdGlvbikge1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIEhpZGRlblN5bWJvbCkgdGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0cmV0dXJuIFN5bWJvbChkZXNjcmlwdGlvbik7XG59O1xubW9kdWxlLmV4cG9ydHMgPSBTeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBTeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHN5bWJvbCA9IGNyZWF0ZShIaWRkZW5TeW1ib2wucHJvdG90eXBlKTtcblx0ZGVzY3JpcHRpb24gPSAoZGVzY3JpcHRpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKGRlc2NyaXB0aW9uKSk7XG5cdHJldHVybiBkZWZpbmVQcm9wZXJ0aWVzKHN5bWJvbCwge1xuXHRcdF9fZGVzY3JpcHRpb25fXzogZCgnJywgZGVzY3JpcHRpb24pLFxuXHRcdF9fbmFtZV9fOiBkKCcnLCBnZW5lcmF0ZU5hbWUoZGVzY3JpcHRpb24pKVxuXHR9KTtcbn07XG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbCwge1xuXHRmb3I6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChnbG9iYWxTeW1ib2xzW2tleV0pIHJldHVybiBnbG9iYWxTeW1ib2xzW2tleV07XG5cdFx0cmV0dXJuIChnbG9iYWxTeW1ib2xzW2tleV0gPSBTeW1ib2woU3RyaW5nKGtleSkpKTtcblx0fSksXG5cdGtleUZvcjogZChmdW5jdGlvbiAocykge1xuXHRcdHZhciBrZXk7XG5cdFx0dmFsaWRhdGVTeW1ib2wocyk7XG5cdFx0Zm9yIChrZXkgaW4gZ2xvYmFsU3ltYm9scykgaWYgKGdsb2JhbFN5bWJvbHNba2V5XSA9PT0gcykgcmV0dXJuIGtleTtcblx0fSksXG5cdGhhc0luc3RhbmNlOiBkKCcnLCBTeW1ib2woJ2hhc0luc3RhbmNlJykpLFxuXHRpc0NvbmNhdFNwcmVhZGFibGU6IGQoJycsIFN5bWJvbCgnaXNDb25jYXRTcHJlYWRhYmxlJykpLFxuXHRpdGVyYXRvcjogZCgnJywgU3ltYm9sKCdpdGVyYXRvcicpKSxcblx0bWF0Y2g6IGQoJycsIFN5bWJvbCgnbWF0Y2gnKSksXG5cdHJlcGxhY2U6IGQoJycsIFN5bWJvbCgncmVwbGFjZScpKSxcblx0c2VhcmNoOiBkKCcnLCBTeW1ib2woJ3NlYXJjaCcpKSxcblx0c3BlY2llczogZCgnJywgU3ltYm9sKCdzcGVjaWVzJykpLFxuXHRzcGxpdDogZCgnJywgU3ltYm9sKCdzcGxpdCcpKSxcblx0dG9QcmltaXRpdmU6IGQoJycsIFN5bWJvbCgndG9QcmltaXRpdmUnKSksXG5cdHRvU3RyaW5nVGFnOiBkKCcnLCBTeW1ib2woJ3RvU3RyaW5nVGFnJykpLFxuXHR1bnNjb3BhYmxlczogZCgnJywgU3ltYm9sKCd1bnNjb3BhYmxlcycpKVxufSk7XG5kZWZpbmVQcm9wZXJ0aWVzKEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3ltYm9sKSxcblx0dG9TdHJpbmc6IGQoJycsIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19uYW1lX187IH0pXG59KTtcblxuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wucHJvdG90eXBlLCB7XG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdTeW1ib2wgKCcgKyB2YWxpZGF0ZVN5bWJvbCh0aGlzKS5fX2Rlc2NyaXB0aW9uX18gKyAnKSc7IH0pLFxuXHR2YWx1ZU9mOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KVxufSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsIGQoJycsXG5cdGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU3ltYm9sJykpO1xuXG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1ByaW1pdGl2ZV0pKTtcbmRlZmluZVByb3BlcnR5KEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZyxcblx0ZCgnYycsIFN5bWJvbC5wcm90b3R5cGVbU3ltYm9sLnRvU3RyaW5nVGFnXSkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTeW1ib2wgPSByZXF1aXJlKCcuL2lzLXN5bWJvbCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzU3ltYm9sKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBhIHN5bWJvbFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIi8vIFRoYW5rcyBAbWF0aGlhc2J5bmVuc1xuLy8gaHR0cDovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC11bmljb2RlI2l0ZXJhdGluZy1vdmVyLXN5bWJvbHNcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi8nKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTdHJpbmdJdGVyYXRvcjtcblxuU3RyaW5nSXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzdHIpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFN0cmluZ0l0ZXJhdG9yKSkgcmV0dXJuIG5ldyBTdHJpbmdJdGVyYXRvcihzdHIpO1xuXHRzdHIgPSBTdHJpbmcoc3RyKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBzdHIpO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19sZW5ndGhfXycsIGQoJycsIHN0ci5sZW5ndGgpKTtcblxufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU3RyaW5nSXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuU3RyaW5nSXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3RyaW5nSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19sZW5ndGhfXykgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHR2YXIgY2hhciA9IHRoaXMuX19saXN0X19baV0sIGNvZGU7XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA9PT0gdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gY2hhcjtcblx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIHJldHVybiBjaGFyICsgdGhpcy5fX2xpc3RfX1t0aGlzLl9fbmV4dEluZGV4X18rK107XG5cdFx0cmV0dXJuIGNoYXI7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBTdHJpbmcgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNJdGVyYWJsZSA9IHJlcXVpcmUoJy4vaXMtaXRlcmFibGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc0l0ZXJhYmxlKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBpdGVyYWJsZVwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0eXBlb2YgU3ltYm9sICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHN5bWJvbCA9IFN5bWJvbCgndGVzdCBzeW1ib2wnKTtcblx0dHJ5IHsgU3RyaW5nKHN5bWJvbCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSAnc3ltYm9sJykgcmV0dXJuIHRydWU7XG5cblx0Ly8gUmV0dXJuICd0cnVlJyBmb3IgcG9seWZpbGxzXG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzQ29uY2F0U3ByZWFkYWJsZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNSZWdFeHAgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1ByaW1pdGl2ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9TdHJpbmdUYWcgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnVuc2NvcGFibGVzICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgPSByZXF1aXJlKCdkJylcblxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGdlbmVyYXRlTmFtZSwgU3ltYm9sO1xuXG5nZW5lcmF0ZU5hbWUgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgY3JlYXRlZCA9IGNyZWF0ZShudWxsKTtcblx0cmV0dXJuIGZ1bmN0aW9uIChkZXNjKSB7XG5cdFx0dmFyIHBvc3RmaXggPSAwO1xuXHRcdHdoaWxlIChjcmVhdGVkW2Rlc2MgKyAocG9zdGZpeCB8fCAnJyldKSArK3Bvc3RmaXg7XG5cdFx0ZGVzYyArPSAocG9zdGZpeCB8fCAnJyk7XG5cdFx0Y3JlYXRlZFtkZXNjXSA9IHRydWU7XG5cdFx0cmV0dXJuICdAQCcgKyBkZXNjO1xuXHR9O1xufSgpKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW1ib2wgPSBmdW5jdGlvbiAoZGVzY3JpcHRpb24pIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBTeW1ib2wpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHR9XG5cdHN5bWJvbCA9IGNyZWF0ZShTeW1ib2wucHJvdG90eXBlKTtcblx0ZGVzY3JpcHRpb24gPSAoZGVzY3JpcHRpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKGRlc2NyaXB0aW9uKSk7XG5cdHJldHVybiBkZWZpbmVQcm9wZXJ0aWVzKHN5bWJvbCwge1xuXHRcdF9fZGVzY3JpcHRpb25fXzogZCgnJywgZGVzY3JpcHRpb24pLFxuXHRcdF9fbmFtZV9fOiBkKCcnLCBnZW5lcmF0ZU5hbWUoZGVzY3JpcHRpb24pKVxuXHR9KTtcbn07XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbCwge1xuXHRjcmVhdGU6IGQoJycsIFN5bWJvbCgnY3JlYXRlJykpLFxuXHRoYXNJbnN0YW5jZTogZCgnJywgU3ltYm9sKCdoYXNJbnN0YW5jZScpKSxcblx0aXNDb25jYXRTcHJlYWRhYmxlOiBkKCcnLCBTeW1ib2woJ2lzQ29uY2F0U3ByZWFkYWJsZScpKSxcblx0aXNSZWdFeHA6IGQoJycsIFN5bWJvbCgnaXNSZWdFeHAnKSksXG5cdGl0ZXJhdG9yOiBkKCcnLCBTeW1ib2woJ2l0ZXJhdG9yJykpLFxuXHR0b1ByaW1pdGl2ZTogZCgnJywgU3ltYm9sKCd0b1ByaW1pdGl2ZScpKSxcblx0dG9TdHJpbmdUYWc6IGQoJycsIFN5bWJvbCgndG9TdHJpbmdUYWcnKSksXG5cdHVuc2NvcGFibGVzOiBkKCcnLCBTeW1ib2woJ3Vuc2NvcGFibGVzJykpXG59KTtcblxuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wucHJvdG90eXBlLCB7XG5cdHByb3BlclRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRyZXR1cm4gJ1N5bWJvbCAoJyArIHRoaXMuX19kZXNjcmlwdGlvbl9fICsgJyknO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoJycsIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19uYW1lX187IH0pXG59KTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsIGQoJycsXG5cdGZ1bmN0aW9uIChoaW50KSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcihcIkNvbnZlcnNpb24gb2Ygc3ltYm9sIG9iamVjdHMgaXMgbm90IGFsbG93ZWRcIik7XG5cdH0pKTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU3ltYm9sJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcblxuICAsIGFwcGx5ID0gRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5LCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGxcbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eVxuICAsIGRlc2NyaXB0b3IgPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlIH1cblxuICAsIG9uLCBvbmNlLCBvZmYsIGVtaXQsIG1ldGhvZHMsIGRlc2NyaXB0b3JzLCBiYXNlO1xuXG5vbiA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgZGF0YTtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkge1xuXHRcdGRhdGEgPSBkZXNjcmlwdG9yLnZhbHVlID0gY3JlYXRlKG51bGwpO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2VlX18nLCBkZXNjcmlwdG9yKTtcblx0XHRkZXNjcmlwdG9yLnZhbHVlID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRkYXRhID0gdGhpcy5fX2VlX187XG5cdH1cblx0aWYgKCFkYXRhW3R5cGVdKSBkYXRhW3R5cGVdID0gbGlzdGVuZXI7XG5cdGVsc2UgaWYgKHR5cGVvZiBkYXRhW3R5cGVdID09PSAnb2JqZWN0JykgZGF0YVt0eXBlXS5wdXNoKGxpc3RlbmVyKTtcblx0ZWxzZSBkYXRhW3R5cGVdID0gW2RhdGFbdHlwZV0sIGxpc3RlbmVyXTtcblxuXHRyZXR1cm4gdGhpcztcbn07XG5cbm9uY2UgPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIG9uY2UsIHNlbGY7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXHRzZWxmID0gdGhpcztcblx0b24uY2FsbCh0aGlzLCB0eXBlLCBvbmNlID0gZnVuY3Rpb24gKCkge1xuXHRcdG9mZi5jYWxsKHNlbGYsIHR5cGUsIG9uY2UpO1xuXHRcdGFwcGx5LmNhbGwobGlzdGVuZXIsIHRoaXMsIGFyZ3VtZW50cyk7XG5cdH0pO1xuXG5cdG9uY2UuX19lZU9uY2VMaXN0ZW5lcl9fID0gbGlzdGVuZXI7XG5cdHJldHVybiB0aGlzO1xufTtcblxub2ZmID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBkYXRhLCBsaXN0ZW5lcnMsIGNhbmRpZGF0ZSwgaTtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkgcmV0dXJuIHRoaXM7XG5cdGRhdGEgPSB0aGlzLl9fZWVfXztcblx0aWYgKCFkYXRhW3R5cGVdKSByZXR1cm4gdGhpcztcblx0bGlzdGVuZXJzID0gZGF0YVt0eXBlXTtcblxuXHRpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ29iamVjdCcpIHtcblx0XHRmb3IgKGkgPSAwOyAoY2FuZGlkYXRlID0gbGlzdGVuZXJzW2ldKTsgKytpKSB7XG5cdFx0XHRpZiAoKGNhbmRpZGF0ZSA9PT0gbGlzdGVuZXIpIHx8XG5cdFx0XHRcdFx0KGNhbmRpZGF0ZS5fX2VlT25jZUxpc3RlbmVyX18gPT09IGxpc3RlbmVyKSkge1xuXHRcdFx0XHRpZiAobGlzdGVuZXJzLmxlbmd0aCA9PT0gMikgZGF0YVt0eXBlXSA9IGxpc3RlbmVyc1tpID8gMCA6IDFdO1xuXHRcdFx0XHRlbHNlIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGlmICgobGlzdGVuZXJzID09PSBsaXN0ZW5lcikgfHxcblx0XHRcdFx0KGxpc3RlbmVycy5fX2VlT25jZUxpc3RlbmVyX18gPT09IGxpc3RlbmVyKSkge1xuXHRcdFx0ZGVsZXRlIGRhdGFbdHlwZV07XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5lbWl0ID0gZnVuY3Rpb24gKHR5cGUpIHtcblx0dmFyIGksIGwsIGxpc3RlbmVyLCBsaXN0ZW5lcnMsIGFyZ3M7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkgcmV0dXJuO1xuXHRsaXN0ZW5lcnMgPSB0aGlzLl9fZWVfX1t0eXBlXTtcblx0aWYgKCFsaXN0ZW5lcnMpIHJldHVybjtcblxuXHRpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ29iamVjdCcpIHtcblx0XHRsID0gYXJndW1lbnRzLmxlbmd0aDtcblx0XHRhcmdzID0gbmV3IEFycmF5KGwgLSAxKTtcblx0XHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuXHRcdGxpc3RlbmVycyA9IGxpc3RlbmVycy5zbGljZSgpO1xuXHRcdGZvciAoaSA9IDA7IChsaXN0ZW5lciA9IGxpc3RlbmVyc1tpXSk7ICsraSkge1xuXHRcdFx0YXBwbHkuY2FsbChsaXN0ZW5lciwgdGhpcywgYXJncyk7XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuXHRcdGNhc2UgMTpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMpO1xuXHRcdFx0YnJlYWs7XG5cdFx0Y2FzZSAyOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJndW1lbnRzWzFdKTtcblx0XHRcdGJyZWFrO1xuXHRcdGNhc2UgMzpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcblx0XHRcdGJyZWFrO1xuXHRcdGRlZmF1bHQ6XG5cdFx0XHRsID0gYXJndW1lbnRzLmxlbmd0aDtcblx0XHRcdGFyZ3MgPSBuZXcgQXJyYXkobCAtIDEpO1xuXHRcdFx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkge1xuXHRcdFx0XHRhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblx0XHRcdH1cblx0XHRcdGFwcGx5LmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmdzKTtcblx0XHR9XG5cdH1cbn07XG5cbm1ldGhvZHMgPSB7XG5cdG9uOiBvbixcblx0b25jZTogb25jZSxcblx0b2ZmOiBvZmYsXG5cdGVtaXQ6IGVtaXRcbn07XG5cbmRlc2NyaXB0b3JzID0ge1xuXHRvbjogZChvbiksXG5cdG9uY2U6IGQob25jZSksXG5cdG9mZjogZChvZmYpLFxuXHRlbWl0OiBkKGVtaXQpXG59O1xuXG5iYXNlID0gZGVmaW5lUHJvcGVydGllcyh7fSwgZGVzY3JpcHRvcnMpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBmdW5jdGlvbiAobykge1xuXHRyZXR1cm4gKG8gPT0gbnVsbCkgPyBjcmVhdGUoYmFzZSkgOiBkZWZpbmVQcm9wZXJ0aWVzKE9iamVjdChvKSwgZGVzY3JpcHRvcnMpO1xufTtcbmV4cG9ydHMubWV0aG9kcyA9IG1ldGhvZHM7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGVhciAgICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9jbGVhcicpXG4gICwgZUluZGV4T2YgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvZS1pbmRleC1vZicpXG4gICwgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjYWxsYWJsZSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXZlbnQtZW1pdHRlcicpXG4gICwgU3ltYm9sICAgICAgICAgPSByZXF1aXJlKCdlczYtc3ltYm9sJylcbiAgLCBpdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZScpXG4gICwgZm9yT2YgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZm9yLW9mJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vbGliL2l0ZXJhdG9yJylcbiAgLCBpc05hdGl2ZSAgICAgICA9IHJlcXVpcmUoJy4vaXMtbmF0aXZlLWltcGxlbWVudGVkJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTZXRQb2x5LCBnZXRWYWx1ZXM7XG5cbm1vZHVsZS5leHBvcnRzID0gU2V0UG9seSA9IGZ1bmN0aW9uICgvKml0ZXJhYmxlKi8pIHtcblx0dmFyIGl0ZXJhYmxlID0gYXJndW1lbnRzWzBdO1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgU2V0UG9seSkpIHJldHVybiBuZXcgU2V0UG9seShpdGVyYWJsZSk7XG5cdGlmICh0aGlzLl9fc2V0RGF0YV9fICE9PSB1bmRlZmluZWQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKHRoaXMgKyBcIiBjYW5ub3QgYmUgcmVpbml0aWFsaXplZFwiKTtcblx0fVxuXHRpZiAoaXRlcmFibGUgIT0gbnVsbCkgaXRlcmF0b3IoaXRlcmFibGUpO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19zZXREYXRhX18nLCBkKCdjJywgW10pKTtcblx0aWYgKCFpdGVyYWJsZSkgcmV0dXJuO1xuXHRmb3JPZihpdGVyYWJsZSwgZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0aWYgKGVJbmRleE9mLmNhbGwodGhpcywgdmFsdWUpICE9PSAtMSkgcmV0dXJuO1xuXHRcdHRoaXMucHVzaCh2YWx1ZSk7XG5cdH0sIHRoaXMuX19zZXREYXRhX18pO1xufTtcblxuaWYgKGlzTmF0aXZlKSB7XG5cdGlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU2V0UG9seSwgU2V0KTtcblx0U2V0UG9seS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFNldC5wcm90b3R5cGUsIHtcblx0XHRjb25zdHJ1Y3RvcjogZChTZXRQb2x5KVxuXHR9KTtcbn1cblxuZWUoT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoU2V0UG9seS5wcm90b3R5cGUsIHtcblx0YWRkOiBkKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdGlmICh0aGlzLmhhcyh2YWx1ZSkpIHJldHVybiB0aGlzO1xuXHRcdHRoaXMuZW1pdCgnX2FkZCcsIHRoaXMuX19zZXREYXRhX18ucHVzaCh2YWx1ZSkgLSAxLCB2YWx1ZSk7XG5cdFx0cmV0dXJuIHRoaXM7XG5cdH0pLFxuXHRjbGVhcjogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCF0aGlzLl9fc2V0RGF0YV9fLmxlbmd0aCkgcmV0dXJuO1xuXHRcdGNsZWFyLmNhbGwodGhpcy5fX3NldERhdGFfXyk7XG5cdFx0dGhpcy5lbWl0KCdfY2xlYXInKTtcblx0fSksXG5cdGRlbGV0ZTogZChmdW5jdGlvbiAodmFsdWUpIHtcblx0XHR2YXIgaW5kZXggPSBlSW5kZXhPZi5jYWxsKHRoaXMuX19zZXREYXRhX18sIHZhbHVlKTtcblx0XHRpZiAoaW5kZXggPT09IC0xKSByZXR1cm4gZmFsc2U7XG5cdFx0dGhpcy5fX3NldERhdGFfXy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdHRoaXMuZW1pdCgnX2RlbGV0ZScsIGluZGV4LCB2YWx1ZSk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0pLFxuXHRlbnRyaWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAna2V5K3ZhbHVlJyk7IH0pLFxuXHRmb3JFYWNoOiBkKGZ1bmN0aW9uIChjYi8qLCB0aGlzQXJnKi8pIHtcblx0XHR2YXIgdGhpc0FyZyA9IGFyZ3VtZW50c1sxXSwgaXRlcmF0b3IsIHJlc3VsdCwgdmFsdWU7XG5cdFx0Y2FsbGFibGUoY2IpO1xuXHRcdGl0ZXJhdG9yID0gdGhpcy52YWx1ZXMoKTtcblx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdHdoaWxlIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0dmFsdWUgPSBpdGVyYXRvci5fcmVzb2x2ZShyZXN1bHQpO1xuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwgdmFsdWUsIHRoaXMpO1xuXHRcdFx0cmVzdWx0ID0gaXRlcmF0b3IuX25leHQoKTtcblx0XHR9XG5cdH0pLFxuXHRoYXM6IGQoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0cmV0dXJuIChlSW5kZXhPZi5jYWxsKHRoaXMuX19zZXREYXRhX18sIHZhbHVlKSAhPT0gLTEpO1xuXHR9KSxcblx0a2V5czogZChnZXRWYWx1ZXMgPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLnZhbHVlcygpOyB9KSxcblx0c2l6ZTogZC5ncyhmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fc2V0RGF0YV9fLmxlbmd0aDsgfSksXG5cdHZhbHVlczogZChmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgSXRlcmF0b3IodGhpcyk7IH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBTZXRdJzsgfSlcbn0pKTtcbmRlZmluZVByb3BlcnR5KFNldFBvbHkucHJvdG90eXBlLCBTeW1ib2wuaXRlcmF0b3IsIGQoZ2V0VmFsdWVzKSk7XG5kZWZpbmVQcm9wZXJ0eShTZXRQb2x5LnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1NldCcpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/XG5cdFx0V2Vha01hcCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBtYXA7XG5cdGlmICh0eXBlb2YgV2Vha01hcCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRtYXAgPSBuZXcgV2Vha01hcCgpO1xuXHRpZiAodHlwZW9mIG1hcC5zZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKG1hcC5zZXQoe30sIDEpICE9PSBtYXApIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuY2xlYXIgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZGVsZXRlICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmhhcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIi8vIEV4cG9ydHMgdHJ1ZSBpZiBlbnZpcm9ubWVudCBwcm92aWRlcyBuYXRpdmUgYFdlYWtNYXBgIGltcGxlbWVudGF0aW9uLFxuLy8gd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgV2Vha01hcCA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoV2Vha01hcC5wcm90b3R5cGUpID09PVxuXHRcdFx0J1tvYmplY3QgV2Vha01hcF0nKTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCA9IHJlcXVpcmUoJy4vaXMtb2JqZWN0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNPYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGFuIE9iamVjdFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgb2JqZWN0ICAgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuICAsIGQgICAgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgZ2V0SXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZ2V0JylcbiAgLCBmb3JPZiAgICAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci9mb3Itb2YnKVxuICAsIHRvU3RyaW5nVGFnU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLnRvU3RyaW5nVGFnXG4gICwgaXNOYXRpdmUgICAgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksIHJhbmRvbSA9IE1hdGgucmFuZG9tXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZ2VuSWQsIFdlYWtNYXBQb2x5O1xuXG5nZW5JZCA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBnZW5lcmF0ZWQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKCkge1xuXHRcdHZhciBpZDtcblx0XHRkbyB7IGlkID0gcmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpOyB9IHdoaWxlIChnZW5lcmF0ZWRbaWRdKTtcblx0XHRnZW5lcmF0ZWRbaWRdID0gdHJ1ZTtcblx0XHRyZXR1cm4gaWQ7XG5cdH07XG59KCkpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYWtNYXBQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF07XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBXZWFrTWFwUG9seSkpIHJldHVybiBuZXcgV2Vha01hcFBvbHkoaXRlcmFibGUpO1xuXHRpZiAodGhpcy5fX3dlYWtNYXBEYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSB7XG5cdFx0aWYgKCFpc0FycmF5KGl0ZXJhYmxlKSkgaXRlcmFibGUgPSBnZXRJdGVyYXRvcihpdGVyYWJsZSk7XG5cdH1cblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fd2Vha01hcERhdGFfXycsIGQoJ2MnLCAnJHdlYWtNYXAkJyArIGdlbklkKCkpKTtcblx0aWYgKCFpdGVyYWJsZSkgcmV0dXJuO1xuXHRmb3JPZihpdGVyYWJsZSwgZnVuY3Rpb24gKHZhbCkge1xuXHRcdHZhbHVlKHZhbCk7XG5cdFx0dGhpcy5zZXQodmFsWzBdLCB2YWxbMV0pO1xuXHR9LCB0aGlzKTtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFdlYWtNYXBQb2x5LCBXZWFrTWFwKTtcblx0V2Vha01hcFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShXZWFrTWFwLnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKFdlYWtNYXBQb2x5KVxuXHR9KTtcbn1cblxuT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoV2Vha01hcFBvbHkucHJvdG90eXBlLCB7XG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX193ZWFrTWFwRGF0YV9fJywgZCgnYycsICckd2Vha01hcCQnICsgZ2VuSWQoKSkpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3Qoa2V5KSwgdGhpcy5fX3dlYWtNYXBEYXRhX18pKSB7XG5cdFx0XHRkZWxldGUga2V5W3RoaXMuX193ZWFrTWFwRGF0YV9fXTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH0pLFxuXHRnZXQ6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXykpIHtcblx0XHRcdHJldHVybiBrZXlbdGhpcy5fX3dlYWtNYXBEYXRhX19dO1xuXHRcdH1cblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0cmV0dXJuIGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0KGtleSksIHRoaXMuX193ZWFrTWFwRGF0YV9fKTtcblx0fSksXG5cdHNldDogZChmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuXHRcdGRlZmluZVByb3BlcnR5KG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXywgZCgnYycsIHZhbHVlKSk7XG5cdFx0cmV0dXJuIHRoaXM7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBXZWFrTWFwXSc7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFdlYWtNYXBQb2x5LnByb3RvdHlwZSwgdG9TdHJpbmdUYWdTeW1ib2wsIGQoJ2MnLCAnV2Vha01hcCcpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IE1hcCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBtYXAsIGl0ZXJhdG9yLCByZXN1bHQ7XG5cdGlmICh0eXBlb2YgTWFwICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHRyeSB7XG5cdFx0Ly8gV2ViS2l0IGRvZXNuJ3Qgc3VwcG9ydCBhcmd1bWVudHMgYW5kIGNyYXNoZXNcblx0XHRtYXAgPSBuZXcgTWFwKFtbJ3JheicsICdvbmUnXSwgWydkd2EnLCAndHdvJ10sIFsndHJ6eScsICd0aHJlZSddXSk7XG5cdH0gY2F0Y2ggKGUpIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblx0aWYgKG1hcC5zaXplICE9PSAzKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmNsZWFyICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmRlbGV0ZSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5lbnRyaWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZ2V0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmhhcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5rZXlzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLnNldCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC52YWx1ZXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblxuXHRpdGVyYXRvciA9IG1hcC5lbnRyaWVzKCk7XG5cdHJlc3VsdCA9IGl0ZXJhdG9yLm5leHQoKTtcblx0aWYgKHJlc3VsdC5kb25lICE9PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuXHRpZiAoIXJlc3VsdC52YWx1ZSkgcmV0dXJuIGZhbHNlO1xuXHRpZiAocmVzdWx0LnZhbHVlWzBdICE9PSAncmF6JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAocmVzdWx0LnZhbHVlWzFdICE9PSAnb25lJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIvLyBFeHBvcnRzIHRydWUgaWYgZW52aXJvbm1lbnQgcHJvdmlkZXMgbmF0aXZlIGBNYXBgIGltcGxlbWVudGF0aW9uLFxuLy8gd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgTWFwID09PSAndW5kZWZpbmVkJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChNYXAucHJvdG90eXBlKSA9PT0gJ1tvYmplY3QgTWFwXScpO1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9wcmltaXRpdmUtc2V0JykoJ2tleScsXG5cdCd2YWx1ZScsICdrZXkrdmFsdWUnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgZCAgICAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvcicpXG4gICwgdG9TdHJpbmdUYWdTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykudG9TdHJpbmdUYWdcbiAgLCBraW5kcyAgICAgICAgICAgICA9IHJlcXVpcmUoJy4vaXRlcmF0b3Ita2luZHMnKVxuXG4gICwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgdW5CaW5kID0gSXRlcmF0b3IucHJvdG90eXBlLl91bkJpbmRcbiAgLCBNYXBJdGVyYXRvcjtcblxuTWFwSXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChtYXAsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIE1hcEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBNYXBJdGVyYXRvcihtYXAsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIG1hcC5fX21hcEtleXNEYXRhX18sIG1hcCk7XG5cdGlmICgha2luZCB8fCAha2luZHNba2luZF0pIGtpbmQgPSAna2V5K3ZhbHVlJztcblx0ZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG5cdFx0X19raW5kX186IGQoJycsIGtpbmQpLFxuXHRcdF9fdmFsdWVzX186IGQoJ3cnLCBtYXAuX19tYXBWYWx1ZXNEYXRhX18pXG5cdH0pO1xufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoTWFwSXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuTWFwSXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoTWFwSXRlcmF0b3IpLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAndmFsdWUnKSByZXR1cm4gdGhpcy5fX3ZhbHVlc19fW2ldO1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAna2V5JykgcmV0dXJuIHRoaXMuX19saXN0X19baV07XG5cdFx0cmV0dXJuIFt0aGlzLl9fbGlzdF9fW2ldLCB0aGlzLl9fdmFsdWVzX19baV1dO1xuXHR9KSxcblx0X3VuQmluZDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dGhpcy5fX3ZhbHVlc19fID0gbnVsbDtcblx0XHR1bkJpbmQuY2FsbCh0aGlzKTtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IE1hcCBJdGVyYXRvcl0nOyB9KVxufSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoTWFwSXRlcmF0b3IucHJvdG90eXBlLCB0b1N0cmluZ1RhZ1N5bWJvbCxcblx0ZCgnYycsICdNYXAgSXRlcmF0b3InKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2gsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFyZy8qLCDigKZhcmdzKi8pIHtcblx0dmFyIHNldCA9IGNyZWF0ZShudWxsKTtcblx0Zm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24gKG5hbWUpIHsgc2V0W25hbWVdID0gdHJ1ZTsgfSk7XG5cdHJldHVybiBzZXQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGVJbmRleE9mICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YnKVxuICAsIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY2FsbGFibGUgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBlZSAgICAgICAgICAgICA9IHJlcXVpcmUoJ2V2ZW50LWVtaXR0ZXInKVxuICAsIFN5bWJvbCAgICAgICAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG4gICwgaXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvdmFsaWQtaXRlcmFibGUnKVxuICAsIGZvck9mICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL2Zvci1vZicpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuL2xpYi9pdGVyYXRvcicpXG4gICwgaXNOYXRpdmUgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIE1hcFBvbHk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFwUG9seSA9IGZ1bmN0aW9uICgvKml0ZXJhYmxlKi8pIHtcblx0dmFyIGl0ZXJhYmxlID0gYXJndW1lbnRzWzBdLCBrZXlzLCB2YWx1ZXM7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBNYXBQb2x5KSkgcmV0dXJuIG5ldyBNYXBQb2x5KGl0ZXJhYmxlKTtcblx0aWYgKHRoaXMuX19tYXBLZXlzRGF0YV9fICE9PSB1bmRlZmluZWQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKHRoaXMgKyBcIiBjYW5ub3QgYmUgcmVpbml0aWFsaXplZFwiKTtcblx0fVxuXHRpZiAoaXRlcmFibGUgIT0gbnVsbCkgaXRlcmF0b3IoaXRlcmFibGUpO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX21hcEtleXNEYXRhX186IGQoJ2MnLCBrZXlzID0gW10pLFxuXHRcdF9fbWFwVmFsdWVzRGF0YV9fOiBkKCdjJywgdmFsdWVzID0gW10pXG5cdH0pO1xuXHRpZiAoIWl0ZXJhYmxlKSByZXR1cm47XG5cdGZvck9mKGl0ZXJhYmxlLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHR2YXIga2V5ID0gdmFsaWRWYWx1ZSh2YWx1ZSlbMF07XG5cdFx0dmFsdWUgPSB2YWx1ZVsxXTtcblx0XHRpZiAoZUluZGV4T2YuY2FsbChrZXlzLCBrZXkpICE9PSAtMSkgcmV0dXJuO1xuXHRcdGtleXMucHVzaChrZXkpO1xuXHRcdHZhbHVlcy5wdXNoKHZhbHVlKTtcblx0fSwgdGhpcyk7XG59O1xuXG5pZiAoaXNOYXRpdmUpIHtcblx0aWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihNYXBQb2x5LCBNYXApO1xuXHRNYXBQb2x5LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoTWFwLnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKE1hcFBvbHkpXG5cdH0pO1xufVxuXG5lZShkZWZpbmVQcm9wZXJ0aWVzKE1hcFBvbHkucHJvdG90eXBlLCB7XG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19tYXBLZXlzRGF0YV9fLmxlbmd0aCkgcmV0dXJuO1xuXHRcdGNsZWFyLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18pO1xuXHRcdGNsZWFyLmNhbGwodGhpcy5fX21hcFZhbHVlc0RhdGFfXyk7XG5cdFx0dGhpcy5lbWl0KCdfY2xlYXInKTtcblx0fSksXG5cdGRlbGV0ZTogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dmFyIGluZGV4ID0gZUluZGV4T2YuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXywga2V5KTtcblx0XHRpZiAoaW5kZXggPT09IC0xKSByZXR1cm4gZmFsc2U7XG5cdFx0dGhpcy5fX21hcEtleXNEYXRhX18uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR0aGlzLl9fbWFwVmFsdWVzRGF0YV9fLnNwbGljZShpbmRleCwgMSk7XG5cdFx0dGhpcy5lbWl0KCdfZGVsZXRlJywgaW5kZXgsIGtleSk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0pLFxuXHRlbnRyaWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAna2V5K3ZhbHVlJyk7IH0pLFxuXHRmb3JFYWNoOiBkKGZ1bmN0aW9uIChjYi8qLCB0aGlzQXJnKi8pIHtcblx0XHR2YXIgdGhpc0FyZyA9IGFyZ3VtZW50c1sxXSwgaXRlcmF0b3IsIHJlc3VsdDtcblx0XHRjYWxsYWJsZShjYik7XG5cdFx0aXRlcmF0b3IgPSB0aGlzLmVudHJpZXMoKTtcblx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdHdoaWxlIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW3Jlc3VsdF0sXG5cdFx0XHRcdHRoaXMuX19tYXBLZXlzRGF0YV9fW3Jlc3VsdF0sIHRoaXMpO1xuXHRcdFx0cmVzdWx0ID0gaXRlcmF0b3IuX25leHQoKTtcblx0XHR9XG5cdH0pLFxuXHRnZXQ6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSk7XG5cdFx0aWYgKGluZGV4ID09PSAtMSkgcmV0dXJuO1xuXHRcdHJldHVybiB0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW2luZGV4XTtcblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0cmV0dXJuIChlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpICE9PSAtMSk7XG5cdH0pLFxuXHRrZXlzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAna2V5Jyk7IH0pLFxuXHRzZXQ6IGQoZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcblx0XHR2YXIgaW5kZXggPSBlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpLCBlbWl0O1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHtcblx0XHRcdGluZGV4ID0gdGhpcy5fX21hcEtleXNEYXRhX18ucHVzaChrZXkpIC0gMTtcblx0XHRcdGVtaXQgPSB0cnVlO1xuXHRcdH1cblx0XHR0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW2luZGV4XSA9IHZhbHVlO1xuXHRcdGlmIChlbWl0KSB0aGlzLmVtaXQoJ19hZGQnLCBpbmRleCwga2V5KTtcblx0XHRyZXR1cm4gdGhpcztcblx0fSksXG5cdHNpemU6IGQuZ3MoZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX21hcEtleXNEYXRhX18ubGVuZ3RoOyB9KSxcblx0dmFsdWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAndmFsdWUnKTsgfSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IE1hcF0nOyB9KVxufSkpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KE1hcFBvbHkucHJvdG90eXBlLCBTeW1ib2wuaXRlcmF0b3IsIGQoZnVuY3Rpb24gKCkge1xuXHRyZXR1cm4gdGhpcy5lbnRyaWVzKCk7XG59KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoTWFwUG9seS5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdNYXAnKSk7XG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNTYW1lKGEsIGIpe1xuICAgIGlmKGEgPT09IGIpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZihcbiAgICAgICAgdHlwZW9mIGEgIT09IHR5cGVvZiBiIHx8IFxuICAgICAgICB0eXBlb2YgYSA9PT0gJ29iamVjdCcgJiYgXG4gICAgICAgICEoYSBpbnN0YW5jZW9mIERhdGUgJiYgYiBpbnN0YW5jZW9mIERhdGUpXG4gICAgKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiBhICsgJycgPT09IGIgKyAnJztcbn07IiwidmFyIGRlZmluZWQgPSByZXF1aXJlKCdkZWZpbmVkJyk7XG52YXIgY3JlYXRlRGVmYXVsdFN0cmVhbSA9IHJlcXVpcmUoJy4vbGliL2RlZmF1bHRfc3RyZWFtJyk7XG52YXIgVGVzdCA9IHJlcXVpcmUoJy4vbGliL3Rlc3QnKTtcbnZhciBjcmVhdGVSZXN1bHQgPSByZXF1aXJlKCcuL2xpYi9yZXN1bHRzJyk7XG52YXIgdGhyb3VnaCA9IHJlcXVpcmUoJ3Rocm91Z2gnKTtcblxudmFyIGNhbkVtaXRFeGl0ID0gdHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3NcbiAgICAmJiB0eXBlb2YgcHJvY2Vzcy5vbiA9PT0gJ2Z1bmN0aW9uJyAmJiBwcm9jZXNzLmJyb3dzZXIgIT09IHRydWVcbjtcbnZhciBjYW5FeGl0ID0gdHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3NcbiAgICAmJiB0eXBlb2YgcHJvY2Vzcy5leGl0ID09PSAnZnVuY3Rpb24nXG47XG5cbnZhciBuZXh0VGljayA9IHR5cGVvZiBzZXRJbW1lZGlhdGUgIT09ICd1bmRlZmluZWQnXG4gICAgPyBzZXRJbW1lZGlhdGVcbiAgICA6IHByb2Nlc3MubmV4dFRpY2tcbjtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgaGFybmVzcztcbiAgICB2YXIgbGF6eUxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBnZXRIYXJuZXNzKCkuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICAgIFxuICAgIGxhenlMb2FkLm9ubHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBnZXRIYXJuZXNzKCkub25seS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gICAgXG4gICAgbGF6eUxvYWQuY3JlYXRlU3RyZWFtID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICAgICAgaWYgKCFvcHRzKSBvcHRzID0ge307XG4gICAgICAgIGlmICghaGFybmVzcykge1xuICAgICAgICAgICAgdmFyIG91dHB1dCA9IHRocm91Z2goKTtcbiAgICAgICAgICAgIGdldEhhcm5lc3MoeyBzdHJlYW06IG91dHB1dCwgb2JqZWN0TW9kZTogb3B0cy5vYmplY3RNb2RlIH0pO1xuICAgICAgICAgICAgcmV0dXJuIG91dHB1dDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaGFybmVzcy5jcmVhdGVTdHJlYW0ob3B0cyk7XG4gICAgfTtcbiAgICBcbiAgICByZXR1cm4gbGF6eUxvYWRcbiAgICBcbiAgICBmdW5jdGlvbiBnZXRIYXJuZXNzIChvcHRzKSB7XG4gICAgICAgIGlmICghb3B0cykgb3B0cyA9IHt9O1xuICAgICAgICBvcHRzLmF1dG9jbG9zZSA9ICFjYW5FbWl0RXhpdDtcbiAgICAgICAgaWYgKCFoYXJuZXNzKSBoYXJuZXNzID0gY3JlYXRlRXhpdEhhcm5lc3Mob3B0cyk7XG4gICAgICAgIHJldHVybiBoYXJuZXNzO1xuICAgIH1cbn0pKCk7XG5cbmZ1bmN0aW9uIGNyZWF0ZUV4aXRIYXJuZXNzIChjb25mKSB7XG4gICAgaWYgKCFjb25mKSBjb25mID0ge307XG4gICAgdmFyIGhhcm5lc3MgPSBjcmVhdGVIYXJuZXNzKHtcbiAgICAgICAgYXV0b2Nsb3NlOiBkZWZpbmVkKGNvbmYuYXV0b2Nsb3NlLCBmYWxzZSlcbiAgICB9KTtcbiAgICBcbiAgICB2YXIgc3RyZWFtID0gaGFybmVzcy5jcmVhdGVTdHJlYW0oeyBvYmplY3RNb2RlOiBjb25mLm9iamVjdE1vZGUgfSk7XG4gICAgdmFyIGVzID0gc3RyZWFtLnBpcGUoY29uZi5zdHJlYW0gfHwgY3JlYXRlRGVmYXVsdFN0cmVhbSgpKTtcbiAgICBpZiAoY2FuRW1pdEV4aXQpIHtcbiAgICAgICAgZXMub24oJ2Vycm9yJywgZnVuY3Rpb24gKGVycikgeyBoYXJuZXNzLl9leGl0Q29kZSA9IDEgfSk7XG4gICAgfVxuICAgIFxuICAgIHZhciBlbmRlZCA9IGZhbHNlO1xuICAgIHN0cmVhbS5vbignZW5kJywgZnVuY3Rpb24gKCkgeyBlbmRlZCA9IHRydWUgfSk7XG4gICAgXG4gICAgaWYgKGNvbmYuZXhpdCA9PT0gZmFsc2UpIHJldHVybiBoYXJuZXNzO1xuICAgIGlmICghY2FuRW1pdEV4aXQgfHwgIWNhbkV4aXQpIHJldHVybiBoYXJuZXNzO1xuXG4gICAgdmFyIGluRXJyb3JTdGF0ZSA9IGZhbHNlO1xuXG4gICAgcHJvY2Vzcy5vbignZXhpdCcsIGZ1bmN0aW9uIChjb2RlKSB7XG4gICAgICAgIC8vIGxldCB0aGUgcHJvY2VzcyBleGl0IGNsZWFubHkuXG4gICAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZW5kZWQpIHtcbiAgICAgICAgICAgIHZhciBvbmx5ID0gaGFybmVzcy5fcmVzdWx0cy5fb25seTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaGFybmVzcy5fdGVzdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgdCA9IGhhcm5lc3MuX3Rlc3RzW2ldO1xuICAgICAgICAgICAgICAgIGlmIChvbmx5ICYmIHQubmFtZSAhPT0gb25seSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgdC5fZXhpdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGhhcm5lc3MuY2xvc2UoKTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KGNvZGUgfHwgaGFybmVzcy5fZXhpdENvZGUpO1xuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBoYXJuZXNzO1xufVxuXG5leHBvcnRzLmNyZWF0ZUhhcm5lc3MgPSBjcmVhdGVIYXJuZXNzO1xuZXhwb3J0cy5UZXN0ID0gVGVzdDtcbmV4cG9ydHMudGVzdCA9IGV4cG9ydHM7IC8vIHRhcCBjb21wYXRcbmV4cG9ydHMudGVzdC5za2lwID0gVGVzdC5za2lwO1xuXG52YXIgZXhpdEludGVydmFsO1xuXG5mdW5jdGlvbiBjcmVhdGVIYXJuZXNzIChjb25mXykge1xuICAgIGlmICghY29uZl8pIGNvbmZfID0ge307XG4gICAgdmFyIHJlc3VsdHMgPSBjcmVhdGVSZXN1bHQoKTtcbiAgICBpZiAoY29uZl8uYXV0b2Nsb3NlICE9PSBmYWxzZSkge1xuICAgICAgICByZXN1bHRzLm9uY2UoJ2RvbmUnLCBmdW5jdGlvbiAoKSB7IHJlc3VsdHMuY2xvc2UoKSB9KTtcbiAgICB9XG4gICAgXG4gICAgdmFyIHRlc3QgPSBmdW5jdGlvbiAobmFtZSwgY29uZiwgY2IpIHtcbiAgICAgICAgdmFyIHQgPSBuZXcgVGVzdChuYW1lLCBjb25mLCBjYik7XG4gICAgICAgIHRlc3QuX3Rlc3RzLnB1c2godCk7XG4gICAgICAgIFxuICAgICAgICAoZnVuY3Rpb24gaW5zcGVjdENvZGUgKHN0KSB7XG4gICAgICAgICAgICBzdC5vbigndGVzdCcsIGZ1bmN0aW9uIHN1YiAoc3RfKSB7XG4gICAgICAgICAgICAgICAgaW5zcGVjdENvZGUoc3RfKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc3Qub24oJ3Jlc3VsdCcsIGZ1bmN0aW9uIChyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFyLm9rKSB0ZXN0Ll9leGl0Q29kZSA9IDFcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KSh0KTtcbiAgICAgICAgXG4gICAgICAgIHJlc3VsdHMucHVzaCh0KTtcbiAgICAgICAgcmV0dXJuIHQ7XG4gICAgfTtcbiAgICB0ZXN0Ll9yZXN1bHRzID0gcmVzdWx0cztcbiAgICBcbiAgICB0ZXN0Ll90ZXN0cyA9IFtdO1xuICAgIFxuICAgIHRlc3QuY3JlYXRlU3RyZWFtID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHMuY3JlYXRlU3RyZWFtKG9wdHMpO1xuICAgIH07XG4gICAgXG4gICAgdmFyIG9ubHkgPSBmYWxzZTtcbiAgICB0ZXN0Lm9ubHkgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBpZiAob25seSkgdGhyb3cgbmV3IEVycm9yKCd0aGVyZSBjYW4gb25seSBiZSBvbmUgb25seSB0ZXN0Jyk7XG4gICAgICAgIHJlc3VsdHMub25seShuYW1lKTtcbiAgICAgICAgb25seSA9IHRydWU7XG4gICAgICAgIHJldHVybiB0ZXN0LmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgICB0ZXN0Ll9leGl0Q29kZSA9IDA7XG4gICAgXG4gICAgdGVzdC5jbG9zZSA9IGZ1bmN0aW9uICgpIHsgcmVzdWx0cy5jbG9zZSgpIH07XG4gICAgXG4gICAgcmV0dXJuIHRlc3Q7XG59XG4iLCJ2YXIgdGhyb3VnaCA9IHJlcXVpcmUoJ3Rocm91Z2gnKTtcbnZhciBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBsaW5lID0gJyc7XG4gICAgdmFyIHN0cmVhbSA9IHRocm91Z2god3JpdGUsIGZsdXNoKTtcbiAgICByZXR1cm4gc3RyZWFtO1xuICAgIFxuICAgIGZ1bmN0aW9uIHdyaXRlIChidWYpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBidWYubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjID0gdHlwZW9mIGJ1ZiA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICA/IGJ1Zi5jaGFyQXQoaSlcbiAgICAgICAgICAgICAgICA6IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgICAgICAgO1xuICAgICAgICAgICAgaWYgKGMgPT09ICdcXG4nKSBmbHVzaCgpO1xuICAgICAgICAgICAgZWxzZSBsaW5lICs9IGM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gZmx1c2ggKCkge1xuICAgICAgICBpZiAoZnMud3JpdGVTeW5jICYmIC9ed2luLy50ZXN0KHByb2Nlc3MucGxhdGZvcm0pKSB7XG4gICAgICAgICAgICB0cnkgeyBmcy53cml0ZVN5bmMoMSwgbGluZSArICdcXG4nKTsgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHsgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkgfVxuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdHJ5IHsgY29uc29sZS5sb2cobGluZSkgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHsgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkgfVxuICAgICAgICB9XG4gICAgICAgIGxpbmUgPSAnJztcbiAgICB9XG59O1xuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcbnZhciBpbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG52YXIgdGhyb3VnaCA9IHJlcXVpcmUoJ3Rocm91Z2gnKTtcbnZhciByZXN1bWVyID0gcmVxdWlyZSgncmVzdW1lcicpO1xudmFyIGluc3BlY3QgPSByZXF1aXJlKCdvYmplY3QtaW5zcGVjdCcpO1xudmFyIG5leHRUaWNrID0gdHlwZW9mIHNldEltbWVkaWF0ZSAhPT0gJ3VuZGVmaW5lZCdcbiAgICA/IHNldEltbWVkaWF0ZVxuICAgIDogcHJvY2Vzcy5uZXh0VGlja1xuO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJlc3VsdHM7XG5pbmhlcml0cyhSZXN1bHRzLCBFdmVudEVtaXR0ZXIpO1xuXG5mdW5jdGlvbiBSZXN1bHRzICgpIHtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgUmVzdWx0cykpIHJldHVybiBuZXcgUmVzdWx0cztcbiAgICB0aGlzLmNvdW50ID0gMDtcbiAgICB0aGlzLmZhaWwgPSAwO1xuICAgIHRoaXMucGFzcyA9IDA7XG4gICAgdGhpcy5fc3RyZWFtID0gdGhyb3VnaCgpO1xuICAgIHRoaXMudGVzdHMgPSBbXTtcbn1cblxuUmVzdWx0cy5wcm90b3R5cGUuY3JlYXRlU3RyZWFtID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIG91dHB1dCwgdGVzdElkID0gMDtcbiAgICBpZiAob3B0cy5vYmplY3RNb2RlKSB7XG4gICAgICAgIG91dHB1dCA9IHRocm91Z2goKTtcbiAgICAgICAgc2VsZi5vbignX3B1c2gnLCBmdW5jdGlvbiBvbnRlc3QgKHQsIGV4dHJhKSB7XG4gICAgICAgICAgICBpZiAoIWV4dHJhKSBleHRyYSA9IHt9O1xuICAgICAgICAgICAgdmFyIGlkID0gdGVzdElkKys7XG4gICAgICAgICAgICB0Lm9uY2UoJ3ByZXJ1bicsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHQubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGlkXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoaGFzKGV4dHJhLCAncGFyZW50JykpIHtcbiAgICAgICAgICAgICAgICAgICAgcm93LnBhcmVudCA9IGV4dHJhLnBhcmVudDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgb3V0cHV0LnF1ZXVlKHJvdyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHQub24oJ3Rlc3QnLCBmdW5jdGlvbiAoc3QpIHtcbiAgICAgICAgICAgICAgICBvbnRlc3Qoc3QsIHsgcGFyZW50OiBpZCB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdC5vbigncmVzdWx0JywgZnVuY3Rpb24gKHJlcykge1xuICAgICAgICAgICAgICAgIHJlcy50ZXN0ID0gaWQ7XG4gICAgICAgICAgICAgICAgcmVzLnR5cGUgPSAnYXNzZXJ0JztcbiAgICAgICAgICAgICAgICBvdXRwdXQucXVldWUocmVzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdC5vbignZW5kJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG91dHB1dC5xdWV1ZSh7IHR5cGU6ICdlbmQnLCB0ZXN0OiBpZCB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZi5vbignZG9uZScsIGZ1bmN0aW9uICgpIHsgb3V0cHV0LnF1ZXVlKG51bGwpIH0pO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgb3V0cHV0ID0gcmVzdW1lcigpO1xuICAgICAgICBvdXRwdXQucXVldWUoJ1RBUCB2ZXJzaW9uIDEzXFxuJyk7XG4gICAgICAgIHNlbGYuX3N0cmVhbS5waXBlKG91dHB1dCk7XG4gICAgfVxuICAgIFxuICAgIG5leHRUaWNrKGZ1bmN0aW9uIG5leHQoKSB7XG4gICAgICAgIHZhciB0O1xuICAgICAgICB3aGlsZSAodCA9IGdldE5leHRUZXN0KHNlbGYpKSB7XG4gICAgICAgICAgICB0LnJ1bigpO1xuICAgICAgICAgICAgaWYgKCF0LmVuZGVkKSByZXR1cm4gdC5vbmNlKCdlbmQnLCBmdW5jdGlvbigpeyBuZXh0VGljayhuZXh0KTsgfSk7XG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5lbWl0KCdkb25lJyk7XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIG91dHB1dDtcbn07XG5cblJlc3VsdHMucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbiAodCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnRlc3RzLnB1c2godCk7XG4gICAgc2VsZi5fd2F0Y2godCk7XG4gICAgc2VsZi5lbWl0KCdfcHVzaCcsIHQpO1xufTtcblxuUmVzdWx0cy5wcm90b3R5cGUub25seSA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgaWYgKHRoaXMuX29ubHkpIHtcbiAgICAgICAgc2VsZi5jb3VudCArKztcbiAgICAgICAgc2VsZi5mYWlsICsrO1xuICAgICAgICB3cml0ZSgnbm90IG9rICcgKyBzZWxmLmNvdW50ICsgJyBhbHJlYWR5IGNhbGxlZCAub25seSgpXFxuJyk7XG4gICAgfVxuICAgIHRoaXMuX29ubHkgPSBuYW1lO1xufTtcblxuUmVzdWx0cy5wcm90b3R5cGUuX3dhdGNoID0gZnVuY3Rpb24gKHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHdyaXRlID0gZnVuY3Rpb24gKHMpIHsgc2VsZi5fc3RyZWFtLnF1ZXVlKHMpIH07XG4gICAgdC5vbmNlKCdwcmVydW4nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHdyaXRlKCcjICcgKyB0Lm5hbWUgKyAnXFxuJyk7XG4gICAgfSk7XG4gICAgXG4gICAgdC5vbigncmVzdWx0JywgZnVuY3Rpb24gKHJlcykge1xuICAgICAgICBpZiAodHlwZW9mIHJlcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHdyaXRlKCcjICcgKyByZXMgKyAnXFxuJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGUoZW5jb2RlUmVzdWx0KHJlcywgc2VsZi5jb3VudCArIDEpKTtcbiAgICAgICAgc2VsZi5jb3VudCArKztcblxuICAgICAgICBpZiAocmVzLm9rKSBzZWxmLnBhc3MgKytcbiAgICAgICAgZWxzZSBzZWxmLmZhaWwgKytcbiAgICB9KTtcbiAgICBcbiAgICB0Lm9uKCd0ZXN0JywgZnVuY3Rpb24gKHN0KSB7IHNlbGYuX3dhdGNoKHN0KSB9KTtcbn07XG5cblJlc3VsdHMucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5jbG9zZWQpIHNlbGYuX3N0cmVhbS5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignQUxSRUFEWSBDTE9TRUQnKSk7XG4gICAgc2VsZi5jbG9zZWQgPSB0cnVlO1xuICAgIHZhciB3cml0ZSA9IGZ1bmN0aW9uIChzKSB7IHNlbGYuX3N0cmVhbS5xdWV1ZShzKSB9O1xuICAgIFxuICAgIHdyaXRlKCdcXG4xLi4nICsgc2VsZi5jb3VudCArICdcXG4nKTtcbiAgICB3cml0ZSgnIyB0ZXN0cyAnICsgc2VsZi5jb3VudCArICdcXG4nKTtcbiAgICB3cml0ZSgnIyBwYXNzICAnICsgc2VsZi5wYXNzICsgJ1xcbicpO1xuICAgIGlmIChzZWxmLmZhaWwpIHdyaXRlKCcjIGZhaWwgICcgKyBzZWxmLmZhaWwgKyAnXFxuJylcbiAgICBlbHNlIHdyaXRlKCdcXG4jIG9rXFxuJylcblxuICAgIHNlbGYuX3N0cmVhbS5xdWV1ZShudWxsKTtcbn07XG5cbmZ1bmN0aW9uIGVuY29kZVJlc3VsdCAocmVzLCBjb3VudCkge1xuICAgIHZhciBvdXRwdXQgPSAnJztcbiAgICBvdXRwdXQgKz0gKHJlcy5vayA/ICdvayAnIDogJ25vdCBvayAnKSArIGNvdW50O1xuICAgIG91dHB1dCArPSByZXMubmFtZSA/ICcgJyArIHJlcy5uYW1lLnRvU3RyaW5nKCkucmVwbGFjZSgvXFxzKy9nLCAnICcpIDogJyc7XG4gICAgXG4gICAgaWYgKHJlcy5za2lwKSBvdXRwdXQgKz0gJyAjIFNLSVAnO1xuICAgIGVsc2UgaWYgKHJlcy50b2RvKSBvdXRwdXQgKz0gJyAjIFRPRE8nO1xuICAgIFxuICAgIG91dHB1dCArPSAnXFxuJztcbiAgICBpZiAocmVzLm9rKSByZXR1cm4gb3V0cHV0O1xuICAgIFxuICAgIHZhciBvdXRlciA9ICcgICc7XG4gICAgdmFyIGlubmVyID0gb3V0ZXIgKyAnICAnO1xuICAgIG91dHB1dCArPSBvdXRlciArICctLS1cXG4nO1xuICAgIG91dHB1dCArPSBpbm5lciArICdvcGVyYXRvcjogJyArIHJlcy5vcGVyYXRvciArICdcXG4nO1xuICAgIFxuICAgIGlmIChoYXMocmVzLCAnZXhwZWN0ZWQnKSB8fCBoYXMocmVzLCAnYWN0dWFsJykpIHtcbiAgICAgICAgdmFyIGV4ID0gaW5zcGVjdChyZXMuZXhwZWN0ZWQpO1xuICAgICAgICB2YXIgYWMgPSBpbnNwZWN0KHJlcy5hY3R1YWwpO1xuICAgICAgICBcbiAgICAgICAgaWYgKE1hdGgubWF4KGV4Lmxlbmd0aCwgYWMubGVuZ3RoKSA+IDY1KSB7XG4gICAgICAgICAgICBvdXRwdXQgKz0gaW5uZXIgKyAnZXhwZWN0ZWQ6XFxuJyArIGlubmVyICsgJyAgJyArIGV4ICsgJ1xcbic7XG4gICAgICAgICAgICBvdXRwdXQgKz0gaW5uZXIgKyAnYWN0dWFsOlxcbicgKyBpbm5lciArICcgICcgKyBhYyArICdcXG4nO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgb3V0cHV0ICs9IGlubmVyICsgJ2V4cGVjdGVkOiAnICsgZXggKyAnXFxuJztcbiAgICAgICAgICAgIG91dHB1dCArPSBpbm5lciArICdhY3R1YWw6ICAgJyArIGFjICsgJ1xcbic7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKHJlcy5hdCkge1xuICAgICAgICBvdXRwdXQgKz0gaW5uZXIgKyAnYXQ6ICcgKyByZXMuYXQgKyAnXFxuJztcbiAgICB9XG4gICAgaWYgKHJlcy5vcGVyYXRvciA9PT0gJ2Vycm9yJyAmJiByZXMuYWN0dWFsICYmIHJlcy5hY3R1YWwuc3RhY2spIHtcbiAgICAgICAgdmFyIGxpbmVzID0gU3RyaW5nKHJlcy5hY3R1YWwuc3RhY2spLnNwbGl0KCdcXG4nKTtcbiAgICAgICAgb3V0cHV0ICs9IGlubmVyICsgJ3N0YWNrOlxcbic7XG4gICAgICAgIG91dHB1dCArPSBpbm5lciArICcgICcgKyBsaW5lc1swXSArICdcXG4nO1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBvdXRwdXQgKz0gaW5uZXIgKyBsaW5lc1tpXSArICdcXG4nO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIG91dHB1dCArPSBvdXRlciArICcuLi5cXG4nO1xuICAgIHJldHVybiBvdXRwdXQ7XG59XG5cbmZ1bmN0aW9uIGdldE5leHRUZXN0IChyZXN1bHRzKSB7XG4gICAgaWYgKCFyZXN1bHRzLl9vbmx5KSB7XG4gICAgICAgIHJldHVybiByZXN1bHRzLnRlc3RzLnNoaWZ0KCk7XG4gICAgfVxuICAgIFxuICAgIGRvIHtcbiAgICAgICAgdmFyIHQgPSByZXN1bHRzLnRlc3RzLnNoaWZ0KCk7XG4gICAgICAgIGlmICghdCkgY29udGludWU7XG4gICAgICAgIGlmIChyZXN1bHRzLl9vbmx5ID09PSB0Lm5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiB0O1xuICAgICAgICB9XG4gICAgfSB3aGlsZSAocmVzdWx0cy50ZXN0cy5sZW5ndGggIT09IDApXG59XG5cbmZ1bmN0aW9uIGhhcyAob2JqLCBwcm9wKSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuIiwidmFyIGRlZXBFcXVhbCA9IHJlcXVpcmUoJ2RlZXAtZXF1YWwnKTtcbnZhciBkZWZpbmVkID0gcmVxdWlyZSgnZGVmaW5lZCcpO1xudmFyIHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xudmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxubW9kdWxlLmV4cG9ydHMgPSBUZXN0O1xuXG52YXIgbmV4dFRpY2sgPSB0eXBlb2Ygc2V0SW1tZWRpYXRlICE9PSAndW5kZWZpbmVkJ1xuICAgID8gc2V0SW1tZWRpYXRlXG4gICAgOiBwcm9jZXNzLm5leHRUaWNrXG47XG5cbmluaGVyaXRzKFRlc3QsIEV2ZW50RW1pdHRlcik7XG5cbnZhciBnZXRUZXN0QXJncyA9IGZ1bmN0aW9uIChuYW1lXywgb3B0c18sIGNiXykge1xuICAgIHZhciBuYW1lID0gJyhhbm9ueW1vdXMpJztcbiAgICB2YXIgb3B0cyA9IHt9O1xuICAgIHZhciBjYjtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBhcmcgPSBhcmd1bWVudHNbaV07XG4gICAgICAgIHZhciB0ID0gdHlwZW9mIGFyZztcbiAgICAgICAgaWYgKHQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBuYW1lID0gYXJnO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHQgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBvcHRzID0gYXJnIHx8IG9wdHM7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2IgPSBhcmc7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgbmFtZTogbmFtZSwgb3B0czogb3B0cywgY2I6IGNiIH07XG59O1xuXG5mdW5jdGlvbiBUZXN0IChuYW1lXywgb3B0c18sIGNiXykge1xuICAgIGlmICghICh0aGlzIGluc3RhbmNlb2YgVGVzdCkpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUZXN0KG5hbWVfLCBvcHRzXywgY2JfKTtcbiAgICB9XG5cbiAgICB2YXIgYXJncyA9IGdldFRlc3RBcmdzKG5hbWVfLCBvcHRzXywgY2JfKTtcblxuICAgIHRoaXMucmVhZGFibGUgPSB0cnVlO1xuICAgIHRoaXMubmFtZSA9IGFyZ3MubmFtZSB8fCAnKGFub255bW91cyknO1xuICAgIHRoaXMuYXNzZXJ0Q291bnQgPSAwO1xuICAgIHRoaXMucGVuZGluZ0NvdW50ID0gMDtcbiAgICB0aGlzLl9za2lwID0gYXJncy5vcHRzLnNraXAgfHwgZmFsc2U7XG4gICAgdGhpcy5fcGxhbiA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLl9jYiA9IGFyZ3MuY2I7XG4gICAgdGhpcy5fcHJvZ2VueSA9IFtdO1xuICAgIHRoaXMuX29rID0gdHJ1ZTtcblxuICAgIGlmIChhcmdzLm9wdHMudGltZW91dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMudGltZW91dEFmdGVyKGFyZ3Mub3B0cy50aW1lb3V0KTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIHRoaXMpIHtcbiAgICAgICAgdGhpc1twcm9wXSA9IChmdW5jdGlvbiBiaW5kKHNlbGYsIHZhbCkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gYm91bmQoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB2YWwuYXBwbHkoc2VsZiwgYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSByZXR1cm4gdmFsO1xuICAgICAgICB9KSh0aGlzLCB0aGlzW3Byb3BdKTtcbiAgICB9XG59XG5cblRlc3QucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRoaXMuX2NiIHx8IHRoaXMuX3NraXApIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2VuZCgpO1xuICAgIH1cbiAgICB0aGlzLmVtaXQoJ3ByZXJ1bicpO1xuICAgIHRoaXMuX2NiKHRoaXMpO1xuICAgIHRoaXMuZW1pdCgncnVuJyk7XG59O1xuXG5UZXN0LnByb3RvdHlwZS50ZXN0ID0gZnVuY3Rpb24gKG5hbWUsIG9wdHMsIGNiKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciB0ID0gbmV3IFRlc3QobmFtZSwgb3B0cywgY2IpO1xuICAgIHRoaXMuX3Byb2dlbnkucHVzaCh0KTtcbiAgICB0aGlzLnBlbmRpbmdDb3VudCsrO1xuICAgIHRoaXMuZW1pdCgndGVzdCcsIHQpO1xuICAgIHQub24oJ3ByZXJ1bicsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgc2VsZi5hc3NlcnRDb3VudCsrO1xuICAgIH0pXG4gICAgXG4gICAgaWYgKCFzZWxmLl9wZW5kaW5nQXNzZXJ0cygpKSB7XG4gICAgICAgIG5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNlbGYuX2VuZCgpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgbmV4dFRpY2soZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghc2VsZi5fcGxhbiAmJiBzZWxmLnBlbmRpbmdDb3VudCA9PSBzZWxmLl9wcm9nZW55Lmxlbmd0aCkge1xuICAgICAgICAgICAgc2VsZi5fZW5kKCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLmNvbW1lbnQgPSBmdW5jdGlvbiAobXNnKSB7XG4gICAgdGhpcy5lbWl0KCdyZXN1bHQnLCBtc2cudHJpbSgpLnJlcGxhY2UoL14jXFxzKi8sICcnKSk7XG59O1xuXG5UZXN0LnByb3RvdHlwZS5wbGFuID0gZnVuY3Rpb24gKG4pIHtcbiAgICB0aGlzLl9wbGFuID0gbjtcbiAgICB0aGlzLmVtaXQoJ3BsYW4nLCBuKTtcbn07XG5cblRlc3QucHJvdG90eXBlLnRpbWVvdXRBZnRlciA9IGZ1bmN0aW9uKG1zKSB7XG4gICAgaWYgKCFtcykgdGhyb3cgbmV3IEVycm9yKCd0aW1lb3V0QWZ0ZXIgcmVxdWlyZXMgYSB0aW1lc3BhbicpO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYuZmFpbCgndGVzdCB0aW1lZCBvdXQgYWZ0ZXIgJyArIG1zICsgJ21zJyk7XG4gICAgICAgIHNlbGYuZW5kKCk7XG4gICAgfSwgbXMpO1xuICAgIHRoaXMub25jZSgnZW5kJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB9KTtcbn1cblxuVGVzdC5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKGVycikgeyBcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPj0gMSkge1xuICAgICAgICB0aGlzLmlmRXJyb3IoZXJyKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKHRoaXMuY2FsbGVkRW5kKSB7XG4gICAgICAgIHRoaXMuZmFpbCgnLmVuZCgpIGNhbGxlZCB0d2ljZScpO1xuICAgIH1cbiAgICB0aGlzLmNhbGxlZEVuZCA9IHRydWU7XG4gICAgdGhpcy5fZW5kKCk7XG59O1xuXG5UZXN0LnByb3RvdHlwZS5fZW5kID0gZnVuY3Rpb24gKGVycikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAodGhpcy5fcHJvZ2VueS5sZW5ndGgpIHtcbiAgICAgICAgdmFyIHQgPSB0aGlzLl9wcm9nZW55LnNoaWZ0KCk7XG4gICAgICAgIHQub24oJ2VuZCcsIGZ1bmN0aW9uICgpIHsgc2VsZi5fZW5kKCkgfSk7XG4gICAgICAgIHQucnVuKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgXG4gICAgaWYgKCF0aGlzLmVuZGVkKSB0aGlzLmVtaXQoJ2VuZCcpO1xuICAgIHZhciBwZW5kaW5nQXNzZXJ0cyA9IHRoaXMuX3BlbmRpbmdBc3NlcnRzKCk7XG4gICAgaWYgKCF0aGlzLl9wbGFuRXJyb3IgJiYgdGhpcy5fcGxhbiAhPT0gdW5kZWZpbmVkICYmIHBlbmRpbmdBc3NlcnRzKSB7XG4gICAgICAgIHRoaXMuX3BsYW5FcnJvciA9IHRydWU7XG4gICAgICAgIHRoaXMuZmFpbCgncGxhbiAhPSBjb3VudCcsIHtcbiAgICAgICAgICAgIGV4cGVjdGVkIDogdGhpcy5fcGxhbixcbiAgICAgICAgICAgIGFjdHVhbCA6IHRoaXMuYXNzZXJ0Q291bnRcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHRoaXMuZW5kZWQgPSB0cnVlO1xufTtcblxuVGVzdC5wcm90b3R5cGUuX2V4aXQgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMuX3BsYW4gIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAhdGhpcy5fcGxhbkVycm9yICYmIHRoaXMuYXNzZXJ0Q291bnQgIT09IHRoaXMuX3BsYW4pIHtcbiAgICAgICAgdGhpcy5fcGxhbkVycm9yID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5mYWlsKCdwbGFuICE9IGNvdW50Jywge1xuICAgICAgICAgICAgZXhwZWN0ZWQgOiB0aGlzLl9wbGFuLFxuICAgICAgICAgICAgYWN0dWFsIDogdGhpcy5hc3NlcnRDb3VudCxcbiAgICAgICAgICAgIGV4aXRpbmcgOiB0cnVlXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBlbHNlIGlmICghdGhpcy5lbmRlZCkge1xuICAgICAgICB0aGlzLmZhaWwoJ3Rlc3QgZXhpdGVkIHdpdGhvdXQgZW5kaW5nJywge1xuICAgICAgICAgICAgZXhpdGluZzogdHJ1ZVxuICAgICAgICB9KTtcbiAgICB9XG59O1xuXG5UZXN0LnByb3RvdHlwZS5fcGVuZGluZ0Fzc2VydHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMuX3BsYW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gMTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9wbGFuIC0gKHRoaXMuX3Byb2dlbnkubGVuZ3RoICsgdGhpcy5hc3NlcnRDb3VudCk7XG4gICAgfVxufTtcblxuVGVzdC5wcm90b3R5cGUuX2Fzc2VydCA9IGZ1bmN0aW9uIGFzc2VydCAob2ssIG9wdHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGV4dHJhID0gb3B0cy5leHRyYSB8fCB7fTtcbiAgICBcbiAgICB2YXIgcmVzID0ge1xuICAgICAgICBpZCA6IHNlbGYuYXNzZXJ0Q291bnQgKyssXG4gICAgICAgIG9rIDogQm9vbGVhbihvayksXG4gICAgICAgIHNraXAgOiBkZWZpbmVkKGV4dHJhLnNraXAsIG9wdHMuc2tpcCksXG4gICAgICAgIG5hbWUgOiBkZWZpbmVkKGV4dHJhLm1lc3NhZ2UsIG9wdHMubWVzc2FnZSwgJyh1bm5hbWVkIGFzc2VydCknKSxcbiAgICAgICAgb3BlcmF0b3IgOiBkZWZpbmVkKGV4dHJhLm9wZXJhdG9yLCBvcHRzLm9wZXJhdG9yKVxuICAgIH07XG4gICAgaWYgKGhhcyhvcHRzLCAnYWN0dWFsJykgfHwgaGFzKGV4dHJhLCAnYWN0dWFsJykpIHtcbiAgICAgICAgcmVzLmFjdHVhbCA9IGRlZmluZWQoZXh0cmEuYWN0dWFsLCBvcHRzLmFjdHVhbCk7XG4gICAgfVxuICAgIGlmIChoYXMob3B0cywgJ2V4cGVjdGVkJykgfHwgaGFzKGV4dHJhLCAnZXhwZWN0ZWQnKSkge1xuICAgICAgICByZXMuZXhwZWN0ZWQgPSBkZWZpbmVkKGV4dHJhLmV4cGVjdGVkLCBvcHRzLmV4cGVjdGVkKTtcbiAgICB9XG4gICAgdGhpcy5fb2sgPSBCb29sZWFuKHRoaXMuX29rICYmIG9rKTtcbiAgICBcbiAgICBpZiAoIW9rKSB7XG4gICAgICAgIHJlcy5lcnJvciA9IGRlZmluZWQoZXh0cmEuZXJyb3IsIG9wdHMuZXJyb3IsIG5ldyBFcnJvcihyZXMubmFtZSkpO1xuICAgIH1cbiAgICBcbiAgICBpZiAoIW9rKSB7XG4gICAgICAgIHZhciBlID0gbmV3IEVycm9yKCdleGNlcHRpb24nKTtcbiAgICAgICAgdmFyIGVyciA9IChlLnN0YWNrIHx8ICcnKS5zcGxpdCgnXFxuJyk7XG4gICAgICAgIHZhciBkaXIgPSBwYXRoLmRpcm5hbWUoX19kaXJuYW1lKSArICcvJztcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgbSA9IC9eW15cXHNdKlxccypcXGJhdFxccysoLispLy5leGVjKGVycltpXSk7XG4gICAgICAgICAgICBpZiAoIW0pIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHMgPSBtWzFdLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgICAgICB2YXIgZmlsZW0gPSAvKFxcL1teOlxcc10rOihcXGQrKSg/OjooXFxkKykpPykvLmV4ZWMoc1sxXSk7XG4gICAgICAgICAgICBpZiAoIWZpbGVtKSB7XG4gICAgICAgICAgICAgICAgZmlsZW0gPSAvKFxcL1teOlxcc10rOihcXGQrKSg/OjooXFxkKykpPykvLmV4ZWMoc1syXSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFmaWxlbSkge1xuICAgICAgICAgICAgICAgICAgICBmaWxlbSA9IC8oXFwvW146XFxzXSs6KFxcZCspKD86OihcXGQrKSk/KS8uZXhlYyhzWzNdKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoIWZpbGVtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGZpbGVtWzFdLnNsaWNlKDAsIGRpci5sZW5ndGgpID09PSBkaXIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmVzLmZ1bmN0aW9uTmFtZSA9IHNbMF07XG4gICAgICAgICAgICByZXMuZmlsZSA9IGZpbGVtWzFdO1xuICAgICAgICAgICAgcmVzLmxpbmUgPSBOdW1iZXIoZmlsZW1bMl0pO1xuICAgICAgICAgICAgaWYgKGZpbGVtWzNdKSByZXMuY29sdW1uID0gZmlsZW1bM107XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJlcy5hdCA9IG1bMV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHNlbGYuZW1pdCgncmVzdWx0JywgcmVzKTtcbiAgICBcbiAgICB2YXIgcGVuZGluZ0Fzc2VydHMgPSBzZWxmLl9wZW5kaW5nQXNzZXJ0cygpO1xuICAgIGlmICghcGVuZGluZ0Fzc2VydHMpIHtcbiAgICAgICAgaWYgKGV4dHJhLmV4aXRpbmcpIHtcbiAgICAgICAgICAgIHNlbGYuX2VuZCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHNlbGYuX2VuZCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgaWYgKCFzZWxmLl9wbGFuRXJyb3IgJiYgcGVuZGluZ0Fzc2VydHMgPCAwKSB7XG4gICAgICAgIHNlbGYuX3BsYW5FcnJvciA9IHRydWU7XG4gICAgICAgIHNlbGYuZmFpbCgncGxhbiAhPSBjb3VudCcsIHtcbiAgICAgICAgICAgIGV4cGVjdGVkIDogc2VsZi5fcGxhbixcbiAgICAgICAgICAgIGFjdHVhbCA6IHNlbGYuX3BsYW4gLSBwZW5kaW5nQXNzZXJ0c1xuICAgICAgICB9KTtcbiAgICB9XG59O1xuXG5UZXN0LnByb3RvdHlwZS5mYWlsID0gZnVuY3Rpb24gKG1zZywgZXh0cmEpIHtcbiAgICB0aGlzLl9hc3NlcnQoZmFsc2UsIHtcbiAgICAgICAgbWVzc2FnZSA6IG1zZyxcbiAgICAgICAgb3BlcmF0b3IgOiAnZmFpbCcsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLnBhc3MgPSBmdW5jdGlvbiAobXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydCh0cnVlLCB7XG4gICAgICAgIG1lc3NhZ2UgOiBtc2csXG4gICAgICAgIG9wZXJhdG9yIDogJ3Bhc3MnLFxuICAgICAgICBleHRyYSA6IGV4dHJhXG4gICAgfSk7XG59O1xuXG5UZXN0LnByb3RvdHlwZS5za2lwID0gZnVuY3Rpb24gKG1zZywgZXh0cmEpIHtcbiAgICB0aGlzLl9hc3NlcnQodHJ1ZSwge1xuICAgICAgICBtZXNzYWdlIDogbXNnLFxuICAgICAgICBvcGVyYXRvciA6ICdza2lwJyxcbiAgICAgICAgc2tpcCA6IHRydWUsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLm9rXG49IFRlc3QucHJvdG90eXBlWyd0cnVlJ11cbj0gVGVzdC5wcm90b3R5cGUuYXNzZXJ0XG49IGZ1bmN0aW9uICh2YWx1ZSwgbXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydCh2YWx1ZSwge1xuICAgICAgICBtZXNzYWdlIDogbXNnLFxuICAgICAgICBvcGVyYXRvciA6ICdvaycsXG4gICAgICAgIGV4cGVjdGVkIDogdHJ1ZSxcbiAgICAgICAgYWN0dWFsIDogdmFsdWUsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLm5vdE9rXG49IFRlc3QucHJvdG90eXBlWydmYWxzZSddXG49IFRlc3QucHJvdG90eXBlLm5vdG9rXG49IGZ1bmN0aW9uICh2YWx1ZSwgbXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydCghdmFsdWUsIHtcbiAgICAgICAgbWVzc2FnZSA6IG1zZyxcbiAgICAgICAgb3BlcmF0b3IgOiAnbm90T2snLFxuICAgICAgICBleHBlY3RlZCA6IGZhbHNlLFxuICAgICAgICBhY3R1YWwgOiB2YWx1ZSxcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGUuZXJyb3Jcbj0gVGVzdC5wcm90b3R5cGUuaWZFcnJvclxuPSBUZXN0LnByb3RvdHlwZS5pZkVyclxuPSBUZXN0LnByb3RvdHlwZS5pZmVycm9yXG49IGZ1bmN0aW9uIChlcnIsIG1zZywgZXh0cmEpIHtcbiAgICB0aGlzLl9hc3NlcnQoIWVyciwge1xuICAgICAgICBtZXNzYWdlIDogZGVmaW5lZChtc2csIFN0cmluZyhlcnIpKSxcbiAgICAgICAgb3BlcmF0b3IgOiAnZXJyb3InLFxuICAgICAgICBhY3R1YWwgOiBlcnIsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLmVxdWFsXG49IFRlc3QucHJvdG90eXBlLmVxdWFsc1xuPSBUZXN0LnByb3RvdHlwZS5pc0VxdWFsXG49IFRlc3QucHJvdG90eXBlLmlzXG49IFRlc3QucHJvdG90eXBlLnN0cmljdEVxdWFsXG49IFRlc3QucHJvdG90eXBlLnN0cmljdEVxdWFsc1xuPSBmdW5jdGlvbiAoYSwgYiwgbXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydChhID09PSBiLCB7XG4gICAgICAgIG1lc3NhZ2UgOiBkZWZpbmVkKG1zZywgJ3Nob3VsZCBiZSBlcXVhbCcpLFxuICAgICAgICBvcGVyYXRvciA6ICdlcXVhbCcsXG4gICAgICAgIGFjdHVhbCA6IGEsXG4gICAgICAgIGV4cGVjdGVkIDogYixcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGUubm90RXF1YWxcbj0gVGVzdC5wcm90b3R5cGUubm90RXF1YWxzXG49IFRlc3QucHJvdG90eXBlLm5vdFN0cmljdEVxdWFsXG49IFRlc3QucHJvdG90eXBlLm5vdFN0cmljdEVxdWFsc1xuPSBUZXN0LnByb3RvdHlwZS5pc05vdEVxdWFsXG49IFRlc3QucHJvdG90eXBlLmlzTm90XG49IFRlc3QucHJvdG90eXBlLm5vdFxuPSBUZXN0LnByb3RvdHlwZS5kb2VzTm90RXF1YWxcbj0gVGVzdC5wcm90b3R5cGUuaXNJbmVxdWFsXG49IGZ1bmN0aW9uIChhLCBiLCBtc2csIGV4dHJhKSB7XG4gICAgdGhpcy5fYXNzZXJ0KGEgIT09IGIsIHtcbiAgICAgICAgbWVzc2FnZSA6IGRlZmluZWQobXNnLCAnc2hvdWxkIG5vdCBiZSBlcXVhbCcpLFxuICAgICAgICBvcGVyYXRvciA6ICdub3RFcXVhbCcsXG4gICAgICAgIGFjdHVhbCA6IGEsXG4gICAgICAgIG5vdEV4cGVjdGVkIDogYixcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGUuZGVlcEVxdWFsXG49IFRlc3QucHJvdG90eXBlLmRlZXBFcXVhbHNcbj0gVGVzdC5wcm90b3R5cGUuaXNFcXVpdmFsZW50XG49IFRlc3QucHJvdG90eXBlLnNhbWVcbj0gZnVuY3Rpb24gKGEsIGIsIG1zZywgZXh0cmEpIHtcbiAgICB0aGlzLl9hc3NlcnQoZGVlcEVxdWFsKGEsIGIsIHsgc3RyaWN0OiB0cnVlIH0pLCB7XG4gICAgICAgIG1lc3NhZ2UgOiBkZWZpbmVkKG1zZywgJ3Nob3VsZCBiZSBlcXVpdmFsZW50JyksXG4gICAgICAgIG9wZXJhdG9yIDogJ2RlZXBFcXVhbCcsXG4gICAgICAgIGFjdHVhbCA6IGEsXG4gICAgICAgIGV4cGVjdGVkIDogYixcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGUuZGVlcExvb3NlRXF1YWxcbj0gVGVzdC5wcm90b3R5cGUubG9vc2VFcXVhbFxuPSBUZXN0LnByb3RvdHlwZS5sb29zZUVxdWFsc1xuPSBmdW5jdGlvbiAoYSwgYiwgbXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydChkZWVwRXF1YWwoYSwgYiksIHtcbiAgICAgICAgbWVzc2FnZSA6IGRlZmluZWQobXNnLCAnc2hvdWxkIGJlIGVxdWl2YWxlbnQnKSxcbiAgICAgICAgb3BlcmF0b3IgOiAnZGVlcExvb3NlRXF1YWwnLFxuICAgICAgICBhY3R1YWwgOiBhLFxuICAgICAgICBleHBlY3RlZCA6IGIsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLm5vdERlZXBFcXVhbFxuPSBUZXN0LnByb3RvdHlwZS5ub3RFcXVpdmFsZW50XG49IFRlc3QucHJvdG90eXBlLm5vdERlZXBseVxuPSBUZXN0LnByb3RvdHlwZS5ub3RTYW1lXG49IFRlc3QucHJvdG90eXBlLmlzTm90RGVlcEVxdWFsXG49IFRlc3QucHJvdG90eXBlLmlzTm90RGVlcGx5XG49IFRlc3QucHJvdG90eXBlLmlzTm90RXF1aXZhbGVudFxuPSBUZXN0LnByb3RvdHlwZS5pc0luZXF1aXZhbGVudFxuPSBmdW5jdGlvbiAoYSwgYiwgbXNnLCBleHRyYSkge1xuICAgIHRoaXMuX2Fzc2VydCghZGVlcEVxdWFsKGEsIGIsIHsgc3RyaWN0OiB0cnVlIH0pLCB7XG4gICAgICAgIG1lc3NhZ2UgOiBkZWZpbmVkKG1zZywgJ3Nob3VsZCBub3QgYmUgZXF1aXZhbGVudCcpLFxuICAgICAgICBvcGVyYXRvciA6ICdub3REZWVwRXF1YWwnLFxuICAgICAgICBhY3R1YWwgOiBhLFxuICAgICAgICBub3RFeHBlY3RlZCA6IGIsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cblRlc3QucHJvdG90eXBlLm5vdERlZXBMb29zZUVxdWFsXG49IFRlc3QucHJvdG90eXBlLm5vdExvb3NlRXF1YWxcbj0gVGVzdC5wcm90b3R5cGUubm90TG9vc2VFcXVhbHNcbj0gZnVuY3Rpb24gKGEsIGIsIG1zZywgZXh0cmEpIHtcbiAgICB0aGlzLl9hc3NlcnQoIWRlZXBFcXVhbChhLCBiKSwge1xuICAgICAgICBtZXNzYWdlIDogZGVmaW5lZChtc2csICdzaG91bGQgYmUgZXF1aXZhbGVudCcpLFxuICAgICAgICBvcGVyYXRvciA6ICdub3REZWVwTG9vc2VFcXVhbCcsXG4gICAgICAgIGFjdHVhbCA6IGEsXG4gICAgICAgIGV4cGVjdGVkIDogYixcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGVbJ3Rocm93cyddID0gZnVuY3Rpb24gKGZuLCBleHBlY3RlZCwgbXNnLCBleHRyYSkge1xuICAgIGlmICh0eXBlb2YgZXhwZWN0ZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIG1zZyA9IGV4cGVjdGVkO1xuICAgICAgICBleHBlY3RlZCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB2YXIgY2F1Z2h0ID0gdW5kZWZpbmVkO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgZm4oKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY2F1Z2h0ID0geyBlcnJvciA6IGVyciB9O1xuICAgICAgICB2YXIgbWVzc2FnZSA9IGVyci5tZXNzYWdlO1xuICAgICAgICBkZWxldGUgZXJyLm1lc3NhZ2U7XG4gICAgICAgIGVyci5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB9XG5cbiAgICB2YXIgcGFzc2VkID0gY2F1Z2h0O1xuXG4gICAgaWYgKGV4cGVjdGVkIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICAgIHBhc3NlZCA9IGV4cGVjdGVkLnRlc3QoY2F1Z2h0ICYmIGNhdWdodC5lcnJvcik7XG4gICAgICAgIGV4cGVjdGVkID0gU3RyaW5nKGV4cGVjdGVkKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGV4cGVjdGVkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHBhc3NlZCA9IGNhdWdodC5lcnJvciBpbnN0YW5jZW9mIGV4cGVjdGVkO1xuICAgICAgICBjYXVnaHQuZXJyb3IgPSBjYXVnaHQuZXJyb3IuY29uc3RydWN0b3I7XG4gICAgfVxuXG4gICAgdGhpcy5fYXNzZXJ0KHBhc3NlZCwge1xuICAgICAgICBtZXNzYWdlIDogZGVmaW5lZChtc2csICdzaG91bGQgdGhyb3cnKSxcbiAgICAgICAgb3BlcmF0b3IgOiAndGhyb3dzJyxcbiAgICAgICAgYWN0dWFsIDogY2F1Z2h0ICYmIGNhdWdodC5lcnJvcixcbiAgICAgICAgZXhwZWN0ZWQgOiBleHBlY3RlZCxcbiAgICAgICAgZXJyb3I6ICFwYXNzZWQgJiYgY2F1Z2h0ICYmIGNhdWdodC5lcnJvcixcbiAgICAgICAgZXh0cmEgOiBleHRyYVxuICAgIH0pO1xufTtcblxuVGVzdC5wcm90b3R5cGUuZG9lc05vdFRocm93ID0gZnVuY3Rpb24gKGZuLCBleHBlY3RlZCwgbXNnLCBleHRyYSkge1xuICAgIGlmICh0eXBlb2YgZXhwZWN0ZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIG1zZyA9IGV4cGVjdGVkO1xuICAgICAgICBleHBlY3RlZCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdmFyIGNhdWdodCA9IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgICBmbigpO1xuICAgIH1cbiAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNhdWdodCA9IHsgZXJyb3IgOiBlcnIgfTtcbiAgICB9XG4gICAgdGhpcy5fYXNzZXJ0KCFjYXVnaHQsIHtcbiAgICAgICAgbWVzc2FnZSA6IGRlZmluZWQobXNnLCAnc2hvdWxkIG5vdCB0aHJvdycpLFxuICAgICAgICBvcGVyYXRvciA6ICd0aHJvd3MnLFxuICAgICAgICBhY3R1YWwgOiBjYXVnaHQgJiYgY2F1Z2h0LmVycm9yLFxuICAgICAgICBleHBlY3RlZCA6IGV4cGVjdGVkLFxuICAgICAgICBlcnJvciA6IGNhdWdodCAmJiBjYXVnaHQuZXJyb3IsXG4gICAgICAgIGV4dHJhIDogZXh0cmFcbiAgICB9KTtcbn07XG5cbmZ1bmN0aW9uIGhhcyAob2JqLCBwcm9wKSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuXG5UZXN0LnNraXAgPSBmdW5jdGlvbiAobmFtZV8sIF9vcHRzLCBfY2IpIHtcbiAgICB2YXIgYXJncyA9IGdldFRlc3RBcmdzLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgYXJncy5vcHRzLnNraXAgPSB0cnVlO1xuICAgIHJldHVybiBUZXN0KGFyZ3MubmFtZSwgYXJncy5vcHRzLCBhcmdzLmNiKTtcbn07XG5cbi8vIHZpbTogc2V0IHNvZnR0YWJzdG9wPTQgc2hpZnR3aWR0aD00OlxuXG4iLCJ2YXIgcFNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xudmFyIG9iamVjdEtleXMgPSByZXF1aXJlKCcuL2xpYi9rZXlzLmpzJyk7XG52YXIgaXNBcmd1bWVudHMgPSByZXF1aXJlKCcuL2xpYi9pc19hcmd1bWVudHMuanMnKTtcblxudmFyIGRlZXBFcXVhbCA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpIHtcbiAgaWYgKCFvcHRzKSBvcHRzID0ge307XG4gIC8vIDcuMS4gQWxsIGlkZW50aWNhbCB2YWx1ZXMgYXJlIGVxdWl2YWxlbnQsIGFzIGRldGVybWluZWQgYnkgPT09LlxuICBpZiAoYWN0dWFsID09PSBleHBlY3RlZCkge1xuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSBpZiAoYWN0dWFsIGluc3RhbmNlb2YgRGF0ZSAmJiBleHBlY3RlZCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICByZXR1cm4gYWN0dWFsLmdldFRpbWUoKSA9PT0gZXhwZWN0ZWQuZ2V0VGltZSgpO1xuXG4gIC8vIDcuMy4gT3RoZXIgcGFpcnMgdGhhdCBkbyBub3QgYm90aCBwYXNzIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0JyxcbiAgLy8gZXF1aXZhbGVuY2UgaXMgZGV0ZXJtaW5lZCBieSA9PS5cbiAgfSBlbHNlIGlmICh0eXBlb2YgYWN0dWFsICE9ICdvYmplY3QnICYmIHR5cGVvZiBleHBlY3RlZCAhPSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBvcHRzLnN0cmljdCA/IGFjdHVhbCA9PT0gZXhwZWN0ZWQgOiBhY3R1YWwgPT0gZXhwZWN0ZWQ7XG5cbiAgLy8gNy40LiBGb3IgYWxsIG90aGVyIE9iamVjdCBwYWlycywgaW5jbHVkaW5nIEFycmF5IG9iamVjdHMsIGVxdWl2YWxlbmNlIGlzXG4gIC8vIGRldGVybWluZWQgYnkgaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChhcyB2ZXJpZmllZFxuICAvLyB3aXRoIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCksIHRoZSBzYW1lIHNldCBvZiBrZXlzXG4gIC8vIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLCBlcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnlcbiAgLy8gY29ycmVzcG9uZGluZyBrZXksIGFuZCBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuIE5vdGU6IHRoaXNcbiAgLy8gYWNjb3VudHMgZm9yIGJvdGggbmFtZWQgYW5kIGluZGV4ZWQgcHJvcGVydGllcyBvbiBBcnJheXMuXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG9iakVxdWl2KGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkT3JOdWxsKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0J1ZmZlciAoeCkge1xuICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnIHx8IHR5cGVvZiB4Lmxlbmd0aCAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiB4LmNvcHkgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHguc2xpY2UgIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHgubGVuZ3RoID4gMCAmJiB0eXBlb2YgeFswXSAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIG9iakVxdWl2KGEsIGIsIG9wdHMpIHtcbiAgdmFyIGksIGtleTtcbiAgaWYgKGlzVW5kZWZpbmVkT3JOdWxsKGEpIHx8IGlzVW5kZWZpbmVkT3JOdWxsKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIGRlZXBFcXVhbChhLCBiLCBvcHRzKTtcbiAgfVxuICBpZiAoaXNCdWZmZXIoYSkpIHtcbiAgICBpZiAoIWlzQnVmZmVyKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFbaV0gIT09IGJbaV0pIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYik7XG4gIH0gY2F0Y2ggKGUpIHsvL2hhcHBlbnMgd2hlbiBvbmUgaXMgYSBzdHJpbmcgbGl0ZXJhbCBhbmQgdGhlIG90aGVyIGlzbid0XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8vIGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoa2V5cyBpbmNvcnBvcmF0ZXNcbiAgLy8gaGFzT3duUHJvcGVydHkpXG4gIGlmIChrYS5sZW5ndGggIT0ga2IubGVuZ3RoKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy90aGUgc2FtZSBzZXQgb2Yga2V5cyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSxcbiAga2Euc29ydCgpO1xuICBrYi5zb3J0KCk7XG4gIC8vfn5+Y2hlYXAga2V5IHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBpZiAoa2FbaV0gIT0ga2JbaV0pXG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy9lcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnkgY29ycmVzcG9uZGluZyBrZXksIGFuZFxuICAvL35+fnBvc3NpYmx5IGV4cGVuc2l2ZSBkZWVwIHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBrZXkgPSBrYVtpXTtcbiAgICBpZiAoIWRlZXBFcXVhbChhW2tleV0sIGJba2V5XSwgb3B0cykpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGVvZiBiO1xufVxuIiwidmFyIHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPSAoZnVuY3Rpb24oKXtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChhcmd1bWVudHMpXG59KSgpID09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzdXBwb3J0c0FyZ3VtZW50c0NsYXNzID8gc3VwcG9ydGVkIDogdW5zdXBwb3J0ZWQ7XG5cbmV4cG9ydHMuc3VwcG9ydGVkID0gc3VwcG9ydGVkO1xuZnVuY3Rpb24gc3VwcG9ydGVkKG9iamVjdCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG59O1xuXG5leHBvcnRzLnVuc3VwcG9ydGVkID0gdW5zdXBwb3J0ZWQ7XG5mdW5jdGlvbiB1bnN1cHBvcnRlZChvYmplY3Qpe1xuICByZXR1cm4gb2JqZWN0ICYmXG4gICAgdHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0JyAmJlxuICAgIHR5cGVvZiBvYmplY3QubGVuZ3RoID09ICdudW1iZXInICYmXG4gICAgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpICYmXG4gICAgIU9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmplY3QsICdjYWxsZWUnKSB8fFxuICAgIGZhbHNlO1xufTtcbiIsImV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHR5cGVvZiBPYmplY3Qua2V5cyA9PT0gJ2Z1bmN0aW9uJ1xuICA/IE9iamVjdC5rZXlzIDogc2hpbTtcblxuZXhwb3J0cy5zaGltID0gc2hpbTtcbmZ1bmN0aW9uIHNoaW0gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgcmV0dXJuIGtleXM7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoYXJndW1lbnRzW2ldICE9PSB1bmRlZmluZWQpIHJldHVybiBhcmd1bWVudHNbaV07XG4gICAgfVxufTtcbiIsImlmICh0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAvLyBpbXBsZW1lbnRhdGlvbiBmcm9tIHN0YW5kYXJkIG5vZGUuanMgJ3V0aWwnIG1vZHVsZVxuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgIHZhbHVlOiBjdG9yLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIHZhciBUZW1wQ3RvciA9IGZ1bmN0aW9uICgpIHt9XG4gICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICBjdG9yLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGN0b3JcbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbnNwZWN0XyAob2JqLCBvcHRzLCBkZXB0aCwgc2Vlbikge1xuICAgIGlmICghb3B0cykgb3B0cyA9IHt9O1xuICAgIFxuICAgIHZhciBtYXhEZXB0aCA9IG9wdHMuZGVwdGggPT09IHVuZGVmaW5lZCA/IDUgOiBvcHRzLmRlcHRoO1xuICAgIGlmIChkZXB0aCA9PT0gdW5kZWZpbmVkKSBkZXB0aCA9IDA7XG4gICAgaWYgKGRlcHRoID4gbWF4RGVwdGggJiYgbWF4RGVwdGggPiAwKSByZXR1cm4gJy4uLic7XG4gICAgXG4gICAgaWYgKHNlZW4gPT09IHVuZGVmaW5lZCkgc2VlbiA9IFtdO1xuICAgIGVsc2UgaWYgKGluZGV4T2Yoc2Vlbiwgb2JqKSA+PSAwKSB7XG4gICAgICAgIHJldHVybiAnW0NpcmN1bGFyXSc7XG4gICAgfVxuICAgIFxuICAgIGZ1bmN0aW9uIGluc3BlY3QgKHZhbHVlLCBmcm9tKSB7XG4gICAgICAgIGlmIChmcm9tKSB7XG4gICAgICAgICAgICBzZWVuID0gc2Vlbi5zbGljZSgpO1xuICAgICAgICAgICAgc2Vlbi5wdXNoKGZyb20pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpbnNwZWN0Xyh2YWx1ZSwgb3B0cywgZGVwdGggKyAxLCBzZWVuKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKHR5cGVvZiBvYmogPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiBpbnNwZWN0U3RyaW5nKG9iaik7XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIG5hbWUgPSBuYW1lT2Yob2JqKTtcbiAgICAgICAgcmV0dXJuICdbRnVuY3Rpb24nICsgKG5hbWUgPyAnOiAnICsgbmFtZSA6ICcnKSArICddJztcbiAgICB9XG4gICAgZWxzZSBpZiAob2JqID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiAnbnVsbCc7XG4gICAgfVxuICAgIGVsc2UgaWYgKGlzRWxlbWVudChvYmopKSB7XG4gICAgICAgIHZhciBzID0gJzwnICsgU3RyaW5nKG9iai5ub2RlTmFtZSkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgdmFyIGF0dHJzID0gb2JqLmF0dHJpYnV0ZXMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXR0cnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHMgKz0gJyAnICsgYXR0cnNbaV0ubmFtZSArICc9XCInICsgcXVvdGUoYXR0cnNbaV0udmFsdWUpICsgJ1wiJztcbiAgICAgICAgfVxuICAgICAgICBzICs9ICc+JztcbiAgICAgICAgaWYgKG9iai5jaGlsZE5vZGVzICYmIG9iai5jaGlsZE5vZGVzLmxlbmd0aCkgcyArPSAnLi4uJztcbiAgICAgICAgcyArPSAnPC8nICsgU3RyaW5nKG9iai50YWdOYW1lKS50b0xvd2VyQ2FzZSgpICsgJz4nO1xuICAgICAgICByZXR1cm4gcztcbiAgICB9XG4gICAgZWxzZSBpZiAoaXNBcnJheShvYmopKSB7XG4gICAgICAgIGlmIChvYmoubGVuZ3RoID09PSAwKSByZXR1cm4gJ1tdJztcbiAgICAgICAgdmFyIHhzID0gQXJyYXkob2JqLmxlbmd0aCk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb2JqLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB4c1tpXSA9IGhhcyhvYmosIGkpID8gaW5zcGVjdChvYmpbaV0sIG9iaikgOiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ1sgJyArIHhzLmpvaW4oJywgJykgKyAnIF0nO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2JqLmluc3BlY3QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIG9iai5pbnNwZWN0KCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBvYmogPT09ICdvYmplY3QnICYmICFpc0RhdGUob2JqKSAmJiAhaXNSZWdFeHAob2JqKSkge1xuICAgICAgICB2YXIgeHMgPSBbXSwga2V5cyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICBpZiAoaGFzKG9iaiwga2V5KSkga2V5cy5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAga2V5cy5zb3J0KCk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGtleSA9IGtleXNbaV07XG4gICAgICAgICAgICBpZiAoL1teXFx3JF0vLnRlc3Qoa2V5KSkge1xuICAgICAgICAgICAgICAgIHhzLnB1c2goaW5zcGVjdChrZXkpICsgJzogJyArIGluc3BlY3Qob2JqW2tleV0sIG9iaikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB4cy5wdXNoKGtleSArICc6ICcgKyBpbnNwZWN0KG9ialtrZXldLCBvYmopKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoeHMubGVuZ3RoID09PSAwKSByZXR1cm4gJ3t9JztcbiAgICAgICAgcmV0dXJuICd7ICcgKyB4cy5qb2luKCcsICcpICsgJyB9JztcbiAgICB9XG4gICAgZWxzZSByZXR1cm4gU3RyaW5nKG9iaik7XG59O1xuXG5mdW5jdGlvbiBxdW90ZSAocykge1xuICAgIHJldHVybiBTdHJpbmcocykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xufVxuXG5mdW5jdGlvbiBpc0FycmF5IChvYmopIHtcbiAgICByZXR1cm4ge30udG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xufVxuXG5mdW5jdGlvbiBpc0RhdGUgKG9iaikge1xuICAgIHJldHVybiB7fS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cblxuZnVuY3Rpb24gaXNSZWdFeHAgKG9iaikge1xuICAgIHJldHVybiB7fS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufVxuXG5mdW5jdGlvbiBoYXMgKG9iaiwga2V5KSB7XG4gICAgaWYgKCF7fS5oYXNPd25Qcm9wZXJ0eSkgcmV0dXJuIGtleSBpbiBvYmo7XG4gICAgcmV0dXJuIHt9Lmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpO1xufVxuXG5mdW5jdGlvbiBuYW1lT2YgKGYpIHtcbiAgICBpZiAoZi5uYW1lKSByZXR1cm4gZi5uYW1lO1xuICAgIHZhciBtID0gZi50b1N0cmluZygpLm1hdGNoKC9eZnVuY3Rpb25cXHMqKFtcXHckXSspLyk7XG4gICAgaWYgKG0pIHJldHVybiBtWzFdO1xufVxuXG5mdW5jdGlvbiBpbmRleE9mICh4cywgeCkge1xuICAgIGlmICh4cy5pbmRleE9mKSByZXR1cm4geHMuaW5kZXhPZih4KTtcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHhzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBpZiAoeHNbaV0gPT09IHgpIHJldHVybiBpO1xuICAgIH1cbiAgICByZXR1cm4gLTE7XG59XG5cbmZ1bmN0aW9uIGlzRWxlbWVudCAoeCkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgICBpZiAodHlwZW9mIEhUTUxFbGVtZW50ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICByZXR1cm4geCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50O1xuICAgIH1cbiAgICBlbHNlIHJldHVybiB0eXBlb2YgeC5ub2RlTmFtZSA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgdHlwZW9mIHguZ2V0QXR0cmlidXRlID09PSAnZnVuY3Rpb24nXG4gICAgO1xufVxuXG5mdW5jdGlvbiBpbnNwZWN0U3RyaW5nIChzdHIpIHtcbiAgICB2YXIgcyA9IHN0ci5yZXBsYWNlKC8oWydcXFxcXSkvZywgJ1xcXFwkMScpLnJlcGxhY2UoL1tcXHgwMC1cXHgxZl0vZywgbG93Ynl0ZSk7XG4gICAgcmV0dXJuIFwiJ1wiICsgcyArIFwiJ1wiO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxvd2J5dGUgKGMpIHtcbiAgICAgICAgdmFyIG4gPSBjLmNoYXJDb2RlQXQoMCk7XG4gICAgICAgIHZhciB4ID0geyA4OiAnYicsIDk6ICd0JywgMTA6ICduJywgMTI6ICdmJywgMTM6ICdyJyB9W25dO1xuICAgICAgICBpZiAoeCkgcmV0dXJuICdcXFxcJyArIHg7XG4gICAgICAgIHJldHVybiAnXFxcXHgnICsgKG4gPCAweDEwID8gJzAnIDogJycpICsgbi50b1N0cmluZygxNik7XG4gICAgfVxufVxuIiwidmFyIHRocm91Z2ggPSByZXF1aXJlKCd0aHJvdWdoJyk7XG52YXIgbmV4dFRpY2sgPSB0eXBlb2Ygc2V0SW1tZWRpYXRlICE9PSAndW5kZWZpbmVkJ1xuICAgID8gc2V0SW1tZWRpYXRlXG4gICAgOiBwcm9jZXNzLm5leHRUaWNrXG47XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHdyaXRlLCBlbmQpIHtcbiAgICB2YXIgdHIgPSB0aHJvdWdoKHdyaXRlLCBlbmQpO1xuICAgIHRyLnBhdXNlKCk7XG4gICAgdmFyIHJlc3VtZSA9IHRyLnJlc3VtZTtcbiAgICB2YXIgcGF1c2UgPSB0ci5wYXVzZTtcbiAgICB2YXIgcGF1c2VkID0gZmFsc2U7XG4gICAgXG4gICAgdHIucGF1c2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHBhdXNlZCA9IHRydWU7XG4gICAgICAgIHJldHVybiBwYXVzZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gICAgXG4gICAgdHIucmVzdW1lID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBwYXVzZWQgPSBmYWxzZTtcbiAgICAgICAgcmV0dXJuIHJlc3VtZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gICAgXG4gICAgbmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXBhdXNlZCkgdHIucmVzdW1lKCk7XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRyO1xufTtcbiIsInZhciBTdHJlYW0gPSByZXF1aXJlKCdzdHJlYW0nKVxuXG4vLyB0aHJvdWdoXG4vL1xuLy8gYSBzdHJlYW0gdGhhdCBkb2VzIG5vdGhpbmcgYnV0IHJlLWVtaXQgdGhlIGlucHV0LlxuLy8gdXNlZnVsIGZvciBhZ2dyZWdhdGluZyBhIHNlcmllcyBvZiBjaGFuZ2luZyBidXQgbm90IGVuZGluZyBzdHJlYW1zIGludG8gb25lIHN0cmVhbSlcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdGhyb3VnaFxudGhyb3VnaC50aHJvdWdoID0gdGhyb3VnaFxuXG4vL2NyZWF0ZSBhIHJlYWRhYmxlIHdyaXRhYmxlIHN0cmVhbS5cblxuZnVuY3Rpb24gdGhyb3VnaCAod3JpdGUsIGVuZCwgb3B0cykge1xuICB3cml0ZSA9IHdyaXRlIHx8IGZ1bmN0aW9uIChkYXRhKSB7IHRoaXMucXVldWUoZGF0YSkgfVxuICBlbmQgPSBlbmQgfHwgZnVuY3Rpb24gKCkgeyB0aGlzLnF1ZXVlKG51bGwpIH1cblxuICB2YXIgZW5kZWQgPSBmYWxzZSwgZGVzdHJveWVkID0gZmFsc2UsIGJ1ZmZlciA9IFtdLCBfZW5kZWQgPSBmYWxzZVxuICB2YXIgc3RyZWFtID0gbmV3IFN0cmVhbSgpXG4gIHN0cmVhbS5yZWFkYWJsZSA9IHN0cmVhbS53cml0YWJsZSA9IHRydWVcbiAgc3RyZWFtLnBhdXNlZCA9IGZhbHNlXG5cbi8vICBzdHJlYW0uYXV0b1BhdXNlICAgPSAhKG9wdHMgJiYgb3B0cy5hdXRvUGF1c2UgICA9PT0gZmFsc2UpXG4gIHN0cmVhbS5hdXRvRGVzdHJveSA9ICEob3B0cyAmJiBvcHRzLmF1dG9EZXN0cm95ID09PSBmYWxzZSlcblxuICBzdHJlYW0ud3JpdGUgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgIHdyaXRlLmNhbGwodGhpcywgZGF0YSlcbiAgICByZXR1cm4gIXN0cmVhbS5wYXVzZWRcbiAgfVxuXG4gIGZ1bmN0aW9uIGRyYWluKCkge1xuICAgIHdoaWxlKGJ1ZmZlci5sZW5ndGggJiYgIXN0cmVhbS5wYXVzZWQpIHtcbiAgICAgIHZhciBkYXRhID0gYnVmZmVyLnNoaWZ0KClcbiAgICAgIGlmKG51bGwgPT09IGRhdGEpXG4gICAgICAgIHJldHVybiBzdHJlYW0uZW1pdCgnZW5kJylcbiAgICAgIGVsc2VcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2RhdGEnLCBkYXRhKVxuICAgIH1cbiAgfVxuXG4gIHN0cmVhbS5xdWV1ZSA9IHN0cmVhbS5wdXNoID0gZnVuY3Rpb24gKGRhdGEpIHtcbi8vICAgIGNvbnNvbGUuZXJyb3IoZW5kZWQpXG4gICAgaWYoX2VuZGVkKSByZXR1cm4gc3RyZWFtXG4gICAgaWYoZGF0YSA9PT0gbnVsbCkgX2VuZGVkID0gdHJ1ZVxuICAgIGJ1ZmZlci5wdXNoKGRhdGEpXG4gICAgZHJhaW4oKVxuICAgIHJldHVybiBzdHJlYW1cbiAgfVxuXG4gIC8vdGhpcyB3aWxsIGJlIHJlZ2lzdGVyZWQgYXMgdGhlIGZpcnN0ICdlbmQnIGxpc3RlbmVyXG4gIC8vbXVzdCBjYWxsIGRlc3Ryb3kgbmV4dCB0aWNrLCB0byBtYWtlIHN1cmUgd2UncmUgYWZ0ZXIgYW55XG4gIC8vc3RyZWFtIHBpcGVkIGZyb20gaGVyZS5cbiAgLy90aGlzIGlzIG9ubHkgYSBwcm9ibGVtIGlmIGVuZCBpcyBub3QgZW1pdHRlZCBzeW5jaHJvbm91c2x5LlxuICAvL2EgbmljZXIgd2F5IHRvIGRvIHRoaXMgaXMgdG8gbWFrZSBzdXJlIHRoaXMgaXMgdGhlIGxhc3QgbGlzdGVuZXIgZm9yICdlbmQnXG5cbiAgc3RyZWFtLm9uKCdlbmQnLCBmdW5jdGlvbiAoKSB7XG4gICAgc3RyZWFtLnJlYWRhYmxlID0gZmFsc2VcbiAgICBpZighc3RyZWFtLndyaXRhYmxlICYmIHN0cmVhbS5hdXRvRGVzdHJveSlcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBzdHJlYW0uZGVzdHJveSgpXG4gICAgICB9KVxuICB9KVxuXG4gIGZ1bmN0aW9uIF9lbmQgKCkge1xuICAgIHN0cmVhbS53cml0YWJsZSA9IGZhbHNlXG4gICAgZW5kLmNhbGwoc3RyZWFtKVxuICAgIGlmKCFzdHJlYW0ucmVhZGFibGUgJiYgc3RyZWFtLmF1dG9EZXN0cm95KVxuICAgICAgc3RyZWFtLmRlc3Ryb3koKVxuICB9XG5cbiAgc3RyZWFtLmVuZCA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgaWYoZW5kZWQpIHJldHVyblxuICAgIGVuZGVkID0gdHJ1ZVxuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGgpIHN0cmVhbS53cml0ZShkYXRhKVxuICAgIF9lbmQoKSAvLyB3aWxsIGVtaXQgb3IgcXVldWVcbiAgICByZXR1cm4gc3RyZWFtXG4gIH1cblxuICBzdHJlYW0uZGVzdHJveSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZihkZXN0cm95ZWQpIHJldHVyblxuICAgIGRlc3Ryb3llZCA9IHRydWVcbiAgICBlbmRlZCA9IHRydWVcbiAgICBidWZmZXIubGVuZ3RoID0gMFxuICAgIHN0cmVhbS53cml0YWJsZSA9IHN0cmVhbS5yZWFkYWJsZSA9IGZhbHNlXG4gICAgc3RyZWFtLmVtaXQoJ2Nsb3NlJylcbiAgICByZXR1cm4gc3RyZWFtXG4gIH1cblxuICBzdHJlYW0ucGF1c2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYoc3RyZWFtLnBhdXNlZCkgcmV0dXJuXG4gICAgc3RyZWFtLnBhdXNlZCA9IHRydWVcbiAgICByZXR1cm4gc3RyZWFtXG4gIH1cblxuICBzdHJlYW0ucmVzdW1lID0gZnVuY3Rpb24gKCkge1xuICAgIGlmKHN0cmVhbS5wYXVzZWQpIHtcbiAgICAgIHN0cmVhbS5wYXVzZWQgPSBmYWxzZVxuICAgICAgc3RyZWFtLmVtaXQoJ3Jlc3VtZScpXG4gICAgfVxuICAgIGRyYWluKClcbiAgICAvL21heSBoYXZlIGJlY29tZSBwYXVzZWQgYWdhaW4sXG4gICAgLy9hcyBkcmFpbiBlbWl0cyAnZGF0YScuXG4gICAgaWYoIXN0cmVhbS5wYXVzZWQpXG4gICAgICBzdHJlYW0uZW1pdCgnZHJhaW4nKVxuICAgIHJldHVybiBzdHJlYW1cbiAgfVxuICByZXR1cm4gc3RyZWFtXG59XG5cbiIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG5mdW5jdGlvbiBrZXlzQXJlRGlmZmVyZW50KGtleXMxLCBrZXlzMil7XG4gICAgaWYoa2V5czEgPT09IGtleXMyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZigha2V5czEgfHwgIWtleXMyIHx8IGtleXMxLmxlbmd0aCAhPT0ga2V5czIubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzMS5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKCF+a2V5czIuaW5kZXhPZihrZXlzMVtpXSkpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSl7XG4gICAgICAgIHJlc3VsdC50eXBlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ2tleXMnIGluIGNoYW5nZXNUb1RyYWNrICYmIGtleXNBcmVEaWZmZXJlbnQodGhpcy5fbGFzdEtleXMsIGdldEtleXModmFsdWUpKSl7XG4gICAgICAgIHJlc3VsdC5rZXlzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKXtcbiAgICAgICAgdmFyIGxhc3RWYWx1ZSA9IHRoaXMuX2xhc3RWYWx1ZTtcblxuICAgICAgICBpZignc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgKCFsYXN0VmFsdWUgfHwgdHlwZW9mIGxhc3RWYWx1ZSAhPT0gJ29iamVjdCcgfHwgT2JqZWN0LmtleXModmFsdWUpLnNvbWUoZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWVba2V5W2luZGV4XV0gIT09IGxhc3RWYWx1ZVtrZXlbaW5kZXhdXTtcbiAgICAgICAgfSkpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zaGFsbG93U3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZignc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiAhZGVlcEVxdWFsKHZhbHVlLCBsYXN0VmFsdWUpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdyZWZlcmVuY2UnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKXtcbiAgICAgICAgICAgIHJlc3VsdC5yZWZlcmVuY2UgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbGFzdFZhbHVlID0gJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSkgOiAnc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSwgdHJ1ZSwgMSk6IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RSZWZlcmVuY2UgPSB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0S2V5cyA9IG5ld0tleXM7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaGF0Q2hhbmdlZDsiLCJ2YXIgY2xvbmUgPSAoZnVuY3Rpb24oKSB7XG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQ2xvbmVzIChjb3BpZXMpIGFuIE9iamVjdCB1c2luZyBkZWVwIGNvcHlpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBzdXBwb3J0cyBjaXJjdWxhciByZWZlcmVuY2VzIGJ5IGRlZmF1bHQsIGJ1dCBpZiB5b3UgYXJlIGNlcnRhaW5cbiAqIHRoZXJlIGFyZSBubyBjaXJjdWxhciByZWZlcmVuY2VzIGluIHlvdXIgb2JqZWN0LCB5b3UgY2FuIHNhdmUgc29tZSBDUFUgdGltZVxuICogYnkgY2FsbGluZyBjbG9uZShvYmosIGZhbHNlKS5cbiAqXG4gKiBDYXV0aW9uOiBpZiBgY2lyY3VsYXJgIGlzIGZhbHNlIGFuZCBgcGFyZW50YCBjb250YWlucyBjaXJjdWxhciByZWZlcmVuY2VzLFxuICogeW91ciBwcm9ncmFtIG1heSBlbnRlciBhbiBpbmZpbml0ZSBsb29wIGFuZCBjcmFzaC5cbiAqXG4gKiBAcGFyYW0gYHBhcmVudGAgLSB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZFxuICogQHBhcmFtIGBjaXJjdWxhcmAgLSBzZXQgdG8gdHJ1ZSBpZiB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZCBtYXkgY29udGFpblxuICogICAgY2lyY3VsYXIgcmVmZXJlbmNlcy4gKG9wdGlvbmFsIC0gdHJ1ZSBieSBkZWZhdWx0KVxuICogQHBhcmFtIGBkZXB0aGAgLSBzZXQgdG8gYSBudW1iZXIgaWYgdGhlIG9iamVjdCBpcyBvbmx5IHRvIGJlIGNsb25lZCB0b1xuICogICAgYSBwYXJ0aWN1bGFyIGRlcHRoLiAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBJbmZpbml0eSlcbiAqIEBwYXJhbSBgcHJvdG90eXBlYCAtIHNldHMgdGhlIHByb3RvdHlwZSB0byBiZSB1c2VkIHdoZW4gY2xvbmluZyBhbiBvYmplY3QuXG4gKiAgICAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBwYXJlbnQgcHJvdG90eXBlKS5cbiovXG5mdW5jdGlvbiBjbG9uZShwYXJlbnQsIGNpcmN1bGFyLCBkZXB0aCwgcHJvdG90eXBlKSB7XG4gIHZhciBmaWx0ZXI7XG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT09ICdvYmplY3QnKSB7XG4gICAgZGVwdGggPSBjaXJjdWxhci5kZXB0aDtcbiAgICBwcm90b3R5cGUgPSBjaXJjdWxhci5wcm90b3R5cGU7XG4gICAgZmlsdGVyID0gY2lyY3VsYXIuZmlsdGVyO1xuICAgIGNpcmN1bGFyID0gY2lyY3VsYXIuY2lyY3VsYXJcbiAgfVxuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAoY2xvbmUuX19pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCBfX2dldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbiBjbG9uZVByb3RvdHlwZShwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG4vLyBwcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG5cbmZ1bmN0aW9uIF9fb2JqVG9TdHIobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufTtcbmNsb25lLl9fb2JqVG9TdHIgPSBfX29ialRvU3RyO1xuXG5mdW5jdGlvbiBfX2lzRGF0ZShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgRGF0ZV0nO1xufTtcbmNsb25lLl9faXNEYXRlID0gX19pc0RhdGU7XG5cbmZ1bmN0aW9uIF9faXNBcnJheShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5jbG9uZS5fX2lzQXJyYXkgPSBfX2lzQXJyYXk7XG5cbmZ1bmN0aW9uIF9faXNSZWdFeHAobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufTtcbmNsb25lLl9faXNSZWdFeHAgPSBfX2lzUmVnRXhwO1xuXG5mdW5jdGlvbiBfX2dldFJlZ0V4cEZsYWdzKHJlKSB7XG4gIHZhciBmbGFncyA9ICcnO1xuICBpZiAocmUuZ2xvYmFsKSBmbGFncyArPSAnZyc7XG4gIGlmIChyZS5pZ25vcmVDYXNlKSBmbGFncyArPSAnaSc7XG4gIGlmIChyZS5tdWx0aWxpbmUpIGZsYWdzICs9ICdtJztcbiAgcmV0dXJuIGZsYWdzO1xufTtcbmNsb25lLl9fZ2V0UmVnRXhwRmxhZ3MgPSBfX2dldFJlZ0V4cEZsYWdzO1xuXG5yZXR1cm4gY2xvbmU7XG59KSgpO1xuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIFdoYXRDaGFuZ2VkID0gcmVxdWlyZSgnd2hhdC1jaGFuZ2VkJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBjcmVhdGVCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyksXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlciA9IHJlcXVpcmUoJy4vbWFrZUZ1bmN0aW9uRW1pdHRlcicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZVByb3BlcnR5KGN1cnJlbnRWYWx1ZSwgY2hhbmdlcyl7XG4gICAgdmFyIGJpbmRpbmcsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBhdHRhY2hpbmcsXG4gICAgICAgIHByZXZpb3VzID0gbmV3IFdoYXRDaGFuZ2VkKGN1cnJlbnRWYWx1ZSwgY2hhbmdlcyB8fCAndmFsdWUgdHlwZSByZWZlcmVuY2Uga2V5cycpO1xuXG4gICAgZnVuY3Rpb24gcHJvcGVydHkodmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZyAmJiBiaW5kaW5nKCkgfHwgcHJvcGVydHkuX3ZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXR0YWNoaW5nKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFPYmplY3Qua2V5cyhwcmV2aW91cy51cGRhdGUodmFsdWUpKS5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIXByb3BlcnR5Ll9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcHJvcGVydHkuX3ZhbHVlID0gdmFsdWU7XG5cbiAgICAgICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgICAgIGJpbmRpbmcodmFsdWUpO1xuICAgICAgICAgICAgICAgIHByb3BlcnR5Ll92YWx1ZSA9IGJpbmRpbmcoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnY2hhbmdlJywgcHJvcGVydHkuX3ZhbHVlKTtcbiAgICAgICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH1cblxuICAgIHByb3BlcnR5Ll92YWx1ZSA9IGN1cnJlbnRWYWx1ZTtcblxuICAgIHByb3BlcnR5Ll9maXJtID0gMTtcblxuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIocHJvcGVydHkpO1xuXG4gICAgcHJvcGVydHkuYmluZGluZyA9IGZ1bmN0aW9uKG5ld0JpbmRpbmcpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFpcy5iaW5kaW5nKG5ld0JpbmRpbmcpKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKG5ld0JpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobmV3QmluZGluZyA9PT0gYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHByb3BlcnR5KTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nID0gbmV3QmluZGluZztcbiAgICAgICAgaWYobW9kZWwpe1xuICAgICAgICAgICAgcHJvcGVydHkuYXR0YWNoKG1vZGVsLCBwcm9wZXJ0eS5fZmlybSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcbiAgICAgICAgaWYoZmlybWVyKHByb3BlcnR5LCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBwcm9wZXJ0eS5fZmlybSA9IGZpcm07XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBtb2RlbCA9IG9iamVjdDtcbiAgICAgICAgICAgIGF0dGFjaGluZyA9IHRydWU7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICAgICAgYXR0YWNoaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBwcm9wZXJ0eShiaW5kaW5nKCkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBpZihmaXJtZXIocHJvcGVydHksIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICAgICAgYmluZGluZy5kZXRhY2goMSk7XG4gICAgICAgICAgICBtb2RlbCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcHJvcGVydHkudXBkYXRlKCk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LnVwZGF0ZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmVtaXQoJ3VwZGF0ZScsIHByb3BlcnR5Ll92YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5Ll9kZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICAgICAgcHJvcGVydHkuZGV0YWNoKCk7XG4gICAgICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nLmRlc3Ryb3kodHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYWRkVG8gPSBmdW5jdGlvbihjb21wb25lbnQsIGtleSl7XG4gICAgICAgIGNvbXBvbmVudFtrZXldID0gcHJvcGVydHk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxuICAgIGdlbmVyaWNDb21wb25lbnQgPSByZXF1aXJlKCcuL2dlbmVyaWNDb21wb25lbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgdGVtcGxhdGVyID0gbmV3IEV2ZW50RW1pdHRlcigpLFxuICAgICAgICBsYXN0VmFsdWUgPSB7fSxcbiAgICAgICAgaXRlbU1vZGVsID0gbmV3IEVudGkoe30pO1xuXG4gICAgZnVuY3Rpb24gcmVwbGFjZUVsZW1lbnQoZWxlbWVudCl7XG4gICAgICAgIGlmKHRlbXBsYXRlci5lbGVtZW50ICYmIHRlbXBsYXRlci5lbGVtZW50LnBhcmVudE5vZGUpe1xuICAgICAgICAgICAgdGVtcGxhdGVyLmVsZW1lbnQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQoZWxlbWVudCwgdGVtcGxhdGVyLmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgICAgIHRlbXBsYXRlci5lbGVtZW50ID0gZWxlbWVudDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUoKXtcbiAgICAgICAgdmFyIHZhbHVlID0gdGVtcGxhdGVyLmRhdGEoKSxcbiAgICAgICAgICAgIHRlbXBsYXRlID0gdGVtcGxhdGVyLl9zZXR0aW5ncy50ZW1wbGF0ZTtcblxuICAgICAgICBpZighdGVtcGxhdGUpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdFZhbHVlID0gdmFsdWU7XG5cbiAgICAgICAgaWYodGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50KXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KHRlbXBsYXRlci5fY3VycmVudENvbXBvbmVudCkpe1xuICAgICAgICAgICAgICAgIHRlbXBsYXRlci5fY3VycmVudENvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaXRlbU1vZGVsLnNldCgnaXRlbScsIHZhbHVlKTtcblxuICAgICAgICB0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQgPSBmYXN0bi50b0NvbXBvbmVudCh0ZW1wbGF0ZShpdGVtTW9kZWwsIHRlbXBsYXRlci5zY29wZSgpLCB0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQpKTtcblxuICAgICAgICBpZighdGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50KXtcbiAgICAgICAgICAgIHJlcGxhY2VFbGVtZW50KGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudCh0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQpKXtcbiAgICAgICAgICAgIGlmKHRlbXBsYXRlci5fc2V0dGluZ3MuYXR0YWNoVGVtcGxhdGVzICE9PSBmYWxzZSl7XG4gICAgICAgICAgICAgICAgdGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50LmF0dGFjaChpdGVtTW9kZWwsIDIpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50LmF0dGFjaCh0ZW1wbGF0ZXIuc2NvcGUoKSwgMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHRlbXBsYXRlci5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICB0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQucmVuZGVyKCk7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUVsZW1lbnQodGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50LmVsZW1lbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGVtcGxhdGVyLnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBlbGVtZW50O1xuICAgICAgICBpZih0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQpe1xuICAgICAgICAgICAgdGVtcGxhdGVyLl9jdXJyZW50Q29tcG9uZW50LnJlbmRlcigpO1xuICAgICAgICAgICAgZWxlbWVudCA9IHRlbXBsYXRlci5fY3VycmVudENvbXBvbmVudC5lbGVtZW50O1xuICAgICAgICB9XG4gICAgICAgIHRlbXBsYXRlci5lbGVtZW50ID0gZWxlbWVudCB8fCBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICAgIHRlbXBsYXRlci5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuXG4gICAgZmFzdG4ucHJvcGVydHkodW5kZWZpbmVkLCBzZXR0aW5ncy5kYXRhQ2hhbmdlcyB8fCAndmFsdWUgc3RydWN0dXJlJylcbiAgICAgICAgLmFkZFRvKHRlbXBsYXRlciwgJ2RhdGEnKVxuICAgICAgICAuYmluZGluZyhzZXR0aW5ncy5kYXRhKVxuICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZSk7XG5cbiAgICB0ZW1wbGF0ZXIub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudCh0ZW1wbGF0ZXIuX2N1cnJlbnRDb21wb25lbnQpKXtcbiAgICAgICAgICAgIHRlbXBsYXRlci5fY3VycmVudENvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB0ZW1wbGF0ZXI7XG59OyIsInZhciB0ZXN0ID0gcmVxdWlyZSgndGFwZScpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgZG9jID0gcmVxdWlyZSgnZG9jLWpzJyksXG4gICAgY3JlYXRlRmFzdG4gPSByZXF1aXJlKCcuL2NyZWF0ZUZhc3RuJyk7XG5cbnRlc3QoJ21hbnVhbCBhdHRhY2gnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigzKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgY2hpbGQsXG4gICAgICAgIHBhcmVudCA9IGZhc3RuKCdkaXYnLFxuICAgICAgICAgICAgY2hpbGQgPSBmYXN0bignc3BhbicpXG4gICAgICAgICk7XG5cbiAgICBwYXJlbnQuYXR0YWNoKHtcbiAgICAgICAgZm9vOidiYXInXG4gICAgfSk7XG5cbiAgICB0LmRlZXBFcXVhbChwYXJlbnQuc2NvcGUoKS5nZXQoJy4nKSwge1xuICAgICAgICBmb286J2JhcidcbiAgICB9KTtcblxuICAgIHQuZGVlcEVxdWFsKGNoaWxkLnNjb3BlKCkuZ2V0KCcuJyksIHtcbiAgICAgICAgZm9vOidiYXInXG4gICAgfSk7XG5cbiAgICB0LmVxdWFsKHBhcmVudC5zY29wZSgpLmdldCgnLicpLCBjaGlsZC5zY29wZSgpLmdldCgnLicpKTtcblxufSk7XG5cbnRlc3QoJ3dlYWsgYXR0YWNoIGF0dGVtcHQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigzKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgY2hpbGQsXG4gICAgICAgIHBhcmVudCA9IGZhc3RuKCdkaXYnLFxuICAgICAgICAgICAgY2hpbGQgPSBmYXN0bignc3BhbicpXG4gICAgICAgICk7XG5cbiAgICBwYXJlbnQuYXR0YWNoKHtcbiAgICAgICAgZm9vOidiYXInXG4gICAgfSk7XG5cbiAgICBjaGlsZC5hdHRhY2goe1xuICAgICAgICBiYXo6ICdpbmdhJ1xuICAgIH0sIDApO1xuXG4gICAgdC5kZWVwRXF1YWwocGFyZW50LnNjb3BlKCkuZ2V0KCcuJyksIHtcbiAgICAgICAgZm9vOidiYXInXG4gICAgfSk7XG5cbiAgICB0LmRlZXBFcXVhbChjaGlsZC5zY29wZSgpLmdldCgnLicpLCB7XG4gICAgICAgIGZvbzonYmFyJ1xuICAgIH0pO1xuXG4gICAgdC5lcXVhbChwYXJlbnQuc2NvcGUoKS5nZXQoJy4nKSwgY2hpbGQuc2NvcGUoKS5nZXQoJy4nKSk7XG59KTtcblxudGVzdCgnZmlybWVyIGF0dGFjaCBhdHRlbXB0JywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oMyk7XG5cbiAgICB2YXIgZmFzdG4gPSBjcmVhdGVGYXN0bigpO1xuXG4gICAgdmFyIGNoaWxkLFxuICAgICAgICBwYXJlbnQgPSBmYXN0bignZGl2JyxcbiAgICAgICAgICAgIGNoaWxkID0gZmFzdG4oJ3NwYW4nKVxuICAgICAgICApO1xuXG4gICAgcGFyZW50LmF0dGFjaCh7XG4gICAgICAgIGZvbzonYmFyJ1xuICAgIH0pO1xuXG4gICAgY2hpbGQuYXR0YWNoKHtcbiAgICAgICAgYmF6OiAnaW5nYSdcbiAgICB9LCAxKTtcblxuICAgIHQuZGVlcEVxdWFsKHBhcmVudC5zY29wZSgpLmdldCgnLicpLCB7XG4gICAgICAgIGZvbzonYmFyJ1xuICAgIH0pO1xuXG4gICAgdC5kZWVwRXF1YWwoY2hpbGQuc2NvcGUoKS5nZXQoJy4nKSwge1xuICAgICAgICBiYXo6J2luZ2EnXG4gICAgfSk7XG5cbiAgICB0Lm5vdEVxdWFsKHBhcmVudC5zY29wZSgpLmdldCgnLicpLCBjaGlsZC5zY29wZSgpLmdldCgnLicpKTtcbn0pO1xuXG50ZXN0KCdmaXJtZXN0IGF0dGFjaCcsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDMpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciBjaGlsZCxcbiAgICAgICAgcGFyZW50ID0gZmFzdG4oJ2RpdicsXG4gICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCdzcGFuJylcbiAgICAgICAgKTtcblxuICAgIHBhcmVudC5hdHRhY2goe1xuICAgICAgICBmb286J2JhcidcbiAgICB9KTtcblxuICAgIGNoaWxkLmF0dGFjaCh7XG4gICAgICAgIGJhejogJ2luZ2EnXG4gICAgfSk7XG5cbiAgICB0LmRlZXBFcXVhbChwYXJlbnQuc2NvcGUoKS5nZXQoJy4nKSwge1xuICAgICAgICBmb286J2JhcidcbiAgICB9KTtcblxuICAgIHQuZGVlcEVxdWFsKGNoaWxkLnNjb3BlKCkuZ2V0KCcuJyksIHtcbiAgICAgICAgYmF6OidpbmdhJ1xuICAgIH0pO1xuXG4gICAgdC5ub3RFcXVhbChwYXJlbnQuc2NvcGUoKS5nZXQoJy4nKSwgY2hpbGQuc2NvcGUoKS5nZXQoJy4nKSk7XG59KTtcbiIsInZhciB0ZXN0ID0gcmVxdWlyZSgndGFwZScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuLi9iaW5kaW5nJyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKTtcblxudGVzdCgnc2ltcGxlIGJpbmRpbmcgaW5pdGlhbGlzYXRpb24nLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMyk7XG5cbiAgICB2YXIgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2ZvbycpO1xuXG4gICAgdmFyIG1vZGVsID0ge30sXG4gICAgICAgIGVudGkgPSBuZXcgRW50aShtb2RlbCk7XG5cbiAgICB0LmVxdWFsKGJpbmRpbmcoKSwgdW5kZWZpbmVkKTtcblxuICAgIGVudGkuc2V0KCdmb28nLCAnYmFyJyk7XG5cbiAgICB0LmVxdWFsKGJpbmRpbmcoKSwgdW5kZWZpbmVkKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKG1vZGVsKTtcblxuICAgIHQuZXF1YWwoYmluZGluZygpLCAnYmFyJyk7XG59KTtcblxudGVzdCgnc2ltcGxlIGJpbmRpbmcgc2V0JywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCdmb28nKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKHt9KTtcblxuICAgIHQuZXF1YWwoYmluZGluZygpLCB1bmRlZmluZWQpO1xuXG4gICAgYmluZGluZygnYmF6aW5nYScpO1xuXG4gICAgdC5lcXVhbChiaW5kaW5nKCksICdiYXppbmdhJyk7XG59KTtcblxudGVzdCgnc2ltcGxlIGJpbmRpbmcgZXZlbnQnLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMyk7XG5cbiAgICB2YXIgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2ZvbycpO1xuXG4gICAgdmFyIG1vZGVsID0ge30sXG4gICAgICAgIGVudGkgPSBuZXcgRW50aShtb2RlbCk7XG5cbiAgICBiaW5kaW5nLmF0dGFjaChtb2RlbCk7XG5cbiAgICBiaW5kaW5nLm9uY2UoJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5lcXVhbCh2YWx1ZSwgJ2JhcicpO1xuICAgICAgICB0LmVxdWFsKGJpbmRpbmcoKSwgJ2JhcicpO1xuICAgIH0pO1xuXG4gICAgZW50aS5zZXQoJ2ZvbycsICdiYXInKTtcblxuICAgIGJpbmRpbmcub25jZSgnZGV0YWNoJywgZnVuY3Rpb24oKXtcbiAgICAgICAgdC5lcXVhbChiaW5kaW5nKCksIHVuZGVmaW5lZCk7XG4gICAgfSk7XG5cbiAgICBiaW5kaW5nLmRldGFjaCgpO1xuXG4gICAgZW50aS5zZXQoJ2ZvbycsICdiYXonKTtcbn0pO1xuXG50ZXN0KCdubyBtb2RlbCcsIGZ1bmN0aW9uKHQpe1xuICAgIHQucGxhbigzKTtcblxuICAgIHZhciBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vJyk7XG5cbiAgICB0LmVxdWFsKGJpbmRpbmcoKSwgdW5kZWZpbmVkKTtcblxuICAgIGJpbmRpbmcub24oJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5lcXVhbCh2YWx1ZSwgJ2JhcicpO1xuICAgIH0pO1xuXG4gICAgYmluZGluZygnYmFyJyk7XG5cbiAgICB0LmVxdWFsKGJpbmRpbmcoKSwgJ2JhcicpO1xufSk7XG5cbnRlc3QoJ2RyaWxsIGdldCcsIGZ1bmN0aW9uKHQpe1xuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZm9vOiB7XG4gICAgICAgICAgICAgICAgYmFyOiAxMjNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aShkYXRhKSxcbiAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2Zvby5iYXInKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKGRhdGEpO1xuXG4gICAgdC5lcXVhbChiaW5kaW5nKCksIDEyMyk7XG5cbiAgICBtb2RlbC5zZXQoJ2ZvbycsIHtcbiAgICAgICAgYmFyOiA0NTZcbiAgICB9KTtcblxuICAgIHQuZXF1YWwoYmluZGluZygpLCA0NTYpO1xufSk7XG5cbnRlc3QoJ2RyaWxsIGNoYW5nZScsIGZ1bmN0aW9uKHQpe1xuICAgIHQucGxhbigxKTtcblxuICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZm9vOiB7XG4gICAgICAgICAgICAgICAgYmFyOiAxMjNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aShkYXRhKSxcbiAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2Zvby5iYXInKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKGRhdGEpO1xuXG4gICAgYmluZGluZy5vbignY2hhbmdlJywgZnVuY3Rpb24oKXtcbiAgICAgICAgdC5wYXNzKCd0YXJnZXQgY2hhbmdlZCcpO1xuICAgIH0pO1xuXG4gICAgbW9kZWwuc2V0KCdmb28nLCB7XG4gICAgICAgIGJhcjogNDU2XG4gICAgfSk7XG59KTtcblxudGVzdCgnZHJpbGwgYXR0YWNoJywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBmb286IHtcbiAgICAgICAgICAgICAgICBiYXI6IDEyM1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKGRhdGEpLFxuICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vLmJhcicpO1xuXG5cbiAgICBiaW5kaW5nLm9uY2UoJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5lcXVhbCh2YWx1ZSwgMTIzKTtcbiAgICB9KTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKGRhdGEpO1xuXG4gICAgYmluZGluZy5vbmNlKCdjaGFuZ2UnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIHQuZXF1YWwodmFsdWUsIDQ1Nik7XG4gICAgfSk7XG5cbiAgICBtb2RlbC5zZXQoJ2ZvbycsIHtcbiAgICAgICAgYmFyOiA0NTZcbiAgICB9KTtcbn0pO1xuXG50ZXN0KCdkcmlsbCBzZXQnLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMSk7XG5cbiAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGZvbzoge1xuICAgICAgICAgICAgICAgIGJhcjogMTIzXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoZGF0YSksXG4gICAgICAgIGZvb01vZGVsID0gbmV3IEVudGkoZGF0YS5mb28pLFxuICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vLmJhcicpO1xuXG5cbiAgICBmb29Nb2RlbC5vbignYmFyJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0LmVxdWFsKHZhbHVlLCA0NTYpO1xuICAgIH0pO1xuXG4gICAgYmluZGluZy5hdHRhY2goZGF0YSk7XG5cbiAgICBiaW5kaW5nKDQ1Nik7XG59KTtcblxudGVzdCgnZHJpbGwgbXVsdGlwbGUnLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMyk7XG5cbiAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGZvbzoge1xuICAgICAgICAgICAgICAgIGJhcjogMTIzXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoZGF0YSksXG4gICAgICAgIGZvb01vZGVsID0gbmV3IEVudGkoZGF0YS5mb28pLFxuICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vLmJhcicpO1xuXG5cbiAgICBmb29Nb2RlbC5vbmNlKCdiYXInLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIHQuZXF1YWwodmFsdWUsIDQ1Nik7XG4gICAgfSk7XG5cbiAgICBiaW5kaW5nLmF0dGFjaChkYXRhKTtcblxuICAgIGJpbmRpbmcoNDU2KTtcblxuICAgIGJpbmRpbmcub25jZSgnY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0LmVxdWFsKHZhbHVlLCA3ODkpO1xuICAgIH0pO1xuXG4gICAgZm9vTW9kZWwuc2V0KCdiYXInLCA3ODkpO1xuXG4gICAgYmluZGluZy5vbmNlKCdjaGFuZ2UnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIHQuZXF1YWwodmFsdWUsIDk4Nyk7XG4gICAgfSk7XG5cbiAgICBiaW5kaW5nKDk4Nyk7XG59KTtcblxudGVzdCgnZnVzZScsIGZ1bmN0aW9uKHQpe1xuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZm9vOiAxLFxuICAgICAgICAgICAgYmFyOiAyLFxuICAgICAgICAgICAgYmF6OiAzXG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoZGF0YSksXG4gICAgICAgIGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCdmb28nLCAnYmFyJywgJ2JheicsIGZ1bmN0aW9uKGZvbywgYmFyLCBiYXope1xuICAgICAgICAgICAgcmV0dXJuIGZvbyArIGJhciArIGJhejtcbiAgICAgICAgfSk7XG5cbiAgICBiaW5kaW5nLmF0dGFjaChkYXRhKTtcblxuICAgIGJpbmRpbmcoMik7XG5cbiAgICBiaW5kaW5nLm9uY2UoJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5lcXVhbCh2YWx1ZSwgNyk7XG4gICAgfSk7XG5cbiAgICBtb2RlbC5zZXQoJ2JhcicsIDMpO1xuXG4gICAgYmluZGluZy5vbmNlKCdjaGFuZ2UnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIHQuZXF1YWwodmFsdWUsIDMpO1xuICAgIH0pO1xuXG4gICAgYmluZGluZygzKTtcbn0pO1xuXG50ZXN0KCdmaWx0ZXInLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMik7XG5cbiAgICB2YXIgZGF0YSA9IHt9LFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKGRhdGEpLFxuICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vfConKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKGRhdGEpO1xuXG4gICAgYmluZGluZy5vbignY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0LnBhc3MoKTtcbiAgICB9KTtcblxuICAgIG1vZGVsLnNldCgnZm9vJywgW10pO1xuXG4gICAgRW50aS5zZXQoZGF0YS5mb28sIDAsIHt9KTtcbn0pO1xuXG50ZXN0KCd0aGluZ3MnLCBmdW5jdGlvbih0KXtcbiAgICB0LnBsYW4oMik7XG5cbiAgICB2YXIgZGF0YSA9IHt9LFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKGRhdGEpLFxuICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vfCouYmFyJyk7XG5cbiAgICBiaW5kaW5nLmF0dGFjaChkYXRhKTtcblxuICAgIGJpbmRpbmcub24oJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5wYXNzKCk7XG4gICAgfSk7XG5cbiAgICBtb2RlbC5zZXQoJ2ZvbycsIFt7fV0pO1xuXG4gICAgRW50aS5zZXQoZGF0YS5mb29bMF0sICdiYXInLCB0cnVlKTtcbn0pO1xuIiwidmFyIHRlc3QgPSByZXF1aXJlKCd0YXBlJyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBkb2MgPSByZXF1aXJlKCdkb2MtanMnKVxuICAgIGNyZWF0ZUZhc3RuID0gcmVxdWlyZSgnLi9jcmVhdGVGYXN0bicpO1xuXG50ZXN0KCdjaGlsZHJlbiBhcmUgYWRkZWQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgY2hpbGQsXG4gICAgICAgIHBhcmVudCA9IGZhc3RuKCdkaXYnLFxuICAgICAgICAgICAgY2hpbGQgPSBmYXN0bignc3BhbicpXG4gICAgICAgICk7XG5cbiAgICBwYXJlbnQucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwYXJlbnQuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXMubGVuZ3RoLCAxKTtcbiAgICAgICAgdC5lcXVhbChwYXJlbnQuZWxlbWVudC5jaGlsZE5vZGVzLmxlbmd0aCwgMSk7XG5cbiAgICAgICAgcGFyZW50LmVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgIHBhcmVudC5kZXN0cm95KCk7XG4gICAgfSk7XG5cbn0pO1xuXG50ZXN0KCd1bmRlZmluZWQgb3IgbnVsbCBjaGlsZHJlbiBhcmUgaWdub3JlZCcsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciBjaGlsZCxcbiAgICAgICAgcGFyZW50ID0gZmFzdG4oJ2RpdicsXG4gICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCdzcGFuJyksXG4gICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICBudWxsXG4gICAgICAgICk7XG5cbiAgICBwYXJlbnQucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwYXJlbnQuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChwYXJlbnQuZWxlbWVudC5jaGlsZE5vZGVzLmxlbmd0aCwgMSk7XG5cbiAgICAgICAgcGFyZW50LmVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgIHBhcmVudC5kZXN0cm95KCk7XG4gICAgfSk7XG5cbn0pO1xuXG50ZXN0KCdmbGF0dGVuIGNoaWxkcmVuJywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oMSk7XG5cbiAgICB2YXIgZmFzdG4gPSBjcmVhdGVGYXN0bigpO1xuXG4gICAgdmFyIHBhcmVudCA9IGZhc3RuKCdkaXYnLFxuICAgICAgICAgICAgW2Zhc3RuKCdzcGFuJyksIGZhc3RuKCdzcGFuJyldLFxuICAgICAgICAgICAgZmFzdG4oJ3NwYW4nKVxuICAgICAgICApO1xuXG4gICAgcGFyZW50LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQocGFyZW50LmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwocGFyZW50LmVsZW1lbnQuY2hpbGROb2Rlcy5sZW5ndGgsIDMpO1xuXG4gICAgICAgIHBhcmVudC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBwYXJlbnQuZGVzdHJveSgpO1xuICAgIH0pO1xuXG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZUZhc3RuKCl7XG4gICAgcmV0dXJuIHJlcXVpcmUoJy4uLycpKHtcbiAgICAgICAgICAgIF9nZW5lcmljOiByZXF1aXJlKCcuLi9nZW5lcmljQ29tcG9uZW50JyksXG4gICAgICAgICAgICBsaXN0OiByZXF1aXJlKCcuLi9saXN0Q29tcG9uZW50JyksXG4gICAgICAgICAgICB0ZW1wbGF0ZXI6IHJlcXVpcmUoJy4uL3RlbXBsYXRlckNvbXBvbmVudCcpLFxuICAgICAgICAgICAgdGV4dDogcmVxdWlyZSgnLi4vdGV4dENvbXBvbmVudCcpXG4gICAgICAgIH0pO1xufTsiLCJ2YXIgdGVzdCA9IHJlcXVpcmUoJ3RhcGUnKSxcbiAgICBmaXJtZXIgPSByZXF1aXJlKCcuLi9maXJtZXInKTtcblxudGVzdCgnZGVmYXVsdCAoMCkgZmlybW5lc3MnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBlbnRpdGl5ID0ge19maXJtOjB9O1xuXG4gICAgdC5ub3RPayhmaXJtZXIoZW50aXRpeSwgMSkpO1xuICAgIHQubm90T2soZmlybWVyKGVudGl0aXksIDApKTtcbn0pO1xuXG50ZXN0KCd0ZW1wbGF0ZSAoMSkgZmlybW5lc3MnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBlbnRpdGl5ID0ge19maXJtOjF9O1xuXG4gICAgdC5ub3RPayhmaXJtZXIoZW50aXRpeSwgMSkpO1xuICAgIHQub2soZmlybWVyKGVudGl0aXksIDApKTtcbn0pO1xuXG50ZXN0KCdjdXN0b20gKDIpIGZpcm1uZXNzJywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oMik7XG5cbiAgICB2YXIgZW50aXRpeSA9IHtfZmlybToyfTtcblxuICAgIHQub2soZmlybWVyKGVudGl0aXksIDEpKTtcbiAgICB0Lm9rKGZpcm1lcihlbnRpdGl5LCAwKSk7XG59KTtcblxudGVzdCgnYXR0YWNoKCkgKHVuZGVmaW5lZCkgZmlybW5lc3MnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigzKTtcblxuICAgIHZhciBlbnRpdGl5ID0ge19maXJtOnVuZGVmaW5lZH07XG5cbiAgICB0Lm9rKGZpcm1lcihlbnRpdGl5LCAwKSk7XG4gICAgdC5vayhmaXJtZXIoZW50aXRpeSwgMSkpO1xuICAgIHQub2soZmlybWVyKGVudGl0aXksIEluZmluaXR5KSk7XG59KTsiLCJ2YXIgdGVzdCA9IHJlcXVpcmUoJ3RhcGUnKSxcbiAgICBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGRvYyA9IHJlcXVpcmUoJ2RvYy1qcycpXG4gICAgY3JlYXRlRmFzdG4gPSByZXF1aXJlKCcuL2NyZWF0ZUZhc3RuJyk7XG5cbnRlc3QoJ2RpdicsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciBkaXYgPSBmYXN0bignZGl2Jyk7XG5cbiAgICBkaXYucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkaXYuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXMubGVuZ3RoLCAxKTtcbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0udGFnTmFtZSwgJ0RJVicpO1xuXG4gICAgICAgIGRpdi5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBkaXYuZGVzdHJveSgpO1xuICAgIH0pO1xuXG59KTtcblxudGVzdCgnc3BlY2lhbCBwcm9wZXJ0aWVzIC0gaW5wdXQgdmFsdWUgLSB1bmRlZmluZWQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigzKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgaW5wdXQgPSBmYXN0bignaW5wdXQnLCB7dmFsdWU6IHVuZGVmaW5lZH0pO1xuXG4gICAgaW5wdXQucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpbnB1dC5lbGVtZW50KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuY2hpbGROb2Rlcy5sZW5ndGgsIDEpO1xuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuY2hpbGROb2Rlc1swXS50YWdOYW1lLCAnSU5QVVQnKTtcbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0udmFsdWUsICcnKTtcblxuICAgICAgICBpbnB1dC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBpbnB1dC5kZXN0cm95KCk7XG4gICAgfSk7XG5cbn0pO1xuXG50ZXN0KCdzcGVjaWFsIHByb3BlcnRpZXMgLSBpbnB1dCB2YWx1ZSAtIGRhdGVzJywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oOCk7XG5cbiAgICB2YXIgZmFzdG4gPSBjcmVhdGVGYXN0bigpO1xuXG4gICAgdmFyIGlucHV0ID0gZmFzdG4oJ2lucHV0Jywge1xuICAgICAgICB0eXBlOiAnZGF0ZScsXG4gICAgICAgIHZhbHVlOiBuZXcgRGF0ZSgnMjAxNS0wMS0wMScpLFxuICAgICAgICBvbmNoYW5nZTogJ3ZhbHVlOnZhbHVlJyxcbiAgICAgICAgb25jbGljazogJ3ZhbHVlOnZhbHVlJyAvLyBzbyBJIGNhbiB0cmlnZ2VyIGV2ZW50cy4uXG4gICAgfSk7XG5cbiAgICBpbnB1dC5yZW5kZXIoKTtcblxuICAgIGRvYy5yZWFkeShmdW5jdGlvbigpe1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGlucHV0LmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5jaGlsZE5vZGVzLmxlbmd0aCwgMSk7XG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5jaGlsZE5vZGVzWzBdLnRhZ05hbWUsICdJTlBVVCcpO1xuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuY2hpbGROb2Rlc1swXS52YWx1ZSwgJzIwMTUtMDEtMDEnKTtcbiAgICAgICAgdC5kZWVwRXF1YWwoaW5wdXQudmFsdWUoKSwgbmV3IERhdGUoJzIwMTUtMDEtMDEnKSk7XG5cbiAgICAgICAgaW5wdXQudmFsdWUobmV3IERhdGUoJzIwMTUtMDItMDInKSk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0udmFsdWUsICcyMDE1LTAyLTAyJyk7XG4gICAgICAgIHQuZGVlcEVxdWFsKGlucHV0LnZhbHVlKCksIG5ldyBEYXRlKCcyMDE1LTAyLTAyJykpO1xuXG4gICAgICAgIGlucHV0LmVsZW1lbnQudmFsdWUgPSAnMjAxNi0wMi0wMic7XG4gICAgICAgIGlucHV0LmVsZW1lbnQuY2xpY2soKTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuY2hpbGROb2Rlc1swXS52YWx1ZSwgJzIwMTYtMDItMDInKTtcbiAgICAgICAgdC5kZWVwRXF1YWwoaW5wdXQudmFsdWUoKSwgbmV3IERhdGUoJzIwMTYtMDItMDInKSk7XG5cbiAgICAgICAgaW5wdXQuZWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgaW5wdXQuZGVzdHJveSgpO1xuICAgIH0pO1xuXG59KTtcblxudGVzdCgnc3BlY2lhbCBwcm9wZXJ0aWVzIC0gZGlzYWJsZWQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbig0KTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgYnV0dG9uID0gZmFzdG4oJ2J1dHRvbicsIHtcbiAgICAgICAgdHlwZTogJ2J1dHRvbicsXG4gICAgICAgIGRpc2FibGVkOiBmYWxzZVxuICAgIH0pO1xuXG4gICAgYnV0dG9uLnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYnV0dG9uLmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5jaGlsZE5vZGVzLmxlbmd0aCwgMSk7XG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5jaGlsZE5vZGVzWzBdLnRhZ05hbWUsICdCVVRUT04nKTtcbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0uZ2V0QXR0cmlidXRlKCdkaXNhYmxlZCcpLCBudWxsKTtcblxuICAgICAgICBidXR0b24uZGlzYWJsZWQodHJ1ZSk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0uZ2V0QXR0cmlidXRlKCdkaXNhYmxlZCcpLCAnZGlzYWJsZWQnKTtcblxuICAgICAgICBidXR0b24uZWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgYnV0dG9uLmRlc3Ryb3koKTtcbiAgICB9KTtcblxufSk7XG5cbnRlc3QoJ3NwZWNpYWwgcHJvcGVydGllcyAtIHRleHRDb250ZW50JywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oNCk7XG5cbiAgICB2YXIgZmFzdG4gPSBjcmVhdGVGYXN0bigpO1xuXG4gICAgdmFyIGxhYmVsID0gZmFzdG4oJ2xhYmVsJywge1xuICAgICAgICB0ZXh0Q29udGVudDogJ2ZvbydcbiAgICB9KTtcblxuICAgIGxhYmVsLnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobGFiZWwuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXMubGVuZ3RoLCAxKTtcbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0udGFnTmFtZSwgJ0xBQkVMJyk7XG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5jaGlsZE5vZGVzWzBdLnRleHRDb250ZW50LCAnZm9vJyk7XG5cbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQobnVsbCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmNoaWxkTm9kZXNbMF0udGV4dENvbnRlbnQsICcnKTtcblxuICAgICAgICBsYWJlbC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBsYWJlbC5kZXN0cm95KCk7XG4gICAgfSk7XG5cbn0pOyIsInJlcXVpcmUoJy4vZmlybWVyLmpzJyk7XG5yZXF1aXJlKCcuL2JpbmRpbmcuanMnKTtcbnJlcXVpcmUoJy4vcHJvcGVydHkuanMnKTtcbnJlcXVpcmUoJy4vdGV4dC5qcycpO1xucmVxdWlyZSgnLi9saXN0LmpzJyk7XG5yZXF1aXJlKCcuL3RlbXBsYXRlci5qcycpO1xucmVxdWlyZSgnLi9jb250YWluZXIuanMnKTtcbnJlcXVpcmUoJy4vZ2VuZXJpYy5qcycpO1xucmVxdWlyZSgnLi9hdHRhY2guanMnKTtcbiIsInZhciB0ZXN0ID0gcmVxdWlyZSgndGFwZScpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgZG9jID0gcmVxdWlyZSgnZG9jLWpzJyksXG4gICAgY3JlYXRlRmFzdG4gPSByZXF1aXJlKCcuL2NyZWF0ZUZhc3RuJyk7XG5cbnRlc3QoJ3ZhbHVlIGl0ZW1zJywgZnVuY3Rpb24odCl7XG5cbiAgICB0LnBsYW4oMSk7XG5cbiAgICB2YXIgZmFzdG4gPSBjcmVhdGVGYXN0bigpO1xuXG4gICAgdmFyIGxpc3QgPSBmYXN0bignbGlzdCcsIHtcbiAgICAgICAgICAgIGl0ZW1zOiBbMSwyLDMsNF0sXG4gICAgICAgICAgICB0ZW1wbGF0ZTogZnVuY3Rpb24obW9kZWwpe1xuICAgICAgICAgICAgICAgIHJldHVybiBmYXN0bi5iaW5kaW5nKCdpdGVtJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgbGlzdC5yZW5kZXIoKTtcblxuICAgIGRvYy5yZWFkeShmdW5jdGlvbigpe1xuXG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobGlzdC5lbGVtZW50KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnMTIzNCcpO1xuXG4gICAgICAgIGxpc3QuZWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgbGlzdC5kZXN0cm95KCk7XG4gICAgfSk7XG5cblxufSk7XG5cblxudGVzdCgnYm91bmQgaXRlbXMnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigxKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgbGlzdCA9IGZhc3RuKCdsaXN0Jywge1xuICAgICAgICAgICAgaXRlbXM6IGZhc3RuLmJpbmRpbmcoJ2l0ZW1zfConKSxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBmdW5jdGlvbihtb2RlbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhc3RuLmJpbmRpbmcoJ2l0ZW0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICBsaXN0LmF0dGFjaCh7XG4gICAgICAgIGl0ZW1zOiBbMSwyLDMsNF1cbiAgICB9KTtcbiAgICBsaXN0LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG5cbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChsaXN0LmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5pbm5lclRleHQsICcxMjM0Jyk7XG5cbiAgICAgICAgbGlzdC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBsaXN0LmRlc3Ryb3koKTtcblxuICAgIH0pO1xuXG59KTtcblxuXG50ZXN0KCdib3VuZCBpdGVtcyBjaGFuZ2luZycsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciBsaXN0ID0gZmFzdG4oJ2xpc3QnLCB7XG4gICAgICAgICAgICBpdGVtczogZmFzdG4uYmluZGluZygnaXRlbXN8KicpLFxuICAgICAgICAgICAgdGVtcGxhdGU6IGZ1bmN0aW9uKG1vZGVsKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFzdG4uYmluZGluZygnaXRlbScpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aSh7XG4gICAgICAgICAgICBpdGVtczogWzEsMiwzLDRdXG4gICAgICAgIH0pO1xuXG4gICAgbGlzdC5hdHRhY2gobW9kZWwpO1xuICAgIGxpc3QucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcblxuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGxpc3QuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJzEyMzQnKTtcblxuICAgICAgICBtb2RlbC5zZXQoJ2l0ZW1zLjEnLCA1KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnMTUzNCcpO1xuXG4gICAgICAgIGxpc3QuZWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgbGlzdC5kZXN0cm95KCk7XG5cbiAgICB9KTtcblxufSk7XG5cbnRlc3QoJ2JvdW5kIGl0ZW1zIGFkZCcsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciBsaXN0ID0gZmFzdG4oJ2xpc3QnLCB7XG4gICAgICAgICAgICBpdGVtczogZmFzdG4uYmluZGluZygnaXRlbXN8KicpLFxuICAgICAgICAgICAgdGVtcGxhdGU6IGZ1bmN0aW9uKG1vZGVsKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFzdG4uYmluZGluZygnaXRlbScpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aSh7XG4gICAgICAgICAgICBpdGVtczogWzEsMiwzLDRdXG4gICAgICAgIH0pO1xuXG4gICAgbGlzdC5hdHRhY2gobW9kZWwpO1xuICAgIGxpc3QucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcblxuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGxpc3QuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJzEyMzQnKTtcblxuICAgICAgICBtb2RlbC5zZXQoJ2l0ZW1zLjQnLCA1KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnMTIzNDUnKTtcblxuICAgICAgICBsaXN0LmVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgIGxpc3QuZGVzdHJveSgpO1xuXG4gICAgfSk7XG5cbn0pO1xuXG50ZXN0KCdib3VuZCBpdGVtcyByZW1vdmUnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgbGlzdCA9IGZhc3RuKCdsaXN0Jywge1xuICAgICAgICAgICAgaXRlbXM6IGZhc3RuLmJpbmRpbmcoJ2l0ZW1zfConKSxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBmdW5jdGlvbihtb2RlbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhc3RuLmJpbmRpbmcoJ2l0ZW0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoe1xuICAgICAgICAgICAgaXRlbXM6IFsxLDIsMyw0XVxuICAgICAgICB9KTtcblxuICAgIGxpc3QuYXR0YWNoKG1vZGVsKTtcbiAgICBsaXN0LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG5cbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChsaXN0LmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5pbm5lclRleHQsICcxMjM0Jyk7XG5cbiAgICAgICAgbW9kZWwucmVtb3ZlKCdpdGVtcy4zJyk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJzEyMycpO1xuXG4gICAgICAgIGxpc3QuZWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgbGlzdC5kZXN0cm95KCk7XG5cbiAgICB9KTtcblxufSk7IiwidmFyIHRlc3QgPSByZXF1aXJlKCd0YXBlJyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4uL2JpbmRpbmcnKSxcbiAgICBjcmVhdGVQcm9wZXJ0eSA9IHJlcXVpcmUoJy4uL3Byb3BlcnR5JyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKTtcblxudGVzdCgnc2ltcGxlIHByb3BlcnR5IGluaXRpYWxpc2F0aW9uJywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDMpO1xuXG4gICAgdmFyIHByb3BlcnR5ID0gY3JlYXRlUHJvcGVydHkoKTtcblxuICAgIHQuZXF1YWwocHJvcGVydHkoKSwgdW5kZWZpbmVkKTtcblxuICAgIHByb3BlcnR5KCdiYXInKTtcblxuICAgIHQuZXF1YWwocHJvcGVydHkoKSwgJ2JhcicpO1xuXG4gICAgcHJvcGVydHkub24oJ2NoYW5nZScsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgdC5lcXVhbCh2YWx1ZSwgJ2ZvbycpO1xuICAgIH0pO1xuXG4gICAgcHJvcGVydHkoJ2ZvbycpO1xufSk7XG5cbnRlc3QoJ2JvdW5kIHByb3BlcnR5JywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDUpO1xuXG4gICAgdmFyIHByb3BlcnR5ID0gY3JlYXRlUHJvcGVydHkoKTtcblxuICAgIHZhciBiaW5kaW5nID0gY3JlYXRlQmluZGluZygnZm9vJyk7XG5cbiAgICB0LmVxdWFsKHByb3BlcnR5KCksIHVuZGVmaW5lZCk7XG5cbiAgICBwcm9wZXJ0eSgnYmFyJyk7XG5cbiAgICB0LmVxdWFsKHByb3BlcnR5KCksICdiYXInKTtcblxuICAgIHByb3BlcnR5LmJpbmRpbmcoYmluZGluZyk7XG5cbiAgICB0LmVxdWFsKHByb3BlcnR5KCksICdiYXInKTtcblxuICAgIGJpbmRpbmcoJ2JheicpO1xuXG4gICAgdC5lcXVhbChwcm9wZXJ0eSgpLCAnYmF6Jyk7XG5cbiAgICBwcm9wZXJ0eS5vbignY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0LmVxdWFsKHZhbHVlLCAnZm9vJyk7XG4gICAgfSk7XG5cbiAgICBiaW5kaW5nKCdmb28nKTtcbn0pO1xuXG50ZXN0KCdib3VuZCBwcm9wZXJ0eSB3aXRoIG1vZGVsJywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGRhdGEgPSB7fSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aShkYXRhKTtcblxuICAgIHZhciBwcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5KCk7XG5cbiAgICB2YXIgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2ZvbycpO1xuXG4gICAgYmluZGluZy5hdHRhY2gobW9kZWwpO1xuXG4gICAgcHJvcGVydHkuYmluZGluZyhiaW5kaW5nKTtcblxuICAgIHByb3BlcnR5Lm9uKCdjaGFuZ2UnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIHQuZXF1YWwodmFsdWUsICdmb28nKTtcbiAgICB9KTtcblxuICAgIG1vZGVsLnNldCgnZm9vJywgJ2ZvbycpO1xufSk7XG5cbnRlc3QoJ2JvdW5kIHByb3BlcnR5IHdpdGggbW9kZWwgYW5kIGRyaWxsJywgZnVuY3Rpb24odCl7XG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGRhdGEgPSB7fSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aShkYXRhKTtcblxuICAgIHZhciBwcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5KCk7XG5cbiAgICB2YXIgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ2Zvby5iYXInKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoKG1vZGVsKTtcblxuICAgIHByb3BlcnR5LmJpbmRpbmcoYmluZGluZyk7XG5cbiAgICBwcm9wZXJ0eS5vbignY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0LmVxdWFsKHZhbHVlLCAxMjMpO1xuICAgIH0pO1xuXG4gICAgbW9kZWwuc2V0KCdmb28nLCB7YmFyOiAxMjN9KTtcbn0pOyIsInZhciB0ZXN0ID0gcmVxdWlyZSgndGFwZScpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgZG9jID0gcmVxdWlyZSgnZG9jLWpzJylcbiAgICBjcmVhdGVGYXN0biA9IHJlcXVpcmUoJy4vY3JlYXRlRmFzdG4nKTtcblxudGVzdCgndmFsdWUgZGF0YScsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciB0ZW1wbGF0ZSA9IGZhc3RuKCd0ZW1wbGF0ZXInLCB7XG4gICAgICAgICAgICBkYXRhOiB7Zm9vOidiYXInfSxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBmdW5jdGlvbihtb2RlbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhc3RuLmJpbmRpbmcoJ2l0ZW0uZm9vJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgdGVtcGxhdGUucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcblxuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRlbXBsYXRlLmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5pbm5lclRleHQsICdiYXInKTtcblxuICAgICAgICB0ZW1wbGF0ZS5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICB0ZW1wbGF0ZS5kZXN0cm95KCk7XG4gICAgfSk7XG5cblxufSk7XG5cblxudGVzdCgnYm91bmQgZGF0YScsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciB0ZW1wbGF0ZSA9IGZhc3RuKCd0ZW1wbGF0ZXInLCB7XG4gICAgICAgICAgICBkYXRhOiBmYXN0bi5iaW5kaW5nKCdkYXRhfConKSxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBmdW5jdGlvbihtb2RlbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhc3RuLmJpbmRpbmcoJ2l0ZW0uZm9vJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuYXR0YWNoKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZm9vOiAnYmFyJ1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdGVtcGxhdGUucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcblxuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRlbXBsYXRlLmVsZW1lbnQpO1xuXG4gICAgICAgIHQuZXF1YWwoZG9jdW1lbnQuYm9keS5pbm5lclRleHQsICdiYXInKTtcblxuICAgICAgICB0ZW1wbGF0ZS5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICB0ZW1wbGF0ZS5kZXN0cm95KCk7XG5cbiAgICB9KTtcblxufSk7XG5cblxudGVzdCgnYm91bmQgZGF0YSBjaGFuZ2luZycsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciB0ZW1wbGF0ZSA9IGZhc3RuKCd0ZW1wbGF0ZXInLCB7XG4gICAgICAgICAgICBkYXRhOiBmYXN0bi5iaW5kaW5nKCdkYXRhfConKSxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBmdW5jdGlvbihtb2RlbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhc3RuLmJpbmRpbmcoJ2l0ZW0uZm9vJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICBmb286ICdiYXInXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuYXR0YWNoKG1vZGVsKTtcbiAgICB0ZW1wbGF0ZS5yZW5kZXIoKTtcblxuICAgIGRvYy5yZWFkeShmdW5jdGlvbigpe1xuXG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGVtcGxhdGUuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJ2JhcicpO1xuXG4gICAgICAgIG1vZGVsLnNldCgnZGF0YS5mb28nLCAnYmF6Jyk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJ2JheicpO1xuXG4gICAgICAgIHRlbXBsYXRlLmVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgIHRlbXBsYXRlLmRlc3Ryb3koKTtcblxuICAgIH0pO1xuXG59KTsiLCJ2YXIgdGVzdCA9IHJlcXVpcmUoJ3RhcGUnKSxcbiAgICBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGRvYyA9IHJlcXVpcmUoJ2RvYy1qcycpXG4gICAgY3JlYXRlRmFzdG4gPSByZXF1aXJlKCcuL2NyZWF0ZUZhc3RuJyk7XG5cbnRlc3QoJ3ZhbHVlIHRleHQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigxKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgdGV4dCA9IGZhc3RuKCd0ZXh0Jywge3RleHQ6ICdmb28nfSk7XG5cbiAgICB0ZXh0LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGV4dC5lbGVtZW50KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnZm9vJyk7XG5cbiAgICAgICAgdGV4dC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICB0ZXh0LmRlc3Ryb3koKTtcbiAgICB9KTtcblxuXG59KTtcblxudGVzdCgnYm91bmQgdGV4dCcsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDEpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciB0ZXh0ID0gZmFzdG4oJ3RleHQnLCB7dGV4dDogZmFzdG4uYmluZGluZygndmFsdWUnKX0pO1xuXG4gICAgdGV4dC5hdHRhY2goe1xuICAgICAgICB2YWx1ZTogJ2ZvbydcbiAgICB9KTtcbiAgICB0ZXh0LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGV4dC5lbGVtZW50KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnZm9vJyk7XG5cbiAgICAgICAgdGV4dC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICB0ZXh0LmRlc3Ryb3koKTtcbiAgICB9KTtcblxuXG59KTtcblxudGVzdCgnYm91bmQgdGV4dCBjaGFuZ2luZycsIGZ1bmN0aW9uKHQpe1xuXG4gICAgdC5wbGFuKDIpO1xuXG4gICAgdmFyIGZhc3RuID0gY3JlYXRlRmFzdG4oKTtcblxuICAgIHZhciB0ZXh0ID0gZmFzdG4oJ3RleHQnLCB7dGV4dDogZmFzdG4uYmluZGluZygndmFsdWUnKX0pLFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKHtcbiAgICAgICAgICAgIHZhbHVlOiAnZm9vJ1xuICAgICAgICB9KTtcblxuICAgIHRleHQuYXR0YWNoKG1vZGVsKTtcbiAgICB0ZXh0LnJlbmRlcigpO1xuXG4gICAgZG9jLnJlYWR5KGZ1bmN0aW9uKCl7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGV4dC5lbGVtZW50KTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnZm9vJyk7XG5cbiAgICAgICAgbW9kZWwuc2V0KCd2YWx1ZScsICdiYXInKTtcblxuICAgICAgICB0LmVxdWFsKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0LCAnYmFyJyk7XG5cbiAgICAgICAgdGV4dC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICB0ZXh0LmRlc3Ryb3koKTtcbiAgICB9KTtcblxuXG59KTtcblxudGVzdCgnYXV0byBiaW5kaW5nIHRleHQnLCBmdW5jdGlvbih0KXtcblxuICAgIHQucGxhbigyKTtcblxuICAgIHZhciBmYXN0biA9IGNyZWF0ZUZhc3RuKCk7XG5cbiAgICB2YXIgcGFyZW50ID0gZmFzdG4oJ3NwYW4nLCBmYXN0bi5iaW5kaW5nKCd2YWx1ZScpKSxcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aSh7XG4gICAgICAgICAgICB2YWx1ZTogJ2ZvbydcbiAgICAgICAgfSk7XG5cbiAgICBwYXJlbnQuYXR0YWNoKG1vZGVsKTtcbiAgICBwYXJlbnQucmVuZGVyKCk7XG5cbiAgICBkb2MucmVhZHkoZnVuY3Rpb24oKXtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwYXJlbnQuZWxlbWVudCk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJ2ZvbycpO1xuXG4gICAgICAgIG1vZGVsLnNldCgndmFsdWUnLCAnYmFyJyk7XG5cbiAgICAgICAgdC5lcXVhbChkb2N1bWVudC5ib2R5LmlubmVyVGV4dCwgJ2JhcicpO1xuXG4gICAgICAgIHBhcmVudC5lbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICBwYXJlbnQuZGVzdHJveSgpO1xuICAgIH0pO1xuXG5cbn0pOyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3Mpe1xuICAgIHZhciB0ZXh0ID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG4gICAgdGV4dC50ZXh0ID0gZmFzdG4ucHJvcGVydHkoJycpO1xuICAgIHRleHQuX3VwZGF0ZVRleHQgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGlmKCF0ZXh0LmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGV4dC5lbGVtZW50LnRleHRDb250ZW50ID0gdmFsdWU7XG4gICAgfTtcbiAgICB0ZXh0LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHRleHQuZWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgICAgdGV4dC5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuICAgIHRleHQudGV4dC5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0ZXh0Ll91cGRhdGVUZXh0KHZhbHVlKTtcbiAgICB9KTtcbiAgICB0ZXh0Lm9uKCd1cGRhdGUnLCB0ZXh0LnRleHQudXBkYXRlKTtcblxuICAgIHJldHVybiB0ZXh0O1xufTsiLG51bGwsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIga01heExlbmd0aCA9IDB4M2ZmZmZmZmZcbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gYXJyLmZvbygpID09PSA0MiAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChhcmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAvLyBBdm9pZCBnb2luZyB0aHJvdWdoIGFuIEFyZ3VtZW50c0FkYXB0b3JUcmFtcG9saW5lIGluIHRoZSBjb21tb24gY2FzZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHJldHVybiBuZXcgQnVmZmVyKGFyZywgYXJndW1lbnRzWzFdKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZylcbiAgfVxuXG4gIHRoaXMubGVuZ3RoID0gMFxuICB0aGlzLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLCBhcmcpXG4gIH1cblxuICAvLyBTbGlnaHRseSBsZXNzIGNvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGlzLCBhcmcsIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gYXJndW1lbnRzWzFdIDogJ3V0ZjgnKVxuICB9XG5cbiAgLy8gVW51c3VhbC5cbiAgcmV0dXJuIGZyb21PYmplY3QodGhpcywgYXJnKVxufVxuXG5mdW5jdGlvbiBmcm9tTnVtYmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChsZW5ndGgpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHRoYXRbaV0gPSAwXG4gICAgfVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIC8vIEFzc3VtcHRpb246IGJ5dGVMZW5ndGgoKSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIDwga01heExlbmd0aC5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpKSByZXR1cm4gZnJvbUJ1ZmZlcih0aGF0LCBvYmplY3QpXG5cbiAgaWYgKGlzQXJyYXkob2JqZWN0KSkgcmV0dXJuIGZyb21BcnJheSh0aGF0LCBvYmplY3QpXG5cbiAgaWYgKG9iamVjdCA9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgb2JqZWN0LmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgcmV0dXJuIGZyb21UeXBlZEFycmF5KHRoYXQsIG9iamVjdClcbiAgfVxuXG4gIGlmIChvYmplY3QubGVuZ3RoKSByZXR1cm4gZnJvbUFycmF5TGlrZSh0aGF0LCBvYmplY3QpXG5cbiAgcmV0dXJuIGZyb21Kc29uT2JqZWN0KHRoYXQsIG9iamVjdClcbn1cblxuZnVuY3Rpb24gZnJvbUJ1ZmZlciAodGhhdCwgYnVmZmVyKSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGJ1ZmZlci5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBidWZmZXIuY29weSh0aGF0LCAwLCAwLCBsZW5ndGgpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIER1cGxpY2F0ZSBvZiBmcm9tQXJyYXkoKSB0byBrZWVwIGZyb21BcnJheSgpIG1vbm9tb3JwaGljLlxuZnVuY3Rpb24gZnJvbVR5cGVkQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIC8vIFRydW5jYXRpbmcgdGhlIGVsZW1lbnRzIGlzIHByb2JhYmx5IG5vdCB3aGF0IHBlb3BsZSBleHBlY3QgZnJvbSB0eXBlZFxuICAvLyBhcnJheXMgd2l0aCBCWVRFU19QRVJfRUxFTUVOVCA+IDEgYnV0IGl0J3MgY29tcGF0aWJsZSB3aXRoIHRoZSBiZWhhdmlvclxuICAvLyBvZiB0aGUgb2xkIEJ1ZmZlciBjb25zdHJ1Y3Rvci5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUxpa2UgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEZXNlcmlhbGl6ZSB7IHR5cGU6ICdCdWZmZXInLCBkYXRhOiBbMSwyLDMsLi4uXSB9IGludG8gYSBCdWZmZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHplcm8tbGVuZ3RoIGJ1ZmZlciBmb3IgaW5wdXRzIHRoYXQgZG9uJ3QgY29uZm9ybSB0byB0aGUgc3BlYy5cbmZ1bmN0aW9uIGZyb21Kc29uT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgdmFyIGFycmF5XG4gIHZhciBsZW5ndGggPSAwXG5cbiAgaWYgKG9iamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KG9iamVjdC5kYXRhKSkge1xuICAgIGFycmF5ID0gb2JqZWN0LmRhdGFcbiAgICBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIH1cbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gYWxsb2NhdGUgKHRoYXQsIGxlbmd0aCkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gICAgdGhhdC5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgZnJvbVBvb2wgPSBsZW5ndGggIT09IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSA+Pj4gMVxuICBpZiAoZnJvbVBvb2wpIHRoYXQucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGNoZWNrZWQgKGxlbmd0aCkge1xuICAvLyBOb3RlOiBjYW5ub3QgdXNlIGBsZW5ndGggPCBrTWF4TGVuZ3RoYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aC50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9IFN0cmluZyhzdHJpbmcpXG5cbiAgaWYgKHN0cmluZy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdyYXcnOlxuICAgICAgcmV0dXJuIHN0cmluZy5sZW5ndGhcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHN0cmluZy5sZW5ndGggKiAyXG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldHVybiBzdHJpbmcubGVuZ3RoID4+PiAxXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldHVybiBiYXNlNjRUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBzdHJpbmcubGVuZ3RoXG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbi8vIHRvU3RyaW5nKGVuY29kaW5nLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbihidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIG5CaXRzID0gLTcsXG4gICAgICBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDAsXG4gICAgICBkID0gaXNMRSA/IC0xIDogMSxcbiAgICAgIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV07XG5cbiAgaSArPSBkO1xuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBzID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gZUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIGUgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBtTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXM7XG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KTtcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pO1xuICAgIGUgPSBlIC0gZUJpYXM7XG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbik7XG59O1xuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24oYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGMsXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApLFxuICAgICAgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpLFxuICAgICAgZCA9IGlzTEUgPyAxIDogLTEsXG4gICAgICBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwO1xuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwO1xuICAgIGUgPSBlTWF4O1xuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKTtcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS07XG4gICAgICBjICo9IDI7XG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcyk7XG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrO1xuICAgICAgYyAvPSAyO1xuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDA7XG4gICAgICBlID0gZU1heDtcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gZSArIGVCaWFzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gMDtcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KTtcblxuICBlID0gKGUgPDwgbUxlbikgfCBtO1xuICBlTGVuICs9IG1MZW47XG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCk7XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4O1xufTtcbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH1cbiAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIChhcnIpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChhcnIpID09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIHJlc29sdmVzIC4gYW5kIC4uIGVsZW1lbnRzIGluIGEgcGF0aCBhcnJheSB3aXRoIGRpcmVjdG9yeSBuYW1lcyB0aGVyZVxuLy8gbXVzdCBiZSBubyBzbGFzaGVzLCBlbXB0eSBlbGVtZW50cywgb3IgZGV2aWNlIG5hbWVzIChjOlxcKSBpbiB0aGUgYXJyYXlcbi8vIChzbyBhbHNvIG5vIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHNsYXNoZXMgLSBpdCBkb2VzIG5vdCBkaXN0aW5ndWlzaFxuLy8gcmVsYXRpdmUgYW5kIGFic29sdXRlIHBhdGhzKVxuZnVuY3Rpb24gbm9ybWFsaXplQXJyYXkocGFydHMsIGFsbG93QWJvdmVSb290KSB7XG4gIC8vIGlmIHRoZSBwYXRoIHRyaWVzIHRvIGdvIGFib3ZlIHRoZSByb290LCBgdXBgIGVuZHMgdXAgPiAwXG4gIHZhciB1cCA9IDA7XG4gIGZvciAodmFyIGkgPSBwYXJ0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIHZhciBsYXN0ID0gcGFydHNbaV07XG4gICAgaWYgKGxhc3QgPT09ICcuJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgIH0gZWxzZSBpZiAobGFzdCA9PT0gJy4uJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXArKztcbiAgICB9IGVsc2UgaWYgKHVwKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgICB1cC0tO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIHRoZSBwYXRoIGlzIGFsbG93ZWQgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIHJlc3RvcmUgbGVhZGluZyAuLnNcbiAgaWYgKGFsbG93QWJvdmVSb290KSB7XG4gICAgZm9yICg7IHVwLS07IHVwKSB7XG4gICAgICBwYXJ0cy51bnNoaWZ0KCcuLicpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cblxuLy8gU3BsaXQgYSBmaWxlbmFtZSBpbnRvIFtyb290LCBkaXIsIGJhc2VuYW1lLCBleHRdLCB1bml4IHZlcnNpb25cbi8vICdyb290JyBpcyBqdXN0IGEgc2xhc2gsIG9yIG5vdGhpbmcuXG52YXIgc3BsaXRQYXRoUmUgPVxuICAgIC9eKFxcLz98KShbXFxzXFxTXSo/KSgoPzpcXC57MSwyfXxbXlxcL10rP3wpKFxcLlteLlxcL10qfCkpKD86W1xcL10qKSQvO1xudmFyIHNwbGl0UGF0aCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gIHJldHVybiBzcGxpdFBhdGhSZS5leGVjKGZpbGVuYW1lKS5zbGljZSgxKTtcbn07XG5cbi8vIHBhdGgucmVzb2x2ZShbZnJvbSAuLi5dLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVzb2x2ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmVzb2x2ZWRQYXRoID0gJycsXG4gICAgICByZXNvbHZlZEFic29sdXRlID0gZmFsc2U7XG5cbiAgZm9yICh2YXIgaSA9IGFyZ3VtZW50cy5sZW5ndGggLSAxOyBpID49IC0xICYmICFyZXNvbHZlZEFic29sdXRlOyBpLS0pIHtcbiAgICB2YXIgcGF0aCA9IChpID49IDApID8gYXJndW1lbnRzW2ldIDogcHJvY2Vzcy5jd2QoKTtcblxuICAgIC8vIFNraXAgZW1wdHkgYW5kIGludmFsaWQgZW50cmllc1xuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLnJlc29sdmUgbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfSBlbHNlIGlmICghcGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQYXRoID0gcGF0aCArICcvJyArIHJlc29sdmVkUGF0aDtcbiAgICByZXNvbHZlZEFic29sdXRlID0gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbiAgfVxuXG4gIC8vIEF0IHRoaXMgcG9pbnQgdGhlIHBhdGggc2hvdWxkIGJlIHJlc29sdmVkIHRvIGEgZnVsbCBhYnNvbHV0ZSBwYXRoLCBidXRcbiAgLy8gaGFuZGxlIHJlbGF0aXZlIHBhdGhzIHRvIGJlIHNhZmUgKG1pZ2h0IGhhcHBlbiB3aGVuIHByb2Nlc3MuY3dkKCkgZmFpbHMpXG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHJlc29sdmVkUGF0aCA9IG5vcm1hbGl6ZUFycmF5KGZpbHRlcihyZXNvbHZlZFBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhcmVzb2x2ZWRBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIHJldHVybiAoKHJlc29sdmVkQWJzb2x1dGUgPyAnLycgOiAnJykgKyByZXNvbHZlZFBhdGgpIHx8ICcuJztcbn07XG5cbi8vIHBhdGgubm9ybWFsaXplKHBhdGgpXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLm5vcm1hbGl6ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgdmFyIGlzQWJzb2x1dGUgPSBleHBvcnRzLmlzQWJzb2x1dGUocGF0aCksXG4gICAgICB0cmFpbGluZ1NsYXNoID0gc3Vic3RyKHBhdGgsIC0xKSA9PT0gJy8nO1xuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICBwYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhaXNBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIGlmICghcGF0aCAmJiAhaXNBYnNvbHV0ZSkge1xuICAgIHBhdGggPSAnLic7XG4gIH1cbiAgaWYgKHBhdGggJiYgdHJhaWxpbmdTbGFzaCkge1xuICAgIHBhdGggKz0gJy8nO1xuICB9XG5cbiAgcmV0dXJuIChpc0Fic29sdXRlID8gJy8nIDogJycpICsgcGF0aDtcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuaXNBYnNvbHV0ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgcmV0dXJuIHBhdGguY2hhckF0KDApID09PSAnLyc7XG59O1xuXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLmpvaW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhdGhzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAwKTtcbiAgcmV0dXJuIGV4cG9ydHMubm9ybWFsaXplKGZpbHRlcihwYXRocywgZnVuY3Rpb24ocCwgaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIHAgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgdG8gcGF0aC5qb2luIG11c3QgYmUgc3RyaW5ncycpO1xuICAgIH1cbiAgICByZXR1cm4gcDtcbiAgfSkuam9pbignLycpKTtcbn07XG5cblxuLy8gcGF0aC5yZWxhdGl2ZShmcm9tLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVsYXRpdmUgPSBmdW5jdGlvbihmcm9tLCB0bykge1xuICBmcm9tID0gZXhwb3J0cy5yZXNvbHZlKGZyb20pLnN1YnN0cigxKTtcbiAgdG8gPSBleHBvcnRzLnJlc29sdmUodG8pLnN1YnN0cigxKTtcblxuICBmdW5jdGlvbiB0cmltKGFycikge1xuICAgIHZhciBzdGFydCA9IDA7XG4gICAgZm9yICg7IHN0YXJ0IDwgYXJyLmxlbmd0aDsgc3RhcnQrKykge1xuICAgICAgaWYgKGFycltzdGFydF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICB2YXIgZW5kID0gYXJyLmxlbmd0aCAtIDE7XG4gICAgZm9yICg7IGVuZCA+PSAwOyBlbmQtLSkge1xuICAgICAgaWYgKGFycltlbmRdICE9PSAnJykgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKHN0YXJ0ID4gZW5kKSByZXR1cm4gW107XG4gICAgcmV0dXJuIGFyci5zbGljZShzdGFydCwgZW5kIC0gc3RhcnQgKyAxKTtcbiAgfVxuXG4gIHZhciBmcm9tUGFydHMgPSB0cmltKGZyb20uc3BsaXQoJy8nKSk7XG4gIHZhciB0b1BhcnRzID0gdHJpbSh0by5zcGxpdCgnLycpKTtcblxuICB2YXIgbGVuZ3RoID0gTWF0aC5taW4oZnJvbVBhcnRzLmxlbmd0aCwgdG9QYXJ0cy5sZW5ndGgpO1xuICB2YXIgc2FtZVBhcnRzTGVuZ3RoID0gbGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGZyb21QYXJ0c1tpXSAhPT0gdG9QYXJ0c1tpXSkge1xuICAgICAgc2FtZVBhcnRzTGVuZ3RoID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHZhciBvdXRwdXRQYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gc2FtZVBhcnRzTGVuZ3RoOyBpIDwgZnJvbVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0cHV0UGFydHMucHVzaCgnLi4nKTtcbiAgfVxuXG4gIG91dHB1dFBhcnRzID0gb3V0cHV0UGFydHMuY29uY2F0KHRvUGFydHMuc2xpY2Uoc2FtZVBhcnRzTGVuZ3RoKSk7XG5cbiAgcmV0dXJuIG91dHB1dFBhcnRzLmpvaW4oJy8nKTtcbn07XG5cbmV4cG9ydHMuc2VwID0gJy8nO1xuZXhwb3J0cy5kZWxpbWl0ZXIgPSAnOic7XG5cbmV4cG9ydHMuZGlybmFtZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgdmFyIHJlc3VsdCA9IHNwbGl0UGF0aChwYXRoKSxcbiAgICAgIHJvb3QgPSByZXN1bHRbMF0sXG4gICAgICBkaXIgPSByZXN1bHRbMV07XG5cbiAgaWYgKCFyb290ICYmICFkaXIpIHtcbiAgICAvLyBObyBkaXJuYW1lIHdoYXRzb2V2ZXJcbiAgICByZXR1cm4gJy4nO1xuICB9XG5cbiAgaWYgKGRpcikge1xuICAgIC8vIEl0IGhhcyBhIGRpcm5hbWUsIHN0cmlwIHRyYWlsaW5nIHNsYXNoXG4gICAgZGlyID0gZGlyLnN1YnN0cigwLCBkaXIubGVuZ3RoIC0gMSk7XG4gIH1cblxuICByZXR1cm4gcm9vdCArIGRpcjtcbn07XG5cblxuZXhwb3J0cy5iYXNlbmFtZSA9IGZ1bmN0aW9uKHBhdGgsIGV4dCkge1xuICB2YXIgZiA9IHNwbGl0UGF0aChwYXRoKVsyXTtcbiAgLy8gVE9ETzogbWFrZSB0aGlzIGNvbXBhcmlzb24gY2FzZS1pbnNlbnNpdGl2ZSBvbiB3aW5kb3dzP1xuICBpZiAoZXh0ICYmIGYuc3Vic3RyKC0xICogZXh0Lmxlbmd0aCkgPT09IGV4dCkge1xuICAgIGYgPSBmLnN1YnN0cigwLCBmLmxlbmd0aCAtIGV4dC5sZW5ndGgpO1xuICB9XG4gIHJldHVybiBmO1xufTtcblxuXG5leHBvcnRzLmV4dG5hbWUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHJldHVybiBzcGxpdFBhdGgocGF0aClbM107XG59O1xuXG5mdW5jdGlvbiBmaWx0ZXIgKHhzLCBmKSB7XG4gICAgaWYgKHhzLmZpbHRlcikgcmV0dXJuIHhzLmZpbHRlcihmKTtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoZih4c1tpXSwgaSwgeHMpKSByZXMucHVzaCh4c1tpXSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59XG5cbi8vIFN0cmluZy5wcm90b3R5cGUuc3Vic3RyIC0gbmVnYXRpdmUgaW5kZXggZG9uJ3Qgd29yayBpbiBJRThcbnZhciBzdWJzdHIgPSAnYWInLnN1YnN0cigtMSkgPT09ICdiJ1xuICAgID8gZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikgeyByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKSB9XG4gICAgOiBmdW5jdGlvbiAoc3RyLCBzdGFydCwgbGVuKSB7XG4gICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gc3RyLmxlbmd0aCArIHN0YXJ0O1xuICAgICAgICByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKTtcbiAgICB9XG47XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IHRydWU7XG4gICAgdmFyIGN1cnJlbnRRdWV1ZTtcbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgdmFyIGkgPSAtMTtcbiAgICAgICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW2ldKCk7XG4gICAgICAgIH1cbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xufVxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICBxdWV1ZS5wdXNoKGZ1bik7XG4gICAgaWYgKCFkcmFpbmluZykge1xuICAgICAgICBzZXRUaW1lb3V0KGRyYWluUXVldWUsIDApO1xuICAgIH1cbn07XG5cbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwiLi9saWIvX3N0cmVhbV9kdXBsZXguanNcIilcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4vLyBhIGR1cGxleCBzdHJlYW0gaXMganVzdCBhIHN0cmVhbSB0aGF0IGlzIGJvdGggcmVhZGFibGUgYW5kIHdyaXRhYmxlLlxuLy8gU2luY2UgSlMgZG9lc24ndCBoYXZlIG11bHRpcGxlIHByb3RvdHlwYWwgaW5oZXJpdGFuY2UsIHRoaXMgY2xhc3Ncbi8vIHByb3RvdHlwYWxseSBpbmhlcml0cyBmcm9tIFJlYWRhYmxlLCBhbmQgdGhlbiBwYXJhc2l0aWNhbGx5IGZyb21cbi8vIFdyaXRhYmxlLlxuXG5tb2R1bGUuZXhwb3J0cyA9IER1cGxleDtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgcmV0dXJuIGtleXM7XG59XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIHV0aWwgPSByZXF1aXJlKCdjb3JlLXV0aWwtaXMnKTtcbnV0aWwuaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbnZhciBSZWFkYWJsZSA9IHJlcXVpcmUoJy4vX3N0cmVhbV9yZWFkYWJsZScpO1xudmFyIFdyaXRhYmxlID0gcmVxdWlyZSgnLi9fc3RyZWFtX3dyaXRhYmxlJyk7XG5cbnV0aWwuaW5oZXJpdHMoRHVwbGV4LCBSZWFkYWJsZSk7XG5cbmZvckVhY2gob2JqZWN0S2V5cyhXcml0YWJsZS5wcm90b3R5cGUpLCBmdW5jdGlvbihtZXRob2QpIHtcbiAgaWYgKCFEdXBsZXgucHJvdG90eXBlW21ldGhvZF0pXG4gICAgRHVwbGV4LnByb3RvdHlwZVttZXRob2RdID0gV3JpdGFibGUucHJvdG90eXBlW21ldGhvZF07XG59KTtcblxuZnVuY3Rpb24gRHVwbGV4KG9wdGlvbnMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIER1cGxleCkpXG4gICAgcmV0dXJuIG5ldyBEdXBsZXgob3B0aW9ucyk7XG5cbiAgUmVhZGFibGUuY2FsbCh0aGlzLCBvcHRpb25zKTtcbiAgV3JpdGFibGUuY2FsbCh0aGlzLCBvcHRpb25zKTtcblxuICBpZiAob3B0aW9ucyAmJiBvcHRpb25zLnJlYWRhYmxlID09PSBmYWxzZSlcbiAgICB0aGlzLnJlYWRhYmxlID0gZmFsc2U7XG5cbiAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy53cml0YWJsZSA9PT0gZmFsc2UpXG4gICAgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuXG4gIHRoaXMuYWxsb3dIYWxmT3BlbiA9IHRydWU7XG4gIGlmIChvcHRpb25zICYmIG9wdGlvbnMuYWxsb3dIYWxmT3BlbiA9PT0gZmFsc2UpXG4gICAgdGhpcy5hbGxvd0hhbGZPcGVuID0gZmFsc2U7XG5cbiAgdGhpcy5vbmNlKCdlbmQnLCBvbmVuZCk7XG59XG5cbi8vIHRoZSBuby1oYWxmLW9wZW4gZW5mb3JjZXJcbmZ1bmN0aW9uIG9uZW5kKCkge1xuICAvLyBpZiB3ZSBhbGxvdyBoYWxmLW9wZW4gc3RhdGUsIG9yIGlmIHRoZSB3cml0YWJsZSBzaWRlIGVuZGVkLFxuICAvLyB0aGVuIHdlJ3JlIG9rLlxuICBpZiAodGhpcy5hbGxvd0hhbGZPcGVuIHx8IHRoaXMuX3dyaXRhYmxlU3RhdGUuZW5kZWQpXG4gICAgcmV0dXJuO1xuXG4gIC8vIG5vIG1vcmUgZGF0YSBjYW4gYmUgd3JpdHRlbi5cbiAgLy8gQnV0IGFsbG93IG1vcmUgd3JpdGVzIHRvIGhhcHBlbiBpbiB0aGlzIHRpY2suXG4gIHByb2Nlc3MubmV4dFRpY2sodGhpcy5lbmQuYmluZCh0aGlzKSk7XG59XG5cbmZ1bmN0aW9uIGZvckVhY2ggKHhzLCBmKSB7XG4gIGZvciAodmFyIGkgPSAwLCBsID0geHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgZih4c1tpXSwgaSk7XG4gIH1cbn1cbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4vLyBhIHBhc3N0aHJvdWdoIHN0cmVhbS5cbi8vIGJhc2ljYWxseSBqdXN0IHRoZSBtb3N0IG1pbmltYWwgc29ydCBvZiBUcmFuc2Zvcm0gc3RyZWFtLlxuLy8gRXZlcnkgd3JpdHRlbiBjaHVuayBnZXRzIG91dHB1dCBhcy1pcy5cblxubW9kdWxlLmV4cG9ydHMgPSBQYXNzVGhyb3VnaDtcblxudmFyIFRyYW5zZm9ybSA9IHJlcXVpcmUoJy4vX3N0cmVhbV90cmFuc2Zvcm0nKTtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciB1dGlsID0gcmVxdWlyZSgnY29yZS11dGlsLWlzJyk7XG51dGlsLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG51dGlsLmluaGVyaXRzKFBhc3NUaHJvdWdoLCBUcmFuc2Zvcm0pO1xuXG5mdW5jdGlvbiBQYXNzVGhyb3VnaChvcHRpb25zKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBQYXNzVGhyb3VnaCkpXG4gICAgcmV0dXJuIG5ldyBQYXNzVGhyb3VnaChvcHRpb25zKTtcblxuICBUcmFuc2Zvcm0uY2FsbCh0aGlzLCBvcHRpb25zKTtcbn1cblxuUGFzc1Rocm91Z2gucHJvdG90eXBlLl90cmFuc2Zvcm0gPSBmdW5jdGlvbihjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIGNiKG51bGwsIGNodW5rKTtcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxubW9kdWxlLmV4cG9ydHMgPSBSZWFkYWJsZTtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXNhcnJheScpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBCdWZmZXIgPSByZXF1aXJlKCdidWZmZXInKS5CdWZmZXI7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxuUmVhZGFibGUuUmVhZGFibGVTdGF0ZSA9IFJlYWRhYmxlU3RhdGU7XG5cbnZhciBFRSA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbmlmICghRUUubGlzdGVuZXJDb3VudCkgRUUubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKGVtaXR0ZXIsIHR5cGUpIHtcbiAgcmV0dXJuIGVtaXR0ZXIubGlzdGVuZXJzKHR5cGUpLmxlbmd0aDtcbn07XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxudmFyIFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpO1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIHV0aWwgPSByZXF1aXJlKCdjb3JlLXV0aWwtaXMnKTtcbnV0aWwuaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbnZhciBTdHJpbmdEZWNvZGVyO1xuXG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgZGVidWcgPSByZXF1aXJlKCd1dGlsJyk7XG5pZiAoZGVidWcgJiYgZGVidWcuZGVidWdsb2cpIHtcbiAgZGVidWcgPSBkZWJ1Zy5kZWJ1Z2xvZygnc3RyZWFtJyk7XG59IGVsc2Uge1xuICBkZWJ1ZyA9IGZ1bmN0aW9uICgpIHt9O1xufVxuLyo8L3JlcGxhY2VtZW50PiovXG5cblxudXRpbC5pbmhlcml0cyhSZWFkYWJsZSwgU3RyZWFtKTtcblxuZnVuY3Rpb24gUmVhZGFibGVTdGF0ZShvcHRpb25zLCBzdHJlYW0pIHtcbiAgdmFyIER1cGxleCA9IHJlcXVpcmUoJy4vX3N0cmVhbV9kdXBsZXgnKTtcblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAvLyB0aGUgcG9pbnQgYXQgd2hpY2ggaXQgc3RvcHMgY2FsbGluZyBfcmVhZCgpIHRvIGZpbGwgdGhlIGJ1ZmZlclxuICAvLyBOb3RlOiAwIGlzIGEgdmFsaWQgdmFsdWUsIG1lYW5zIFwiZG9uJ3QgY2FsbCBfcmVhZCBwcmVlbXB0aXZlbHkgZXZlclwiXG4gIHZhciBod20gPSBvcHRpb25zLmhpZ2hXYXRlck1hcms7XG4gIHZhciBkZWZhdWx0SHdtID0gb3B0aW9ucy5vYmplY3RNb2RlID8gMTYgOiAxNiAqIDEwMjQ7XG4gIHRoaXMuaGlnaFdhdGVyTWFyayA9IChod20gfHwgaHdtID09PSAwKSA/IGh3bSA6IGRlZmF1bHRId207XG5cbiAgLy8gY2FzdCB0byBpbnRzLlxuICB0aGlzLmhpZ2hXYXRlck1hcmsgPSB+fnRoaXMuaGlnaFdhdGVyTWFyaztcblxuICB0aGlzLmJ1ZmZlciA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IDA7XG4gIHRoaXMucGlwZXMgPSBudWxsO1xuICB0aGlzLnBpcGVzQ291bnQgPSAwO1xuICB0aGlzLmZsb3dpbmcgPSBudWxsO1xuICB0aGlzLmVuZGVkID0gZmFsc2U7XG4gIHRoaXMuZW5kRW1pdHRlZCA9IGZhbHNlO1xuICB0aGlzLnJlYWRpbmcgPSBmYWxzZTtcblxuICAvLyBhIGZsYWcgdG8gYmUgYWJsZSB0byB0ZWxsIGlmIHRoZSBvbndyaXRlIGNiIGlzIGNhbGxlZCBpbW1lZGlhdGVseSxcbiAgLy8gb3Igb24gYSBsYXRlciB0aWNrLiAgV2Ugc2V0IHRoaXMgdG8gdHJ1ZSBhdCBmaXJzdCwgYmVjYXVzZSBhbnlcbiAgLy8gYWN0aW9ucyB0aGF0IHNob3VsZG4ndCBoYXBwZW4gdW50aWwgXCJsYXRlclwiIHNob3VsZCBnZW5lcmFsbHkgYWxzb1xuICAvLyBub3QgaGFwcGVuIGJlZm9yZSB0aGUgZmlyc3Qgd3JpdGUgY2FsbC5cbiAgdGhpcy5zeW5jID0gdHJ1ZTtcblxuICAvLyB3aGVuZXZlciB3ZSByZXR1cm4gbnVsbCwgdGhlbiB3ZSBzZXQgYSBmbGFnIHRvIHNheVxuICAvLyB0aGF0IHdlJ3JlIGF3YWl0aW5nIGEgJ3JlYWRhYmxlJyBldmVudCBlbWlzc2lvbi5cbiAgdGhpcy5uZWVkUmVhZGFibGUgPSBmYWxzZTtcbiAgdGhpcy5lbWl0dGVkUmVhZGFibGUgPSBmYWxzZTtcbiAgdGhpcy5yZWFkYWJsZUxpc3RlbmluZyA9IGZhbHNlO1xuXG5cbiAgLy8gb2JqZWN0IHN0cmVhbSBmbGFnLiBVc2VkIHRvIG1ha2UgcmVhZChuKSBpZ25vcmUgbiBhbmQgdG9cbiAgLy8gbWFrZSBhbGwgdGhlIGJ1ZmZlciBtZXJnaW5nIGFuZCBsZW5ndGggY2hlY2tzIGdvIGF3YXlcbiAgdGhpcy5vYmplY3RNb2RlID0gISFvcHRpb25zLm9iamVjdE1vZGU7XG5cbiAgaWYgKHN0cmVhbSBpbnN0YW5jZW9mIER1cGxleClcbiAgICB0aGlzLm9iamVjdE1vZGUgPSB0aGlzLm9iamVjdE1vZGUgfHwgISFvcHRpb25zLnJlYWRhYmxlT2JqZWN0TW9kZTtcblxuICAvLyBDcnlwdG8gaXMga2luZCBvZiBvbGQgYW5kIGNydXN0eS4gIEhpc3RvcmljYWxseSwgaXRzIGRlZmF1bHQgc3RyaW5nXG4gIC8vIGVuY29kaW5nIGlzICdiaW5hcnknIHNvIHdlIGhhdmUgdG8gbWFrZSB0aGlzIGNvbmZpZ3VyYWJsZS5cbiAgLy8gRXZlcnl0aGluZyBlbHNlIGluIHRoZSB1bml2ZXJzZSB1c2VzICd1dGY4JywgdGhvdWdoLlxuICB0aGlzLmRlZmF1bHRFbmNvZGluZyA9IG9wdGlvbnMuZGVmYXVsdEVuY29kaW5nIHx8ICd1dGY4JztcblxuICAvLyB3aGVuIHBpcGluZywgd2Ugb25seSBjYXJlIGFib3V0ICdyZWFkYWJsZScgZXZlbnRzIHRoYXQgaGFwcGVuXG4gIC8vIGFmdGVyIHJlYWQoKWluZyBhbGwgdGhlIGJ5dGVzIGFuZCBub3QgZ2V0dGluZyBhbnkgcHVzaGJhY2suXG4gIHRoaXMucmFuT3V0ID0gZmFsc2U7XG5cbiAgLy8gdGhlIG51bWJlciBvZiB3cml0ZXJzIHRoYXQgYXJlIGF3YWl0aW5nIGEgZHJhaW4gZXZlbnQgaW4gLnBpcGUoKXNcbiAgdGhpcy5hd2FpdERyYWluID0gMDtcblxuICAvLyBpZiB0cnVlLCBhIG1heWJlUmVhZE1vcmUgaGFzIGJlZW4gc2NoZWR1bGVkXG4gIHRoaXMucmVhZGluZ01vcmUgPSBmYWxzZTtcblxuICB0aGlzLmRlY29kZXIgPSBudWxsO1xuICB0aGlzLmVuY29kaW5nID0gbnVsbDtcbiAgaWYgKG9wdGlvbnMuZW5jb2RpbmcpIHtcbiAgICBpZiAoIVN0cmluZ0RlY29kZXIpXG4gICAgICBTdHJpbmdEZWNvZGVyID0gcmVxdWlyZSgnc3RyaW5nX2RlY29kZXIvJykuU3RyaW5nRGVjb2RlcjtcbiAgICB0aGlzLmRlY29kZXIgPSBuZXcgU3RyaW5nRGVjb2RlcihvcHRpb25zLmVuY29kaW5nKTtcbiAgICB0aGlzLmVuY29kaW5nID0gb3B0aW9ucy5lbmNvZGluZztcbiAgfVxufVxuXG5mdW5jdGlvbiBSZWFkYWJsZShvcHRpb25zKSB7XG4gIHZhciBEdXBsZXggPSByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFJlYWRhYmxlKSlcbiAgICByZXR1cm4gbmV3IFJlYWRhYmxlKG9wdGlvbnMpO1xuXG4gIHRoaXMuX3JlYWRhYmxlU3RhdGUgPSBuZXcgUmVhZGFibGVTdGF0ZShvcHRpb25zLCB0aGlzKTtcblxuICAvLyBsZWdhY3lcbiAgdGhpcy5yZWFkYWJsZSA9IHRydWU7XG5cbiAgU3RyZWFtLmNhbGwodGhpcyk7XG59XG5cbi8vIE1hbnVhbGx5IHNob3ZlIHNvbWV0aGluZyBpbnRvIHRoZSByZWFkKCkgYnVmZmVyLlxuLy8gVGhpcyByZXR1cm5zIHRydWUgaWYgdGhlIGhpZ2hXYXRlck1hcmsgaGFzIG5vdCBiZWVuIGhpdCB5ZXQsXG4vLyBzaW1pbGFyIHRvIGhvdyBXcml0YWJsZS53cml0ZSgpIHJldHVybnMgdHJ1ZSBpZiB5b3Ugc2hvdWxkXG4vLyB3cml0ZSgpIHNvbWUgbW9yZS5cblJlYWRhYmxlLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oY2h1bmssIGVuY29kaW5nKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG5cbiAgaWYgKHV0aWwuaXNTdHJpbmcoY2h1bmspICYmICFzdGF0ZS5vYmplY3RNb2RlKSB7XG4gICAgZW5jb2RpbmcgPSBlbmNvZGluZyB8fCBzdGF0ZS5kZWZhdWx0RW5jb2Rpbmc7XG4gICAgaWYgKGVuY29kaW5nICE9PSBzdGF0ZS5lbmNvZGluZykge1xuICAgICAgY2h1bmsgPSBuZXcgQnVmZmVyKGNodW5rLCBlbmNvZGluZyk7XG4gICAgICBlbmNvZGluZyA9ICcnO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZWFkYWJsZUFkZENodW5rKHRoaXMsIHN0YXRlLCBjaHVuaywgZW5jb2RpbmcsIGZhbHNlKTtcbn07XG5cbi8vIFVuc2hpZnQgc2hvdWxkICphbHdheXMqIGJlIHNvbWV0aGluZyBkaXJlY3RseSBvdXQgb2YgcmVhZCgpXG5SZWFkYWJsZS5wcm90b3R5cGUudW5zaGlmdCA9IGZ1bmN0aW9uKGNodW5rKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIHJldHVybiByZWFkYWJsZUFkZENodW5rKHRoaXMsIHN0YXRlLCBjaHVuaywgJycsIHRydWUpO1xufTtcblxuZnVuY3Rpb24gcmVhZGFibGVBZGRDaHVuayhzdHJlYW0sIHN0YXRlLCBjaHVuaywgZW5jb2RpbmcsIGFkZFRvRnJvbnQpIHtcbiAgdmFyIGVyID0gY2h1bmtJbnZhbGlkKHN0YXRlLCBjaHVuayk7XG4gIGlmIChlcikge1xuICAgIHN0cmVhbS5lbWl0KCdlcnJvcicsIGVyKTtcbiAgfSBlbHNlIGlmICh1dGlsLmlzTnVsbE9yVW5kZWZpbmVkKGNodW5rKSkge1xuICAgIHN0YXRlLnJlYWRpbmcgPSBmYWxzZTtcbiAgICBpZiAoIXN0YXRlLmVuZGVkKVxuICAgICAgb25Fb2ZDaHVuayhzdHJlYW0sIHN0YXRlKTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5vYmplY3RNb2RlIHx8IGNodW5rICYmIGNodW5rLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoc3RhdGUuZW5kZWQgJiYgIWFkZFRvRnJvbnQpIHtcbiAgICAgIHZhciBlID0gbmV3IEVycm9yKCdzdHJlYW0ucHVzaCgpIGFmdGVyIEVPRicpO1xuICAgICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZSk7XG4gICAgfSBlbHNlIGlmIChzdGF0ZS5lbmRFbWl0dGVkICYmIGFkZFRvRnJvbnQpIHtcbiAgICAgIHZhciBlID0gbmV3IEVycm9yKCdzdHJlYW0udW5zaGlmdCgpIGFmdGVyIGVuZCBldmVudCcpO1xuICAgICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChzdGF0ZS5kZWNvZGVyICYmICFhZGRUb0Zyb250ICYmICFlbmNvZGluZylcbiAgICAgICAgY2h1bmsgPSBzdGF0ZS5kZWNvZGVyLndyaXRlKGNodW5rKTtcblxuICAgICAgaWYgKCFhZGRUb0Zyb250KVxuICAgICAgICBzdGF0ZS5yZWFkaW5nID0gZmFsc2U7XG5cbiAgICAgIC8vIGlmIHdlIHdhbnQgdGhlIGRhdGEgbm93LCBqdXN0IGVtaXQgaXQuXG4gICAgICBpZiAoc3RhdGUuZmxvd2luZyAmJiBzdGF0ZS5sZW5ndGggPT09IDAgJiYgIXN0YXRlLnN5bmMpIHtcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2RhdGEnLCBjaHVuayk7XG4gICAgICAgIHN0cmVhbS5yZWFkKDApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gdXBkYXRlIHRoZSBidWZmZXIgaW5mby5cbiAgICAgICAgc3RhdGUubGVuZ3RoICs9IHN0YXRlLm9iamVjdE1vZGUgPyAxIDogY2h1bmsubGVuZ3RoO1xuICAgICAgICBpZiAoYWRkVG9Gcm9udClcbiAgICAgICAgICBzdGF0ZS5idWZmZXIudW5zaGlmdChjaHVuayk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBzdGF0ZS5idWZmZXIucHVzaChjaHVuayk7XG5cbiAgICAgICAgaWYgKHN0YXRlLm5lZWRSZWFkYWJsZSlcbiAgICAgICAgICBlbWl0UmVhZGFibGUoc3RyZWFtKTtcbiAgICAgIH1cblxuICAgICAgbWF5YmVSZWFkTW9yZShzdHJlYW0sIHN0YXRlKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoIWFkZFRvRnJvbnQpIHtcbiAgICBzdGF0ZS5yZWFkaW5nID0gZmFsc2U7XG4gIH1cblxuICByZXR1cm4gbmVlZE1vcmVEYXRhKHN0YXRlKTtcbn1cblxuXG5cbi8vIGlmIGl0J3MgcGFzdCB0aGUgaGlnaCB3YXRlciBtYXJrLCB3ZSBjYW4gcHVzaCBpbiBzb21lIG1vcmUuXG4vLyBBbHNvLCBpZiB3ZSBoYXZlIG5vIGRhdGEgeWV0LCB3ZSBjYW4gc3RhbmQgc29tZVxuLy8gbW9yZSBieXRlcy4gIFRoaXMgaXMgdG8gd29yayBhcm91bmQgY2FzZXMgd2hlcmUgaHdtPTAsXG4vLyBzdWNoIGFzIHRoZSByZXBsLiAgQWxzbywgaWYgdGhlIHB1c2goKSB0cmlnZ2VyZWQgYVxuLy8gcmVhZGFibGUgZXZlbnQsIGFuZCB0aGUgdXNlciBjYWxsZWQgcmVhZChsYXJnZU51bWJlcikgc3VjaCB0aGF0XG4vLyBuZWVkUmVhZGFibGUgd2FzIHNldCwgdGhlbiB3ZSBvdWdodCB0byBwdXNoIG1vcmUsIHNvIHRoYXQgYW5vdGhlclxuLy8gJ3JlYWRhYmxlJyBldmVudCB3aWxsIGJlIHRyaWdnZXJlZC5cbmZ1bmN0aW9uIG5lZWRNb3JlRGF0YShzdGF0ZSkge1xuICByZXR1cm4gIXN0YXRlLmVuZGVkICYmXG4gICAgICAgICAoc3RhdGUubmVlZFJlYWRhYmxlIHx8XG4gICAgICAgICAgc3RhdGUubGVuZ3RoIDwgc3RhdGUuaGlnaFdhdGVyTWFyayB8fFxuICAgICAgICAgIHN0YXRlLmxlbmd0aCA9PT0gMCk7XG59XG5cbi8vIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5LlxuUmVhZGFibGUucHJvdG90eXBlLnNldEVuY29kaW5nID0gZnVuY3Rpb24oZW5jKSB7XG4gIGlmICghU3RyaW5nRGVjb2RlcilcbiAgICBTdHJpbmdEZWNvZGVyID0gcmVxdWlyZSgnc3RyaW5nX2RlY29kZXIvJykuU3RyaW5nRGVjb2RlcjtcbiAgdGhpcy5fcmVhZGFibGVTdGF0ZS5kZWNvZGVyID0gbmV3IFN0cmluZ0RlY29kZXIoZW5jKTtcbiAgdGhpcy5fcmVhZGFibGVTdGF0ZS5lbmNvZGluZyA9IGVuYztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBEb24ndCByYWlzZSB0aGUgaHdtID4gMTI4TUJcbnZhciBNQVhfSFdNID0gMHg4MDAwMDA7XG5mdW5jdGlvbiByb3VuZFVwVG9OZXh0UG93ZXJPZjIobikge1xuICBpZiAobiA+PSBNQVhfSFdNKSB7XG4gICAgbiA9IE1BWF9IV007XG4gIH0gZWxzZSB7XG4gICAgLy8gR2V0IHRoZSBuZXh0IGhpZ2hlc3QgcG93ZXIgb2YgMlxuICAgIG4tLTtcbiAgICBmb3IgKHZhciBwID0gMTsgcCA8IDMyOyBwIDw8PSAxKSBuIHw9IG4gPj4gcDtcbiAgICBuKys7XG4gIH1cbiAgcmV0dXJuIG47XG59XG5cbmZ1bmN0aW9uIGhvd011Y2hUb1JlYWQobiwgc3RhdGUpIHtcbiAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5lbmRlZClcbiAgICByZXR1cm4gMDtcblxuICBpZiAoc3RhdGUub2JqZWN0TW9kZSlcbiAgICByZXR1cm4gbiA9PT0gMCA/IDAgOiAxO1xuXG4gIGlmIChpc05hTihuKSB8fCB1dGlsLmlzTnVsbChuKSkge1xuICAgIC8vIG9ubHkgZmxvdyBvbmUgYnVmZmVyIGF0IGEgdGltZVxuICAgIGlmIChzdGF0ZS5mbG93aW5nICYmIHN0YXRlLmJ1ZmZlci5sZW5ndGgpXG4gICAgICByZXR1cm4gc3RhdGUuYnVmZmVyWzBdLmxlbmd0aDtcbiAgICBlbHNlXG4gICAgICByZXR1cm4gc3RhdGUubGVuZ3RoO1xuICB9XG5cbiAgaWYgKG4gPD0gMClcbiAgICByZXR1cm4gMDtcblxuICAvLyBJZiB3ZSdyZSBhc2tpbmcgZm9yIG1vcmUgdGhhbiB0aGUgdGFyZ2V0IGJ1ZmZlciBsZXZlbCxcbiAgLy8gdGhlbiByYWlzZSB0aGUgd2F0ZXIgbWFyay4gIEJ1bXAgdXAgdG8gdGhlIG5leHQgaGlnaGVzdFxuICAvLyBwb3dlciBvZiAyLCB0byBwcmV2ZW50IGluY3JlYXNpbmcgaXQgZXhjZXNzaXZlbHkgaW4gdGlueVxuICAvLyBhbW91bnRzLlxuICBpZiAobiA+IHN0YXRlLmhpZ2hXYXRlck1hcmspXG4gICAgc3RhdGUuaGlnaFdhdGVyTWFyayA9IHJvdW5kVXBUb05leHRQb3dlck9mMihuKTtcblxuICAvLyBkb24ndCBoYXZlIHRoYXQgbXVjaC4gIHJldHVybiBudWxsLCB1bmxlc3Mgd2UndmUgZW5kZWQuXG4gIGlmIChuID4gc3RhdGUubGVuZ3RoKSB7XG4gICAgaWYgKCFzdGF0ZS5lbmRlZCkge1xuICAgICAgc3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcbiAgICAgIHJldHVybiAwO1xuICAgIH0gZWxzZVxuICAgICAgcmV0dXJuIHN0YXRlLmxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBuO1xufVxuXG4vLyB5b3UgY2FuIG92ZXJyaWRlIGVpdGhlciB0aGlzIG1ldGhvZCwgb3IgdGhlIGFzeW5jIF9yZWFkKG4pIGJlbG93LlxuUmVhZGFibGUucHJvdG90eXBlLnJlYWQgPSBmdW5jdGlvbihuKSB7XG4gIGRlYnVnKCdyZWFkJywgbik7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIHZhciBuT3JpZyA9IG47XG5cbiAgaWYgKCF1dGlsLmlzTnVtYmVyKG4pIHx8IG4gPiAwKVxuICAgIHN0YXRlLmVtaXR0ZWRSZWFkYWJsZSA9IGZhbHNlO1xuXG4gIC8vIGlmIHdlJ3JlIGRvaW5nIHJlYWQoMCkgdG8gdHJpZ2dlciBhIHJlYWRhYmxlIGV2ZW50LCBidXQgd2VcbiAgLy8gYWxyZWFkeSBoYXZlIGEgYnVuY2ggb2YgZGF0YSBpbiB0aGUgYnVmZmVyLCB0aGVuIGp1c3QgdHJpZ2dlclxuICAvLyB0aGUgJ3JlYWRhYmxlJyBldmVudCBhbmQgbW92ZSBvbi5cbiAgaWYgKG4gPT09IDAgJiZcbiAgICAgIHN0YXRlLm5lZWRSZWFkYWJsZSAmJlxuICAgICAgKHN0YXRlLmxlbmd0aCA+PSBzdGF0ZS5oaWdoV2F0ZXJNYXJrIHx8IHN0YXRlLmVuZGVkKSkge1xuICAgIGRlYnVnKCdyZWFkOiBlbWl0UmVhZGFibGUnLCBzdGF0ZS5sZW5ndGgsIHN0YXRlLmVuZGVkKTtcbiAgICBpZiAoc3RhdGUubGVuZ3RoID09PSAwICYmIHN0YXRlLmVuZGVkKVxuICAgICAgZW5kUmVhZGFibGUodGhpcyk7XG4gICAgZWxzZVxuICAgICAgZW1pdFJlYWRhYmxlKHRoaXMpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgbiA9IGhvd011Y2hUb1JlYWQobiwgc3RhdGUpO1xuXG4gIC8vIGlmIHdlJ3ZlIGVuZGVkLCBhbmQgd2UncmUgbm93IGNsZWFyLCB0aGVuIGZpbmlzaCBpdCB1cC5cbiAgaWYgKG4gPT09IDAgJiYgc3RhdGUuZW5kZWQpIHtcbiAgICBpZiAoc3RhdGUubGVuZ3RoID09PSAwKVxuICAgICAgZW5kUmVhZGFibGUodGhpcyk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBBbGwgdGhlIGFjdHVhbCBjaHVuayBnZW5lcmF0aW9uIGxvZ2ljIG5lZWRzIHRvIGJlXG4gIC8vICpiZWxvdyogdGhlIGNhbGwgdG8gX3JlYWQuICBUaGUgcmVhc29uIGlzIHRoYXQgaW4gY2VydGFpblxuICAvLyBzeW50aGV0aWMgc3RyZWFtIGNhc2VzLCBzdWNoIGFzIHBhc3N0aHJvdWdoIHN0cmVhbXMsIF9yZWFkXG4gIC8vIG1heSBiZSBhIGNvbXBsZXRlbHkgc3luY2hyb25vdXMgb3BlcmF0aW9uIHdoaWNoIG1heSBjaGFuZ2VcbiAgLy8gdGhlIHN0YXRlIG9mIHRoZSByZWFkIGJ1ZmZlciwgcHJvdmlkaW5nIGVub3VnaCBkYXRhIHdoZW5cbiAgLy8gYmVmb3JlIHRoZXJlIHdhcyAqbm90KiBlbm91Z2guXG4gIC8vXG4gIC8vIFNvLCB0aGUgc3RlcHMgYXJlOlxuICAvLyAxLiBGaWd1cmUgb3V0IHdoYXQgdGhlIHN0YXRlIG9mIHRoaW5ncyB3aWxsIGJlIGFmdGVyIHdlIGRvXG4gIC8vIGEgcmVhZCBmcm9tIHRoZSBidWZmZXIuXG4gIC8vXG4gIC8vIDIuIElmIHRoYXQgcmVzdWx0aW5nIHN0YXRlIHdpbGwgdHJpZ2dlciBhIF9yZWFkLCB0aGVuIGNhbGwgX3JlYWQuXG4gIC8vIE5vdGUgdGhhdCB0aGlzIG1heSBiZSBhc3luY2hyb25vdXMsIG9yIHN5bmNocm9ub3VzLiAgWWVzLCBpdCBpc1xuICAvLyBkZWVwbHkgdWdseSB0byB3cml0ZSBBUElzIHRoaXMgd2F5LCBidXQgdGhhdCBzdGlsbCBkb2Vzbid0IG1lYW5cbiAgLy8gdGhhdCB0aGUgUmVhZGFibGUgY2xhc3Mgc2hvdWxkIGJlaGF2ZSBpbXByb3Blcmx5LCBhcyBzdHJlYW1zIGFyZVxuICAvLyBkZXNpZ25lZCB0byBiZSBzeW5jL2FzeW5jIGFnbm9zdGljLlxuICAvLyBUYWtlIG5vdGUgaWYgdGhlIF9yZWFkIGNhbGwgaXMgc3luYyBvciBhc3luYyAoaWUsIGlmIHRoZSByZWFkIGNhbGxcbiAgLy8gaGFzIHJldHVybmVkIHlldCksIHNvIHRoYXQgd2Uga25vdyB3aGV0aGVyIG9yIG5vdCBpdCdzIHNhZmUgdG8gZW1pdFxuICAvLyAncmVhZGFibGUnIGV0Yy5cbiAgLy9cbiAgLy8gMy4gQWN0dWFsbHkgcHVsbCB0aGUgcmVxdWVzdGVkIGNodW5rcyBvdXQgb2YgdGhlIGJ1ZmZlciBhbmQgcmV0dXJuLlxuXG4gIC8vIGlmIHdlIG5lZWQgYSByZWFkYWJsZSBldmVudCwgdGhlbiB3ZSBuZWVkIHRvIGRvIHNvbWUgcmVhZGluZy5cbiAgdmFyIGRvUmVhZCA9IHN0YXRlLm5lZWRSZWFkYWJsZTtcbiAgZGVidWcoJ25lZWQgcmVhZGFibGUnLCBkb1JlYWQpO1xuXG4gIC8vIGlmIHdlIGN1cnJlbnRseSBoYXZlIGxlc3MgdGhhbiB0aGUgaGlnaFdhdGVyTWFyaywgdGhlbiBhbHNvIHJlYWQgc29tZVxuICBpZiAoc3RhdGUubGVuZ3RoID09PSAwIHx8IHN0YXRlLmxlbmd0aCAtIG4gPCBzdGF0ZS5oaWdoV2F0ZXJNYXJrKSB7XG4gICAgZG9SZWFkID0gdHJ1ZTtcbiAgICBkZWJ1ZygnbGVuZ3RoIGxlc3MgdGhhbiB3YXRlcm1hcmsnLCBkb1JlYWQpO1xuICB9XG5cbiAgLy8gaG93ZXZlciwgaWYgd2UndmUgZW5kZWQsIHRoZW4gdGhlcmUncyBubyBwb2ludCwgYW5kIGlmIHdlJ3JlIGFscmVhZHlcbiAgLy8gcmVhZGluZywgdGhlbiBpdCdzIHVubmVjZXNzYXJ5LlxuICBpZiAoc3RhdGUuZW5kZWQgfHwgc3RhdGUucmVhZGluZykge1xuICAgIGRvUmVhZCA9IGZhbHNlO1xuICAgIGRlYnVnKCdyZWFkaW5nIG9yIGVuZGVkJywgZG9SZWFkKTtcbiAgfVxuXG4gIGlmIChkb1JlYWQpIHtcbiAgICBkZWJ1ZygnZG8gcmVhZCcpO1xuICAgIHN0YXRlLnJlYWRpbmcgPSB0cnVlO1xuICAgIHN0YXRlLnN5bmMgPSB0cnVlO1xuICAgIC8vIGlmIHRoZSBsZW5ndGggaXMgY3VycmVudGx5IHplcm8sIHRoZW4gd2UgKm5lZWQqIGEgcmVhZGFibGUgZXZlbnQuXG4gICAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMClcbiAgICAgIHN0YXRlLm5lZWRSZWFkYWJsZSA9IHRydWU7XG4gICAgLy8gY2FsbCBpbnRlcm5hbCByZWFkIG1ldGhvZFxuICAgIHRoaXMuX3JlYWQoc3RhdGUuaGlnaFdhdGVyTWFyayk7XG4gICAgc3RhdGUuc3luYyA9IGZhbHNlO1xuICB9XG5cbiAgLy8gSWYgX3JlYWQgcHVzaGVkIGRhdGEgc3luY2hyb25vdXNseSwgdGhlbiBgcmVhZGluZ2Agd2lsbCBiZSBmYWxzZSxcbiAgLy8gYW5kIHdlIG5lZWQgdG8gcmUtZXZhbHVhdGUgaG93IG11Y2ggZGF0YSB3ZSBjYW4gcmV0dXJuIHRvIHRoZSB1c2VyLlxuICBpZiAoZG9SZWFkICYmICFzdGF0ZS5yZWFkaW5nKVxuICAgIG4gPSBob3dNdWNoVG9SZWFkKG5PcmlnLCBzdGF0ZSk7XG5cbiAgdmFyIHJldDtcbiAgaWYgKG4gPiAwKVxuICAgIHJldCA9IGZyb21MaXN0KG4sIHN0YXRlKTtcbiAgZWxzZVxuICAgIHJldCA9IG51bGw7XG5cbiAgaWYgKHV0aWwuaXNOdWxsKHJldCkpIHtcbiAgICBzdGF0ZS5uZWVkUmVhZGFibGUgPSB0cnVlO1xuICAgIG4gPSAwO1xuICB9XG5cbiAgc3RhdGUubGVuZ3RoIC09IG47XG5cbiAgLy8gSWYgd2UgaGF2ZSBub3RoaW5nIGluIHRoZSBidWZmZXIsIHRoZW4gd2Ugd2FudCB0byBrbm93XG4gIC8vIGFzIHNvb24gYXMgd2UgKmRvKiBnZXQgc29tZXRoaW5nIGludG8gdGhlIGJ1ZmZlci5cbiAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMCAmJiAhc3RhdGUuZW5kZWQpXG4gICAgc3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcblxuICAvLyBJZiB3ZSB0cmllZCB0byByZWFkKCkgcGFzdCB0aGUgRU9GLCB0aGVuIGVtaXQgZW5kIG9uIHRoZSBuZXh0IHRpY2suXG4gIGlmIChuT3JpZyAhPT0gbiAmJiBzdGF0ZS5lbmRlZCAmJiBzdGF0ZS5sZW5ndGggPT09IDApXG4gICAgZW5kUmVhZGFibGUodGhpcyk7XG5cbiAgaWYgKCF1dGlsLmlzTnVsbChyZXQpKVxuICAgIHRoaXMuZW1pdCgnZGF0YScsIHJldCk7XG5cbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIGNodW5rSW52YWxpZChzdGF0ZSwgY2h1bmspIHtcbiAgdmFyIGVyID0gbnVsbDtcbiAgaWYgKCF1dGlsLmlzQnVmZmVyKGNodW5rKSAmJlxuICAgICAgIXV0aWwuaXNTdHJpbmcoY2h1bmspICYmXG4gICAgICAhdXRpbC5pc051bGxPclVuZGVmaW5lZChjaHVuaykgJiZcbiAgICAgICFzdGF0ZS5vYmplY3RNb2RlKSB7XG4gICAgZXIgPSBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIG5vbi1zdHJpbmcvYnVmZmVyIGNodW5rJyk7XG4gIH1cbiAgcmV0dXJuIGVyO1xufVxuXG5cbmZ1bmN0aW9uIG9uRW9mQ2h1bmsoc3RyZWFtLCBzdGF0ZSkge1xuICBpZiAoc3RhdGUuZGVjb2RlciAmJiAhc3RhdGUuZW5kZWQpIHtcbiAgICB2YXIgY2h1bmsgPSBzdGF0ZS5kZWNvZGVyLmVuZCgpO1xuICAgIGlmIChjaHVuayAmJiBjaHVuay5sZW5ndGgpIHtcbiAgICAgIHN0YXRlLmJ1ZmZlci5wdXNoKGNodW5rKTtcbiAgICAgIHN0YXRlLmxlbmd0aCArPSBzdGF0ZS5vYmplY3RNb2RlID8gMSA6IGNodW5rLmxlbmd0aDtcbiAgICB9XG4gIH1cbiAgc3RhdGUuZW5kZWQgPSB0cnVlO1xuXG4gIC8vIGVtaXQgJ3JlYWRhYmxlJyBub3cgdG8gbWFrZSBzdXJlIGl0IGdldHMgcGlja2VkIHVwLlxuICBlbWl0UmVhZGFibGUoc3RyZWFtKTtcbn1cblxuLy8gRG9uJ3QgZW1pdCByZWFkYWJsZSByaWdodCBhd2F5IGluIHN5bmMgbW9kZSwgYmVjYXVzZSB0aGlzIGNhbiB0cmlnZ2VyXG4vLyBhbm90aGVyIHJlYWQoKSBjYWxsID0+IHN0YWNrIG92ZXJmbG93LiAgVGhpcyB3YXksIGl0IG1pZ2h0IHRyaWdnZXJcbi8vIGEgbmV4dFRpY2sgcmVjdXJzaW9uIHdhcm5pbmcsIGJ1dCB0aGF0J3Mgbm90IHNvIGJhZC5cbmZ1bmN0aW9uIGVtaXRSZWFkYWJsZShzdHJlYW0pIHtcbiAgdmFyIHN0YXRlID0gc3RyZWFtLl9yZWFkYWJsZVN0YXRlO1xuICBzdGF0ZS5uZWVkUmVhZGFibGUgPSBmYWxzZTtcbiAgaWYgKCFzdGF0ZS5lbWl0dGVkUmVhZGFibGUpIHtcbiAgICBkZWJ1ZygnZW1pdFJlYWRhYmxlJywgc3RhdGUuZmxvd2luZyk7XG4gICAgc3RhdGUuZW1pdHRlZFJlYWRhYmxlID0gdHJ1ZTtcbiAgICBpZiAoc3RhdGUuc3luYylcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24oKSB7XG4gICAgICAgIGVtaXRSZWFkYWJsZV8oc3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIGVsc2VcbiAgICAgIGVtaXRSZWFkYWJsZV8oc3RyZWFtKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbWl0UmVhZGFibGVfKHN0cmVhbSkge1xuICBkZWJ1ZygnZW1pdCByZWFkYWJsZScpO1xuICBzdHJlYW0uZW1pdCgncmVhZGFibGUnKTtcbiAgZmxvdyhzdHJlYW0pO1xufVxuXG5cbi8vIGF0IHRoaXMgcG9pbnQsIHRoZSB1c2VyIGhhcyBwcmVzdW1hYmx5IHNlZW4gdGhlICdyZWFkYWJsZScgZXZlbnQsXG4vLyBhbmQgY2FsbGVkIHJlYWQoKSB0byBjb25zdW1lIHNvbWUgZGF0YS4gIHRoYXQgbWF5IGhhdmUgdHJpZ2dlcmVkXG4vLyBpbiB0dXJuIGFub3RoZXIgX3JlYWQobikgY2FsbCwgaW4gd2hpY2ggY2FzZSByZWFkaW5nID0gdHJ1ZSBpZlxuLy8gaXQncyBpbiBwcm9ncmVzcy5cbi8vIEhvd2V2ZXIsIGlmIHdlJ3JlIG5vdCBlbmRlZCwgb3IgcmVhZGluZywgYW5kIHRoZSBsZW5ndGggPCBod20sXG4vLyB0aGVuIGdvIGFoZWFkIGFuZCB0cnkgdG8gcmVhZCBzb21lIG1vcmUgcHJlZW1wdGl2ZWx5LlxuZnVuY3Rpb24gbWF5YmVSZWFkTW9yZShzdHJlYW0sIHN0YXRlKSB7XG4gIGlmICghc3RhdGUucmVhZGluZ01vcmUpIHtcbiAgICBzdGF0ZS5yZWFkaW5nTW9yZSA9IHRydWU7XG4gICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbigpIHtcbiAgICAgIG1heWJlUmVhZE1vcmVfKHN0cmVhbSwgc3RhdGUpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG1heWJlUmVhZE1vcmVfKHN0cmVhbSwgc3RhdGUpIHtcbiAgdmFyIGxlbiA9IHN0YXRlLmxlbmd0aDtcbiAgd2hpbGUgKCFzdGF0ZS5yZWFkaW5nICYmICFzdGF0ZS5mbG93aW5nICYmICFzdGF0ZS5lbmRlZCAmJlxuICAgICAgICAgc3RhdGUubGVuZ3RoIDwgc3RhdGUuaGlnaFdhdGVyTWFyaykge1xuICAgIGRlYnVnKCdtYXliZVJlYWRNb3JlIHJlYWQgMCcpO1xuICAgIHN0cmVhbS5yZWFkKDApO1xuICAgIGlmIChsZW4gPT09IHN0YXRlLmxlbmd0aClcbiAgICAgIC8vIGRpZG4ndCBnZXQgYW55IGRhdGEsIHN0b3Agc3Bpbm5pbmcuXG4gICAgICBicmVhaztcbiAgICBlbHNlXG4gICAgICBsZW4gPSBzdGF0ZS5sZW5ndGg7XG4gIH1cbiAgc3RhdGUucmVhZGluZ01vcmUgPSBmYWxzZTtcbn1cblxuLy8gYWJzdHJhY3QgbWV0aG9kLiAgdG8gYmUgb3ZlcnJpZGRlbiBpbiBzcGVjaWZpYyBpbXBsZW1lbnRhdGlvbiBjbGFzc2VzLlxuLy8gY2FsbCBjYihlciwgZGF0YSkgd2hlcmUgZGF0YSBpcyA8PSBuIGluIGxlbmd0aC5cbi8vIGZvciB2aXJ0dWFsIChub24tc3RyaW5nLCBub24tYnVmZmVyKSBzdHJlYW1zLCBcImxlbmd0aFwiIGlzIHNvbWV3aGF0XG4vLyBhcmJpdHJhcnksIGFuZCBwZXJoYXBzIG5vdCB2ZXJ5IG1lYW5pbmdmdWwuXG5SZWFkYWJsZS5wcm90b3R5cGUuX3JlYWQgPSBmdW5jdGlvbihuKSB7XG4gIHRoaXMuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ25vdCBpbXBsZW1lbnRlZCcpKTtcbn07XG5cblJlYWRhYmxlLnByb3RvdHlwZS5waXBlID0gZnVuY3Rpb24oZGVzdCwgcGlwZU9wdHMpIHtcbiAgdmFyIHNyYyA9IHRoaXM7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG5cbiAgc3dpdGNoIChzdGF0ZS5waXBlc0NvdW50KSB7XG4gICAgY2FzZSAwOlxuICAgICAgc3RhdGUucGlwZXMgPSBkZXN0O1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxOlxuICAgICAgc3RhdGUucGlwZXMgPSBbc3RhdGUucGlwZXMsIGRlc3RdO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIHN0YXRlLnBpcGVzLnB1c2goZGVzdCk7XG4gICAgICBicmVhaztcbiAgfVxuICBzdGF0ZS5waXBlc0NvdW50ICs9IDE7XG4gIGRlYnVnKCdwaXBlIGNvdW50PSVkIG9wdHM9JWonLCBzdGF0ZS5waXBlc0NvdW50LCBwaXBlT3B0cyk7XG5cbiAgdmFyIGRvRW5kID0gKCFwaXBlT3B0cyB8fCBwaXBlT3B0cy5lbmQgIT09IGZhbHNlKSAmJlxuICAgICAgICAgICAgICBkZXN0ICE9PSBwcm9jZXNzLnN0ZG91dCAmJlxuICAgICAgICAgICAgICBkZXN0ICE9PSBwcm9jZXNzLnN0ZGVycjtcblxuICB2YXIgZW5kRm4gPSBkb0VuZCA/IG9uZW5kIDogY2xlYW51cDtcbiAgaWYgKHN0YXRlLmVuZEVtaXR0ZWQpXG4gICAgcHJvY2Vzcy5uZXh0VGljayhlbmRGbik7XG4gIGVsc2VcbiAgICBzcmMub25jZSgnZW5kJywgZW5kRm4pO1xuXG4gIGRlc3Qub24oJ3VucGlwZScsIG9udW5waXBlKTtcbiAgZnVuY3Rpb24gb251bnBpcGUocmVhZGFibGUpIHtcbiAgICBkZWJ1Zygnb251bnBpcGUnKTtcbiAgICBpZiAocmVhZGFibGUgPT09IHNyYykge1xuICAgICAgY2xlYW51cCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIG9uZW5kKCkge1xuICAgIGRlYnVnKCdvbmVuZCcpO1xuICAgIGRlc3QuZW5kKCk7XG4gIH1cblxuICAvLyB3aGVuIHRoZSBkZXN0IGRyYWlucywgaXQgcmVkdWNlcyB0aGUgYXdhaXREcmFpbiBjb3VudGVyXG4gIC8vIG9uIHRoZSBzb3VyY2UuICBUaGlzIHdvdWxkIGJlIG1vcmUgZWxlZ2FudCB3aXRoIGEgLm9uY2UoKVxuICAvLyBoYW5kbGVyIGluIGZsb3coKSwgYnV0IGFkZGluZyBhbmQgcmVtb3ZpbmcgcmVwZWF0ZWRseSBpc1xuICAvLyB0b28gc2xvdy5cbiAgdmFyIG9uZHJhaW4gPSBwaXBlT25EcmFpbihzcmMpO1xuICBkZXN0Lm9uKCdkcmFpbicsIG9uZHJhaW4pO1xuXG4gIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgZGVidWcoJ2NsZWFudXAnKTtcbiAgICAvLyBjbGVhbnVwIGV2ZW50IGhhbmRsZXJzIG9uY2UgdGhlIHBpcGUgaXMgYnJva2VuXG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignY2xvc2UnLCBvbmNsb3NlKTtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdmaW5pc2gnLCBvbmZpbmlzaCk7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZHJhaW4nLCBvbmRyYWluKTtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdlcnJvcicsIG9uZXJyb3IpO1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ3VucGlwZScsIG9udW5waXBlKTtcbiAgICBzcmMucmVtb3ZlTGlzdGVuZXIoJ2VuZCcsIG9uZW5kKTtcbiAgICBzcmMucmVtb3ZlTGlzdGVuZXIoJ2VuZCcsIGNsZWFudXApO1xuICAgIHNyYy5yZW1vdmVMaXN0ZW5lcignZGF0YScsIG9uZGF0YSk7XG5cbiAgICAvLyBpZiB0aGUgcmVhZGVyIGlzIHdhaXRpbmcgZm9yIGEgZHJhaW4gZXZlbnQgZnJvbSB0aGlzXG4gICAgLy8gc3BlY2lmaWMgd3JpdGVyLCB0aGVuIGl0IHdvdWxkIGNhdXNlIGl0IHRvIG5ldmVyIHN0YXJ0XG4gICAgLy8gZmxvd2luZyBhZ2Fpbi5cbiAgICAvLyBTbywgaWYgdGhpcyBpcyBhd2FpdGluZyBhIGRyYWluLCB0aGVuIHdlIGp1c3QgY2FsbCBpdCBub3cuXG4gICAgLy8gSWYgd2UgZG9uJ3Qga25vdywgdGhlbiBhc3N1bWUgdGhhdCB3ZSBhcmUgd2FpdGluZyBmb3Igb25lLlxuICAgIGlmIChzdGF0ZS5hd2FpdERyYWluICYmXG4gICAgICAgICghZGVzdC5fd3JpdGFibGVTdGF0ZSB8fCBkZXN0Ll93cml0YWJsZVN0YXRlLm5lZWREcmFpbikpXG4gICAgICBvbmRyYWluKCk7XG4gIH1cblxuICBzcmMub24oJ2RhdGEnLCBvbmRhdGEpO1xuICBmdW5jdGlvbiBvbmRhdGEoY2h1bmspIHtcbiAgICBkZWJ1Zygnb25kYXRhJyk7XG4gICAgdmFyIHJldCA9IGRlc3Qud3JpdGUoY2h1bmspO1xuICAgIGlmIChmYWxzZSA9PT0gcmV0KSB7XG4gICAgICBkZWJ1ZygnZmFsc2Ugd3JpdGUgcmVzcG9uc2UsIHBhdXNlJyxcbiAgICAgICAgICAgIHNyYy5fcmVhZGFibGVTdGF0ZS5hd2FpdERyYWluKTtcbiAgICAgIHNyYy5fcmVhZGFibGVTdGF0ZS5hd2FpdERyYWluKys7XG4gICAgICBzcmMucGF1c2UoKTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiB0aGUgZGVzdCBoYXMgYW4gZXJyb3IsIHRoZW4gc3RvcCBwaXBpbmcgaW50byBpdC5cbiAgLy8gaG93ZXZlciwgZG9uJ3Qgc3VwcHJlc3MgdGhlIHRocm93aW5nIGJlaGF2aW9yIGZvciB0aGlzLlxuICBmdW5jdGlvbiBvbmVycm9yKGVyKSB7XG4gICAgZGVidWcoJ29uZXJyb3InLCBlcik7XG4gICAgdW5waXBlKCk7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZXJyb3InLCBvbmVycm9yKTtcbiAgICBpZiAoRUUubGlzdGVuZXJDb3VudChkZXN0LCAnZXJyb3InKSA9PT0gMClcbiAgICAgIGRlc3QuZW1pdCgnZXJyb3InLCBlcik7XG4gIH1cbiAgLy8gVGhpcyBpcyBhIGJydXRhbGx5IHVnbHkgaGFjayB0byBtYWtlIHN1cmUgdGhhdCBvdXIgZXJyb3IgaGFuZGxlclxuICAvLyBpcyBhdHRhY2hlZCBiZWZvcmUgYW55IHVzZXJsYW5kIG9uZXMuICBORVZFUiBETyBUSElTLlxuICBpZiAoIWRlc3QuX2V2ZW50cyB8fCAhZGVzdC5fZXZlbnRzLmVycm9yKVxuICAgIGRlc3Qub24oJ2Vycm9yJywgb25lcnJvcik7XG4gIGVsc2UgaWYgKGlzQXJyYXkoZGVzdC5fZXZlbnRzLmVycm9yKSlcbiAgICBkZXN0Ll9ldmVudHMuZXJyb3IudW5zaGlmdChvbmVycm9yKTtcbiAgZWxzZVxuICAgIGRlc3QuX2V2ZW50cy5lcnJvciA9IFtvbmVycm9yLCBkZXN0Ll9ldmVudHMuZXJyb3JdO1xuXG5cblxuICAvLyBCb3RoIGNsb3NlIGFuZCBmaW5pc2ggc2hvdWxkIHRyaWdnZXIgdW5waXBlLCBidXQgb25seSBvbmNlLlxuICBmdW5jdGlvbiBvbmNsb3NlKCkge1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ2ZpbmlzaCcsIG9uZmluaXNoKTtcbiAgICB1bnBpcGUoKTtcbiAgfVxuICBkZXN0Lm9uY2UoJ2Nsb3NlJywgb25jbG9zZSk7XG4gIGZ1bmN0aW9uIG9uZmluaXNoKCkge1xuICAgIGRlYnVnKCdvbmZpbmlzaCcpO1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ2Nsb3NlJywgb25jbG9zZSk7XG4gICAgdW5waXBlKCk7XG4gIH1cbiAgZGVzdC5vbmNlKCdmaW5pc2gnLCBvbmZpbmlzaCk7XG5cbiAgZnVuY3Rpb24gdW5waXBlKCkge1xuICAgIGRlYnVnKCd1bnBpcGUnKTtcbiAgICBzcmMudW5waXBlKGRlc3QpO1xuICB9XG5cbiAgLy8gdGVsbCB0aGUgZGVzdCB0aGF0IGl0J3MgYmVpbmcgcGlwZWQgdG9cbiAgZGVzdC5lbWl0KCdwaXBlJywgc3JjKTtcblxuICAvLyBzdGFydCB0aGUgZmxvdyBpZiBpdCBoYXNuJ3QgYmVlbiBzdGFydGVkIGFscmVhZHkuXG4gIGlmICghc3RhdGUuZmxvd2luZykge1xuICAgIGRlYnVnKCdwaXBlIHJlc3VtZScpO1xuICAgIHNyYy5yZXN1bWUoKTtcbiAgfVxuXG4gIHJldHVybiBkZXN0O1xufTtcblxuZnVuY3Rpb24gcGlwZU9uRHJhaW4oc3JjKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RhdGUgPSBzcmMuX3JlYWRhYmxlU3RhdGU7XG4gICAgZGVidWcoJ3BpcGVPbkRyYWluJywgc3RhdGUuYXdhaXREcmFpbik7XG4gICAgaWYgKHN0YXRlLmF3YWl0RHJhaW4pXG4gICAgICBzdGF0ZS5hd2FpdERyYWluLS07XG4gICAgaWYgKHN0YXRlLmF3YWl0RHJhaW4gPT09IDAgJiYgRUUubGlzdGVuZXJDb3VudChzcmMsICdkYXRhJykpIHtcbiAgICAgIHN0YXRlLmZsb3dpbmcgPSB0cnVlO1xuICAgICAgZmxvdyhzcmMpO1xuICAgIH1cbiAgfTtcbn1cblxuXG5SZWFkYWJsZS5wcm90b3R5cGUudW5waXBlID0gZnVuY3Rpb24oZGVzdCkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl9yZWFkYWJsZVN0YXRlO1xuXG4gIC8vIGlmIHdlJ3JlIG5vdCBwaXBpbmcgYW55d2hlcmUsIHRoZW4gZG8gbm90aGluZy5cbiAgaWYgKHN0YXRlLnBpcGVzQ291bnQgPT09IDApXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8ganVzdCBvbmUgZGVzdGluYXRpb24uICBtb3N0IGNvbW1vbiBjYXNlLlxuICBpZiAoc3RhdGUucGlwZXNDb3VudCA9PT0gMSkge1xuICAgIC8vIHBhc3NlZCBpbiBvbmUsIGJ1dCBpdCdzIG5vdCB0aGUgcmlnaHQgb25lLlxuICAgIGlmIChkZXN0ICYmIGRlc3QgIT09IHN0YXRlLnBpcGVzKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAoIWRlc3QpXG4gICAgICBkZXN0ID0gc3RhdGUucGlwZXM7XG5cbiAgICAvLyBnb3QgYSBtYXRjaC5cbiAgICBzdGF0ZS5waXBlcyA9IG51bGw7XG4gICAgc3RhdGUucGlwZXNDb3VudCA9IDA7XG4gICAgc3RhdGUuZmxvd2luZyA9IGZhbHNlO1xuICAgIGlmIChkZXN0KVxuICAgICAgZGVzdC5lbWl0KCd1bnBpcGUnLCB0aGlzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHNsb3cgY2FzZS4gbXVsdGlwbGUgcGlwZSBkZXN0aW5hdGlvbnMuXG5cbiAgaWYgKCFkZXN0KSB7XG4gICAgLy8gcmVtb3ZlIGFsbC5cbiAgICB2YXIgZGVzdHMgPSBzdGF0ZS5waXBlcztcbiAgICB2YXIgbGVuID0gc3RhdGUucGlwZXNDb3VudDtcbiAgICBzdGF0ZS5waXBlcyA9IG51bGw7XG4gICAgc3RhdGUucGlwZXNDb3VudCA9IDA7XG4gICAgc3RhdGUuZmxvd2luZyA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGRlc3RzW2ldLmVtaXQoJ3VucGlwZScsIHRoaXMpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gdHJ5IHRvIGZpbmQgdGhlIHJpZ2h0IG9uZS5cbiAgdmFyIGkgPSBpbmRleE9mKHN0YXRlLnBpcGVzLCBkZXN0KTtcbiAgaWYgKGkgPT09IC0xKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIHN0YXRlLnBpcGVzLnNwbGljZShpLCAxKTtcbiAgc3RhdGUucGlwZXNDb3VudCAtPSAxO1xuICBpZiAoc3RhdGUucGlwZXNDb3VudCA9PT0gMSlcbiAgICBzdGF0ZS5waXBlcyA9IHN0YXRlLnBpcGVzWzBdO1xuXG4gIGRlc3QuZW1pdCgndW5waXBlJywgdGhpcyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBzZXQgdXAgZGF0YSBldmVudHMgaWYgdGhleSBhcmUgYXNrZWQgZm9yXG4vLyBFbnN1cmUgcmVhZGFibGUgbGlzdGVuZXJzIGV2ZW50dWFsbHkgZ2V0IHNvbWV0aGluZ1xuUmVhZGFibGUucHJvdG90eXBlLm9uID0gZnVuY3Rpb24oZXYsIGZuKSB7XG4gIHZhciByZXMgPSBTdHJlYW0ucHJvdG90eXBlLm9uLmNhbGwodGhpcywgZXYsIGZuKTtcblxuICAvLyBJZiBsaXN0ZW5pbmcgdG8gZGF0YSwgYW5kIGl0IGhhcyBub3QgZXhwbGljaXRseSBiZWVuIHBhdXNlZCxcbiAgLy8gdGhlbiBjYWxsIHJlc3VtZSB0byBzdGFydCB0aGUgZmxvdyBvZiBkYXRhIG9uIHRoZSBuZXh0IHRpY2suXG4gIGlmIChldiA9PT0gJ2RhdGEnICYmIGZhbHNlICE9PSB0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcpIHtcbiAgICB0aGlzLnJlc3VtZSgpO1xuICB9XG5cbiAgaWYgKGV2ID09PSAncmVhZGFibGUnICYmIHRoaXMucmVhZGFibGUpIHtcbiAgICB2YXIgc3RhdGUgPSB0aGlzLl9yZWFkYWJsZVN0YXRlO1xuICAgIGlmICghc3RhdGUucmVhZGFibGVMaXN0ZW5pbmcpIHtcbiAgICAgIHN0YXRlLnJlYWRhYmxlTGlzdGVuaW5nID0gdHJ1ZTtcbiAgICAgIHN0YXRlLmVtaXR0ZWRSZWFkYWJsZSA9IGZhbHNlO1xuICAgICAgc3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcbiAgICAgIGlmICghc3RhdGUucmVhZGluZykge1xuICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZGVidWcoJ3JlYWRhYmxlIG5leHR0aWNrIHJlYWQgMCcpO1xuICAgICAgICAgIHNlbGYucmVhZCgwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmxlbmd0aCkge1xuICAgICAgICBlbWl0UmVhZGFibGUodGhpcywgc3RhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXM7XG59O1xuUmVhZGFibGUucHJvdG90eXBlLmFkZExpc3RlbmVyID0gUmVhZGFibGUucHJvdG90eXBlLm9uO1xuXG4vLyBwYXVzZSgpIGFuZCByZXN1bWUoKSBhcmUgcmVtbmFudHMgb2YgdGhlIGxlZ2FjeSByZWFkYWJsZSBzdHJlYW0gQVBJXG4vLyBJZiB0aGUgdXNlciB1c2VzIHRoZW0sIHRoZW4gc3dpdGNoIGludG8gb2xkIG1vZGUuXG5SZWFkYWJsZS5wcm90b3R5cGUucmVzdW1lID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIGlmICghc3RhdGUuZmxvd2luZykge1xuICAgIGRlYnVnKCdyZXN1bWUnKTtcbiAgICBzdGF0ZS5mbG93aW5nID0gdHJ1ZTtcbiAgICBpZiAoIXN0YXRlLnJlYWRpbmcpIHtcbiAgICAgIGRlYnVnKCdyZXN1bWUgcmVhZCAwJyk7XG4gICAgICB0aGlzLnJlYWQoMCk7XG4gICAgfVxuICAgIHJlc3VtZSh0aGlzLCBzdGF0ZSk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5mdW5jdGlvbiByZXN1bWUoc3RyZWFtLCBzdGF0ZSkge1xuICBpZiAoIXN0YXRlLnJlc3VtZVNjaGVkdWxlZCkge1xuICAgIHN0YXRlLnJlc3VtZVNjaGVkdWxlZCA9IHRydWU7XG4gICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbigpIHtcbiAgICAgIHJlc3VtZV8oc3RyZWFtLCBzdGF0ZSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzdW1lXyhzdHJlYW0sIHN0YXRlKSB7XG4gIHN0YXRlLnJlc3VtZVNjaGVkdWxlZCA9IGZhbHNlO1xuICBzdHJlYW0uZW1pdCgncmVzdW1lJyk7XG4gIGZsb3coc3RyZWFtKTtcbiAgaWYgKHN0YXRlLmZsb3dpbmcgJiYgIXN0YXRlLnJlYWRpbmcpXG4gICAgc3RyZWFtLnJlYWQoMCk7XG59XG5cblJlYWRhYmxlLnByb3RvdHlwZS5wYXVzZSA9IGZ1bmN0aW9uKCkge1xuICBkZWJ1ZygnY2FsbCBwYXVzZSBmbG93aW5nPSVqJywgdGhpcy5fcmVhZGFibGVTdGF0ZS5mbG93aW5nKTtcbiAgaWYgKGZhbHNlICE9PSB0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcpIHtcbiAgICBkZWJ1ZygncGF1c2UnKTtcbiAgICB0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcgPSBmYWxzZTtcbiAgICB0aGlzLmVtaXQoJ3BhdXNlJyk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5mdW5jdGlvbiBmbG93KHN0cmVhbSkge1xuICB2YXIgc3RhdGUgPSBzdHJlYW0uX3JlYWRhYmxlU3RhdGU7XG4gIGRlYnVnKCdmbG93Jywgc3RhdGUuZmxvd2luZyk7XG4gIGlmIChzdGF0ZS5mbG93aW5nKSB7XG4gICAgZG8ge1xuICAgICAgdmFyIGNodW5rID0gc3RyZWFtLnJlYWQoKTtcbiAgICB9IHdoaWxlIChudWxsICE9PSBjaHVuayAmJiBzdGF0ZS5mbG93aW5nKTtcbiAgfVxufVxuXG4vLyB3cmFwIGFuIG9sZC1zdHlsZSBzdHJlYW0gYXMgdGhlIGFzeW5jIGRhdGEgc291cmNlLlxuLy8gVGhpcyBpcyAqbm90KiBwYXJ0IG9mIHRoZSByZWFkYWJsZSBzdHJlYW0gaW50ZXJmYWNlLlxuLy8gSXQgaXMgYW4gdWdseSB1bmZvcnR1bmF0ZSBtZXNzIG9mIGhpc3RvcnkuXG5SZWFkYWJsZS5wcm90b3R5cGUud3JhcCA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl9yZWFkYWJsZVN0YXRlO1xuICB2YXIgcGF1c2VkID0gZmFsc2U7XG5cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzdHJlYW0ub24oJ2VuZCcsIGZ1bmN0aW9uKCkge1xuICAgIGRlYnVnKCd3cmFwcGVkIGVuZCcpO1xuICAgIGlmIChzdGF0ZS5kZWNvZGVyICYmICFzdGF0ZS5lbmRlZCkge1xuICAgICAgdmFyIGNodW5rID0gc3RhdGUuZGVjb2Rlci5lbmQoKTtcbiAgICAgIGlmIChjaHVuayAmJiBjaHVuay5sZW5ndGgpXG4gICAgICAgIHNlbGYucHVzaChjaHVuayk7XG4gICAgfVxuXG4gICAgc2VsZi5wdXNoKG51bGwpO1xuICB9KTtcblxuICBzdHJlYW0ub24oJ2RhdGEnLCBmdW5jdGlvbihjaHVuaykge1xuICAgIGRlYnVnKCd3cmFwcGVkIGRhdGEnKTtcbiAgICBpZiAoc3RhdGUuZGVjb2RlcilcbiAgICAgIGNodW5rID0gc3RhdGUuZGVjb2Rlci53cml0ZShjaHVuayk7XG4gICAgaWYgKCFjaHVuayB8fCAhc3RhdGUub2JqZWN0TW9kZSAmJiAhY2h1bmsubGVuZ3RoKVxuICAgICAgcmV0dXJuO1xuXG4gICAgdmFyIHJldCA9IHNlbGYucHVzaChjaHVuayk7XG4gICAgaWYgKCFyZXQpIHtcbiAgICAgIHBhdXNlZCA9IHRydWU7XG4gICAgICBzdHJlYW0ucGF1c2UoKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIHByb3h5IGFsbCB0aGUgb3RoZXIgbWV0aG9kcy5cbiAgLy8gaW1wb3J0YW50IHdoZW4gd3JhcHBpbmcgZmlsdGVycyBhbmQgZHVwbGV4ZXMuXG4gIGZvciAodmFyIGkgaW4gc3RyZWFtKSB7XG4gICAgaWYgKHV0aWwuaXNGdW5jdGlvbihzdHJlYW1baV0pICYmIHV0aWwuaXNVbmRlZmluZWQodGhpc1tpXSkpIHtcbiAgICAgIHRoaXNbaV0gPSBmdW5jdGlvbihtZXRob2QpIHsgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gc3RyZWFtW21ldGhvZF0uYXBwbHkoc3RyZWFtLCBhcmd1bWVudHMpO1xuICAgICAgfX0oaSk7XG4gICAgfVxuICB9XG5cbiAgLy8gcHJveHkgY2VydGFpbiBpbXBvcnRhbnQgZXZlbnRzLlxuICB2YXIgZXZlbnRzID0gWydlcnJvcicsICdjbG9zZScsICdkZXN0cm95JywgJ3BhdXNlJywgJ3Jlc3VtZSddO1xuICBmb3JFYWNoKGV2ZW50cywgZnVuY3Rpb24oZXYpIHtcbiAgICBzdHJlYW0ub24oZXYsIHNlbGYuZW1pdC5iaW5kKHNlbGYsIGV2KSk7XG4gIH0pO1xuXG4gIC8vIHdoZW4gd2UgdHJ5IHRvIGNvbnN1bWUgc29tZSBtb3JlIGJ5dGVzLCBzaW1wbHkgdW5wYXVzZSB0aGVcbiAgLy8gdW5kZXJseWluZyBzdHJlYW0uXG4gIHNlbGYuX3JlYWQgPSBmdW5jdGlvbihuKSB7XG4gICAgZGVidWcoJ3dyYXBwZWQgX3JlYWQnLCBuKTtcbiAgICBpZiAocGF1c2VkKSB7XG4gICAgICBwYXVzZWQgPSBmYWxzZTtcbiAgICAgIHN0cmVhbS5yZXN1bWUoKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIHNlbGY7XG59O1xuXG5cblxuLy8gZXhwb3NlZCBmb3IgdGVzdGluZyBwdXJwb3NlcyBvbmx5LlxuUmVhZGFibGUuX2Zyb21MaXN0ID0gZnJvbUxpc3Q7XG5cbi8vIFBsdWNrIG9mZiBuIGJ5dGVzIGZyb20gYW4gYXJyYXkgb2YgYnVmZmVycy5cbi8vIExlbmd0aCBpcyB0aGUgY29tYmluZWQgbGVuZ3RocyBvZiBhbGwgdGhlIGJ1ZmZlcnMgaW4gdGhlIGxpc3QuXG5mdW5jdGlvbiBmcm9tTGlzdChuLCBzdGF0ZSkge1xuICB2YXIgbGlzdCA9IHN0YXRlLmJ1ZmZlcjtcbiAgdmFyIGxlbmd0aCA9IHN0YXRlLmxlbmd0aDtcbiAgdmFyIHN0cmluZ01vZGUgPSAhIXN0YXRlLmRlY29kZXI7XG4gIHZhciBvYmplY3RNb2RlID0gISFzdGF0ZS5vYmplY3RNb2RlO1xuICB2YXIgcmV0O1xuXG4gIC8vIG5vdGhpbmcgaW4gdGhlIGxpc3QsIGRlZmluaXRlbHkgZW1wdHkuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMClcbiAgICByZXR1cm4gbnVsbDtcblxuICBpZiAobGVuZ3RoID09PSAwKVxuICAgIHJldCA9IG51bGw7XG4gIGVsc2UgaWYgKG9iamVjdE1vZGUpXG4gICAgcmV0ID0gbGlzdC5zaGlmdCgpO1xuICBlbHNlIGlmICghbiB8fCBuID49IGxlbmd0aCkge1xuICAgIC8vIHJlYWQgaXQgYWxsLCB0cnVuY2F0ZSB0aGUgYXJyYXkuXG4gICAgaWYgKHN0cmluZ01vZGUpXG4gICAgICByZXQgPSBsaXN0LmpvaW4oJycpO1xuICAgIGVsc2VcbiAgICAgIHJldCA9IEJ1ZmZlci5jb25jYXQobGlzdCwgbGVuZ3RoKTtcbiAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gIH0gZWxzZSB7XG4gICAgLy8gcmVhZCBqdXN0IHNvbWUgb2YgaXQuXG4gICAgaWYgKG4gPCBsaXN0WzBdLmxlbmd0aCkge1xuICAgICAgLy8ganVzdCB0YWtlIGEgcGFydCBvZiB0aGUgZmlyc3QgbGlzdCBpdGVtLlxuICAgICAgLy8gc2xpY2UgaXMgdGhlIHNhbWUgZm9yIGJ1ZmZlcnMgYW5kIHN0cmluZ3MuXG4gICAgICB2YXIgYnVmID0gbGlzdFswXTtcbiAgICAgIHJldCA9IGJ1Zi5zbGljZSgwLCBuKTtcbiAgICAgIGxpc3RbMF0gPSBidWYuc2xpY2Uobik7XG4gICAgfSBlbHNlIGlmIChuID09PSBsaXN0WzBdLmxlbmd0aCkge1xuICAgICAgLy8gZmlyc3QgbGlzdCBpcyBhIHBlcmZlY3QgbWF0Y2hcbiAgICAgIHJldCA9IGxpc3Quc2hpZnQoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gY29tcGxleCBjYXNlLlxuICAgICAgLy8gd2UgaGF2ZSBlbm91Z2ggdG8gY292ZXIgaXQsIGJ1dCBpdCBzcGFucyBwYXN0IHRoZSBmaXJzdCBidWZmZXIuXG4gICAgICBpZiAoc3RyaW5nTW9kZSlcbiAgICAgICAgcmV0ID0gJyc7XG4gICAgICBlbHNlXG4gICAgICAgIHJldCA9IG5ldyBCdWZmZXIobik7XG5cbiAgICAgIHZhciBjID0gMDtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gbGlzdC5sZW5ndGg7IGkgPCBsICYmIGMgPCBuOyBpKyspIHtcbiAgICAgICAgdmFyIGJ1ZiA9IGxpc3RbMF07XG4gICAgICAgIHZhciBjcHkgPSBNYXRoLm1pbihuIC0gYywgYnVmLmxlbmd0aCk7XG5cbiAgICAgICAgaWYgKHN0cmluZ01vZGUpXG4gICAgICAgICAgcmV0ICs9IGJ1Zi5zbGljZSgwLCBjcHkpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgYnVmLmNvcHkocmV0LCBjLCAwLCBjcHkpO1xuXG4gICAgICAgIGlmIChjcHkgPCBidWYubGVuZ3RoKVxuICAgICAgICAgIGxpc3RbMF0gPSBidWYuc2xpY2UoY3B5KTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgIGxpc3Quc2hpZnQoKTtcblxuICAgICAgICBjICs9IGNweTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBlbmRSZWFkYWJsZShzdHJlYW0pIHtcbiAgdmFyIHN0YXRlID0gc3RyZWFtLl9yZWFkYWJsZVN0YXRlO1xuXG4gIC8vIElmIHdlIGdldCBoZXJlIGJlZm9yZSBjb25zdW1pbmcgYWxsIHRoZSBieXRlcywgdGhlbiB0aGF0IGlzIGFcbiAgLy8gYnVnIGluIG5vZGUuICBTaG91bGQgbmV2ZXIgaGFwcGVuLlxuICBpZiAoc3RhdGUubGVuZ3RoID4gMClcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZFJlYWRhYmxlIGNhbGxlZCBvbiBub24tZW1wdHkgc3RyZWFtJyk7XG5cbiAgaWYgKCFzdGF0ZS5lbmRFbWl0dGVkKSB7XG4gICAgc3RhdGUuZW5kZWQgPSB0cnVlO1xuICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24oKSB7XG4gICAgICAvLyBDaGVjayB0aGF0IHdlIGRpZG4ndCBnZXQgb25lIGxhc3QgdW5zaGlmdC5cbiAgICAgIGlmICghc3RhdGUuZW5kRW1pdHRlZCAmJiBzdGF0ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgc3RhdGUuZW5kRW1pdHRlZCA9IHRydWU7XG4gICAgICAgIHN0cmVhbS5yZWFkYWJsZSA9IGZhbHNlO1xuICAgICAgICBzdHJlYW0uZW1pdCgnZW5kJyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9yRWFjaCAoeHMsIGYpIHtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSB4cy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICBmKHhzW2ldLCBpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbmRleE9mICh4cywgeCkge1xuICBmb3IgKHZhciBpID0gMCwgbCA9IHhzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIGlmICh4c1tpXSA9PT0geCkgcmV0dXJuIGk7XG4gIH1cbiAgcmV0dXJuIC0xO1xufVxuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cblxuLy8gYSB0cmFuc2Zvcm0gc3RyZWFtIGlzIGEgcmVhZGFibGUvd3JpdGFibGUgc3RyZWFtIHdoZXJlIHlvdSBkb1xuLy8gc29tZXRoaW5nIHdpdGggdGhlIGRhdGEuICBTb21ldGltZXMgaXQncyBjYWxsZWQgYSBcImZpbHRlclwiLFxuLy8gYnV0IHRoYXQncyBub3QgYSBncmVhdCBuYW1lIGZvciBpdCwgc2luY2UgdGhhdCBpbXBsaWVzIGEgdGhpbmcgd2hlcmVcbi8vIHNvbWUgYml0cyBwYXNzIHRocm91Z2gsIGFuZCBvdGhlcnMgYXJlIHNpbXBseSBpZ25vcmVkLiAgKFRoYXQgd291bGRcbi8vIGJlIGEgdmFsaWQgZXhhbXBsZSBvZiBhIHRyYW5zZm9ybSwgb2YgY291cnNlLilcbi8vXG4vLyBXaGlsZSB0aGUgb3V0cHV0IGlzIGNhdXNhbGx5IHJlbGF0ZWQgdG8gdGhlIGlucHV0LCBpdCdzIG5vdCBhXG4vLyBuZWNlc3NhcmlseSBzeW1tZXRyaWMgb3Igc3luY2hyb25vdXMgdHJhbnNmb3JtYXRpb24uICBGb3IgZXhhbXBsZSxcbi8vIGEgemxpYiBzdHJlYW0gbWlnaHQgdGFrZSBtdWx0aXBsZSBwbGFpbi10ZXh0IHdyaXRlcygpLCBhbmQgdGhlblxuLy8gZW1pdCBhIHNpbmdsZSBjb21wcmVzc2VkIGNodW5rIHNvbWUgdGltZSBpbiB0aGUgZnV0dXJlLlxuLy9cbi8vIEhlcmUncyBob3cgdGhpcyB3b3Jrczpcbi8vXG4vLyBUaGUgVHJhbnNmb3JtIHN0cmVhbSBoYXMgYWxsIHRoZSBhc3BlY3RzIG9mIHRoZSByZWFkYWJsZSBhbmQgd3JpdGFibGVcbi8vIHN0cmVhbSBjbGFzc2VzLiAgV2hlbiB5b3Ugd3JpdGUoY2h1bmspLCB0aGF0IGNhbGxzIF93cml0ZShjaHVuayxjYilcbi8vIGludGVybmFsbHksIGFuZCByZXR1cm5zIGZhbHNlIGlmIHRoZXJlJ3MgYSBsb3Qgb2YgcGVuZGluZyB3cml0ZXNcbi8vIGJ1ZmZlcmVkIHVwLiAgV2hlbiB5b3UgY2FsbCByZWFkKCksIHRoYXQgY2FsbHMgX3JlYWQobikgdW50aWxcbi8vIHRoZXJlJ3MgZW5vdWdoIHBlbmRpbmcgcmVhZGFibGUgZGF0YSBidWZmZXJlZCB1cC5cbi8vXG4vLyBJbiBhIHRyYW5zZm9ybSBzdHJlYW0sIHRoZSB3cml0dGVuIGRhdGEgaXMgcGxhY2VkIGluIGEgYnVmZmVyLiAgV2hlblxuLy8gX3JlYWQobikgaXMgY2FsbGVkLCBpdCB0cmFuc2Zvcm1zIHRoZSBxdWV1ZWQgdXAgZGF0YSwgY2FsbGluZyB0aGVcbi8vIGJ1ZmZlcmVkIF93cml0ZSBjYidzIGFzIGl0IGNvbnN1bWVzIGNodW5rcy4gIElmIGNvbnN1bWluZyBhIHNpbmdsZVxuLy8gd3JpdHRlbiBjaHVuayB3b3VsZCByZXN1bHQgaW4gbXVsdGlwbGUgb3V0cHV0IGNodW5rcywgdGhlbiB0aGUgZmlyc3Rcbi8vIG91dHB1dHRlZCBiaXQgY2FsbHMgdGhlIHJlYWRjYiwgYW5kIHN1YnNlcXVlbnQgY2h1bmtzIGp1c3QgZ28gaW50b1xuLy8gdGhlIHJlYWQgYnVmZmVyLCBhbmQgd2lsbCBjYXVzZSBpdCB0byBlbWl0ICdyZWFkYWJsZScgaWYgbmVjZXNzYXJ5LlxuLy9cbi8vIFRoaXMgd2F5LCBiYWNrLXByZXNzdXJlIGlzIGFjdHVhbGx5IGRldGVybWluZWQgYnkgdGhlIHJlYWRpbmcgc2lkZSxcbi8vIHNpbmNlIF9yZWFkIGhhcyB0byBiZSBjYWxsZWQgdG8gc3RhcnQgcHJvY2Vzc2luZyBhIG5ldyBjaHVuay4gIEhvd2V2ZXIsXG4vLyBhIHBhdGhvbG9naWNhbCBpbmZsYXRlIHR5cGUgb2YgdHJhbnNmb3JtIGNhbiBjYXVzZSBleGNlc3NpdmUgYnVmZmVyaW5nXG4vLyBoZXJlLiAgRm9yIGV4YW1wbGUsIGltYWdpbmUgYSBzdHJlYW0gd2hlcmUgZXZlcnkgYnl0ZSBvZiBpbnB1dCBpc1xuLy8gaW50ZXJwcmV0ZWQgYXMgYW4gaW50ZWdlciBmcm9tIDAtMjU1LCBhbmQgdGhlbiByZXN1bHRzIGluIHRoYXQgbWFueVxuLy8gYnl0ZXMgb2Ygb3V0cHV0LiAgV3JpdGluZyB0aGUgNCBieXRlcyB7ZmYsZmYsZmYsZmZ9IHdvdWxkIHJlc3VsdCBpblxuLy8gMWtiIG9mIGRhdGEgYmVpbmcgb3V0cHV0LiAgSW4gdGhpcyBjYXNlLCB5b3UgY291bGQgd3JpdGUgYSB2ZXJ5IHNtYWxsXG4vLyBhbW91bnQgb2YgaW5wdXQsIGFuZCBlbmQgdXAgd2l0aCBhIHZlcnkgbGFyZ2UgYW1vdW50IG9mIG91dHB1dC4gIEluXG4vLyBzdWNoIGEgcGF0aG9sb2dpY2FsIGluZmxhdGluZyBtZWNoYW5pc20sIHRoZXJlJ2QgYmUgbm8gd2F5IHRvIHRlbGxcbi8vIHRoZSBzeXN0ZW0gdG8gc3RvcCBkb2luZyB0aGUgdHJhbnNmb3JtLiAgQSBzaW5nbGUgNE1CIHdyaXRlIGNvdWxkXG4vLyBjYXVzZSB0aGUgc3lzdGVtIHRvIHJ1biBvdXQgb2YgbWVtb3J5LlxuLy9cbi8vIEhvd2V2ZXIsIGV2ZW4gaW4gc3VjaCBhIHBhdGhvbG9naWNhbCBjYXNlLCBvbmx5IGEgc2luZ2xlIHdyaXR0ZW4gY2h1bmtcbi8vIHdvdWxkIGJlIGNvbnN1bWVkLCBhbmQgdGhlbiB0aGUgcmVzdCB3b3VsZCB3YWl0ICh1bi10cmFuc2Zvcm1lZCkgdW50aWxcbi8vIHRoZSByZXN1bHRzIG9mIHRoZSBwcmV2aW91cyB0cmFuc2Zvcm1lZCBjaHVuayB3ZXJlIGNvbnN1bWVkLlxuXG5tb2R1bGUuZXhwb3J0cyA9IFRyYW5zZm9ybTtcblxudmFyIER1cGxleCA9IHJlcXVpcmUoJy4vX3N0cmVhbV9kdXBsZXgnKTtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciB1dGlsID0gcmVxdWlyZSgnY29yZS11dGlsLWlzJyk7XG51dGlsLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG51dGlsLmluaGVyaXRzKFRyYW5zZm9ybSwgRHVwbGV4KTtcblxuXG5mdW5jdGlvbiBUcmFuc2Zvcm1TdGF0ZShvcHRpb25zLCBzdHJlYW0pIHtcbiAgdGhpcy5hZnRlclRyYW5zZm9ybSA9IGZ1bmN0aW9uKGVyLCBkYXRhKSB7XG4gICAgcmV0dXJuIGFmdGVyVHJhbnNmb3JtKHN0cmVhbSwgZXIsIGRhdGEpO1xuICB9O1xuXG4gIHRoaXMubmVlZFRyYW5zZm9ybSA9IGZhbHNlO1xuICB0aGlzLnRyYW5zZm9ybWluZyA9IGZhbHNlO1xuICB0aGlzLndyaXRlY2IgPSBudWxsO1xuICB0aGlzLndyaXRlY2h1bmsgPSBudWxsO1xufVxuXG5mdW5jdGlvbiBhZnRlclRyYW5zZm9ybShzdHJlYW0sIGVyLCBkYXRhKSB7XG4gIHZhciB0cyA9IHN0cmVhbS5fdHJhbnNmb3JtU3RhdGU7XG4gIHRzLnRyYW5zZm9ybWluZyA9IGZhbHNlO1xuXG4gIHZhciBjYiA9IHRzLndyaXRlY2I7XG5cbiAgaWYgKCFjYilcbiAgICByZXR1cm4gc3RyZWFtLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdubyB3cml0ZWNiIGluIFRyYW5zZm9ybSBjbGFzcycpKTtcblxuICB0cy53cml0ZWNodW5rID0gbnVsbDtcbiAgdHMud3JpdGVjYiA9IG51bGw7XG5cbiAgaWYgKCF1dGlsLmlzTnVsbE9yVW5kZWZpbmVkKGRhdGEpKVxuICAgIHN0cmVhbS5wdXNoKGRhdGEpO1xuXG4gIGlmIChjYilcbiAgICBjYihlcik7XG5cbiAgdmFyIHJzID0gc3RyZWFtLl9yZWFkYWJsZVN0YXRlO1xuICBycy5yZWFkaW5nID0gZmFsc2U7XG4gIGlmIChycy5uZWVkUmVhZGFibGUgfHwgcnMubGVuZ3RoIDwgcnMuaGlnaFdhdGVyTWFyaykge1xuICAgIHN0cmVhbS5fcmVhZChycy5oaWdoV2F0ZXJNYXJrKTtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIFRyYW5zZm9ybShvcHRpb25zKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBUcmFuc2Zvcm0pKVxuICAgIHJldHVybiBuZXcgVHJhbnNmb3JtKG9wdGlvbnMpO1xuXG4gIER1cGxleC5jYWxsKHRoaXMsIG9wdGlvbnMpO1xuXG4gIHRoaXMuX3RyYW5zZm9ybVN0YXRlID0gbmV3IFRyYW5zZm9ybVN0YXRlKG9wdGlvbnMsIHRoaXMpO1xuXG4gIC8vIHdoZW4gdGhlIHdyaXRhYmxlIHNpZGUgZmluaXNoZXMsIHRoZW4gZmx1c2ggb3V0IGFueXRoaW5nIHJlbWFpbmluZy5cbiAgdmFyIHN0cmVhbSA9IHRoaXM7XG5cbiAgLy8gc3RhcnQgb3V0IGFza2luZyBmb3IgYSByZWFkYWJsZSBldmVudCBvbmNlIGRhdGEgaXMgdHJhbnNmb3JtZWQuXG4gIHRoaXMuX3JlYWRhYmxlU3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcblxuICAvLyB3ZSBoYXZlIGltcGxlbWVudGVkIHRoZSBfcmVhZCBtZXRob2QsIGFuZCBkb25lIHRoZSBvdGhlciB0aGluZ3NcbiAgLy8gdGhhdCBSZWFkYWJsZSB3YW50cyBiZWZvcmUgdGhlIGZpcnN0IF9yZWFkIGNhbGwsIHNvIHVuc2V0IHRoZVxuICAvLyBzeW5jIGd1YXJkIGZsYWcuXG4gIHRoaXMuX3JlYWRhYmxlU3RhdGUuc3luYyA9IGZhbHNlO1xuXG4gIHRoaXMub25jZSgncHJlZmluaXNoJywgZnVuY3Rpb24oKSB7XG4gICAgaWYgKHV0aWwuaXNGdW5jdGlvbih0aGlzLl9mbHVzaCkpXG4gICAgICB0aGlzLl9mbHVzaChmdW5jdGlvbihlcikge1xuICAgICAgICBkb25lKHN0cmVhbSwgZXIpO1xuICAgICAgfSk7XG4gICAgZWxzZVxuICAgICAgZG9uZShzdHJlYW0pO1xuICB9KTtcbn1cblxuVHJhbnNmb3JtLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oY2h1bmssIGVuY29kaW5nKSB7XG4gIHRoaXMuX3RyYW5zZm9ybVN0YXRlLm5lZWRUcmFuc2Zvcm0gPSBmYWxzZTtcbiAgcmV0dXJuIER1cGxleC5wcm90b3R5cGUucHVzaC5jYWxsKHRoaXMsIGNodW5rLCBlbmNvZGluZyk7XG59O1xuXG4vLyBUaGlzIGlzIHRoZSBwYXJ0IHdoZXJlIHlvdSBkbyBzdHVmZiFcbi8vIG92ZXJyaWRlIHRoaXMgZnVuY3Rpb24gaW4gaW1wbGVtZW50YXRpb24gY2xhc3Nlcy5cbi8vICdjaHVuaycgaXMgYW4gaW5wdXQgY2h1bmsuXG4vL1xuLy8gQ2FsbCBgcHVzaChuZXdDaHVuaylgIHRvIHBhc3MgYWxvbmcgdHJhbnNmb3JtZWQgb3V0cHV0XG4vLyB0byB0aGUgcmVhZGFibGUgc2lkZS4gIFlvdSBtYXkgY2FsbCAncHVzaCcgemVybyBvciBtb3JlIHRpbWVzLlxuLy9cbi8vIENhbGwgYGNiKGVycilgIHdoZW4geW91IGFyZSBkb25lIHdpdGggdGhpcyBjaHVuay4gIElmIHlvdSBwYXNzXG4vLyBhbiBlcnJvciwgdGhlbiB0aGF0J2xsIHB1dCB0aGUgaHVydCBvbiB0aGUgd2hvbGUgb3BlcmF0aW9uLiAgSWYgeW91XG4vLyBuZXZlciBjYWxsIGNiKCksIHRoZW4geW91J2xsIG5ldmVyIGdldCBhbm90aGVyIGNodW5rLlxuVHJhbnNmb3JtLnByb3RvdHlwZS5fdHJhbnNmb3JtID0gZnVuY3Rpb24oY2h1bmssIGVuY29kaW5nLCBjYikge1xuICB0aHJvdyBuZXcgRXJyb3IoJ25vdCBpbXBsZW1lbnRlZCcpO1xufTtcblxuVHJhbnNmb3JtLnByb3RvdHlwZS5fd3JpdGUgPSBmdW5jdGlvbihjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIHZhciB0cyA9IHRoaXMuX3RyYW5zZm9ybVN0YXRlO1xuICB0cy53cml0ZWNiID0gY2I7XG4gIHRzLndyaXRlY2h1bmsgPSBjaHVuaztcbiAgdHMud3JpdGVlbmNvZGluZyA9IGVuY29kaW5nO1xuICBpZiAoIXRzLnRyYW5zZm9ybWluZykge1xuICAgIHZhciBycyA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gICAgaWYgKHRzLm5lZWRUcmFuc2Zvcm0gfHxcbiAgICAgICAgcnMubmVlZFJlYWRhYmxlIHx8XG4gICAgICAgIHJzLmxlbmd0aCA8IHJzLmhpZ2hXYXRlck1hcmspXG4gICAgICB0aGlzLl9yZWFkKHJzLmhpZ2hXYXRlck1hcmspO1xuICB9XG59O1xuXG4vLyBEb2Vzbid0IG1hdHRlciB3aGF0IHRoZSBhcmdzIGFyZSBoZXJlLlxuLy8gX3RyYW5zZm9ybSBkb2VzIGFsbCB0aGUgd29yay5cbi8vIFRoYXQgd2UgZ290IGhlcmUgbWVhbnMgdGhhdCB0aGUgcmVhZGFibGUgc2lkZSB3YW50cyBtb3JlIGRhdGEuXG5UcmFuc2Zvcm0ucHJvdG90eXBlLl9yZWFkID0gZnVuY3Rpb24obikge1xuICB2YXIgdHMgPSB0aGlzLl90cmFuc2Zvcm1TdGF0ZTtcblxuICBpZiAoIXV0aWwuaXNOdWxsKHRzLndyaXRlY2h1bmspICYmIHRzLndyaXRlY2IgJiYgIXRzLnRyYW5zZm9ybWluZykge1xuICAgIHRzLnRyYW5zZm9ybWluZyA9IHRydWU7XG4gICAgdGhpcy5fdHJhbnNmb3JtKHRzLndyaXRlY2h1bmssIHRzLndyaXRlZW5jb2RpbmcsIHRzLmFmdGVyVHJhbnNmb3JtKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBtYXJrIHRoYXQgd2UgbmVlZCBhIHRyYW5zZm9ybSwgc28gdGhhdCBhbnkgZGF0YSB0aGF0IGNvbWVzIGluXG4gICAgLy8gd2lsbCBnZXQgcHJvY2Vzc2VkLCBub3cgdGhhdCB3ZSd2ZSBhc2tlZCBmb3IgaXQuXG4gICAgdHMubmVlZFRyYW5zZm9ybSA9IHRydWU7XG4gIH1cbn07XG5cblxuZnVuY3Rpb24gZG9uZShzdHJlYW0sIGVyKSB7XG4gIGlmIChlcilcbiAgICByZXR1cm4gc3RyZWFtLmVtaXQoJ2Vycm9yJywgZXIpO1xuXG4gIC8vIGlmIHRoZXJlJ3Mgbm90aGluZyBpbiB0aGUgd3JpdGUgYnVmZmVyLCB0aGVuIHRoYXQgbWVhbnNcbiAgLy8gdGhhdCBub3RoaW5nIG1vcmUgd2lsbCBldmVyIGJlIHByb3ZpZGVkXG4gIHZhciB3cyA9IHN0cmVhbS5fd3JpdGFibGVTdGF0ZTtcbiAgdmFyIHRzID0gc3RyZWFtLl90cmFuc2Zvcm1TdGF0ZTtcblxuICBpZiAod3MubGVuZ3RoKVxuICAgIHRocm93IG5ldyBFcnJvcignY2FsbGluZyB0cmFuc2Zvcm0gZG9uZSB3aGVuIHdzLmxlbmd0aCAhPSAwJyk7XG5cbiAgaWYgKHRzLnRyYW5zZm9ybWluZylcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbGxpbmcgdHJhbnNmb3JtIGRvbmUgd2hlbiBzdGlsbCB0cmFuc2Zvcm1pbmcnKTtcblxuICByZXR1cm4gc3RyZWFtLnB1c2gobnVsbCk7XG59XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuLy8gQSBiaXQgc2ltcGxlciB0aGFuIHJlYWRhYmxlIHN0cmVhbXMuXG4vLyBJbXBsZW1lbnQgYW4gYXN5bmMgLl93cml0ZShjaHVuaywgY2IpLCBhbmQgaXQnbGwgaGFuZGxlIGFsbFxuLy8gdGhlIGRyYWluIGV2ZW50IGVtaXNzaW9uIGFuZCBidWZmZXJpbmcuXG5cbm1vZHVsZS5leHBvcnRzID0gV3JpdGFibGU7XG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgQnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJykuQnVmZmVyO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbldyaXRhYmxlLldyaXRhYmxlU3RhdGUgPSBXcml0YWJsZVN0YXRlO1xuXG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgdXRpbCA9IHJlcXVpcmUoJ2NvcmUtdXRpbC1pcycpO1xudXRpbC5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxudmFyIFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpO1xuXG51dGlsLmluaGVyaXRzKFdyaXRhYmxlLCBTdHJlYW0pO1xuXG5mdW5jdGlvbiBXcml0ZVJlcShjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIHRoaXMuY2h1bmsgPSBjaHVuaztcbiAgdGhpcy5lbmNvZGluZyA9IGVuY29kaW5nO1xuICB0aGlzLmNhbGxiYWNrID0gY2I7XG59XG5cbmZ1bmN0aW9uIFdyaXRhYmxlU3RhdGUob3B0aW9ucywgc3RyZWFtKSB7XG4gIHZhciBEdXBsZXggPSByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgLy8gdGhlIHBvaW50IGF0IHdoaWNoIHdyaXRlKCkgc3RhcnRzIHJldHVybmluZyBmYWxzZVxuICAvLyBOb3RlOiAwIGlzIGEgdmFsaWQgdmFsdWUsIG1lYW5zIHRoYXQgd2UgYWx3YXlzIHJldHVybiBmYWxzZSBpZlxuICAvLyB0aGUgZW50aXJlIGJ1ZmZlciBpcyBub3QgZmx1c2hlZCBpbW1lZGlhdGVseSBvbiB3cml0ZSgpXG4gIHZhciBod20gPSBvcHRpb25zLmhpZ2hXYXRlck1hcms7XG4gIHZhciBkZWZhdWx0SHdtID0gb3B0aW9ucy5vYmplY3RNb2RlID8gMTYgOiAxNiAqIDEwMjQ7XG4gIHRoaXMuaGlnaFdhdGVyTWFyayA9IChod20gfHwgaHdtID09PSAwKSA/IGh3bSA6IGRlZmF1bHRId207XG5cbiAgLy8gb2JqZWN0IHN0cmVhbSBmbGFnIHRvIGluZGljYXRlIHdoZXRoZXIgb3Igbm90IHRoaXMgc3RyZWFtXG4gIC8vIGNvbnRhaW5zIGJ1ZmZlcnMgb3Igb2JqZWN0cy5cbiAgdGhpcy5vYmplY3RNb2RlID0gISFvcHRpb25zLm9iamVjdE1vZGU7XG5cbiAgaWYgKHN0cmVhbSBpbnN0YW5jZW9mIER1cGxleClcbiAgICB0aGlzLm9iamVjdE1vZGUgPSB0aGlzLm9iamVjdE1vZGUgfHwgISFvcHRpb25zLndyaXRhYmxlT2JqZWN0TW9kZTtcblxuICAvLyBjYXN0IHRvIGludHMuXG4gIHRoaXMuaGlnaFdhdGVyTWFyayA9IH5+dGhpcy5oaWdoV2F0ZXJNYXJrO1xuXG4gIHRoaXMubmVlZERyYWluID0gZmFsc2U7XG4gIC8vIGF0IHRoZSBzdGFydCBvZiBjYWxsaW5nIGVuZCgpXG4gIHRoaXMuZW5kaW5nID0gZmFsc2U7XG4gIC8vIHdoZW4gZW5kKCkgaGFzIGJlZW4gY2FsbGVkLCBhbmQgcmV0dXJuZWRcbiAgdGhpcy5lbmRlZCA9IGZhbHNlO1xuICAvLyB3aGVuICdmaW5pc2gnIGlzIGVtaXR0ZWRcbiAgdGhpcy5maW5pc2hlZCA9IGZhbHNlO1xuXG4gIC8vIHNob3VsZCB3ZSBkZWNvZGUgc3RyaW5ncyBpbnRvIGJ1ZmZlcnMgYmVmb3JlIHBhc3NpbmcgdG8gX3dyaXRlP1xuICAvLyB0aGlzIGlzIGhlcmUgc28gdGhhdCBzb21lIG5vZGUtY29yZSBzdHJlYW1zIGNhbiBvcHRpbWl6ZSBzdHJpbmdcbiAgLy8gaGFuZGxpbmcgYXQgYSBsb3dlciBsZXZlbC5cbiAgdmFyIG5vRGVjb2RlID0gb3B0aW9ucy5kZWNvZGVTdHJpbmdzID09PSBmYWxzZTtcbiAgdGhpcy5kZWNvZGVTdHJpbmdzID0gIW5vRGVjb2RlO1xuXG4gIC8vIENyeXB0byBpcyBraW5kIG9mIG9sZCBhbmQgY3J1c3R5LiAgSGlzdG9yaWNhbGx5LCBpdHMgZGVmYXVsdCBzdHJpbmdcbiAgLy8gZW5jb2RpbmcgaXMgJ2JpbmFyeScgc28gd2UgaGF2ZSB0byBtYWtlIHRoaXMgY29uZmlndXJhYmxlLlxuICAvLyBFdmVyeXRoaW5nIGVsc2UgaW4gdGhlIHVuaXZlcnNlIHVzZXMgJ3V0ZjgnLCB0aG91Z2guXG4gIHRoaXMuZGVmYXVsdEVuY29kaW5nID0gb3B0aW9ucy5kZWZhdWx0RW5jb2RpbmcgfHwgJ3V0ZjgnO1xuXG4gIC8vIG5vdCBhbiBhY3R1YWwgYnVmZmVyIHdlIGtlZXAgdHJhY2sgb2YsIGJ1dCBhIG1lYXN1cmVtZW50XG4gIC8vIG9mIGhvdyBtdWNoIHdlJ3JlIHdhaXRpbmcgdG8gZ2V0IHB1c2hlZCB0byBzb21lIHVuZGVybHlpbmdcbiAgLy8gc29ja2V0IG9yIGZpbGUuXG4gIHRoaXMubGVuZ3RoID0gMDtcblxuICAvLyBhIGZsYWcgdG8gc2VlIHdoZW4gd2UncmUgaW4gdGhlIG1pZGRsZSBvZiBhIHdyaXRlLlxuICB0aGlzLndyaXRpbmcgPSBmYWxzZTtcblxuICAvLyB3aGVuIHRydWUgYWxsIHdyaXRlcyB3aWxsIGJlIGJ1ZmZlcmVkIHVudGlsIC51bmNvcmsoKSBjYWxsXG4gIHRoaXMuY29ya2VkID0gMDtcblxuICAvLyBhIGZsYWcgdG8gYmUgYWJsZSB0byB0ZWxsIGlmIHRoZSBvbndyaXRlIGNiIGlzIGNhbGxlZCBpbW1lZGlhdGVseSxcbiAgLy8gb3Igb24gYSBsYXRlciB0aWNrLiAgV2Ugc2V0IHRoaXMgdG8gdHJ1ZSBhdCBmaXJzdCwgYmVjYXVzZSBhbnlcbiAgLy8gYWN0aW9ucyB0aGF0IHNob3VsZG4ndCBoYXBwZW4gdW50aWwgXCJsYXRlclwiIHNob3VsZCBnZW5lcmFsbHkgYWxzb1xuICAvLyBub3QgaGFwcGVuIGJlZm9yZSB0aGUgZmlyc3Qgd3JpdGUgY2FsbC5cbiAgdGhpcy5zeW5jID0gdHJ1ZTtcblxuICAvLyBhIGZsYWcgdG8ga25vdyBpZiB3ZSdyZSBwcm9jZXNzaW5nIHByZXZpb3VzbHkgYnVmZmVyZWQgaXRlbXMsIHdoaWNoXG4gIC8vIG1heSBjYWxsIHRoZSBfd3JpdGUoKSBjYWxsYmFjayBpbiB0aGUgc2FtZSB0aWNrLCBzbyB0aGF0IHdlIGRvbid0XG4gIC8vIGVuZCB1cCBpbiBhbiBvdmVybGFwcGVkIG9ud3JpdGUgc2l0dWF0aW9uLlxuICB0aGlzLmJ1ZmZlclByb2Nlc3NpbmcgPSBmYWxzZTtcblxuICAvLyB0aGUgY2FsbGJhY2sgdGhhdCdzIHBhc3NlZCB0byBfd3JpdGUoY2h1bmssY2IpXG4gIHRoaXMub253cml0ZSA9IGZ1bmN0aW9uKGVyKSB7XG4gICAgb253cml0ZShzdHJlYW0sIGVyKTtcbiAgfTtcblxuICAvLyB0aGUgY2FsbGJhY2sgdGhhdCB0aGUgdXNlciBzdXBwbGllcyB0byB3cml0ZShjaHVuayxlbmNvZGluZyxjYilcbiAgdGhpcy53cml0ZWNiID0gbnVsbDtcblxuICAvLyB0aGUgYW1vdW50IHRoYXQgaXMgYmVpbmcgd3JpdHRlbiB3aGVuIF93cml0ZSBpcyBjYWxsZWQuXG4gIHRoaXMud3JpdGVsZW4gPSAwO1xuXG4gIHRoaXMuYnVmZmVyID0gW107XG5cbiAgLy8gbnVtYmVyIG9mIHBlbmRpbmcgdXNlci1zdXBwbGllZCB3cml0ZSBjYWxsYmFja3NcbiAgLy8gdGhpcyBtdXN0IGJlIDAgYmVmb3JlICdmaW5pc2gnIGNhbiBiZSBlbWl0dGVkXG4gIHRoaXMucGVuZGluZ2NiID0gMDtcblxuICAvLyBlbWl0IHByZWZpbmlzaCBpZiB0aGUgb25seSB0aGluZyB3ZSdyZSB3YWl0aW5nIGZvciBpcyBfd3JpdGUgY2JzXG4gIC8vIFRoaXMgaXMgcmVsZXZhbnQgZm9yIHN5bmNocm9ub3VzIFRyYW5zZm9ybSBzdHJlYW1zXG4gIHRoaXMucHJlZmluaXNoZWQgPSBmYWxzZTtcblxuICAvLyBUcnVlIGlmIHRoZSBlcnJvciB3YXMgYWxyZWFkeSBlbWl0dGVkIGFuZCBzaG91bGQgbm90IGJlIHRocm93biBhZ2FpblxuICB0aGlzLmVycm9yRW1pdHRlZCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBXcml0YWJsZShvcHRpb25zKSB7XG4gIHZhciBEdXBsZXggPSByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbiAgLy8gV3JpdGFibGUgY3RvciBpcyBhcHBsaWVkIHRvIER1cGxleGVzLCB0aG91Z2ggdGhleSdyZSBub3RcbiAgLy8gaW5zdGFuY2VvZiBXcml0YWJsZSwgdGhleSdyZSBpbnN0YW5jZW9mIFJlYWRhYmxlLlxuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgV3JpdGFibGUpICYmICEodGhpcyBpbnN0YW5jZW9mIER1cGxleCkpXG4gICAgcmV0dXJuIG5ldyBXcml0YWJsZShvcHRpb25zKTtcblxuICB0aGlzLl93cml0YWJsZVN0YXRlID0gbmV3IFdyaXRhYmxlU3RhdGUob3B0aW9ucywgdGhpcyk7XG5cbiAgLy8gbGVnYWN5LlxuICB0aGlzLndyaXRhYmxlID0gdHJ1ZTtcblxuICBTdHJlYW0uY2FsbCh0aGlzKTtcbn1cblxuLy8gT3RoZXJ3aXNlIHBlb3BsZSBjYW4gcGlwZSBXcml0YWJsZSBzdHJlYW1zLCB3aGljaCBpcyBqdXN0IHdyb25nLlxuV3JpdGFibGUucHJvdG90eXBlLnBpcGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignQ2Fubm90IHBpcGUuIE5vdCByZWFkYWJsZS4nKSk7XG59O1xuXG5cbmZ1bmN0aW9uIHdyaXRlQWZ0ZXJFbmQoc3RyZWFtLCBzdGF0ZSwgY2IpIHtcbiAgdmFyIGVyID0gbmV3IEVycm9yKCd3cml0ZSBhZnRlciBlbmQnKTtcbiAgLy8gVE9ETzogZGVmZXIgZXJyb3IgZXZlbnRzIGNvbnNpc3RlbnRseSBldmVyeXdoZXJlLCBub3QganVzdCB0aGUgY2JcbiAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZXIpO1xuICBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uKCkge1xuICAgIGNiKGVyKTtcbiAgfSk7XG59XG5cbi8vIElmIHdlIGdldCBzb21ldGhpbmcgdGhhdCBpcyBub3QgYSBidWZmZXIsIHN0cmluZywgbnVsbCwgb3IgdW5kZWZpbmVkLFxuLy8gYW5kIHdlJ3JlIG5vdCBpbiBvYmplY3RNb2RlLCB0aGVuIHRoYXQncyBhbiBlcnJvci5cbi8vIE90aGVyd2lzZSBzdHJlYW0gY2h1bmtzIGFyZSBhbGwgY29uc2lkZXJlZCB0byBiZSBvZiBsZW5ndGg9MSwgYW5kIHRoZVxuLy8gd2F0ZXJtYXJrcyBkZXRlcm1pbmUgaG93IG1hbnkgb2JqZWN0cyB0byBrZWVwIGluIHRoZSBidWZmZXIsIHJhdGhlciB0aGFuXG4vLyBob3cgbWFueSBieXRlcyBvciBjaGFyYWN0ZXJzLlxuZnVuY3Rpb24gdmFsaWRDaHVuayhzdHJlYW0sIHN0YXRlLCBjaHVuaywgY2IpIHtcbiAgdmFyIHZhbGlkID0gdHJ1ZTtcbiAgaWYgKCF1dGlsLmlzQnVmZmVyKGNodW5rKSAmJlxuICAgICAgIXV0aWwuaXNTdHJpbmcoY2h1bmspICYmXG4gICAgICAhdXRpbC5pc051bGxPclVuZGVmaW5lZChjaHVuaykgJiZcbiAgICAgICFzdGF0ZS5vYmplY3RNb2RlKSB7XG4gICAgdmFyIGVyID0gbmV3IFR5cGVFcnJvcignSW52YWxpZCBub24tc3RyaW5nL2J1ZmZlciBjaHVuaycpO1xuICAgIHN0cmVhbS5lbWl0KCdlcnJvcicsIGVyKTtcbiAgICBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uKCkge1xuICAgICAgY2IoZXIpO1xuICAgIH0pO1xuICAgIHZhbGlkID0gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5Xcml0YWJsZS5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbihjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3dyaXRhYmxlU3RhdGU7XG4gIHZhciByZXQgPSBmYWxzZTtcblxuICBpZiAodXRpbC5pc0Z1bmN0aW9uKGVuY29kaW5nKSkge1xuICAgIGNiID0gZW5jb2Rpbmc7XG4gICAgZW5jb2RpbmcgPSBudWxsO1xuICB9XG5cbiAgaWYgKHV0aWwuaXNCdWZmZXIoY2h1bmspKVxuICAgIGVuY29kaW5nID0gJ2J1ZmZlcic7XG4gIGVsc2UgaWYgKCFlbmNvZGluZylcbiAgICBlbmNvZGluZyA9IHN0YXRlLmRlZmF1bHRFbmNvZGluZztcblxuICBpZiAoIXV0aWwuaXNGdW5jdGlvbihjYikpXG4gICAgY2IgPSBmdW5jdGlvbigpIHt9O1xuXG4gIGlmIChzdGF0ZS5lbmRlZClcbiAgICB3cml0ZUFmdGVyRW5kKHRoaXMsIHN0YXRlLCBjYik7XG4gIGVsc2UgaWYgKHZhbGlkQ2h1bmsodGhpcywgc3RhdGUsIGNodW5rLCBjYikpIHtcbiAgICBzdGF0ZS5wZW5kaW5nY2IrKztcbiAgICByZXQgPSB3cml0ZU9yQnVmZmVyKHRoaXMsIHN0YXRlLCBjaHVuaywgZW5jb2RpbmcsIGNiKTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59O1xuXG5Xcml0YWJsZS5wcm90b3R5cGUuY29yayA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl93cml0YWJsZVN0YXRlO1xuXG4gIHN0YXRlLmNvcmtlZCsrO1xufTtcblxuV3JpdGFibGUucHJvdG90eXBlLnVuY29yayA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl93cml0YWJsZVN0YXRlO1xuXG4gIGlmIChzdGF0ZS5jb3JrZWQpIHtcbiAgICBzdGF0ZS5jb3JrZWQtLTtcblxuICAgIGlmICghc3RhdGUud3JpdGluZyAmJlxuICAgICAgICAhc3RhdGUuY29ya2VkICYmXG4gICAgICAgICFzdGF0ZS5maW5pc2hlZCAmJlxuICAgICAgICAhc3RhdGUuYnVmZmVyUHJvY2Vzc2luZyAmJlxuICAgICAgICBzdGF0ZS5idWZmZXIubGVuZ3RoKVxuICAgICAgY2xlYXJCdWZmZXIodGhpcywgc3RhdGUpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBkZWNvZGVDaHVuayhzdGF0ZSwgY2h1bmssIGVuY29kaW5nKSB7XG4gIGlmICghc3RhdGUub2JqZWN0TW9kZSAmJlxuICAgICAgc3RhdGUuZGVjb2RlU3RyaW5ncyAhPT0gZmFsc2UgJiZcbiAgICAgIHV0aWwuaXNTdHJpbmcoY2h1bmspKSB7XG4gICAgY2h1bmsgPSBuZXcgQnVmZmVyKGNodW5rLCBlbmNvZGluZyk7XG4gIH1cbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vLyBpZiB3ZSdyZSBhbHJlYWR5IHdyaXRpbmcgc29tZXRoaW5nLCB0aGVuIGp1c3QgcHV0IHRoaXNcbi8vIGluIHRoZSBxdWV1ZSwgYW5kIHdhaXQgb3VyIHR1cm4uICBPdGhlcndpc2UsIGNhbGwgX3dyaXRlXG4vLyBJZiB3ZSByZXR1cm4gZmFsc2UsIHRoZW4gd2UgbmVlZCBhIGRyYWluIGV2ZW50LCBzbyBzZXQgdGhhdCBmbGFnLlxuZnVuY3Rpb24gd3JpdGVPckJ1ZmZlcihzdHJlYW0sIHN0YXRlLCBjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIGNodW5rID0gZGVjb2RlQ2h1bmsoc3RhdGUsIGNodW5rLCBlbmNvZGluZyk7XG4gIGlmICh1dGlsLmlzQnVmZmVyKGNodW5rKSlcbiAgICBlbmNvZGluZyA9ICdidWZmZXInO1xuICB2YXIgbGVuID0gc3RhdGUub2JqZWN0TW9kZSA/IDEgOiBjaHVuay5sZW5ndGg7XG5cbiAgc3RhdGUubGVuZ3RoICs9IGxlbjtcblxuICB2YXIgcmV0ID0gc3RhdGUubGVuZ3RoIDwgc3RhdGUuaGlnaFdhdGVyTWFyaztcbiAgLy8gd2UgbXVzdCBlbnN1cmUgdGhhdCBwcmV2aW91cyBuZWVkRHJhaW4gd2lsbCBub3QgYmUgcmVzZXQgdG8gZmFsc2UuXG4gIGlmICghcmV0KVxuICAgIHN0YXRlLm5lZWREcmFpbiA9IHRydWU7XG5cbiAgaWYgKHN0YXRlLndyaXRpbmcgfHwgc3RhdGUuY29ya2VkKVxuICAgIHN0YXRlLmJ1ZmZlci5wdXNoKG5ldyBXcml0ZVJlcShjaHVuaywgZW5jb2RpbmcsIGNiKSk7XG4gIGVsc2VcbiAgICBkb1dyaXRlKHN0cmVhbSwgc3RhdGUsIGZhbHNlLCBsZW4sIGNodW5rLCBlbmNvZGluZywgY2IpO1xuXG4gIHJldHVybiByZXQ7XG59XG5cbmZ1bmN0aW9uIGRvV3JpdGUoc3RyZWFtLCBzdGF0ZSwgd3JpdGV2LCBsZW4sIGNodW5rLCBlbmNvZGluZywgY2IpIHtcbiAgc3RhdGUud3JpdGVsZW4gPSBsZW47XG4gIHN0YXRlLndyaXRlY2IgPSBjYjtcbiAgc3RhdGUud3JpdGluZyA9IHRydWU7XG4gIHN0YXRlLnN5bmMgPSB0cnVlO1xuICBpZiAod3JpdGV2KVxuICAgIHN0cmVhbS5fd3JpdGV2KGNodW5rLCBzdGF0ZS5vbndyaXRlKTtcbiAgZWxzZVxuICAgIHN0cmVhbS5fd3JpdGUoY2h1bmssIGVuY29kaW5nLCBzdGF0ZS5vbndyaXRlKTtcbiAgc3RhdGUuc3luYyA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBvbndyaXRlRXJyb3Ioc3RyZWFtLCBzdGF0ZSwgc3luYywgZXIsIGNiKSB7XG4gIGlmIChzeW5jKVxuICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24oKSB7XG4gICAgICBzdGF0ZS5wZW5kaW5nY2ItLTtcbiAgICAgIGNiKGVyKTtcbiAgICB9KTtcbiAgZWxzZSB7XG4gICAgc3RhdGUucGVuZGluZ2NiLS07XG4gICAgY2IoZXIpO1xuICB9XG5cbiAgc3RyZWFtLl93cml0YWJsZVN0YXRlLmVycm9yRW1pdHRlZCA9IHRydWU7XG4gIHN0cmVhbS5lbWl0KCdlcnJvcicsIGVyKTtcbn1cblxuZnVuY3Rpb24gb253cml0ZVN0YXRlVXBkYXRlKHN0YXRlKSB7XG4gIHN0YXRlLndyaXRpbmcgPSBmYWxzZTtcbiAgc3RhdGUud3JpdGVjYiA9IG51bGw7XG4gIHN0YXRlLmxlbmd0aCAtPSBzdGF0ZS53cml0ZWxlbjtcbiAgc3RhdGUud3JpdGVsZW4gPSAwO1xufVxuXG5mdW5jdGlvbiBvbndyaXRlKHN0cmVhbSwgZXIpIHtcbiAgdmFyIHN0YXRlID0gc3RyZWFtLl93cml0YWJsZVN0YXRlO1xuICB2YXIgc3luYyA9IHN0YXRlLnN5bmM7XG4gIHZhciBjYiA9IHN0YXRlLndyaXRlY2I7XG5cbiAgb253cml0ZVN0YXRlVXBkYXRlKHN0YXRlKTtcblxuICBpZiAoZXIpXG4gICAgb253cml0ZUVycm9yKHN0cmVhbSwgc3RhdGUsIHN5bmMsIGVyLCBjYik7XG4gIGVsc2Uge1xuICAgIC8vIENoZWNrIGlmIHdlJ3JlIGFjdHVhbGx5IHJlYWR5IHRvIGZpbmlzaCwgYnV0IGRvbid0IGVtaXQgeWV0XG4gICAgdmFyIGZpbmlzaGVkID0gbmVlZEZpbmlzaChzdHJlYW0sIHN0YXRlKTtcblxuICAgIGlmICghZmluaXNoZWQgJiZcbiAgICAgICAgIXN0YXRlLmNvcmtlZCAmJlxuICAgICAgICAhc3RhdGUuYnVmZmVyUHJvY2Vzc2luZyAmJlxuICAgICAgICBzdGF0ZS5idWZmZXIubGVuZ3RoKSB7XG4gICAgICBjbGVhckJ1ZmZlcihzdHJlYW0sIHN0YXRlKTtcbiAgICB9XG5cbiAgICBpZiAoc3luYykge1xuICAgICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgYWZ0ZXJXcml0ZShzdHJlYW0sIHN0YXRlLCBmaW5pc2hlZCwgY2IpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFmdGVyV3JpdGUoc3RyZWFtLCBzdGF0ZSwgZmluaXNoZWQsIGNiKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYWZ0ZXJXcml0ZShzdHJlYW0sIHN0YXRlLCBmaW5pc2hlZCwgY2IpIHtcbiAgaWYgKCFmaW5pc2hlZClcbiAgICBvbndyaXRlRHJhaW4oc3RyZWFtLCBzdGF0ZSk7XG4gIHN0YXRlLnBlbmRpbmdjYi0tO1xuICBjYigpO1xuICBmaW5pc2hNYXliZShzdHJlYW0sIHN0YXRlKTtcbn1cblxuLy8gTXVzdCBmb3JjZSBjYWxsYmFjayB0byBiZSBjYWxsZWQgb24gbmV4dFRpY2ssIHNvIHRoYXQgd2UgZG9uJ3Rcbi8vIGVtaXQgJ2RyYWluJyBiZWZvcmUgdGhlIHdyaXRlKCkgY29uc3VtZXIgZ2V0cyB0aGUgJ2ZhbHNlJyByZXR1cm5cbi8vIHZhbHVlLCBhbmQgaGFzIGEgY2hhbmNlIHRvIGF0dGFjaCBhICdkcmFpbicgbGlzdGVuZXIuXG5mdW5jdGlvbiBvbndyaXRlRHJhaW4oc3RyZWFtLCBzdGF0ZSkge1xuICBpZiAoc3RhdGUubGVuZ3RoID09PSAwICYmIHN0YXRlLm5lZWREcmFpbikge1xuICAgIHN0YXRlLm5lZWREcmFpbiA9IGZhbHNlO1xuICAgIHN0cmVhbS5lbWl0KCdkcmFpbicpO1xuICB9XG59XG5cblxuLy8gaWYgdGhlcmUncyBzb21ldGhpbmcgaW4gdGhlIGJ1ZmZlciB3YWl0aW5nLCB0aGVuIHByb2Nlc3MgaXRcbmZ1bmN0aW9uIGNsZWFyQnVmZmVyKHN0cmVhbSwgc3RhdGUpIHtcbiAgc3RhdGUuYnVmZmVyUHJvY2Vzc2luZyA9IHRydWU7XG5cbiAgaWYgKHN0cmVhbS5fd3JpdGV2ICYmIHN0YXRlLmJ1ZmZlci5sZW5ndGggPiAxKSB7XG4gICAgLy8gRmFzdCBjYXNlLCB3cml0ZSBldmVyeXRoaW5nIHVzaW5nIF93cml0ZXYoKVxuICAgIHZhciBjYnMgPSBbXTtcbiAgICBmb3IgKHZhciBjID0gMDsgYyA8IHN0YXRlLmJ1ZmZlci5sZW5ndGg7IGMrKylcbiAgICAgIGNicy5wdXNoKHN0YXRlLmJ1ZmZlcltjXS5jYWxsYmFjayk7XG5cbiAgICAvLyBjb3VudCB0aGUgb25lIHdlIGFyZSBhZGRpbmcsIGFzIHdlbGwuXG4gICAgLy8gVE9ETyhpc2FhY3MpIGNsZWFuIHRoaXMgdXBcbiAgICBzdGF0ZS5wZW5kaW5nY2IrKztcbiAgICBkb1dyaXRlKHN0cmVhbSwgc3RhdGUsIHRydWUsIHN0YXRlLmxlbmd0aCwgc3RhdGUuYnVmZmVyLCAnJywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNicy5sZW5ndGg7IGkrKykge1xuICAgICAgICBzdGF0ZS5wZW5kaW5nY2ItLTtcbiAgICAgICAgY2JzW2ldKGVycik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDbGVhciBidWZmZXJcbiAgICBzdGF0ZS5idWZmZXIgPSBbXTtcbiAgfSBlbHNlIHtcbiAgICAvLyBTbG93IGNhc2UsIHdyaXRlIGNodW5rcyBvbmUtYnktb25lXG4gICAgZm9yICh2YXIgYyA9IDA7IGMgPCBzdGF0ZS5idWZmZXIubGVuZ3RoOyBjKyspIHtcbiAgICAgIHZhciBlbnRyeSA9IHN0YXRlLmJ1ZmZlcltjXTtcbiAgICAgIHZhciBjaHVuayA9IGVudHJ5LmNodW5rO1xuICAgICAgdmFyIGVuY29kaW5nID0gZW50cnkuZW5jb2Rpbmc7XG4gICAgICB2YXIgY2IgPSBlbnRyeS5jYWxsYmFjaztcbiAgICAgIHZhciBsZW4gPSBzdGF0ZS5vYmplY3RNb2RlID8gMSA6IGNodW5rLmxlbmd0aDtcblxuICAgICAgZG9Xcml0ZShzdHJlYW0sIHN0YXRlLCBmYWxzZSwgbGVuLCBjaHVuaywgZW5jb2RpbmcsIGNiKTtcblxuICAgICAgLy8gaWYgd2UgZGlkbid0IGNhbGwgdGhlIG9ud3JpdGUgaW1tZWRpYXRlbHksIHRoZW5cbiAgICAgIC8vIGl0IG1lYW5zIHRoYXQgd2UgbmVlZCB0byB3YWl0IHVudGlsIGl0IGRvZXMuXG4gICAgICAvLyBhbHNvLCB0aGF0IG1lYW5zIHRoYXQgdGhlIGNodW5rIGFuZCBjYiBhcmUgY3VycmVudGx5XG4gICAgICAvLyBiZWluZyBwcm9jZXNzZWQsIHNvIG1vdmUgdGhlIGJ1ZmZlciBjb3VudGVyIHBhc3QgdGhlbS5cbiAgICAgIGlmIChzdGF0ZS53cml0aW5nKSB7XG4gICAgICAgIGMrKztcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGMgPCBzdGF0ZS5idWZmZXIubGVuZ3RoKVxuICAgICAgc3RhdGUuYnVmZmVyID0gc3RhdGUuYnVmZmVyLnNsaWNlKGMpO1xuICAgIGVsc2VcbiAgICAgIHN0YXRlLmJ1ZmZlci5sZW5ndGggPSAwO1xuICB9XG5cbiAgc3RhdGUuYnVmZmVyUHJvY2Vzc2luZyA9IGZhbHNlO1xufVxuXG5Xcml0YWJsZS5wcm90b3R5cGUuX3dyaXRlID0gZnVuY3Rpb24oY2h1bmssIGVuY29kaW5nLCBjYikge1xuICBjYihuZXcgRXJyb3IoJ25vdCBpbXBsZW1lbnRlZCcpKTtcblxufTtcblxuV3JpdGFibGUucHJvdG90eXBlLl93cml0ZXYgPSBudWxsO1xuXG5Xcml0YWJsZS5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24oY2h1bmssIGVuY29kaW5nLCBjYikge1xuICB2YXIgc3RhdGUgPSB0aGlzLl93cml0YWJsZVN0YXRlO1xuXG4gIGlmICh1dGlsLmlzRnVuY3Rpb24oY2h1bmspKSB7XG4gICAgY2IgPSBjaHVuaztcbiAgICBjaHVuayA9IG51bGw7XG4gICAgZW5jb2RpbmcgPSBudWxsO1xuICB9IGVsc2UgaWYgKHV0aWwuaXNGdW5jdGlvbihlbmNvZGluZykpIHtcbiAgICBjYiA9IGVuY29kaW5nO1xuICAgIGVuY29kaW5nID0gbnVsbDtcbiAgfVxuXG4gIGlmICghdXRpbC5pc051bGxPclVuZGVmaW5lZChjaHVuaykpXG4gICAgdGhpcy53cml0ZShjaHVuaywgZW5jb2RpbmcpO1xuXG4gIC8vIC5lbmQoKSBmdWxseSB1bmNvcmtzXG4gIGlmIChzdGF0ZS5jb3JrZWQpIHtcbiAgICBzdGF0ZS5jb3JrZWQgPSAxO1xuICAgIHRoaXMudW5jb3JrKCk7XG4gIH1cblxuICAvLyBpZ25vcmUgdW5uZWNlc3NhcnkgZW5kKCkgY2FsbHMuXG4gIGlmICghc3RhdGUuZW5kaW5nICYmICFzdGF0ZS5maW5pc2hlZClcbiAgICBlbmRXcml0YWJsZSh0aGlzLCBzdGF0ZSwgY2IpO1xufTtcblxuXG5mdW5jdGlvbiBuZWVkRmluaXNoKHN0cmVhbSwgc3RhdGUpIHtcbiAgcmV0dXJuIChzdGF0ZS5lbmRpbmcgJiZcbiAgICAgICAgICBzdGF0ZS5sZW5ndGggPT09IDAgJiZcbiAgICAgICAgICAhc3RhdGUuZmluaXNoZWQgJiZcbiAgICAgICAgICAhc3RhdGUud3JpdGluZyk7XG59XG5cbmZ1bmN0aW9uIHByZWZpbmlzaChzdHJlYW0sIHN0YXRlKSB7XG4gIGlmICghc3RhdGUucHJlZmluaXNoZWQpIHtcbiAgICBzdGF0ZS5wcmVmaW5pc2hlZCA9IHRydWU7XG4gICAgc3RyZWFtLmVtaXQoJ3ByZWZpbmlzaCcpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGZpbmlzaE1heWJlKHN0cmVhbSwgc3RhdGUpIHtcbiAgdmFyIG5lZWQgPSBuZWVkRmluaXNoKHN0cmVhbSwgc3RhdGUpO1xuICBpZiAobmVlZCkge1xuICAgIGlmIChzdGF0ZS5wZW5kaW5nY2IgPT09IDApIHtcbiAgICAgIHByZWZpbmlzaChzdHJlYW0sIHN0YXRlKTtcbiAgICAgIHN0YXRlLmZpbmlzaGVkID0gdHJ1ZTtcbiAgICAgIHN0cmVhbS5lbWl0KCdmaW5pc2gnKTtcbiAgICB9IGVsc2VcbiAgICAgIHByZWZpbmlzaChzdHJlYW0sIHN0YXRlKTtcbiAgfVxuICByZXR1cm4gbmVlZDtcbn1cblxuZnVuY3Rpb24gZW5kV3JpdGFibGUoc3RyZWFtLCBzdGF0ZSwgY2IpIHtcbiAgc3RhdGUuZW5kaW5nID0gdHJ1ZTtcbiAgZmluaXNoTWF5YmUoc3RyZWFtLCBzdGF0ZSk7XG4gIGlmIChjYikge1xuICAgIGlmIChzdGF0ZS5maW5pc2hlZClcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soY2IpO1xuICAgIGVsc2VcbiAgICAgIHN0cmVhbS5vbmNlKCdmaW5pc2gnLCBjYik7XG4gIH1cbiAgc3RhdGUuZW5kZWQgPSB0cnVlO1xufVxuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIE5PVEU6IFRoZXNlIHR5cGUgY2hlY2tpbmcgZnVuY3Rpb25zIGludGVudGlvbmFsbHkgZG9uJ3QgdXNlIGBpbnN0YW5jZW9mYFxuLy8gYmVjYXVzZSBpdCBpcyBmcmFnaWxlIGFuZCBjYW4gYmUgZWFzaWx5IGZha2VkIHdpdGggYE9iamVjdC5jcmVhdGUoKWAuXG5mdW5jdGlvbiBpc0FycmF5KGFyKSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGFyKTtcbn1cbmV4cG9ydHMuaXNBcnJheSA9IGlzQXJyYXk7XG5cbmZ1bmN0aW9uIGlzQm9vbGVhbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJztcbn1cbmV4cG9ydHMuaXNCb29sZWFuID0gaXNCb29sZWFuO1xuXG5mdW5jdGlvbiBpc051bGwoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IG51bGw7XG59XG5leHBvcnRzLmlzTnVsbCA9IGlzTnVsbDtcblxuZnVuY3Rpb24gaXNOdWxsT3JVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNOdWxsT3JVbmRlZmluZWQgPSBpc051bGxPclVuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cbmV4cG9ydHMuaXNOdW1iZXIgPSBpc051bWJlcjtcblxuZnVuY3Rpb24gaXNTdHJpbmcoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJztcbn1cbmV4cG9ydHMuaXNTdHJpbmcgPSBpc1N0cmluZztcblxuZnVuY3Rpb24gaXNTeW1ib2woYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3ltYm9sJztcbn1cbmV4cG9ydHMuaXNTeW1ib2wgPSBpc1N5bWJvbDtcblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbmV4cG9ydHMuaXNVbmRlZmluZWQgPSBpc1VuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNSZWdFeHAocmUpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KHJlKSAmJiBvYmplY3RUb1N0cmluZyhyZSkgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufVxuZXhwb3J0cy5pc1JlZ0V4cCA9IGlzUmVnRXhwO1xuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNPYmplY3QgPSBpc09iamVjdDtcblxuZnVuY3Rpb24gaXNEYXRlKGQpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KGQpICYmIG9iamVjdFRvU3RyaW5nKGQpID09PSAnW29iamVjdCBEYXRlXSc7XG59XG5leHBvcnRzLmlzRGF0ZSA9IGlzRGF0ZTtcblxuZnVuY3Rpb24gaXNFcnJvcihlKSB7XG4gIHJldHVybiBpc09iamVjdChlKSAmJlxuICAgICAgKG9iamVjdFRvU3RyaW5nKGUpID09PSAnW29iamVjdCBFcnJvcl0nIHx8IGUgaW5zdGFuY2VvZiBFcnJvcik7XG59XG5leHBvcnRzLmlzRXJyb3IgPSBpc0Vycm9yO1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmV4cG9ydHMuaXNGdW5jdGlvbiA9IGlzRnVuY3Rpb247XG5cbmZ1bmN0aW9uIGlzUHJpbWl0aXZlKGFyZykge1xuICByZXR1cm4gYXJnID09PSBudWxsIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnYm9vbGVhbicgfHxcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICdudW1iZXInIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnc3RyaW5nJyB8fFxuICAgICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N5bWJvbCcgfHwgIC8vIEVTNiBzeW1ib2xcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICd1bmRlZmluZWQnO1xufVxuZXhwb3J0cy5pc1ByaW1pdGl2ZSA9IGlzUHJpbWl0aXZlO1xuXG5mdW5jdGlvbiBpc0J1ZmZlcihhcmcpIHtcbiAgcmV0dXJuIEJ1ZmZlci5pc0J1ZmZlcihhcmcpO1xufVxuZXhwb3J0cy5pc0J1ZmZlciA9IGlzQnVmZmVyO1xuXG5mdW5jdGlvbiBvYmplY3RUb1N0cmluZyhvKSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwobyk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwiLi9saWIvX3N0cmVhbV9wYXNzdGhyb3VnaC5qc1wiKVxuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9saWIvX3N0cmVhbV9yZWFkYWJsZS5qcycpO1xuZXhwb3J0cy5TdHJlYW0gPSByZXF1aXJlKCdzdHJlYW0nKTtcbmV4cG9ydHMuUmVhZGFibGUgPSBleHBvcnRzO1xuZXhwb3J0cy5Xcml0YWJsZSA9IHJlcXVpcmUoJy4vbGliL19zdHJlYW1fd3JpdGFibGUuanMnKTtcbmV4cG9ydHMuRHVwbGV4ID0gcmVxdWlyZSgnLi9saWIvX3N0cmVhbV9kdXBsZXguanMnKTtcbmV4cG9ydHMuVHJhbnNmb3JtID0gcmVxdWlyZSgnLi9saWIvX3N0cmVhbV90cmFuc2Zvcm0uanMnKTtcbmV4cG9ydHMuUGFzc1Rocm91Z2ggPSByZXF1aXJlKCcuL2xpYi9fc3RyZWFtX3Bhc3N0aHJvdWdoLmpzJyk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoXCIuL2xpYi9fc3RyZWFtX3RyYW5zZm9ybS5qc1wiKVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwiLi9saWIvX3N0cmVhbV93cml0YWJsZS5qc1wiKVxuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtO1xuXG52YXIgRUUgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuXG5pbmhlcml0cyhTdHJlYW0sIEVFKTtcblN0cmVhbS5SZWFkYWJsZSA9IHJlcXVpcmUoJ3JlYWRhYmxlLXN0cmVhbS9yZWFkYWJsZS5qcycpO1xuU3RyZWFtLldyaXRhYmxlID0gcmVxdWlyZSgncmVhZGFibGUtc3RyZWFtL3dyaXRhYmxlLmpzJyk7XG5TdHJlYW0uRHVwbGV4ID0gcmVxdWlyZSgncmVhZGFibGUtc3RyZWFtL2R1cGxleC5qcycpO1xuU3RyZWFtLlRyYW5zZm9ybSA9IHJlcXVpcmUoJ3JlYWRhYmxlLXN0cmVhbS90cmFuc2Zvcm0uanMnKTtcblN0cmVhbS5QYXNzVGhyb3VnaCA9IHJlcXVpcmUoJ3JlYWRhYmxlLXN0cmVhbS9wYXNzdGhyb3VnaC5qcycpO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjQueFxuU3RyZWFtLlN0cmVhbSA9IFN0cmVhbTtcblxuXG5cbi8vIG9sZC1zdHlsZSBzdHJlYW1zLiAgTm90ZSB0aGF0IHRoZSBwaXBlIG1ldGhvZCAodGhlIG9ubHkgcmVsZXZhbnRcbi8vIHBhcnQgb2YgdGhpcyBjbGFzcykgaXMgb3ZlcnJpZGRlbiBpbiB0aGUgUmVhZGFibGUgY2xhc3MuXG5cbmZ1bmN0aW9uIFN0cmVhbSgpIHtcbiAgRUUuY2FsbCh0aGlzKTtcbn1cblxuU3RyZWFtLnByb3RvdHlwZS5waXBlID0gZnVuY3Rpb24oZGVzdCwgb3B0aW9ucykge1xuICB2YXIgc291cmNlID0gdGhpcztcblxuICBmdW5jdGlvbiBvbmRhdGEoY2h1bmspIHtcbiAgICBpZiAoZGVzdC53cml0YWJsZSkge1xuICAgICAgaWYgKGZhbHNlID09PSBkZXN0LndyaXRlKGNodW5rKSAmJiBzb3VyY2UucGF1c2UpIHtcbiAgICAgICAgc291cmNlLnBhdXNlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc291cmNlLm9uKCdkYXRhJywgb25kYXRhKTtcblxuICBmdW5jdGlvbiBvbmRyYWluKCkge1xuICAgIGlmIChzb3VyY2UucmVhZGFibGUgJiYgc291cmNlLnJlc3VtZSkge1xuICAgICAgc291cmNlLnJlc3VtZSgpO1xuICAgIH1cbiAgfVxuXG4gIGRlc3Qub24oJ2RyYWluJywgb25kcmFpbik7XG5cbiAgLy8gSWYgdGhlICdlbmQnIG9wdGlvbiBpcyBub3Qgc3VwcGxpZWQsIGRlc3QuZW5kKCkgd2lsbCBiZSBjYWxsZWQgd2hlblxuICAvLyBzb3VyY2UgZ2V0cyB0aGUgJ2VuZCcgb3IgJ2Nsb3NlJyBldmVudHMuICBPbmx5IGRlc3QuZW5kKCkgb25jZS5cbiAgaWYgKCFkZXN0Ll9pc1N0ZGlvICYmICghb3B0aW9ucyB8fCBvcHRpb25zLmVuZCAhPT0gZmFsc2UpKSB7XG4gICAgc291cmNlLm9uKCdlbmQnLCBvbmVuZCk7XG4gICAgc291cmNlLm9uKCdjbG9zZScsIG9uY2xvc2UpO1xuICB9XG5cbiAgdmFyIGRpZE9uRW5kID0gZmFsc2U7XG4gIGZ1bmN0aW9uIG9uZW5kKCkge1xuICAgIGlmIChkaWRPbkVuZCkgcmV0dXJuO1xuICAgIGRpZE9uRW5kID0gdHJ1ZTtcblxuICAgIGRlc3QuZW5kKCk7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIG9uY2xvc2UoKSB7XG4gICAgaWYgKGRpZE9uRW5kKSByZXR1cm47XG4gICAgZGlkT25FbmQgPSB0cnVlO1xuXG4gICAgaWYgKHR5cGVvZiBkZXN0LmRlc3Ryb3kgPT09ICdmdW5jdGlvbicpIGRlc3QuZGVzdHJveSgpO1xuICB9XG5cbiAgLy8gZG9uJ3QgbGVhdmUgZGFuZ2xpbmcgcGlwZXMgd2hlbiB0aGVyZSBhcmUgZXJyb3JzLlxuICBmdW5jdGlvbiBvbmVycm9yKGVyKSB7XG4gICAgY2xlYW51cCgpO1xuICAgIGlmIChFRS5saXN0ZW5lckNvdW50KHRoaXMsICdlcnJvcicpID09PSAwKSB7XG4gICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkIHN0cmVhbSBlcnJvciBpbiBwaXBlLlxuICAgIH1cbiAgfVxuXG4gIHNvdXJjZS5vbignZXJyb3InLCBvbmVycm9yKTtcbiAgZGVzdC5vbignZXJyb3InLCBvbmVycm9yKTtcblxuICAvLyByZW1vdmUgYWxsIHRoZSBldmVudCBsaXN0ZW5lcnMgdGhhdCB3ZXJlIGFkZGVkLlxuICBmdW5jdGlvbiBjbGVhbnVwKCkge1xuICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignZGF0YScsIG9uZGF0YSk7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZHJhaW4nLCBvbmRyYWluKTtcblxuICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignZW5kJywgb25lbmQpO1xuICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignY2xvc2UnLCBvbmNsb3NlKTtcblxuICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignZXJyb3InLCBvbmVycm9yKTtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdlcnJvcicsIG9uZXJyb3IpO1xuXG4gICAgc291cmNlLnJlbW92ZUxpc3RlbmVyKCdlbmQnLCBjbGVhbnVwKTtcbiAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2Nsb3NlJywgY2xlYW51cCk7XG5cbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIGNsZWFudXApO1xuICB9XG5cbiAgc291cmNlLm9uKCdlbmQnLCBjbGVhbnVwKTtcbiAgc291cmNlLm9uKCdjbG9zZScsIGNsZWFudXApO1xuXG4gIGRlc3Qub24oJ2Nsb3NlJywgY2xlYW51cCk7XG5cbiAgZGVzdC5lbWl0KCdwaXBlJywgc291cmNlKTtcblxuICAvLyBBbGxvdyBmb3IgdW5peC1saWtlIHVzYWdlOiBBLnBpcGUoQikucGlwZShDKVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJ2J1ZmZlcicpLkJ1ZmZlcjtcblxudmFyIGlzQnVmZmVyRW5jb2RpbmcgPSBCdWZmZXIuaXNFbmNvZGluZ1xuICB8fCBmdW5jdGlvbihlbmNvZGluZykge1xuICAgICAgIHN3aXRjaCAoZW5jb2RpbmcgJiYgZW5jb2RpbmcudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgY2FzZSAnaGV4JzogY2FzZSAndXRmOCc6IGNhc2UgJ3V0Zi04JzogY2FzZSAnYXNjaWknOiBjYXNlICdiaW5hcnknOiBjYXNlICdiYXNlNjQnOiBjYXNlICd1Y3MyJzogY2FzZSAndWNzLTInOiBjYXNlICd1dGYxNmxlJzogY2FzZSAndXRmLTE2bGUnOiBjYXNlICdyYXcnOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgIGRlZmF1bHQ6IHJldHVybiBmYWxzZTtcbiAgICAgICB9XG4gICAgIH1cblxuXG5mdW5jdGlvbiBhc3NlcnRFbmNvZGluZyhlbmNvZGluZykge1xuICBpZiAoZW5jb2RpbmcgJiYgIWlzQnVmZmVyRW5jb2RpbmcoZW5jb2RpbmcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpO1xuICB9XG59XG5cbi8vIFN0cmluZ0RlY29kZXIgcHJvdmlkZXMgYW4gaW50ZXJmYWNlIGZvciBlZmZpY2llbnRseSBzcGxpdHRpbmcgYSBzZXJpZXMgb2Zcbi8vIGJ1ZmZlcnMgaW50byBhIHNlcmllcyBvZiBKUyBzdHJpbmdzIHdpdGhvdXQgYnJlYWtpbmcgYXBhcnQgbXVsdGktYnl0ZVxuLy8gY2hhcmFjdGVycy4gQ0VTVS04IGlzIGhhbmRsZWQgYXMgcGFydCBvZiB0aGUgVVRGLTggZW5jb2RpbmcuXG4vL1xuLy8gQFRPRE8gSGFuZGxpbmcgYWxsIGVuY29kaW5ncyBpbnNpZGUgYSBzaW5nbGUgb2JqZWN0IG1ha2VzIGl0IHZlcnkgZGlmZmljdWx0XG4vLyB0byByZWFzb24gYWJvdXQgdGhpcyBjb2RlLCBzbyBpdCBzaG91bGQgYmUgc3BsaXQgdXAgaW4gdGhlIGZ1dHVyZS5cbi8vIEBUT0RPIFRoZXJlIHNob3VsZCBiZSBhIHV0Zjgtc3RyaWN0IGVuY29kaW5nIHRoYXQgcmVqZWN0cyBpbnZhbGlkIFVURi04IGNvZGVcbi8vIHBvaW50cyBhcyB1c2VkIGJ5IENFU1UtOC5cbnZhciBTdHJpbmdEZWNvZGVyID0gZXhwb3J0cy5TdHJpbmdEZWNvZGVyID0gZnVuY3Rpb24oZW5jb2RpbmcpIHtcbiAgdGhpcy5lbmNvZGluZyA9IChlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvWy1fXS8sICcnKTtcbiAgYXNzZXJ0RW5jb2RpbmcoZW5jb2RpbmcpO1xuICBzd2l0Y2ggKHRoaXMuZW5jb2RpbmcpIHtcbiAgICBjYXNlICd1dGY4JzpcbiAgICAgIC8vIENFU1UtOCByZXByZXNlbnRzIGVhY2ggb2YgU3Vycm9nYXRlIFBhaXIgYnkgMy1ieXRlc1xuICAgICAgdGhpcy5zdXJyb2dhdGVTaXplID0gMztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgLy8gVVRGLTE2IHJlcHJlc2VudHMgZWFjaCBvZiBTdXJyb2dhdGUgUGFpciBieSAyLWJ5dGVzXG4gICAgICB0aGlzLnN1cnJvZ2F0ZVNpemUgPSAyO1xuICAgICAgdGhpcy5kZXRlY3RJbmNvbXBsZXRlQ2hhciA9IHV0ZjE2RGV0ZWN0SW5jb21wbGV0ZUNoYXI7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgLy8gQmFzZS02NCBzdG9yZXMgMyBieXRlcyBpbiA0IGNoYXJzLCBhbmQgcGFkcyB0aGUgcmVtYWluZGVyLlxuICAgICAgdGhpcy5zdXJyb2dhdGVTaXplID0gMztcbiAgICAgIHRoaXMuZGV0ZWN0SW5jb21wbGV0ZUNoYXIgPSBiYXNlNjREZXRlY3RJbmNvbXBsZXRlQ2hhcjtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aGlzLndyaXRlID0gcGFzc1Rocm91Z2hXcml0ZTtcbiAgICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEVub3VnaCBzcGFjZSB0byBzdG9yZSBhbGwgYnl0ZXMgb2YgYSBzaW5nbGUgY2hhcmFjdGVyLiBVVEYtOCBuZWVkcyA0XG4gIC8vIGJ5dGVzLCBidXQgQ0VTVS04IG1heSByZXF1aXJlIHVwIHRvIDYgKDMgYnl0ZXMgcGVyIHN1cnJvZ2F0ZSkuXG4gIHRoaXMuY2hhckJ1ZmZlciA9IG5ldyBCdWZmZXIoNik7XG4gIC8vIE51bWJlciBvZiBieXRlcyByZWNlaXZlZCBmb3IgdGhlIGN1cnJlbnQgaW5jb21wbGV0ZSBtdWx0aS1ieXRlIGNoYXJhY3Rlci5cbiAgdGhpcy5jaGFyUmVjZWl2ZWQgPSAwO1xuICAvLyBOdW1iZXIgb2YgYnl0ZXMgZXhwZWN0ZWQgZm9yIHRoZSBjdXJyZW50IGluY29tcGxldGUgbXVsdGktYnl0ZSBjaGFyYWN0ZXIuXG4gIHRoaXMuY2hhckxlbmd0aCA9IDA7XG59O1xuXG5cbi8vIHdyaXRlIGRlY29kZXMgdGhlIGdpdmVuIGJ1ZmZlciBhbmQgcmV0dXJucyBpdCBhcyBKUyBzdHJpbmcgdGhhdCBpc1xuLy8gZ3VhcmFudGVlZCB0byBub3QgY29udGFpbiBhbnkgcGFydGlhbCBtdWx0aS1ieXRlIGNoYXJhY3RlcnMuIEFueSBwYXJ0aWFsXG4vLyBjaGFyYWN0ZXIgZm91bmQgYXQgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIGlzIGJ1ZmZlcmVkIHVwLCBhbmQgd2lsbCBiZVxuLy8gcmV0dXJuZWQgd2hlbiBjYWxsaW5nIHdyaXRlIGFnYWluIHdpdGggdGhlIHJlbWFpbmluZyBieXRlcy5cbi8vXG4vLyBOb3RlOiBDb252ZXJ0aW5nIGEgQnVmZmVyIGNvbnRhaW5pbmcgYW4gb3JwaGFuIHN1cnJvZ2F0ZSB0byBhIFN0cmluZ1xuLy8gY3VycmVudGx5IHdvcmtzLCBidXQgY29udmVydGluZyBhIFN0cmluZyB0byBhIEJ1ZmZlciAodmlhIGBuZXcgQnVmZmVyYCwgb3Jcbi8vIEJ1ZmZlciN3cml0ZSkgd2lsbCByZXBsYWNlIGluY29tcGxldGUgc3Vycm9nYXRlcyB3aXRoIHRoZSB1bmljb2RlXG4vLyByZXBsYWNlbWVudCBjaGFyYWN0ZXIuIFNlZSBodHRwczovL2NvZGVyZXZpZXcuY2hyb21pdW0ub3JnLzEyMTE3MzAwOS8gLlxuU3RyaW5nRGVjb2Rlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGNoYXJTdHIgPSAnJztcbiAgLy8gaWYgb3VyIGxhc3Qgd3JpdGUgZW5kZWQgd2l0aCBhbiBpbmNvbXBsZXRlIG11bHRpYnl0ZSBjaGFyYWN0ZXJcbiAgd2hpbGUgKHRoaXMuY2hhckxlbmd0aCkge1xuICAgIC8vIGRldGVybWluZSBob3cgbWFueSByZW1haW5pbmcgYnl0ZXMgdGhpcyBidWZmZXIgaGFzIHRvIG9mZmVyIGZvciB0aGlzIGNoYXJcbiAgICB2YXIgYXZhaWxhYmxlID0gKGJ1ZmZlci5sZW5ndGggPj0gdGhpcy5jaGFyTGVuZ3RoIC0gdGhpcy5jaGFyUmVjZWl2ZWQpID9cbiAgICAgICAgdGhpcy5jaGFyTGVuZ3RoIC0gdGhpcy5jaGFyUmVjZWl2ZWQgOlxuICAgICAgICBidWZmZXIubGVuZ3RoO1xuXG4gICAgLy8gYWRkIHRoZSBuZXcgYnl0ZXMgdG8gdGhlIGNoYXIgYnVmZmVyXG4gICAgYnVmZmVyLmNvcHkodGhpcy5jaGFyQnVmZmVyLCB0aGlzLmNoYXJSZWNlaXZlZCwgMCwgYXZhaWxhYmxlKTtcbiAgICB0aGlzLmNoYXJSZWNlaXZlZCArPSBhdmFpbGFibGU7XG5cbiAgICBpZiAodGhpcy5jaGFyUmVjZWl2ZWQgPCB0aGlzLmNoYXJMZW5ndGgpIHtcbiAgICAgIC8vIHN0aWxsIG5vdCBlbm91Z2ggY2hhcnMgaW4gdGhpcyBidWZmZXI/IHdhaXQgZm9yIG1vcmUgLi4uXG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIGJ5dGVzIGJlbG9uZ2luZyB0byB0aGUgY3VycmVudCBjaGFyYWN0ZXIgZnJvbSB0aGUgYnVmZmVyXG4gICAgYnVmZmVyID0gYnVmZmVyLnNsaWNlKGF2YWlsYWJsZSwgYnVmZmVyLmxlbmd0aCk7XG5cbiAgICAvLyBnZXQgdGhlIGNoYXJhY3RlciB0aGF0IHdhcyBzcGxpdFxuICAgIGNoYXJTdHIgPSB0aGlzLmNoYXJCdWZmZXIuc2xpY2UoMCwgdGhpcy5jaGFyTGVuZ3RoKS50b1N0cmluZyh0aGlzLmVuY29kaW5nKTtcblxuICAgIC8vIENFU1UtODogbGVhZCBzdXJyb2dhdGUgKEQ4MDAtREJGRikgaXMgYWxzbyB0aGUgaW5jb21wbGV0ZSBjaGFyYWN0ZXJcbiAgICB2YXIgY2hhckNvZGUgPSBjaGFyU3RyLmNoYXJDb2RlQXQoY2hhclN0ci5sZW5ndGggLSAxKTtcbiAgICBpZiAoY2hhckNvZGUgPj0gMHhEODAwICYmIGNoYXJDb2RlIDw9IDB4REJGRikge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoICs9IHRoaXMuc3Vycm9nYXRlU2l6ZTtcbiAgICAgIGNoYXJTdHIgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICB0aGlzLmNoYXJSZWNlaXZlZCA9IHRoaXMuY2hhckxlbmd0aCA9IDA7XG5cbiAgICAvLyBpZiB0aGVyZSBhcmUgbm8gbW9yZSBieXRlcyBpbiB0aGlzIGJ1ZmZlciwganVzdCBlbWl0IG91ciBjaGFyXG4gICAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBjaGFyU3RyO1xuICAgIH1cbiAgICBicmVhaztcbiAgfVxuXG4gIC8vIGRldGVybWluZSBhbmQgc2V0IGNoYXJMZW5ndGggLyBjaGFyUmVjZWl2ZWRcbiAgdGhpcy5kZXRlY3RJbmNvbXBsZXRlQ2hhcihidWZmZXIpO1xuXG4gIHZhciBlbmQgPSBidWZmZXIubGVuZ3RoO1xuICBpZiAodGhpcy5jaGFyTGVuZ3RoKSB7XG4gICAgLy8gYnVmZmVyIHRoZSBpbmNvbXBsZXRlIGNoYXJhY3RlciBieXRlcyB3ZSBnb3RcbiAgICBidWZmZXIuY29weSh0aGlzLmNoYXJCdWZmZXIsIDAsIGJ1ZmZlci5sZW5ndGggLSB0aGlzLmNoYXJSZWNlaXZlZCwgZW5kKTtcbiAgICBlbmQgLT0gdGhpcy5jaGFyUmVjZWl2ZWQ7XG4gIH1cblxuICBjaGFyU3RyICs9IGJ1ZmZlci50b1N0cmluZyh0aGlzLmVuY29kaW5nLCAwLCBlbmQpO1xuXG4gIHZhciBlbmQgPSBjaGFyU3RyLmxlbmd0aCAtIDE7XG4gIHZhciBjaGFyQ29kZSA9IGNoYXJTdHIuY2hhckNvZGVBdChlbmQpO1xuICAvLyBDRVNVLTg6IGxlYWQgc3Vycm9nYXRlIChEODAwLURCRkYpIGlzIGFsc28gdGhlIGluY29tcGxldGUgY2hhcmFjdGVyXG4gIGlmIChjaGFyQ29kZSA+PSAweEQ4MDAgJiYgY2hhckNvZGUgPD0gMHhEQkZGKSB7XG4gICAgdmFyIHNpemUgPSB0aGlzLnN1cnJvZ2F0ZVNpemU7XG4gICAgdGhpcy5jaGFyTGVuZ3RoICs9IHNpemU7XG4gICAgdGhpcy5jaGFyUmVjZWl2ZWQgKz0gc2l6ZTtcbiAgICB0aGlzLmNoYXJCdWZmZXIuY29weSh0aGlzLmNoYXJCdWZmZXIsIHNpemUsIDAsIHNpemUpO1xuICAgIGJ1ZmZlci5jb3B5KHRoaXMuY2hhckJ1ZmZlciwgMCwgMCwgc2l6ZSk7XG4gICAgcmV0dXJuIGNoYXJTdHIuc3Vic3RyaW5nKDAsIGVuZCk7XG4gIH1cblxuICAvLyBvciBqdXN0IGVtaXQgdGhlIGNoYXJTdHJcbiAgcmV0dXJuIGNoYXJTdHI7XG59O1xuXG4vLyBkZXRlY3RJbmNvbXBsZXRlQ2hhciBkZXRlcm1pbmVzIGlmIHRoZXJlIGlzIGFuIGluY29tcGxldGUgVVRGLTggY2hhcmFjdGVyIGF0XG4vLyB0aGUgZW5kIG9mIHRoZSBnaXZlbiBidWZmZXIuIElmIHNvLCBpdCBzZXRzIHRoaXMuY2hhckxlbmd0aCB0byB0aGUgYnl0ZVxuLy8gbGVuZ3RoIHRoYXQgY2hhcmFjdGVyLCBhbmQgc2V0cyB0aGlzLmNoYXJSZWNlaXZlZCB0byB0aGUgbnVtYmVyIG9mIGJ5dGVzXG4vLyB0aGF0IGFyZSBhdmFpbGFibGUgZm9yIHRoaXMgY2hhcmFjdGVyLlxuU3RyaW5nRGVjb2Rlci5wcm90b3R5cGUuZGV0ZWN0SW5jb21wbGV0ZUNoYXIgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgLy8gZGV0ZXJtaW5lIGhvdyBtYW55IGJ5dGVzIHdlIGhhdmUgdG8gY2hlY2sgYXQgdGhlIGVuZCBvZiB0aGlzIGJ1ZmZlclxuICB2YXIgaSA9IChidWZmZXIubGVuZ3RoID49IDMpID8gMyA6IGJ1ZmZlci5sZW5ndGg7XG5cbiAgLy8gRmlndXJlIG91dCBpZiBvbmUgb2YgdGhlIGxhc3QgaSBieXRlcyBvZiBvdXIgYnVmZmVyIGFubm91bmNlcyBhblxuICAvLyBpbmNvbXBsZXRlIGNoYXIuXG4gIGZvciAoOyBpID4gMDsgaS0tKSB7XG4gICAgdmFyIGMgPSBidWZmZXJbYnVmZmVyLmxlbmd0aCAtIGldO1xuXG4gICAgLy8gU2VlIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvVVRGLTgjRGVzY3JpcHRpb25cblxuICAgIC8vIDExMFhYWFhYXG4gICAgaWYgKGkgPT0gMSAmJiBjID4+IDUgPT0gMHgwNikge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gMjtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIDExMTBYWFhYXG4gICAgaWYgKGkgPD0gMiAmJiBjID4+IDQgPT0gMHgwRSkge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gMztcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIDExMTEwWFhYXG4gICAgaWYgKGkgPD0gMyAmJiBjID4+IDMgPT0gMHgxRSkge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gNDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICB0aGlzLmNoYXJSZWNlaXZlZCA9IGk7XG59O1xuXG5TdHJpbmdEZWNvZGVyLnByb3RvdHlwZS5lbmQgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIHJlcyA9ICcnO1xuICBpZiAoYnVmZmVyICYmIGJ1ZmZlci5sZW5ndGgpXG4gICAgcmVzID0gdGhpcy53cml0ZShidWZmZXIpO1xuXG4gIGlmICh0aGlzLmNoYXJSZWNlaXZlZCkge1xuICAgIHZhciBjciA9IHRoaXMuY2hhclJlY2VpdmVkO1xuICAgIHZhciBidWYgPSB0aGlzLmNoYXJCdWZmZXI7XG4gICAgdmFyIGVuYyA9IHRoaXMuZW5jb2Rpbmc7XG4gICAgcmVzICs9IGJ1Zi5zbGljZSgwLCBjcikudG9TdHJpbmcoZW5jKTtcbiAgfVxuXG4gIHJldHVybiByZXM7XG59O1xuXG5mdW5jdGlvbiBwYXNzVGhyb3VnaFdyaXRlKGJ1ZmZlcikge1xuICByZXR1cm4gYnVmZmVyLnRvU3RyaW5nKHRoaXMuZW5jb2RpbmcpO1xufVxuXG5mdW5jdGlvbiB1dGYxNkRldGVjdEluY29tcGxldGVDaGFyKGJ1ZmZlcikge1xuICB0aGlzLmNoYXJSZWNlaXZlZCA9IGJ1ZmZlci5sZW5ndGggJSAyO1xuICB0aGlzLmNoYXJMZW5ndGggPSB0aGlzLmNoYXJSZWNlaXZlZCA/IDIgOiAwO1xufVxuXG5mdW5jdGlvbiBiYXNlNjREZXRlY3RJbmNvbXBsZXRlQ2hhcihidWZmZXIpIHtcbiAgdGhpcy5jaGFyUmVjZWl2ZWQgPSBidWZmZXIubGVuZ3RoICUgMztcbiAgdGhpcy5jaGFyTGVuZ3RoID0gdGhpcy5jaGFyUmVjZWl2ZWQgPyAzIDogMDtcbn1cbiJdfQ==
