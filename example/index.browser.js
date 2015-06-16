(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/home/kory/dev/fastn/binding.js":[function(require,module,exports){
var Enti = require('enti'),
    is = require('./is'),
    firmer = require('./firmer'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    same = require('same-value');

function fuseBinding(){
    var args = Array.prototype.slice.call(arguments);

    var bindings = args.slice(),
        transform = bindings.pop(),
        updateTransform,
        resultBinding = createBinding('result'),
        selfChanging;

    resultBinding._arguments = args;

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

function createBinding(path, more){

    if(more){ // used instead of arguments.length for performance
        return fuseBinding.apply(null, arguments);
    }

    if(path == null){
        throw "bindings must be created with a key (and or filter)";
    }

    var value,
        binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        if(path === '.'){
            return;
        }

        binding._set(newValue);
    };
    makeFunctionEmitter(binding);
    binding.setMaxListeners(10000);
    binding._arguments = Array.prototype.slice.call(arguments);
    binding._model = new Enti(false);
    binding._fastn_binding = path;
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
        binding._change(binding._model.get(path));
        binding.emit('attach', object, 1);
        return binding;
    };
    binding.detach = function(firm){
        if(firmer(binding, firm)){
            return binding;
        }

        value = undefined;
        if(binding._model.isAttached()){
            binding._model.detach();
        }
        if('detach' in binding._events){
            binding.emit('detach', 1);
        }
        return binding;
    };
    binding._set = function(newValue){
        if(same(binding._model.get(path), newValue)){
            return;
        }
        if(!binding._model.isAttached()){
            binding._model.attach(binding._model.get('.'));
        }
        binding._model.set(path, newValue);
    };
    binding._change = function(newValue){
        value = newValue;
        binding.emit('change', binding());
    };
    binding.clone = function(keepAttachment){
        var newBinding = createBinding.apply(null, binding._arguments);

        if(keepAttachment){
            newBinding.attach(binding._model, binding._firm);
        }

        return newBinding;
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

    if(path !== '.'){
        binding._model._events[path] = binding._change;
    }

    return binding;
}

module.exports = createBinding;
},{"./firmer":"/home/kory/dev/fastn/firmer.js","./is":"/home/kory/dev/fastn/is.js","./makeFunctionEmitter":"/home/kory/dev/fastn/makeFunctionEmitter.js","enti":"/home/kory/dev/fastn/node_modules/enti/index.js","same-value":"/home/kory/dev/fastn/node_modules/same-value/index.js"}],"/home/kory/dev/fastn/component.js":[function(require,module,exports){
var createBinding = require('./binding'),
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
        var setting = settings[key],
            property = component[key];

        if(is.property(settings[key])){

            // The componet already has a property at this key.
            // Destroy it.
            if(is.property(property)){
                property.destroy();
            }

            setting.addTo(component, key);

        }else if(is.property(property)){

            if(is.binding(setting)){
                property.binding(setting);
            }else{
                property(setting);
            }

            property.addTo(component, key);
        }

    }
}

module.exports = function createComponent(type, fastn, settings, children, components){
    var component,
        binding,
        scope = new fastn.Model(false);

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

        inflateProperties(component, settings);

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
            newBinding.attach(binding._model, binding._firm);
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

},{"./binding":"/home/kory/dev/fastn/binding.js","./is":"/home/kory/dev/fastn/is.js"}],"/home/kory/dev/fastn/containerComponent.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    is = require('./is');

module.exports = function(type, fastn){
    var container = new EventEmitter();

    container.insert = function(child, index){
        var component = child;

        if(index && typeof index === 'object'){
            component = Array.prototype.slice.call(arguments);
        }

        if(Array.isArray(component)){
            component.forEach(function(component, i){
                container.insert(component, i + (index || 0));
            });
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
    };

    container.empty = function(){
        while(container._children.length){
            container._remove(container._children.pop().detach(1).element);
        }
    };

    container.getContainerElement = function(){
        return container.containerElement || container.element;
    };

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
},{"./is":"/home/kory/dev/fastn/is.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/example/fastn.js":[function(require,module,exports){
/*
    A convenience singleton that sets up fastn so it can be required from other files.
*/

module.exports = require('../')({ // Require fastn

    // set up fastn with all the components you need for your application

    // The list component is used to render items based on a set of data.
    list: require('../listComponent'),

    // The text component is used to render text or bindings passed as children to other components.
    text: require('../textComponent'),

    // The _generic component is a catch-all for any component type that
    //  doesnt match any other component constructor, eg: 'div'
    _generic: require('../genericComponent')

}, true); // Pass true as the second parameter to turn on debug mode.
},{"../":"/home/kory/dev/fastn/index.js","../genericComponent":"/home/kory/dev/fastn/genericComponent.js","../listComponent":"/home/kory/dev/fastn/listComponent.js","../textComponent":"/home/kory/dev/fastn/textComponent.js"}],"/home/kory/dev/fastn/example/forkBanner.js":[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(){    
    return fastn('div', {class: 'github-fork-ribbon-wrapper right'},
        fastn('div', {class: 'github-fork-ribbon'},
            fastn('a', {href: 'https://github.com/korynunn/fastn'}, 'Fork me')
        )
    );
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js"}],"/home/kory/dev/fastn/example/header.js":[function(require,module,exports){
var fastn = require('./fastn'),
    usersModel = require('./users').usersModel;

module.exports = function(searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: './fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('span',
            fastn.binding('users|*.deleted', require('./search').result,  function(users, results){
                if(!users){
                    users = [];
                }

                var total = users.filter(function(user){
                        return !user.deleted;
                    }).length;

                var result = '';

                if(results){
                    result += 'Showing ' + results.length +' of ';
                }

                result += total;

                return result;
            }),
            ' users'
        ).attach(usersModel),
        require('./searchBar')()
    );
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./search":"/home/kory/dev/fastn/example/search.js","./searchBar":"/home/kory/dev/fastn/example/searchBar.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/index.js":[function(require,module,exports){
var fastn = require('./fastn'),
    userService = require('./users');

var app = fastn('div',
    require('./header')(),
    require('./userList')(),
    require('./stats')(),
    require('./forkBanner')()
);

window.onload = function(){

    app.render();

    document.body.appendChild(app.element);

    // Clear the selected user on click anywhere
    // Capture phase to allow bubbled events to set the selected user
    document.addEventListener('click', function(){
        userService.selectedUser(null);
    }, true);
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./forkBanner":"/home/kory/dev/fastn/example/forkBanner.js","./header":"/home/kory/dev/fastn/example/header.js","./stats":"/home/kory/dev/fastn/example/stats.js","./userList":"/home/kory/dev/fastn/example/userList.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/newUser.js":[function(require,module,exports){
var fastn = require('./fastn'),
    usersService = require('./users');

module.exports = function(){

    var newUserDialog = fastn('div', {class:'newUser dialog'},
        fastn('form', {class: 'modal'},

            fastn('field',
                fastn('label', 'First Name'),
                fastn('input', {
                    value: fastn.binding('name.first'),
                    onchange: 'value:value'
                })
            ),

            fastn('field',
                fastn('label', 'Surname'),
                fastn('input', {
                    value: fastn.binding('name.last'),
                    onchange: 'value:value'
                })
            ),

            fastn('field',
                fastn('label', 'Email'),
                fastn('input', {
                    value: fastn.binding('email'),
                    onchange: 'value:value'
                })
            ),

            fastn('field',
                fastn('label', 'Mobile'),
                fastn('input', {
                    value: fastn.binding('cell'),
                    onchange: 'value:value'
                })
            ),

            fastn('button', 'Add')
        )
        .on('submit', function(event, scope){
            event.preventDefault();

            usersService.addUser(scope.get('.'));

            closeModal();
        })
    )
    .on('click', function(event){
        if(event.target === this.element){
            closeModal();
        }
    });

    function closeModal(){
        newUserDialog.element.classList.add('closed');

        setTimeout(function(){
            document.body.removeChild(newUserDialog.element);
            newUserDialog.destroy();
        },300);
    }

    var randomImageId = Math.floor(Math.random() * 100);

    newUserDialog.attach({
        'gender':null,
        'name':{
            'title':null,
            'first':null,
            'last':null
        },
        'email':null,
        'dob':null,
        'cell':null,
        'picture':{
            'large':'http://api.randomuser.me/portraits/women/' + randomImageId + '.jpg',
            'medium':'http://api.randomuser.me/portraits/med/women/' + randomImageId + '.jpg',
            'thumbnail':'http://api.randomuser.me/portraits/thumb/women/' + randomImageId + '.jpg'
        }
    });

    newUserDialog.render();

    document.body.appendChild(newUserDialog.element);
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/search.js":[function(require,module,exports){
var fastn = require('./fastn'),
    usersService = require('./users');
    searchModel = {
        userSearch: '',
        result: null
    },
    userSearch = fastn.binding('userSearch').attach(searchModel)
        .on('change', function(search){
            var users = usersService.users();

            if(!search){
                fastn.Model.set(searchModel, 'result', null);
                return;
            }
            fastn.Model.set(searchModel, 'result', users.filter(function(user){
                if(!user || !user.name || !user.name.first || !user.name.last){
                    return;
                }
                return ~user.name.first.toLowerCase().indexOf(search.toLowerCase()) || ~user.name.last.toLowerCase().indexOf(search.toLowerCase());
            }));
        });

module.exports = {
    searchModel: searchModel,
    userSearch: userSearch,
    result: fastn.binding('result').attach(searchModel)
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/searchBar.js":[function(require,module,exports){
var fastn = require('./fastn'),
    search = require('./search');

module.exports = function(){
    return fastn('nav', {class: 'search'},
        fastn('label', 'Search'), 
        fastn('input', { 
            value: search.userSearch,
            onkeyup: 'value:value'
        })
    )
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./search":"/home/kory/dev/fastn/example/search.js"}],"/home/kory/dev/fastn/example/stats.js":[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(){

    return fastn('div', {class: 'stats'},
        'This example has ',
        fastn.binding('attachedEntis'),
        ' attached model instances'
    ).on('attach', function(data){
        setInterval(function(){
            fastn.Model.set(data, 'attachedEntis', fastn.Model.prototype.attachedCount());
        },100);
    });
    
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js"}],"/home/kory/dev/fastn/example/user.js":[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(selectedUser, deleteUser){
    var searchResult = require('./search').result,
        usersService = require('./users');

    return fastn('div', {
            class: fastn.binding('.', 'name', searchResult, usersService.selectedUser, usersService.deletedUsers, function(user, name, searchResult, selectedUser, deletedUsers){
                var classes = ['user'];

                if(searchResult && !~searchResult.indexOf(user)){
                    classes.push('hidden');
                }
                if(user === selectedUser){
                    classes.push('selected');
                }
                if(~deletedUsers.indexOf(user)){
                    classes.push('deleted');
                }
                return classes;
            })
        },

        fastn('img', {
            src: fastn.binding('picture.medium')
        }),

        fastn('div', {class: 'details'},

            fastn('label', {class: 'name'},
                fastn.binding('name.first'), ' ', fastn.binding('name.last')
            ),

            fastn('div', {class: 'info'},

                fastn('p', {class:'extra'},
                    fastn('a', {
                            href: fastn.binding('email', function(email){
                                return 'mailto:' + email;
                            })
                        },
                        fastn.binding('email')
                    ),
                    fastn('p', fastn.binding('cell', function(cell){
                        return 'Mobile: ' + cell;
                    }))
                )

            ),

            fastn('button', {class: 'remove'},'X')
            .on('click', function(event, scope){
                usersService.deleteUser(scope.get('.'));
            })
        )

    ).on('click', function(event, scope){
        usersService.selectedUser(scope.get('.'));
    });
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./search":"/home/kory/dev/fastn/example/search.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/userList.js":[function(require,module,exports){
var fastn = require('./fastn'),
    usersService = require('./users');

module.exports = function(){
    return fastn('list',
        {
            class: 'users',
            items: usersService.users,
            template: function(model, scope){
                return require('./user.js')().binding('item');
            }
        },
        fastn('button', {class: 'add'}, '+')
        .on('click', function(event, scope){
            require('./newUser')();
        })
    );
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","./newUser":"/home/kory/dev/fastn/example/newUser.js","./user.js":"/home/kory/dev/fastn/example/user.js","./users":"/home/kory/dev/fastn/example/users.js"}],"/home/kory/dev/fastn/example/users.js":[function(require,module,exports){
var cpjax = require('cpjax'),
    fastn = require('./fastn');

function getUsers(callback){
    cpjax({
        url: './users.json',
        dataType: 'json'
    }, function(error, users){
        callback(error, users.map(function(user){
            return user.user;
        }));
    });
};

var usersModel = new fastn.Model({
    users: [],
    deletedUsers: []
});

getUsers(function(error, users){
    if(error){
        return;
    }

    usersModel.set('users', users);
});

function deleteUser(user){
    usersModel.push('deletedUsers', user);
}

function addUser(user){
    usersModel.insert('users', user, 0);
}

module.exports = {
    usersModel: usersModel,
    users: fastn.binding('users|*').attach(usersModel),
    deletedUsers: fastn.binding('deletedUsers|*').attach(usersModel),
    selectedUser: fastn.binding('selected').attach(usersModel),
    deleteUser: deleteUser,
    addUser: addUser
};
},{"./fastn":"/home/kory/dev/fastn/example/fastn.js","cpjax":"/home/kory/dev/fastn/node_modules/cpjax/index.js"}],"/home/kory/dev/fastn/fancyProps.js":[function(require,module,exports){
var setify = require('setify');

module.exports = {
    class: function(generic, element, value){
        if(arguments.length === 2){
            return element.className.slice(generic._initialClasses.length);
        }
        if(Array.isArray(value)){
            value = value.join(' ');
        }
        element.className = generic._initialClasses + ' ' + value;
    },
    display: function(generic, element, value){
        if(arguments.length === 2){
            return element.style.display !== 'none';
        }
        element.style.display = value ? null : 'none';
    },
    disabled: function(generic, element, value){
        if(arguments.length === 2){
            return element.hasAttribute('disabled');
        }
        if(value){
            element.setAttribute('disabled', 'disabled');
        }else{
            element.removeAttribute('disabled');
        }
    },
    textContent: function(generic, element, value){
        if(arguments.length === 2){
            return element.textContent;
        }
        element.textContent = (value == null ? '' : value);
    },
    value: function(generic, element, value){
        var inputType = element.type;

        if(element.nodeName === 'INPUT' && inputType == 'date'){
            if(arguments.length === 2){
                return element.value ? new Date(element.value.replace(/-/g,'/').replace('T',' ')) : null;
            }

            value = value != null ? new Date(value) : null;

            if(!value || isNaN(value)){
                element.value = null;
            }else{
                element.value = [
                    value.getFullYear(), 
                    ('0' + (value.getMonth() + 1)).slice(-2),
                    ('0' + value.getDate()).slice(-2)
                ].join('-');
            }
            return;
        }

        if(arguments.length === 2){
            return element.value;
        }
        if(value === undefined){
            value = null;
        }

        setify(element, value);
    },
    style: function(generic, element, value){
        if(arguments.length === 2){
            return element.style;
        }

        var result = '';

        for(var key in value){
            element.style[key] = value[key];
        }
    }
};
},{"setify":"/home/kory/dev/fastn/node_modules/setify/index.js"}],"/home/kory/dev/fastn/firmer.js":[function(require,module,exports){
// Is the entity firmer than the new firmness
module.exports = function(entity, firm){
    if(firm != null && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
};
},{}],"/home/kory/dev/fastn/genericComponent.js":[function(require,module,exports){
var crel = require('crel'),
    containerComponent = require('./containerComponent'),
    schedule = require('./schedule'),
    fancyProps = require('./fancyProps');

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && (key in settings) ? setting : undefined;

    if(typeof value === 'function'){
        return;
    }

    function update(){
        var element = generic.getContainerElement(),
            value = property();

        if(!element || generic._destroyed){
            return;
        }

        var isProperty = key in element,
            fancyProp = fancyProps[key],
            previous = fancyProp ? fancyProp(generic, element) : isProperty ? element[key] : element.getAttribute(key);

        if(!fancyProp && !isProperty && value == null){
            value = '';
        }

        if(value !== previous){
            if(fancyProp){
                fancyProp(generic, element, value);
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
    }

    if(!property){
        property = fastn.property(value, function(){
            generic.updateProperty(generic, property, update);
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
            value = fancyProp ? fancyProp(generic, element) : element[autoEvent[1]];

        generic[autoEvent[0]](value);
    };

    element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function genericComponent(type, fastn, settings, children){
    var generic = containerComponent(type, fastn);

    generic.updateProperty = genericComponent.updateProperty;
    generic.createElement = genericComponent.createElement;
    createProperties(fastn, generic, settings);

    generic.render = function(){
        generic.element = generic.createElement(settings.tagName || type);

        generic.emit('render');

        return generic;
    };

    generic.on('render', function(){
        var element = generic.getContainerElement();

        generic._initialClasses = element.className;

        for(var key in settings){
            if(key.slice(0,2) === 'on' && key in element){
                addAutoHandler(generic, key, settings);
            }
        }

        for(var eventKey in generic._events){
            if('on' + eventKey.toLowerCase() in element){
                addUpdateHandler(generic, eventKey);
            }
        }
    });

    return generic;
};

genericComponent.updateProperty = function(generic, property, update){
    if(document.contains(generic.element)){
        schedule(property, update);
    }else{
        update();
    }
};

genericComponent.createElement = function(tagName){
    return document.createElement(tagName);
};

module.exports = genericComponent;
},{"./containerComponent":"/home/kory/dev/fastn/containerComponent.js","./fancyProps":"/home/kory/dev/fastn/fancyProps.js","./schedule":"/home/kory/dev/fastn/schedule.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js"}],"/home/kory/dev/fastn/index.js":[function(require,module,exports){
var merge = require('flat-merge'),
    createComponent = require('./component'),
    createProperty = require('./property'),
    createBinding = require('./binding'),
    crel = require('crel'),
    Enti = require('enti'),
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
        if(component == null){
            return;
        }
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
    fastn.Model = Enti;

    return fastn;
};
},{"./binding":"/home/kory/dev/fastn/binding.js","./component":"/home/kory/dev/fastn/component.js","./is":"/home/kory/dev/fastn/is.js","./property":"/home/kory/dev/fastn/property.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","enti":"/home/kory/dev/fastn/node_modules/enti/index.js","flat-merge":"/home/kory/dev/fastn/node_modules/flat-merge/index.js"}],"/home/kory/dev/fastn/is.js":[function(require,module,exports){

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
},{}],"/home/kory/dev/fastn/listComponent.js":[function(require,module,exports){
var Map = require('es6-map');

function each(value, fn){
    if(!value || typeof value !== 'object'){
        return;
    }

    if(Array.isArray(value)){
        value.forEach(fn);
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
    
    var list = fastn('_generic', settings, children),
        itemsMap = new Map(),
        lastTemplate;

    function updateItems(){
        var value = list.items(),
            template = list.template(),
            emptyTemplate = list.emptyTemplate(),
            newTemplate = lastTemplate !== template;

        if(!template){
            return;
        }

        var items = values(value);
            currentItems = items.slice();

        itemsMap.forEach(function(component, item){
            var currentIndex = currentItems.indexOf(item);

            if(!newTemplate && ~currentIndex){
                currentItems.splice(currentIndex,1);
            }else{
                list.removeItem(item, itemsMap);
            }
        });

        var index = 0;

        each(value, function(item, key){
            while(index < list._children.length && list._children[index]._templated && !~items.indexOf(list._children[index]._listItem)){
                index++;
            }

            var child,
                model = new fastn.Model({
                    item: item,
                    key: key
                });

            if(!itemsMap.has(item)){
                child = fastn.toComponent(template(model, list.scope()));
                if(!child){
                    child = fastn('template');
                }
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

    list.removeItem = function(item, itemsMap){
        var component = itemsMap.get(item);
        list.remove(component);
        component.destroy();
        itemsMap.delete(item);
    };

    fastn.property([], settings.itemChanges || 'type structure', updateItems)
        .addTo(list, 'items');

    fastn.property(undefined, 'value')
        .addTo(list, 'template')
        .on('change', updateItems);

    fastn.property(undefined, 'value')
        .addTo(list, 'emptyTemplate')
        .on('change', updateItems);

    return list;
};
},{"es6-map":"/home/kory/dev/fastn/node_modules/es6-map/index.js"}],"/home/kory/dev/fastn/makeFunctionEmitter.js":[function(require,module,exports){
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
},{"events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/node_modules/cpjax/index.js":[function(require,module,exports){
var Ajax = require('simple-ajax');

module.exports = function(settings, callback){
    if(typeof settings === 'string'){
        settings = {
            url: settings
        };
    }

    if(typeof settings !== 'object'){
        throw 'settings must be a string or object';
    }

    if(typeof callback !== 'function'){
        throw 'cpjax must be passed a callback as the second parameter';
    }

    var ajax = new Ajax(settings);

    ajax.on('success', function(event, data) {
        callback(null, data, event);
    });
    ajax.on('error', function(event) {
        callback(event.target.responseText, null, event);
    });

    ajax.send();

    return ajax;
};
},{"simple-ajax":"/home/kory/dev/fastn/node_modules/cpjax/node_modules/simple-ajax/index.js"}],"/home/kory/dev/fastn/node_modules/cpjax/node_modules/simple-ajax/index.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    queryString = require('query-string');

function tryParseJson(data){
    try{
        return JSON.parse(data);
    }catch(error){
        return error;
    }
}

function timeout(){
   this.request.abort();
   this.emit('timeout');
}

function Ajax(settings){
    var queryStringData,
        ajax = this;

    if(typeof settings === 'string'){
        settings = {
            url: settings
        };
    }

    if(typeof settings !== 'object'){
        settings = {};
    }

    ajax.settings = settings;
    ajax.request = new window.XMLHttpRequest();
    ajax.settings.method = ajax.settings.method || 'get';

    if(ajax.settings.cors){
        //http://www.html5rocks.com/en/tutorials/cors/
        if ('withCredentials' in ajax.request) {
            ajax.request.withCredentials = true;
        } else if (typeof XDomainRequest !== 'undefined') {
            // Otherwise, check if XDomainRequest.
            // XDomainRequest only exists in IE, and is IE's way of making CORS requests.
            ajax.request = new window.XDomainRequest();
        } else {
            // Otherwise, CORS is not supported by the browser.
            ajax.emit('error', new Error('Cors is not supported by this browser'));
        }
    }

    if(ajax.settings.cache === false){
        ajax.settings.data = ajax.settings.data || {};
        ajax.settings.data._ = new Date().getTime();
    }

    if(ajax.settings.method.toLowerCase() === 'get' && typeof ajax.settings.data === 'object'){
        var urlParts = ajax.settings.url.split('?');

        queryStringData = queryString.parse(urlParts[1]);

        for(var key in ajax.settings.data){
            queryStringData[key] = ajax.settings.data[key];
        }

        ajax.settings.url = urlParts[0] + '?' + queryString.stringify(queryStringData);
        ajax.settings.data = null;
    }

    ajax.request.addEventListener('progress', function(event){
        ajax.emit('progress', event);
    }, false);

    ajax.request.addEventListener('load', function(event){
        var data = event.target.responseText;

        if(ajax.settings.dataType && ajax.settings.dataType.toLowerCase() === 'json'){
            if(data === ''){
                data = undefined;
            }else{
                data = tryParseJson(data);
                if(data instanceof Error){
                    ajax.emit('error', event, data);
                    return;
                }
            }
        }

        if(event.target.status >= 400){
            ajax.emit('error', event, data);
        } else {
            ajax.emit('success', event, data);
        }

    }, false);

    ajax.request.addEventListener('error', function(event){
        ajax.emit('error', event);
    }, false);

    ajax.request.addEventListener('abort', function(event){
        ajax.emit('abort', event);
    }, false);

    ajax.request.addEventListener('loadend', function(event){
        clearTimeout(this._requestTimeout);
        ajax.emit('complete', event);
    }, false);

    ajax.request.open(ajax.settings.method || 'get', ajax.settings.url, true);

    // Set default headers
    if(ajax.settings.contentType !== false){
        ajax.request.setRequestHeader('Content-Type', ajax.settings.contentType || 'application/json; charset=utf-8');
    }
    ajax.request.setRequestHeader('X-Requested-With', ajax.settings.requestedWith || 'XMLHttpRequest');
    if(ajax.settings.auth){
        ajax.request.setRequestHeader('Authorization', ajax.settings.auth);
    }

    // Set custom headers
    for(var headerKey in ajax.settings.headers){
        ajax.request.setRequestHeader(headerKey, ajax.settings.headers[headerKey]);
    }

    if(ajax.settings.processData !== false && ajax.settings.dataType === 'json'){
        ajax.settings.data = JSON.stringify(ajax.settings.data);
    }
}

Ajax.prototype = Object.create(EventEmitter.prototype);

Ajax.prototype.send = function(){
    this._requestTimeout = setTimeout(
        timeout.bind(this),
        this.settings.timeout || 120000
    );
    this.request.send(this.settings.data && this.settings.data);
};

module.exports = Ajax;
},{"events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js","query-string":"/home/kory/dev/fastn/node_modules/cpjax/node_modules/simple-ajax/node_modules/query-string/query-string.js"}],"/home/kory/dev/fastn/node_modules/cpjax/node_modules/simple-ajax/node_modules/query-string/query-string.js":[function(require,module,exports){
/*!
	query-string
	Parse and stringify URL query strings
	https://github.com/sindresorhus/query-string
	by Sindre Sorhus
	MIT License
*/
(function () {
	'use strict';
	var queryString = {};

	queryString.parse = function (str) {
		if (typeof str !== 'string') {
			return {};
		}

		str = str.trim().replace(/^(\?|#)/, '');

		if (!str) {
			return {};
		}

		return str.trim().split('&').reduce(function (ret, param) {
			var parts = param.replace(/\+/g, ' ').split('=');
			var key = parts[0];
			var val = parts[1];

			key = decodeURIComponent(key);
			// missing `=` should be `null`:
			// http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
			val = val === undefined ? null : decodeURIComponent(val);

			if (!ret.hasOwnProperty(key)) {
				ret[key] = val;
			} else if (Array.isArray(ret[key])) {
				ret[key].push(val);
			} else {
				ret[key] = [ret[key], val];
			}

			return ret;
		}, {});
	};

	queryString.stringify = function (obj) {
		return obj ? Object.keys(obj).map(function (key) {
			var val = obj[key];

			if (Array.isArray(val)) {
				return val.map(function (val2) {
					return encodeURIComponent(key) + '=' + encodeURIComponent(val2);
				}).join('&');
			}

			return encodeURIComponent(key) + '=' + encodeURIComponent(val);
		}).join('&') : '';
	};

	if (typeof define === 'function' && define.amd) {
		define(function() { return queryString; });
	} else if (typeof module !== 'undefined' && module.exports) {
		module.exports = queryString;
	} else {
		self.queryString = queryString;
	}
})();

},{}],"/home/kory/dev/fastn/node_modules/crel/crel.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/index.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    Set = require('es6-set'),
    WeakMap = require('es6-weak-map');

function toArray(items){
    return Array.prototype.slice.call(items);
}

var deepRegex = /[|.]/i;

function matchDeep(path){
    return (path + '').match(deepRegex);
}

function isDeep(path){
    var stringPath = (path + '');
    return ~stringPath.indexOf('.') || ~stringPath.indexOf('**') || ~stringPath.indexOf('|');
}

function isWildcardPath(path){
    var stringPath = (path + '');
    return ~stringPath.indexOf('*');
}

function isFilterPath(path){
    var stringPath = (path + '');
    return ~stringPath.indexOf('|');
}

function getTargetKey(path){
    var stringPath = (path + '');
    return stringPath.split('|').shift();
}

var attachedEnties = new Set(),
    trackedObjects = new WeakMap();

function leftAndRest(path){
    var stringPath = (path + '');

    // Special case when you want to filter on self (.)
    if(stringPath.slice(0,2) === '.|'){
        return ['.', stringPath.slice(2)];
    }

    var match = matchDeep(stringPath);
    if(match){
        return [stringPath.slice(0, match.index), stringPath.slice(match.index+1)];
    }
    return stringPath;
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

function trackObjects(eventName, weakMap, handler, object, key, path){
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
        if(eventKey !== '*' && typeof object[eventKey] === 'object' && object[eventKey] !== target){
            if(targetIsObject){
                weakMap.delete(target);
            }
            removeHandler(object, eventKey, handle);
            trackObjects(eventName, weakMap, handler, object, key, path);
            return;
        }

        if(eventKey === '*'){
            trackKeys(object, key, path);
        }

        if(!weakMap.has(object)){
            return;
        }

        if(key !== '**' || !path){
            handler(value, event, emitKey);
        }
    }

    function trackKeys(target, root, rest){
        var keys = Object.keys(target);
        for(var i = 0; i < keys.length; i++){
            if(isFeralcardKey(root)){
                trackObjects(eventName, weakMap, handler, target, keys[i], '**' + (rest ? '.' : '') + (rest || ''));
            }else{
                trackObjects(eventName, weakMap, handler, target, keys[i], rest);
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

        // If the root is '.', watch for events on *
        if(root === '.'){
            root = '*';
        }
    }

    if(targetIsObject && isWildcardKey(root)){
        trackKeys(target, root, rest);
    }

    trackObjects(eventName, weakMap, handler, target, root, rest);
}

var trackedEvents = new WeakMap();

function trackPath(enti, eventName){
    var object = enti._model,
        trackedObjectPaths = trackedEvents.get(object);

    if(!trackedObjectPaths){
        trackedObjectPaths = {};
        trackedEvents.set(object, trackedObjectPaths);
    }

    var trackedPaths = trackedObjectPaths[eventName];

    if(!trackedPaths){
        trackedPaths = {
            entis: new Set(),
            trackedObjects: new WeakMap()
        };
        trackedObjectPaths[eventName] = trackedPaths;
    }

    if(trackedPaths.entis.has(enti)){
        return;
    }

    trackedPaths.entis.add(enti);

    var handler = function(value, event, emitKey){
        trackedPaths.entis.forEach(function(enti){
            if(enti._model !== object){
                trackedPaths.entis.delete(enti);
                if(trackedPaths.entis.size === 0){
                    delete trackedObjectPaths[eventName];
                    if(!Object.keys(trackedObjectPaths).length){
                        trackedEvents.delete(object);
                    }
                }
                return;
            }
            if(enti._emittedEvents[eventName] === emitKey){
                return;
            }
            enti._emittedEvents[eventName] = emitKey;

            if(isDeep(eventName) && (isFilterPath(eventName) || !isWildcardPath(eventName))){
                enti.emit(eventName, enti.get(getTargetKey(eventName)), event);
                return;
            }

            enti.emit(eventName, value, event);
        });
    }

    trackObjects(eventName, trackedPaths.trackedObjects, handler, {model:object}, 'model', eventName);
}

function trackPaths(enti, target){
    if(!enti._events){
        return;
    }

    var keys = Object.keys(enti._events),
        key;

    for(var i = 0; key = keys[i], i < keys.length; i++){
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

    key = getTargetKey(key);

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
    
    key = getTargetKey(key);

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

    emit([[model, index, item]]);
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

},{"es6-set":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/index.js","es6-weak-map":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Set : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/polyfill.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/is-native-implemented.js":[function(require,module,exports){
// Exports true if environment provides native `Set` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Set === 'undefined') return false;
	return (Object.prototype.toString.call(Set.prototype) === '[object Set]');
}());

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/lib/iterator.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/index.js","es6-iterator":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/index.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/auto-bind.js":[function(require,module,exports){
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

},{"es5-ext/object/copy":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/copy.js","es5-ext/object/map":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/map.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js":[function(require,module,exports){
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

},{"es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/index.js","es5-ext/object/is-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/is-callable.js","es5-ext/object/normalize-options":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/normalize-options.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/array/#/clear.js":[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

'use strict';

var value = require('../../object/valid-value');

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/array/#/e-index-of.js":[function(require,module,exports){
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

},{"../../number/to-pos-integer":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/number/to-pos-integer.js","../../object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Math.sign
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var sign = Math.sign;
	if (typeof sign !== 'function') return false;
	return ((sign(10) === 1) && (sign(-20) === -1));
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/shim.js":[function(require,module,exports){
'use strict';

module.exports = function (value) {
	value = Number(value);
	if (isNaN(value) || (value === 0)) return value;
	return (value > 0) ? 1 : -1;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/number/to-integer.js":[function(require,module,exports){
'use strict';

var sign = require('../math/sign')

  , abs = Math.abs, floor = Math.floor;

module.exports = function (value) {
	if (isNaN(value)) return 0;
	value = Number(value);
	if ((value === 0) || !isFinite(value)) return value;
	return sign(value) * floor(abs(value));
};

},{"../math/sign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/math/sign/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/number/to-pos-integer.js":[function(require,module,exports){
'use strict';

var toInteger = require('./to-integer')

  , max = Math.max;

module.exports = function (value) { return max(0, toInteger(value)); };

},{"./to-integer":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/number/to-integer.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/_iterate.js":[function(require,module,exports){
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

},{"./is-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/is-callable.js","./valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js","./valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.assign
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== 'function') return false;
	obj = { foo: 'raz' };
	assign(obj, { bar: 'dwa' }, { trzy: 'trzy' });
	return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/shim.js":[function(require,module,exports){
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

},{"../keys":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/index.js","../valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/copy.js":[function(require,module,exports){
'use strict';

var assign = require('./assign')
  , value  = require('./valid-value');

module.exports = function (obj) {
	var copy = Object(value(obj));
	if (copy !== obj) return copy;
	return assign({}, obj);
};

},{"./assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/index.js","./valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/create.js":[function(require,module,exports){
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

},{"./set-prototype-of/is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./set-prototype-of/shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/for-each.js":[function(require,module,exports){
'use strict';

module.exports = require('./_iterate')('forEach');

},{"./_iterate":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/_iterate.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/is-callable.js":[function(require,module,exports){
// Deprecated

'use strict';

module.exports = function (obj) { return typeof obj === 'function'; };

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/is-object.js":[function(require,module,exports){
'use strict';

var map = { function: true, object: true };

module.exports = function (x) {
	return ((x != null) && map[typeof x]) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.keys
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	try {
		Object.keys('primitive');
		return true;
	} catch (e) { return false; }
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/keys/shim.js":[function(require,module,exports){
'use strict';

var keys = Object.keys;

module.exports = function (object) {
	return keys(object == null ? object : Object(object));
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/map.js":[function(require,module,exports){
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

},{"./for-each":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/for-each.js","./valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/normalize-options.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.setPrototypeOf
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/is-implemented.js":[function(require,module,exports){
'use strict';

var create = Object.create, getPrototypeOf = Object.getPrototypeOf
  , x = {};

module.exports = function (/*customCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf
	  , customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== 'function') return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), x)) === x;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/shim.js":[function(require,module,exports){
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

},{"../create":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/create.js","../is-object":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/is-object.js","../valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js":[function(require,module,exports){
'use strict';

module.exports = function (fn) {
	if (typeof fn !== 'function') throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js":[function(require,module,exports){
'use strict';

module.exports = function (value) {
	if (value == null) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? String.prototype.contains
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/is-implemented.js":[function(require,module,exports){
'use strict';

var str = 'razdwatrzy';

module.exports = function () {
	if (typeof str.contains !== 'function') return false;
	return ((str.contains('dwa') === true) && (str.contains('foo') === false));
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/shim.js":[function(require,module,exports){
'use strict';

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/is-string.js":[function(require,module,exports){
'use strict';

var toString = Object.prototype.toString

  , id = toString.call('');

module.exports = function (x) {
	return (typeof x === 'string') || (x && (typeof x === 'object') &&
		((x instanceof String) || (toString.call(x) === id))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/array.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/for-of.js":[function(require,module,exports){
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

},{"./get":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/get.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/is-string.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/get.js":[function(require,module,exports){
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

},{"./array":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/array.js","./string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/string.js","./valid-iterable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/valid-iterable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/index.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","d/auto-bind":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/auto-bind.js","es5-ext/array/#/clear":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/array/#/clear.js","es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/assign/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-value.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/is-iterable.js":[function(require,module,exports){
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

},{"es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/polyfill.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/is-symbol.js":[function(require,module,exports){
'use strict';

module.exports = function (x) {
	return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/polyfill.js":[function(require,module,exports){
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

},{"./validate-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/validate-symbol.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/validate-symbol.js":[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/node_modules/es6-symbol/is-symbol.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/string.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/valid-iterable.js":[function(require,module,exports){
'use strict';

var isIterable = require('./is-iterable');

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/is-iterable.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/polyfill.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/polyfill.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/event-emitter/index.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/polyfill.js":[function(require,module,exports){
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

},{"./is-native-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/is-native-implemented.js","./lib/iterator":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/lib/iterator.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/d/index.js","es5-ext/array/#/clear":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/array/#/clear.js","es5-ext/array/#/e-index-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/array/#/e-index-of.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es5-ext/object/valid-callable.js","es6-iterator/for-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/for-of.js","es6-iterator/valid-iterable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-iterator/valid-iterable.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/es6-symbol/index.js","event-emitter":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-set/node_modules/event-emitter/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? WeakMap : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/polyfill.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var weakMap, x;
	if (typeof WeakMap !== 'function') return false;
	if (String(WeakMap.prototype) !== '[object WeakMap]') return false;
	try {
		// WebKit doesn't support arguments and crashes
		weakMap = new WeakMap([[x = {}, 'one'], [{}, 'two'], [{}, 'three']]);
	} catch (e) {
		return false;
	}
	if (typeof weakMap.set !== 'function') return false;
	if (weakMap.set({}, 1) !== weakMap) return false;
	if (typeof weakMap.delete !== 'function') return false;
	if (typeof weakMap.has !== 'function') return false;
	if (weakMap.get(x) !== 'one') return false;

	return true;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/is-native-implemented.js":[function(require,module,exports){
// Exports true if environment provides native `WeakMap` implementation, whatever that is.

'use strict';

module.exports = (function () {
	if (typeof WeakMap !== 'function') return false;
	return (Object.prototype.toString.call(new WeakMap()) === '[object WeakMap]');
}());

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/auto-bind.js":[function(require,module,exports){
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

},{"es5-ext/object/copy":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/copy.js","es5-ext/object/map":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/map.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js":[function(require,module,exports){
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

},{"es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/index.js","es5-ext/object/is-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-callable.js","es5-ext/object/normalize-options":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/normalize-options.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/array/#/clear.js":[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

'use strict';

var value = require('../../object/valid-value');

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/_iterate.js":[function(require,module,exports){
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

},{"./is-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-callable.js","./valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js","./valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.assign
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== 'function') return false;
	obj = { foo: 'raz' };
	assign(obj, { bar: 'dwa' }, { trzy: 'trzy' });
	return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/shim.js":[function(require,module,exports){
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

},{"../keys":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/index.js","../valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/copy.js":[function(require,module,exports){
'use strict';

var assign = require('./assign')
  , value  = require('./valid-value');

module.exports = function (obj) {
	var copy = Object(value(obj));
	if (copy !== obj) return copy;
	return assign({}, obj);
};

},{"./assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/index.js","./valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/create.js":[function(require,module,exports){
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

},{"./set-prototype-of/is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./set-prototype-of/shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/for-each.js":[function(require,module,exports){
'use strict';

module.exports = require('./_iterate')('forEach');

},{"./_iterate":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/_iterate.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-callable.js":[function(require,module,exports){
// Deprecated

'use strict';

module.exports = function (obj) { return typeof obj === 'function'; };

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-object.js":[function(require,module,exports){
'use strict';

var map = { function: true, object: true };

module.exports = function (x) {
	return ((x != null) && map[typeof x]) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.keys
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	try {
		Object.keys('primitive');
		return true;
	} catch (e) { return false; }
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/keys/shim.js":[function(require,module,exports){
'use strict';

var keys = Object.keys;

module.exports = function (object) {
	return keys(object == null ? object : Object(object));
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/map.js":[function(require,module,exports){
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

},{"./for-each":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/for-each.js","./valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/normalize-options.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.setPrototypeOf
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js":[function(require,module,exports){
'use strict';

var create = Object.create, getPrototypeOf = Object.getPrototypeOf
  , x = {};

module.exports = function (/*customCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf
	  , customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== 'function') return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), x)) === x;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/shim.js":[function(require,module,exports){
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

},{"../create":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/create.js","../is-object":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-object.js","../valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js":[function(require,module,exports){
'use strict';

module.exports = function (fn) {
	if (typeof fn !== 'function') throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-object.js":[function(require,module,exports){
'use strict';

var isObject = require('./is-object');

module.exports = function (value) {
	if (!isObject(value)) throw new TypeError(value + " is not an Object");
	return value;
};

},{"./is-object":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/is-object.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js":[function(require,module,exports){
'use strict';

module.exports = function (value) {
	if (value == null) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? String.prototype.contains
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/shim.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/is-implemented.js":[function(require,module,exports){
'use strict';

var str = 'razdwatrzy';

module.exports = function () {
	if (typeof str.contains !== 'function') return false;
	return ((str.contains('dwa') === true) && (str.contains('foo') === false));
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/shim.js":[function(require,module,exports){
'use strict';

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/is-string.js":[function(require,module,exports){
'use strict';

var toString = Object.prototype.toString

  , id = toString.call('');

module.exports = function (x) {
	return (typeof x === 'string') || (x && (typeof x === 'object') &&
		((x instanceof String) || (toString.call(x) === id))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/random-uniq.js":[function(require,module,exports){
'use strict';

var generated = Object.create(null)

  , random = Math.random;

module.exports = function () {
	var str;
	do { str = random().toString(36).slice(2); } while (generated[str]);
	return str;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/array.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/for-of.js":[function(require,module,exports){
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

},{"./get":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/get.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/is-string.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/get.js":[function(require,module,exports){
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

},{"./array":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/array.js","./string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/string.js","./valid-iterable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/valid-iterable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/index.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js","d/auto-bind":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/auto-bind.js","es5-ext/array/#/clear":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/array/#/clear.js","es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/assign/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/is-iterable.js":[function(require,module,exports){
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

},{"es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/string.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/valid-iterable.js":[function(require,module,exports){
'use strict';

var isIterable = require('./is-iterable');

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/is-iterable.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/polyfill.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/is-symbol.js":[function(require,module,exports){
'use strict';

module.exports = function (x) {
	return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/polyfill.js":[function(require,module,exports){
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

},{"./validate-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/validate-symbol.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/validate-symbol.js":[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/is-symbol.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/polyfill.js":[function(require,module,exports){
'use strict';

var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
  , object            = require('es5-ext/object/valid-object')
  , value             = require('es5-ext/object/valid-value')
  , randomUniq        = require('es5-ext/string/random-uniq')
  , d                 = require('d')
  , getIterator       = require('es6-iterator/get')
  , forOf             = require('es6-iterator/for-of')
  , toStringTagSymbol = require('es6-symbol').toStringTag
  , isNative          = require('./is-native-implemented')

  , isArray = Array.isArray, defineProperty = Object.defineProperty
  , hasOwnProperty = Object.prototype.hasOwnProperty, getPrototypeOf = Object.getPrototypeOf
  , WeakMapPoly;

module.exports = WeakMapPoly = function (/*iterable*/) {
	var iterable = arguments[0], self;
	if (!(this instanceof WeakMapPoly)) throw new TypeError('Constructor requires \'new\'');
	if (isNative && setPrototypeOf && (WeakMap !== WeakMapPoly)) {
		self = setPrototypeOf(new WeakMap(), getPrototypeOf(this));
	} else {
		self = this;
	}
	if (iterable != null) {
		if (!isArray(iterable)) iterable = getIterator(iterable);
	}
	defineProperty(self, '__weakMapData__', d('c', '$weakMap$' + randomUniq()));
	if (!iterable) return self;
	forOf(iterable, function (val) {
		value(val);
		self.set(val[0], val[1]);
	});
	return self;
};

if (isNative) {
	if (setPrototypeOf) setPrototypeOf(WeakMapPoly, WeakMap);
	WeakMapPoly.prototype = Object.create(WeakMap.prototype, {
		constructor: d(WeakMapPoly)
	});
}

Object.defineProperties(WeakMapPoly.prototype, {
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

},{"./is-native-implemented":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/is-native-implemented.js","d":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/object/valid-object":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-object.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/object/valid-value.js","es5-ext/string/random-uniq":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es5-ext/string/random-uniq.js","es6-iterator/for-of":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/for-of.js","es6-iterator/get":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-iterator/get.js","es6-symbol":"/home/kory/dev/fastn/node_modules/enti/node_modules/es6-weak-map/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Map : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/es6-map/polyfill.js"}],"/home/kory/dev/fastn/node_modules/es6-map/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/es6-map/is-native-implemented.js":[function(require,module,exports){
// Exports true if environment provides native `Map` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Map === 'undefined') return false;
	return (Object.prototype.toString.call(Map.prototype) === '[object Map]');
}());

},{}],"/home/kory/dev/fastn/node_modules/es6-map/lib/iterator-kinds.js":[function(require,module,exports){
'use strict';

module.exports = require('es5-ext/object/primitive-set')('key',
	'value', 'key+value');

},{"es5-ext/object/primitive-set":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/primitive-set.js"}],"/home/kory/dev/fastn/node_modules/es6-map/lib/iterator.js":[function(require,module,exports){
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

},{"./iterator-kinds":"/home/kory/dev/fastn/node_modules/es6-map/lib/iterator-kinds.js","d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/index.js","es6-iterator":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/index.js","es6-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/auto-bind.js":[function(require,module,exports){
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

},{"es5-ext/object/copy":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/copy.js","es5-ext/object/map":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/map.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js":[function(require,module,exports){
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

},{"es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/index.js","es5-ext/object/is-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/is-callable.js","es5-ext/object/normalize-options":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/normalize-options.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/array/#/clear.js":[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

'use strict';

var value = require('../../object/valid-value');

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/array/#/e-index-of.js":[function(require,module,exports){
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

},{"../../number/to-pos-integer":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/number/to-pos-integer.js","../../object/valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Math.sign
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var sign = Math.sign;
	if (typeof sign !== 'function') return false;
	return ((sign(10) === 1) && (sign(-20) === -1));
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/shim.js":[function(require,module,exports){
'use strict';

module.exports = function (value) {
	value = Number(value);
	if (isNaN(value) || (value === 0)) return value;
	return (value > 0) ? 1 : -1;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/number/to-integer.js":[function(require,module,exports){
'use strict';

var sign = require('../math/sign')

  , abs = Math.abs, floor = Math.floor;

module.exports = function (value) {
	if (isNaN(value)) return 0;
	value = Number(value);
	if ((value === 0) || !isFinite(value)) return value;
	return sign(value) * floor(abs(value));
};

},{"../math/sign":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/math/sign/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/number/to-pos-integer.js":[function(require,module,exports){
'use strict';

var toInteger = require('./to-integer')

  , max = Math.max;

module.exports = function (value) { return max(0, toInteger(value)); };

},{"./to-integer":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/number/to-integer.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/_iterate.js":[function(require,module,exports){
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

},{"./is-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/is-callable.js","./valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js","./valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.assign
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== 'function') return false;
	obj = { foo: 'raz' };
	assign(obj, { bar: 'dwa' }, { trzy: 'trzy' });
	return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/shim.js":[function(require,module,exports){
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

},{"../keys":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/index.js","../valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/copy.js":[function(require,module,exports){
'use strict';

var assign = require('./assign')
  , value  = require('./valid-value');

module.exports = function (obj) {
	var copy = Object(value(obj));
	if (copy !== obj) return copy;
	return assign({}, obj);
};

},{"./assign":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/index.js","./valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/create.js":[function(require,module,exports){
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

},{"./set-prototype-of/is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./set-prototype-of/shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/for-each.js":[function(require,module,exports){
'use strict';

module.exports = require('./_iterate')('forEach');

},{"./_iterate":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/_iterate.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/is-callable.js":[function(require,module,exports){
// Deprecated

'use strict';

module.exports = function (obj) { return typeof obj === 'function'; };

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/is-object.js":[function(require,module,exports){
'use strict';

var map = { function: true, object: true };

module.exports = function (x) {
	return ((x != null) && map[typeof x]) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.keys
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/is-implemented.js":[function(require,module,exports){
'use strict';

module.exports = function () {
	try {
		Object.keys('primitive');
		return true;
	} catch (e) { return false; }
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/keys/shim.js":[function(require,module,exports){
'use strict';

var keys = Object.keys;

module.exports = function (object) {
	return keys(object == null ? object : Object(object));
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/map.js":[function(require,module,exports){
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

},{"./for-each":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/for-each.js","./valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/normalize-options.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/primitive-set.js":[function(require,module,exports){
'use strict';

var forEach = Array.prototype.forEach, create = Object.create;

module.exports = function (arg/*, …args*/) {
	var set = create(null);
	forEach.call(arguments, function (name) { set[name] = true; });
	return set;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.setPrototypeOf
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/is-implemented.js":[function(require,module,exports){
'use strict';

var create = Object.create, getPrototypeOf = Object.getPrototypeOf
  , x = {};

module.exports = function (/*customCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf
	  , customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== 'function') return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), x)) === x;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/shim.js":[function(require,module,exports){
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

},{"../create":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/create.js","../is-object":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/is-object.js","../valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js":[function(require,module,exports){
'use strict';

module.exports = function (fn) {
	if (typeof fn !== 'function') throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js":[function(require,module,exports){
'use strict';

module.exports = function (value) {
	if (value == null) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? String.prototype.contains
	: require('./shim');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/is-implemented.js","./shim":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/shim.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/is-implemented.js":[function(require,module,exports){
'use strict';

var str = 'razdwatrzy';

module.exports = function () {
	if (typeof str.contains !== 'function') return false;
	return ((str.contains('dwa') === true) && (str.contains('foo') === false));
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/shim.js":[function(require,module,exports){
'use strict';

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/is-string.js":[function(require,module,exports){
'use strict';

var toString = Object.prototype.toString

  , id = toString.call('');

module.exports = function (x) {
	return (typeof x === 'string') || (x && (typeof x === 'object') &&
		((x instanceof String) || (toString.call(x) === id))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/array.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/string/#/contains":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/#/contains/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/for-of.js":[function(require,module,exports){
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

},{"./get":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/get.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/is-string.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/get.js":[function(require,module,exports){
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

},{"./array":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/array.js","./string":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/string.js","./valid-iterable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/valid-iterable.js","es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/index.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","d/auto-bind":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/auto-bind.js","es5-ext/array/#/clear":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/array/#/clear.js","es5-ext/object/assign":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/assign/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js","es6-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/is-iterable.js":[function(require,module,exports){
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

},{"es5-ext/string/is-string":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/string/is-string.js","es6-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/polyfill.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/is-symbol.js":[function(require,module,exports){
'use strict';

module.exports = function (x) {
	return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
};

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/polyfill.js":[function(require,module,exports){
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

},{"./validate-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/validate-symbol.js","d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/validate-symbol.js":[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/node_modules/es6-symbol/is-symbol.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/string.js":[function(require,module,exports){
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

},{"./":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/index.js","d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/valid-iterable.js":[function(require,module,exports){
'use strict';

var isIterable = require('./is-iterable');

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/is-iterable.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/index.js":[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/is-implemented.js","./polyfill":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/polyfill.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/is-implemented.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/polyfill.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js"}],"/home/kory/dev/fastn/node_modules/es6-map/node_modules/event-emitter/index.js":[function(require,module,exports){
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

},{"d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js"}],"/home/kory/dev/fastn/node_modules/es6-map/polyfill.js":[function(require,module,exports){
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

},{"./is-native-implemented":"/home/kory/dev/fastn/node_modules/es6-map/is-native-implemented.js","./lib/iterator":"/home/kory/dev/fastn/node_modules/es6-map/lib/iterator.js","d":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/d/index.js","es5-ext/array/#/clear":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/array/#/clear.js","es5-ext/array/#/e-index-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/array/#/e-index-of.js","es5-ext/object/set-prototype-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/set-prototype-of/index.js","es5-ext/object/valid-callable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-callable.js","es5-ext/object/valid-value":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es5-ext/object/valid-value.js","es6-iterator/for-of":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/for-of.js","es6-iterator/valid-iterable":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-iterator/valid-iterable.js","es6-symbol":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/es6-symbol/index.js","event-emitter":"/home/kory/dev/fastn/node_modules/es6-map/node_modules/event-emitter/index.js"}],"/home/kory/dev/fastn/node_modules/flat-merge/index.js":[function(require,module,exports){
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
},{}],"/home/kory/dev/fastn/node_modules/same-value/index.js":[function(require,module,exports){
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
},{}],"/home/kory/dev/fastn/node_modules/setify/index.js":[function(require,module,exports){
var unsupportedTypes = ['number', 'email', 'time', 'color', 'month', 'range', 'date'];

module.exports = function(element, value){
    var canSet = element.setSelectionRange &&
                !~unsupportedTypes.indexOf(element.type) &&
                element === document.activeElement;

    if (canSet) {
        var start = element.selectionStart,
            end = element.selectionEnd;

        element.value = value;
        element.setSelectionRange(start, end);
    } else {
        element.value = value;
    }
};
},{}],"/home/kory/dev/fastn/node_modules/what-changed/index.js":[function(require,module,exports){
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
},{"clone":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/clone/clone.js","deep-equal":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/index.js"}],"/home/kory/dev/fastn/node_modules/what-changed/node_modules/clone/clone.js":[function(require,module,exports){
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
},{"buffer":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/index.js"}],"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/index.js":[function(require,module,exports){
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

},{"./lib/is_arguments.js":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/lib/is_arguments.js","./lib/keys.js":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/lib/keys.js"}],"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/lib/is_arguments.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/lib/keys.js":[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],"/home/kory/dev/fastn/property.js":[function(require,module,exports){
var Enti = require('enti'),
    WhatChanged = require('what-changed'),
    firmer = require('./firmer'),
    createBinding = require('./binding'),
    makeFunctionEmitter = require('./makeFunctionEmitter'),
    is = require('./is');

function createProperty(currentValue, changes, updater){
    if(typeof changes === 'function'){
        updater = changes;
        changes = null;
    }

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
    property._update = updater;

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

            if(property._update){
                property._update(property._value, property);
            }

            property.emit('update', property._value);
        }
        return property;
    };
    property.updater = function(fn){
        if(!arguments.length){
            return property._update;
        }
        property._update = fn;
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

module.exports = createProperty;
},{"./binding":"/home/kory/dev/fastn/binding.js","./firmer":"/home/kory/dev/fastn/firmer.js","./is":"/home/kory/dev/fastn/is.js","./makeFunctionEmitter":"/home/kory/dev/fastn/makeFunctionEmitter.js","enti":"/home/kory/dev/fastn/node_modules/enti/index.js","what-changed":"/home/kory/dev/fastn/node_modules/what-changed/index.js"}],"/home/kory/dev/fastn/schedule.js":[function(require,module,exports){
var todo = [],
    todoKeys = [],
    scheduled,
    updates = 0;

function run(){
    var startTime = Date.now();

    while(todo.length && Date.now() - startTime < 16){
        todoKeys.shift();
        todo.shift()();
    }

    if(todo.length){
        requestAnimationFrame(run);
    }else{
        scheduled = false;
    }
}

function schedule(key, fn){
    if(~todoKeys.indexOf(key)){
        return;
    }

    todo.push(fn);
    todoKeys.push(key);

    if(!scheduled){
        scheduled = true;
        requestAnimationFrame(run);
    }
}

module.exports = schedule;
},{}],"/home/kory/dev/fastn/textComponent.js":[function(require,module,exports){
var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

function textComponent(type, fastn, settings){
    var text = new EventEmitter();

    text.createTextNode = textComponent.createTextNode;
    text.text = fastn.property('');
    text._updateText = function(value){
        if(!text.element){
            return;
        }

        text.element.textContent = value;
    };
    text.render = function(){
        text.element = text.createTextNode('');
        text.emit('render');
    };
    text.text.on('update', function(value){
        text._updateText(value);
    });
    text.on('update', text.text.update);

    return text;
};

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;
},{"./is":"/home/kory/dev/fastn/is.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/index.js":[function(require,module,exports){
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
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff

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
    return 42 === arr.foo() && // typed array instances can be augmented
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
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    if (encoding === 'base64')
      subject = base64clean(subject)
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (this.length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
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

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

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
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if(!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
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
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
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
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function binarySlice (buf, start, end) {
  return asciiSlice(buf, start, end)
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

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
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

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  if (end < start) throw new TypeError('sourceEnd < sourceStart')
  if (target_start < 0 || target_start >= target.length)
    throw new TypeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new TypeError('sourceStart out of bounds')
  if (end < 0 || end > source.length) throw new TypeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new TypeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new TypeError('start out of bounds')
  if (end < 0 || end > this.length) throw new TypeError('end out of bounds')

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
Buffer.prototype.toArrayBuffer = function () {
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
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
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
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
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
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
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

var INVALID_BASE64_RE = /[^+\/0-9A-z]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
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

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F) {
      byteArray.push(b)
    } else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++) {
        byteArray.push(parseInt(h[j], 16))
      }
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
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

},{"base64-js":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","ieee754":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","is-array":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/is-array/index.js"}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js":[function(require,module,exports){
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

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
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

},{}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js":[function(require,module,exports){
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

},{}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/node_modules/is-array/index.js":[function(require,module,exports){

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

},{}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js":[function(require,module,exports){
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

},{}]},{},["/home/kory/dev/fastn/example/index.js"])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vYmluZGluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvZmFzdG4uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL2ZvcmtCYW5uZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL2hlYWRlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL25ld1VzZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3NlYXJjaC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvc2VhcmNoQmFyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZXhhbXBsZS9zdGF0cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlckxpc3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3VzZXJzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZmFuY3lQcm9wcy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2Zpcm1lci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2dlbmVyaWNDb21wb25lbnQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2lzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbGlzdENvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL21ha2VGdW5jdGlvbkVtaXR0ZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3BqYXgvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3BqYXgvbm9kZV9tb2R1bGVzL3NpbXBsZS1hamF4L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2NwamF4L25vZGVfbW9kdWxlcy9zaW1wbGUtYWpheC9ub2RlX21vZHVsZXMvcXVlcnktc3RyaW5nL3F1ZXJ5LXN0cmluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9saWIvaXRlcmF0b3IuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvY2xlYXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L251bWJlci90by1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLXBvcy1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L19pdGVyYXRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvY29weS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvZm9yLWVhY2guanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvbWFwLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy9pcy1zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2FycmF5LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9mb3Itb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2dldC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2lzLWl0ZXJhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2lzLXN5bWJvbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvcG9seWZpbGwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL3ZhbGlkYXRlLXN5bWJvbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivc3RyaW5nLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9ldmVudC1lbWl0dGVyL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvcG9seWZpbGwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvaXMtbmF0aXZlLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9kL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2NsZWFyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvX2l0ZXJhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2NvcHkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9mb3ItZWFjaC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9tYXAuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC1vYmplY3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC12YWx1ZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvcmFuZG9tLXVuaXEuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvYXJyYXkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvZm9yLW9mLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2dldC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pcy1pdGVyYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvdmFsaWQtaXRlcmFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvdmFsaWRhdGUtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3Ita2luZHMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3IuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvY2xlYXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L251bWJlci90by1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLXBvcy1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L19pdGVyYXRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvY29weS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvZm9yLWVhY2guanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvbWFwLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3ByaW1pdGl2ZS1zZXQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2Yvc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC12YWx1ZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvYXJyYXkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2Zvci1vZi5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvZ2V0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaXMtaXRlcmFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvdmFsaWRhdGUtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL3ZhbGlkLWl0ZXJhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL3BvbHlmaWxsLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2V2ZW50LWVtaXR0ZXIvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3NhbWUtdmFsdWUvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvc2V0aWZ5L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2Nsb25lL2Nsb25lLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2tleXMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9wcm9wZXJ0eS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL3NjaGVkdWxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vdGV4dENvbXBvbmVudC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWIvYjY0LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaXMtYXJyYXkvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2V2ZW50cy9ldmVudHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxbEJBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRUE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKSxcbiAgICBmaXJtZXIgPSByZXF1aXJlKCcuL2Zpcm1lcicpLFxuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIgPSByZXF1aXJlKCcuL21ha2VGdW5jdGlvbkVtaXR0ZXInKSxcbiAgICBzYW1lID0gcmVxdWlyZSgnc2FtZS12YWx1ZScpO1xuXG5mdW5jdGlvbiBmdXNlQmluZGluZygpe1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcblxuICAgIHZhciBiaW5kaW5ncyA9IGFyZ3Muc2xpY2UoKSxcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCksXG4gICAgICAgIHVwZGF0ZVRyYW5zZm9ybSxcbiAgICAgICAgcmVzdWx0QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ3Jlc3VsdCcpLFxuICAgICAgICBzZWxmQ2hhbmdpbmc7XG5cbiAgICByZXN1bHRCaW5kaW5nLl9hcmd1bWVudHMgPSBhcmdzO1xuXG4gICAgaWYodHlwZW9mIGJpbmRpbmdzW2JpbmRpbmdzLmxlbmd0aC0xXSA9PT0gJ2Z1bmN0aW9uJyAmJiAhaXMuYmluZGluZyhiaW5kaW5nc1tiaW5kaW5ncy5sZW5ndGgtMV0pKXtcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtID0gdHJhbnNmb3JtO1xuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKTtcbiAgICB9XG5cbiAgICByZXN1bHRCaW5kaW5nLl9tb2RlbC5fZXZlbnRzID0ge307XG4gICAgcmVzdWx0QmluZGluZy5fc2V0ID0gZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpZih1cGRhdGVUcmFuc2Zvcm0pe1xuICAgICAgICAgICAgc2VsZkNoYW5naW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHZhciBuZXdWYWx1ZSA9IHVwZGF0ZVRyYW5zZm9ybSh2YWx1ZSk7XG4gICAgICAgICAgICBpZighc2FtZShuZXdWYWx1ZSwgYmluZGluZ3NbMF0oKSkpe1xuICAgICAgICAgICAgICAgIGJpbmRpbmdzWzBdKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgICAgICByZXN1bHRCaW5kaW5nLl9jaGFuZ2UobmV3VmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2VsZkNoYW5naW5nID0gZmFsc2U7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgcmVzdWx0QmluZGluZy5fY2hhbmdlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjaGFuZ2UoKXtcbiAgICAgICAgaWYoc2VsZkNoYW5naW5nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRCaW5kaW5nKHRyYW5zZm9ybS5hcHBseShudWxsLCBiaW5kaW5ncy5tYXAoZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZygpO1xuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZywgaW5kZXgpe1xuICAgICAgICBpZih0eXBlb2YgYmluZGluZyA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoYmluZGluZyk7XG4gICAgICAgICAgICBiaW5kaW5ncy5zcGxpY2UoaW5kZXgsMSxiaW5kaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBiaW5kaW5nLmRldGFjaCk7XG4gICAgfSk7XG5cbiAgICB2YXIgbGFzdEF0dGFjaGVkO1xuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKG9iamVjdCl7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZkNoYW5naW5nID0gZmFsc2U7XG4gICAgICAgIGlmKGxhc3RBdHRhY2hlZCAhPT0gb2JqZWN0KXtcbiAgICAgICAgICAgIGNoYW5nZSgpO1xuICAgICAgICB9XG4gICAgICAgIGxhc3RBdHRhY2hlZCA9IG9iamVjdDtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCaW5kaW5nKHBhdGgsIG1vcmUpe1xuXG4gICAgaWYobW9yZSl7IC8vIHVzZWQgaW5zdGVhZCBvZiBhcmd1bWVudHMubGVuZ3RoIGZvciBwZXJmb3JtYW5jZVxuICAgICAgICByZXR1cm4gZnVzZUJpbmRpbmcuYXBwbHkobnVsbCwgYXJndW1lbnRzKTtcbiAgICB9XG5cbiAgICBpZihwYXRoID09IG51bGwpe1xuICAgICAgICB0aHJvdyBcImJpbmRpbmdzIG11c3QgYmUgY3JlYXRlZCB3aXRoIGEga2V5IChhbmQgb3IgZmlsdGVyKVwiO1xuICAgIH1cblxuICAgIHZhciB2YWx1ZSxcbiAgICAgICAgYmluZGluZyA9IGZ1bmN0aW9uIGJpbmRpbmcobmV3VmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihwYXRoID09PSAnLicpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5fc2V0KG5ld1ZhbHVlKTtcbiAgICB9O1xuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIoYmluZGluZyk7XG4gICAgYmluZGluZy5zZXRNYXhMaXN0ZW5lcnMoMTAwMDApO1xuICAgIGJpbmRpbmcuX2FyZ3VtZW50cyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgYmluZGluZy5fbW9kZWwgPSBuZXcgRW50aShmYWxzZSk7XG4gICAgYmluZGluZy5fZmFzdG5fYmluZGluZyA9IHBhdGg7XG4gICAgYmluZGluZy5fZmlybSA9IDE7XG4gICAgYmluZGluZy5fbW9kZWwuX2V2ZW50cyA9IHt9O1xuXG4gICAgYmluZGluZy5hdHRhY2ggPSBmdW5jdGlvbihvYmplY3QsIGZpcm0pe1xuXG4gICAgICAgIC8vIElmIHRoZSBiaW5kaW5nIGlzIGJlaW5nIGFza2VkIHRvIGF0dGFjaCBsb29zbHkgdG8gYW4gb2JqZWN0LFxuICAgICAgICAvLyBidXQgaXQgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkIGFzIGJlaW5nIGZpcm1seSBhdHRhY2hlZCwgZG8gbm90IGF0dGFjaC5cbiAgICAgICAgaWYoZmlybWVyKGJpbmRpbmcsIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5fZmlybSA9IGZpcm07XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZy5fbW9kZWwuZ2V0KCcuJykgPT09IG9iamVjdCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX21vZGVsLmF0dGFjaChvYmplY3QpO1xuICAgICAgICBiaW5kaW5nLl9jaGFuZ2UoYmluZGluZy5fbW9kZWwuZ2V0KHBhdGgpKTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIDEpO1xuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGV0YWNoID0gZnVuY3Rpb24oZmlybSl7XG4gICAgICAgIGlmKGZpcm1lcihiaW5kaW5nLCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgICBpZihiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuZGV0YWNoKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoJ2RldGFjaCcgaW4gYmluZGluZy5fZXZlbnRzKXtcbiAgICAgICAgICAgIGJpbmRpbmcuZW1pdCgnZGV0YWNoJywgMSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9zZXQgPSBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgIGlmKHNhbWUoYmluZGluZy5fbW9kZWwuZ2V0KHBhdGgpLCBuZXdWYWx1ZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuYXR0YWNoKGJpbmRpbmcuX21vZGVsLmdldCgnLicpKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLl9tb2RlbC5zZXQocGF0aCwgbmV3VmFsdWUpO1xuICAgIH07XG4gICAgYmluZGluZy5fY2hhbmdlID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICB2YWx1ZSA9IG5ld1ZhbHVlO1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2NoYW5nZScsIGJpbmRpbmcoKSk7XG4gICAgfTtcbiAgICBiaW5kaW5nLmNsb25lID0gZnVuY3Rpb24oa2VlcEF0dGFjaG1lbnQpe1xuICAgICAgICB2YXIgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcuYXBwbHkobnVsbCwgYmluZGluZy5fYXJndW1lbnRzKTtcblxuICAgICAgICBpZihrZWVwQXR0YWNobWVudCl7XG4gICAgICAgICAgICBuZXdCaW5kaW5nLmF0dGFjaChiaW5kaW5nLl9tb2RlbCwgYmluZGluZy5fZmlybSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3QmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGVzdHJveSA9IGZ1bmN0aW9uKHNvZnQpe1xuICAgICAgICBpZihiaW5kaW5nLl9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKHNvZnQgJiYgKCFiaW5kaW5nLl9ldmVudHMgfHwgYmluZGluZy5fZXZlbnRzLmNoYW5nZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcuX2Rlc3Ryb3llZCA9IHRydWU7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICBiaW5kaW5nLmRldGFjaCgpO1xuICAgICAgICBiaW5kaW5nLl9tb2RlbC5kZXN0cm95KCk7XG4gICAgfTtcblxuICAgIGlmKHBhdGggIT09ICcuJyl7XG4gICAgICAgIGJpbmRpbmcuX21vZGVsLl9ldmVudHNbcGF0aF0gPSBiaW5kaW5nLl9jaGFuZ2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRpbmc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlQmluZGluZzsiLCJ2YXIgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhzZXR0aW5ncyk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICByZXN1bHRba2V5XSA9IHNldHRpbmdzW2tleV07XG4gICAgICAgIGlmKGlzLmJpbmRpbmdPYmplY3QocmVzdWx0W2tleV0pKXtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZmFzdG4uYmluZGluZyhcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZmFzdG5fYmluZGluZyxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZGVmYXVsdFZhbHVlLFxuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldLnRyYW5zZm9ybVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW4oaXRlbSl7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoaXRlbSkgPyBpdGVtLnJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGVsZW1lbnQpe1xuICAgICAgICBpZihlbGVtZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0LmNvbmNhdChmbGF0dGVuKGVsZW1lbnQpKTtcbiAgICB9LFtdKSA6IGl0ZW07XG59XG5cbmZ1bmN0aW9uIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsIGNhbGwsIGFyZ3Mpe1xuICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMoY29tcG9uZW50KTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgdmFyIHByb3BlcnR5ID0gY29tcG9uZW50W2tleXNbaV1dO1xuXG4gICAgICAgIGlmKCFpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBwcm9wZXJ0eVtjYWxsXS5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgdmFyIHNldHRpbmcgPSBzZXR0aW5nc1trZXldLFxuICAgICAgICAgICAgcHJvcGVydHkgPSBjb21wb25lbnRba2V5XTtcblxuICAgICAgICBpZihpcy5wcm9wZXJ0eShzZXR0aW5nc1trZXldKSl7XG5cbiAgICAgICAgICAgIC8vIFRoZSBjb21wb25ldCBhbHJlYWR5IGhhcyBhIHByb3BlcnR5IGF0IHRoaXMga2V5LlxuICAgICAgICAgICAgLy8gRGVzdHJveSBpdC5cbiAgICAgICAgICAgIGlmKGlzLnByb3BlcnR5KHByb3BlcnR5KSl7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkuZGVzdHJveSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXR0aW5nLmFkZFRvKGNvbXBvbmVudCwga2V5KTtcblxuICAgICAgICB9ZWxzZSBpZihpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuXG4gICAgICAgICAgICBpZihpcy5iaW5kaW5nKHNldHRpbmcpKXtcbiAgICAgICAgICAgICAgICBwcm9wZXJ0eS5iaW5kaW5nKHNldHRpbmcpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkoc2V0dGluZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb3BlcnR5LmFkZFRvKGNvbXBvbmVudCwga2V5KTtcbiAgICAgICAgfVxuXG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuLCBjb21wb25lbnRzKXtcbiAgICB2YXIgY29tcG9uZW50LFxuICAgICAgICBiaW5kaW5nLFxuICAgICAgICBzY29wZSA9IG5ldyBmYXN0bi5Nb2RlbChmYWxzZSk7XG5cbiAgICBzZXR0aW5ncyA9IGRlcmVmZXJlbmNlU2V0dGluZ3Moc2V0dGluZ3MgfHwge30pO1xuICAgIGNoaWxkcmVuID0gZmxhdHRlbihjaGlsZHJlbik7XG5cbiAgICBpZighKHR5cGUgaW4gY29tcG9uZW50cykpe1xuICAgICAgICBpZighKCdfZ2VuZXJpYycgaW4gY29tcG9uZW50cykpe1xuICAgICAgICAgICAgdGhyb3cgJ05vIGNvbXBvbmVudCBvZiB0eXBlIFwiJyArIHR5cGUgKyAnXCIgaXMgbG9hZGVkJztcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzLl9nZW5lcmljKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1lbHNle1xuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzW3R5cGVdKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1cblxuICAgIGlmKGlzLmNvbXBvbmVudChjb21wb25lbnQpKXtcbiAgICAgICAgLy8gVGhlIGNvbXBvbmVudCBjb25zdHJ1Y3RvciByZXR1cm5lZCBhIHJlYWR5LXRvLWdvIGNvbXBvbmVudC5cblxuICAgICAgICBpbmZsYXRlUHJvcGVydGllcyhjb21wb25lbnQsIHNldHRpbmdzKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5fdHlwZSA9IHR5cGU7XG4gICAgY29tcG9uZW50Ll9zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgIGNvbXBvbmVudC5fZmFzdG5fY29tcG9uZW50ID0gdHJ1ZTtcbiAgICBjb21wb25lbnQuX2NoaWxkcmVuID0gY2hpbGRyZW47XG5cbiAgICBjb21wb25lbnQuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcbiAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCBmaXJtKTtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBiaW5kaW5nLmRldGFjaChmaXJtKTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2RldGFjaCcsIDEpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuc2NvcGUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gc2NvcGU7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5kZXN0cm95ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoY29tcG9uZW50Ll9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5fZGVzdHJveWVkID0gdHJ1ZTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgY29tcG9uZW50LmVsZW1lbnQgPSBudWxsO1xuICAgICAgICBzY29wZS5kZXN0cm95KCk7XG4gICAgICAgIGJpbmRpbmcuZGVzdHJveSgpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICB2YXIgbGFzdEJvdW5kO1xuICAgIGZ1bmN0aW9uIGVtaXRBdHRhY2goKXtcbiAgICAgICAgdmFyIG5ld0JvdW5kID0gYmluZGluZygpO1xuICAgICAgICBpZihuZXdCb3VuZCAhPT0gbGFzdEJvdW5kKXtcbiAgICAgICAgICAgIGxhc3RCb3VuZCA9IG5ld0JvdW5kO1xuICAgICAgICAgICAgc2NvcGUuYXR0YWNoKGxhc3RCb3VuZCk7XG4gICAgICAgICAgICBjb21wb25lbnQuZW1pdCgnYXR0YWNoJywgbGFzdEJvdW5kLCAxKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbXBvbmVudC5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICAgICAgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcuYXR0YWNoKGJpbmRpbmcuX21vZGVsLCBiaW5kaW5nLl9maXJtKTtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIGVtaXRBdHRhY2gpO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG5cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgZW1pdEF0dGFjaCk7XG4gICAgICAgIGVtaXRBdHRhY2goYmluZGluZygpKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KGNvbXBvbmVudC5fdHlwZSwgZmFzdG4sIGNvbXBvbmVudC5fc2V0dGluZ3MsIGNvbXBvbmVudC5fY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiAhY2hpbGQuX3RlbXBsYXRlZDtcbiAgICAgICAgfSkubWFwKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiBjaGlsZC5jbG9uZSgpO1xuICAgICAgICB9KSwgY29tcG9uZW50cyk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5jaGlsZHJlbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQuX2NoaWxkcmVuLnNsaWNlKCk7XG4gICAgfTtcblxuICAgIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3MpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnYXR0YWNoJywgYXJndW1lbnRzKTtcbiAgICB9KTtcbiAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsICd1cGRhdGUnLCBhcmd1bWVudHMpO1xuICAgIH0pO1xuICAgIGNvbXBvbmVudC5vbignZGV0YWNoJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yRWFjaFByb3BlcnR5KGNvbXBvbmVudCwgJ2RldGFjaCcsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG4gICAgY29tcG9uZW50Lm9uY2UoJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnZGVzdHJveScsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG5cbiAgICB2YXIgZGVmYXVsdEJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCcuJyk7XG4gICAgZGVmYXVsdEJpbmRpbmcuX2RlZmF1bHRfYmluZGluZyA9IHRydWU7XG5cbiAgICBjb21wb25lbnQuYmluZGluZyhkZWZhdWx0QmluZGluZyk7XG5cbiAgICBpZihmYXN0bi5kZWJ1Zyl7XG4gICAgICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIHR5cGVvZiBjb21wb25lbnQuZWxlbWVudCA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50Ll9jb21wb25lbnQgPSBjb21wb25lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjb21wb25lbnQ7XG59O1xuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0bil7XG4gICAgdmFyIGNvbnRhaW5lciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIGNvbnRhaW5lci5pbnNlcnQgPSBmdW5jdGlvbihjaGlsZCwgaW5kZXgpe1xuICAgICAgICB2YXIgY29tcG9uZW50ID0gY2hpbGQ7XG5cbiAgICAgICAgaWYoaW5kZXggJiYgdHlwZW9mIGluZGV4ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICBjb21wb25lbnQgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShjb21wb25lbnQpKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5mb3JFYWNoKGZ1bmN0aW9uKGNvbXBvbmVudCwgaSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLmluc2VydChjb21wb25lbnQsIGkgKyAoaW5kZXggfHwgMCkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpLFxuICAgICAgICAgICAgbmV3Q29tcG9uZW50ID0gZmFzdG4udG9Db21wb25lbnQoY29tcG9uZW50KTtcblxuICAgICAgICBpZighaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgaWYofmN1cnJlbnRJbmRleCl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoY3VycmVudEluZGV4LCAxLCBuZXdDb21wb25lbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoaXNOYU4oaW5kZXgpKXtcbiAgICAgICAgICAgIGluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjdXJyZW50SW5kZXggIT09IGluZGV4KXtcbiAgICAgICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgbmV3Q29tcG9uZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCkgJiYgIW5ld0NvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIG5ld0NvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5ld0NvbXBvbmVudC5hdHRhY2goY29udGFpbmVyLnNjb3BlKCksIDEpO1xuXG4gICAgICAgIGNvbnRhaW5lci5faW5zZXJ0KG5ld0NvbXBvbmVudC5lbGVtZW50LCBpbmRleCk7XG5cbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgICB9O1xuXG4gICAgdmFyIHggPSAwO1xuXG4gICAgY29udGFpbmVyLl9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIHZhciBjb250YWluZXJFbGVtZW50ID0gY29udGFpbmVyLmdldENvbnRhaW5lckVsZW1lbnQoKTtcbiAgICAgICAgaWYoIWNvbnRhaW5lckVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoY29udGFpbmVyRWxlbWVudC5jaGlsZE5vZGVzW2luZGV4XSA9PT0gZWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50Lmluc2VydEJlZm9yZShlbGVtZW50LCBjb250YWluZXJFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLnJlbW92ZSA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIHZhciBpbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQuZGV0YWNoKDEpO1xuXG4gICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbXBvbmVudC5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBjb250YWluZXIuX3JlbW92ZSA9IGZ1bmN0aW9uKGVsZW1lbnQpe1xuICAgICAgICB2YXIgY29udGFpbmVyRWxlbWVudCA9IGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgIWNvbnRhaW5lckVsZW1lbnQgfHwgZWxlbWVudC5wYXJlbnROb2RlICE9PSBjb250YWluZXJFbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRhaW5lckVsZW1lbnQucmVtb3ZlQ2hpbGQoZWxlbWVudCk7XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5lbXB0eSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHdoaWxlKGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbnRhaW5lci5fY2hpbGRyZW4ucG9wKCkuZGV0YWNoKDEpLmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lci5jb250YWluZXJFbGVtZW50IHx8IGNvbnRhaW5lci5lbGVtZW50O1xuICAgIH07XG5cbiAgICBjb250YWluZXIub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGNvbnRhaW5lci5pbnNlcnQoY29udGFpbmVyLl9jaGlsZHJlbiwgMCk7XG4gICAgfSk7XG5cbiAgICBjb250YWluZXIub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKGRhdGEsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5hdHRhY2goZGF0YSwgZmlybSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnRhaW5lci5vbignZGVzdHJveScsIGZ1bmN0aW9uKGRhdGEsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5kZXN0cm95KGZpcm0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29udGFpbmVyO1xufTsiLCIvKlxuICAgIEEgY29udmVuaWVuY2Ugc2luZ2xldG9uIHRoYXQgc2V0cyB1cCBmYXN0biBzbyBpdCBjYW4gYmUgcmVxdWlyZWQgZnJvbSBvdGhlciBmaWxlcy5cbiovXG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi4vJykoeyAvLyBSZXF1aXJlIGZhc3RuXG5cbiAgICAvLyBzZXQgdXAgZmFzdG4gd2l0aCBhbGwgdGhlIGNvbXBvbmVudHMgeW91IG5lZWQgZm9yIHlvdXIgYXBwbGljYXRpb25cblxuICAgIC8vIFRoZSBsaXN0IGNvbXBvbmVudCBpcyB1c2VkIHRvIHJlbmRlciBpdGVtcyBiYXNlZCBvbiBhIHNldCBvZiBkYXRhLlxuICAgIGxpc3Q6IHJlcXVpcmUoJy4uL2xpc3RDb21wb25lbnQnKSxcblxuICAgIC8vIFRoZSB0ZXh0IGNvbXBvbmVudCBpcyB1c2VkIHRvIHJlbmRlciB0ZXh0IG9yIGJpbmRpbmdzIHBhc3NlZCBhcyBjaGlsZHJlbiB0byBvdGhlciBjb21wb25lbnRzLlxuICAgIHRleHQ6IHJlcXVpcmUoJy4uL3RleHRDb21wb25lbnQnKSxcblxuICAgIC8vIFRoZSBfZ2VuZXJpYyBjb21wb25lbnQgaXMgYSBjYXRjaC1hbGwgZm9yIGFueSBjb21wb25lbnQgdHlwZSB0aGF0XG4gICAgLy8gIGRvZXNudCBtYXRjaCBhbnkgb3RoZXIgY29tcG9uZW50IGNvbnN0cnVjdG9yLCBlZzogJ2RpdidcbiAgICBfZ2VuZXJpYzogcmVxdWlyZSgnLi4vZ2VuZXJpY0NvbXBvbmVudCcpXG5cbn0sIHRydWUpOyAvLyBQYXNzIHRydWUgYXMgdGhlIHNlY29uZCBwYXJhbWV0ZXIgdG8gdHVybiBvbiBkZWJ1ZyBtb2RlLiIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpeyAgICBcbiAgICByZXR1cm4gZmFzdG4oJ2RpdicsIHtjbGFzczogJ2dpdGh1Yi1mb3JrLXJpYmJvbi13cmFwcGVyIHJpZ2h0J30sXG4gICAgICAgIGZhc3RuKCdkaXYnLCB7Y2xhc3M6ICdnaXRodWItZm9yay1yaWJib24nfSxcbiAgICAgICAgICAgIGZhc3RuKCdhJywge2hyZWY6ICdodHRwczovL2dpdGh1Yi5jb20va29yeW51bm4vZmFzdG4nfSwgJ0ZvcmsgbWUnKVxuICAgICAgICApXG4gICAgKTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzTW9kZWwgPSByZXF1aXJlKCcuL3VzZXJzJykudXNlcnNNb2RlbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWFyY2hNb2RlbCl7XG4gICAgcmV0dXJuIGZhc3RuKCdoZWFkZXInLCB7J2NsYXNzJzonbWFpbkhlYWRlcid9LFxuICAgICAgICBmYXN0bignaW1nJywge3NyYzogJy4vZmFzdG4tc21sLnBuZyd9KSxcbiAgICAgICAgZmFzdG4oJ2gxJywgJ2Zhc3RuJywgZmFzdG4oJ3NwYW4nLCB7Y2xhc3M6ICdmYWludCd9LCAnLmpzJykpLFxuICAgICAgICBmYXN0bignc3BhbicsXG4gICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCd1c2Vyc3wqLmRlbGV0ZWQnLCByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdCwgIGZ1bmN0aW9uKHVzZXJzLCByZXN1bHRzKXtcbiAgICAgICAgICAgICAgICBpZighdXNlcnMpe1xuICAgICAgICAgICAgICAgICAgICB1c2VycyA9IFtdO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciB0b3RhbCA9IHVzZXJzLmZpbHRlcihmdW5jdGlvbih1c2VyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhdXNlci5kZWxldGVkO1xuICAgICAgICAgICAgICAgICAgICB9KS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gJyc7XG5cbiAgICAgICAgICAgICAgICBpZihyZXN1bHRzKXtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ICs9ICdTaG93aW5nICcgKyByZXN1bHRzLmxlbmd0aCArJyBvZiAnO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSB0b3RhbDtcblxuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICcgdXNlcnMnXG4gICAgICAgICkuYXR0YWNoKHVzZXJzTW9kZWwpLFxuICAgICAgICByZXF1aXJlKCcuL3NlYXJjaEJhcicpKClcbiAgICApO1xufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgdXNlclNlcnZpY2UgPSByZXF1aXJlKCcuL3VzZXJzJyk7XG5cbnZhciBhcHAgPSBmYXN0bignZGl2JyxcbiAgICByZXF1aXJlKCcuL2hlYWRlcicpKCksXG4gICAgcmVxdWlyZSgnLi91c2VyTGlzdCcpKCksXG4gICAgcmVxdWlyZSgnLi9zdGF0cycpKCksXG4gICAgcmVxdWlyZSgnLi9mb3JrQmFubmVyJykoKVxuKTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG5cbiAgICBhcHAucmVuZGVyKCk7XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGFwcC5lbGVtZW50KTtcblxuICAgIC8vIENsZWFyIHRoZSBzZWxlY3RlZCB1c2VyIG9uIGNsaWNrIGFueXdoZXJlXG4gICAgLy8gQ2FwdHVyZSBwaGFzZSB0byBhbGxvdyBidWJibGVkIGV2ZW50cyB0byBzZXQgdGhlIHNlbGVjdGVkIHVzZXJcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZ1bmN0aW9uKCl7XG4gICAgICAgIHVzZXJTZXJ2aWNlLnNlbGVjdGVkVXNlcihudWxsKTtcbiAgICB9LCB0cnVlKTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzU2VydmljZSA9IHJlcXVpcmUoJy4vdXNlcnMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuXG4gICAgdmFyIG5ld1VzZXJEaWFsb2cgPSBmYXN0bignZGl2Jywge2NsYXNzOiduZXdVc2VyIGRpYWxvZyd9LFxuICAgICAgICBmYXN0bignZm9ybScsIHtjbGFzczogJ21vZGFsJ30sXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ0ZpcnN0IE5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmZpcnN0JyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ1N1cm5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmxhc3QnKSxcbiAgICAgICAgICAgICAgICAgICAgb25jaGFuZ2U6ICd2YWx1ZTp2YWx1ZSdcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKSxcblxuICAgICAgICAgICAgZmFzdG4oJ2ZpZWxkJyxcbiAgICAgICAgICAgICAgICBmYXN0bignbGFiZWwnLCAnRW1haWwnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpLFxuICAgICAgICAgICAgICAgICAgICBvbmNoYW5nZTogJ3ZhbHVlOnZhbHVlJ1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZmllbGQnLFxuICAgICAgICAgICAgICAgIGZhc3RuKCdsYWJlbCcsICdNb2JpbGUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdjZWxsJyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCAnQWRkJylcbiAgICAgICAgKVxuICAgICAgICAub24oJ3N1Ym1pdCcsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgICB1c2Vyc1NlcnZpY2UuYWRkVXNlcihzY29wZS5nZXQoJy4nKSk7XG5cbiAgICAgICAgICAgIGNsb3NlTW9kYWwoKTtcbiAgICAgICAgfSlcbiAgICApXG4gICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgaWYoZXZlbnQudGFyZ2V0ID09PSB0aGlzLmVsZW1lbnQpe1xuICAgICAgICAgICAgY2xvc2VNb2RhbCgpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBmdW5jdGlvbiBjbG9zZU1vZGFsKCl7XG4gICAgICAgIG5ld1VzZXJEaWFsb2cuZWxlbWVudC5jbGFzc0xpc3QuYWRkKCdjbG9zZWQnKTtcblxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKG5ld1VzZXJEaWFsb2cuZWxlbWVudCk7XG4gICAgICAgICAgICBuZXdVc2VyRGlhbG9nLmRlc3Ryb3koKTtcbiAgICAgICAgfSwzMDApO1xuICAgIH1cblxuICAgIHZhciByYW5kb21JbWFnZUlkID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTAwKTtcblxuICAgIG5ld1VzZXJEaWFsb2cuYXR0YWNoKHtcbiAgICAgICAgJ2dlbmRlcic6bnVsbCxcbiAgICAgICAgJ25hbWUnOntcbiAgICAgICAgICAgICd0aXRsZSc6bnVsbCxcbiAgICAgICAgICAgICdmaXJzdCc6bnVsbCxcbiAgICAgICAgICAgICdsYXN0JzpudWxsXG4gICAgICAgIH0sXG4gICAgICAgICdlbWFpbCc6bnVsbCxcbiAgICAgICAgJ2RvYic6bnVsbCxcbiAgICAgICAgJ2NlbGwnOm51bGwsXG4gICAgICAgICdwaWN0dXJlJzp7XG4gICAgICAgICAgICAnbGFyZ2UnOidodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLycgKyByYW5kb21JbWFnZUlkICsgJy5qcGcnLFxuICAgICAgICAgICAgJ21lZGl1bSc6J2h0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLycgKyByYW5kb21JbWFnZUlkICsgJy5qcGcnLFxuICAgICAgICAgICAgJ3RodW1ibmFpbCc6J2h0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vJyArIHJhbmRvbUltYWdlSWQgKyAnLmpwZydcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgbmV3VXNlckRpYWxvZy5yZW5kZXIoKTtcblxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobmV3VXNlckRpYWxvZy5lbGVtZW50KTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzU2VydmljZSA9IHJlcXVpcmUoJy4vdXNlcnMnKTtcbiAgICBzZWFyY2hNb2RlbCA9IHtcbiAgICAgICAgdXNlclNlYXJjaDogJycsXG4gICAgICAgIHJlc3VsdDogbnVsbFxuICAgIH0sXG4gICAgdXNlclNlYXJjaCA9IGZhc3RuLmJpbmRpbmcoJ3VzZXJTZWFyY2gnKS5hdHRhY2goc2VhcmNoTW9kZWwpXG4gICAgICAgIC5vbignY2hhbmdlJywgZnVuY3Rpb24oc2VhcmNoKXtcbiAgICAgICAgICAgIHZhciB1c2VycyA9IHVzZXJzU2VydmljZS51c2VycygpO1xuXG4gICAgICAgICAgICBpZighc2VhcmNoKXtcbiAgICAgICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCBudWxsKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCB1c2Vycy5maWx0ZXIoZnVuY3Rpb24odXNlcil7XG4gICAgICAgICAgICAgICAgaWYoIXVzZXIgfHwgIXVzZXIubmFtZSB8fCAhdXNlci5uYW1lLmZpcnN0IHx8ICF1c2VyLm5hbWUubGFzdCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIH51c2VyLm5hbWUuZmlyc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKSB8fCB+dXNlci5uYW1lLmxhc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHNlYXJjaE1vZGVsOiBzZWFyY2hNb2RlbCxcbiAgICB1c2VyU2VhcmNoOiB1c2VyU2VhcmNoLFxuICAgIHJlc3VsdDogZmFzdG4uYmluZGluZygncmVzdWx0JykuYXR0YWNoKHNlYXJjaE1vZGVsKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgc2VhcmNoID0gcmVxdWlyZSgnLi9zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiBmYXN0bignbmF2Jywge2NsYXNzOiAnc2VhcmNoJ30sXG4gICAgICAgIGZhc3RuKCdsYWJlbCcsICdTZWFyY2gnKSwgXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHsgXG4gICAgICAgICAgICB2YWx1ZTogc2VhcmNoLnVzZXJTZWFyY2gsXG4gICAgICAgICAgICBvbmtleXVwOiAndmFsdWU6dmFsdWUnXG4gICAgICAgIH0pXG4gICAgKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKXtcblxuICAgIHJldHVybiBmYXN0bignZGl2Jywge2NsYXNzOiAnc3RhdHMnfSxcbiAgICAgICAgJ1RoaXMgZXhhbXBsZSBoYXMgJyxcbiAgICAgICAgZmFzdG4uYmluZGluZygnYXR0YWNoZWRFbnRpcycpLFxuICAgICAgICAnIGF0dGFjaGVkIG1vZGVsIGluc3RhbmNlcydcbiAgICApLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhKXtcbiAgICAgICAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGZhc3RuLk1vZGVsLnNldChkYXRhLCAnYXR0YWNoZWRFbnRpcycsIGZhc3RuLk1vZGVsLnByb3RvdHlwZS5hdHRhY2hlZENvdW50KCkpO1xuICAgICAgICB9LDEwMCk7XG4gICAgfSk7XG4gICAgXG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpe1xuICAgIHZhciBzZWFyY2hSZXN1bHQgPSByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdCxcbiAgICAgICAgdXNlcnNTZXJ2aWNlID0gcmVxdWlyZSgnLi91c2VycycpO1xuXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLCB7XG4gICAgICAgICAgICBjbGFzczogZmFzdG4uYmluZGluZygnLicsICduYW1lJywgc2VhcmNoUmVzdWx0LCB1c2Vyc1NlcnZpY2Uuc2VsZWN0ZWRVc2VyLCB1c2Vyc1NlcnZpY2UuZGVsZXRlZFVzZXJzLCBmdW5jdGlvbih1c2VyLCBuYW1lLCBzZWFyY2hSZXN1bHQsIHNlbGVjdGVkVXNlciwgZGVsZXRlZFVzZXJzKXtcbiAgICAgICAgICAgICAgICB2YXIgY2xhc3NlcyA9IFsndXNlciddO1xuXG4gICAgICAgICAgICAgICAgaWYoc2VhcmNoUmVzdWx0ICYmICF+c2VhcmNoUmVzdWx0LmluZGV4T2YodXNlcikpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2hpZGRlbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih1c2VyID09PSBzZWxlY3RlZFVzZXIpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ3NlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKH5kZWxldGVkVXNlcnMuaW5kZXhPZih1c2VyKSl7XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzZXMucHVzaCgnZGVsZXRlZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gY2xhc3NlcztcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG5cbiAgICAgICAgZmFzdG4oJ2ltZycsIHtcbiAgICAgICAgICAgIHNyYzogZmFzdG4uYmluZGluZygncGljdHVyZS5tZWRpdW0nKVxuICAgICAgICB9KSxcblxuICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnZGV0YWlscyd9LFxuXG4gICAgICAgICAgICBmYXN0bignbGFiZWwnLCB7Y2xhc3M6ICduYW1lJ30sXG4gICAgICAgICAgICAgICAgZmFzdG4uYmluZGluZygnbmFtZS5maXJzdCcpLCAnICcsIGZhc3RuLmJpbmRpbmcoJ25hbWUubGFzdCcpXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnaW5mbyd9LFxuXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3AnLCB7Y2xhc3M6J2V4dHJhJ30sXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdhJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhyZWY6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJywgZnVuY3Rpb24oZW1haWwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ21haWx0bzonICsgZW1haWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpXG4gICAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdwJywgZmFzdG4uYmluZGluZygnY2VsbCcsIGZ1bmN0aW9uKGNlbGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdNb2JpbGU6ICcgKyBjZWxsO1xuICAgICAgICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCB7Y2xhc3M6ICdyZW1vdmUnfSwnWCcpXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgICAgICAgICB1c2Vyc1NlcnZpY2UuZGVsZXRlVXNlcihzY29wZS5nZXQoJy4nKSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApXG5cbiAgICApLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgIHVzZXJzU2VydmljZS5zZWxlY3RlZFVzZXIoc2NvcGUuZ2V0KCcuJykpO1xuICAgIH0pO1xufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgdXNlcnNTZXJ2aWNlID0gcmVxdWlyZSgnLi91c2VycycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0JyxcbiAgICAgICAge1xuICAgICAgICAgICAgY2xhc3M6ICd1c2VycycsXG4gICAgICAgICAgICBpdGVtczogdXNlcnNTZXJ2aWNlLnVzZXJzLFxuICAgICAgICAgICAgdGVtcGxhdGU6IGZ1bmN0aW9uKG1vZGVsLCBzY29wZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlcXVpcmUoJy4vdXNlci5qcycpKCkuYmluZGluZygnaXRlbScpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBmYXN0bignYnV0dG9uJywge2NsYXNzOiAnYWRkJ30sICcrJylcbiAgICAgICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICByZXF1aXJlKCcuL25ld1VzZXInKSgpO1xuICAgICAgICB9KVxuICAgICk7XG59OyIsInZhciBjcGpheCA9IHJlcXVpcmUoJ2NwamF4JyksXG4gICAgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbmZ1bmN0aW9uIGdldFVzZXJzKGNhbGxiYWNrKXtcbiAgICBjcGpheCh7XG4gICAgICAgIHVybDogJy4vdXNlcnMuanNvbicsXG4gICAgICAgIGRhdGFUeXBlOiAnanNvbidcbiAgICB9LCBmdW5jdGlvbihlcnJvciwgdXNlcnMpe1xuICAgICAgICBjYWxsYmFjayhlcnJvciwgdXNlcnMubWFwKGZ1bmN0aW9uKHVzZXIpe1xuICAgICAgICAgICAgcmV0dXJuIHVzZXIudXNlcjtcbiAgICAgICAgfSkpO1xuICAgIH0pO1xufTtcblxudmFyIHVzZXJzTW9kZWwgPSBuZXcgZmFzdG4uTW9kZWwoe1xuICAgIHVzZXJzOiBbXSxcbiAgICBkZWxldGVkVXNlcnM6IFtdXG59KTtcblxuZ2V0VXNlcnMoZnVuY3Rpb24oZXJyb3IsIHVzZXJzKXtcbiAgICBpZihlcnJvcil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB1c2Vyc01vZGVsLnNldCgndXNlcnMnLCB1c2Vycyk7XG59KTtcblxuZnVuY3Rpb24gZGVsZXRlVXNlcih1c2VyKXtcbiAgICB1c2Vyc01vZGVsLnB1c2goJ2RlbGV0ZWRVc2VycycsIHVzZXIpO1xufVxuXG5mdW5jdGlvbiBhZGRVc2VyKHVzZXIpe1xuICAgIHVzZXJzTW9kZWwuaW5zZXJ0KCd1c2VycycsIHVzZXIsIDApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICB1c2Vyc01vZGVsOiB1c2Vyc01vZGVsLFxuICAgIHVzZXJzOiBmYXN0bi5iaW5kaW5nKCd1c2Vyc3wqJykuYXR0YWNoKHVzZXJzTW9kZWwpLFxuICAgIGRlbGV0ZWRVc2VyczogZmFzdG4uYmluZGluZygnZGVsZXRlZFVzZXJzfConKS5hdHRhY2godXNlcnNNb2RlbCksXG4gICAgc2VsZWN0ZWRVc2VyOiBmYXN0bi5iaW5kaW5nKCdzZWxlY3RlZCcpLmF0dGFjaCh1c2Vyc01vZGVsKSxcbiAgICBkZWxldGVVc2VyOiBkZWxldGVVc2VyLFxuICAgIGFkZFVzZXI6IGFkZFVzZXJcbn07IiwidmFyIHNldGlmeSA9IHJlcXVpcmUoJ3NldGlmeScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjbGFzczogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNsYXNzTmFtZS5zbGljZShnZW5lcmljLl9pbml0aWFsQ2xhc3Nlcy5sZW5ndGgpO1xuICAgICAgICB9XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkodmFsdWUpKXtcbiAgICAgICAgICAgIHZhbHVlID0gdmFsdWUuam9pbignICcpO1xuICAgICAgICB9XG4gICAgICAgIGVsZW1lbnQuY2xhc3NOYW1lID0gZ2VuZXJpYy5faW5pdGlhbENsYXNzZXMgKyAnICcgKyB2YWx1ZTtcbiAgICB9LFxuICAgIGRpc3BsYXk6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5zdHlsZS5kaXNwbGF5ICE9PSAnbm9uZSc7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gdmFsdWUgPyBudWxsIDogJ25vbmUnO1xuICAgIH0sXG4gICAgZGlzYWJsZWQ6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUpe1xuICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHRleHRDb250ZW50OiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dENvbnRlbnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICB2YXIgaW5wdXRUeXBlID0gZWxlbWVudC50eXBlO1xuXG4gICAgICAgIGlmKGVsZW1lbnQubm9kZU5hbWUgPT09ICdJTlBVVCcgJiYgaW5wdXRUeXBlID09ICdkYXRlJyl7XG4gICAgICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWxlbWVudC52YWx1ZSA/IG5ldyBEYXRlKGVsZW1lbnQudmFsdWUucmVwbGFjZSgvLS9nLCcvJykucmVwbGFjZSgnVCcsJyAnKSkgOiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YWx1ZSA9IHZhbHVlICE9IG51bGwgPyBuZXcgRGF0ZSh2YWx1ZSkgOiBudWxsO1xuXG4gICAgICAgICAgICBpZighdmFsdWUgfHwgaXNOYU4odmFsdWUpKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGVsZW1lbnQudmFsdWUgPSBbXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlLmdldEZ1bGxZZWFyKCksIFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgKHZhbHVlLmdldE1vbnRoKCkgKyAxKSkuc2xpY2UoLTIpLFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgdmFsdWUuZ2V0RGF0ZSgpKS5zbGljZSgtMilcbiAgICAgICAgICAgICAgICBdLmpvaW4oJy0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBzZXRpZnkoZWxlbWVudCwgdmFsdWUpO1xuICAgIH0sXG4gICAgc3R5bGU6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5zdHlsZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZXN1bHQgPSAnJztcblxuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICB9XG4gICAgfVxufTsiLCIvLyBJcyB0aGUgZW50aXR5IGZpcm1lciB0aGFuIHRoZSBuZXcgZmlybW5lc3Ncbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZW50aXR5LCBmaXJtKXtcbiAgICBpZihmaXJtICE9IG51bGwgJiYgKGVudGl0eS5fZmlybSA9PT0gdW5kZWZpbmVkIHx8IGZpcm0gPCBlbnRpdHkuX2Zpcm0pKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufTsiLCJ2YXIgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBjb250YWluZXJDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbnRhaW5lckNvbXBvbmVudCcpLFxuICAgIHNjaGVkdWxlID0gcmVxdWlyZSgnLi9zY2hlZHVsZScpLFxuICAgIGZhbmN5UHJvcHMgPSByZXF1aXJlKCcuL2ZhbmN5UHJvcHMnKTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoZmFzdG4sIGdlbmVyaWMsIGtleSwgc2V0dGluZ3Mpe1xuICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XSxcbiAgICAgICAgYmluZGluZyA9IGZhc3RuLmlzQmluZGluZyhzZXR0aW5nKSAmJiBzZXR0aW5nLFxuICAgICAgICBwcm9wZXJ0eSA9IGZhc3RuLmlzUHJvcGVydHkoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgdmFsdWUgPSAhYmluZGluZyAmJiAhcHJvcGVydHkgJiYgKGtleSBpbiBzZXR0aW5ncykgPyBzZXR0aW5nIDogdW5kZWZpbmVkO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZSgpe1xuICAgICAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpLFxuICAgICAgICAgICAgdmFsdWUgPSBwcm9wZXJ0eSgpO1xuXG4gICAgICAgIGlmKCFlbGVtZW50IHx8IGdlbmVyaWMuX2Rlc3Ryb3llZCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXNQcm9wZXJ0eSA9IGtleSBpbiBlbGVtZW50LFxuICAgICAgICAgICAgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1trZXldLFxuICAgICAgICAgICAgcHJldmlvdXMgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoZ2VuZXJpYywgZWxlbWVudCkgOiBpc1Byb3BlcnR5ID8gZWxlbWVudFtrZXldIDogZWxlbWVudC5nZXRBdHRyaWJ1dGUoa2V5KTtcblxuICAgICAgICBpZighZmFuY3lQcm9wICYmICFpc1Byb3BlcnR5ICYmIHZhbHVlID09IG51bGwpe1xuICAgICAgICAgICAgdmFsdWUgPSAnJztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHZhbHVlICE9PSBwcmV2aW91cyl7XG4gICAgICAgICAgICBpZihmYW5jeVByb3Ape1xuICAgICAgICAgICAgICAgIGZhbmN5UHJvcChnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihpc1Byb3BlcnR5KXtcbiAgICAgICAgICAgICAgICBlbGVtZW50W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4ucHJvcGVydHkodmFsdWUsIGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBnZW5lcmljLnVwZGF0ZVByb3BlcnR5KGdlbmVyaWMsIHByb3BlcnR5LCB1cGRhdGUpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgcHJvcGVydHkuYmluZGluZyhiaW5kaW5nKTtcbiAgICB9XG5cbiAgICBwcm9wZXJ0eS5hZGRUbyhnZW5lcmljLCBrZXkpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBnZW5lcmljLCBzZXR0aW5ncyl7XG4gICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICBjcmVhdGVQcm9wZXJ0eShmYXN0biwgZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGV2ZW50TmFtZSwgc2V0dGluZ3Mpe1xuICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5nZXRDb250YWluZXJFbGVtZW50KCksXG4gICAgICAgIGhhbmRsZXIgPSBmdW5jdGlvbihldmVudCl7XG4gICAgICAgICAgICBnZW5lcmljLmVtaXQoZXZlbnROYW1lLCBldmVudCwgZ2VuZXJpYy5zY29wZSgpKTtcbiAgICAgICAgfTtcblxuICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuXG4gICAgZ2VuZXJpYy5vbignZGVzdHJveScsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRBdXRvSGFuZGxlcihnZW5lcmljLCBrZXksIHNldHRpbmdzKXtcbiAgICBpZighc2V0dGluZ3Nba2V5XSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpLFxuICAgICAgICBhdXRvRXZlbnQgPSBzZXR0aW5nc1trZXldLnNwbGl0KCc6JyksXG4gICAgICAgIGV2ZW50TmFtZSA9IGtleS5zbGljZSgyKTtcblxuICAgIGRlbGV0ZSBzZXR0aW5nc1trZXldO1xuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIHZhciBmYW5jeVByb3AgPSBmYW5jeVByb3BzW2F1dG9FdmVudFsxXV0sXG4gICAgICAgICAgICB2YWx1ZSA9IGZhbmN5UHJvcCA/IGZhbmN5UHJvcChnZW5lcmljLCBlbGVtZW50KSA6IGVsZW1lbnRbYXV0b0V2ZW50WzFdXTtcblxuICAgICAgICBnZW5lcmljW2F1dG9FdmVudFswXV0odmFsdWUpO1xuICAgIH07XG5cbiAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcblxuICAgIGdlbmVyaWMub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJpY0NvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgZ2VuZXJpYyA9IGNvbnRhaW5lckNvbXBvbmVudCh0eXBlLCBmYXN0bik7XG5cbiAgICBnZW5lcmljLnVwZGF0ZVByb3BlcnR5ID0gZ2VuZXJpY0NvbXBvbmVudC51cGRhdGVQcm9wZXJ0eTtcbiAgICBnZW5lcmljLmNyZWF0ZUVsZW1lbnQgPSBnZW5lcmljQ29tcG9uZW50LmNyZWF0ZUVsZW1lbnQ7XG4gICAgY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3MpO1xuXG4gICAgZ2VuZXJpYy5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQgPSBnZW5lcmljLmNyZWF0ZUVsZW1lbnQoc2V0dGluZ3MudGFnTmFtZSB8fCB0eXBlKTtcblxuICAgICAgICBnZW5lcmljLmVtaXQoJ3JlbmRlcicpO1xuXG4gICAgICAgIHJldHVybiBnZW5lcmljO1xuICAgIH07XG5cbiAgICBnZW5lcmljLm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuXG4gICAgICAgIGdlbmVyaWMuX2luaXRpYWxDbGFzc2VzID0gZWxlbWVudC5jbGFzc05hbWU7XG5cbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICAgICAgaWYoa2V5LnNsaWNlKDAsMikgPT09ICdvbicgJiYga2V5IGluIGVsZW1lbnQpe1xuICAgICAgICAgICAgICAgIGFkZEF1dG9IYW5kbGVyKGdlbmVyaWMsIGtleSwgc2V0dGluZ3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yKHZhciBldmVudEtleSBpbiBnZW5lcmljLl9ldmVudHMpe1xuICAgICAgICAgICAgaWYoJ29uJyArIGV2ZW50S2V5LnRvTG93ZXJDYXNlKCkgaW4gZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkVXBkYXRlSGFuZGxlcihnZW5lcmljLCBldmVudEtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBnZW5lcmljO1xufTtcblxuZ2VuZXJpY0NvbXBvbmVudC51cGRhdGVQcm9wZXJ0eSA9IGZ1bmN0aW9uKGdlbmVyaWMsIHByb3BlcnR5LCB1cGRhdGUpe1xuICAgIGlmKGRvY3VtZW50LmNvbnRhaW5zKGdlbmVyaWMuZWxlbWVudCkpe1xuICAgICAgICBzY2hlZHVsZShwcm9wZXJ0eSwgdXBkYXRlKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgfVxufTtcblxuZ2VuZXJpY0NvbXBvbmVudC5jcmVhdGVFbGVtZW50ID0gZnVuY3Rpb24odGFnTmFtZSl7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnTmFtZSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdlbmVyaWNDb21wb25lbnQ7IiwidmFyIG1lcmdlID0gcmVxdWlyZSgnZmxhdC1tZXJnZScpLFxuICAgIGNyZWF0ZUNvbXBvbmVudCA9IHJlcXVpcmUoJy4vY29tcG9uZW50JyksXG4gICAgY3JlYXRlUHJvcGVydHkgPSByZXF1aXJlKCcuL3Byb3BlcnR5JyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihjb21wb25lbnRzLCBkZWJ1Zyl7XG5cbiAgICBmdW5jdGlvbiBmYXN0bih0eXBlKXtcbiAgICAgICAgdmFyIGFyZ3MgPSBbXTtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHNldHRpbmdzID0gYXJnc1sxXSxcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXggPSAyO1xuXG4gICAgICAgIGlmKGlzLmNvbXBvbmVudChhcmdzWzFdKSB8fCBBcnJheS5pc0FycmF5KGFyZ3NbMV0pIHx8IHR5cGVvZiBhcmdzWzFdICE9PSAnb2JqZWN0JyB8fCAhYXJnc1sxXSl7XG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4LS07XG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgYXJncy5zbGljZShjaGlsZHJlbkluZGV4KSwgY29tcG9uZW50cyk7XG4gICAgfVxuXG4gICAgZmFzdG4uZGVidWcgPSBkZWJ1ZztcblxuICAgIGZhc3RuLnByb3BlcnR5ID0gY3JlYXRlUHJvcGVydHk7XG5cbiAgICBmYXN0bi5iaW5kaW5nID0gY3JlYXRlQmluZGluZztcblxuICAgIGZhc3RuLnRvQ29tcG9uZW50ID0gZnVuY3Rpb24oY29tcG9uZW50KXtcbiAgICAgICAgaWYoY29tcG9uZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKGlzLmNvbXBvbmVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYodHlwZW9mIGNvbXBvbmVudCAhPT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCd0ZXh0Jywge3RleHQ6IGNvbXBvbmVudH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNFbGVtZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKGNvbXBvbmVudCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoY3JlbC5pc05vZGUoY29tcG9uZW50KSl7XG4gICAgICAgICAgICByZXR1cm4gZmFzdG4oJ3RleHQnLCB7dGV4dDogY29tcG9uZW50LnRleHRDb250ZW50fSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZmFzdG4uaXNDb21wb25lbnQgPSBpcy5jb21wb25lbnQ7XG4gICAgZmFzdG4uaXNCaW5kaW5nID0gaXMuYmluZGluZztcbiAgICBmYXN0bi5pc0RlZmF1bHRCaW5kaW5nID0gaXMuZGVmYXVsdEJpbmRpbmc7XG4gICAgZmFzdG4uaXNCaW5kaW5nT2JqZWN0ID0gaXMuYmluZGluZ09iamVjdDtcbiAgICBmYXN0bi5pc1Byb3BlcnR5ID0gaXMucHJvcGVydHk7XG4gICAgZmFzdG4uTW9kZWwgPSBFbnRpO1xuXG4gICAgcmV0dXJuIGZhc3RuO1xufTsiLCJcbmZ1bmN0aW9uIGlzQ29tcG9uZW50KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnb2JqZWN0JyAmJiAnX2Zhc3RuX2NvbXBvbmVudCcgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZ09iamVjdCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9iaW5kaW5nJyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzUHJvcGVydHkodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdmdW5jdGlvbicgJiYgJ19mYXN0bl9wcm9wZXJ0eScgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzRGVmYXVsdEJpbmRpbmcodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdmdW5jdGlvbicgJiYgJ19mYXN0bl9iaW5kaW5nJyBpbiB0aGluZyAmJiAnX2RlZmF1bHRfYmluZGluZycgaW4gdGhpbmc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNvbXBvbmVudDogaXNDb21wb25lbnQsXG4gICAgYmluZGluZ09iamVjdDogaXNCaW5kaW5nT2JqZWN0LFxuICAgIGJpbmRpbmc6IGlzQmluZGluZyxcbiAgICBkZWZhdWx0QmluZGluZzogaXNEZWZhdWx0QmluZGluZyxcbiAgICBwcm9wZXJ0eTogaXNQcm9wZXJ0eVxufTsiLCJ2YXIgTWFwID0gcmVxdWlyZSgnZXM2LW1hcCcpO1xuXG5mdW5jdGlvbiBlYWNoKHZhbHVlLCBmbil7XG4gICAgaWYoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoQXJyYXkuaXNBcnJheSh2YWx1ZSkpe1xuICAgICAgICB2YWx1ZS5mb3JFYWNoKGZuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gdmFsdWUpe1xuICAgICAgICAgICAgZm4odmFsdWVba2V5XSwga2V5KTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24ga2V5Rm9yKG9iamVjdCwgdmFsdWUpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgaWYob2JqZWN0W2tleV0gPT09IHZhbHVlKXtcbiAgICAgICAgICAgIHJldHVybiBrZXk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHZhbHVlcyhvYmplY3Qpe1xuICAgIGlmKEFycmF5LmlzQXJyYXkob2JqZWN0KSl7XG4gICAgICAgIHJldHVybiBvYmplY3Quc2xpY2UoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gW107XG5cbiAgICBmb3IodmFyIGtleSBpbiBvYmplY3Qpe1xuICAgICAgICByZXN1bHQucHVzaChvYmplY3Rba2V5XSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBzZXR0aW5ncy50YWdOYW1lID0gc2V0dGluZ3MudGFnTmFtZSB8fCAnZGl2JztcbiAgICBcbiAgICB2YXIgbGlzdCA9IGZhc3RuKCdfZ2VuZXJpYycsIHNldHRpbmdzLCBjaGlsZHJlbiksXG4gICAgICAgIGl0ZW1zTWFwID0gbmV3IE1hcCgpLFxuICAgICAgICBsYXN0VGVtcGxhdGU7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVJdGVtcygpe1xuICAgICAgICB2YXIgdmFsdWUgPSBsaXN0Lml0ZW1zKCksXG4gICAgICAgICAgICB0ZW1wbGF0ZSA9IGxpc3QudGVtcGxhdGUoKSxcbiAgICAgICAgICAgIGVtcHR5VGVtcGxhdGUgPSBsaXN0LmVtcHR5VGVtcGxhdGUoKSxcbiAgICAgICAgICAgIG5ld1RlbXBsYXRlID0gbGFzdFRlbXBsYXRlICE9PSB0ZW1wbGF0ZTtcblxuICAgICAgICBpZighdGVtcGxhdGUpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW1zID0gdmFsdWVzKHZhbHVlKTtcbiAgICAgICAgICAgIGN1cnJlbnRJdGVtcyA9IGl0ZW1zLnNsaWNlKCk7XG5cbiAgICAgICAgaXRlbXNNYXAuZm9yRWFjaChmdW5jdGlvbihjb21wb25lbnQsIGl0ZW0pe1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGN1cnJlbnRJdGVtcy5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICBpZighbmV3VGVtcGxhdGUgJiYgfmN1cnJlbnRJbmRleCl7XG4gICAgICAgICAgICAgICAgY3VycmVudEl0ZW1zLnNwbGljZShjdXJyZW50SW5kZXgsMSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBsaXN0LnJlbW92ZUl0ZW0oaXRlbSwgaXRlbXNNYXApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgaW5kZXggPSAwO1xuXG4gICAgICAgIGVhY2godmFsdWUsIGZ1bmN0aW9uKGl0ZW0sIGtleSl7XG4gICAgICAgICAgICB3aGlsZShpbmRleCA8IGxpc3QuX2NoaWxkcmVuLmxlbmd0aCAmJiBsaXN0Ll9jaGlsZHJlbltpbmRleF0uX3RlbXBsYXRlZCAmJiAhfml0ZW1zLmluZGV4T2YobGlzdC5fY2hpbGRyZW5baW5kZXhdLl9saXN0SXRlbSkpe1xuICAgICAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBjaGlsZCxcbiAgICAgICAgICAgICAgICBtb2RlbCA9IG5ldyBmYXN0bi5Nb2RlbCh7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICAgICAgICAgICAgICAgIGtleToga2V5XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmKCFpdGVtc01hcC5oYXMoaXRlbSkpe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4udG9Db21wb25lbnQodGVtcGxhdGUobW9kZWwsIGxpc3Quc2NvcGUoKSkpO1xuICAgICAgICAgICAgICAgIGlmKCFjaGlsZCl7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4oJ3RlbXBsYXRlJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNoaWxkLl9saXN0SXRlbSA9IGl0ZW07XG4gICAgICAgICAgICAgICAgY2hpbGQuX3RlbXBsYXRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgICAgICBpdGVtc01hcC5zZXQoaXRlbSwgY2hpbGQpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBpdGVtc01hcC5nZXQoaXRlbSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNoaWxkKSAmJiBsaXN0Ll9zZXR0aW5ncy5hdHRhY2hUZW1wbGF0ZXMgIT09IGZhbHNlKXtcbiAgICAgICAgICAgICAgICBjaGlsZC5hdHRhY2gobW9kZWwsIDIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsaXN0Lmluc2VydChjaGlsZCwgaW5kZXgpO1xuICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGFzdFRlbXBsYXRlID0gdGVtcGxhdGU7XG5cbiAgICAgICAgaWYoaW5kZXggPT09IDAgJiYgZW1wdHlUZW1wbGF0ZSl7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudChlbXB0eVRlbXBsYXRlKGxpc3Quc2NvcGUoKSkpO1xuICAgICAgICAgICAgaWYoIWNoaWxkKXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCd0ZW1wbGF0ZScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGQuX3RlbXBsYXRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIGl0ZW1zTWFwLnNldCh7fSwgY2hpbGQpO1xuXG4gICAgICAgICAgICBsaXN0Lmluc2VydChjaGlsZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsaXN0LnJlbW92ZUl0ZW0gPSBmdW5jdGlvbihpdGVtLCBpdGVtc01hcCl7XG4gICAgICAgIHZhciBjb21wb25lbnQgPSBpdGVtc01hcC5nZXQoaXRlbSk7XG4gICAgICAgIGxpc3QucmVtb3ZlKGNvbXBvbmVudCk7XG4gICAgICAgIGNvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgICAgIGl0ZW1zTWFwLmRlbGV0ZShpdGVtKTtcbiAgICB9O1xuXG4gICAgZmFzdG4ucHJvcGVydHkoW10sIHNldHRpbmdzLml0ZW1DaGFuZ2VzIHx8ICd0eXBlIHN0cnVjdHVyZScsIHVwZGF0ZUl0ZW1zKVxuICAgICAgICAuYWRkVG8obGlzdCwgJ2l0ZW1zJyk7XG5cbiAgICBmYXN0bi5wcm9wZXJ0eSh1bmRlZmluZWQsICd2YWx1ZScpXG4gICAgICAgIC5hZGRUbyhsaXN0LCAndGVtcGxhdGUnKVxuICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZUl0ZW1zKTtcblxuICAgIGZhc3RuLnByb3BlcnR5KHVuZGVmaW5lZCwgJ3ZhbHVlJylcbiAgICAgICAgLmFkZFRvKGxpc3QsICdlbXB0eVRlbXBsYXRlJylcbiAgICAgICAgLm9uKCdjaGFuZ2UnLCB1cGRhdGVJdGVtcyk7XG5cbiAgICByZXR1cm4gbGlzdDtcbn07IiwiLyoqXG5cbiAgICBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gYWRkIEV2ZW50RW1pdHRlciBtZXRob2RzIHRvIGZ1bmN0aW9ucyxcbiAgICB3aGljaCBjYW5ub3QgYmUgYWRkZWQgaW4gdGhlIHVzdWFsLCBDb25zdHJ1Y3Rvci5wcm90b3R5cGUgZmFzc2lvbi5cblxuKi9cblxudmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxudmFyIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSA9IGZ1bmN0aW9uKCl7fTtcbmZvcih2YXIga2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1ha2VGdW5jdGlvbkVtaXR0ZXIob2JqZWN0KXtcbiAgICBpZihPYmplY3Quc2V0UHJvdG90eXBlT2Ype1xuICAgICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2Yob2JqZWN0LCBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUpO1xuICAgIH1lbHNlIGlmKF9fcHJvdG9fXyBpbiBvYmplY3Qpe1xuICAgICAgICBvYmplY3QuX19wcm90b19fID0gZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlO1xuICAgIH1lbHNle1xuICAgICAgICBmb3IodmFyIGtleSBpbiBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUpe1xuICAgICAgICAgICAgb2JqZWN0W2tleV0gPSBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGVba2V5XTtcbiAgICAgICAgfVxuICAgIH1cbn07IiwidmFyIEFqYXggPSByZXF1aXJlKCdzaW1wbGUtYWpheCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHNldHRpbmdzLCBjYWxsYmFjayl7XG4gICAgaWYodHlwZW9mIHNldHRpbmdzID09PSAnc3RyaW5nJyl7XG4gICAgICAgIHNldHRpbmdzID0ge1xuICAgICAgICAgICAgdXJsOiBzZXR0aW5nc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIGlmKHR5cGVvZiBzZXR0aW5ncyAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnc2V0dGluZ3MgbXVzdCBiZSBhIHN0cmluZyBvciBvYmplY3QnO1xuICAgIH1cblxuICAgIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHRocm93ICdjcGpheCBtdXN0IGJlIHBhc3NlZCBhIGNhbGxiYWNrIGFzIHRoZSBzZWNvbmQgcGFyYW1ldGVyJztcbiAgICB9XG5cbiAgICB2YXIgYWpheCA9IG5ldyBBamF4KHNldHRpbmdzKTtcblxuICAgIGFqYXgub24oJ3N1Y2Nlc3MnLCBmdW5jdGlvbihldmVudCwgZGF0YSkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLCBldmVudCk7XG4gICAgfSk7XG4gICAgYWpheC5vbignZXJyb3InLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBjYWxsYmFjayhldmVudC50YXJnZXQucmVzcG9uc2VUZXh0LCBudWxsLCBldmVudCk7XG4gICAgfSk7XG5cbiAgICBhamF4LnNlbmQoKTtcblxuICAgIHJldHVybiBhamF4O1xufTsiLCJ2YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxuICAgIHF1ZXJ5U3RyaW5nID0gcmVxdWlyZSgncXVlcnktc3RyaW5nJyk7XG5cbmZ1bmN0aW9uIHRyeVBhcnNlSnNvbihkYXRhKXtcbiAgICB0cnl7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGRhdGEpO1xuICAgIH1jYXRjaChlcnJvcil7XG4gICAgICAgIHJldHVybiBlcnJvcjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHRpbWVvdXQoKXtcbiAgIHRoaXMucmVxdWVzdC5hYm9ydCgpO1xuICAgdGhpcy5lbWl0KCd0aW1lb3V0Jyk7XG59XG5cbmZ1bmN0aW9uIEFqYXgoc2V0dGluZ3Mpe1xuICAgIHZhciBxdWVyeVN0cmluZ0RhdGEsXG4gICAgICAgIGFqYXggPSB0aGlzO1xuXG4gICAgaWYodHlwZW9mIHNldHRpbmdzID09PSAnc3RyaW5nJyl7XG4gICAgICAgIHNldHRpbmdzID0ge1xuICAgICAgICAgICAgdXJsOiBzZXR0aW5nc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIGlmKHR5cGVvZiBzZXR0aW5ncyAhPT0gJ29iamVjdCcpe1xuICAgICAgICBzZXR0aW5ncyA9IHt9O1xuICAgIH1cblxuICAgIGFqYXguc2V0dGluZ3MgPSBzZXR0aW5ncztcbiAgICBhamF4LnJlcXVlc3QgPSBuZXcgd2luZG93LlhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgYWpheC5zZXR0aW5ncy5tZXRob2QgPSBhamF4LnNldHRpbmdzLm1ldGhvZCB8fCAnZ2V0JztcblxuICAgIGlmKGFqYXguc2V0dGluZ3MuY29ycyl7XG4gICAgICAgIC8vaHR0cDovL3d3dy5odG1sNXJvY2tzLmNvbS9lbi90dXRvcmlhbHMvY29ycy9cbiAgICAgICAgaWYgKCd3aXRoQ3JlZGVudGlhbHMnIGluIGFqYXgucmVxdWVzdCkge1xuICAgICAgICAgICAgYWpheC5yZXF1ZXN0LndpdGhDcmVkZW50aWFscyA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIFhEb21haW5SZXF1ZXN0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCBjaGVjayBpZiBYRG9tYWluUmVxdWVzdC5cbiAgICAgICAgICAgIC8vIFhEb21haW5SZXF1ZXN0IG9ubHkgZXhpc3RzIGluIElFLCBhbmQgaXMgSUUncyB3YXkgb2YgbWFraW5nIENPUlMgcmVxdWVzdHMuXG4gICAgICAgICAgICBhamF4LnJlcXVlc3QgPSBuZXcgd2luZG93LlhEb21haW5SZXF1ZXN0KCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBPdGhlcndpc2UsIENPUlMgaXMgbm90IHN1cHBvcnRlZCBieSB0aGUgYnJvd3Nlci5cbiAgICAgICAgICAgIGFqYXguZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ0NvcnMgaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIGJyb3dzZXInKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZihhamF4LnNldHRpbmdzLmNhY2hlID09PSBmYWxzZSl7XG4gICAgICAgIGFqYXguc2V0dGluZ3MuZGF0YSA9IGFqYXguc2V0dGluZ3MuZGF0YSB8fCB7fTtcbiAgICAgICAgYWpheC5zZXR0aW5ncy5kYXRhLl8gPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICB9XG5cbiAgICBpZihhamF4LnNldHRpbmdzLm1ldGhvZC50b0xvd2VyQ2FzZSgpID09PSAnZ2V0JyAmJiB0eXBlb2YgYWpheC5zZXR0aW5ncy5kYXRhID09PSAnb2JqZWN0Jyl7XG4gICAgICAgIHZhciB1cmxQYXJ0cyA9IGFqYXguc2V0dGluZ3MudXJsLnNwbGl0KCc/Jyk7XG5cbiAgICAgICAgcXVlcnlTdHJpbmdEYXRhID0gcXVlcnlTdHJpbmcucGFyc2UodXJsUGFydHNbMV0pO1xuXG4gICAgICAgIGZvcih2YXIga2V5IGluIGFqYXguc2V0dGluZ3MuZGF0YSl7XG4gICAgICAgICAgICBxdWVyeVN0cmluZ0RhdGFba2V5XSA9IGFqYXguc2V0dGluZ3MuZGF0YVtrZXldO1xuICAgICAgICB9XG5cbiAgICAgICAgYWpheC5zZXR0aW5ncy51cmwgPSB1cmxQYXJ0c1swXSArICc/JyArIHF1ZXJ5U3RyaW5nLnN0cmluZ2lmeShxdWVyeVN0cmluZ0RhdGEpO1xuICAgICAgICBhamF4LnNldHRpbmdzLmRhdGEgPSBudWxsO1xuICAgIH1cblxuICAgIGFqYXgucmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdwcm9ncmVzcycsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgYWpheC5lbWl0KCdwcm9ncmVzcycsIGV2ZW50KTtcbiAgICB9LCBmYWxzZSk7XG5cbiAgICBhamF4LnJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgdmFyIGRhdGEgPSBldmVudC50YXJnZXQucmVzcG9uc2VUZXh0O1xuXG4gICAgICAgIGlmKGFqYXguc2V0dGluZ3MuZGF0YVR5cGUgJiYgYWpheC5zZXR0aW5ncy5kYXRhVHlwZS50b0xvd2VyQ2FzZSgpID09PSAnanNvbicpe1xuICAgICAgICAgICAgaWYoZGF0YSA9PT0gJycpe1xuICAgICAgICAgICAgICAgIGRhdGEgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBkYXRhID0gdHJ5UGFyc2VKc29uKGRhdGEpO1xuICAgICAgICAgICAgICAgIGlmKGRhdGEgaW5zdGFuY2VvZiBFcnJvcil7XG4gICAgICAgICAgICAgICAgICAgIGFqYXguZW1pdCgnZXJyb3InLCBldmVudCwgZGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZihldmVudC50YXJnZXQuc3RhdHVzID49IDQwMCl7XG4gICAgICAgICAgICBhamF4LmVtaXQoJ2Vycm9yJywgZXZlbnQsIGRhdGEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYWpheC5lbWl0KCdzdWNjZXNzJywgZXZlbnQsIGRhdGEpO1xuICAgICAgICB9XG5cbiAgICB9LCBmYWxzZSk7XG5cbiAgICBhamF4LnJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGFqYXguZW1pdCgnZXJyb3InLCBldmVudCk7XG4gICAgfSwgZmFsc2UpO1xuXG4gICAgYWpheC5yZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Fib3J0JywgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBhamF4LmVtaXQoJ2Fib3J0JywgZXZlbnQpO1xuICAgIH0sIGZhbHNlKTtcblxuICAgIGFqYXgucmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkZW5kJywgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVxdWVzdFRpbWVvdXQpO1xuICAgICAgICBhamF4LmVtaXQoJ2NvbXBsZXRlJywgZXZlbnQpO1xuICAgIH0sIGZhbHNlKTtcblxuICAgIGFqYXgucmVxdWVzdC5vcGVuKGFqYXguc2V0dGluZ3MubWV0aG9kIHx8ICdnZXQnLCBhamF4LnNldHRpbmdzLnVybCwgdHJ1ZSk7XG5cbiAgICAvLyBTZXQgZGVmYXVsdCBoZWFkZXJzXG4gICAgaWYoYWpheC5zZXR0aW5ncy5jb250ZW50VHlwZSAhPT0gZmFsc2Upe1xuICAgICAgICBhamF4LnJlcXVlc3Quc2V0UmVxdWVzdEhlYWRlcignQ29udGVudC1UeXBlJywgYWpheC5zZXR0aW5ncy5jb250ZW50VHlwZSB8fCAnYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOCcpO1xuICAgIH1cbiAgICBhamF4LnJlcXVlc3Quc2V0UmVxdWVzdEhlYWRlcignWC1SZXF1ZXN0ZWQtV2l0aCcsIGFqYXguc2V0dGluZ3MucmVxdWVzdGVkV2l0aCB8fCAnWE1MSHR0cFJlcXVlc3QnKTtcbiAgICBpZihhamF4LnNldHRpbmdzLmF1dGgpe1xuICAgICAgICBhamF4LnJlcXVlc3Quc2V0UmVxdWVzdEhlYWRlcignQXV0aG9yaXphdGlvbicsIGFqYXguc2V0dGluZ3MuYXV0aCk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGN1c3RvbSBoZWFkZXJzXG4gICAgZm9yKHZhciBoZWFkZXJLZXkgaW4gYWpheC5zZXR0aW5ncy5oZWFkZXJzKXtcbiAgICAgICAgYWpheC5yZXF1ZXN0LnNldFJlcXVlc3RIZWFkZXIoaGVhZGVyS2V5LCBhamF4LnNldHRpbmdzLmhlYWRlcnNbaGVhZGVyS2V5XSk7XG4gICAgfVxuXG4gICAgaWYoYWpheC5zZXR0aW5ncy5wcm9jZXNzRGF0YSAhPT0gZmFsc2UgJiYgYWpheC5zZXR0aW5ncy5kYXRhVHlwZSA9PT0gJ2pzb24nKXtcbiAgICAgICAgYWpheC5zZXR0aW5ncy5kYXRhID0gSlNPTi5zdHJpbmdpZnkoYWpheC5zZXR0aW5ncy5kYXRhKTtcbiAgICB9XG59XG5cbkFqYXgucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShFdmVudEVtaXR0ZXIucHJvdG90eXBlKTtcblxuQWpheC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKCl7XG4gICAgdGhpcy5fcmVxdWVzdFRpbWVvdXQgPSBzZXRUaW1lb3V0KFxuICAgICAgICB0aW1lb3V0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMuc2V0dGluZ3MudGltZW91dCB8fCAxMjAwMDBcbiAgICApO1xuICAgIHRoaXMucmVxdWVzdC5zZW5kKHRoaXMuc2V0dGluZ3MuZGF0YSAmJiB0aGlzLnNldHRpbmdzLmRhdGEpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBBamF4OyIsIi8qIVxuXHRxdWVyeS1zdHJpbmdcblx0UGFyc2UgYW5kIHN0cmluZ2lmeSBVUkwgcXVlcnkgc3RyaW5nc1xuXHRodHRwczovL2dpdGh1Yi5jb20vc2luZHJlc29yaHVzL3F1ZXJ5LXN0cmluZ1xuXHRieSBTaW5kcmUgU29yaHVzXG5cdE1JVCBMaWNlbnNlXG4qL1xuKGZ1bmN0aW9uICgpIHtcblx0J3VzZSBzdHJpY3QnO1xuXHR2YXIgcXVlcnlTdHJpbmcgPSB7fTtcblxuXHRxdWVyeVN0cmluZy5wYXJzZSA9IGZ1bmN0aW9uIChzdHIpIHtcblx0XHRpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpIHtcblx0XHRcdHJldHVybiB7fTtcblx0XHR9XG5cblx0XHRzdHIgPSBzdHIudHJpbSgpLnJlcGxhY2UoL14oXFw/fCMpLywgJycpO1xuXG5cdFx0aWYgKCFzdHIpIHtcblx0XHRcdHJldHVybiB7fTtcblx0XHR9XG5cblx0XHRyZXR1cm4gc3RyLnRyaW0oKS5zcGxpdCgnJicpLnJlZHVjZShmdW5jdGlvbiAocmV0LCBwYXJhbSkge1xuXHRcdFx0dmFyIHBhcnRzID0gcGFyYW0ucmVwbGFjZSgvXFwrL2csICcgJykuc3BsaXQoJz0nKTtcblx0XHRcdHZhciBrZXkgPSBwYXJ0c1swXTtcblx0XHRcdHZhciB2YWwgPSBwYXJ0c1sxXTtcblxuXHRcdFx0a2V5ID0gZGVjb2RlVVJJQ29tcG9uZW50KGtleSk7XG5cdFx0XHQvLyBtaXNzaW5nIGA9YCBzaG91bGQgYmUgYG51bGxgOlxuXHRcdFx0Ly8gaHR0cDovL3czLm9yZy9UUi8yMDEyL1dELXVybC0yMDEyMDUyNC8jY29sbGVjdC11cmwtcGFyYW1ldGVyc1xuXHRcdFx0dmFsID0gdmFsID09PSB1bmRlZmluZWQgPyBudWxsIDogZGVjb2RlVVJJQ29tcG9uZW50KHZhbCk7XG5cblx0XHRcdGlmICghcmV0Lmhhc093blByb3BlcnR5KGtleSkpIHtcblx0XHRcdFx0cmV0W2tleV0gPSB2YWw7XG5cdFx0XHR9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkocmV0W2tleV0pKSB7XG5cdFx0XHRcdHJldFtrZXldLnB1c2godmFsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHJldFtrZXldID0gW3JldFtrZXldLCB2YWxdO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcmV0O1xuXHRcdH0sIHt9KTtcblx0fTtcblxuXHRxdWVyeVN0cmluZy5zdHJpbmdpZnkgPSBmdW5jdGlvbiAob2JqKSB7XG5cdFx0cmV0dXJuIG9iaiA/IE9iamVjdC5rZXlzKG9iaikubWFwKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRcdHZhciB2YWwgPSBvYmpba2V5XTtcblxuXHRcdFx0aWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuXHRcdFx0XHRyZXR1cm4gdmFsLm1hcChmdW5jdGlvbiAodmFsMikge1xuXHRcdFx0XHRcdHJldHVybiBlbmNvZGVVUklDb21wb25lbnQoa2V5KSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWwyKTtcblx0XHRcdFx0fSkuam9pbignJicpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQodmFsKTtcblx0XHR9KS5qb2luKCcmJykgOiAnJztcblx0fTtcblxuXHRpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG5cdFx0ZGVmaW5lKGZ1bmN0aW9uKCkgeyByZXR1cm4gcXVlcnlTdHJpbmc7IH0pO1xuXHR9IGVsc2UgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XG5cdFx0bW9kdWxlLmV4cG9ydHMgPSBxdWVyeVN0cmluZztcblx0fSBlbHNlIHtcblx0XHRzZWxmLnF1ZXJ5U3RyaW5nID0gcXVlcnlTdHJpbmc7XG5cdH1cbn0pKCk7XG4iLCIvL0NvcHlyaWdodCAoQykgMjAxMiBLb3J5IE51bm5cclxuXHJcbi8vUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcclxuXHJcbi8vVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXHJcblxyXG4vL1RIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxyXG5cclxuLypcclxuXHJcbiAgICBUaGlzIGNvZGUgaXMgbm90IGZvcm1hdHRlZCBmb3IgcmVhZGFiaWxpdHksIGJ1dCByYXRoZXIgcnVuLXNwZWVkIGFuZCB0byBhc3Npc3QgY29tcGlsZXJzLlxyXG5cclxuICAgIEhvd2V2ZXIsIHRoZSBjb2RlJ3MgaW50ZW50aW9uIHNob3VsZCBiZSB0cmFuc3BhcmVudC5cclxuXHJcbiAgICAqKiogSUUgU1VQUE9SVCAqKipcclxuXHJcbiAgICBJZiB5b3UgcmVxdWlyZSB0aGlzIGxpYnJhcnkgdG8gd29yayBpbiBJRTcsIGFkZCB0aGUgZm9sbG93aW5nIGFmdGVyIGRlY2xhcmluZyBjcmVsLlxyXG5cclxuICAgIHZhciB0ZXN0RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcbiAgICAgICAgdGVzdExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGFiZWwnKTtcclxuXHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnYScpO1xyXG4gICAgdGVzdERpdlsnY2xhc3NOYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnY2xhc3MnXSA9ICdjbGFzc05hbWUnOnVuZGVmaW5lZDtcclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCduYW1lJywnYScpO1xyXG4gICAgdGVzdERpdlsnbmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ25hbWUnXSA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcclxuICAgICAgICBlbGVtZW50LmlkID0gdmFsdWU7XHJcbiAgICB9OnVuZGVmaW5lZDtcclxuXHJcblxyXG4gICAgdGVzdExhYmVsLnNldEF0dHJpYnV0ZSgnZm9yJywgJ2EnKTtcclxuICAgIHRlc3RMYWJlbFsnaHRtbEZvciddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2ZvciddID0gJ2h0bWxGb3InOnVuZGVmaW5lZDtcclxuXHJcblxyXG5cclxuKi9cclxuXHJcbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xyXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcclxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJvb3QuY3JlbCA9IGZhY3RvcnkoKTtcclxuICAgIH1cclxufSh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICB2YXIgZm4gPSAnZnVuY3Rpb24nLFxyXG4gICAgICAgIG9iaiA9ICdvYmplY3QnLFxyXG4gICAgICAgIG5vZGVUeXBlID0gJ25vZGVUeXBlJyxcclxuICAgICAgICB0ZXh0Q29udGVudCA9ICd0ZXh0Q29udGVudCcsXHJcbiAgICAgICAgc2V0QXR0cmlidXRlID0gJ3NldEF0dHJpYnV0ZScsXHJcbiAgICAgICAgYXR0ck1hcFN0cmluZyA9ICdhdHRyTWFwJyxcclxuICAgICAgICBpc05vZGVTdHJpbmcgPSAnaXNOb2RlJyxcclxuICAgICAgICBpc0VsZW1lbnRTdHJpbmcgPSAnaXNFbGVtZW50JyxcclxuICAgICAgICBkID0gdHlwZW9mIGRvY3VtZW50ID09PSBvYmogPyBkb2N1bWVudCA6IHt9LFxyXG4gICAgICAgIGlzVHlwZSA9IGZ1bmN0aW9uKGEsIHR5cGUpe1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc05vZGUgPSB0eXBlb2YgTm9kZSA9PT0gZm4gPyBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBOb2RlO1xyXG4gICAgICAgIH0gOlxyXG4gICAgICAgIC8vIGluIElFIDw9IDggTm9kZSBpcyBhbiBvYmplY3QsIG9idmlvdXNseS4uXHJcbiAgICAgICAgZnVuY3Rpb24ob2JqZWN0KXtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdCwgb2JqKSAmJlxyXG4gICAgICAgICAgICAgICAgKG5vZGVUeXBlIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbFtpc05vZGVTdHJpbmddKG9iamVjdCkgJiYgb2JqZWN0W25vZGVUeXBlXSA9PT0gMTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzQXJyYXkgPSBmdW5jdGlvbihhKXtcclxuICAgICAgICAgICAgcmV0dXJuIGEgaW5zdGFuY2VvZiBBcnJheTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGFwcGVuZENoaWxkID0gZnVuY3Rpb24oZWxlbWVudCwgY2hpbGQpIHtcclxuICAgICAgICAgIGlmKCFjcmVsW2lzTm9kZVN0cmluZ10oY2hpbGQpKXtcclxuICAgICAgICAgICAgICBjaGlsZCA9IGQuY3JlYXRlVGV4dE5vZGUoY2hpbGQpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgZWxlbWVudC5hcHBlbmRDaGlsZChjaGlsZCk7XHJcbiAgICAgICAgfTtcclxuXHJcblxyXG4gICAgZnVuY3Rpb24gY3JlbCgpe1xyXG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLCAvL05vdGU6IGFzc2lnbmVkIHRvIGEgdmFyaWFibGUgdG8gYXNzaXN0IGNvbXBpbGVycy4gU2F2ZXMgYWJvdXQgNDAgYnl0ZXMgaW4gY2xvc3VyZSBjb21waWxlci4gSGFzIG5lZ2xpZ2FibGUgZWZmZWN0IG9uIHBlcmZvcm1hbmNlLlxyXG4gICAgICAgICAgICBlbGVtZW50ID0gYXJnc1swXSxcclxuICAgICAgICAgICAgY2hpbGQsXHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gYXJnc1sxXSxcclxuICAgICAgICAgICAgY2hpbGRJbmRleCA9IDIsXHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0xlbmd0aCA9IGFyZ3MubGVuZ3RoLFxyXG4gICAgICAgICAgICBhdHRyaWJ1dGVNYXAgPSBjcmVsW2F0dHJNYXBTdHJpbmddO1xyXG5cclxuICAgICAgICBlbGVtZW50ID0gY3JlbFtpc0VsZW1lbnRTdHJpbmddKGVsZW1lbnQpID8gZWxlbWVudCA6IGQuY3JlYXRlRWxlbWVudChlbGVtZW50KTtcclxuICAgICAgICAvLyBzaG9ydGN1dFxyXG4gICAgICAgIGlmKGFyZ3VtZW50c0xlbmd0aCA9PT0gMSl7XHJcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYoIWlzVHlwZShzZXR0aW5ncyxvYmopIHx8IGNyZWxbaXNOb2RlU3RyaW5nXShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudFt0ZXh0Q29udGVudF0gIT09IHVuZGVmaW5lZCl7XHJcbiAgICAgICAgICAgIGVsZW1lbnRbdGV4dENvbnRlbnRdID0gYXJnc1tjaGlsZEluZGV4XTtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgZm9yKDsgY2hpbGRJbmRleCA8IGFyZ3VtZW50c0xlbmd0aDsgKytjaGlsZEluZGV4KXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gYXJnc1tjaGlsZEluZGV4XTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZihjaGlsZCA9PSBudWxsKXtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgY2hpbGQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xyXG4gICAgICAgICAgICBpZighYXR0cmlidXRlTWFwW2tleV0pe1xyXG4gICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShhdHRyLCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlZCBmb3IgbWFwcGluZyBvbmUga2luZCBvZiBhdHRyaWJ1dGUgdG8gdGhlIHN1cHBvcnRlZCB2ZXJzaW9uIG9mIHRoYXQgaW4gYmFkIGJyb3dzZXJzLlxyXG4gICAgY3JlbFthdHRyTWFwU3RyaW5nXSA9IHt9O1xyXG5cclxuICAgIGNyZWxbaXNFbGVtZW50U3RyaW5nXSA9IGlzRWxlbWVudDtcclxuXHJcbiAgICBjcmVsW2lzTm9kZVN0cmluZ10gPSBpc05vZGU7XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBTZXQgPSByZXF1aXJlKCdlczYtc2V0JyksXG4gICAgV2Vha01hcCA9IHJlcXVpcmUoJ2VzNi13ZWFrLW1hcCcpO1xuXG5mdW5jdGlvbiB0b0FycmF5KGl0ZW1zKXtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoaXRlbXMpO1xufVxuXG52YXIgZGVlcFJlZ2V4ID0gL1t8Ll0vaTtcblxuZnVuY3Rpb24gbWF0Y2hEZWVwKHBhdGgpe1xuICAgIHJldHVybiAocGF0aCArICcnKS5tYXRjaChkZWVwUmVnZXgpO1xufVxuXG5mdW5jdGlvbiBpc0RlZXAocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gfnN0cmluZ1BhdGguaW5kZXhPZignLicpIHx8IH5zdHJpbmdQYXRoLmluZGV4T2YoJyoqJykgfHwgfnN0cmluZ1BhdGguaW5kZXhPZignfCcpO1xufVxuXG5mdW5jdGlvbiBpc1dpbGRjYXJkUGF0aChwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuICAgIHJldHVybiB+c3RyaW5nUGF0aC5pbmRleE9mKCcqJyk7XG59XG5cbmZ1bmN0aW9uIGlzRmlsdGVyUGF0aChwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuICAgIHJldHVybiB+c3RyaW5nUGF0aC5pbmRleE9mKCd8Jyk7XG59XG5cbmZ1bmN0aW9uIGdldFRhcmdldEtleShwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuICAgIHJldHVybiBzdHJpbmdQYXRoLnNwbGl0KCd8Jykuc2hpZnQoKTtcbn1cblxudmFyIGF0dGFjaGVkRW50aWVzID0gbmV3IFNldCgpLFxuICAgIHRyYWNrZWRPYmplY3RzID0gbmV3IFdlYWtNYXAoKTtcblxuZnVuY3Rpb24gbGVmdEFuZFJlc3QocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcblxuICAgIC8vIFNwZWNpYWwgY2FzZSB3aGVuIHlvdSB3YW50IHRvIGZpbHRlciBvbiBzZWxmICguKVxuICAgIGlmKHN0cmluZ1BhdGguc2xpY2UoMCwyKSA9PT0gJy58Jyl7XG4gICAgICAgIHJldHVybiBbJy4nLCBzdHJpbmdQYXRoLnNsaWNlKDIpXTtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2ggPSBtYXRjaERlZXAoc3RyaW5nUGF0aCk7XG4gICAgaWYobWF0Y2gpe1xuICAgICAgICByZXR1cm4gW3N0cmluZ1BhdGguc2xpY2UoMCwgbWF0Y2guaW5kZXgpLCBzdHJpbmdQYXRoLnNsaWNlKG1hdGNoLmluZGV4KzEpXTtcbiAgICB9XG4gICAgcmV0dXJuIHN0cmluZ1BhdGg7XG59XG5cbmZ1bmN0aW9uIGlzV2lsZGNhcmRLZXkoa2V5KXtcbiAgICByZXR1cm4ga2V5LmNoYXJBdCgwKSA9PT0gJyonO1xufVxuXG5mdW5jdGlvbiBpc0ZlcmFsY2FyZEtleShrZXkpe1xuICAgIHJldHVybiBrZXkgPT09ICcqKic7XG59XG5cbmZ1bmN0aW9uIGFkZEhhbmRsZXIob2JqZWN0LCBrZXksIGhhbmRsZXIpe1xuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYodHJhY2tlZEtleXMgPT0gbnVsbCl7XG4gICAgICAgIHRyYWNrZWRLZXlzID0ge307XG4gICAgICAgIHRyYWNrZWRPYmplY3RzLnNldChvYmplY3QsIHRyYWNrZWRLZXlzKTtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlcnMgPSB0cmFja2VkS2V5c1trZXldO1xuXG4gICAgaWYoIWhhbmRsZXJzKXtcbiAgICAgICAgaGFuZGxlcnMgPSBuZXcgU2V0KCk7XG4gICAgICAgIHRyYWNrZWRLZXlzW2tleV0gPSBoYW5kbGVycztcbiAgICB9XG5cbiAgICBoYW5kbGVycy5hZGQoaGFuZGxlcik7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUhhbmRsZXIob2JqZWN0LCBrZXksIGhhbmRsZXIpe1xuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYodHJhY2tlZEtleXMgPT0gbnVsbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlcnMgPSB0cmFja2VkS2V5c1trZXldO1xuXG4gICAgaWYoIWhhbmRsZXJzKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGhhbmRsZXJzLmRlbGV0ZShoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgb2JqZWN0LCBrZXksIHBhdGgpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50S2V5ID0ga2V5ID09PSAnKionID8gJyonIDoga2V5LFxuICAgICAgICB0YXJnZXQgPSBvYmplY3Rba2V5XSxcbiAgICAgICAgdGFyZ2V0SXNPYmplY3QgPSB0YXJnZXQgJiYgdHlwZW9mIHRhcmdldCA9PT0gJ29iamVjdCc7XG5cbiAgICBpZih0YXJnZXRJc09iamVjdCAmJiB3ZWFrTWFwLmhhcyh0YXJnZXQpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGUgPSBmdW5jdGlvbih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpe1xuICAgICAgICBpZihldmVudEtleSAhPT0gJyonICYmIHR5cGVvZiBvYmplY3RbZXZlbnRLZXldID09PSAnb2JqZWN0JyAmJiBvYmplY3RbZXZlbnRLZXldICE9PSB0YXJnZXQpe1xuICAgICAgICAgICAgaWYodGFyZ2V0SXNPYmplY3Qpe1xuICAgICAgICAgICAgICAgIHdlYWtNYXAuZGVsZXRlKHRhcmdldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW1vdmVIYW5kbGVyKG9iamVjdCwgZXZlbnRLZXksIGhhbmRsZSk7XG4gICAgICAgICAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihldmVudEtleSA9PT0gJyonKXtcbiAgICAgICAgICAgIHRyYWNrS2V5cyhvYmplY3QsIGtleSwgcGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZighd2Vha01hcC5oYXMob2JqZWN0KSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihrZXkgIT09ICcqKicgfHwgIXBhdGgpe1xuICAgICAgICAgICAgaGFuZGxlcih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdHJhY2tLZXlzKHRhcmdldCwgcm9vdCwgcmVzdCl7XG4gICAgICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXModGFyZ2V0KTtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoaXNGZXJhbGNhcmRLZXkocm9vdCkpe1xuICAgICAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIHRhcmdldCwga2V5c1tpXSwgJyoqJyArIChyZXN0ID8gJy4nIDogJycpICsgKHJlc3QgfHwgJycpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIHRhcmdldCwga2V5c1tpXSwgcmVzdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRIYW5kbGVyKG9iamVjdCwgZXZlbnRLZXksIGhhbmRsZSk7XG5cbiAgICBpZighdGFyZ2V0SXNPYmplY3Qpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhpcyB3b3VsZCBvYnZpb3VzbHkgYmUgYmV0dGVyIGltcGxlbWVudGVkIHdpdGggYSBXZWFrU2V0LFxuICAgIC8vIEJ1dCBJJ20gdHJ5aW5nIHRvIGtlZXAgZmlsZXNpemUgZG93biwgYW5kIEkgZG9uJ3QgcmVhbGx5IHdhbnQgYW5vdGhlclxuICAgIC8vIHBvbHlmaWxsIHdoZW4gV2Vha01hcCB3b3JrcyB3ZWxsIGVub3VnaCBmb3IgdGhlIHRhc2suXG4gICAgd2Vha01hcC5zZXQodGFyZ2V0LCBudWxsKTtcblxuICAgIGlmKCFwYXRoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciByb290QW5kUmVzdCA9IGxlZnRBbmRSZXN0KHBhdGgpLFxuICAgICAgICByb290LFxuICAgICAgICByZXN0O1xuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkocm9vdEFuZFJlc3QpKXtcbiAgICAgICAgcm9vdCA9IHJvb3RBbmRSZXN0O1xuICAgIH1lbHNle1xuICAgICAgICByb290ID0gcm9vdEFuZFJlc3RbMF07XG4gICAgICAgIHJlc3QgPSByb290QW5kUmVzdFsxXTtcblxuICAgICAgICAvLyBJZiB0aGUgcm9vdCBpcyAnLicsIHdhdGNoIGZvciBldmVudHMgb24gKlxuICAgICAgICBpZihyb290ID09PSAnLicpe1xuICAgICAgICAgICAgcm9vdCA9ICcqJztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIGlzV2lsZGNhcmRLZXkocm9vdCkpe1xuICAgICAgICB0cmFja0tleXModGFyZ2V0LCByb290LCByZXN0KTtcbiAgICB9XG5cbiAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCB0YXJnZXQsIHJvb3QsIHJlc3QpO1xufVxuXG52YXIgdHJhY2tlZEV2ZW50cyA9IG5ldyBXZWFrTWFwKCk7XG5cbmZ1bmN0aW9uIHRyYWNrUGF0aChlbnRpLCBldmVudE5hbWUpe1xuICAgIHZhciBvYmplY3QgPSBlbnRpLl9tb2RlbCxcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzID0gdHJhY2tlZEV2ZW50cy5nZXQob2JqZWN0KTtcblxuICAgIGlmKCF0cmFja2VkT2JqZWN0UGF0aHMpe1xuICAgICAgICB0cmFja2VkT2JqZWN0UGF0aHMgPSB7fTtcbiAgICAgICAgdHJhY2tlZEV2ZW50cy5zZXQob2JqZWN0LCB0cmFja2VkT2JqZWN0UGF0aHMpO1xuICAgIH1cblxuICAgIHZhciB0cmFja2VkUGF0aHMgPSB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXTtcblxuICAgIGlmKCF0cmFja2VkUGF0aHMpe1xuICAgICAgICB0cmFja2VkUGF0aHMgPSB7XG4gICAgICAgICAgICBlbnRpczogbmV3IFNldCgpLFxuICAgICAgICAgICAgdHJhY2tlZE9iamVjdHM6IG5ldyBXZWFrTWFwKClcbiAgICAgICAgfTtcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV0gPSB0cmFja2VkUGF0aHM7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZFBhdGhzLmVudGlzLmhhcyhlbnRpKSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cmFja2VkUGF0aHMuZW50aXMuYWRkKGVudGkpO1xuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpe1xuICAgICAgICB0cmFja2VkUGF0aHMuZW50aXMuZm9yRWFjaChmdW5jdGlvbihlbnRpKXtcbiAgICAgICAgICAgIGlmKGVudGkuX21vZGVsICE9PSBvYmplY3Qpe1xuICAgICAgICAgICAgICAgIHRyYWNrZWRQYXRocy5lbnRpcy5kZWxldGUoZW50aSk7XG4gICAgICAgICAgICAgICAgaWYodHJhY2tlZFBhdGhzLmVudGlzLnNpemUgPT09IDApe1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV07XG4gICAgICAgICAgICAgICAgICAgIGlmKCFPYmplY3Qua2V5cyh0cmFja2VkT2JqZWN0UGF0aHMpLmxlbmd0aCl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFja2VkRXZlbnRzLmRlbGV0ZShvYmplY3QpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGVudGkuX2VtaXR0ZWRFdmVudHNbZXZlbnROYW1lXSA9PT0gZW1pdEtleSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZW50aS5fZW1pdHRlZEV2ZW50c1tldmVudE5hbWVdID0gZW1pdEtleTtcblxuICAgICAgICAgICAgaWYoaXNEZWVwKGV2ZW50TmFtZSkgJiYgKGlzRmlsdGVyUGF0aChldmVudE5hbWUpIHx8ICFpc1dpbGRjYXJkUGF0aChldmVudE5hbWUpKSl7XG4gICAgICAgICAgICAgICAgZW50aS5lbWl0KGV2ZW50TmFtZSwgZW50aS5nZXQoZ2V0VGFyZ2V0S2V5KGV2ZW50TmFtZSkpLCBldmVudCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBlbnRpLmVtaXQoZXZlbnROYW1lLCB2YWx1ZSwgZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB0cmFja2VkUGF0aHMudHJhY2tlZE9iamVjdHMsIGhhbmRsZXIsIHttb2RlbDpvYmplY3R9LCAnbW9kZWwnLCBldmVudE5hbWUpO1xufVxuXG5mdW5jdGlvbiB0cmFja1BhdGhzKGVudGksIHRhcmdldCl7XG4gICAgaWYoIWVudGkuX2V2ZW50cyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGVudGkuX2V2ZW50cyksXG4gICAgICAgIGtleTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGtleSA9IGtleXNbaV0sIGkgPCBrZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgLy8gQmFpbG91dCBpZiB0aGUgZXZlbnQgaXMgYSBzaW5nbGUga2V5LFxuICAgICAgICAvLyBhbmQgdGhlIHRhcmdldCBpc250IHRoZSBzYW1lIGFzIHRoZSBlbnRpcyBfbW9kZWxcbiAgICAgICAgaWYoZW50aS5fbW9kZWwgIT09IHRhcmdldCAmJiAhaXNEZWVwKGtleSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICB0cmFja1BhdGgoZW50aSwga2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGVtaXRFdmVudChvYmplY3QsIGtleSwgdmFsdWUsIGVtaXRLZXkpe1xuXG4gICAgYXR0YWNoZWRFbnRpZXMuZm9yRWFjaChmdW5jdGlvbihlbnRpKXtcbiAgICAgICAgdHJhY2tQYXRocyhlbnRpLCBvYmplY3QpO1xuICAgIH0pO1xuXG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZighdHJhY2tlZEtleXMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50ID0ge1xuICAgICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICAgIGtleToga2V5LFxuICAgICAgICBvYmplY3Q6IG9iamVjdFxuICAgIH07XG5cbiAgICBpZih0cmFja2VkS2V5c1trZXldKXtcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XS5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZXIpe1xuICAgICAgICAgICAgaWYodHJhY2tlZEtleXNba2V5XS5oYXMoaGFuZGxlcikpe1xuICAgICAgICAgICAgICAgIGhhbmRsZXIodmFsdWUsIGV2ZW50LCBlbWl0S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZEtleXNbJyonXSl7XG4gICAgICAgIHRyYWNrZWRLZXlzWycqJ10uZm9yRWFjaChmdW5jdGlvbihoYW5kbGVyKXtcbiAgICAgICAgICAgIGlmKHRyYWNrZWRLZXlzWycqJ10uaGFzKGhhbmRsZXIpKXtcbiAgICAgICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW1pdChldmVudHMpe1xuICAgIHZhciBlbWl0S2V5ID0ge307XG4gICAgZXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBlbWl0RXZlbnQoZXZlbnRbMF0sIGV2ZW50WzFdLCBldmVudFsyXSwgZW1pdEtleSk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIEVudGkobW9kZWwpe1xuICAgIHZhciBkZXRhY2hlZCA9IG1vZGVsID09PSBmYWxzZTtcblxuICAgIGlmKCFtb2RlbCB8fCAodHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kZWwgIT09ICdmdW5jdGlvbicpKXtcbiAgICAgICAgbW9kZWwgPSB7fTtcbiAgICB9XG5cbiAgICB0aGlzLl9lbWl0dGVkRXZlbnRzID0ge307XG4gICAgaWYoZGV0YWNoZWQpe1xuICAgICAgICB0aGlzLl9tb2RlbCA9IHt9O1xuICAgIH1lbHNle1xuICAgICAgICB0aGlzLmF0dGFjaChtb2RlbCk7XG4gICAgfVxufVxuRW50aS5nZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBrZXkgPSBnZXRUYXJnZXRLZXkoa2V5KTtcblxuICAgIGlmKGtleSA9PT0gJy4nKXtcbiAgICAgICAgcmV0dXJuIG1vZGVsO1xuICAgIH1cblxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5nZXQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0pO1xuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFtrZXldO1xufTtcbkVudGkuc2V0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBcbiAgICBrZXkgPSBnZXRUYXJnZXRLZXkoa2V5KTtcblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkuc2V0KG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgdmFyIG9yaWdpbmFsID0gbW9kZWxba2V5XTtcblxuICAgIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcgJiYgdmFsdWUgPT09IG9yaWdpbmFsKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBrZXlzQ2hhbmdlZCA9ICEoa2V5IGluIG1vZGVsKTtcblxuICAgIG1vZGVsW2tleV0gPSB2YWx1ZTtcblxuICAgIHZhciBldmVudHMgPSBbW21vZGVsLCBrZXksIHZhbHVlXV07XG5cbiAgICBpZihrZXlzQ2hhbmdlZCl7XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkobW9kZWwpKXtcbiAgICAgICAgICAgIGV2ZW50cy5wdXNoKFttb2RlbCwgJ2xlbmd0aCcsIG1vZGVsLmxlbmd0aF0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkucHVzaCA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHZhbHVlKXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0O1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPCAzKXtcbiAgICAgICAgdmFsdWUgPSBrZXk7XG4gICAgICAgIGtleSA9ICcuJztcbiAgICAgICAgdGFyZ2V0ID0gbW9kZWw7XG4gICAgfWVsc2V7XG4gICAgICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgICAgICByZXR1cm4gRW50aS5wdXNoKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCB2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0YXJnZXQgPSBtb2RlbFtrZXldO1xuICAgIH1cblxuICAgIGlmKCFBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICB0aHJvdyAnVGhlIHRhcmdldCBpcyBub3QgYW4gYXJyYXkuJztcbiAgICB9XG5cbiAgICB0YXJnZXQucHVzaCh2YWx1ZSk7XG5cbiAgICB2YXIgZXZlbnRzID0gW1xuICAgICAgICBbdGFyZ2V0LCB0YXJnZXQubGVuZ3RoLTEsIHZhbHVlXSxcbiAgICAgICAgW3RhcmdldCwgJ2xlbmd0aCcsIHRhcmdldC5sZW5ndGhdXG4gICAgXTtcblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLmluc2VydCA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHZhbHVlLCBpbmRleCl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG5cbiAgICB2YXIgdGFyZ2V0O1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPCA0KXtcbiAgICAgICAgaW5kZXggPSB2YWx1ZTtcbiAgICAgICAgdmFsdWUgPSBrZXk7XG4gICAgICAgIGtleSA9ICcuJztcbiAgICAgICAgdGFyZ2V0ID0gbW9kZWw7XG4gICAgfWVsc2V7XG4gICAgICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgICAgICByZXR1cm4gRW50aS5pbnNlcnQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlLCBpbmRleCk7XG4gICAgICAgIH1cblxuICAgICAgICB0YXJnZXQgPSBtb2RlbFtrZXldO1xuICAgIH1cblxuICAgIGlmKCFBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICB0aHJvdyAnVGhlIHRhcmdldCBpcyBub3QgYW4gYXJyYXkuJztcbiAgICB9XG5cbiAgICB0YXJnZXQuc3BsaWNlKGluZGV4LCAwLCB2YWx1ZSk7XG5cbiAgICB2YXIgZXZlbnRzID0gW1xuICAgICAgICBbdGFyZ2V0LCBpbmRleCwgdmFsdWVdLFxuICAgICAgICBbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF1cbiAgICBdO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkucmVtb3ZlID0gZnVuY3Rpb24obW9kZWwsIGtleSwgc3ViS2V5KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgIHJldHVybiBFbnRpLnJlbW92ZShtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgc3ViS2V5KTtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgYSBrZXkgb2ZmIG9mIGFuIG9iamVjdCBhdCAna2V5J1xuICAgIGlmKHN1YktleSAhPSBudWxsKXtcbiAgICAgICAgRW50aS5yZW1vdmUobW9kZWxba2V5XSwgc3ViS2V5KTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKGtleSA9PT0gJy4nKXtcbiAgICAgICAgdGhyb3cgJy4gKHNlbGYpIGlzIG5vdCBhIHZhbGlkIGtleSB0byByZW1vdmUnO1xuICAgIH1cblxuICAgIHZhciBldmVudHMgPSBbXTtcblxuICAgIGlmKEFycmF5LmlzQXJyYXkobW9kZWwpKXtcbiAgICAgICAgbW9kZWwuc3BsaWNlKGtleSwgMSk7XG4gICAgICAgIGV2ZW50cy5wdXNoKFttb2RlbCwgJ2xlbmd0aCcsIG1vZGVsLmxlbmd0aF0pO1xuICAgIH1lbHNle1xuICAgICAgICBkZWxldGUgbW9kZWxba2V5XTtcbiAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCBrZXldKTtcbiAgICB9XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5tb3ZlID0gZnVuY3Rpb24obW9kZWwsIGtleSwgaW5kZXgpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkubW92ZShtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgaW5kZXgpO1xuICAgIH1cblxuICAgIHZhciBtb2RlbCA9IG1vZGVsO1xuXG4gICAgaWYoa2V5ID09PSBpbmRleCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZighQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICB0aHJvdyAnVGhlIG1vZGVsIGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHZhciBpdGVtID0gbW9kZWxba2V5XTtcblxuICAgIG1vZGVsLnNwbGljZShrZXksIDEpO1xuXG4gICAgbW9kZWwuc3BsaWNlKGluZGV4IC0gKGluZGV4ID4ga2V5ID8gMCA6IDEpLCAwLCBpdGVtKTtcblxuICAgIGVtaXQoW1ttb2RlbCwgaW5kZXgsIGl0ZW1dXSk7XG59O1xuRW50aS51cGRhdGUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldCxcbiAgICAgICAgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkodmFsdWUpO1xuXG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnVwZGF0ZShtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcblxuICAgICAgICBpZih0YXJnZXQgPT0gbnVsbCl7XG4gICAgICAgICAgICBtb2RlbFtrZXldID0gaXNBcnJheSA/IFtdIDoge307XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgdGhyb3cgJ1RoZSB2YWx1ZSBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIHRhcmdldCAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnVGhlIHRhcmdldCBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgZnVuY3Rpb24gdXBkYXRlVGFyZ2V0KHRhcmdldCwgdmFsdWUpe1xuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBpZih0YXJnZXRba2V5XSAmJiB0eXBlb2YgdGFyZ2V0W2tleV0gPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICB1cGRhdGVUYXJnZXQodGFyZ2V0W2tleV0sIHZhbHVlW2tleV0pO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGFyZ2V0W2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwga2V5LCB2YWx1ZVtrZXldXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwgJ2xlbmd0aCcsIHRhcmdldC5sZW5ndGhdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZVRhcmdldCh0YXJnZXQsIHZhbHVlKTtcblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5FbnRpLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEVudGk7XG5FbnRpLnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihtb2RlbCl7XG4gICAgaWYodGhpcy5fbW9kZWwgIT09IG1vZGVsKXtcbiAgICAgICAgdGhpcy5kZXRhY2goKTtcbiAgICB9XG5cbiAgICBpZighYXR0YWNoZWRFbnRpZXMuaGFzKHRoaXMpKXtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuYWRkKHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLl9hdHRhY2hlZCA9IHRydWU7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbDtcbn07XG5FbnRpLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpe1xuICAgIGlmKGF0dGFjaGVkRW50aWVzLmhhcyh0aGlzKSl7XG4gICAgICAgIGF0dGFjaGVkRW50aWVzLmRlbGV0ZSh0aGlzKTtcbiAgICB9XG5cbiAgICB0aGlzLl9lbWl0dGVkRXZlbnRzID0ge307XG4gICAgdGhpcy5fbW9kZWwgPSB7fTtcbiAgICB0aGlzLl9hdHRhY2hlZCA9IGZhbHNlO1xufTtcbkVudGkucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xuICAgIHRoaXMuZGV0YWNoKCk7XG4gICAgdGhpcy5fZXZlbnRzID0gbnVsbDtcbn1cbkVudGkucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgcmV0dXJuIEVudGkuZ2V0KHRoaXMuX21vZGVsLCBrZXkpO1xufTtcblxuRW50aS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgcmV0dXJuIEVudGkuc2V0KHRoaXMuX21vZGVsLCBrZXksIHZhbHVlKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICByZXR1cm4gRW50aS5wdXNoLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLmluc2VydC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGtleSwgc3ViS2V5KXtcbiAgICByZXR1cm4gRW50aS5yZW1vdmUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5tb3ZlID0gZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgcmV0dXJuIEVudGkubW92ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLnVwZGF0ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5FbnRpLnByb3RvdHlwZS5pc0F0dGFjaGVkID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gdGhpcy5fYXR0YWNoZWQ7XG59O1xuRW50aS5wcm90b3R5cGUuYXR0YWNoZWRDb3VudCA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIGF0dGFjaGVkRW50aWVzLnNpemU7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVudGk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTZXQgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc2V0LCBpdGVyYXRvciwgcmVzdWx0O1xuXHRpZiAodHlwZW9mIFNldCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzZXQgPSBuZXcgU2V0KFsncmF6JywgJ2R3YScsICd0cnp5J10pO1xuXHRpZiAoc2V0LnNpemUgIT09IDMpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuYWRkICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmNsZWFyICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmRlbGV0ZSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5lbnRyaWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuaGFzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmtleXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQudmFsdWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cblx0aXRlcmF0b3IgPSBzZXQudmFsdWVzKCk7XG5cdHJlc3VsdCA9IGl0ZXJhdG9yLm5leHQoKTtcblx0aWYgKHJlc3VsdC5kb25lICE9PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuXHRpZiAocmVzdWx0LnZhbHVlICE9PSAncmF6JykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIvLyBFeHBvcnRzIHRydWUgaWYgZW52aXJvbm1lbnQgcHJvdmlkZXMgbmF0aXZlIGBTZXRgIGltcGxlbWVudGF0aW9uLFxuLy8gd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgU2V0ID09PSAndW5kZWZpbmVkJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChTZXQucHJvdG90eXBlKSA9PT0gJ1tvYmplY3QgU2V0XScpO1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY29udGFpbnMgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcbiAgLCBkICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yJylcbiAgLCB0b1N0cmluZ1RhZ1N5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS50b1N0cmluZ1RhZ1xuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTZXRJdGVyYXRvcjtcblxuU2V0SXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZXQsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFNldEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBTZXRJdGVyYXRvcihzZXQsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIHNldC5fX3NldERhdGFfXywgc2V0KTtcblx0aWYgKCFraW5kKSBraW5kID0gJ3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5K3ZhbHVlJykpIGtpbmQgPSAna2V5K3ZhbHVlJztcblx0ZWxzZSBraW5kID0gJ3ZhbHVlJztcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fa2luZF9fJywgZCgnJywga2luZCkpO1xufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU2V0SXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuU2V0SXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU2V0SXRlcmF0b3IpLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAndmFsdWUnKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRyZXR1cm4gW3RoaXMuX19saXN0X19baV0sIHRoaXMuX19saXN0X19baV1dO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgU2V0IEl0ZXJhdG9yXSc7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFNldEl0ZXJhdG9yLnByb3RvdHlwZSwgdG9TdHJpbmdUYWdTeW1ib2wsXG5cdGQoJ2MnLCAnU2V0IEl0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY29weSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2NvcHknKVxuICAsIG1hcCAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9tYXAnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcblxuICAsIGJpbmQgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZWZpbmU7XG5cbmRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXNjLCBiaW5kVG8pIHtcblx0dmFyIHZhbHVlID0gdmFsaWRWYWx1ZShkZXNjKSAmJiBjYWxsYWJsZShkZXNjLnZhbHVlKSwgZGdzO1xuXHRkZ3MgPSBjb3B5KGRlc2MpO1xuXHRkZWxldGUgZGdzLndyaXRhYmxlO1xuXHRkZWxldGUgZGdzLnZhbHVlO1xuXHRkZ3MuZ2V0ID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpKSByZXR1cm4gdmFsdWU7XG5cdFx0ZGVzYy52YWx1ZSA9IGJpbmQuY2FsbCh2YWx1ZSwgKGJpbmRUbyA9PSBudWxsKSA/IHRoaXMgOiB0aGlzW2JpbmRUb10pO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGRlc2MpO1xuXHRcdHJldHVybiB0aGlzW25hbWVdO1xuXHR9O1xuXHRyZXR1cm4gZGdzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAocHJvcHMvKiwgYmluZFRvKi8pIHtcblx0dmFyIGJpbmRUbyA9IGFyZ3VtZW50c1sxXTtcblx0cmV0dXJuIG1hcChwcm9wcywgZnVuY3Rpb24gKGRlc2MsIG5hbWUpIHtcblx0XHRyZXR1cm4gZGVmaW5lKG5hbWUsIGRlc2MsIGJpbmRUbyk7XG5cdH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIG5vcm1hbGl6ZU9wdHMgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucycpXG4gICwgaXNDYWxsYWJsZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlJylcbiAgLCBjb250YWlucyAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG5cbiAgLCBkO1xuXG5kID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZHNjciwgdmFsdWUvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCB3LCBvcHRpb25zLCBkZXNjO1xuXHRpZiAoKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB8fCAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSkge1xuXHRcdG9wdGlvbnMgPSB2YWx1ZTtcblx0XHR2YWx1ZSA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1syXTtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHcgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdFx0dyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ3cnKTtcblx0fVxuXG5cdGRlc2MgPSB7IHZhbHVlOiB2YWx1ZSwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlLCB3cml0YWJsZTogdyB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcblxuZC5ncyA9IGZ1bmN0aW9uIChkc2NyLCBnZXQsIHNldC8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IGdldDtcblx0XHRnZXQgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbM107XG5cdH1cblx0aWYgKGdldCA9PSBudWxsKSB7XG5cdFx0Z2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKGdldCkpIHtcblx0XHRvcHRpb25zID0gZ2V0O1xuXHRcdGdldCA9IHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmIChzZXQgPT0gbnVsbCkge1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShzZXQpKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdH1cblxuXHRkZXNjID0geyBnZXQ6IGdldCwgc2V0OiBzZXQsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcbiIsIi8vIEluc3BpcmVkIGJ5IEdvb2dsZSBDbG9zdXJlOlxuLy8gaHR0cDovL2Nsb3N1cmUtbGlicmFyeS5nb29nbGVjb2RlLmNvbS9zdm4vZG9jcy9cbi8vIGNsb3N1cmVfZ29vZ19hcnJheV9hcnJheS5qcy5odG1sI2dvb2cuYXJyYXkuY2xlYXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmFsdWUgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhbHVlKHRoaXMpLmxlbmd0aCA9IDA7XG5cdHJldHVybiB0aGlzO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvUG9zSW50ID0gcmVxdWlyZSgnLi4vLi4vbnVtYmVyL3RvLXBvcy1pbnRlZ2VyJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJy4uLy4uL29iamVjdC92YWxpZC12YWx1ZScpXG5cbiAgLCBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2ZcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBhYnMgPSBNYXRoLmFicywgZmxvb3IgPSBNYXRoLmZsb29yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hFbGVtZW50LyosIGZyb21JbmRleCovKSB7XG5cdHZhciBpLCBsLCBmcm9tSW5kZXgsIHZhbDtcblx0aWYgKHNlYXJjaEVsZW1lbnQgPT09IHNlYXJjaEVsZW1lbnQpIHsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdHJldHVybiBpbmRleE9mLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG5cdH1cblxuXHRsID0gdG9Qb3NJbnQodmFsdWUodGhpcykubGVuZ3RoKTtcblx0ZnJvbUluZGV4ID0gYXJndW1lbnRzWzFdO1xuXHRpZiAoaXNOYU4oZnJvbUluZGV4KSkgZnJvbUluZGV4ID0gMDtcblx0ZWxzZSBpZiAoZnJvbUluZGV4ID49IDApIGZyb21JbmRleCA9IGZsb29yKGZyb21JbmRleCk7XG5cdGVsc2UgZnJvbUluZGV4ID0gdG9Qb3NJbnQodGhpcy5sZW5ndGgpIC0gZmxvb3IoYWJzKGZyb21JbmRleCkpO1xuXG5cdGZvciAoaSA9IGZyb21JbmRleDsgaSA8IGw7ICsraSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIGkpKSB7XG5cdFx0XHR2YWwgPSB0aGlzW2ldO1xuXHRcdFx0aWYgKHZhbCAhPT0gdmFsKSByZXR1cm4gaTsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdH1cblx0fVxuXHRyZXR1cm4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gTWF0aC5zaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc2lnbiA9IE1hdGguc2lnbjtcblx0aWYgKHR5cGVvZiBzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHNpZ24oMTApID09PSAxKSAmJiAoc2lnbigtMjApID09PSAtMSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0dmFsdWUgPSBOdW1iZXIodmFsdWUpO1xuXHRpZiAoaXNOYU4odmFsdWUpIHx8ICh2YWx1ZSA9PT0gMCkpIHJldHVybiB2YWx1ZTtcblx0cmV0dXJuICh2YWx1ZSA+IDApID8gMSA6IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNpZ24gPSByZXF1aXJlKCcuLi9tYXRoL3NpZ24nKVxuXG4gICwgYWJzID0gTWF0aC5hYnMsIGZsb29yID0gTWF0aC5mbG9vcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKGlzTmFOKHZhbHVlKSkgcmV0dXJuIDA7XG5cdHZhbHVlID0gTnVtYmVyKHZhbHVlKTtcblx0aWYgKCh2YWx1ZSA9PT0gMCkgfHwgIWlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuXHRyZXR1cm4gc2lnbih2YWx1ZSkgKiBmbG9vcihhYnModmFsdWUpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b0ludGVnZXIgPSByZXF1aXJlKCcuL3RvLWludGVnZXInKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7IHJldHVybiBtYXgoMCwgdG9JbnRlZ2VyKHZhbHVlKSk7IH07XG4iLCIvLyBJbnRlcm5hbCBtZXRob2QsIHVzZWQgYnkgaXRlcmF0aW9uIGZ1bmN0aW9ucy5cbi8vIENhbGxzIGEgZnVuY3Rpb24gZm9yIGVhY2gga2V5LXZhbHVlIHBhaXIgZm91bmQgaW4gb2JqZWN0XG4vLyBPcHRpb25hbGx5IHRha2VzIGNvbXBhcmVGbiB0byBpdGVyYXRlIG9iamVjdCBpbiBzcGVjaWZpYyBvcmRlclxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc0NhbGxhYmxlID0gcmVxdWlyZSgnLi9pcy1jYWxsYWJsZScpXG4gICwgY2FsbGFibGUgICA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbHVlICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwga2V5cyA9IE9iamVjdC5rZXlzXG4gICwgcHJvcGVydHlJc0VudW1lcmFibGUgPSBPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChtZXRob2QsIGRlZlZhbCkge1xuXHRyZXR1cm4gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZywgY29tcGFyZUZuKi8pIHtcblx0XHR2YXIgbGlzdCwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgY29tcGFyZUZuID0gYXJndW1lbnRzWzNdO1xuXHRcdG9iaiA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0XHRjYWxsYWJsZShjYik7XG5cblx0XHRsaXN0ID0ga2V5cyhvYmopO1xuXHRcdGlmIChjb21wYXJlRm4pIHtcblx0XHRcdGxpc3Quc29ydChpc0NhbGxhYmxlKGNvbXBhcmVGbikgPyBjb21wYXJlRm4uYmluZChvYmopIDogdW5kZWZpbmVkKTtcblx0XHR9XG5cdFx0cmV0dXJuIGxpc3RbbWV0aG9kXShmdW5jdGlvbiAoa2V5LCBpbmRleCkge1xuXHRcdFx0aWYgKCFwcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iaiwga2V5KSkgcmV0dXJuIGRlZlZhbDtcblx0XHRcdHJldHVybiBjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIG9ialtrZXldLCBrZXksIG9iaiwgaW5kZXgpO1xuXHRcdH0pO1xuXHR9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5hc3NpZ25cblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBhc3NpZ24gPSBPYmplY3QuYXNzaWduLCBvYmo7XG5cdGlmICh0eXBlb2YgYXNzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdG9iaiA9IHsgZm9vOiAncmF6JyB9O1xuXHRhc3NpZ24ob2JqLCB7IGJhcjogJ2R3YScgfSwgeyB0cnp5OiAndHJ6eScgfSk7XG5cdHJldHVybiAob2JqLmZvbyArIG9iai5iYXIgKyBvYmoudHJ6eSkgPT09ICdyYXpkd2F0cnp5Jztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzICA9IHJlcXVpcmUoJy4uL2tleXMnKVxuICAsIHZhbHVlID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRlc3QsIHNyYy8qLCDigKZzcmNuKi8pIHtcblx0dmFyIGVycm9yLCBpLCBsID0gbWF4KGFyZ3VtZW50cy5sZW5ndGgsIDIpLCBhc3NpZ247XG5cdGRlc3QgPSBPYmplY3QodmFsdWUoZGVzdCkpO1xuXHRhc3NpZ24gPSBmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dHJ5IHsgZGVzdFtrZXldID0gc3JjW2tleV07IH0gY2F0Y2ggKGUpIHtcblx0XHRcdGlmICghZXJyb3IpIGVycm9yID0gZTtcblx0XHR9XG5cdH07XG5cdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIHtcblx0XHRzcmMgPSBhcmd1bWVudHNbaV07XG5cdFx0a2V5cyhzcmMpLmZvckVhY2goYXNzaWduKTtcblx0fVxuXHRpZiAoZXJyb3IgIT09IHVuZGVmaW5lZCkgdGhyb3cgZXJyb3I7XG5cdHJldHVybiBkZXN0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiA9IHJlcXVpcmUoJy4vYXNzaWduJylcbiAgLCB2YWx1ZSAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuXHR2YXIgY29weSA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0aWYgKGNvcHkgIT09IG9iaikgcmV0dXJuIGNvcHk7XG5cdHJldHVybiBhc3NpZ24oe30sIG9iaik7XG59O1xuIiwiLy8gV29ya2Fyb3VuZCBmb3IgaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9MjgwNFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBzaGltO1xuXG5pZiAoIXJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZCcpKCkpIHtcblx0c2hpbSA9IHJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9zaGltJyk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIG51bGxPYmplY3QsIHByb3BzLCBkZXNjO1xuXHRpZiAoIXNoaW0pIHJldHVybiBjcmVhdGU7XG5cdGlmIChzaGltLmxldmVsICE9PSAxKSByZXR1cm4gY3JlYXRlO1xuXG5cdG51bGxPYmplY3QgPSB7fTtcblx0cHJvcHMgPSB7fTtcblx0ZGVzYyA9IHsgY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfTtcblx0T2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoT2JqZWN0LnByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuXHRcdGlmIChuYW1lID09PSAnX19wcm90b19fJykge1xuXHRcdFx0cHJvcHNbbmFtZV0gPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdFx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHByb3BzW25hbWVdID0gZGVzYztcblx0fSk7XG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKG51bGxPYmplY3QsIHByb3BzKTtcblxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoc2hpbSwgJ251bGxQb2x5ZmlsbCcsIHsgY29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IGZhbHNlLCB2YWx1ZTogbnVsbE9iamVjdCB9KTtcblxuXHRyZXR1cm4gZnVuY3Rpb24gKHByb3RvdHlwZSwgcHJvcHMpIHtcblx0XHRyZXR1cm4gY3JlYXRlKChwcm90b3R5cGUgPT09IG51bGwpID8gbnVsbE9iamVjdCA6IHByb3RvdHlwZSwgcHJvcHMpO1xuXHR9O1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL19pdGVyYXRlJykoJ2ZvckVhY2gnKTtcbiIsIi8vIERlcHJlY2F0ZWRcblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHsgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbic7IH07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBtYXAgPSB7IGZ1bmN0aW9uOiB0cnVlLCBvYmplY3Q6IHRydWUgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKCh4ICE9IG51bGwpICYmIG1hcFt0eXBlb2YgeF0pIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5rZXlzXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR0cnkge1xuXHRcdE9iamVjdC5rZXlzKCdwcmltaXRpdmUnKTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzID0gT2JqZWN0LmtleXM7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iamVjdCkge1xuXHRyZXR1cm4ga2V5cyhvYmplY3QgPT0gbnVsbCA/IG9iamVjdCA6IE9iamVjdChvYmplY3QpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjYWxsYWJsZSA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIGZvckVhY2ggID0gcmVxdWlyZSgnLi9mb3ItZWFjaCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZyovKSB7XG5cdHZhciBvID0ge30sIHRoaXNBcmcgPSBhcmd1bWVudHNbMl07XG5cdGNhbGxhYmxlKGNiKTtcblx0Zm9yRWFjaChvYmosIGZ1bmN0aW9uICh2YWx1ZSwga2V5LCBvYmosIGluZGV4KSB7XG5cdFx0b1trZXldID0gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwga2V5LCBvYmosIGluZGV4KTtcblx0fSk7XG5cdHJldHVybiBvO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZTtcblxudmFyIHByb2Nlc3MgPSBmdW5jdGlvbiAoc3JjLCBvYmopIHtcblx0dmFyIGtleTtcblx0Zm9yIChrZXkgaW4gc3JjKSBvYmpba2V5XSA9IHNyY1trZXldO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucy8qLCDigKZvcHRpb25zKi8pIHtcblx0dmFyIHJlc3VsdCA9IGNyZWF0ZShudWxsKTtcblx0Zm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24gKG9wdGlvbnMpIHtcblx0XHRpZiAob3B0aW9ucyA9PSBudWxsKSByZXR1cm47XG5cdFx0cHJvY2VzcyhPYmplY3Qob3B0aW9ucyksIHJlc3VsdCk7XG5cdH0pO1xuXHRyZXR1cm4gcmVzdWx0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5zZXRQcm90b3R5cGVPZlxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZ2V0UHJvdG90eXBlT2YgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2ZcbiAgLCB4ID0ge307XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKC8qY3VzdG9tQ3JlYXRlKi8pIHtcblx0dmFyIHNldFByb3RvdHlwZU9mID0gT2JqZWN0LnNldFByb3RvdHlwZU9mXG5cdCAgLCBjdXN0b21DcmVhdGUgPSBhcmd1bWVudHNbMF0gfHwgY3JlYXRlO1xuXHRpZiAodHlwZW9mIHNldFByb3RvdHlwZU9mICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiBnZXRQcm90b3R5cGVPZihzZXRQcm90b3R5cGVPZihjdXN0b21DcmVhdGUobnVsbCksIHgpKSA9PT0geDtcbn07XG4iLCIvLyBCaWcgdGhhbmtzIHRvIEBXZWJSZWZsZWN0aW9uIGZvciBzb3J0aW5nIHRoaXMgb3V0XG4vLyBodHRwczovL2dpc3QuZ2l0aHViLmNvbS9XZWJSZWZsZWN0aW9uLzU1OTM1NTRcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNPYmplY3QgICAgICA9IHJlcXVpcmUoJy4uL2lzLW9iamVjdCcpXG4gICwgdmFsdWUgICAgICAgICA9IHJlcXVpcmUoJy4uL3ZhbGlkLXZhbHVlJylcblxuICAsIGlzUHJvdG90eXBlT2YgPSBPYmplY3QucHJvdG90eXBlLmlzUHJvdG90eXBlT2ZcbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIG51bGxEZXNjID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHR2YWx1ZTogdW5kZWZpbmVkIH1cbiAgLCB2YWxpZGF0ZTtcblxudmFsaWRhdGUgPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0dmFsdWUob2JqKTtcblx0aWYgKChwcm90b3R5cGUgPT09IG51bGwpIHx8IGlzT2JqZWN0KHByb3RvdHlwZSkpIHJldHVybiBvYmo7XG5cdHRocm93IG5ldyBUeXBlRXJyb3IoJ1Byb3RvdHlwZSBtdXN0IGJlIG51bGwgb3IgYW4gb2JqZWN0Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoc3RhdHVzKSB7XG5cdHZhciBmbiwgc2V0O1xuXHRpZiAoIXN0YXR1cykgcmV0dXJuIG51bGw7XG5cdGlmIChzdGF0dXMubGV2ZWwgPT09IDIpIHtcblx0XHRpZiAoc3RhdHVzLnNldCkge1xuXHRcdFx0c2V0ID0gc3RhdHVzLnNldDtcblx0XHRcdGZuID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHRcdHNldC5jYWxsKHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKSwgcHJvdG90eXBlKTtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH07XG5cdFx0fSBlbHNlIHtcblx0XHRcdGZuID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHRcdHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKS5fX3Byb3RvX18gPSBwcm90b3R5cGU7XG5cdFx0XHRcdHJldHVybiBvYmo7XG5cdFx0XHR9O1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRmbiA9IGZ1bmN0aW9uIHNlbGYob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdHZhciBpc051bGxCYXNlO1xuXHRcdFx0dmFsaWRhdGUob2JqLCBwcm90b3R5cGUpO1xuXHRcdFx0aXNOdWxsQmFzZSA9IGlzUHJvdG90eXBlT2YuY2FsbChzZWxmLm51bGxQb2x5ZmlsbCwgb2JqKTtcblx0XHRcdGlmIChpc051bGxCYXNlKSBkZWxldGUgc2VsZi5udWxsUG9seWZpbGwuX19wcm90b19fO1xuXHRcdFx0aWYgKHByb3RvdHlwZSA9PT0gbnVsbCkgcHJvdG90eXBlID0gc2VsZi5udWxsUG9seWZpbGw7XG5cdFx0XHRvYmouX19wcm90b19fID0gcHJvdG90eXBlO1xuXHRcdFx0aWYgKGlzTnVsbEJhc2UpIGRlZmluZVByb3BlcnR5KHNlbGYubnVsbFBvbHlmaWxsLCAnX19wcm90b19fJywgbnVsbERlc2MpO1xuXHRcdFx0cmV0dXJuIG9iajtcblx0XHR9O1xuXHR9XG5cdHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkoZm4sICdsZXZlbCcsIHsgY29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IGZhbHNlLCB2YWx1ZTogc3RhdHVzLmxldmVsIH0pO1xufSgoZnVuY3Rpb24gKCkge1xuXHR2YXIgeCA9IE9iamVjdC5jcmVhdGUobnVsbCksIHkgPSB7fSwgc2V0XG5cdCAgLCBkZXNjID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihPYmplY3QucHJvdG90eXBlLCAnX19wcm90b19fJyk7XG5cblx0aWYgKGRlc2MpIHtcblx0XHR0cnkge1xuXHRcdFx0c2V0ID0gZGVzYy5zZXQ7IC8vIE9wZXJhIGNyYXNoZXMgYXQgdGhpcyBwb2ludFxuXHRcdFx0c2V0LmNhbGwoeCwgeSk7XG5cdFx0fSBjYXRjaCAoaWdub3JlKSB7IH1cblx0XHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBzZXQ6IHNldCwgbGV2ZWw6IDIgfTtcblx0fVxuXG5cdHguX19wcm90b19fID0geTtcblx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgbGV2ZWw6IDIgfTtcblxuXHR4ID0ge307XG5cdHguX19wcm90b19fID0geTtcblx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgbGV2ZWw6IDEgfTtcblxuXHRyZXR1cm4gZmFsc2U7XG59KCkpKSk7XG5cbnJlcXVpcmUoJy4uL2NyZWF0ZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChmbikge1xuXHRpZiAodHlwZW9mIGZuICE9PSAnZnVuY3Rpb24nKSB0aHJvdyBuZXcgVHlwZUVycm9yKGZuICsgXCIgaXMgbm90IGEgZnVuY3Rpb25cIik7XG5cdHJldHVybiBmbjtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSBudWxsIG9yIHVuZGVmaW5lZFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IFN0cmluZy5wcm90b3R5cGUuY29udGFpbnNcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHN0ciA9ICdyYXpkd2F0cnp5JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2Ygc3RyLmNvbnRhaW5zICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHN0ci5jb250YWlucygnZHdhJykgPT09IHRydWUpICYmIChzdHIuY29udGFpbnMoJ2ZvbycpID09PSBmYWxzZSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGluZGV4T2YgPSBTdHJpbmcucHJvdG90eXBlLmluZGV4T2Y7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHNlYXJjaFN0cmluZy8qLCBwb3NpdGlvbiovKSB7XG5cdHJldHVybiBpbmRleE9mLmNhbGwodGhpcywgc2VhcmNoU3RyaW5nLCBhcmd1bWVudHNbMV0pID4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nXG5cbiAgLCBpZCA9IHRvU3RyaW5nLmNhbGwoJycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAodHlwZW9mIHggPT09ICdzdHJpbmcnKSB8fCAoeCAmJiAodHlwZW9mIHggPT09ICdvYmplY3QnKSAmJlxuXHRcdCgoeCBpbnN0YW5jZW9mIFN0cmluZykgfHwgKHRvU3RyaW5nLmNhbGwoeCkgPT09IGlkKSkpIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY29udGFpbnMgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi8nKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBBcnJheUl0ZXJhdG9yO1xuXG5BcnJheUl0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXJyLCBraW5kKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBBcnJheUl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBBcnJheUl0ZXJhdG9yKGFyciwga2luZCk7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgYXJyKTtcblx0aWYgKCFraW5kKSBraW5kID0gJ3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5K3ZhbHVlJykpIGtpbmQgPSAna2V5K3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5JykpIGtpbmQgPSAna2V5Jztcblx0ZWxzZSBraW5kID0gJ3ZhbHVlJztcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fa2luZF9fJywgZCgnJywga2luZCkpO1xufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoQXJyYXlJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5BcnJheUl0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKEFycmF5SXRlcmF0b3IpLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAndmFsdWUnKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ2tleSt2YWx1ZScpIHJldHVybiBbaSwgdGhpcy5fX2xpc3RfX1tpXV07XG5cdFx0cmV0dXJuIGk7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBBcnJheSBJdGVyYXRvcl0nOyB9KVxufSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBpc1N0cmluZyA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgZ2V0ICAgICAgPSByZXF1aXJlKCcuL2dldCcpXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChpdGVyYWJsZSwgY2IvKiwgdGhpc0FyZyovKSB7XG5cdHZhciBtb2RlLCB0aGlzQXJnID0gYXJndW1lbnRzWzJdLCByZXN1bHQsIGRvQnJlYWssIGJyb2tlbiwgaSwgbCwgY2hhciwgY29kZTtcblx0aWYgKGlzQXJyYXkoaXRlcmFibGUpKSBtb2RlID0gJ2FycmF5Jztcblx0ZWxzZSBpZiAoaXNTdHJpbmcoaXRlcmFibGUpKSBtb2RlID0gJ3N0cmluZyc7XG5cdGVsc2UgaXRlcmFibGUgPSBnZXQoaXRlcmFibGUpO1xuXG5cdGNhbGxhYmxlKGNiKTtcblx0ZG9CcmVhayA9IGZ1bmN0aW9uICgpIHsgYnJva2VuID0gdHJ1ZTsgfTtcblx0aWYgKG1vZGUgPT09ICdhcnJheScpIHtcblx0XHRpdGVyYWJsZS5zb21lKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwgZG9CcmVhayk7XG5cdFx0XHRpZiAoYnJva2VuKSByZXR1cm4gdHJ1ZTtcblx0XHR9KTtcblx0XHRyZXR1cm47XG5cdH1cblx0aWYgKG1vZGUgPT09ICdzdHJpbmcnKSB7XG5cdFx0bCA9IGl0ZXJhYmxlLmxlbmd0aDtcblx0XHRmb3IgKGkgPSAwOyBpIDwgbDsgKytpKSB7XG5cdFx0XHRjaGFyID0gaXRlcmFibGVbaV07XG5cdFx0XHRpZiAoKGkgKyAxKSA8IGwpIHtcblx0XHRcdFx0Y29kZSA9IGNoYXIuY2hhckNvZGVBdCgwKTtcblx0XHRcdFx0aWYgKChjb2RlID49IDB4RDgwMCkgJiYgKGNvZGUgPD0gMHhEQkZGKSkgY2hhciArPSBpdGVyYWJsZVsrK2ldO1xuXHRcdFx0fVxuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCBjaGFyLCBkb0JyZWFrKTtcblx0XHRcdGlmIChicm9rZW4pIGJyZWFrO1xuXHRcdH1cblx0XHRyZXR1cm47XG5cdH1cblx0cmVzdWx0ID0gaXRlcmFibGUubmV4dCgpO1xuXG5cdHdoaWxlICghcmVzdWx0LmRvbmUpIHtcblx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHJlc3VsdC52YWx1ZSwgZG9CcmVhayk7XG5cdFx0aWYgKGJyb2tlbikgcmV0dXJuO1xuXHRcdHJlc3VsdCA9IGl0ZXJhYmxlLm5leHQoKTtcblx0fVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3RyaW5nID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBBcnJheUl0ZXJhdG9yICA9IHJlcXVpcmUoJy4vYXJyYXknKVxuICAsIFN0cmluZ0l0ZXJhdG9yID0gcmVxdWlyZSgnLi9zdHJpbmcnKVxuICAsIGl0ZXJhYmxlICAgICAgID0gcmVxdWlyZSgnLi92YWxpZC1pdGVyYWJsZScpXG4gICwgaXRlcmF0b3JTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykuaXRlcmF0b3I7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuXHRpZiAodHlwZW9mIGl0ZXJhYmxlKG9iailbaXRlcmF0b3JTeW1ib2xdID09PSAnZnVuY3Rpb24nKSByZXR1cm4gb2JqW2l0ZXJhdG9yU3ltYm9sXSgpO1xuXHRpZiAoaXNTdHJpbmcob2JqKSkgcmV0dXJuIG5ldyBTdHJpbmdJdGVyYXRvcihvYmopO1xuXHRyZXR1cm4gbmV3IEFycmF5SXRlcmF0b3Iob2JqKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGVhciAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9jbGVhcicpXG4gICwgYXNzaWduICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbHVlICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuICAsIGQgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgYXV0b0JpbmQgPSByZXF1aXJlKCdkL2F1dG8tYmluZCcpXG4gICwgU3ltYm9sICAgPSByZXF1aXJlKCdlczYtc3ltYm9sJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgSXRlcmF0b3I7XG5cbm1vZHVsZS5leHBvcnRzID0gSXRlcmF0b3IgPSBmdW5jdGlvbiAobGlzdCwgY29udGV4dCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgSXRlcmF0b3IpKSByZXR1cm4gbmV3IEl0ZXJhdG9yKGxpc3QsIGNvbnRleHQpO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX2xpc3RfXzogZCgndycsIHZhbHVlKGxpc3QpKSxcblx0XHRfX2NvbnRleHRfXzogZCgndycsIGNvbnRleHQpLFxuXHRcdF9fbmV4dEluZGV4X186IGQoJ3cnLCAwKVxuXHR9KTtcblx0aWYgKCFjb250ZXh0KSByZXR1cm47XG5cdGNhbGxhYmxlKGNvbnRleHQub24pO1xuXHRjb250ZXh0Lm9uKCdfYWRkJywgdGhpcy5fb25BZGQpO1xuXHRjb250ZXh0Lm9uKCdfZGVsZXRlJywgdGhpcy5fb25EZWxldGUpO1xuXHRjb250ZXh0Lm9uKCdfY2xlYXInLCB0aGlzLl9vbkNsZWFyKTtcbn07XG5cbmRlZmluZVByb3BlcnRpZXMoSXRlcmF0b3IucHJvdG90eXBlLCBhc3NpZ24oe1xuXHRjb25zdHJ1Y3RvcjogZChJdGVyYXRvciksXG5cdF9uZXh0OiBkKGZ1bmN0aW9uICgpIHtcblx0XHR2YXIgaTtcblx0XHRpZiAoIXRoaXMuX19saXN0X18pIHJldHVybjtcblx0XHRpZiAodGhpcy5fX3JlZG9fXykge1xuXHRcdFx0aSA9IHRoaXMuX19yZWRvX18uc2hpZnQoKTtcblx0XHRcdGlmIChpICE9PSB1bmRlZmluZWQpIHJldHVybiBpO1xuXHRcdH1cblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fIDwgdGhpcy5fX2xpc3RfXy5sZW5ndGgpIHJldHVybiB0aGlzLl9fbmV4dEluZGV4X18rKztcblx0XHR0aGlzLl91bkJpbmQoKTtcblx0fSksXG5cdG5leHQ6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fY3JlYXRlUmVzdWx0KHRoaXMuX25leHQoKSk7IH0pLFxuXHRfY3JlYXRlUmVzdWx0OiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKGkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRcdHJldHVybiB7IGRvbmU6IGZhbHNlLCB2YWx1ZTogdGhpcy5fcmVzb2x2ZShpKSB9O1xuXHR9KSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHsgcmV0dXJuIHRoaXMuX19saXN0X19baV07IH0pLFxuXHRfdW5CaW5kOiBkKGZ1bmN0aW9uICgpIHtcblx0XHR0aGlzLl9fbGlzdF9fID0gbnVsbDtcblx0XHRkZWxldGUgdGhpcy5fX3JlZG9fXztcblx0XHRpZiAoIXRoaXMuX19jb250ZXh0X18pIHJldHVybjtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2FkZCcsIHRoaXMuX29uQWRkKTtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2RlbGV0ZScsIHRoaXMuX29uRGVsZXRlKTtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2NsZWFyJywgdGhpcy5fb25DbGVhcik7XG5cdFx0dGhpcy5fX2NvbnRleHRfXyA9IG51bGw7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBJdGVyYXRvcl0nOyB9KVxufSwgYXV0b0JpbmQoe1xuXHRfb25BZGQ6IGQoZnVuY3Rpb24gKGluZGV4KSB7XG5cdFx0aWYgKGluZGV4ID49IHRoaXMuX19uZXh0SW5kZXhfXykgcmV0dXJuO1xuXHRcdCsrdGhpcy5fX25leHRJbmRleF9fO1xuXHRcdGlmICghdGhpcy5fX3JlZG9fXykge1xuXHRcdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fcmVkb19fJywgZCgnYycsIFtpbmRleF0pKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5fX3JlZG9fXy5mb3JFYWNoKGZ1bmN0aW9uIChyZWRvLCBpKSB7XG5cdFx0XHRpZiAocmVkbyA+PSBpbmRleCkgdGhpcy5fX3JlZG9fX1tpXSA9ICsrcmVkbztcblx0XHR9LCB0aGlzKTtcblx0XHR0aGlzLl9fcmVkb19fLnB1c2goaW5kZXgpO1xuXHR9KSxcblx0X29uRGVsZXRlOiBkKGZ1bmN0aW9uIChpbmRleCkge1xuXHRcdHZhciBpO1xuXHRcdGlmIChpbmRleCA+PSB0aGlzLl9fbmV4dEluZGV4X18pIHJldHVybjtcblx0XHQtLXRoaXMuX19uZXh0SW5kZXhfXztcblx0XHRpZiAoIXRoaXMuX19yZWRvX18pIHJldHVybjtcblx0XHRpID0gdGhpcy5fX3JlZG9fXy5pbmRleE9mKGluZGV4KTtcblx0XHRpZiAoaSAhPT0gLTEpIHRoaXMuX19yZWRvX18uc3BsaWNlKGksIDEpO1xuXHRcdHRoaXMuX19yZWRvX18uZm9yRWFjaChmdW5jdGlvbiAocmVkbywgaSkge1xuXHRcdFx0aWYgKHJlZG8gPiBpbmRleCkgdGhpcy5fX3JlZG9fX1tpXSA9IC0tcmVkbztcblx0XHR9LCB0aGlzKTtcblx0fSksXG5cdF9vbkNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAodGhpcy5fX3JlZG9fXykgY2xlYXIuY2FsbCh0aGlzLl9fcmVkb19fKTtcblx0XHR0aGlzLl9fbmV4dEluZGV4X18gPSAwO1xuXHR9KVxufSkpKTtcblxuZGVmaW5lUHJvcGVydHkoSXRlcmF0b3IucHJvdG90eXBlLCBTeW1ib2wuaXRlcmF0b3IsIGQoZnVuY3Rpb24gKCkge1xuXHRyZXR1cm4gdGhpcztcbn0pKTtcbmRlZmluZVByb3BlcnR5KEl0ZXJhdG9yLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCcnLCAnSXRlcmF0b3InKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N0cmluZyAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgaXRlcmF0b3JTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykuaXRlcmF0b3JcblxuICAsIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuXHRpZiAoaXNBcnJheSh2YWx1ZSkpIHJldHVybiB0cnVlO1xuXHRpZiAoaXNTdHJpbmcodmFsdWUpKSByZXR1cm4gdHJ1ZTtcblx0cmV0dXJuICh0eXBlb2YgdmFsdWVbaXRlcmF0b3JTeW1ib2xdID09PSAnZnVuY3Rpb24nKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTeW1ib2wgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodHlwZW9mIFN5bWJvbCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzeW1ib2wgPSBTeW1ib2woJ3Rlc3Qgc3ltYm9sJyk7XG5cdHRyeSB7IFN0cmluZyhzeW1ib2wpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gJ3N5bWJvbCcpIHJldHVybiB0cnVlO1xuXG5cdC8vIFJldHVybiAndHJ1ZScgZm9yIHBvbHlmaWxsc1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc0NvbmNhdFNwcmVhZGFibGUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1ByaW1pdGl2ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9TdHJpbmdUYWcgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnVuc2NvcGFibGVzICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKHggJiYgKCh0eXBlb2YgeCA9PT0gJ3N5bWJvbCcpIHx8ICh4WydAQHRvU3RyaW5nVGFnJ10gPT09ICdTeW1ib2wnKSkpIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgdmFsaWRhdGVTeW1ib2wgPSByZXF1aXJlKCcuL3ZhbGlkYXRlLXN5bWJvbCcpXG5cbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eSwgb2JqUHJvdG90eXBlID0gT2JqZWN0LnByb3RvdHlwZVxuICAsIFN5bWJvbCwgSGlkZGVuU3ltYm9sLCBnbG9iYWxTeW1ib2xzID0gY3JlYXRlKG51bGwpO1xuXG52YXIgZ2VuZXJhdGVOYW1lID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIGNyZWF0ZWQgPSBjcmVhdGUobnVsbCk7XG5cdHJldHVybiBmdW5jdGlvbiAoZGVzYykge1xuXHRcdHZhciBwb3N0Zml4ID0gMCwgbmFtZTtcblx0XHR3aGlsZSAoY3JlYXRlZFtkZXNjICsgKHBvc3RmaXggfHwgJycpXSkgKytwb3N0Zml4O1xuXHRcdGRlc2MgKz0gKHBvc3RmaXggfHwgJycpO1xuXHRcdGNyZWF0ZWRbZGVzY10gPSB0cnVlO1xuXHRcdG5hbWUgPSAnQEAnICsgZGVzYztcblx0XHRkZWZpbmVQcm9wZXJ0eShvYmpQcm90b3R5cGUsIG5hbWUsIGQuZ3MobnVsbCwgZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCBuYW1lLCBkKHZhbHVlKSk7XG5cdFx0fSkpO1xuXHRcdHJldHVybiBuYW1lO1xuXHR9O1xufSgpKTtcblxuSGlkZGVuU3ltYm9sID0gZnVuY3Rpb24gU3ltYm9sKGRlc2NyaXB0aW9uKSB7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgSGlkZGVuU3ltYm9sKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHRyZXR1cm4gU3ltYm9sKGRlc2NyaXB0aW9uKTtcbn07XG5tb2R1bGUuZXhwb3J0cyA9IFN5bWJvbCA9IGZ1bmN0aW9uIFN5bWJvbChkZXNjcmlwdGlvbikge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIFN5bWJvbCkgdGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0c3ltYm9sID0gY3JlYXRlKEhpZGRlblN5bWJvbC5wcm90b3R5cGUpO1xuXHRkZXNjcmlwdGlvbiA9IChkZXNjcmlwdGlvbiA9PT0gdW5kZWZpbmVkID8gJycgOiBTdHJpbmcoZGVzY3JpcHRpb24pKTtcblx0cmV0dXJuIGRlZmluZVByb3BlcnRpZXMoc3ltYm9sLCB7XG5cdFx0X19kZXNjcmlwdGlvbl9fOiBkKCcnLCBkZXNjcmlwdGlvbiksXG5cdFx0X19uYW1lX186IGQoJycsIGdlbmVyYXRlTmFtZShkZXNjcmlwdGlvbikpXG5cdH0pO1xufTtcbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLCB7XG5cdGZvcjogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0aWYgKGdsb2JhbFN5bWJvbHNba2V5XSkgcmV0dXJuIGdsb2JhbFN5bWJvbHNba2V5XTtcblx0XHRyZXR1cm4gKGdsb2JhbFN5bWJvbHNba2V5XSA9IFN5bWJvbChTdHJpbmcoa2V5KSkpO1xuXHR9KSxcblx0a2V5Rm9yOiBkKGZ1bmN0aW9uIChzKSB7XG5cdFx0dmFyIGtleTtcblx0XHR2YWxpZGF0ZVN5bWJvbChzKTtcblx0XHRmb3IgKGtleSBpbiBnbG9iYWxTeW1ib2xzKSBpZiAoZ2xvYmFsU3ltYm9sc1trZXldID09PSBzKSByZXR1cm4ga2V5O1xuXHR9KSxcblx0aGFzSW5zdGFuY2U6IGQoJycsIFN5bWJvbCgnaGFzSW5zdGFuY2UnKSksXG5cdGlzQ29uY2F0U3ByZWFkYWJsZTogZCgnJywgU3ltYm9sKCdpc0NvbmNhdFNwcmVhZGFibGUnKSksXG5cdGl0ZXJhdG9yOiBkKCcnLCBTeW1ib2woJ2l0ZXJhdG9yJykpLFxuXHRtYXRjaDogZCgnJywgU3ltYm9sKCdtYXRjaCcpKSxcblx0cmVwbGFjZTogZCgnJywgU3ltYm9sKCdyZXBsYWNlJykpLFxuXHRzZWFyY2g6IGQoJycsIFN5bWJvbCgnc2VhcmNoJykpLFxuXHRzcGVjaWVzOiBkKCcnLCBTeW1ib2woJ3NwZWNpZXMnKSksXG5cdHNwbGl0OiBkKCcnLCBTeW1ib2woJ3NwbGl0JykpLFxuXHR0b1ByaW1pdGl2ZTogZCgnJywgU3ltYm9sKCd0b1ByaW1pdGl2ZScpKSxcblx0dG9TdHJpbmdUYWc6IGQoJycsIFN5bWJvbCgndG9TdHJpbmdUYWcnKSksXG5cdHVuc2NvcGFibGVzOiBkKCcnLCBTeW1ib2woJ3Vuc2NvcGFibGVzJykpXG59KTtcbmRlZmluZVByb3BlcnRpZXMoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTeW1ib2wpLFxuXHR0b1N0cmluZzogZCgnJywgZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX25hbWVfXzsgfSlcbn0pO1xuXG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbC5wcm90b3R5cGUsIHtcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1N5bWJvbCAoJyArIHZhbGlkYXRlU3ltYm9sKHRoaXMpLl9fZGVzY3JpcHRpb25fXyArICcpJzsgfSksXG5cdHZhbHVlT2Y6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gdmFsaWRhdGVTeW1ib2wodGhpcyk7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSwgZCgnJyxcblx0ZnVuY3Rpb24gKCkgeyByZXR1cm4gdmFsaWRhdGVTeW1ib2wodGhpcyk7IH0pKTtcbmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdTeW1ib2wnKSk7XG5cbmRlZmluZVByb3BlcnR5KEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSxcblx0ZCgnYycsIFN5bWJvbC5wcm90b3R5cGVbU3ltYm9sLnRvUHJpbWl0aXZlXSkpO1xuZGVmaW5lUHJvcGVydHkoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLFxuXHRkKCdjJywgU3ltYm9sLnByb3RvdHlwZVtTeW1ib2wudG9TdHJpbmdUYWddKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N5bWJvbCA9IHJlcXVpcmUoJy4vaXMtc3ltYm9sJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNTeW1ib2wodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGEgc3ltYm9sXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiLy8gVGhhbmtzIEBtYXRoaWFzYnluZW5zXG4vLyBodHRwOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LXVuaWNvZGUjaXRlcmF0aW5nLW92ZXItc3ltYm9sc1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFN0cmluZ0l0ZXJhdG9yO1xuXG5TdHJpbmdJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHN0cikge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgU3RyaW5nSXRlcmF0b3IpKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKHN0cik7XG5cdHN0ciA9IFN0cmluZyhzdHIpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIHN0cik7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2xlbmd0aF9fJywgZCgnJywgc3RyLmxlbmd0aCkpO1xuXG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTdHJpbmdJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5TdHJpbmdJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTdHJpbmdJdGVyYXRvciksXG5cdF9uZXh0OiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19saXN0X18pIHJldHVybjtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fIDwgdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdHZhciBjaGFyID0gdGhpcy5fX2xpc3RfX1tpXSwgY29kZTtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fID09PSB0aGlzLl9fbGVuZ3RoX18pIHJldHVybiBjaGFyO1xuXHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0aWYgKChjb2RlID49IDB4RDgwMCkgJiYgKGNvZGUgPD0gMHhEQkZGKSkgcmV0dXJuIGNoYXIgKyB0aGlzLl9fbGlzdF9fW3RoaXMuX19uZXh0SW5kZXhfXysrXTtcblx0XHRyZXR1cm4gY2hhcjtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFN0cmluZyBJdGVyYXRvcl0nOyB9KVxufSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0l0ZXJhYmxlID0gcmVxdWlyZSgnLi9pcy1pdGVyYWJsZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzSXRlcmFibGUodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGl0ZXJhYmxlXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gU3ltYm9sIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHR5cGVvZiBTeW1ib2wgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c3ltYm9sID0gU3ltYm9sKCd0ZXN0IHN5bWJvbCcpO1xuXHR0cnkgeyBTdHJpbmcoc3ltYm9sKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgPT09ICdzeW1ib2wnKSByZXR1cm4gdHJ1ZTtcblxuXHQvLyBSZXR1cm4gJ3RydWUnIGZvciBwb2x5ZmlsbHNcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNDb25jYXRTcHJlYWRhYmxlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc1JlZ0V4cCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvUHJpbWl0aXZlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1N0cmluZ1RhZyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudW5zY29wYWJsZXMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCA9IHJlcXVpcmUoJ2QnKVxuXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgZ2VuZXJhdGVOYW1lLCBTeW1ib2w7XG5cbmdlbmVyYXRlTmFtZSA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBjcmVhdGVkID0gY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKGRlc2MpIHtcblx0XHR2YXIgcG9zdGZpeCA9IDA7XG5cdFx0d2hpbGUgKGNyZWF0ZWRbZGVzYyArIChwb3N0Zml4IHx8ICcnKV0pICsrcG9zdGZpeDtcblx0XHRkZXNjICs9IChwb3N0Zml4IHx8ICcnKTtcblx0XHRjcmVhdGVkW2Rlc2NdID0gdHJ1ZTtcblx0XHRyZXR1cm4gJ0BAJyArIGRlc2M7XG5cdH07XG59KCkpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bWJvbCA9IGZ1bmN0aW9uIChkZXNjcmlwdGlvbikge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIFN5bWJvbCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdH1cblx0c3ltYm9sID0gY3JlYXRlKFN5bWJvbC5wcm90b3R5cGUpO1xuXHRkZXNjcmlwdGlvbiA9IChkZXNjcmlwdGlvbiA9PT0gdW5kZWZpbmVkID8gJycgOiBTdHJpbmcoZGVzY3JpcHRpb24pKTtcblx0cmV0dXJuIGRlZmluZVByb3BlcnRpZXMoc3ltYm9sLCB7XG5cdFx0X19kZXNjcmlwdGlvbl9fOiBkKCcnLCBkZXNjcmlwdGlvbiksXG5cdFx0X19uYW1lX186IGQoJycsIGdlbmVyYXRlTmFtZShkZXNjcmlwdGlvbikpXG5cdH0pO1xufTtcblxuT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLCB7XG5cdGNyZWF0ZTogZCgnJywgU3ltYm9sKCdjcmVhdGUnKSksXG5cdGhhc0luc3RhbmNlOiBkKCcnLCBTeW1ib2woJ2hhc0luc3RhbmNlJykpLFxuXHRpc0NvbmNhdFNwcmVhZGFibGU6IGQoJycsIFN5bWJvbCgnaXNDb25jYXRTcHJlYWRhYmxlJykpLFxuXHRpc1JlZ0V4cDogZCgnJywgU3ltYm9sKCdpc1JlZ0V4cCcpKSxcblx0aXRlcmF0b3I6IGQoJycsIFN5bWJvbCgnaXRlcmF0b3InKSksXG5cdHRvUHJpbWl0aXZlOiBkKCcnLCBTeW1ib2woJ3RvUHJpbWl0aXZlJykpLFxuXHR0b1N0cmluZ1RhZzogZCgnJywgU3ltYm9sKCd0b1N0cmluZ1RhZycpKSxcblx0dW5zY29wYWJsZXM6IGQoJycsIFN5bWJvbCgndW5zY29wYWJsZXMnKSlcbn0pO1xuXG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbC5wcm90b3R5cGUsIHtcblx0cHJvcGVyVG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHJldHVybiAnU3ltYm9sICgnICsgdGhpcy5fX2Rlc2NyaXB0aW9uX18gKyAnKSc7XG5cdH0pLFxuXHR0b1N0cmluZzogZCgnJywgZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX25hbWVfXzsgfSlcbn0pO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSwgZCgnJyxcblx0ZnVuY3Rpb24gKGhpbnQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ29udmVyc2lvbiBvZiBzeW1ib2wgb2JqZWN0cyBpcyBub3QgYWxsb3dlZFwiKTtcblx0fSkpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdTeW1ib2wnKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuXG4gICwgYXBwbHkgPSBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHksIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbFxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZGVzY3JpcHRvciA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUgfVxuXG4gICwgb24sIG9uY2UsIG9mZiwgZW1pdCwgbWV0aG9kcywgZGVzY3JpcHRvcnMsIGJhc2U7XG5cbm9uID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBkYXRhO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSB7XG5cdFx0ZGF0YSA9IGRlc2NyaXB0b3IudmFsdWUgPSBjcmVhdGUobnVsbCk7XG5cdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fZWVfXycsIGRlc2NyaXB0b3IpO1xuXHRcdGRlc2NyaXB0b3IudmFsdWUgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdGRhdGEgPSB0aGlzLl9fZWVfXztcblx0fVxuXHRpZiAoIWRhdGFbdHlwZV0pIGRhdGFbdHlwZV0gPSBsaXN0ZW5lcjtcblx0ZWxzZSBpZiAodHlwZW9mIGRhdGFbdHlwZV0gPT09ICdvYmplY3QnKSBkYXRhW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuXHRlbHNlIGRhdGFbdHlwZV0gPSBbZGF0YVt0eXBlXSwgbGlzdGVuZXJdO1xuXG5cdHJldHVybiB0aGlzO1xufTtcblxub25jZSA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgb25jZSwgc2VsZjtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cdHNlbGYgPSB0aGlzO1xuXHRvbi5jYWxsKHRoaXMsIHR5cGUsIG9uY2UgPSBmdW5jdGlvbiAoKSB7XG5cdFx0b2ZmLmNhbGwoc2VsZiwgdHlwZSwgb25jZSk7XG5cdFx0YXBwbHkuY2FsbChsaXN0ZW5lciwgdGhpcywgYXJndW1lbnRzKTtcblx0fSk7XG5cblx0b25jZS5fX2VlT25jZUxpc3RlbmVyX18gPSBsaXN0ZW5lcjtcblx0cmV0dXJuIHRoaXM7XG59O1xuXG5vZmYgPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIGRhdGEsIGxpc3RlbmVycywgY2FuZGlkYXRlLCBpO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSByZXR1cm4gdGhpcztcblx0ZGF0YSA9IHRoaXMuX19lZV9fO1xuXHRpZiAoIWRhdGFbdHlwZV0pIHJldHVybiB0aGlzO1xuXHRsaXN0ZW5lcnMgPSBkYXRhW3R5cGVdO1xuXG5cdGlmICh0eXBlb2YgbGlzdGVuZXJzID09PSAnb2JqZWN0Jykge1xuXHRcdGZvciAoaSA9IDA7IChjYW5kaWRhdGUgPSBsaXN0ZW5lcnNbaV0pOyArK2kpIHtcblx0XHRcdGlmICgoY2FuZGlkYXRlID09PSBsaXN0ZW5lcikgfHxcblx0XHRcdFx0XHQoY2FuZGlkYXRlLl9fZWVPbmNlTGlzdGVuZXJfXyA9PT0gbGlzdGVuZXIpKSB7XG5cdFx0XHRcdGlmIChsaXN0ZW5lcnMubGVuZ3RoID09PSAyKSBkYXRhW3R5cGVdID0gbGlzdGVuZXJzW2kgPyAwIDogMV07XG5cdFx0XHRcdGVsc2UgbGlzdGVuZXJzLnNwbGljZShpLCAxKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0aWYgKChsaXN0ZW5lcnMgPT09IGxpc3RlbmVyKSB8fFxuXHRcdFx0XHQobGlzdGVuZXJzLl9fZWVPbmNlTGlzdGVuZXJfXyA9PT0gbGlzdGVuZXIpKSB7XG5cdFx0XHRkZWxldGUgZGF0YVt0eXBlXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdGhpcztcbn07XG5cbmVtaXQgPSBmdW5jdGlvbiAodHlwZSkge1xuXHR2YXIgaSwgbCwgbGlzdGVuZXIsIGxpc3RlbmVycywgYXJncztcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSByZXR1cm47XG5cdGxpc3RlbmVycyA9IHRoaXMuX19lZV9fW3R5cGVdO1xuXHRpZiAoIWxpc3RlbmVycykgcmV0dXJuO1xuXG5cdGlmICh0eXBlb2YgbGlzdGVuZXJzID09PSAnb2JqZWN0Jykge1xuXHRcdGwgPSBhcmd1bWVudHMubGVuZ3RoO1xuXHRcdGFyZ3MgPSBuZXcgQXJyYXkobCAtIDEpO1xuXHRcdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXG5cdFx0bGlzdGVuZXJzID0gbGlzdGVuZXJzLnNsaWNlKCk7XG5cdFx0Zm9yIChpID0gMDsgKGxpc3RlbmVyID0gbGlzdGVuZXJzW2ldKTsgKytpKSB7XG5cdFx0XHRhcHBseS5jYWxsKGxpc3RlbmVyLCB0aGlzLCBhcmdzKTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0c3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG5cdFx0Y2FzZSAxOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcyk7XG5cdFx0XHRicmVhaztcblx0XHRjYXNlIDI6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmd1bWVudHNbMV0pO1xuXHRcdFx0YnJlYWs7XG5cdFx0Y2FzZSAzOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuXHRcdFx0YnJlYWs7XG5cdFx0ZGVmYXVsdDpcblx0XHRcdGwgPSBhcmd1bWVudHMubGVuZ3RoO1xuXHRcdFx0YXJncyA9IG5ldyBBcnJheShsIC0gMSk7XG5cdFx0XHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSB7XG5cdFx0XHRcdGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXHRcdFx0fVxuXHRcdFx0YXBwbHkuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3MpO1xuXHRcdH1cblx0fVxufTtcblxubWV0aG9kcyA9IHtcblx0b246IG9uLFxuXHRvbmNlOiBvbmNlLFxuXHRvZmY6IG9mZixcblx0ZW1pdDogZW1pdFxufTtcblxuZGVzY3JpcHRvcnMgPSB7XG5cdG9uOiBkKG9uKSxcblx0b25jZTogZChvbmNlKSxcblx0b2ZmOiBkKG9mZiksXG5cdGVtaXQ6IGQoZW1pdClcbn07XG5cbmJhc2UgPSBkZWZpbmVQcm9wZXJ0aWVzKHt9LCBkZXNjcmlwdG9ycyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IGZ1bmN0aW9uIChvKSB7XG5cdHJldHVybiAobyA9PSBudWxsKSA/IGNyZWF0ZShiYXNlKSA6IGRlZmluZVByb3BlcnRpZXMoT2JqZWN0KG8pLCBkZXNjcmlwdG9ycyk7XG59O1xuZXhwb3J0cy5tZXRob2RzID0gbWV0aG9kcztcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsZWFyICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2NsZWFyJylcbiAgLCBlSW5kZXhPZiAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9lLWluZGV4LW9mJylcbiAgLCBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNhbGxhYmxlICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgZWUgICAgICAgICAgICAgPSByZXF1aXJlKCdldmVudC1lbWl0dGVyJylcbiAgLCBTeW1ib2wgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKVxuICAsIGl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL3ZhbGlkLWl0ZXJhYmxlJylcbiAgLCBmb3JPZiAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci9mb3Itb2YnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi9saWIvaXRlcmF0b3InKVxuICAsIGlzTmF0aXZlICAgICAgID0gcmVxdWlyZSgnLi9pcy1uYXRpdmUtaW1wbGVtZW50ZWQnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFNldFBvbHksIGdldFZhbHVlcztcblxubW9kdWxlLmV4cG9ydHMgPSBTZXRQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF07XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBTZXRQb2x5KSkgcmV0dXJuIG5ldyBTZXRQb2x5KGl0ZXJhYmxlKTtcblx0aWYgKHRoaXMuX19zZXREYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSBpdGVyYXRvcihpdGVyYWJsZSk7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX3NldERhdGFfXycsIGQoJ2MnLCBbXSkpO1xuXHRpZiAoIWl0ZXJhYmxlKSByZXR1cm47XG5cdGZvck9mKGl0ZXJhYmxlLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRpZiAoZUluZGV4T2YuY2FsbCh0aGlzLCB2YWx1ZSkgIT09IC0xKSByZXR1cm47XG5cdFx0dGhpcy5wdXNoKHZhbHVlKTtcblx0fSwgdGhpcy5fX3NldERhdGFfXyk7XG59O1xuXG5pZiAoaXNOYXRpdmUpIHtcblx0aWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTZXRQb2x5LCBTZXQpO1xuXHRTZXRQb2x5LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoU2V0LnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKFNldFBvbHkpXG5cdH0pO1xufVxuXG5lZShPYmplY3QuZGVmaW5lUHJvcGVydGllcyhTZXRQb2x5LnByb3RvdHlwZSwge1xuXHRhZGQ6IGQoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0aWYgKHRoaXMuaGFzKHZhbHVlKSkgcmV0dXJuIHRoaXM7XG5cdFx0dGhpcy5lbWl0KCdfYWRkJywgdGhpcy5fX3NldERhdGFfXy5wdXNoKHZhbHVlKSAtIDEsIHZhbHVlKTtcblx0XHRyZXR1cm4gdGhpcztcblx0fSksXG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19zZXREYXRhX18ubGVuZ3RoKSByZXR1cm47XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fc2V0RGF0YV9fKTtcblx0XHR0aGlzLmVtaXQoJ19jbGVhcicpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX3NldERhdGFfXywgdmFsdWUpO1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHJldHVybiBmYWxzZTtcblx0XHR0aGlzLl9fc2V0RGF0YV9fLnNwbGljZShpbmRleCwgMSk7XG5cdFx0dGhpcy5lbWl0KCdfZGVsZXRlJywgaW5kZXgsIHZhbHVlKTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSksXG5cdGVudHJpZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXkrdmFsdWUnKTsgfSksXG5cdGZvckVhY2g6IGQoZnVuY3Rpb24gKGNiLyosIHRoaXNBcmcqLykge1xuXHRcdHZhciB0aGlzQXJnID0gYXJndW1lbnRzWzFdLCBpdGVyYXRvciwgcmVzdWx0LCB2YWx1ZTtcblx0XHRjYWxsYWJsZShjYik7XG5cdFx0aXRlcmF0b3IgPSB0aGlzLnZhbHVlcygpO1xuXHRcdHJlc3VsdCA9IGl0ZXJhdG9yLl9uZXh0KCk7XG5cdFx0d2hpbGUgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHR2YWx1ZSA9IGl0ZXJhdG9yLl9yZXNvbHZlKHJlc3VsdCk7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCB2YWx1ZSwgdGhpcyk7XG5cdFx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdH1cblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRyZXR1cm4gKGVJbmRleE9mLmNhbGwodGhpcy5fX3NldERhdGFfXywgdmFsdWUpICE9PSAtMSk7XG5cdH0pLFxuXHRrZXlzOiBkKGdldFZhbHVlcyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMudmFsdWVzKCk7IH0pLFxuXHRzaXplOiBkLmdzKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19zZXREYXRhX18ubGVuZ3RoOyB9KSxcblx0dmFsdWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzKTsgfSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFNldF0nOyB9KVxufSkpO1xuZGVmaW5lUHJvcGVydHkoU2V0UG9seS5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChnZXRWYWx1ZXMpKTtcbmRlZmluZVByb3BlcnR5KFNldFBvbHkucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU2V0JykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gV2Vha01hcCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciB3ZWFrTWFwLCB4O1xuXHRpZiAodHlwZW9mIFdlYWtNYXAgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKFN0cmluZyhXZWFrTWFwLnByb3RvdHlwZSkgIT09ICdbb2JqZWN0IFdlYWtNYXBdJykgcmV0dXJuIGZhbHNlO1xuXHR0cnkge1xuXHRcdC8vIFdlYktpdCBkb2Vzbid0IHN1cHBvcnQgYXJndW1lbnRzIGFuZCBjcmFzaGVzXG5cdFx0d2Vha01hcCA9IG5ldyBXZWFrTWFwKFtbeCA9IHt9LCAnb25lJ10sIFt7fSwgJ3R3byddLCBbe30sICd0aHJlZSddXSk7XG5cdH0gY2F0Y2ggKGUpIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblx0aWYgKHR5cGVvZiB3ZWFrTWFwLnNldCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAod2Vha01hcC5zZXQoe30sIDEpICE9PSB3ZWFrTWFwKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygd2Vha01hcC5kZWxldGUgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiB3ZWFrTWFwLmhhcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAod2Vha01hcC5nZXQoeCkgIT09ICdvbmUnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiLy8gRXhwb3J0cyB0cnVlIGlmIGVudmlyb25tZW50IHByb3ZpZGVzIG5hdGl2ZSBgV2Vha01hcGAgaW1wbGVtZW50YXRpb24sIHdoYXRldmVyIHRoYXQgaXMuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIFdlYWtNYXAgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwobmV3IFdlYWtNYXAoKSkgPT09ICdbb2JqZWN0IFdlYWtNYXBdJyk7XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY29weSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2NvcHknKVxuICAsIG1hcCAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9tYXAnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcblxuICAsIGJpbmQgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZWZpbmU7XG5cbmRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXNjLCBiaW5kVG8pIHtcblx0dmFyIHZhbHVlID0gdmFsaWRWYWx1ZShkZXNjKSAmJiBjYWxsYWJsZShkZXNjLnZhbHVlKSwgZGdzO1xuXHRkZ3MgPSBjb3B5KGRlc2MpO1xuXHRkZWxldGUgZGdzLndyaXRhYmxlO1xuXHRkZWxldGUgZGdzLnZhbHVlO1xuXHRkZ3MuZ2V0ID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpKSByZXR1cm4gdmFsdWU7XG5cdFx0ZGVzYy52YWx1ZSA9IGJpbmQuY2FsbCh2YWx1ZSwgKGJpbmRUbyA9PSBudWxsKSA/IHRoaXMgOiB0aGlzW2JpbmRUb10pO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGRlc2MpO1xuXHRcdHJldHVybiB0aGlzW25hbWVdO1xuXHR9O1xuXHRyZXR1cm4gZGdzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAocHJvcHMvKiwgYmluZFRvKi8pIHtcblx0dmFyIGJpbmRUbyA9IGFyZ3VtZW50c1sxXTtcblx0cmV0dXJuIG1hcChwcm9wcywgZnVuY3Rpb24gKGRlc2MsIG5hbWUpIHtcblx0XHRyZXR1cm4gZGVmaW5lKG5hbWUsIGRlc2MsIGJpbmRUbyk7XG5cdH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIG5vcm1hbGl6ZU9wdHMgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucycpXG4gICwgaXNDYWxsYWJsZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlJylcbiAgLCBjb250YWlucyAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG5cbiAgLCBkO1xuXG5kID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZHNjciwgdmFsdWUvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCB3LCBvcHRpb25zLCBkZXNjO1xuXHRpZiAoKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB8fCAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSkge1xuXHRcdG9wdGlvbnMgPSB2YWx1ZTtcblx0XHR2YWx1ZSA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1syXTtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHcgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdFx0dyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ3cnKTtcblx0fVxuXG5cdGRlc2MgPSB7IHZhbHVlOiB2YWx1ZSwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlLCB3cml0YWJsZTogdyB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcblxuZC5ncyA9IGZ1bmN0aW9uIChkc2NyLCBnZXQsIHNldC8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IGdldDtcblx0XHRnZXQgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbM107XG5cdH1cblx0aWYgKGdldCA9PSBudWxsKSB7XG5cdFx0Z2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKGdldCkpIHtcblx0XHRvcHRpb25zID0gZ2V0O1xuXHRcdGdldCA9IHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmIChzZXQgPT0gbnVsbCkge1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShzZXQpKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdH1cblxuXHRkZXNjID0geyBnZXQ6IGdldCwgc2V0OiBzZXQsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcbiIsIi8vIEluc3BpcmVkIGJ5IEdvb2dsZSBDbG9zdXJlOlxuLy8gaHR0cDovL2Nsb3N1cmUtbGlicmFyeS5nb29nbGVjb2RlLmNvbS9zdm4vZG9jcy9cbi8vIGNsb3N1cmVfZ29vZ19hcnJheV9hcnJheS5qcy5odG1sI2dvb2cuYXJyYXkuY2xlYXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmFsdWUgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhbHVlKHRoaXMpLmxlbmd0aCA9IDA7XG5cdHJldHVybiB0aGlzO1xufTtcbiIsIi8vIEludGVybmFsIG1ldGhvZCwgdXNlZCBieSBpdGVyYXRpb24gZnVuY3Rpb25zLlxuLy8gQ2FsbHMgYSBmdW5jdGlvbiBmb3IgZWFjaCBrZXktdmFsdWUgcGFpciBmb3VuZCBpbiBvYmplY3Rcbi8vIE9wdGlvbmFsbHkgdGFrZXMgY29tcGFyZUZuIHRvIGl0ZXJhdGUgb2JqZWN0IGluIHNwZWNpZmljIG9yZGVyXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGlzQ2FsbGFibGUgPSByZXF1aXJlKCcuL2lzLWNhbGxhYmxlJylcbiAgLCBjYWxsYWJsZSAgID0gcmVxdWlyZSgnLi92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsdWUgICAgICA9IHJlcXVpcmUoJy4vdmFsaWQtdmFsdWUnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLCBrZXlzID0gT2JqZWN0LmtleXNcbiAgLCBwcm9wZXJ0eUlzRW51bWVyYWJsZSA9IE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGU7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG1ldGhvZCwgZGVmVmFsKSB7XG5cdHJldHVybiBmdW5jdGlvbiAob2JqLCBjYi8qLCB0aGlzQXJnLCBjb21wYXJlRm4qLykge1xuXHRcdHZhciBsaXN0LCB0aGlzQXJnID0gYXJndW1lbnRzWzJdLCBjb21wYXJlRm4gPSBhcmd1bWVudHNbM107XG5cdFx0b2JqID0gT2JqZWN0KHZhbHVlKG9iaikpO1xuXHRcdGNhbGxhYmxlKGNiKTtcblxuXHRcdGxpc3QgPSBrZXlzKG9iaik7XG5cdFx0aWYgKGNvbXBhcmVGbikge1xuXHRcdFx0bGlzdC5zb3J0KGlzQ2FsbGFibGUoY29tcGFyZUZuKSA/IGNvbXBhcmVGbi5iaW5kKG9iaikgOiB1bmRlZmluZWQpO1xuXHRcdH1cblx0XHRyZXR1cm4gbGlzdFttZXRob2RdKGZ1bmN0aW9uIChrZXksIGluZGV4KSB7XG5cdFx0XHRpZiAoIXByb3BlcnR5SXNFbnVtZXJhYmxlLmNhbGwob2JqLCBrZXkpKSByZXR1cm4gZGVmVmFsO1xuXHRcdFx0cmV0dXJuIGNhbGwuY2FsbChjYiwgdGhpc0FyZywgb2JqW2tleV0sIGtleSwgb2JqLCBpbmRleCk7XG5cdFx0fSk7XG5cdH07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LmFzc2lnblxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIGFzc2lnbiA9IE9iamVjdC5hc3NpZ24sIG9iajtcblx0aWYgKHR5cGVvZiBhc3NpZ24gIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0b2JqID0geyBmb286ICdyYXonIH07XG5cdGFzc2lnbihvYmosIHsgYmFyOiAnZHdhJyB9LCB7IHRyenk6ICd0cnp5JyB9KTtcblx0cmV0dXJuIChvYmouZm9vICsgb2JqLmJhciArIG9iai50cnp5KSA9PT0gJ3JhemR3YXRyenknO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGtleXMgID0gcmVxdWlyZSgnLi4va2V5cycpXG4gICwgdmFsdWUgPSByZXF1aXJlKCcuLi92YWxpZC12YWx1ZScpXG5cbiAgLCBtYXggPSBNYXRoLm1heDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZGVzdCwgc3JjLyosIOKApnNyY24qLykge1xuXHR2YXIgZXJyb3IsIGksIGwgPSBtYXgoYXJndW1lbnRzLmxlbmd0aCwgMiksIGFzc2lnbjtcblx0ZGVzdCA9IE9iamVjdCh2YWx1ZShkZXN0KSk7XG5cdGFzc2lnbiA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHR0cnkgeyBkZXN0W2tleV0gPSBzcmNba2V5XTsgfSBjYXRjaCAoZSkge1xuXHRcdFx0aWYgKCFlcnJvcikgZXJyb3IgPSBlO1xuXHRcdH1cblx0fTtcblx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkge1xuXHRcdHNyYyA9IGFyZ3VtZW50c1tpXTtcblx0XHRrZXlzKHNyYykuZm9yRWFjaChhc3NpZ24pO1xuXHR9XG5cdGlmIChlcnJvciAhPT0gdW5kZWZpbmVkKSB0aHJvdyBlcnJvcjtcblx0cmV0dXJuIGRlc3Q7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXNzaWduID0gcmVxdWlyZSgnLi9hc3NpZ24nKVxuICAsIHZhbHVlICA9IHJlcXVpcmUoJy4vdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG5cdHZhciBjb3B5ID0gT2JqZWN0KHZhbHVlKG9iaikpO1xuXHRpZiAoY29weSAhPT0gb2JqKSByZXR1cm4gY29weTtcblx0cmV0dXJuIGFzc2lnbih7fSwgb2JqKTtcbn07XG4iLCIvLyBXb3JrYXJvdW5kIGZvciBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvdjgvaXNzdWVzL2RldGFpbD9pZD0yODA0XG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIHNoaW07XG5cbmlmICghcmVxdWlyZSgnLi9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkJykoKSkge1xuXHRzaGltID0gcmVxdWlyZSgnLi9zZXQtcHJvdG90eXBlLW9mL3NoaW0nKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgbnVsbE9iamVjdCwgcHJvcHMsIGRlc2M7XG5cdGlmICghc2hpbSkgcmV0dXJuIGNyZWF0ZTtcblx0aWYgKHNoaW0ubGV2ZWwgIT09IDEpIHJldHVybiBjcmVhdGU7XG5cblx0bnVsbE9iamVjdCA9IHt9O1xuXHRwcm9wcyA9IHt9O1xuXHRkZXNjID0geyBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0dmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhPYmplY3QucHJvdG90eXBlKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG5cdFx0aWYgKG5hbWUgPT09ICdfX3Byb3RvX18nKSB7XG5cdFx0XHRwcm9wc1tuYW1lXSA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0XHRcdHZhbHVlOiB1bmRlZmluZWQgfTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0cHJvcHNbbmFtZV0gPSBkZXNjO1xuXHR9KTtcblx0T2JqZWN0LmRlZmluZVByb3BlcnRpZXMobnVsbE9iamVjdCwgcHJvcHMpO1xuXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShzaGltLCAnbnVsbFBvbHlmaWxsJywgeyBjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogZmFsc2UsIHZhbHVlOiBudWxsT2JqZWN0IH0pO1xuXG5cdHJldHVybiBmdW5jdGlvbiAocHJvdG90eXBlLCBwcm9wcykge1xuXHRcdHJldHVybiBjcmVhdGUoKHByb3RvdHlwZSA9PT0gbnVsbCkgPyBudWxsT2JqZWN0IDogcHJvdG90eXBlLCBwcm9wcyk7XG5cdH07XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vX2l0ZXJhdGUnKSgnZm9yRWFjaCcpO1xuIiwiLy8gRGVwcmVjYXRlZFxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikgeyByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ2Z1bmN0aW9uJzsgfTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1hcCA9IHsgZnVuY3Rpb246IHRydWUsIG9iamVjdDogdHJ1ZSB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAoKHggIT0gbnVsbCkgJiYgbWFwW3R5cGVvZiB4XSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LmtleXNcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHRyeSB7XG5cdFx0T2JqZWN0LmtleXMoJ3ByaW1pdGl2ZScpO1xuXHRcdHJldHVybiB0cnVlO1xuXHR9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGtleXMgPSBPYmplY3Qua2V5cztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG5cdHJldHVybiBrZXlzKG9iamVjdCA9PSBudWxsID8gb2JqZWN0IDogT2JqZWN0KG9iamVjdCkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNhbGxhYmxlID0gcmVxdWlyZSgnLi92YWxpZC1jYWxsYWJsZScpXG4gICwgZm9yRWFjaCAgPSByZXF1aXJlKCcuL2Zvci1lYWNoJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqLCBjYi8qLCB0aGlzQXJnKi8pIHtcblx0dmFyIG8gPSB7fSwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXTtcblx0Y2FsbGFibGUoY2IpO1xuXHRmb3JFYWNoKG9iaiwgZnVuY3Rpb24gKHZhbHVlLCBrZXksIG9iaiwgaW5kZXgpIHtcblx0XHRvW2tleV0gPSBjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCBrZXksIG9iaiwgaW5kZXgpO1xuXHR9KTtcblx0cmV0dXJuIG87XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZm9yRWFjaCA9IEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlO1xuXG52YXIgcHJvY2VzcyA9IGZ1bmN0aW9uIChzcmMsIG9iaikge1xuXHR2YXIga2V5O1xuXHRmb3IgKGtleSBpbiBzcmMpIG9ialtrZXldID0gc3JjW2tleV07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvcHRpb25zLyosIOKApm9wdGlvbnMqLykge1xuXHR2YXIgcmVzdWx0ID0gY3JlYXRlKG51bGwpO1xuXHRmb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbiAob3B0aW9ucykge1xuXHRcdGlmIChvcHRpb25zID09IG51bGwpIHJldHVybjtcblx0XHRwcm9jZXNzKE9iamVjdChvcHRpb25zKSwgcmVzdWx0KTtcblx0fSk7XG5cdHJldHVybiByZXN1bHQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LnNldFByb3RvdHlwZU9mXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBnZXRQcm90b3R5cGVPZiA9IE9iamVjdC5nZXRQcm90b3R5cGVPZlxuICAsIHggPSB7fTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoLypjdXN0b21DcmVhdGUqLykge1xuXHR2YXIgc2V0UHJvdG90eXBlT2YgPSBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0ICAsIGN1c3RvbUNyZWF0ZSA9IGFyZ3VtZW50c1swXSB8fCBjcmVhdGU7XG5cdGlmICh0eXBlb2Ygc2V0UHJvdG90eXBlT2YgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIGdldFByb3RvdHlwZU9mKHNldFByb3RvdHlwZU9mKGN1c3RvbUNyZWF0ZShudWxsKSwgeCkpID09PSB4O1xufTtcbiIsIi8vIEJpZyB0aGFua3MgdG8gQFdlYlJlZmxlY3Rpb24gZm9yIHNvcnRpbmcgdGhpcyBvdXRcbi8vIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL1dlYlJlZmxlY3Rpb24vNTU5MzU1NFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCAgICAgID0gcmVxdWlyZSgnLi4vaXMtb2JqZWN0JylcbiAgLCB2YWx1ZSAgICAgICAgID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgaXNQcm90b3R5cGVPZiA9IE9iamVjdC5wcm90b3R5cGUuaXNQcm90b3R5cGVPZlxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgbnVsbERlc2MgPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfVxuICAsIHZhbGlkYXRlO1xuXG52YWxpZGF0ZSA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHR2YWx1ZShvYmopO1xuXHRpZiAoKHByb3RvdHlwZSA9PT0gbnVsbCkgfHwgaXNPYmplY3QocHJvdG90eXBlKSkgcmV0dXJuIG9iajtcblx0dGhyb3cgbmV3IFR5cGVFcnJvcignUHJvdG90eXBlIG11c3QgYmUgbnVsbCBvciBhbiBvYmplY3QnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uIChzdGF0dXMpIHtcblx0dmFyIGZuLCBzZXQ7XG5cdGlmICghc3RhdHVzKSByZXR1cm4gbnVsbDtcblx0aWYgKHN0YXR1cy5sZXZlbCA9PT0gMikge1xuXHRcdGlmIChzdGF0dXMuc2V0KSB7XG5cdFx0XHRzZXQgPSBzdGF0dXMuc2V0O1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0c2V0LmNhbGwodmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLCBwcm90b3R5cGUpO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0dmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH07XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGZuID0gZnVuY3Rpb24gc2VsZihvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0dmFyIGlzTnVsbEJhc2U7XG5cdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSk7XG5cdFx0XHRpc051bGxCYXNlID0gaXNQcm90b3R5cGVPZi5jYWxsKHNlbGYubnVsbFBvbHlmaWxsLCBvYmopO1xuXHRcdFx0aWYgKGlzTnVsbEJhc2UpIGRlbGV0ZSBzZWxmLm51bGxQb2x5ZmlsbC5fX3Byb3RvX187XG5cdFx0XHRpZiAocHJvdG90eXBlID09PSBudWxsKSBwcm90b3R5cGUgPSBzZWxmLm51bGxQb2x5ZmlsbDtcblx0XHRcdG9iai5fX3Byb3RvX18gPSBwcm90b3R5cGU7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVmaW5lUHJvcGVydHkoc2VsZi5udWxsUG9seWZpbGwsICdfX3Byb3RvX18nLCBudWxsRGVzYyk7XG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH07XG5cdH1cblx0cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShmbiwgJ2xldmVsJywgeyBjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogZmFsc2UsIHZhbHVlOiBzdGF0dXMubGV2ZWwgfSk7XG59KChmdW5jdGlvbiAoKSB7XG5cdHZhciB4ID0gT2JqZWN0LmNyZWF0ZShudWxsKSwgeSA9IHt9LCBzZXRcblx0ICAsIGRlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKE9iamVjdC5wcm90b3R5cGUsICdfX3Byb3RvX18nKTtcblxuXHRpZiAoZGVzYykge1xuXHRcdHRyeSB7XG5cdFx0XHRzZXQgPSBkZXNjLnNldDsgLy8gT3BlcmEgY3Jhc2hlcyBhdCB0aGlzIHBvaW50XG5cdFx0XHRzZXQuY2FsbCh4LCB5KTtcblx0XHR9IGNhdGNoIChpZ25vcmUpIHsgfVxuXHRcdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IHNldDogc2V0LCBsZXZlbDogMiB9O1xuXHR9XG5cblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMiB9O1xuXG5cdHggPSB7fTtcblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMSB9O1xuXG5cdHJldHVybiBmYWxzZTtcbn0oKSkpKTtcblxucmVxdWlyZSgnLi4vY3JlYXRlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZuKSB7XG5cdGlmICh0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpIHRocm93IG5ldyBUeXBlRXJyb3IoZm4gKyBcIiBpcyBub3QgYSBmdW5jdGlvblwiKTtcblx0cmV0dXJuIGZuO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzT2JqZWN0ID0gcmVxdWlyZSgnLi9pcy1vYmplY3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc09iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgYW4gT2JqZWN0XCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB1c2UgbnVsbCBvciB1bmRlZmluZWRcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBTdHJpbmcucHJvdG90eXBlLmNvbnRhaW5zXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzdHIgPSAncmF6ZHdhdHJ6eSc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIHN0ci5jb250YWlucyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKChzdHIuY29udGFpbnMoJ2R3YScpID09PSB0cnVlKSAmJiAoc3RyLmNvbnRhaW5zKCdmb28nKSA9PT0gZmFsc2UpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpbmRleE9mID0gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hTdHJpbmcvKiwgcG9zaXRpb24qLykge1xuXHRyZXR1cm4gaW5kZXhPZi5jYWxsKHRoaXMsIHNlYXJjaFN0cmluZywgYXJndW1lbnRzWzFdKSA+IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZ1xuXG4gICwgaWQgPSB0b1N0cmluZy5jYWxsKCcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKHR5cGVvZiB4ID09PSAnc3RyaW5nJykgfHwgKHggJiYgKHR5cGVvZiB4ID09PSAnb2JqZWN0JykgJiZcblx0XHQoKHggaW5zdGFuY2VvZiBTdHJpbmcpIHx8ICh0b1N0cmluZy5jYWxsKHgpID09PSBpZCkpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBnZW5lcmF0ZWQgPSBPYmplY3QuY3JlYXRlKG51bGwpXG5cbiAgLCByYW5kb20gPSBNYXRoLnJhbmRvbTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzdHI7XG5cdGRvIHsgc3RyID0gcmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpOyB9IHdoaWxlIChnZW5lcmF0ZWRbc3RyXSk7XG5cdHJldHVybiBzdHI7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjb250YWlucyAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIEFycmF5SXRlcmF0b3I7XG5cbkFycmF5SXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhcnIsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEFycmF5SXRlcmF0b3IpKSByZXR1cm4gbmV3IEFycmF5SXRlcmF0b3IoYXJyLCBraW5kKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBhcnIpO1xuXHRpZiAoIWtpbmQpIGtpbmQgPSAndmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXkrdmFsdWUnKSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXknKSkga2luZCA9ICdrZXknO1xuXHRlbHNlIGtpbmQgPSAndmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19raW5kX18nLCBkKCcnLCBraW5kKSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihBcnJheUl0ZXJhdG9yLCBJdGVyYXRvcik7XG5cbkFycmF5SXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoQXJyYXlJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fbGlzdF9fW2ldO1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAna2V5K3ZhbHVlJykgcmV0dXJuIFtpLCB0aGlzLl9fbGlzdF9fW2ldXTtcblx0XHRyZXR1cm4gaTtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEFycmF5IEl0ZXJhdG9yXSc7IH0pXG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIGlzU3RyaW5nID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBnZXQgICAgICA9IHJlcXVpcmUoJy4vZ2V0JylcblxuICAsIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5LCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGl0ZXJhYmxlLCBjYi8qLCB0aGlzQXJnKi8pIHtcblx0dmFyIG1vZGUsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIHJlc3VsdCwgZG9CcmVhaywgYnJva2VuLCBpLCBsLCBjaGFyLCBjb2RlO1xuXHRpZiAoaXNBcnJheShpdGVyYWJsZSkpIG1vZGUgPSAnYXJyYXknO1xuXHRlbHNlIGlmIChpc1N0cmluZyhpdGVyYWJsZSkpIG1vZGUgPSAnc3RyaW5nJztcblx0ZWxzZSBpdGVyYWJsZSA9IGdldChpdGVyYWJsZSk7XG5cblx0Y2FsbGFibGUoY2IpO1xuXHRkb0JyZWFrID0gZnVuY3Rpb24gKCkgeyBicm9rZW4gPSB0cnVlOyB9O1xuXHRpZiAobW9kZSA9PT0gJ2FycmF5Jykge1xuXHRcdGl0ZXJhYmxlLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCBkb0JyZWFrKTtcblx0XHRcdGlmIChicm9rZW4pIHJldHVybiB0cnVlO1xuXHRcdH0pO1xuXHRcdHJldHVybjtcblx0fVxuXHRpZiAobW9kZSA9PT0gJ3N0cmluZycpIHtcblx0XHRsID0gaXRlcmFibGUubGVuZ3RoO1xuXHRcdGZvciAoaSA9IDA7IGkgPCBsOyArK2kpIHtcblx0XHRcdGNoYXIgPSBpdGVyYWJsZVtpXTtcblx0XHRcdGlmICgoaSArIDEpIDwgbCkge1xuXHRcdFx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdFx0XHRpZiAoKGNvZGUgPj0gMHhEODAwKSAmJiAoY29kZSA8PSAweERCRkYpKSBjaGFyICs9IGl0ZXJhYmxlWysraV07XG5cdFx0XHR9XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIGNoYXIsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgYnJlYWs7XG5cdFx0fVxuXHRcdHJldHVybjtcblx0fVxuXHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cblx0d2hpbGUgKCFyZXN1bHQuZG9uZSkge1xuXHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgcmVzdWx0LnZhbHVlLCBkb0JyZWFrKTtcblx0XHRpZiAoYnJva2VuKSByZXR1cm47XG5cdFx0cmVzdWx0ID0gaXRlcmFibGUubmV4dCgpO1xuXHR9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIEFycmF5SXRlcmF0b3IgID0gcmVxdWlyZSgnLi9hcnJheScpXG4gICwgU3RyaW5nSXRlcmF0b3IgPSByZXF1aXJlKCcuL3N0cmluZycpXG4gICwgaXRlcmFibGUgICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLWl0ZXJhYmxlJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG5cdGlmICh0eXBlb2YgaXRlcmFibGUob2JqKVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpIHJldHVybiBvYmpbaXRlcmF0b3JTeW1ib2xdKCk7XG5cdGlmIChpc1N0cmluZyhvYmopKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKG9iaik7XG5cdHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihvYmopO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsZWFyICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2NsZWFyJylcbiAgLCBhc3NpZ24gICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2Fzc2lnbicpXG4gICwgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsdWUgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG4gICwgZCAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBhdXRvQmluZCA9IHJlcXVpcmUoJ2QvYXV0by1iaW5kJylcbiAgLCBTeW1ib2wgICA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBJdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBJdGVyYXRvciA9IGZ1bmN0aW9uIChsaXN0LCBjb250ZXh0KSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBJdGVyYXRvcikpIHJldHVybiBuZXcgSXRlcmF0b3IobGlzdCwgY29udGV4dCk7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fbGlzdF9fOiBkKCd3JywgdmFsdWUobGlzdCkpLFxuXHRcdF9fY29udGV4dF9fOiBkKCd3JywgY29udGV4dCksXG5cdFx0X19uZXh0SW5kZXhfXzogZCgndycsIDApXG5cdH0pO1xuXHRpZiAoIWNvbnRleHQpIHJldHVybjtcblx0Y2FsbGFibGUoY29udGV4dC5vbik7XG5cdGNvbnRleHQub24oJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdGNvbnRleHQub24oJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdGNvbnRleHQub24oJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xufTtcblxuZGVmaW5lUHJvcGVydGllcyhJdGVyYXRvci5wcm90b3R5cGUsIGFzc2lnbih7XG5cdGNvbnN0cnVjdG9yOiBkKEl0ZXJhdG9yKSxcblx0X25leHQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHZhciBpO1xuXHRcdGlmICghdGhpcy5fX2xpc3RfXykgcmV0dXJuO1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRpID0gdGhpcy5fX3JlZG9fXy5zaGlmdCgpO1xuXHRcdFx0aWYgKGkgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGk7XG5cdFx0fVxuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPCB0aGlzLl9fbGlzdF9fLmxlbmd0aCkgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0bmV4dDogZChmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9jcmVhdGVSZXN1bHQodGhpcy5fbmV4dCgpKTsgfSksXG5cdF9jcmVhdGVSZXN1bHQ6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAoaSA9PT0gdW5kZWZpbmVkKSByZXR1cm4geyBkb25lOiB0cnVlLCB2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0cmV0dXJuIHsgZG9uZTogZmFsc2UsIHZhbHVlOiB0aGlzLl9yZXNvbHZlKGkpIH07XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkgeyByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTsgfSksXG5cdF91bkJpbmQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHRoaXMuX19saXN0X18gPSBudWxsO1xuXHRcdGRlbGV0ZSB0aGlzLl9fcmVkb19fO1xuXHRcdGlmICghdGhpcy5fX2NvbnRleHRfXykgcmV0dXJuO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfYWRkJywgdGhpcy5fb25BZGQpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfZGVsZXRlJywgdGhpcy5fb25EZWxldGUpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfY2xlYXInLCB0aGlzLl9vbkNsZWFyKTtcblx0XHR0aGlzLl9fY29udGV4dF9fID0gbnVsbDtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEl0ZXJhdG9yXSc7IH0pXG59LCBhdXRvQmluZCh7XG5cdF9vbkFkZDogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0Kyt0aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19yZWRvX18nLCBkKCdjJywgW2luZGV4XSkpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID49IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gKytyZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHRcdHRoaXMuX19yZWRvX18ucHVzaChpbmRleCk7XG5cdH0pLFxuXHRfb25EZWxldGU6IGQoZnVuY3Rpb24gKGluZGV4KSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKGluZGV4ID49IHRoaXMuX19uZXh0SW5kZXhfXykgcmV0dXJuO1xuXHRcdC0tdGhpcy5fX25leHRJbmRleF9fO1xuXHRcdGlmICghdGhpcy5fX3JlZG9fXykgcmV0dXJuO1xuXHRcdGkgPSB0aGlzLl9fcmVkb19fLmluZGV4T2YoaW5kZXgpO1xuXHRcdGlmIChpICE9PSAtMSkgdGhpcy5fX3JlZG9fXy5zcGxpY2UoaSwgMSk7XG5cdFx0dGhpcy5fX3JlZG9fXy5mb3JFYWNoKGZ1bmN0aW9uIChyZWRvLCBpKSB7XG5cdFx0XHRpZiAocmVkbyA+IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gLS1yZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHR9KSxcblx0X29uQ2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSBjbGVhci5jYWxsKHRoaXMuX19yZWRvX18pO1xuXHRcdHRoaXMuX19uZXh0SW5kZXhfXyA9IDA7XG5cdH0pXG59KSkpO1xuXG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChmdW5jdGlvbiAoKSB7XG5cdHJldHVybiB0aGlzO1xufSkpO1xuZGVmaW5lUHJvcGVydHkoSXRlcmF0b3IucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJycsICdJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3RyaW5nICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvclxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG5cdGlmIChpc0FycmF5KHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdGlmIChpc1N0cmluZyh2YWx1ZSkpIHJldHVybiB0cnVlO1xuXHRyZXR1cm4gKHR5cGVvZiB2YWx1ZVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpO1xufTtcbiIsIi8vIFRoYW5rcyBAbWF0aGlhc2J5bmVuc1xuLy8gaHR0cDovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC11bmljb2RlI2l0ZXJhdGluZy1vdmVyLXN5bWJvbHNcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi8nKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTdHJpbmdJdGVyYXRvcjtcblxuU3RyaW5nSXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzdHIpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFN0cmluZ0l0ZXJhdG9yKSkgcmV0dXJuIG5ldyBTdHJpbmdJdGVyYXRvcihzdHIpO1xuXHRzdHIgPSBTdHJpbmcoc3RyKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBzdHIpO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19sZW5ndGhfXycsIGQoJycsIHN0ci5sZW5ndGgpKTtcblxufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU3RyaW5nSXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuU3RyaW5nSXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3RyaW5nSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19sZW5ndGhfXykgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHR2YXIgY2hhciA9IHRoaXMuX19saXN0X19baV0sIGNvZGU7XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA9PT0gdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gY2hhcjtcblx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIHJldHVybiBjaGFyICsgdGhpcy5fX2xpc3RfX1t0aGlzLl9fbmV4dEluZGV4X18rK107XG5cdFx0cmV0dXJuIGNoYXI7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBTdHJpbmcgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNJdGVyYWJsZSA9IHJlcXVpcmUoJy4vaXMtaXRlcmFibGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc0l0ZXJhYmxlKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBpdGVyYWJsZVwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IFN5bWJvbCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0eXBlb2YgU3ltYm9sICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHN5bWJvbCA9IFN5bWJvbCgndGVzdCBzeW1ib2wnKTtcblx0dHJ5IHsgU3RyaW5nKHN5bWJvbCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSAnc3ltYm9sJykgcmV0dXJuIHRydWU7XG5cblx0Ly8gUmV0dXJuICd0cnVlJyBmb3IgcG9seWZpbGxzXG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzQ29uY2F0U3ByZWFkYWJsZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvUHJpbWl0aXZlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1N0cmluZ1RhZyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudW5zY29wYWJsZXMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAoeCAmJiAoKHR5cGVvZiB4ID09PSAnc3ltYm9sJykgfHwgKHhbJ0BAdG9TdHJpbmdUYWcnXSA9PT0gJ1N5bWJvbCcpKSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCB2YWxpZGF0ZVN5bWJvbCA9IHJlcXVpcmUoJy4vdmFsaWRhdGUtc3ltYm9sJylcblxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5LCBvYmpQcm90b3R5cGUgPSBPYmplY3QucHJvdG90eXBlXG4gICwgU3ltYm9sLCBIaWRkZW5TeW1ib2wsIGdsb2JhbFN5bWJvbHMgPSBjcmVhdGUobnVsbCk7XG5cbnZhciBnZW5lcmF0ZU5hbWUgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgY3JlYXRlZCA9IGNyZWF0ZShudWxsKTtcblx0cmV0dXJuIGZ1bmN0aW9uIChkZXNjKSB7XG5cdFx0dmFyIHBvc3RmaXggPSAwLCBuYW1lO1xuXHRcdHdoaWxlIChjcmVhdGVkW2Rlc2MgKyAocG9zdGZpeCB8fCAnJyldKSArK3Bvc3RmaXg7XG5cdFx0ZGVzYyArPSAocG9zdGZpeCB8fCAnJyk7XG5cdFx0Y3JlYXRlZFtkZXNjXSA9IHRydWU7XG5cdFx0bmFtZSA9ICdAQCcgKyBkZXNjO1xuXHRcdGRlZmluZVByb3BlcnR5KG9ialByb3RvdHlwZSwgbmFtZSwgZC5ncyhudWxsLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGQodmFsdWUpKTtcblx0XHR9KSk7XG5cdFx0cmV0dXJuIG5hbWU7XG5cdH07XG59KCkpO1xuXG5IaWRkZW5TeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBIaWRkZW5TeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHJldHVybiBTeW1ib2woZGVzY3JpcHRpb24pO1xufTtcbm1vZHVsZS5leHBvcnRzID0gU3ltYm9sID0gZnVuY3Rpb24gU3ltYm9sKGRlc2NyaXB0aW9uKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgU3ltYm9sKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHRzeW1ib2wgPSBjcmVhdGUoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSk7XG5cdGRlc2NyaXB0aW9uID0gKGRlc2NyaXB0aW9uID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyhkZXNjcmlwdGlvbikpO1xuXHRyZXR1cm4gZGVmaW5lUHJvcGVydGllcyhzeW1ib2wsIHtcblx0XHRfX2Rlc2NyaXB0aW9uX186IGQoJycsIGRlc2NyaXB0aW9uKSxcblx0XHRfX25hbWVfXzogZCgnJywgZ2VuZXJhdGVOYW1lKGRlc2NyaXB0aW9uKSlcblx0fSk7XG59O1xuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wsIHtcblx0Zm9yOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoZ2xvYmFsU3ltYm9sc1trZXldKSByZXR1cm4gZ2xvYmFsU3ltYm9sc1trZXldO1xuXHRcdHJldHVybiAoZ2xvYmFsU3ltYm9sc1trZXldID0gU3ltYm9sKFN0cmluZyhrZXkpKSk7XG5cdH0pLFxuXHRrZXlGb3I6IGQoZnVuY3Rpb24gKHMpIHtcblx0XHR2YXIga2V5O1xuXHRcdHZhbGlkYXRlU3ltYm9sKHMpO1xuXHRcdGZvciAoa2V5IGluIGdsb2JhbFN5bWJvbHMpIGlmIChnbG9iYWxTeW1ib2xzW2tleV0gPT09IHMpIHJldHVybiBrZXk7XG5cdH0pLFxuXHRoYXNJbnN0YW5jZTogZCgnJywgU3ltYm9sKCdoYXNJbnN0YW5jZScpKSxcblx0aXNDb25jYXRTcHJlYWRhYmxlOiBkKCcnLCBTeW1ib2woJ2lzQ29uY2F0U3ByZWFkYWJsZScpKSxcblx0aXRlcmF0b3I6IGQoJycsIFN5bWJvbCgnaXRlcmF0b3InKSksXG5cdG1hdGNoOiBkKCcnLCBTeW1ib2woJ21hdGNoJykpLFxuXHRyZXBsYWNlOiBkKCcnLCBTeW1ib2woJ3JlcGxhY2UnKSksXG5cdHNlYXJjaDogZCgnJywgU3ltYm9sKCdzZWFyY2gnKSksXG5cdHNwZWNpZXM6IGQoJycsIFN5bWJvbCgnc3BlY2llcycpKSxcblx0c3BsaXQ6IGQoJycsIFN5bWJvbCgnc3BsaXQnKSksXG5cdHRvUHJpbWl0aXZlOiBkKCcnLCBTeW1ib2woJ3RvUHJpbWl0aXZlJykpLFxuXHR0b1N0cmluZ1RhZzogZCgnJywgU3ltYm9sKCd0b1N0cmluZ1RhZycpKSxcblx0dW5zY29wYWJsZXM6IGQoJycsIFN5bWJvbCgndW5zY29wYWJsZXMnKSlcbn0pO1xuZGVmaW5lUHJvcGVydGllcyhIaWRkZW5TeW1ib2wucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFN5bWJvbCksXG5cdHRvU3RyaW5nOiBkKCcnLCBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbmFtZV9fOyB9KVxufSk7XG5cbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLnByb3RvdHlwZSwge1xuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnU3ltYm9sICgnICsgdmFsaWRhdGVTeW1ib2wodGhpcykuX19kZXNjcmlwdGlvbl9fICsgJyknOyB9KSxcblx0dmFsdWVPZjogZChmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSlcbn0pO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLCBkKCcnLFxuXHRmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSkpO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1N5bWJvbCcpKTtcblxuZGVmaW5lUHJvcGVydHkoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLFxuXHRkKCdjJywgU3ltYm9sLnByb3RvdHlwZVtTeW1ib2wudG9QcmltaXRpdmVdKSk7XG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1N0cmluZ1RhZ10pKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3ltYm9sID0gcmVxdWlyZSgnLi9pcy1zeW1ib2wnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc1N5bWJvbCh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgYSBzeW1ib2xcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIG9iamVjdCAgICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtb2JqZWN0JylcbiAgLCB2YWx1ZSAgICAgICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCByYW5kb21VbmlxICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL3JhbmRvbS11bmlxJylcbiAgLCBkICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGdldEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL2dldCcpXG4gICwgZm9yT2YgICAgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZm9yLW9mJylcbiAgLCB0b1N0cmluZ1RhZ1N5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS50b1N0cmluZ1RhZ1xuICAsIGlzTmF0aXZlICAgICAgICAgID0gcmVxdWlyZSgnLi9pcy1uYXRpdmUtaW1wbGVtZW50ZWQnKVxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXksIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LCBnZXRQcm90b3R5cGVPZiA9IE9iamVjdC5nZXRQcm90b3R5cGVPZlxuICAsIFdlYWtNYXBQb2x5O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYWtNYXBQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF0sIHNlbGY7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBXZWFrTWFwUG9seSkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0NvbnN0cnVjdG9yIHJlcXVpcmVzIFxcJ25ld1xcJycpO1xuXHRpZiAoaXNOYXRpdmUgJiYgc2V0UHJvdG90eXBlT2YgJiYgKFdlYWtNYXAgIT09IFdlYWtNYXBQb2x5KSkge1xuXHRcdHNlbGYgPSBzZXRQcm90b3R5cGVPZihuZXcgV2Vha01hcCgpLCBnZXRQcm90b3R5cGVPZih0aGlzKSk7XG5cdH0gZWxzZSB7XG5cdFx0c2VsZiA9IHRoaXM7XG5cdH1cblx0aWYgKGl0ZXJhYmxlICE9IG51bGwpIHtcblx0XHRpZiAoIWlzQXJyYXkoaXRlcmFibGUpKSBpdGVyYWJsZSA9IGdldEl0ZXJhdG9yKGl0ZXJhYmxlKTtcblx0fVxuXHRkZWZpbmVQcm9wZXJ0eShzZWxmLCAnX193ZWFrTWFwRGF0YV9fJywgZCgnYycsICckd2Vha01hcCQnICsgcmFuZG9tVW5pcSgpKSk7XG5cdGlmICghaXRlcmFibGUpIHJldHVybiBzZWxmO1xuXHRmb3JPZihpdGVyYWJsZSwgZnVuY3Rpb24gKHZhbCkge1xuXHRcdHZhbHVlKHZhbCk7XG5cdFx0c2VsZi5zZXQodmFsWzBdLCB2YWxbMV0pO1xuXHR9KTtcblx0cmV0dXJuIHNlbGY7XG59O1xuXG5pZiAoaXNOYXRpdmUpIHtcblx0aWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihXZWFrTWFwUG9seSwgV2Vha01hcCk7XG5cdFdlYWtNYXBQb2x5LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoV2Vha01hcC5wcm90b3R5cGUsIHtcblx0XHRjb25zdHJ1Y3RvcjogZChXZWFrTWFwUG9seSlcblx0fSk7XG59XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKFdlYWtNYXBQb2x5LnByb3RvdHlwZSwge1xuXHRkZWxldGU6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXykpIHtcblx0XHRcdGRlbGV0ZSBrZXlbdGhpcy5fX3dlYWtNYXBEYXRhX19dO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fSksXG5cdGdldDogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0KGtleSksIHRoaXMuX193ZWFrTWFwRGF0YV9fKSkge1xuXHRcdFx0cmV0dXJuIGtleVt0aGlzLl9fd2Vha01hcERhdGFfX107XG5cdFx0fVxuXHR9KSxcblx0aGFzOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRyZXR1cm4gaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3Qoa2V5KSwgdGhpcy5fX3dlYWtNYXBEYXRhX18pO1xuXHR9KSxcblx0c2V0OiBkKGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG5cdFx0ZGVmaW5lUHJvcGVydHkob2JqZWN0KGtleSksIHRoaXMuX193ZWFrTWFwRGF0YV9fLCBkKCdjJywgdmFsdWUpKTtcblx0XHRyZXR1cm4gdGhpcztcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFdlYWtNYXBdJzsgfSlcbn0pO1xuZGVmaW5lUHJvcGVydHkoV2Vha01hcFBvbHkucHJvdG90eXBlLCB0b1N0cmluZ1RhZ1N5bWJvbCwgZCgnYycsICdXZWFrTWFwJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gTWFwIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIG1hcCwgaXRlcmF0b3IsIHJlc3VsdDtcblx0aWYgKHR5cGVvZiBNYXAgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0dHJ5IHtcblx0XHQvLyBXZWJLaXQgZG9lc24ndCBzdXBwb3J0IGFyZ3VtZW50cyBhbmQgY3Jhc2hlc1xuXHRcdG1hcCA9IG5ldyBNYXAoW1sncmF6JywgJ29uZSddLCBbJ2R3YScsICd0d28nXSwgWyd0cnp5JywgJ3RocmVlJ11dKTtcblx0fSBjYXRjaCAoZSkge1xuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXHRpZiAobWFwLnNpemUgIT09IDMpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuY2xlYXIgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZGVsZXRlICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmVudHJpZXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5nZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuaGFzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmtleXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuc2V0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLnZhbHVlcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG5cdGl0ZXJhdG9yID0gbWFwLmVudHJpZXMoKTtcblx0cmVzdWx0ID0gaXRlcmF0b3IubmV4dCgpO1xuXHRpZiAocmVzdWx0LmRvbmUgIT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG5cdGlmICghcmVzdWx0LnZhbHVlKSByZXR1cm4gZmFsc2U7XG5cdGlmIChyZXN1bHQudmFsdWVbMF0gIT09ICdyYXonKSByZXR1cm4gZmFsc2U7XG5cdGlmIChyZXN1bHQudmFsdWVbMV0gIT09ICdvbmUnKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiB0cnVlO1xufTtcbiIsIi8vIEV4cG9ydHMgdHJ1ZSBpZiBlbnZpcm9ubWVudCBwcm92aWRlcyBuYXRpdmUgYE1hcGAgaW1wbGVtZW50YXRpb24sXG4vLyB3aGF0ZXZlciB0aGF0IGlzLlxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0aWYgKHR5cGVvZiBNYXAgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKE1hcC5wcm90b3R5cGUpID09PSAnW29iamVjdCBNYXBdJyk7XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ByaW1pdGl2ZS1zZXQnKSgna2V5Jyxcblx0J3ZhbHVlJywgJ2tleSt2YWx1ZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBkICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yJylcbiAgLCB0b1N0cmluZ1RhZ1N5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS50b1N0cmluZ1RhZ1xuICAsIGtpbmRzICAgICAgICAgICAgID0gcmVxdWlyZSgnLi9pdGVyYXRvci1raW5kcycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCB1bkJpbmQgPSBJdGVyYXRvci5wcm90b3R5cGUuX3VuQmluZFxuICAsIE1hcEl0ZXJhdG9yO1xuXG5NYXBJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG1hcCwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgTWFwSXRlcmF0b3IpKSByZXR1cm4gbmV3IE1hcEl0ZXJhdG9yKG1hcCwga2luZCk7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgbWFwLl9fbWFwS2V5c0RhdGFfXywgbWFwKTtcblx0aWYgKCFraW5kIHx8ICFraW5kc1traW5kXSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX2tpbmRfXzogZCgnJywga2luZCksXG5cdFx0X192YWx1ZXNfXzogZCgndycsIG1hcC5fX21hcFZhbHVlc0RhdGFfXylcblx0fSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihNYXBJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5NYXBJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChNYXBJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fdmFsdWVzX19baV07XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICdrZXknKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRyZXR1cm4gW3RoaXMuX19saXN0X19baV0sIHRoaXMuX192YWx1ZXNfX1tpXV07XG5cdH0pLFxuXHRfdW5CaW5kOiBkKGZ1bmN0aW9uICgpIHtcblx0XHR0aGlzLl9fdmFsdWVzX18gPSBudWxsO1xuXHRcdHVuQmluZC5jYWxsKHRoaXMpO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgTWFwIEl0ZXJhdG9yXSc7IH0pXG59KTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShNYXBJdGVyYXRvci5wcm90b3R5cGUsIHRvU3RyaW5nVGFnU3ltYm9sLFxuXHRkKCdjJywgJ01hcCBJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNvcHkgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9jb3B5JylcbiAgLCBtYXAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvbWFwJylcbiAgLCBjYWxsYWJsZSAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbGlkVmFsdWUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG5cbiAgLCBiaW5kID0gRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZGVmaW5lO1xuXG5kZWZpbmUgPSBmdW5jdGlvbiAobmFtZSwgZGVzYywgYmluZFRvKSB7XG5cdHZhciB2YWx1ZSA9IHZhbGlkVmFsdWUoZGVzYykgJiYgY2FsbGFibGUoZGVzYy52YWx1ZSksIGRncztcblx0ZGdzID0gY29weShkZXNjKTtcblx0ZGVsZXRlIGRncy53cml0YWJsZTtcblx0ZGVsZXRlIGRncy52YWx1ZTtcblx0ZGdzLmdldCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKSkgcmV0dXJuIHZhbHVlO1xuXHRcdGRlc2MudmFsdWUgPSBiaW5kLmNhbGwodmFsdWUsIChiaW5kVG8gPT0gbnVsbCkgPyB0aGlzIDogdGhpc1tiaW5kVG9dKTtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCBuYW1lLCBkZXNjKTtcblx0XHRyZXR1cm4gdGhpc1tuYW1lXTtcblx0fTtcblx0cmV0dXJuIGRncztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHByb3BzLyosIGJpbmRUbyovKSB7XG5cdHZhciBiaW5kVG8gPSBhcmd1bWVudHNbMV07XG5cdHJldHVybiBtYXAocHJvcHMsIGZ1bmN0aW9uIChkZXNjLCBuYW1lKSB7XG5cdFx0cmV0dXJuIGRlZmluZShuYW1lLCBkZXNjLCBiaW5kVG8pO1xuXHR9KTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc3NpZ24gICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvYXNzaWduJylcbiAgLCBub3JtYWxpemVPcHRzID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvbm9ybWFsaXplLW9wdGlvbnMnKVxuICAsIGlzQ2FsbGFibGUgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9pcy1jYWxsYWJsZScpXG4gICwgY29udGFpbnMgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuXG4gICwgZDtcblxuZCA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRzY3IsIHZhbHVlLyosIG9wdGlvbnMqLykge1xuXHR2YXIgYywgZSwgdywgb3B0aW9ucywgZGVzYztcblx0aWYgKChhcmd1bWVudHMubGVuZ3RoIDwgMikgfHwgKHR5cGVvZiBkc2NyICE9PSAnc3RyaW5nJykpIHtcblx0XHRvcHRpb25zID0gdmFsdWU7XG5cdFx0dmFsdWUgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbMl07XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB3ID0gdHJ1ZTtcblx0XHRlID0gZmFsc2U7XG5cdH0gZWxzZSB7XG5cdFx0YyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2MnKTtcblx0XHRlID0gY29udGFpbnMuY2FsbChkc2NyLCAnZScpO1xuXHRcdHcgPSBjb250YWlucy5jYWxsKGRzY3IsICd3Jyk7XG5cdH1cblxuXHRkZXNjID0geyB2YWx1ZTogdmFsdWUsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSwgd3JpdGFibGU6IHcgfTtcblx0cmV0dXJuICFvcHRpb25zID8gZGVzYyA6IGFzc2lnbihub3JtYWxpemVPcHRzKG9wdGlvbnMpLCBkZXNjKTtcbn07XG5cbmQuZ3MgPSBmdW5jdGlvbiAoZHNjciwgZ2V0LCBzZXQvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCBvcHRpb25zLCBkZXNjO1xuXHRpZiAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSBnZXQ7XG5cdFx0Z2V0ID0gZHNjcjtcblx0XHRkc2NyID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRvcHRpb25zID0gYXJndW1lbnRzWzNdO1xuXHR9XG5cdGlmIChnZXQgPT0gbnVsbCkge1xuXHRcdGdldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShnZXQpKSB7XG5cdFx0b3B0aW9ucyA9IGdldDtcblx0XHRnZXQgPSBzZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoc2V0ID09IG51bGwpIHtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoIWlzQ2FsbGFibGUoc2V0KSkge1xuXHRcdG9wdGlvbnMgPSBzZXQ7XG5cdFx0c2V0ID0gdW5kZWZpbmVkO1xuXHR9XG5cdGlmIChkc2NyID09IG51bGwpIHtcblx0XHRjID0gdHJ1ZTtcblx0XHRlID0gZmFsc2U7XG5cdH0gZWxzZSB7XG5cdFx0YyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2MnKTtcblx0XHRlID0gY29udGFpbnMuY2FsbChkc2NyLCAnZScpO1xuXHR9XG5cblx0ZGVzYyA9IHsgZ2V0OiBnZXQsIHNldDogc2V0LCBjb25maWd1cmFibGU6IGMsIGVudW1lcmFibGU6IGUgfTtcblx0cmV0dXJuICFvcHRpb25zID8gZGVzYyA6IGFzc2lnbihub3JtYWxpemVPcHRzKG9wdGlvbnMpLCBkZXNjKTtcbn07XG4iLCIvLyBJbnNwaXJlZCBieSBHb29nbGUgQ2xvc3VyZTpcbi8vIGh0dHA6Ly9jbG9zdXJlLWxpYnJhcnkuZ29vZ2xlY29kZS5jb20vc3ZuL2RvY3MvXG4vLyBjbG9zdXJlX2dvb2dfYXJyYXlfYXJyYXkuanMuaHRtbCNnb29nLmFycmF5LmNsZWFyXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHZhbHVlID0gcmVxdWlyZSgnLi4vLi4vb2JqZWN0L3ZhbGlkLXZhbHVlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YWx1ZSh0aGlzKS5sZW5ndGggPSAwO1xuXHRyZXR1cm4gdGhpcztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b1Bvc0ludCA9IHJlcXVpcmUoJy4uLy4uL251bWJlci90by1wb3MtaW50ZWdlcicpXG4gICwgdmFsdWUgICAgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKVxuXG4gICwgaW5kZXhPZiA9IEFycmF5LnByb3RvdHlwZS5pbmRleE9mXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgYWJzID0gTWF0aC5hYnMsIGZsb29yID0gTWF0aC5mbG9vcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc2VhcmNoRWxlbWVudC8qLCBmcm9tSW5kZXgqLykge1xuXHR2YXIgaSwgbCwgZnJvbUluZGV4LCB2YWw7XG5cdGlmIChzZWFyY2hFbGVtZW50ID09PSBzZWFyY2hFbGVtZW50KSB7IC8vanNsaW50OiBpZ25vcmVcblx0XHRyZXR1cm4gaW5kZXhPZi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuXHR9XG5cblx0bCA9IHRvUG9zSW50KHZhbHVlKHRoaXMpLmxlbmd0aCk7XG5cdGZyb21JbmRleCA9IGFyZ3VtZW50c1sxXTtcblx0aWYgKGlzTmFOKGZyb21JbmRleCkpIGZyb21JbmRleCA9IDA7XG5cdGVsc2UgaWYgKGZyb21JbmRleCA+PSAwKSBmcm9tSW5kZXggPSBmbG9vcihmcm9tSW5kZXgpO1xuXHRlbHNlIGZyb21JbmRleCA9IHRvUG9zSW50KHRoaXMubGVuZ3RoKSAtIGZsb29yKGFicyhmcm9tSW5kZXgpKTtcblxuXHRmb3IgKGkgPSBmcm9tSW5kZXg7IGkgPCBsOyArK2kpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBpKSkge1xuXHRcdFx0dmFsID0gdGhpc1tpXTtcblx0XHRcdGlmICh2YWwgIT09IHZhbCkgcmV0dXJuIGk7IC8vanNsaW50OiBpZ25vcmVcblx0XHR9XG5cdH1cblx0cmV0dXJuIC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE1hdGguc2lnblxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHNpZ24gPSBNYXRoLnNpZ247XG5cdGlmICh0eXBlb2Ygc2lnbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKChzaWduKDEwKSA9PT0gMSkgJiYgKHNpZ24oLTIwKSA9PT0gLTEpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdHZhbHVlID0gTnVtYmVyKHZhbHVlKTtcblx0aWYgKGlzTmFOKHZhbHVlKSB8fCAodmFsdWUgPT09IDApKSByZXR1cm4gdmFsdWU7XG5cdHJldHVybiAodmFsdWUgPiAwKSA/IDEgOiAtMTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzaWduID0gcmVxdWlyZSgnLi4vbWF0aC9zaWduJylcblxuICAsIGFicyA9IE1hdGguYWJzLCBmbG9vciA9IE1hdGguZmxvb3I7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmIChpc05hTih2YWx1ZSkpIHJldHVybiAwO1xuXHR2YWx1ZSA9IE51bWJlcih2YWx1ZSk7XG5cdGlmICgodmFsdWUgPT09IDApIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcblx0cmV0dXJuIHNpZ24odmFsdWUpICogZmxvb3IoYWJzKHZhbHVlKSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9JbnRlZ2VyID0gcmVxdWlyZSgnLi90by1pbnRlZ2VyJylcblxuICAsIG1heCA9IE1hdGgubWF4O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkgeyByZXR1cm4gbWF4KDAsIHRvSW50ZWdlcih2YWx1ZSkpOyB9O1xuIiwiLy8gSW50ZXJuYWwgbWV0aG9kLCB1c2VkIGJ5IGl0ZXJhdGlvbiBmdW5jdGlvbnMuXG4vLyBDYWxscyBhIGZ1bmN0aW9uIGZvciBlYWNoIGtleS12YWx1ZSBwYWlyIGZvdW5kIGluIG9iamVjdFxuLy8gT3B0aW9uYWxseSB0YWtlcyBjb21wYXJlRm4gdG8gaXRlcmF0ZSBvYmplY3QgaW4gc3BlY2lmaWMgb3JkZXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNDYWxsYWJsZSA9IHJlcXVpcmUoJy4vaXMtY2FsbGFibGUnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICAgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGtleXMgPSBPYmplY3Qua2V5c1xuICAsIHByb3BlcnR5SXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCBkZWZWYWwpIHtcblx0cmV0dXJuIGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcsIGNvbXBhcmVGbiovKSB7XG5cdFx0dmFyIGxpc3QsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIGNvbXBhcmVGbiA9IGFyZ3VtZW50c1szXTtcblx0XHRvYmogPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdFx0Y2FsbGFibGUoY2IpO1xuXG5cdFx0bGlzdCA9IGtleXMob2JqKTtcblx0XHRpZiAoY29tcGFyZUZuKSB7XG5cdFx0XHRsaXN0LnNvcnQoaXNDYWxsYWJsZShjb21wYXJlRm4pID8gY29tcGFyZUZuLmJpbmQob2JqKSA6IHVuZGVmaW5lZCk7XG5cdFx0fVxuXHRcdHJldHVybiBsaXN0W21ldGhvZF0oZnVuY3Rpb24gKGtleSwgaW5kZXgpIHtcblx0XHRcdGlmICghcHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmosIGtleSkpIHJldHVybiBkZWZWYWw7XG5cdFx0XHRyZXR1cm4gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCBvYmpba2V5XSwga2V5LCBvYmosIGluZGV4KTtcblx0XHR9KTtcblx0fTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3QuYXNzaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgYXNzaWduID0gT2JqZWN0LmFzc2lnbiwgb2JqO1xuXHRpZiAodHlwZW9mIGFzc2lnbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRvYmogPSB7IGZvbzogJ3JheicgfTtcblx0YXNzaWduKG9iaiwgeyBiYXI6ICdkd2EnIH0sIHsgdHJ6eTogJ3RyenknIH0pO1xuXHRyZXR1cm4gKG9iai5mb28gKyBvYmouYmFyICsgb2JqLnRyenkpID09PSAncmF6ZHdhdHJ6eSc7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyAgPSByZXF1aXJlKCcuLi9rZXlzJylcbiAgLCB2YWx1ZSA9IHJlcXVpcmUoJy4uL3ZhbGlkLXZhbHVlJylcblxuICAsIG1heCA9IE1hdGgubWF4O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkZXN0LCBzcmMvKiwg4oCmc3JjbiovKSB7XG5cdHZhciBlcnJvciwgaSwgbCA9IG1heChhcmd1bWVudHMubGVuZ3RoLCAyKSwgYXNzaWduO1xuXHRkZXN0ID0gT2JqZWN0KHZhbHVlKGRlc3QpKTtcblx0YXNzaWduID0gZnVuY3Rpb24gKGtleSkge1xuXHRcdHRyeSB7IGRlc3Rba2V5XSA9IHNyY1trZXldOyB9IGNhdGNoIChlKSB7XG5cdFx0XHRpZiAoIWVycm9yKSBlcnJvciA9IGU7XG5cdFx0fVxuXHR9O1xuXHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSB7XG5cdFx0c3JjID0gYXJndW1lbnRzW2ldO1xuXHRcdGtleXMoc3JjKS5mb3JFYWNoKGFzc2lnbik7XG5cdH1cblx0aWYgKGVycm9yICE9PSB1bmRlZmluZWQpIHRocm93IGVycm9yO1xuXHRyZXR1cm4gZGVzdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc3NpZ24gPSByZXF1aXJlKCcuL2Fzc2lnbicpXG4gICwgdmFsdWUgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0dmFyIGNvcHkgPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdGlmIChjb3B5ICE9PSBvYmopIHJldHVybiBjb3B5O1xuXHRyZXR1cm4gYXNzaWduKHt9LCBvYmopO1xufTtcbiIsIi8vIFdvcmthcm91bmQgZm9yIGh0dHA6Ly9jb2RlLmdvb2dsZS5jb20vcC92OC9pc3N1ZXMvZGV0YWlsP2lkPTI4MDRcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgc2hpbTtcblxuaWYgKCFyZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2YvaXMtaW1wbGVtZW50ZWQnKSgpKSB7XG5cdHNoaW0gPSByZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2Yvc2hpbScpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBudWxsT2JqZWN0LCBwcm9wcywgZGVzYztcblx0aWYgKCFzaGltKSByZXR1cm4gY3JlYXRlO1xuXHRpZiAoc2hpbS5sZXZlbCAhPT0gMSkgcmV0dXJuIGNyZWF0ZTtcblxuXHRudWxsT2JqZWN0ID0ge307XG5cdHByb3BzID0ge307XG5cdGRlc2MgPSB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKE9iamVjdC5wcm90b3R5cGUpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcblx0XHRpZiAobmFtZSA9PT0gJ19fcHJvdG9fXycpIHtcblx0XHRcdHByb3BzW25hbWVdID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHRcdFx0dmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRwcm9wc1tuYW1lXSA9IGRlc2M7XG5cdH0pO1xuXHRPYmplY3QuZGVmaW5lUHJvcGVydGllcyhudWxsT2JqZWN0LCBwcm9wcyk7XG5cblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHNoaW0sICdudWxsUG9seWZpbGwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IG51bGxPYmplY3QgfSk7XG5cblx0cmV0dXJuIGZ1bmN0aW9uIChwcm90b3R5cGUsIHByb3BzKSB7XG5cdFx0cmV0dXJuIGNyZWF0ZSgocHJvdG90eXBlID09PSBudWxsKSA/IG51bGxPYmplY3QgOiBwcm90b3R5cGUsIHByb3BzKTtcblx0fTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9faXRlcmF0ZScpKCdmb3JFYWNoJyk7XG4iLCIvLyBEZXByZWNhdGVkXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7IHJldHVybiB0eXBlb2Ygb2JqID09PSAnZnVuY3Rpb24nOyB9O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgbWFwID0geyBmdW5jdGlvbjogdHJ1ZSwgb2JqZWN0OiB0cnVlIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICgoeCAhPSBudWxsKSAmJiBtYXBbdHlwZW9mIHhdKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Qua2V5c1xuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dHJ5IHtcblx0XHRPYmplY3Qua2V5cygncHJpbWl0aXZlJyk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyA9IE9iamVjdC5rZXlzO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmplY3QpIHtcblx0cmV0dXJuIGtleXMob2JqZWN0ID09IG51bGwgPyBvYmplY3QgOiBPYmplY3Qob2JqZWN0KSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBmb3JFYWNoICA9IHJlcXVpcmUoJy4vZm9yLWVhY2gnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbyA9IHt9LCB0aGlzQXJnID0gYXJndW1lbnRzWzJdO1xuXHRjYWxsYWJsZShjYik7XG5cdGZvckVhY2gob2JqLCBmdW5jdGlvbiAodmFsdWUsIGtleSwgb2JqLCBpbmRleCkge1xuXHRcdG9ba2V5XSA9IGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGtleSwgb2JqLCBpbmRleCk7XG5cdH0pO1xuXHRyZXR1cm4gbztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2gsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG5cbnZhciBwcm9jZXNzID0gZnVuY3Rpb24gKHNyYywgb2JqKSB7XG5cdHZhciBrZXk7XG5cdGZvciAoa2V5IGluIHNyYykgb2JqW2tleV0gPSBzcmNba2V5XTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMvKiwg4oCmb3B0aW9ucyovKSB7XG5cdHZhciByZXN1bHQgPSBjcmVhdGUobnVsbCk7XG5cdGZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uIChvcHRpb25zKSB7XG5cdFx0aWYgKG9wdGlvbnMgPT0gbnVsbCkgcmV0dXJuO1xuXHRcdHByb2Nlc3MoT2JqZWN0KG9wdGlvbnMpLCByZXN1bHQpO1xuXHR9KTtcblx0cmV0dXJuIHJlc3VsdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2gsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFyZy8qLCDigKZhcmdzKi8pIHtcblx0dmFyIHNldCA9IGNyZWF0ZShudWxsKTtcblx0Zm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24gKG5hbWUpIHsgc2V0W25hbWVdID0gdHJ1ZTsgfSk7XG5cdHJldHVybiBzZXQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LnNldFByb3RvdHlwZU9mXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBnZXRQcm90b3R5cGVPZiA9IE9iamVjdC5nZXRQcm90b3R5cGVPZlxuICAsIHggPSB7fTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoLypjdXN0b21DcmVhdGUqLykge1xuXHR2YXIgc2V0UHJvdG90eXBlT2YgPSBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0ICAsIGN1c3RvbUNyZWF0ZSA9IGFyZ3VtZW50c1swXSB8fCBjcmVhdGU7XG5cdGlmICh0eXBlb2Ygc2V0UHJvdG90eXBlT2YgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIGdldFByb3RvdHlwZU9mKHNldFByb3RvdHlwZU9mKGN1c3RvbUNyZWF0ZShudWxsKSwgeCkpID09PSB4O1xufTtcbiIsIi8vIEJpZyB0aGFua3MgdG8gQFdlYlJlZmxlY3Rpb24gZm9yIHNvcnRpbmcgdGhpcyBvdXRcbi8vIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL1dlYlJlZmxlY3Rpb24vNTU5MzU1NFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCAgICAgID0gcmVxdWlyZSgnLi4vaXMtb2JqZWN0JylcbiAgLCB2YWx1ZSAgICAgICAgID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgaXNQcm90b3R5cGVPZiA9IE9iamVjdC5wcm90b3R5cGUuaXNQcm90b3R5cGVPZlxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgbnVsbERlc2MgPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfVxuICAsIHZhbGlkYXRlO1xuXG52YWxpZGF0ZSA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHR2YWx1ZShvYmopO1xuXHRpZiAoKHByb3RvdHlwZSA9PT0gbnVsbCkgfHwgaXNPYmplY3QocHJvdG90eXBlKSkgcmV0dXJuIG9iajtcblx0dGhyb3cgbmV3IFR5cGVFcnJvcignUHJvdG90eXBlIG11c3QgYmUgbnVsbCBvciBhbiBvYmplY3QnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uIChzdGF0dXMpIHtcblx0dmFyIGZuLCBzZXQ7XG5cdGlmICghc3RhdHVzKSByZXR1cm4gbnVsbDtcblx0aWYgKHN0YXR1cy5sZXZlbCA9PT0gMikge1xuXHRcdGlmIChzdGF0dXMuc2V0KSB7XG5cdFx0XHRzZXQgPSBzdGF0dXMuc2V0O1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0c2V0LmNhbGwodmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLCBwcm90b3R5cGUpO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0dmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH07XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGZuID0gZnVuY3Rpb24gc2VsZihvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0dmFyIGlzTnVsbEJhc2U7XG5cdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSk7XG5cdFx0XHRpc051bGxCYXNlID0gaXNQcm90b3R5cGVPZi5jYWxsKHNlbGYubnVsbFBvbHlmaWxsLCBvYmopO1xuXHRcdFx0aWYgKGlzTnVsbEJhc2UpIGRlbGV0ZSBzZWxmLm51bGxQb2x5ZmlsbC5fX3Byb3RvX187XG5cdFx0XHRpZiAocHJvdG90eXBlID09PSBudWxsKSBwcm90b3R5cGUgPSBzZWxmLm51bGxQb2x5ZmlsbDtcblx0XHRcdG9iai5fX3Byb3RvX18gPSBwcm90b3R5cGU7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVmaW5lUHJvcGVydHkoc2VsZi5udWxsUG9seWZpbGwsICdfX3Byb3RvX18nLCBudWxsRGVzYyk7XG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH07XG5cdH1cblx0cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShmbiwgJ2xldmVsJywgeyBjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogZmFsc2UsIHZhbHVlOiBzdGF0dXMubGV2ZWwgfSk7XG59KChmdW5jdGlvbiAoKSB7XG5cdHZhciB4ID0gT2JqZWN0LmNyZWF0ZShudWxsKSwgeSA9IHt9LCBzZXRcblx0ICAsIGRlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKE9iamVjdC5wcm90b3R5cGUsICdfX3Byb3RvX18nKTtcblxuXHRpZiAoZGVzYykge1xuXHRcdHRyeSB7XG5cdFx0XHRzZXQgPSBkZXNjLnNldDsgLy8gT3BlcmEgY3Jhc2hlcyBhdCB0aGlzIHBvaW50XG5cdFx0XHRzZXQuY2FsbCh4LCB5KTtcblx0XHR9IGNhdGNoIChpZ25vcmUpIHsgfVxuXHRcdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IHNldDogc2V0LCBsZXZlbDogMiB9O1xuXHR9XG5cblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMiB9O1xuXG5cdHggPSB7fTtcblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMSB9O1xuXG5cdHJldHVybiBmYWxzZTtcbn0oKSkpKTtcblxucmVxdWlyZSgnLi4vY3JlYXRlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZuKSB7XG5cdGlmICh0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpIHRocm93IG5ldyBUeXBlRXJyb3IoZm4gKyBcIiBpcyBub3QgYSBmdW5jdGlvblwiKTtcblx0cmV0dXJuIGZuO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgdXNlIG51bGwgb3IgdW5kZWZpbmVkXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gU3RyaW5nLnByb3RvdHlwZS5jb250YWluc1xuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc3RyID0gJ3JhemR3YXRyenknO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0aWYgKHR5cGVvZiBzdHIuY29udGFpbnMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuICgoc3RyLmNvbnRhaW5zKCdkd2EnKSA9PT0gdHJ1ZSkgJiYgKHN0ci5jb250YWlucygnZm9vJykgPT09IGZhbHNlKSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaW5kZXhPZiA9IFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc2VhcmNoU3RyaW5nLyosIHBvc2l0aW9uKi8pIHtcblx0cmV0dXJuIGluZGV4T2YuY2FsbCh0aGlzLCBzZWFyY2hTdHJpbmcsIGFyZ3VtZW50c1sxXSkgPiAtMTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmdcblxuICAsIGlkID0gdG9TdHJpbmcuY2FsbCgnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICh0eXBlb2YgeCA9PT0gJ3N0cmluZycpIHx8ICh4ICYmICh0eXBlb2YgeCA9PT0gJ29iamVjdCcpICYmXG5cdFx0KCh4IGluc3RhbmNlb2YgU3RyaW5nKSB8fCAodG9TdHJpbmcuY2FsbCh4KSA9PT0gaWQpKSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjb250YWlucyAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIEFycmF5SXRlcmF0b3I7XG5cbkFycmF5SXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhcnIsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEFycmF5SXRlcmF0b3IpKSByZXR1cm4gbmV3IEFycmF5SXRlcmF0b3IoYXJyLCBraW5kKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBhcnIpO1xuXHRpZiAoIWtpbmQpIGtpbmQgPSAndmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXkrdmFsdWUnKSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXknKSkga2luZCA9ICdrZXknO1xuXHRlbHNlIGtpbmQgPSAndmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19raW5kX18nLCBkKCcnLCBraW5kKSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihBcnJheUl0ZXJhdG9yLCBJdGVyYXRvcik7XG5cbkFycmF5SXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoQXJyYXlJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fbGlzdF9fW2ldO1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAna2V5K3ZhbHVlJykgcmV0dXJuIFtpLCB0aGlzLl9fbGlzdF9fW2ldXTtcblx0XHRyZXR1cm4gaTtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEFycmF5IEl0ZXJhdG9yXSc7IH0pXG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIGlzU3RyaW5nID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBnZXQgICAgICA9IHJlcXVpcmUoJy4vZ2V0JylcblxuICAsIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5LCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGl0ZXJhYmxlLCBjYi8qLCB0aGlzQXJnKi8pIHtcblx0dmFyIG1vZGUsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIHJlc3VsdCwgZG9CcmVhaywgYnJva2VuLCBpLCBsLCBjaGFyLCBjb2RlO1xuXHRpZiAoaXNBcnJheShpdGVyYWJsZSkpIG1vZGUgPSAnYXJyYXknO1xuXHRlbHNlIGlmIChpc1N0cmluZyhpdGVyYWJsZSkpIG1vZGUgPSAnc3RyaW5nJztcblx0ZWxzZSBpdGVyYWJsZSA9IGdldChpdGVyYWJsZSk7XG5cblx0Y2FsbGFibGUoY2IpO1xuXHRkb0JyZWFrID0gZnVuY3Rpb24gKCkgeyBicm9rZW4gPSB0cnVlOyB9O1xuXHRpZiAobW9kZSA9PT0gJ2FycmF5Jykge1xuXHRcdGl0ZXJhYmxlLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCBkb0JyZWFrKTtcblx0XHRcdGlmIChicm9rZW4pIHJldHVybiB0cnVlO1xuXHRcdH0pO1xuXHRcdHJldHVybjtcblx0fVxuXHRpZiAobW9kZSA9PT0gJ3N0cmluZycpIHtcblx0XHRsID0gaXRlcmFibGUubGVuZ3RoO1xuXHRcdGZvciAoaSA9IDA7IGkgPCBsOyArK2kpIHtcblx0XHRcdGNoYXIgPSBpdGVyYWJsZVtpXTtcblx0XHRcdGlmICgoaSArIDEpIDwgbCkge1xuXHRcdFx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdFx0XHRpZiAoKGNvZGUgPj0gMHhEODAwKSAmJiAoY29kZSA8PSAweERCRkYpKSBjaGFyICs9IGl0ZXJhYmxlWysraV07XG5cdFx0XHR9XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIGNoYXIsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgYnJlYWs7XG5cdFx0fVxuXHRcdHJldHVybjtcblx0fVxuXHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cblx0d2hpbGUgKCFyZXN1bHQuZG9uZSkge1xuXHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgcmVzdWx0LnZhbHVlLCBkb0JyZWFrKTtcblx0XHRpZiAoYnJva2VuKSByZXR1cm47XG5cdFx0cmVzdWx0ID0gaXRlcmFibGUubmV4dCgpO1xuXHR9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIEFycmF5SXRlcmF0b3IgID0gcmVxdWlyZSgnLi9hcnJheScpXG4gICwgU3RyaW5nSXRlcmF0b3IgPSByZXF1aXJlKCcuL3N0cmluZycpXG4gICwgaXRlcmFibGUgICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLWl0ZXJhYmxlJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG5cdGlmICh0eXBlb2YgaXRlcmFibGUob2JqKVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpIHJldHVybiBvYmpbaXRlcmF0b3JTeW1ib2xdKCk7XG5cdGlmIChpc1N0cmluZyhvYmopKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKG9iaik7XG5cdHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihvYmopO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsZWFyICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2NsZWFyJylcbiAgLCBhc3NpZ24gICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2Fzc2lnbicpXG4gICwgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsdWUgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG4gICwgZCAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBhdXRvQmluZCA9IHJlcXVpcmUoJ2QvYXV0by1iaW5kJylcbiAgLCBTeW1ib2wgICA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBJdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBJdGVyYXRvciA9IGZ1bmN0aW9uIChsaXN0LCBjb250ZXh0KSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBJdGVyYXRvcikpIHJldHVybiBuZXcgSXRlcmF0b3IobGlzdCwgY29udGV4dCk7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fbGlzdF9fOiBkKCd3JywgdmFsdWUobGlzdCkpLFxuXHRcdF9fY29udGV4dF9fOiBkKCd3JywgY29udGV4dCksXG5cdFx0X19uZXh0SW5kZXhfXzogZCgndycsIDApXG5cdH0pO1xuXHRpZiAoIWNvbnRleHQpIHJldHVybjtcblx0Y2FsbGFibGUoY29udGV4dC5vbik7XG5cdGNvbnRleHQub24oJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdGNvbnRleHQub24oJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdGNvbnRleHQub24oJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xufTtcblxuZGVmaW5lUHJvcGVydGllcyhJdGVyYXRvci5wcm90b3R5cGUsIGFzc2lnbih7XG5cdGNvbnN0cnVjdG9yOiBkKEl0ZXJhdG9yKSxcblx0X25leHQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHZhciBpO1xuXHRcdGlmICghdGhpcy5fX2xpc3RfXykgcmV0dXJuO1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRpID0gdGhpcy5fX3JlZG9fXy5zaGlmdCgpO1xuXHRcdFx0aWYgKGkgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGk7XG5cdFx0fVxuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPCB0aGlzLl9fbGlzdF9fLmxlbmd0aCkgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0bmV4dDogZChmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9jcmVhdGVSZXN1bHQodGhpcy5fbmV4dCgpKTsgfSksXG5cdF9jcmVhdGVSZXN1bHQ6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAoaSA9PT0gdW5kZWZpbmVkKSByZXR1cm4geyBkb25lOiB0cnVlLCB2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0cmV0dXJuIHsgZG9uZTogZmFsc2UsIHZhbHVlOiB0aGlzLl9yZXNvbHZlKGkpIH07XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkgeyByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTsgfSksXG5cdF91bkJpbmQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHRoaXMuX19saXN0X18gPSBudWxsO1xuXHRcdGRlbGV0ZSB0aGlzLl9fcmVkb19fO1xuXHRcdGlmICghdGhpcy5fX2NvbnRleHRfXykgcmV0dXJuO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfYWRkJywgdGhpcy5fb25BZGQpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfZGVsZXRlJywgdGhpcy5fb25EZWxldGUpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfY2xlYXInLCB0aGlzLl9vbkNsZWFyKTtcblx0XHR0aGlzLl9fY29udGV4dF9fID0gbnVsbDtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEl0ZXJhdG9yXSc7IH0pXG59LCBhdXRvQmluZCh7XG5cdF9vbkFkZDogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0Kyt0aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19yZWRvX18nLCBkKCdjJywgW2luZGV4XSkpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID49IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gKytyZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHRcdHRoaXMuX19yZWRvX18ucHVzaChpbmRleCk7XG5cdH0pLFxuXHRfb25EZWxldGU6IGQoZnVuY3Rpb24gKGluZGV4KSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKGluZGV4ID49IHRoaXMuX19uZXh0SW5kZXhfXykgcmV0dXJuO1xuXHRcdC0tdGhpcy5fX25leHRJbmRleF9fO1xuXHRcdGlmICghdGhpcy5fX3JlZG9fXykgcmV0dXJuO1xuXHRcdGkgPSB0aGlzLl9fcmVkb19fLmluZGV4T2YoaW5kZXgpO1xuXHRcdGlmIChpICE9PSAtMSkgdGhpcy5fX3JlZG9fXy5zcGxpY2UoaSwgMSk7XG5cdFx0dGhpcy5fX3JlZG9fXy5mb3JFYWNoKGZ1bmN0aW9uIChyZWRvLCBpKSB7XG5cdFx0XHRpZiAocmVkbyA+IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gLS1yZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHR9KSxcblx0X29uQ2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSBjbGVhci5jYWxsKHRoaXMuX19yZWRvX18pO1xuXHRcdHRoaXMuX19uZXh0SW5kZXhfXyA9IDA7XG5cdH0pXG59KSkpO1xuXG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChmdW5jdGlvbiAoKSB7XG5cdHJldHVybiB0aGlzO1xufSkpO1xuZGVmaW5lUHJvcGVydHkoSXRlcmF0b3IucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJycsICdJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3RyaW5nICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvclxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG5cdGlmIChpc0FycmF5KHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdGlmIChpc1N0cmluZyh2YWx1ZSkpIHJldHVybiB0cnVlO1xuXHRyZXR1cm4gKHR5cGVvZiB2YWx1ZVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IFN5bWJvbCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0eXBlb2YgU3ltYm9sICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHN5bWJvbCA9IFN5bWJvbCgndGVzdCBzeW1ib2wnKTtcblx0dHJ5IHsgU3RyaW5nKHN5bWJvbCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSAnc3ltYm9sJykgcmV0dXJuIHRydWU7XG5cblx0Ly8gUmV0dXJuICd0cnVlJyBmb3IgcG9seWZpbGxzXG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzQ29uY2F0U3ByZWFkYWJsZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvUHJpbWl0aXZlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1N0cmluZ1RhZyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudW5zY29wYWJsZXMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAoeCAmJiAoKHR5cGVvZiB4ID09PSAnc3ltYm9sJykgfHwgKHhbJ0BAdG9TdHJpbmdUYWcnXSA9PT0gJ1N5bWJvbCcpKSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCB2YWxpZGF0ZVN5bWJvbCA9IHJlcXVpcmUoJy4vdmFsaWRhdGUtc3ltYm9sJylcblxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5LCBvYmpQcm90b3R5cGUgPSBPYmplY3QucHJvdG90eXBlXG4gICwgU3ltYm9sLCBIaWRkZW5TeW1ib2wsIGdsb2JhbFN5bWJvbHMgPSBjcmVhdGUobnVsbCk7XG5cbnZhciBnZW5lcmF0ZU5hbWUgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgY3JlYXRlZCA9IGNyZWF0ZShudWxsKTtcblx0cmV0dXJuIGZ1bmN0aW9uIChkZXNjKSB7XG5cdFx0dmFyIHBvc3RmaXggPSAwLCBuYW1lO1xuXHRcdHdoaWxlIChjcmVhdGVkW2Rlc2MgKyAocG9zdGZpeCB8fCAnJyldKSArK3Bvc3RmaXg7XG5cdFx0ZGVzYyArPSAocG9zdGZpeCB8fCAnJyk7XG5cdFx0Y3JlYXRlZFtkZXNjXSA9IHRydWU7XG5cdFx0bmFtZSA9ICdAQCcgKyBkZXNjO1xuXHRcdGRlZmluZVByb3BlcnR5KG9ialByb3RvdHlwZSwgbmFtZSwgZC5ncyhudWxsLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGQodmFsdWUpKTtcblx0XHR9KSk7XG5cdFx0cmV0dXJuIG5hbWU7XG5cdH07XG59KCkpO1xuXG5IaWRkZW5TeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBIaWRkZW5TeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHJldHVybiBTeW1ib2woZGVzY3JpcHRpb24pO1xufTtcbm1vZHVsZS5leHBvcnRzID0gU3ltYm9sID0gZnVuY3Rpb24gU3ltYm9sKGRlc2NyaXB0aW9uKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgU3ltYm9sKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHRzeW1ib2wgPSBjcmVhdGUoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSk7XG5cdGRlc2NyaXB0aW9uID0gKGRlc2NyaXB0aW9uID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyhkZXNjcmlwdGlvbikpO1xuXHRyZXR1cm4gZGVmaW5lUHJvcGVydGllcyhzeW1ib2wsIHtcblx0XHRfX2Rlc2NyaXB0aW9uX186IGQoJycsIGRlc2NyaXB0aW9uKSxcblx0XHRfX25hbWVfXzogZCgnJywgZ2VuZXJhdGVOYW1lKGRlc2NyaXB0aW9uKSlcblx0fSk7XG59O1xuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wsIHtcblx0Zm9yOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoZ2xvYmFsU3ltYm9sc1trZXldKSByZXR1cm4gZ2xvYmFsU3ltYm9sc1trZXldO1xuXHRcdHJldHVybiAoZ2xvYmFsU3ltYm9sc1trZXldID0gU3ltYm9sKFN0cmluZyhrZXkpKSk7XG5cdH0pLFxuXHRrZXlGb3I6IGQoZnVuY3Rpb24gKHMpIHtcblx0XHR2YXIga2V5O1xuXHRcdHZhbGlkYXRlU3ltYm9sKHMpO1xuXHRcdGZvciAoa2V5IGluIGdsb2JhbFN5bWJvbHMpIGlmIChnbG9iYWxTeW1ib2xzW2tleV0gPT09IHMpIHJldHVybiBrZXk7XG5cdH0pLFxuXHRoYXNJbnN0YW5jZTogZCgnJywgU3ltYm9sKCdoYXNJbnN0YW5jZScpKSxcblx0aXNDb25jYXRTcHJlYWRhYmxlOiBkKCcnLCBTeW1ib2woJ2lzQ29uY2F0U3ByZWFkYWJsZScpKSxcblx0aXRlcmF0b3I6IGQoJycsIFN5bWJvbCgnaXRlcmF0b3InKSksXG5cdG1hdGNoOiBkKCcnLCBTeW1ib2woJ21hdGNoJykpLFxuXHRyZXBsYWNlOiBkKCcnLCBTeW1ib2woJ3JlcGxhY2UnKSksXG5cdHNlYXJjaDogZCgnJywgU3ltYm9sKCdzZWFyY2gnKSksXG5cdHNwZWNpZXM6IGQoJycsIFN5bWJvbCgnc3BlY2llcycpKSxcblx0c3BsaXQ6IGQoJycsIFN5bWJvbCgnc3BsaXQnKSksXG5cdHRvUHJpbWl0aXZlOiBkKCcnLCBTeW1ib2woJ3RvUHJpbWl0aXZlJykpLFxuXHR0b1N0cmluZ1RhZzogZCgnJywgU3ltYm9sKCd0b1N0cmluZ1RhZycpKSxcblx0dW5zY29wYWJsZXM6IGQoJycsIFN5bWJvbCgndW5zY29wYWJsZXMnKSlcbn0pO1xuZGVmaW5lUHJvcGVydGllcyhIaWRkZW5TeW1ib2wucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFN5bWJvbCksXG5cdHRvU3RyaW5nOiBkKCcnLCBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbmFtZV9fOyB9KVxufSk7XG5cbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLnByb3RvdHlwZSwge1xuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnU3ltYm9sICgnICsgdmFsaWRhdGVTeW1ib2wodGhpcykuX19kZXNjcmlwdGlvbl9fICsgJyknOyB9KSxcblx0dmFsdWVPZjogZChmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSlcbn0pO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLCBkKCcnLFxuXHRmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSkpO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1N5bWJvbCcpKTtcblxuZGVmaW5lUHJvcGVydHkoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLFxuXHRkKCdjJywgU3ltYm9sLnByb3RvdHlwZVtTeW1ib2wudG9QcmltaXRpdmVdKSk7XG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1N0cmluZ1RhZ10pKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3ltYm9sID0gcmVxdWlyZSgnLi9pcy1zeW1ib2wnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc1N5bWJvbCh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgYSBzeW1ib2xcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIvLyBUaGFua3MgQG1hdGhpYXNieW5lbnNcbi8vIGh0dHA6Ly9tYXRoaWFzYnluZW5zLmJlL25vdGVzL2phdmFzY3JpcHQtdW5pY29kZSNpdGVyYXRpbmctb3Zlci1zeW1ib2xzXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgU3RyaW5nSXRlcmF0b3I7XG5cblN0cmluZ0l0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc3RyKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBTdHJpbmdJdGVyYXRvcikpIHJldHVybiBuZXcgU3RyaW5nSXRlcmF0b3Ioc3RyKTtcblx0c3RyID0gU3RyaW5nKHN0cik7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgc3RyKTtcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fbGVuZ3RoX18nLCBkKCcnLCBzdHIubGVuZ3RoKSk7XG5cbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFN0cmluZ0l0ZXJhdG9yLCBJdGVyYXRvcik7XG5cblN0cmluZ0l0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFN0cmluZ0l0ZXJhdG9yKSxcblx0X25leHQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICghdGhpcy5fX2xpc3RfXykgcmV0dXJuO1xuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPCB0aGlzLl9fbGVuZ3RoX18pIHJldHVybiB0aGlzLl9fbmV4dEluZGV4X18rKztcblx0XHR0aGlzLl91bkJpbmQoKTtcblx0fSksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0dmFyIGNoYXIgPSB0aGlzLl9fbGlzdF9fW2ldLCBjb2RlO1xuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPT09IHRoaXMuX19sZW5ndGhfXykgcmV0dXJuIGNoYXI7XG5cdFx0Y29kZSA9IGNoYXIuY2hhckNvZGVBdCgwKTtcblx0XHRpZiAoKGNvZGUgPj0gMHhEODAwKSAmJiAoY29kZSA8PSAweERCRkYpKSByZXR1cm4gY2hhciArIHRoaXMuX19saXN0X19bdGhpcy5fX25leHRJbmRleF9fKytdO1xuXHRcdHJldHVybiBjaGFyO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgU3RyaW5nIEl0ZXJhdG9yXSc7IH0pXG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzSXRlcmFibGUgPSByZXF1aXJlKCcuL2lzLWl0ZXJhYmxlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNJdGVyYWJsZSh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgaXRlcmFibGVcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTeW1ib2wgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodHlwZW9mIFN5bWJvbCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzeW1ib2wgPSBTeW1ib2woJ3Rlc3Qgc3ltYm9sJyk7XG5cdHRyeSB7IFN0cmluZyhzeW1ib2wpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gJ3N5bWJvbCcpIHJldHVybiB0cnVlO1xuXG5cdC8vIFJldHVybiAndHJ1ZScgZm9yIHBvbHlmaWxsc1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc0NvbmNhdFNwcmVhZGFibGUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzUmVnRXhwICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9QcmltaXRpdmUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvU3RyaW5nVGFnICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC51bnNjb3BhYmxlcyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkID0gcmVxdWlyZSgnZCcpXG5cbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBnZW5lcmF0ZU5hbWUsIFN5bWJvbDtcblxuZ2VuZXJhdGVOYW1lID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIGNyZWF0ZWQgPSBjcmVhdGUobnVsbCk7XG5cdHJldHVybiBmdW5jdGlvbiAoZGVzYykge1xuXHRcdHZhciBwb3N0Zml4ID0gMDtcblx0XHR3aGlsZSAoY3JlYXRlZFtkZXNjICsgKHBvc3RmaXggfHwgJycpXSkgKytwb3N0Zml4O1xuXHRcdGRlc2MgKz0gKHBvc3RmaXggfHwgJycpO1xuXHRcdGNyZWF0ZWRbZGVzY10gPSB0cnVlO1xuXHRcdHJldHVybiAnQEAnICsgZGVzYztcblx0fTtcbn0oKSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU3ltYm9sID0gZnVuY3Rpb24gKGRlc2NyaXB0aW9uKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgU3ltYm9sKSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0fVxuXHRzeW1ib2wgPSBjcmVhdGUoU3ltYm9sLnByb3RvdHlwZSk7XG5cdGRlc2NyaXB0aW9uID0gKGRlc2NyaXB0aW9uID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyhkZXNjcmlwdGlvbikpO1xuXHRyZXR1cm4gZGVmaW5lUHJvcGVydGllcyhzeW1ib2wsIHtcblx0XHRfX2Rlc2NyaXB0aW9uX186IGQoJycsIGRlc2NyaXB0aW9uKSxcblx0XHRfX25hbWVfXzogZCgnJywgZ2VuZXJhdGVOYW1lKGRlc2NyaXB0aW9uKSlcblx0fSk7XG59O1xuXG5PYmplY3QuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wsIHtcblx0Y3JlYXRlOiBkKCcnLCBTeW1ib2woJ2NyZWF0ZScpKSxcblx0aGFzSW5zdGFuY2U6IGQoJycsIFN5bWJvbCgnaGFzSW5zdGFuY2UnKSksXG5cdGlzQ29uY2F0U3ByZWFkYWJsZTogZCgnJywgU3ltYm9sKCdpc0NvbmNhdFNwcmVhZGFibGUnKSksXG5cdGlzUmVnRXhwOiBkKCcnLCBTeW1ib2woJ2lzUmVnRXhwJykpLFxuXHRpdGVyYXRvcjogZCgnJywgU3ltYm9sKCdpdGVyYXRvcicpKSxcblx0dG9QcmltaXRpdmU6IGQoJycsIFN5bWJvbCgndG9QcmltaXRpdmUnKSksXG5cdHRvU3RyaW5nVGFnOiBkKCcnLCBTeW1ib2woJ3RvU3RyaW5nVGFnJykpLFxuXHR1bnNjb3BhYmxlczogZCgnJywgU3ltYm9sKCd1bnNjb3BhYmxlcycpKVxufSk7XG5cbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLnByb3RvdHlwZSwge1xuXHRwcm9wZXJUb1N0cmluZzogZChmdW5jdGlvbiAoKSB7XG5cdFx0cmV0dXJuICdTeW1ib2wgKCcgKyB0aGlzLl9fZGVzY3JpcHRpb25fXyArICcpJztcblx0fSksXG5cdHRvU3RyaW5nOiBkKCcnLCBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbmFtZV9fOyB9KVxufSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLCBkKCcnLFxuXHRmdW5jdGlvbiAoaGludCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoXCJDb252ZXJzaW9uIG9mIHN5bWJvbCBvYmplY3RzIGlzIG5vdCBhbGxvd2VkXCIpO1xuXHR9KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1N5bWJvbCcpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG5cbiAgLCBhcHBseSA9IEZ1bmN0aW9uLnByb3RvdHlwZS5hcHBseSwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZXNjcmlwdG9yID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSB9XG5cbiAgLCBvbiwgb25jZSwgb2ZmLCBlbWl0LCBtZXRob2RzLCBkZXNjcmlwdG9ycywgYmFzZTtcblxub24gPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIGRhdGE7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHtcblx0XHRkYXRhID0gZGVzY3JpcHRvci52YWx1ZSA9IGNyZWF0ZShudWxsKTtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19lZV9fJywgZGVzY3JpcHRvcik7XG5cdFx0ZGVzY3JpcHRvci52YWx1ZSA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0ZGF0YSA9IHRoaXMuX19lZV9fO1xuXHR9XG5cdGlmICghZGF0YVt0eXBlXSkgZGF0YVt0eXBlXSA9IGxpc3RlbmVyO1xuXHRlbHNlIGlmICh0eXBlb2YgZGF0YVt0eXBlXSA9PT0gJ29iamVjdCcpIGRhdGFbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG5cdGVsc2UgZGF0YVt0eXBlXSA9IFtkYXRhW3R5cGVdLCBsaXN0ZW5lcl07XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5vbmNlID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBvbmNlLCBzZWxmO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblx0c2VsZiA9IHRoaXM7XG5cdG9uLmNhbGwodGhpcywgdHlwZSwgb25jZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRvZmYuY2FsbChzZWxmLCB0eXBlLCBvbmNlKTtcblx0XHRhcHBseS5jYWxsKGxpc3RlbmVyLCB0aGlzLCBhcmd1bWVudHMpO1xuXHR9KTtcblxuXHRvbmNlLl9fZWVPbmNlTGlzdGVuZXJfXyA9IGxpc3RlbmVyO1xuXHRyZXR1cm4gdGhpcztcbn07XG5cbm9mZiA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgZGF0YSwgbGlzdGVuZXJzLCBjYW5kaWRhdGUsIGk7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHJldHVybiB0aGlzO1xuXHRkYXRhID0gdGhpcy5fX2VlX187XG5cdGlmICghZGF0YVt0eXBlXSkgcmV0dXJuIHRoaXM7XG5cdGxpc3RlbmVycyA9IGRhdGFbdHlwZV07XG5cblx0aWYgKHR5cGVvZiBsaXN0ZW5lcnMgPT09ICdvYmplY3QnKSB7XG5cdFx0Zm9yIChpID0gMDsgKGNhbmRpZGF0ZSA9IGxpc3RlbmVyc1tpXSk7ICsraSkge1xuXHRcdFx0aWYgKChjYW5kaWRhdGUgPT09IGxpc3RlbmVyKSB8fFxuXHRcdFx0XHRcdChjYW5kaWRhdGUuX19lZU9uY2VMaXN0ZW5lcl9fID09PSBsaXN0ZW5lcikpIHtcblx0XHRcdFx0aWYgKGxpc3RlbmVycy5sZW5ndGggPT09IDIpIGRhdGFbdHlwZV0gPSBsaXN0ZW5lcnNbaSA/IDAgOiAxXTtcblx0XHRcdFx0ZWxzZSBsaXN0ZW5lcnMuc3BsaWNlKGksIDEpO1xuXHRcdFx0fVxuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRpZiAoKGxpc3RlbmVycyA9PT0gbGlzdGVuZXIpIHx8XG5cdFx0XHRcdChsaXN0ZW5lcnMuX19lZU9uY2VMaXN0ZW5lcl9fID09PSBsaXN0ZW5lcikpIHtcblx0XHRcdGRlbGV0ZSBkYXRhW3R5cGVdO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB0aGlzO1xufTtcblxuZW1pdCA9IGZ1bmN0aW9uICh0eXBlKSB7XG5cdHZhciBpLCBsLCBsaXN0ZW5lciwgbGlzdGVuZXJzLCBhcmdzO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHJldHVybjtcblx0bGlzdGVuZXJzID0gdGhpcy5fX2VlX19bdHlwZV07XG5cdGlmICghbGlzdGVuZXJzKSByZXR1cm47XG5cblx0aWYgKHR5cGVvZiBsaXN0ZW5lcnMgPT09ICdvYmplY3QnKSB7XG5cdFx0bCA9IGFyZ3VtZW50cy5sZW5ndGg7XG5cdFx0YXJncyA9IG5ldyBBcnJheShsIC0gMSk7XG5cdFx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cblx0XHRsaXN0ZW5lcnMgPSBsaXN0ZW5lcnMuc2xpY2UoKTtcblx0XHRmb3IgKGkgPSAwOyAobGlzdGVuZXIgPSBsaXN0ZW5lcnNbaV0pOyArK2kpIHtcblx0XHRcdGFwcGx5LmNhbGwobGlzdGVuZXIsIHRoaXMsIGFyZ3MpO1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcblx0XHRjYXNlIDE6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzKTtcblx0XHRcdGJyZWFrO1xuXHRcdGNhc2UgMjpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3VtZW50c1sxXSk7XG5cdFx0XHRicmVhaztcblx0XHRjYXNlIDM6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG5cdFx0XHRicmVhaztcblx0XHRkZWZhdWx0OlxuXHRcdFx0bCA9IGFyZ3VtZW50cy5sZW5ndGg7XG5cdFx0XHRhcmdzID0gbmV3IEFycmF5KGwgLSAxKTtcblx0XHRcdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIHtcblx0XHRcdFx0YXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cdFx0XHR9XG5cdFx0XHRhcHBseS5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJncyk7XG5cdFx0fVxuXHR9XG59O1xuXG5tZXRob2RzID0ge1xuXHRvbjogb24sXG5cdG9uY2U6IG9uY2UsXG5cdG9mZjogb2ZmLFxuXHRlbWl0OiBlbWl0XG59O1xuXG5kZXNjcmlwdG9ycyA9IHtcblx0b246IGQob24pLFxuXHRvbmNlOiBkKG9uY2UpLFxuXHRvZmY6IGQob2ZmKSxcblx0ZW1pdDogZChlbWl0KVxufTtcblxuYmFzZSA9IGRlZmluZVByb3BlcnRpZXMoe30sIGRlc2NyaXB0b3JzKTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gZnVuY3Rpb24gKG8pIHtcblx0cmV0dXJuIChvID09IG51bGwpID8gY3JlYXRlKGJhc2UpIDogZGVmaW5lUHJvcGVydGllcyhPYmplY3QobyksIGRlc2NyaXB0b3JzKTtcbn07XG5leHBvcnRzLm1ldGhvZHMgPSBtZXRob2RzO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGVJbmRleE9mICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YnKVxuICAsIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY2FsbGFibGUgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBlZSAgICAgICAgICAgICA9IHJlcXVpcmUoJ2V2ZW50LWVtaXR0ZXInKVxuICAsIFN5bWJvbCAgICAgICAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG4gICwgaXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvdmFsaWQtaXRlcmFibGUnKVxuICAsIGZvck9mICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL2Zvci1vZicpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuL2xpYi9pdGVyYXRvcicpXG4gICwgaXNOYXRpdmUgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIE1hcFBvbHk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFwUG9seSA9IGZ1bmN0aW9uICgvKml0ZXJhYmxlKi8pIHtcblx0dmFyIGl0ZXJhYmxlID0gYXJndW1lbnRzWzBdLCBrZXlzLCB2YWx1ZXM7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBNYXBQb2x5KSkgcmV0dXJuIG5ldyBNYXBQb2x5KGl0ZXJhYmxlKTtcblx0aWYgKHRoaXMuX19tYXBLZXlzRGF0YV9fICE9PSB1bmRlZmluZWQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKHRoaXMgKyBcIiBjYW5ub3QgYmUgcmVpbml0aWFsaXplZFwiKTtcblx0fVxuXHRpZiAoaXRlcmFibGUgIT0gbnVsbCkgaXRlcmF0b3IoaXRlcmFibGUpO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX21hcEtleXNEYXRhX186IGQoJ2MnLCBrZXlzID0gW10pLFxuXHRcdF9fbWFwVmFsdWVzRGF0YV9fOiBkKCdjJywgdmFsdWVzID0gW10pXG5cdH0pO1xuXHRpZiAoIWl0ZXJhYmxlKSByZXR1cm47XG5cdGZvck9mKGl0ZXJhYmxlLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHR2YXIga2V5ID0gdmFsaWRWYWx1ZSh2YWx1ZSlbMF07XG5cdFx0dmFsdWUgPSB2YWx1ZVsxXTtcblx0XHRpZiAoZUluZGV4T2YuY2FsbChrZXlzLCBrZXkpICE9PSAtMSkgcmV0dXJuO1xuXHRcdGtleXMucHVzaChrZXkpO1xuXHRcdHZhbHVlcy5wdXNoKHZhbHVlKTtcblx0fSwgdGhpcyk7XG59O1xuXG5pZiAoaXNOYXRpdmUpIHtcblx0aWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihNYXBQb2x5LCBNYXApO1xuXHRNYXBQb2x5LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoTWFwLnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKE1hcFBvbHkpXG5cdH0pO1xufVxuXG5lZShkZWZpbmVQcm9wZXJ0aWVzKE1hcFBvbHkucHJvdG90eXBlLCB7XG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19tYXBLZXlzRGF0YV9fLmxlbmd0aCkgcmV0dXJuO1xuXHRcdGNsZWFyLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18pO1xuXHRcdGNsZWFyLmNhbGwodGhpcy5fX21hcFZhbHVlc0RhdGFfXyk7XG5cdFx0dGhpcy5lbWl0KCdfY2xlYXInKTtcblx0fSksXG5cdGRlbGV0ZTogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dmFyIGluZGV4ID0gZUluZGV4T2YuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXywga2V5KTtcblx0XHRpZiAoaW5kZXggPT09IC0xKSByZXR1cm4gZmFsc2U7XG5cdFx0dGhpcy5fX21hcEtleXNEYXRhX18uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR0aGlzLl9fbWFwVmFsdWVzRGF0YV9fLnNwbGljZShpbmRleCwgMSk7XG5cdFx0dGhpcy5lbWl0KCdfZGVsZXRlJywgaW5kZXgsIGtleSk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0pLFxuXHRlbnRyaWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAna2V5K3ZhbHVlJyk7IH0pLFxuXHRmb3JFYWNoOiBkKGZ1bmN0aW9uIChjYi8qLCB0aGlzQXJnKi8pIHtcblx0XHR2YXIgdGhpc0FyZyA9IGFyZ3VtZW50c1sxXSwgaXRlcmF0b3IsIHJlc3VsdDtcblx0XHRjYWxsYWJsZShjYik7XG5cdFx0aXRlcmF0b3IgPSB0aGlzLmVudHJpZXMoKTtcblx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdHdoaWxlIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW3Jlc3VsdF0sXG5cdFx0XHRcdHRoaXMuX19tYXBLZXlzRGF0YV9fW3Jlc3VsdF0sIHRoaXMpO1xuXHRcdFx0cmVzdWx0ID0gaXRlcmF0b3IuX25leHQoKTtcblx0XHR9XG5cdH0pLFxuXHRnZXQ6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSk7XG5cdFx0aWYgKGluZGV4ID09PSAtMSkgcmV0dXJuO1xuXHRcdHJldHVybiB0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW2luZGV4XTtcblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0cmV0dXJuIChlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpICE9PSAtMSk7XG5cdH0pLFxuXHRrZXlzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAna2V5Jyk7IH0pLFxuXHRzZXQ6IGQoZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcblx0XHR2YXIgaW5kZXggPSBlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpLCBlbWl0O1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHtcblx0XHRcdGluZGV4ID0gdGhpcy5fX21hcEtleXNEYXRhX18ucHVzaChrZXkpIC0gMTtcblx0XHRcdGVtaXQgPSB0cnVlO1xuXHRcdH1cblx0XHR0aGlzLl9fbWFwVmFsdWVzRGF0YV9fW2luZGV4XSA9IHZhbHVlO1xuXHRcdGlmIChlbWl0KSB0aGlzLmVtaXQoJ19hZGQnLCBpbmRleCwga2V5KTtcblx0XHRyZXR1cm4gdGhpcztcblx0fSksXG5cdHNpemU6IGQuZ3MoZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX21hcEtleXNEYXRhX18ubGVuZ3RoOyB9KSxcblx0dmFsdWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzLCAndmFsdWUnKTsgfSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IE1hcF0nOyB9KVxufSkpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KE1hcFBvbHkucHJvdG90eXBlLCBTeW1ib2wuaXRlcmF0b3IsIGQoZnVuY3Rpb24gKCkge1xuXHRyZXR1cm4gdGhpcy5lbnRyaWVzKCk7XG59KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoTWFwUG9seS5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdNYXAnKSk7XG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNTYW1lKGEsIGIpe1xuICAgIGlmKGEgPT09IGIpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZihcbiAgICAgICAgdHlwZW9mIGEgIT09IHR5cGVvZiBiIHx8IFxuICAgICAgICB0eXBlb2YgYSA9PT0gJ29iamVjdCcgJiYgXG4gICAgICAgICEoYSBpbnN0YW5jZW9mIERhdGUgJiYgYiBpbnN0YW5jZW9mIERhdGUpXG4gICAgKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiBhICsgJycgPT09IGIgKyAnJztcbn07IiwidmFyIHVuc3VwcG9ydGVkVHlwZXMgPSBbJ251bWJlcicsICdlbWFpbCcsICd0aW1lJywgJ2NvbG9yJywgJ21vbnRoJywgJ3JhbmdlJywgJ2RhdGUnXTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XG4gICAgdmFyIGNhblNldCA9IGVsZW1lbnQuc2V0U2VsZWN0aW9uUmFuZ2UgJiZcbiAgICAgICAgICAgICAgICAhfnVuc3VwcG9ydGVkVHlwZXMuaW5kZXhPZihlbGVtZW50LnR5cGUpICYmXG4gICAgICAgICAgICAgICAgZWxlbWVudCA9PT0gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcblxuICAgIGlmIChjYW5TZXQpIHtcbiAgICAgICAgdmFyIHN0YXJ0ID0gZWxlbWVudC5zZWxlY3Rpb25TdGFydCxcbiAgICAgICAgICAgIGVuZCA9IGVsZW1lbnQuc2VsZWN0aW9uRW5kO1xuXG4gICAgICAgIGVsZW1lbnQudmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgZWxlbWVudC5zZXRTZWxlY3Rpb25SYW5nZShzdGFydCwgZW5kKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBlbGVtZW50LnZhbHVlID0gdmFsdWU7XG4gICAgfVxufTsiLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCdjbG9uZScpLFxuICAgIGRlZXBFcXVhbCA9IHJlcXVpcmUoJ2RlZXAtZXF1YWwnKTtcblxuZnVuY3Rpb24ga2V5c0FyZURpZmZlcmVudChrZXlzMSwga2V5czIpe1xuICAgIGlmKGtleXMxID09PSBrZXlzMil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYoIWtleXMxIHx8ICFrZXlzMiB8fCBrZXlzMS5sZW5ndGggIT09IGtleXMyLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5czEubGVuZ3RoOyBpKyspe1xuICAgICAgICBpZighfmtleXMyLmluZGV4T2Yoa2V5czFbaV0pKXtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRLZXlzKHZhbHVlKXtcbiAgICBpZighdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmtleXModmFsdWUpO1xufVxuXG5mdW5jdGlvbiBXaGF0Q2hhbmdlZCh2YWx1ZSwgY2hhbmdlc1RvVHJhY2spe1xuICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrID0ge307XG5cbiAgICBpZihjaGFuZ2VzVG9UcmFjayA9PSBudWxsKXtcbiAgICAgICAgY2hhbmdlc1RvVHJhY2sgPSAndmFsdWUgdHlwZSBrZXlzIHN0cnVjdHVyZSByZWZlcmVuY2UnO1xuICAgIH1cblxuICAgIGlmKHR5cGVvZiBjaGFuZ2VzVG9UcmFjayAhPT0gJ3N0cmluZycpe1xuICAgICAgICB0aHJvdyAnY2hhbmdlc1RvVHJhY2sgbXVzdCBiZSBvZiB0eXBlIHN0cmluZyc7XG4gICAgfVxuXG4gICAgY2hhbmdlc1RvVHJhY2sgPSBjaGFuZ2VzVG9UcmFjay5zcGxpdCgnICcpO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGFuZ2VzVG9UcmFjay5sZW5ndGg7IGkrKykge1xuICAgICAgICB0aGlzLl9jaGFuZ2VzVG9UcmFja1tjaGFuZ2VzVG9UcmFja1tpXV0gPSB0cnVlO1xuICAgIH07XG5cbiAgICB0aGlzLnVwZGF0ZSh2YWx1ZSk7XG59XG5XaGF0Q2hhbmdlZC5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24odmFsdWUpe1xuICAgIHZhciByZXN1bHQgPSB7fSxcbiAgICAgICAgY2hhbmdlc1RvVHJhY2sgPSB0aGlzLl9jaGFuZ2VzVG9UcmFjayxcbiAgICAgICAgbmV3S2V5cyA9IGdldEtleXModmFsdWUpO1xuXG4gICAgaWYoJ3ZhbHVlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB2YWx1ZSsnJyAhPT0gdGhpcy5fbGFzdFJlZmVyZW5jZSsnJyl7XG4gICAgICAgIHJlc3VsdC52YWx1ZSA9IHRydWU7XG4gICAgfVxuICAgIGlmKCd0eXBlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB0eXBlb2YgdmFsdWUgIT09IHR5cGVvZiB0aGlzLl9sYXN0VmFsdWUpe1xuICAgICAgICByZXN1bHQudHlwZSA9IHRydWU7XG4gICAgfVxuICAgIGlmKCdrZXlzJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiBrZXlzQXJlRGlmZmVyZW50KHRoaXMuX2xhc3RLZXlzLCBnZXRLZXlzKHZhbHVlKSkpe1xuICAgICAgICByZXN1bHQua2V5cyA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYodmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jyl7XG4gICAgICAgIHZhciBsYXN0VmFsdWUgPSB0aGlzLl9sYXN0VmFsdWU7XG5cbiAgICAgICAgaWYoJ3NoYWxsb3dTdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrICYmICghbGFzdFZhbHVlIHx8IHR5cGVvZiBsYXN0VmFsdWUgIT09ICdvYmplY3QnIHx8IE9iamVjdC5rZXlzKHZhbHVlKS5zb21lKGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlW2tleVtpbmRleF1dICE9PSBsYXN0VmFsdWVba2V5W2luZGV4XV07XG4gICAgICAgIH0pKSl7XG4gICAgICAgICAgICByZXN1bHQuc2hhbGxvd1N0cnVjdHVyZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYoJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgIWRlZXBFcXVhbCh2YWx1ZSwgbGFzdFZhbHVlKSl7XG4gICAgICAgICAgICByZXN1bHQuc3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZigncmVmZXJlbmNlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB2YWx1ZSAhPT0gdGhpcy5fbGFzdFJlZmVyZW5jZSl7XG4gICAgICAgICAgICByZXN1bHQucmVmZXJlbmNlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2xhc3RWYWx1ZSA9ICdzdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrID8gY2xvbmUodmFsdWUpIDogJ3NoYWxsb3dTdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrID8gY2xvbmUodmFsdWUsIHRydWUsIDEpOiB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0UmVmZXJlbmNlID0gdmFsdWU7XG4gICAgdGhpcy5fbGFzdEtleXMgPSBuZXdLZXlzO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gV2hhdENoYW5nZWQ7IiwiKGZ1bmN0aW9uIChCdWZmZXIpe1xudmFyIGNsb25lID0gKGZ1bmN0aW9uKCkge1xuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIENsb25lcyAoY29waWVzKSBhbiBPYmplY3QgdXNpbmcgZGVlcCBjb3B5aW5nLlxuICpcbiAqIFRoaXMgZnVuY3Rpb24gc3VwcG9ydHMgY2lyY3VsYXIgcmVmZXJlbmNlcyBieSBkZWZhdWx0LCBidXQgaWYgeW91IGFyZSBjZXJ0YWluXG4gKiB0aGVyZSBhcmUgbm8gY2lyY3VsYXIgcmVmZXJlbmNlcyBpbiB5b3VyIG9iamVjdCwgeW91IGNhbiBzYXZlIHNvbWUgQ1BVIHRpbWVcbiAqIGJ5IGNhbGxpbmcgY2xvbmUob2JqLCBmYWxzZSkuXG4gKlxuICogQ2F1dGlvbjogaWYgYGNpcmN1bGFyYCBpcyBmYWxzZSBhbmQgYHBhcmVudGAgY29udGFpbnMgY2lyY3VsYXIgcmVmZXJlbmNlcyxcbiAqIHlvdXIgcHJvZ3JhbSBtYXkgZW50ZXIgYW4gaW5maW5pdGUgbG9vcCBhbmQgY3Jhc2guXG4gKlxuICogQHBhcmFtIGBwYXJlbnRgIC0gdGhlIG9iamVjdCB0byBiZSBjbG9uZWRcbiAqIEBwYXJhbSBgY2lyY3VsYXJgIC0gc2V0IHRvIHRydWUgaWYgdGhlIG9iamVjdCB0byBiZSBjbG9uZWQgbWF5IGNvbnRhaW5cbiAqICAgIGNpcmN1bGFyIHJlZmVyZW5jZXMuIChvcHRpb25hbCAtIHRydWUgYnkgZGVmYXVsdClcbiAqIEBwYXJhbSBgZGVwdGhgIC0gc2V0IHRvIGEgbnVtYmVyIGlmIHRoZSBvYmplY3QgaXMgb25seSB0byBiZSBjbG9uZWQgdG9cbiAqICAgIGEgcGFydGljdWxhciBkZXB0aC4gKG9wdGlvbmFsIC0gZGVmYXVsdHMgdG8gSW5maW5pdHkpXG4gKiBAcGFyYW0gYHByb3RvdHlwZWAgLSBzZXRzIHRoZSBwcm90b3R5cGUgdG8gYmUgdXNlZCB3aGVuIGNsb25pbmcgYW4gb2JqZWN0LlxuICogICAgKG9wdGlvbmFsIC0gZGVmYXVsdHMgdG8gcGFyZW50IHByb3RvdHlwZSkuXG4qL1xuZnVuY3Rpb24gY2xvbmUocGFyZW50LCBjaXJjdWxhciwgZGVwdGgsIHByb3RvdHlwZSkge1xuICB2YXIgZmlsdGVyO1xuICBpZiAodHlwZW9mIGNpcmN1bGFyID09PSAnb2JqZWN0Jykge1xuICAgIGRlcHRoID0gY2lyY3VsYXIuZGVwdGg7XG4gICAgcHJvdG90eXBlID0gY2lyY3VsYXIucHJvdG90eXBlO1xuICAgIGZpbHRlciA9IGNpcmN1bGFyLmZpbHRlcjtcbiAgICBjaXJjdWxhciA9IGNpcmN1bGFyLmNpcmN1bGFyXG4gIH1cbiAgLy8gbWFpbnRhaW4gdHdvIGFycmF5cyBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlcywgd2hlcmUgY29ycmVzcG9uZGluZyBwYXJlbnRzXG4gIC8vIGFuZCBjaGlsZHJlbiBoYXZlIHRoZSBzYW1lIGluZGV4XG4gIHZhciBhbGxQYXJlbnRzID0gW107XG4gIHZhciBhbGxDaGlsZHJlbiA9IFtdO1xuXG4gIHZhciB1c2VCdWZmZXIgPSB0eXBlb2YgQnVmZmVyICE9ICd1bmRlZmluZWQnO1xuXG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT0gJ3VuZGVmaW5lZCcpXG4gICAgY2lyY3VsYXIgPSB0cnVlO1xuXG4gIGlmICh0eXBlb2YgZGVwdGggPT0gJ3VuZGVmaW5lZCcpXG4gICAgZGVwdGggPSBJbmZpbml0eTtcblxuICAvLyByZWN1cnNlIHRoaXMgZnVuY3Rpb24gc28gd2UgZG9uJ3QgcmVzZXQgYWxsUGFyZW50cyBhbmQgYWxsQ2hpbGRyZW5cbiAgZnVuY3Rpb24gX2Nsb25lKHBhcmVudCwgZGVwdGgpIHtcbiAgICAvLyBjbG9uaW5nIG51bGwgYWx3YXlzIHJldHVybnMgbnVsbFxuICAgIGlmIChwYXJlbnQgPT09IG51bGwpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGlmIChkZXB0aCA9PSAwKVxuICAgICAgcmV0dXJuIHBhcmVudDtcblxuICAgIHZhciBjaGlsZDtcbiAgICB2YXIgcHJvdG87XG4gICAgaWYgKHR5cGVvZiBwYXJlbnQgIT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBwYXJlbnQ7XG4gICAgfVxuXG4gICAgaWYgKGNsb25lLl9faXNBcnJheShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IFtdO1xuICAgIH0gZWxzZSBpZiAoY2xvbmUuX19pc1JlZ0V4cChwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBSZWdFeHAocGFyZW50LnNvdXJjZSwgX19nZXRSZWdFeHBGbGFncyhwYXJlbnQpKTtcbiAgICAgIGlmIChwYXJlbnQubGFzdEluZGV4KSBjaGlsZC5sYXN0SW5kZXggPSBwYXJlbnQubGFzdEluZGV4O1xuICAgIH0gZWxzZSBpZiAoY2xvbmUuX19pc0RhdGUocGFyZW50KSkge1xuICAgICAgY2hpbGQgPSBuZXcgRGF0ZShwYXJlbnQuZ2V0VGltZSgpKTtcbiAgICB9IGVsc2UgaWYgKHVzZUJ1ZmZlciAmJiBCdWZmZXIuaXNCdWZmZXIocGFyZW50KSkge1xuICAgICAgY2hpbGQgPSBuZXcgQnVmZmVyKHBhcmVudC5sZW5ndGgpO1xuICAgICAgcGFyZW50LmNvcHkoY2hpbGQpO1xuICAgICAgcmV0dXJuIGNoaWxkO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodHlwZW9mIHByb3RvdHlwZSA9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBwcm90byA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwYXJlbnQpO1xuICAgICAgICBjaGlsZCA9IE9iamVjdC5jcmVhdGUocHJvdG8pO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90b3R5cGUpO1xuICAgICAgICBwcm90byA9IHByb3RvdHlwZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2lyY3VsYXIpIHtcbiAgICAgIHZhciBpbmRleCA9IGFsbFBhcmVudHMuaW5kZXhPZihwYXJlbnQpO1xuXG4gICAgICBpZiAoaW5kZXggIT0gLTEpIHtcbiAgICAgICAgcmV0dXJuIGFsbENoaWxkcmVuW2luZGV4XTtcbiAgICAgIH1cbiAgICAgIGFsbFBhcmVudHMucHVzaChwYXJlbnQpO1xuICAgICAgYWxsQ2hpbGRyZW4ucHVzaChjaGlsZCk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSBpbiBwYXJlbnQpIHtcbiAgICAgIHZhciBhdHRycztcbiAgICAgIGlmIChwcm90bykge1xuICAgICAgICBhdHRycyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG8sIGkpO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cnMgJiYgYXR0cnMuc2V0ID09IG51bGwpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjaGlsZFtpXSA9IF9jbG9uZShwYXJlbnRbaV0sIGRlcHRoIC0gMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoaWxkO1xuICB9XG5cbiAgcmV0dXJuIF9jbG9uZShwYXJlbnQsIGRlcHRoKTtcbn1cblxuLyoqXG4gKiBTaW1wbGUgZmxhdCBjbG9uZSB1c2luZyBwcm90b3R5cGUsIGFjY2VwdHMgb25seSBvYmplY3RzLCB1c2VmdWxsIGZvciBwcm9wZXJ0eVxuICogb3ZlcnJpZGUgb24gRkxBVCBjb25maWd1cmF0aW9uIG9iamVjdCAobm8gbmVzdGVkIHByb3BzKS5cbiAqXG4gKiBVU0UgV0lUSCBDQVVUSU9OISBUaGlzIG1heSBub3QgYmVoYXZlIGFzIHlvdSB3aXNoIGlmIHlvdSBkbyBub3Qga25vdyBob3cgdGhpc1xuICogd29ya3MuXG4gKi9cbmNsb25lLmNsb25lUHJvdG90eXBlID0gZnVuY3Rpb24gY2xvbmVQcm90b3R5cGUocGFyZW50KSB7XG4gIGlmIChwYXJlbnQgPT09IG51bGwpXG4gICAgcmV0dXJuIG51bGw7XG5cbiAgdmFyIGMgPSBmdW5jdGlvbiAoKSB7fTtcbiAgYy5wcm90b3R5cGUgPSBwYXJlbnQ7XG4gIHJldHVybiBuZXcgYygpO1xufTtcblxuLy8gcHJpdmF0ZSB1dGlsaXR5IGZ1bmN0aW9uc1xuXG5mdW5jdGlvbiBfX29ialRvU3RyKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn07XG5jbG9uZS5fX29ialRvU3RyID0gX19vYmpUb1N0cjtcblxuZnVuY3Rpb24gX19pc0RhdGUobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IERhdGVdJztcbn07XG5jbG9uZS5fX2lzRGF0ZSA9IF9faXNEYXRlO1xuXG5mdW5jdGlvbiBfX2lzQXJyYXkobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuY2xvbmUuX19pc0FycmF5ID0gX19pc0FycmF5O1xuXG5mdW5jdGlvbiBfX2lzUmVnRXhwKG8pIHtcbiAgcmV0dXJuIHR5cGVvZiBvID09PSAnb2JqZWN0JyAmJiBfX29ialRvU3RyKG8pID09PSAnW29iamVjdCBSZWdFeHBdJztcbn07XG5jbG9uZS5fX2lzUmVnRXhwID0gX19pc1JlZ0V4cDtcblxuZnVuY3Rpb24gX19nZXRSZWdFeHBGbGFncyhyZSkge1xuICB2YXIgZmxhZ3MgPSAnJztcbiAgaWYgKHJlLmdsb2JhbCkgZmxhZ3MgKz0gJ2cnO1xuICBpZiAocmUuaWdub3JlQ2FzZSkgZmxhZ3MgKz0gJ2knO1xuICBpZiAocmUubXVsdGlsaW5lKSBmbGFncyArPSAnbSc7XG4gIHJldHVybiBmbGFncztcbn07XG5jbG9uZS5fX2dldFJlZ0V4cEZsYWdzID0gX19nZXRSZWdFeHBGbGFncztcblxucmV0dXJuIGNsb25lO1xufSkoKTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gY2xvbmU7XG59XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcikiLCJ2YXIgcFNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xudmFyIG9iamVjdEtleXMgPSByZXF1aXJlKCcuL2xpYi9rZXlzLmpzJyk7XG52YXIgaXNBcmd1bWVudHMgPSByZXF1aXJlKCcuL2xpYi9pc19hcmd1bWVudHMuanMnKTtcblxudmFyIGRlZXBFcXVhbCA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpIHtcbiAgaWYgKCFvcHRzKSBvcHRzID0ge307XG4gIC8vIDcuMS4gQWxsIGlkZW50aWNhbCB2YWx1ZXMgYXJlIGVxdWl2YWxlbnQsIGFzIGRldGVybWluZWQgYnkgPT09LlxuICBpZiAoYWN0dWFsID09PSBleHBlY3RlZCkge1xuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSBpZiAoYWN0dWFsIGluc3RhbmNlb2YgRGF0ZSAmJiBleHBlY3RlZCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICByZXR1cm4gYWN0dWFsLmdldFRpbWUoKSA9PT0gZXhwZWN0ZWQuZ2V0VGltZSgpO1xuXG4gIC8vIDcuMy4gT3RoZXIgcGFpcnMgdGhhdCBkbyBub3QgYm90aCBwYXNzIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0JyxcbiAgLy8gZXF1aXZhbGVuY2UgaXMgZGV0ZXJtaW5lZCBieSA9PS5cbiAgfSBlbHNlIGlmICh0eXBlb2YgYWN0dWFsICE9ICdvYmplY3QnICYmIHR5cGVvZiBleHBlY3RlZCAhPSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBvcHRzLnN0cmljdCA/IGFjdHVhbCA9PT0gZXhwZWN0ZWQgOiBhY3R1YWwgPT0gZXhwZWN0ZWQ7XG5cbiAgLy8gNy40LiBGb3IgYWxsIG90aGVyIE9iamVjdCBwYWlycywgaW5jbHVkaW5nIEFycmF5IG9iamVjdHMsIGVxdWl2YWxlbmNlIGlzXG4gIC8vIGRldGVybWluZWQgYnkgaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChhcyB2ZXJpZmllZFxuICAvLyB3aXRoIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCksIHRoZSBzYW1lIHNldCBvZiBrZXlzXG4gIC8vIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLCBlcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnlcbiAgLy8gY29ycmVzcG9uZGluZyBrZXksIGFuZCBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuIE5vdGU6IHRoaXNcbiAgLy8gYWNjb3VudHMgZm9yIGJvdGggbmFtZWQgYW5kIGluZGV4ZWQgcHJvcGVydGllcyBvbiBBcnJheXMuXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG9iakVxdWl2KGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkT3JOdWxsKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0J1ZmZlciAoeCkge1xuICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnIHx8IHR5cGVvZiB4Lmxlbmd0aCAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiB4LmNvcHkgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHguc2xpY2UgIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHgubGVuZ3RoID4gMCAmJiB0eXBlb2YgeFswXSAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIG9iakVxdWl2KGEsIGIsIG9wdHMpIHtcbiAgdmFyIGksIGtleTtcbiAgaWYgKGlzVW5kZWZpbmVkT3JOdWxsKGEpIHx8IGlzVW5kZWZpbmVkT3JOdWxsKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIGRlZXBFcXVhbChhLCBiLCBvcHRzKTtcbiAgfVxuICBpZiAoaXNCdWZmZXIoYSkpIHtcbiAgICBpZiAoIWlzQnVmZmVyKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFbaV0gIT09IGJbaV0pIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYik7XG4gIH0gY2F0Y2ggKGUpIHsvL2hhcHBlbnMgd2hlbiBvbmUgaXMgYSBzdHJpbmcgbGl0ZXJhbCBhbmQgdGhlIG90aGVyIGlzbid0XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8vIGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoa2V5cyBpbmNvcnBvcmF0ZXNcbiAgLy8gaGFzT3duUHJvcGVydHkpXG4gIGlmIChrYS5sZW5ndGggIT0ga2IubGVuZ3RoKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy90aGUgc2FtZSBzZXQgb2Yga2V5cyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSxcbiAga2Euc29ydCgpO1xuICBrYi5zb3J0KCk7XG4gIC8vfn5+Y2hlYXAga2V5IHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBpZiAoa2FbaV0gIT0ga2JbaV0pXG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy9lcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnkgY29ycmVzcG9uZGluZyBrZXksIGFuZFxuICAvL35+fnBvc3NpYmx5IGV4cGVuc2l2ZSBkZWVwIHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBrZXkgPSBrYVtpXTtcbiAgICBpZiAoIWRlZXBFcXVhbChhW2tleV0sIGJba2V5XSwgb3B0cykpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGVvZiBiO1xufVxuIiwidmFyIHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPSAoZnVuY3Rpb24oKXtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChhcmd1bWVudHMpXG59KSgpID09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzdXBwb3J0c0FyZ3VtZW50c0NsYXNzID8gc3VwcG9ydGVkIDogdW5zdXBwb3J0ZWQ7XG5cbmV4cG9ydHMuc3VwcG9ydGVkID0gc3VwcG9ydGVkO1xuZnVuY3Rpb24gc3VwcG9ydGVkKG9iamVjdCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG59O1xuXG5leHBvcnRzLnVuc3VwcG9ydGVkID0gdW5zdXBwb3J0ZWQ7XG5mdW5jdGlvbiB1bnN1cHBvcnRlZChvYmplY3Qpe1xuICByZXR1cm4gb2JqZWN0ICYmXG4gICAgdHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0JyAmJlxuICAgIHR5cGVvZiBvYmplY3QubGVuZ3RoID09ICdudW1iZXInICYmXG4gICAgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpICYmXG4gICAgIU9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmplY3QsICdjYWxsZWUnKSB8fFxuICAgIGZhbHNlO1xufTtcbiIsImV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHR5cGVvZiBPYmplY3Qua2V5cyA9PT0gJ2Z1bmN0aW9uJ1xuICA/IE9iamVjdC5rZXlzIDogc2hpbTtcblxuZXhwb3J0cy5zaGltID0gc2hpbTtcbmZ1bmN0aW9uIHNoaW0gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgcmV0dXJuIGtleXM7XG59XG4iLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBXaGF0Q2hhbmdlZCA9IHJlcXVpcmUoJ3doYXQtY2hhbmdlZCcpLFxuICAgIGZpcm1lciA9IHJlcXVpcmUoJy4vZmlybWVyJyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIgPSByZXF1aXJlKCcuL21ha2VGdW5jdGlvbkVtaXR0ZXInKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoY3VycmVudFZhbHVlLCBjaGFuZ2VzLCB1cGRhdGVyKXtcbiAgICBpZih0eXBlb2YgY2hhbmdlcyA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHVwZGF0ZXIgPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzID0gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgYmluZGluZyxcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIGF0dGFjaGluZyxcbiAgICAgICAgcHJldmlvdXMgPSBuZXcgV2hhdENoYW5nZWQoY3VycmVudFZhbHVlLCBjaGFuZ2VzIHx8ICd2YWx1ZSB0eXBlIHJlZmVyZW5jZSBrZXlzJyk7XG5cbiAgICBmdW5jdGlvbiBwcm9wZXJ0eSh2YWx1ZSl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nICYmIGJpbmRpbmcoKSB8fCBwcm9wZXJ0eS5fdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihhdHRhY2hpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIU9iamVjdC5rZXlzKHByZXZpb3VzLnVwZGF0ZSh2YWx1ZSkpLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBpZighcHJvcGVydHkuX2Rlc3Ryb3llZCl7XG4gICAgICAgICAgICBwcm9wZXJ0eS5fdmFsdWUgPSB2YWx1ZTtcblxuICAgICAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICAgICAgYmluZGluZyh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkuX3ZhbHVlID0gYmluZGluZygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5lbWl0KCdjaGFuZ2UnLCBwcm9wZXJ0eS5fdmFsdWUpO1xuICAgICAgICAgICAgcHJvcGVydHkudXBkYXRlKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgfVxuXG4gICAgcHJvcGVydHkuX3ZhbHVlID0gY3VycmVudFZhbHVlO1xuICAgIHByb3BlcnR5Ll91cGRhdGUgPSB1cGRhdGVyO1xuXG4gICAgcHJvcGVydHkuX2Zpcm0gPSAxO1xuXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlcihwcm9wZXJ0eSk7XG5cbiAgICBwcm9wZXJ0eS5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICAgICAgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihuZXdCaW5kaW5nID09PSBiaW5kaW5nKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcgPSBuZXdCaW5kaW5nO1xuICAgICAgICBpZihtb2RlbCl7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hdHRhY2gobW9kZWwsIHByb3BlcnR5Ll9maXJtKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgfTtcbiAgICBwcm9wZXJ0eS5hdHRhY2ggPSBmdW5jdGlvbihvYmplY3QsIGZpcm0pe1xuICAgICAgICBpZihmaXJtZXIocHJvcGVydHksIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3BlcnR5Ll9maXJtID0gZmlybTtcblxuICAgICAgICBpZihvYmplY3QgaW5zdGFuY2VvZiBFbnRpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IG9iamVjdC5fbW9kZWw7XG4gICAgICAgIH1cblxuICAgICAgICBpZighKG9iamVjdCBpbnN0YW5jZW9mIE9iamVjdCkpe1xuICAgICAgICAgICAgb2JqZWN0ID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIG1vZGVsID0gb2JqZWN0O1xuICAgICAgICAgICAgYXR0YWNoaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIGJpbmRpbmcuYXR0YWNoKG9iamVjdCwgMSk7XG4gICAgICAgICAgICBhdHRhY2hpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHByb3BlcnR5KGJpbmRpbmcoKSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgcHJvcGVydHkudXBkYXRlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGV0YWNoID0gZnVuY3Rpb24oZmlybSl7XG4gICAgICAgIGlmKGZpcm1lcihwcm9wZXJ0eSwgZmlybSkpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgICAgICBiaW5kaW5nLmRldGFjaCgxKTtcbiAgICAgICAgICAgIG1vZGVsID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkudXBkYXRlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoIXByb3BlcnR5Ll9kZXN0cm95ZWQpe1xuXG4gICAgICAgICAgICBpZihwcm9wZXJ0eS5fdXBkYXRlKXtcbiAgICAgICAgICAgICAgICBwcm9wZXJ0eS5fdXBkYXRlKHByb3BlcnR5Ll92YWx1ZSwgcHJvcGVydHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9wZXJ0eS5lbWl0KCd1cGRhdGUnLCBwcm9wZXJ0eS5fdmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LnVwZGF0ZXIgPSBmdW5jdGlvbihmbil7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eS5fdXBkYXRlO1xuICAgICAgICB9XG4gICAgICAgIHByb3BlcnR5Ll91cGRhdGUgPSBmbjtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5Ll9kZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICAgICAgcHJvcGVydHkuZGV0YWNoKCk7XG4gICAgICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nLmRlc3Ryb3kodHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYWRkVG8gPSBmdW5jdGlvbihjb21wb25lbnQsIGtleSl7XG4gICAgICAgIGNvbXBvbmVudFtrZXldID0gcHJvcGVydHk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZVByb3BlcnR5OyIsInZhciB0b2RvID0gW10sXG4gICAgdG9kb0tleXMgPSBbXSxcbiAgICBzY2hlZHVsZWQsXG4gICAgdXBkYXRlcyA9IDA7XG5cbmZ1bmN0aW9uIHJ1bigpe1xuICAgIHZhciBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgd2hpbGUodG9kby5sZW5ndGggJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IDE2KXtcbiAgICAgICAgdG9kb0tleXMuc2hpZnQoKTtcbiAgICAgICAgdG9kby5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgaWYodG9kby5sZW5ndGgpe1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzY2hlZHVsZShrZXksIGZuKXtcbiAgICBpZih+dG9kb0tleXMuaW5kZXhPZihrZXkpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRvZG8ucHVzaChmbik7XG4gICAgdG9kb0tleXMucHVzaChrZXkpO1xuXG4gICAgaWYoIXNjaGVkdWxlZCl7XG4gICAgICAgIHNjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW4pO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzY2hlZHVsZTsiLCJ2YXIgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbmZ1bmN0aW9uIHRleHRDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzKXtcbiAgICB2YXIgdGV4dCA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIHRleHQuY3JlYXRlVGV4dE5vZGUgPSB0ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlO1xuICAgIHRleHQudGV4dCA9IGZhc3RuLnByb3BlcnR5KCcnKTtcbiAgICB0ZXh0Ll91cGRhdGVUZXh0ID0gZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpZighdGV4dC5lbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRleHQuZWxlbWVudC50ZXh0Q29udGVudCA9IHZhbHVlO1xuICAgIH07XG4gICAgdGV4dC5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICB0ZXh0LmVsZW1lbnQgPSB0ZXh0LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgICAgdGV4dC5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuICAgIHRleHQudGV4dC5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0ZXh0Ll91cGRhdGVUZXh0KHZhbHVlKTtcbiAgICB9KTtcbiAgICB0ZXh0Lm9uKCd1cGRhdGUnLCB0ZXh0LnRleHQudXBkYXRlKTtcblxuICAgIHJldHVybiB0ZXh0O1xufTtcblxudGV4dENvbXBvbmVudC5jcmVhdGVUZXh0Tm9kZSA9IGZ1bmN0aW9uKHRleHQpe1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gdGV4dENvbXBvbmVudDsiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIga01heExlbmd0aCA9IDB4M2ZmZmZmZmZcblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gNDIgPT09IGFyci5mb28oKSAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pXG5cbiAgdmFyIHR5cGUgPSB0eXBlb2Ygc3ViamVjdFxuXG4gIC8vIEZpbmQgdGhlIGxlbmd0aFxuICB2YXIgbGVuZ3RoXG4gIGlmICh0eXBlID09PSAnbnVtYmVyJylcbiAgICBsZW5ndGggPSBzdWJqZWN0ID4gMCA/IHN1YmplY3QgPj4+IDAgOiAwXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKGVuY29kaW5nID09PSAnYmFzZTY0JylcbiAgICAgIHN1YmplY3QgPSBiYXNlNjRjbGVhbihzdWJqZWN0KVxuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdvYmplY3QnICYmIHN1YmplY3QgIT09IG51bGwpIHsgLy8gYXNzdW1lIG9iamVjdCBpcyBhcnJheS1saWtlXG4gICAgaWYgKHN1YmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShzdWJqZWN0LmRhdGEpKVxuICAgICAgc3ViamVjdCA9IHN1YmplY3QuZGF0YVxuICAgIGxlbmd0aCA9ICtzdWJqZWN0Lmxlbmd0aCA+IDAgPyBNYXRoLmZsb29yKCtzdWJqZWN0Lmxlbmd0aCkgOiAwXG4gIH0gZWxzZVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcblxuICBpZiAodGhpcy5sZW5ndGggPiBrTWF4TGVuZ3RoKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG5cbiAgdmFyIGJ1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBQcmVmZXJyZWQ6IFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYnVmID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBUSElTIGluc3RhbmNlIG9mIEJ1ZmZlciAoY3JlYXRlZCBieSBgbmV3YClcbiAgICBidWYgPSB0aGlzXG4gICAgYnVmLmxlbmd0aCA9IGxlbmd0aFxuICAgIGJ1Zi5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgaVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgdHlwZW9mIHN1YmplY3QuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHtcbiAgICAvLyBTcGVlZCBvcHRpbWl6YXRpb24gLS0gdXNlIHNldCBpZiB3ZSdyZSBjb3B5aW5nIGZyb20gYSB0eXBlZCBhcnJheVxuICAgIGJ1Zi5fc2V0KHN1YmplY3QpXG4gIH0gZWxzZSBpZiAoaXNBcnJheWlzaChzdWJqZWN0KSkge1xuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheVxuICAgIGlmIChCdWZmZXIuaXNCdWZmZXIoc3ViamVjdCkpIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKylcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdC5yZWFkVUludDgoaSlcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKVxuICAgICAgICBidWZbaV0gPSAoKHN1YmplY3RbaV0gJSAyNTYpICsgMjU2KSAlIDI1NlxuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGJ1Zi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgIW5vWmVybykge1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgYnVmW2ldID0gMFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW4gJiYgYVtpXSA9PT0gYltpXTsgaSsrKSB7fVxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0WywgbGVuZ3RoXSknKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKHRvdGFsTGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICB0b3RhbExlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdG90YWxMZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcih0b3RhbExlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHZhciByZXRcbiAgc3RyID0gc3RyICsgJydcbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdyYXcnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCAqIDJcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggPj4+IDFcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuLy8gdG9TdHJpbmcoZW5jb2RpbmcsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kID4+PiAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKVxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiAoYikge1xuICBpZighQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heClcbiAgICAgIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGJ5dGUgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKGJ5dGUpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gYnl0ZVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIGJpbmFyeVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGFzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiB1dGYxNmxlV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gU3VwcG9ydCBib3RoIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZylcbiAgLy8gYW5kIHRoZSBsZWdhY3kgKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIGlmICghaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHV0ZjE2bGVXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgcmV0dXJuIGFzY2lpU2xpY2UoYnVmLCBzdGFydCwgZW5kKVxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW47XG4gICAgaWYgKHN0YXJ0IDwgMClcbiAgICAgIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKVxuICAgICAgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KVxuICAgIGVuZCA9IHN0YXJ0XG5cbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgcmV0dXJuIEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgdmFyIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZCwgdHJ1ZSlcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgICByZXR1cm4gbmV3QnVmXG4gIH1cbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSlcbiAgICByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpc1xuXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICghdGFyZ2V0X3N0YXJ0KSB0YXJnZXRfc3RhcnQgPSAwXG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgc291cmNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0JylcbiAgaWYgKHRhcmdldF9zdGFydCA8IDAgfHwgdGFyZ2V0X3N0YXJ0ID49IHRhcmdldC5sZW5ndGgpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gc291cmNlLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHNvdXJjZS5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpXG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgPCBlbmQgLSBzdGFydClcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnRcblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0X3N0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldF9zdGFydClcbiAgfVxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFR5cGVFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLXpdL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiBpc0FycmF5aXNoIChzdWJqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcidcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIHZhciBiID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBpZiAoYiA8PSAweDdGKSB7XG4gICAgICBieXRlQXJyYXkucHVzaChiKVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgc3RhcnQgPSBpXG4gICAgICBpZiAoYiA+PSAweEQ4MDAgJiYgYiA8PSAweERGRkYpIGkrK1xuICAgICAgdmFyIGggPSBlbmNvZGVVUklDb21wb25lbnQoc3RyLnNsaWNlKHN0YXJ0LCBpKzEpKS5zdWJzdHIoMSkuc3BsaXQoJyUnKVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBoLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSlcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoc3RyKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSlcbiAgICAgIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG4iLCJ2YXIgbG9va3VwID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuXG47KGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cdCd1c2Ugc3RyaWN0JztcblxuICB2YXIgQXJyID0gKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJylcbiAgICA/IFVpbnQ4QXJyYXlcbiAgICA6IEFycmF5XG5cblx0dmFyIFBMVVMgICA9ICcrJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSCAgPSAnLycuY2hhckNvZGVBdCgwKVxuXHR2YXIgTlVNQkVSID0gJzAnLmNoYXJDb2RlQXQoMClcblx0dmFyIExPV0VSICA9ICdhJy5jaGFyQ29kZUF0KDApXG5cdHZhciBVUFBFUiAgPSAnQScuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSClcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24oYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBuQml0cyA9IC03LFxuICAgICAgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwLFxuICAgICAgZCA9IGlzTEUgPyAtMSA6IDEsXG4gICAgICBzID0gYnVmZmVyW29mZnNldCArIGldO1xuXG4gIGkgKz0gZDtcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgcyA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IGVMZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBlID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gbUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzO1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSk7XG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICBlID0gZSAtIGVCaWFzO1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pO1xufTtcblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKSxcbiAgICAgIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKSxcbiAgICAgIGQgPSBpc0xFID8gMSA6IC0xLFxuICAgICAgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMDtcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMDtcbiAgICBlID0gZU1heDtcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMik7XG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tO1xuICAgICAgYyAqPSAyO1xuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gYztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpO1xuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrKztcbiAgICAgIGMgLz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwO1xuICAgICAgZSA9IGVNYXg7XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IGUgKyBlQmlhcztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IDA7XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCk7XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbTtcbiAgZUxlbiArPSBtTGVuO1xuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpO1xuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyODtcbn07XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG5mdW5jdGlvbiBFdmVudEVtaXR0ZXIoKSB7XG4gIHRoaXMuX2V2ZW50cyA9IHRoaXMuX2V2ZW50cyB8fCB7fTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gdGhpcy5fbWF4TGlzdGVuZXJzIHx8IHVuZGVmaW5lZDtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjEwLnhcbkV2ZW50RW1pdHRlci5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX2V2ZW50cyA9IHVuZGVmaW5lZDtcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX21heExpc3RlbmVycyA9IHVuZGVmaW5lZDtcblxuLy8gQnkgZGVmYXVsdCBFdmVudEVtaXR0ZXJzIHdpbGwgcHJpbnQgYSB3YXJuaW5nIGlmIG1vcmUgdGhhbiAxMCBsaXN0ZW5lcnMgYXJlXG4vLyBhZGRlZCB0byBpdC4gVGhpcyBpcyBhIHVzZWZ1bCBkZWZhdWx0IHdoaWNoIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxuRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnMgPSAxMDtcblxuLy8gT2J2aW91c2x5IG5vdCBhbGwgRW1pdHRlcnMgc2hvdWxkIGJlIGxpbWl0ZWQgdG8gMTAuIFRoaXMgZnVuY3Rpb24gYWxsb3dzXG4vLyB0aGF0IHRvIGJlIGluY3JlYXNlZC4gU2V0IHRvIHplcm8gZm9yIHVubGltaXRlZC5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuc2V0TWF4TGlzdGVuZXJzID0gZnVuY3Rpb24obikge1xuICBpZiAoIWlzTnVtYmVyKG4pIHx8IG4gPCAwIHx8IGlzTmFOKG4pKVxuICAgIHRocm93IFR5cGVFcnJvcignbiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJyk7XG4gIHRoaXMuX21heExpc3RlbmVycyA9IG47XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgZXIsIGhhbmRsZXIsIGxlbiwgYXJncywgaSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIElmIHRoZXJlIGlzIG5vICdlcnJvcicgZXZlbnQgbGlzdGVuZXIgdGhlbiB0aHJvdy5cbiAgaWYgKHR5cGUgPT09ICdlcnJvcicpIHtcbiAgICBpZiAoIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNPYmplY3QodGhpcy5fZXZlbnRzLmVycm9yKSAmJiAhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCkpIHtcbiAgICAgIGVyID0gYXJndW1lbnRzWzFdO1xuICAgICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXI7IC8vIFVuaGFuZGxlZCAnZXJyb3InIGV2ZW50XG4gICAgICB9XG4gICAgICB0aHJvdyBUeXBlRXJyb3IoJ1VuY2F1Z2h0LCB1bnNwZWNpZmllZCBcImVycm9yXCIgZXZlbnQuJyk7XG4gICAgfVxuICB9XG5cbiAgaGFuZGxlciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNVbmRlZmluZWQoaGFuZGxlcikpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGhhbmRsZXIpKSB7XG4gICAgc3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAvLyBmYXN0IGNhc2VzXG4gICAgICBjYXNlIDE6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICAvLyBzbG93ZXJcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgaGFuZGxlci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QoaGFuZGxlcikpIHtcbiAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cbiAgICBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgbGVuID0gbGlzdGVuZXJzLmxlbmd0aDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICBpZiAodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKVxuICAgIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICBpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKSA/XG4gICAgICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyIDogbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICBlbHNlIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIGVsc2VcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG5cbiAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkgJiYgIXRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQpIHtcbiAgICB2YXIgbTtcbiAgICBpZiAoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpIHtcbiAgICAgIG0gPSB0aGlzLl9tYXhMaXN0ZW5lcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9XG5cbiAgICBpZiAobSAmJiBtID4gMCAmJiB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoID4gbSkge1xuICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgJ2xlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gJyArXG4gICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgIGlmICh0eXBlb2YgY29uc29sZS50cmFjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBub3Qgc3VwcG9ydGVkIGluIElFIDEwXG4gICAgICAgIGNvbnNvbGUudHJhY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgdmFyIGZpcmVkID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gZygpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuXG4gICAgaWYgKCFmaXJlZCkge1xuICAgICAgZmlyZWQgPSB0cnVlO1xuICAgICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBnLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHRoaXMub24odHlwZSwgZyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBlbWl0cyBhICdyZW1vdmVMaXN0ZW5lcicgZXZlbnQgaWZmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZFxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBsaXN0LCBwb3NpdGlvbiwgbGVuZ3RoLCBpO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIGxlbmd0aCA9IGxpc3QubGVuZ3RoO1xuICBwb3NpdGlvbiA9IC0xO1xuXG4gIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fFxuICAgICAgKGlzRnVuY3Rpb24obGlzdC5saXN0ZW5lcikgJiYgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcblxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGxpc3QpKSB7XG4gICAgZm9yIChpID0gbGVuZ3RoOyBpLS0gPiAwOykge1xuICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8XG4gICAgICAgICAgKGxpc3RbaV0ubGlzdGVuZXIgJiYgbGlzdFtpXS5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uIDwgMClcbiAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnNwbGljZShwb3NpdGlvbiwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIga2V5LCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8gbm90IGxpc3RlbmluZyBmb3IgcmVtb3ZlTGlzdGVuZXIsIG5vIG5lZWQgdG8gZW1pdFxuICBpZiAoIXRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKVxuICAgICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGZvciAoa2V5IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhrZXkpO1xuICAgIH1cbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNGdW5jdGlvbihsaXN0ZW5lcnMpKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnMpO1xuICB9IGVsc2Uge1xuICAgIC8vIExJRk8gb3JkZXJcbiAgICB3aGlsZSAobGlzdGVuZXJzLmxlbmd0aClcbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2xpc3RlbmVycy5sZW5ndGggLSAxXSk7XG4gIH1cbiAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IFtdO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIGVsc2VcbiAgICByZXQgPSB0aGlzLl9ldmVudHNbdHlwZV0uc2xpY2UoKTtcbiAgcmV0dXJuIHJldDtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIWVtaXR0ZXIuX2V2ZW50cyB8fCAhZW1pdHRlci5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IDA7XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24oZW1pdHRlci5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSAxO1xuICBlbHNlXG4gICAgcmV0ID0gZW1pdHRlci5fZXZlbnRzW3R5cGVdLmxlbmd0aDtcbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBpc051bWJlcihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbiJdfQ==
