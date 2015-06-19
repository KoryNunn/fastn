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

    function emitDetach(){
        component.emit('detach', 1);
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

        binding.on('detach', emitDetach);

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
var containerComponent = require('./containerComponent'),
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

    generic._initialClasses = '';

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
    if(typeof document !== 'undefined' && document.contains(generic.element)){
        schedule(property, update);
    }else{
        update();
    }
};

genericComponent.createElement = function(tagName){
    return document.createElement(tagName);
};

module.exports = genericComponent;
},{"./containerComponent":"/home/kory/dev/fastn/containerComponent.js","./fancyProps":"/home/kory/dev/fastn/fancyProps.js","./schedule":"/home/kory/dev/fastn/schedule.js"}],"/home/kory/dev/fastn/index.js":[function(require,module,exports){
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

    list._type = 'list';

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

    var handler = function(event, emitKey){
        trackedPaths.entis.forEach(function(enti){
            if(enti._emittedEvents[eventName] === emitKey){
                return;
            }

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
            
            enti._emittedEvents[eventName] = emitKey;

            var targetKey = getTargetKey(eventName),
                value = isWildcardPath(targetKey) ? undefined : enti.get(targetKey);

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
                handler(event, emitKey);
            }
        });
    }

    if(trackedKeys['*']){
        trackedKeys['*'].forEach(function(handler){
            if(trackedKeys['*'].has(handler)){
                handler(event, emitKey);
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
        attachChange,
        previous = new WhatChanged(currentValue, changes || 'value type reference keys');

    function property(value){
        if(!arguments.length){
            return binding && binding() || property._value;
        }

        if(!property._destroyed){

            if(!Object.keys(previous.update(value)).length){
                return property;
            }

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
        property(binding());
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
            binding.attach(object, 1);
        }

        if(property._events && 'attach' in property._events){
            property.emit('attach', object, 1);
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

        if(property._events && 'detach' in property._events){
            property.emit('detach', 1);
        }

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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vYmluZGluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvZmFzdG4uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL2ZvcmtCYW5uZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL2hlYWRlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL25ld1VzZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3NlYXJjaC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvc2VhcmNoQmFyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZXhhbXBsZS9zdGF0cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlckxpc3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3VzZXJzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZmFuY3lQcm9wcy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2Zpcm1lci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2dlbmVyaWNDb21wb25lbnQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2lzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbGlzdENvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL21ha2VGdW5jdGlvbkVtaXR0ZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3BqYXgvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3BqYXgvbm9kZV9tb2R1bGVzL3NpbXBsZS1hamF4L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2NwamF4L25vZGVfbW9kdWxlcy9zaW1wbGUtYWpheC9ub2RlX21vZHVsZXMvcXVlcnktc3RyaW5nL3F1ZXJ5LXN0cmluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9saWIvaXRlcmF0b3IuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvY2xlYXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L251bWJlci90by1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLXBvcy1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L19pdGVyYXRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvY29weS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvZm9yLWVhY2guanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvbWFwLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy9pcy1zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2FycmF5LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9mb3Itb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2dldC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2lzLWl0ZXJhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2lzLXN5bWJvbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvcG9seWZpbGwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL3ZhbGlkYXRlLXN5bWJvbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivc3RyaW5nLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9ldmVudC1lbWl0dGVyL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvcG9seWZpbGwuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvaXMtbmF0aXZlLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9kL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2NsZWFyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvX2l0ZXJhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2NvcHkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9mb3ItZWFjaC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9tYXAuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC1vYmplY3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC12YWx1ZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvcmFuZG9tLXVuaXEuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvYXJyYXkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvZm9yLW9mLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2dldC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pcy1pdGVyYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvdmFsaWQtaXRlcmFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvdmFsaWRhdGUtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3Ita2luZHMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9saWIvaXRlcmF0b3IuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvY2xlYXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L251bWJlci90by1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLXBvcy1pbnRlZ2VyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L19pdGVyYXRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvY29weS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvZm9yLWVhY2guanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvbWFwLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3ByaW1pdGl2ZS1zZXQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2Yvc2hpbS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC92YWxpZC12YWx1ZS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvaXMtaW1wbGVtZW50ZWQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9zaGltLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvYXJyYXkuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2Zvci1vZi5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvZ2V0LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaXMtaXRlcmFibGUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvdmFsaWRhdGUtc3ltYm9sLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9zdHJpbmcuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL3ZhbGlkLWl0ZXJhYmxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pcy1pbXBsZW1lbnRlZC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL3BvbHlmaWxsLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VzNi1tYXAvbm9kZV9tb2R1bGVzL2V2ZW50LWVtaXR0ZXIvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZXM2LW1hcC9wb2x5ZmlsbC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3NhbWUtdmFsdWUvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvc2V0aWZ5L2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2Nsb25lL2Nsb25lLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2tleXMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9wcm9wZXJ0eS5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL3NjaGVkdWxlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vdGV4dENvbXBvbmVudC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWIvYjY0LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaXMtYXJyYXkvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2V2ZW50cy9ldmVudHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDak5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFsQkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9FQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEVBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxaENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBtYWtlRnVuY3Rpb25FbWl0dGVyID0gcmVxdWlyZSgnLi9tYWtlRnVuY3Rpb25FbWl0dGVyJyksXG4gICAgc2FtZSA9IHJlcXVpcmUoJ3NhbWUtdmFsdWUnKTtcblxuZnVuY3Rpb24gZnVzZUJpbmRpbmcoKXtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICB2YXIgYmluZGluZ3MgPSBhcmdzLnNsaWNlKCksXG4gICAgICAgIHRyYW5zZm9ybSA9IGJpbmRpbmdzLnBvcCgpLFxuICAgICAgICB1cGRhdGVUcmFuc2Zvcm0sXG4gICAgICAgIHJlc3VsdEJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCdyZXN1bHQnKSxcbiAgICAgICAgc2VsZkNoYW5naW5nO1xuXG4gICAgcmVzdWx0QmluZGluZy5fYXJndW1lbnRzID0gYXJncztcblxuICAgIGlmKHR5cGVvZiBiaW5kaW5nc1tiaW5kaW5ncy5sZW5ndGgtMV0gPT09ICdmdW5jdGlvbicgJiYgIWlzLmJpbmRpbmcoYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdKSl7XG4gICAgICAgIHVwZGF0ZVRyYW5zZm9ybSA9IHRyYW5zZm9ybTtcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCk7XG4gICAgfVxuXG4gICAgcmVzdWx0QmluZGluZy5fbW9kZWwuX2V2ZW50cyA9IHt9O1xuICAgIHJlc3VsdEJpbmRpbmcuX3NldCA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICB2YXIgbmV3VmFsdWUgPSB1cGRhdGVUcmFuc2Zvcm0odmFsdWUpO1xuICAgICAgICAgICAgaWYoIXNhbWUobmV3VmFsdWUsIGJpbmRpbmdzWzBdKCkpKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nc1swXShuZXdWYWx1ZSk7XG4gICAgICAgICAgICAgICAgcmVzdWx0QmluZGluZy5fY2hhbmdlKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHJlc3VsdEJpbmRpbmcuX2NoYW5nZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlKCl7XG4gICAgICAgIGlmKHNlbGZDaGFuZ2luZyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0QmluZGluZyh0cmFuc2Zvcm0uYXBwbHkobnVsbCwgYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmcoKTtcbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcsIGluZGV4KXtcbiAgICAgICAgaWYodHlwZW9mIGJpbmRpbmcgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgICAgIGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKGJpbmRpbmcpO1xuICAgICAgICAgICAgYmluZGluZ3Muc3BsaWNlKGluZGV4LDEsYmluZGluZyk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgY2hhbmdlKTtcbiAgICAgICAgcmVzdWx0QmluZGluZy5vbignZGV0YWNoJywgYmluZGluZy5kZXRhY2gpO1xuICAgIH0pO1xuXG4gICAgdmFyIGxhc3RBdHRhY2hlZDtcbiAgICByZXN1bHRCaW5kaW5nLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihvYmplY3Qpe1xuICAgICAgICBzZWxmQ2hhbmdpbmcgPSB0cnVlO1xuICAgICAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCAxKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICBpZihsYXN0QXR0YWNoZWQgIT09IG9iamVjdCl7XG4gICAgICAgICAgICBjaGFuZ2UoKTtcbiAgICAgICAgfVxuICAgICAgICBsYXN0QXR0YWNoZWQgPSBvYmplY3Q7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0QmluZGluZztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhwYXRoLCBtb3JlKXtcblxuICAgIGlmKG1vcmUpeyAvLyB1c2VkIGluc3RlYWQgb2YgYXJndW1lbnRzLmxlbmd0aCBmb3IgcGVyZm9ybWFuY2VcbiAgICAgICAgcmV0dXJuIGZ1c2VCaW5kaW5nLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgaWYocGF0aCA9PSBudWxsKXtcbiAgICAgICAgdGhyb3cgXCJiaW5kaW5ncyBtdXN0IGJlIGNyZWF0ZWQgd2l0aCBhIGtleSAoYW5kIG9yIGZpbHRlcilcIjtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUsXG4gICAgICAgIGJpbmRpbmcgPSBmdW5jdGlvbiBiaW5kaW5nKG5ld1ZhbHVlKXtcbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocGF0aCA9PT0gJy4nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX3NldChuZXdWYWx1ZSk7XG4gICAgfTtcbiAgICBtYWtlRnVuY3Rpb25FbWl0dGVyKGJpbmRpbmcpO1xuICAgIGJpbmRpbmcuc2V0TWF4TGlzdGVuZXJzKDEwMDAwKTtcbiAgICBiaW5kaW5nLl9hcmd1bWVudHMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgIGJpbmRpbmcuX21vZGVsID0gbmV3IEVudGkoZmFsc2UpO1xuICAgIGJpbmRpbmcuX2Zhc3RuX2JpbmRpbmcgPSBwYXRoO1xuICAgIGJpbmRpbmcuX2Zpcm0gPSAxO1xuICAgIGJpbmRpbmcuX21vZGVsLl9ldmVudHMgPSB7fTtcblxuICAgIGJpbmRpbmcuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcblxuICAgICAgICAvLyBJZiB0aGUgYmluZGluZyBpcyBiZWluZyBhc2tlZCB0byBhdHRhY2ggbG9vc2x5IHRvIGFuIG9iamVjdCxcbiAgICAgICAgLy8gYnV0IGl0IGhhcyBhbHJlYWR5IGJlZW4gZGVmaW5lZCBhcyBiZWluZyBmaXJtbHkgYXR0YWNoZWQsIGRvIG5vdCBhdHRhY2guXG4gICAgICAgIGlmKGZpcm1lcihiaW5kaW5nLCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX2Zpcm0gPSBmaXJtO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcuX21vZGVsLmdldCgnLicpID09PSBvYmplY3Qpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLl9tb2RlbC5hdHRhY2gob2JqZWN0KTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKGJpbmRpbmcuX21vZGVsLmdldChwYXRoKSk7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnYXR0YWNoJywgb2JqZWN0LCAxKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBpZihmaXJtZXIoYmluZGluZywgZmlybSkpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgaWYoYmluZGluZy5fbW9kZWwuaXNBdHRhY2hlZCgpKXtcbiAgICAgICAgICAgIGJpbmRpbmcuX21vZGVsLmRldGFjaCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdkZXRhY2gnIGluIGJpbmRpbmcuX2V2ZW50cyl7XG4gICAgICAgICAgICBiaW5kaW5nLmVtaXQoJ2RldGFjaCcsIDEpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgIH07XG4gICAgYmluZGluZy5fc2V0ID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICBpZihzYW1lKGJpbmRpbmcuX21vZGVsLmdldChwYXRoKSwgbmV3VmFsdWUpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZighYmluZGluZy5fbW9kZWwuaXNBdHRhY2hlZCgpKXtcbiAgICAgICAgICAgIGJpbmRpbmcuX21vZGVsLmF0dGFjaChiaW5kaW5nLl9tb2RlbC5nZXQoJy4nKSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5fbW9kZWwuc2V0KHBhdGgsIG5ld1ZhbHVlKTtcbiAgICB9O1xuICAgIGJpbmRpbmcuX2NoYW5nZSA9IGZ1bmN0aW9uKG5ld1ZhbHVlKXtcbiAgICAgICAgdmFsdWUgPSBuZXdWYWx1ZTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdjaGFuZ2UnLCBiaW5kaW5nKCkpO1xuICAgIH07XG4gICAgYmluZGluZy5jbG9uZSA9IGZ1bmN0aW9uKGtlZXBBdHRhY2htZW50KXtcbiAgICAgICAgdmFyIG5ld0JpbmRpbmcgPSBjcmVhdGVCaW5kaW5nLmFwcGx5KG51bGwsIGJpbmRpbmcuX2FyZ3VtZW50cyk7XG5cbiAgICAgICAgaWYoa2VlcEF0dGFjaG1lbnQpe1xuICAgICAgICAgICAgbmV3QmluZGluZy5hdHRhY2goYmluZGluZy5fbW9kZWwsIGJpbmRpbmcuX2Zpcm0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5ld0JpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLmRlc3Ryb3kgPSBmdW5jdGlvbihzb2Z0KXtcbiAgICAgICAgaWYoYmluZGluZy5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZihzb2Z0ICYmICghYmluZGluZy5fZXZlbnRzIHx8IGJpbmRpbmcuX2V2ZW50cy5jaGFuZ2UpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLl9kZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgYmluZGluZy5kZXRhY2goKTtcbiAgICAgICAgYmluZGluZy5fbW9kZWwuZGVzdHJveSgpO1xuICAgIH07XG5cbiAgICBpZihwYXRoICE9PSAnLicpe1xuICAgICAgICBiaW5kaW5nLl9tb2RlbC5fZXZlbnRzW3BhdGhdID0gYmluZGluZy5fY2hhbmdlO1xuICAgIH1cblxuICAgIHJldHVybiBiaW5kaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZUJpbmRpbmc7IiwidmFyIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxuZnVuY3Rpb24gZGVyZWZlcmVuY2VTZXR0aW5ncyhzZXR0aW5ncyl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMoc2V0dGluZ3MpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgICAgcmVzdWx0W2tleV0gPSBzZXR0aW5nc1trZXldO1xuICAgICAgICBpZihpcy5iaW5kaW5nT2JqZWN0KHJlc3VsdFtrZXldKSl7XG4gICAgICAgICAgICByZXN1bHRba2V5XSA9IGZhc3RuLmJpbmRpbmcoXG4gICAgICAgICAgICAgICAgcmVzdWx0W2tleV0uX2Zhc3RuX2JpbmRpbmcsXG4gICAgICAgICAgICAgICAgcmVzdWx0W2tleV0uX2RlZmF1bHRWYWx1ZSxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS50cmFuc2Zvcm1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmbGF0dGVuKGl0ZW0pe1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGl0ZW0pID8gaXRlbS5yZWR1Y2UoZnVuY3Rpb24ocmVzdWx0LCBlbGVtZW50KXtcbiAgICAgICAgaWYoZWxlbWVudCA9PSBudWxsKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdC5jb25jYXQoZmxhdHRlbihlbGVtZW50KSk7XG4gICAgfSxbXSkgOiBpdGVtO1xufVxuXG5mdW5jdGlvbiBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCBjYWxsLCBhcmdzKXtcbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGNvbXBvbmVudCk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBwcm9wZXJ0eSA9IGNvbXBvbmVudFtrZXlzW2ldXTtcblxuICAgICAgICBpZighaXMucHJvcGVydHkocHJvcGVydHkpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJvcGVydHlbY2FsbF0uYXBwbHkobnVsbCwgYXJncyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBpbmZsYXRlUHJvcGVydGllcyhjb21wb25lbnQsIHNldHRpbmdzKXtcbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XSxcbiAgICAgICAgICAgIHByb3BlcnR5ID0gY29tcG9uZW50W2tleV07XG5cbiAgICAgICAgaWYoaXMucHJvcGVydHkoc2V0dGluZ3Nba2V5XSkpe1xuXG4gICAgICAgICAgICAvLyBUaGUgY29tcG9uZXQgYWxyZWFkeSBoYXMgYSBwcm9wZXJ0eSBhdCB0aGlzIGtleS5cbiAgICAgICAgICAgIC8vIERlc3Ryb3kgaXQuXG4gICAgICAgICAgICBpZihpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuICAgICAgICAgICAgICAgIHByb3BlcnR5LmRlc3Ryb3koKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0dGluZy5hZGRUbyhjb21wb25lbnQsIGtleSk7XG5cbiAgICAgICAgfWVsc2UgaWYoaXMucHJvcGVydHkocHJvcGVydHkpKXtcblxuICAgICAgICAgICAgaWYoaXMuYmluZGluZyhzZXR0aW5nKSl7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkuYmluZGluZyhzZXR0aW5nKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHByb3BlcnR5KHNldHRpbmcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9wZXJ0eS5hZGRUbyhjb21wb25lbnQsIGtleSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4sIGNvbXBvbmVudHMpe1xuICAgIHZhciBjb21wb25lbnQsXG4gICAgICAgIGJpbmRpbmcsXG4gICAgICAgIHNjb3BlID0gbmV3IGZhc3RuLk1vZGVsKGZhbHNlKTtcblxuICAgIHNldHRpbmdzID0gZGVyZWZlcmVuY2VTZXR0aW5ncyhzZXR0aW5ncyB8fCB7fSk7XG4gICAgY2hpbGRyZW4gPSBmbGF0dGVuKGNoaWxkcmVuKTtcblxuICAgIGlmKCEodHlwZSBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgIGlmKCEoJ19nZW5lcmljJyBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgICAgICB0aHJvdyAnTm8gY29tcG9uZW50IG9mIHR5cGUgXCInICsgdHlwZSArICdcIiBpcyBsb2FkZWQnO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHMuX2dlbmVyaWModHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHNbdHlwZV0odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfVxuXG4gICAgaWYoaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAvLyBUaGUgY29tcG9uZW50IGNvbnN0cnVjdG9yIHJldHVybmVkIGEgcmVhZHktdG8tZ28gY29tcG9uZW50LlxuXG4gICAgICAgIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3MpO1xuXG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfVxuXG4gICAgY29tcG9uZW50Ll90eXBlID0gdHlwZTtcbiAgICBjb21wb25lbnQuX3NldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgY29tcG9uZW50Ll9mYXN0bl9jb21wb25lbnQgPSB0cnVlO1xuICAgIGNvbXBvbmVudC5fY2hpbGRyZW4gPSBjaGlsZHJlbjtcblxuICAgIGNvbXBvbmVudC5hdHRhY2ggPSBmdW5jdGlvbihvYmplY3QsIGZpcm0pe1xuICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIGZpcm0pO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZGV0YWNoID0gZnVuY3Rpb24oZmlybSl7XG4gICAgICAgIGJpbmRpbmcuZGV0YWNoKGZpcm0pO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuc2NvcGUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gc2NvcGU7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5kZXN0cm95ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoY29tcG9uZW50Ll9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5fZGVzdHJveWVkID0gdHJ1ZTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgY29tcG9uZW50LmVsZW1lbnQgPSBudWxsO1xuICAgICAgICBzY29wZS5kZXN0cm95KCk7XG4gICAgICAgIGJpbmRpbmcuZGVzdHJveSgpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICB2YXIgbGFzdEJvdW5kO1xuICAgIGZ1bmN0aW9uIGVtaXRBdHRhY2goKXtcbiAgICAgICAgdmFyIG5ld0JvdW5kID0gYmluZGluZygpO1xuICAgICAgICBpZihuZXdCb3VuZCAhPT0gbGFzdEJvdW5kKXtcbiAgICAgICAgICAgIGxhc3RCb3VuZCA9IG5ld0JvdW5kO1xuICAgICAgICAgICAgc2NvcGUuYXR0YWNoKGxhc3RCb3VuZCk7XG4gICAgICAgICAgICBjb21wb25lbnQuZW1pdCgnYXR0YWNoJywgbGFzdEJvdW5kLCAxKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVtaXREZXRhY2goKXtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2RldGFjaCcsIDEpO1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICAgICAgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcuYXR0YWNoKGJpbmRpbmcuX21vZGVsLCBiaW5kaW5nLl9maXJtKTtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIGVtaXRBdHRhY2gpO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG5cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgZW1pdEF0dGFjaCk7XG4gICAgICAgIGVtaXRBdHRhY2goYmluZGluZygpKTtcblxuICAgICAgICBiaW5kaW5nLm9uKCdkZXRhY2gnLCBlbWl0RGV0YWNoKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KGNvbXBvbmVudC5fdHlwZSwgZmFzdG4sIGNvbXBvbmVudC5fc2V0dGluZ3MsIGNvbXBvbmVudC5fY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiAhY2hpbGQuX3RlbXBsYXRlZDtcbiAgICAgICAgfSkubWFwKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiBjaGlsZC5jbG9uZSgpO1xuICAgICAgICB9KSwgY29tcG9uZW50cyk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5jaGlsZHJlbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQuX2NoaWxkcmVuLnNsaWNlKCk7XG4gICAgfTtcblxuICAgIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3MpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnYXR0YWNoJywgYXJndW1lbnRzKTtcbiAgICB9KTtcbiAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsICd1cGRhdGUnLCBhcmd1bWVudHMpO1xuICAgIH0pO1xuICAgIGNvbXBvbmVudC5vbignZGV0YWNoJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yRWFjaFByb3BlcnR5KGNvbXBvbmVudCwgJ2RldGFjaCcsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG4gICAgY29tcG9uZW50Lm9uY2UoJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnZGVzdHJveScsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG5cbiAgICB2YXIgZGVmYXVsdEJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCcuJyk7XG4gICAgZGVmYXVsdEJpbmRpbmcuX2RlZmF1bHRfYmluZGluZyA9IHRydWU7XG5cbiAgICBjb21wb25lbnQuYmluZGluZyhkZWZhdWx0QmluZGluZyk7XG5cbiAgICBpZihmYXN0bi5kZWJ1Zyl7XG4gICAgICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIHR5cGVvZiBjb21wb25lbnQuZWxlbWVudCA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50Ll9jb21wb25lbnQgPSBjb21wb25lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjb21wb25lbnQ7XG59O1xuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0bil7XG4gICAgdmFyIGNvbnRhaW5lciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIGNvbnRhaW5lci5pbnNlcnQgPSBmdW5jdGlvbihjaGlsZCwgaW5kZXgpe1xuICAgICAgICB2YXIgY29tcG9uZW50ID0gY2hpbGQ7XG5cbiAgICAgICAgaWYoaW5kZXggJiYgdHlwZW9mIGluZGV4ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICBjb21wb25lbnQgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShjb21wb25lbnQpKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5mb3JFYWNoKGZ1bmN0aW9uKGNvbXBvbmVudCwgaSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLmluc2VydChjb21wb25lbnQsIGkgKyAoaW5kZXggfHwgMCkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpLFxuICAgICAgICAgICAgbmV3Q29tcG9uZW50ID0gZmFzdG4udG9Db21wb25lbnQoY29tcG9uZW50KTtcblxuICAgICAgICBpZighaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgaWYofmN1cnJlbnRJbmRleCl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoY3VycmVudEluZGV4LCAxLCBuZXdDb21wb25lbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoaXNOYU4oaW5kZXgpKXtcbiAgICAgICAgICAgIGluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjdXJyZW50SW5kZXggIT09IGluZGV4KXtcbiAgICAgICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgbmV3Q29tcG9uZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCkgJiYgIW5ld0NvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIG5ld0NvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5ld0NvbXBvbmVudC5hdHRhY2goY29udGFpbmVyLnNjb3BlKCksIDEpO1xuXG4gICAgICAgIGNvbnRhaW5lci5faW5zZXJ0KG5ld0NvbXBvbmVudC5lbGVtZW50LCBpbmRleCk7XG5cbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgICB9O1xuXG4gICAgdmFyIHggPSAwO1xuXG4gICAgY29udGFpbmVyLl9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIHZhciBjb250YWluZXJFbGVtZW50ID0gY29udGFpbmVyLmdldENvbnRhaW5lckVsZW1lbnQoKTtcbiAgICAgICAgaWYoIWNvbnRhaW5lckVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoY29udGFpbmVyRWxlbWVudC5jaGlsZE5vZGVzW2luZGV4XSA9PT0gZWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50Lmluc2VydEJlZm9yZShlbGVtZW50LCBjb250YWluZXJFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLnJlbW92ZSA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIHZhciBpbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQuZGV0YWNoKDEpO1xuXG4gICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbXBvbmVudC5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBjb250YWluZXIuX3JlbW92ZSA9IGZ1bmN0aW9uKGVsZW1lbnQpe1xuICAgICAgICB2YXIgY29udGFpbmVyRWxlbWVudCA9IGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgIWNvbnRhaW5lckVsZW1lbnQgfHwgZWxlbWVudC5wYXJlbnROb2RlICE9PSBjb250YWluZXJFbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRhaW5lckVsZW1lbnQucmVtb3ZlQ2hpbGQoZWxlbWVudCk7XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5lbXB0eSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHdoaWxlKGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbnRhaW5lci5fY2hpbGRyZW4ucG9wKCkuZGV0YWNoKDEpLmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lci5jb250YWluZXJFbGVtZW50IHx8IGNvbnRhaW5lci5lbGVtZW50O1xuICAgIH07XG5cbiAgICBjb250YWluZXIub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGNvbnRhaW5lci5pbnNlcnQoY29udGFpbmVyLl9jaGlsZHJlbiwgMCk7XG4gICAgfSk7XG5cbiAgICBjb250YWluZXIub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKGRhdGEsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5hdHRhY2goZGF0YSwgZmlybSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnRhaW5lci5vbignZGVzdHJveScsIGZ1bmN0aW9uKGRhdGEsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5kZXN0cm95KGZpcm0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29udGFpbmVyO1xufTsiLCIvKlxuICAgIEEgY29udmVuaWVuY2Ugc2luZ2xldG9uIHRoYXQgc2V0cyB1cCBmYXN0biBzbyBpdCBjYW4gYmUgcmVxdWlyZWQgZnJvbSBvdGhlciBmaWxlcy5cbiovXG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi4vJykoeyAvLyBSZXF1aXJlIGZhc3RuXG5cbiAgICAvLyBzZXQgdXAgZmFzdG4gd2l0aCBhbGwgdGhlIGNvbXBvbmVudHMgeW91IG5lZWQgZm9yIHlvdXIgYXBwbGljYXRpb25cblxuICAgIC8vIFRoZSBsaXN0IGNvbXBvbmVudCBpcyB1c2VkIHRvIHJlbmRlciBpdGVtcyBiYXNlZCBvbiBhIHNldCBvZiBkYXRhLlxuICAgIGxpc3Q6IHJlcXVpcmUoJy4uL2xpc3RDb21wb25lbnQnKSxcblxuICAgIC8vIFRoZSB0ZXh0IGNvbXBvbmVudCBpcyB1c2VkIHRvIHJlbmRlciB0ZXh0IG9yIGJpbmRpbmdzIHBhc3NlZCBhcyBjaGlsZHJlbiB0byBvdGhlciBjb21wb25lbnRzLlxuICAgIHRleHQ6IHJlcXVpcmUoJy4uL3RleHRDb21wb25lbnQnKSxcblxuICAgIC8vIFRoZSBfZ2VuZXJpYyBjb21wb25lbnQgaXMgYSBjYXRjaC1hbGwgZm9yIGFueSBjb21wb25lbnQgdHlwZSB0aGF0XG4gICAgLy8gIGRvZXNudCBtYXRjaCBhbnkgb3RoZXIgY29tcG9uZW50IGNvbnN0cnVjdG9yLCBlZzogJ2RpdidcbiAgICBfZ2VuZXJpYzogcmVxdWlyZSgnLi4vZ2VuZXJpY0NvbXBvbmVudCcpXG5cbn0sIHRydWUpOyAvLyBQYXNzIHRydWUgYXMgdGhlIHNlY29uZCBwYXJhbWV0ZXIgdG8gdHVybiBvbiBkZWJ1ZyBtb2RlLiIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpeyAgICBcbiAgICByZXR1cm4gZmFzdG4oJ2RpdicsIHtjbGFzczogJ2dpdGh1Yi1mb3JrLXJpYmJvbi13cmFwcGVyIHJpZ2h0J30sXG4gICAgICAgIGZhc3RuKCdkaXYnLCB7Y2xhc3M6ICdnaXRodWItZm9yay1yaWJib24nfSxcbiAgICAgICAgICAgIGZhc3RuKCdhJywge2hyZWY6ICdodHRwczovL2dpdGh1Yi5jb20va29yeW51bm4vZmFzdG4nfSwgJ0ZvcmsgbWUnKVxuICAgICAgICApXG4gICAgKTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzTW9kZWwgPSByZXF1aXJlKCcuL3VzZXJzJykudXNlcnNNb2RlbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWFyY2hNb2RlbCl7XG4gICAgcmV0dXJuIGZhc3RuKCdoZWFkZXInLCB7J2NsYXNzJzonbWFpbkhlYWRlcid9LFxuICAgICAgICBmYXN0bignaW1nJywge3NyYzogJy4vZmFzdG4tc21sLnBuZyd9KSxcbiAgICAgICAgZmFzdG4oJ2gxJywgJ2Zhc3RuJywgZmFzdG4oJ3NwYW4nLCB7Y2xhc3M6ICdmYWludCd9LCAnLmpzJykpLFxuICAgICAgICBmYXN0bignc3BhbicsXG4gICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCd1c2Vyc3wqLmRlbGV0ZWQnLCByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdCwgIGZ1bmN0aW9uKHVzZXJzLCByZXN1bHRzKXtcbiAgICAgICAgICAgICAgICBpZighdXNlcnMpe1xuICAgICAgICAgICAgICAgICAgICB1c2VycyA9IFtdO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciB0b3RhbCA9IHVzZXJzLmZpbHRlcihmdW5jdGlvbih1c2VyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhdXNlci5kZWxldGVkO1xuICAgICAgICAgICAgICAgICAgICB9KS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gJyc7XG5cbiAgICAgICAgICAgICAgICBpZihyZXN1bHRzKXtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ICs9ICdTaG93aW5nICcgKyByZXN1bHRzLmxlbmd0aCArJyBvZiAnO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSB0b3RhbDtcblxuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICcgdXNlcnMnXG4gICAgICAgICkuYXR0YWNoKHVzZXJzTW9kZWwpLFxuICAgICAgICByZXF1aXJlKCcuL3NlYXJjaEJhcicpKClcbiAgICApO1xufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgdXNlclNlcnZpY2UgPSByZXF1aXJlKCcuL3VzZXJzJyk7XG5cbnZhciBhcHAgPSBmYXN0bignZGl2JyxcbiAgICByZXF1aXJlKCcuL2hlYWRlcicpKCksXG4gICAgcmVxdWlyZSgnLi91c2VyTGlzdCcpKCksXG4gICAgcmVxdWlyZSgnLi9zdGF0cycpKCksXG4gICAgcmVxdWlyZSgnLi9mb3JrQmFubmVyJykoKVxuKTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG5cbiAgICBhcHAucmVuZGVyKCk7XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGFwcC5lbGVtZW50KTtcblxuICAgIC8vIENsZWFyIHRoZSBzZWxlY3RlZCB1c2VyIG9uIGNsaWNrIGFueXdoZXJlXG4gICAgLy8gQ2FwdHVyZSBwaGFzZSB0byBhbGxvdyBidWJibGVkIGV2ZW50cyB0byBzZXQgdGhlIHNlbGVjdGVkIHVzZXJcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZ1bmN0aW9uKCl7XG4gICAgICAgIHVzZXJTZXJ2aWNlLnNlbGVjdGVkVXNlcihudWxsKTtcbiAgICB9LCB0cnVlKTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzU2VydmljZSA9IHJlcXVpcmUoJy4vdXNlcnMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuXG4gICAgdmFyIG5ld1VzZXJEaWFsb2cgPSBmYXN0bignZGl2Jywge2NsYXNzOiduZXdVc2VyIGRpYWxvZyd9LFxuICAgICAgICBmYXN0bignZm9ybScsIHtjbGFzczogJ21vZGFsJ30sXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ0ZpcnN0IE5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmZpcnN0JyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ1N1cm5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmxhc3QnKSxcbiAgICAgICAgICAgICAgICAgICAgb25jaGFuZ2U6ICd2YWx1ZTp2YWx1ZSdcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKSxcblxuICAgICAgICAgICAgZmFzdG4oJ2ZpZWxkJyxcbiAgICAgICAgICAgICAgICBmYXN0bignbGFiZWwnLCAnRW1haWwnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpLFxuICAgICAgICAgICAgICAgICAgICBvbmNoYW5nZTogJ3ZhbHVlOnZhbHVlJ1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZmllbGQnLFxuICAgICAgICAgICAgICAgIGZhc3RuKCdsYWJlbCcsICdNb2JpbGUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdjZWxsJyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCAnQWRkJylcbiAgICAgICAgKVxuICAgICAgICAub24oJ3N1Ym1pdCcsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgICB1c2Vyc1NlcnZpY2UuYWRkVXNlcihzY29wZS5nZXQoJy4nKSk7XG5cbiAgICAgICAgICAgIGNsb3NlTW9kYWwoKTtcbiAgICAgICAgfSlcbiAgICApXG4gICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgaWYoZXZlbnQudGFyZ2V0ID09PSB0aGlzLmVsZW1lbnQpe1xuICAgICAgICAgICAgY2xvc2VNb2RhbCgpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBmdW5jdGlvbiBjbG9zZU1vZGFsKCl7XG4gICAgICAgIG5ld1VzZXJEaWFsb2cuZWxlbWVudC5jbGFzc0xpc3QuYWRkKCdjbG9zZWQnKTtcblxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKG5ld1VzZXJEaWFsb2cuZWxlbWVudCk7XG4gICAgICAgICAgICBuZXdVc2VyRGlhbG9nLmRlc3Ryb3koKTtcbiAgICAgICAgfSwzMDApO1xuICAgIH1cblxuICAgIHZhciByYW5kb21JbWFnZUlkID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTAwKTtcblxuICAgIG5ld1VzZXJEaWFsb2cuYXR0YWNoKHtcbiAgICAgICAgJ2dlbmRlcic6bnVsbCxcbiAgICAgICAgJ25hbWUnOntcbiAgICAgICAgICAgICd0aXRsZSc6bnVsbCxcbiAgICAgICAgICAgICdmaXJzdCc6bnVsbCxcbiAgICAgICAgICAgICdsYXN0JzpudWxsXG4gICAgICAgIH0sXG4gICAgICAgICdlbWFpbCc6bnVsbCxcbiAgICAgICAgJ2RvYic6bnVsbCxcbiAgICAgICAgJ2NlbGwnOm51bGwsXG4gICAgICAgICdwaWN0dXJlJzp7XG4gICAgICAgICAgICAnbGFyZ2UnOidodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLycgKyByYW5kb21JbWFnZUlkICsgJy5qcGcnLFxuICAgICAgICAgICAgJ21lZGl1bSc6J2h0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLycgKyByYW5kb21JbWFnZUlkICsgJy5qcGcnLFxuICAgICAgICAgICAgJ3RodW1ibmFpbCc6J2h0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vJyArIHJhbmRvbUltYWdlSWQgKyAnLmpwZydcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgbmV3VXNlckRpYWxvZy5yZW5kZXIoKTtcblxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobmV3VXNlckRpYWxvZy5lbGVtZW50KTtcbn07IiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIHVzZXJzU2VydmljZSA9IHJlcXVpcmUoJy4vdXNlcnMnKTtcbiAgICBzZWFyY2hNb2RlbCA9IHtcbiAgICAgICAgdXNlclNlYXJjaDogJycsXG4gICAgICAgIHJlc3VsdDogbnVsbFxuICAgIH0sXG4gICAgdXNlclNlYXJjaCA9IGZhc3RuLmJpbmRpbmcoJ3VzZXJTZWFyY2gnKS5hdHRhY2goc2VhcmNoTW9kZWwpXG4gICAgICAgIC5vbignY2hhbmdlJywgZnVuY3Rpb24oc2VhcmNoKXtcbiAgICAgICAgICAgIHZhciB1c2VycyA9IHVzZXJzU2VydmljZS51c2VycygpO1xuXG4gICAgICAgICAgICBpZighc2VhcmNoKXtcbiAgICAgICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCBudWxsKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCB1c2Vycy5maWx0ZXIoZnVuY3Rpb24odXNlcil7XG4gICAgICAgICAgICAgICAgaWYoIXVzZXIgfHwgIXVzZXIubmFtZSB8fCAhdXNlci5uYW1lLmZpcnN0IHx8ICF1c2VyLm5hbWUubGFzdCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIH51c2VyLm5hbWUuZmlyc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKSB8fCB+dXNlci5uYW1lLmxhc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHNlYXJjaE1vZGVsOiBzZWFyY2hNb2RlbCxcbiAgICB1c2VyU2VhcmNoOiB1c2VyU2VhcmNoLFxuICAgIHJlc3VsdDogZmFzdG4uYmluZGluZygncmVzdWx0JykuYXR0YWNoKHNlYXJjaE1vZGVsKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgc2VhcmNoID0gcmVxdWlyZSgnLi9zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiBmYXN0bignbmF2Jywge2NsYXNzOiAnc2VhcmNoJ30sXG4gICAgICAgIGZhc3RuKCdsYWJlbCcsICdTZWFyY2gnKSwgXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHsgXG4gICAgICAgICAgICB2YWx1ZTogc2VhcmNoLnVzZXJTZWFyY2gsXG4gICAgICAgICAgICBvbmtleXVwOiAndmFsdWU6dmFsdWUnXG4gICAgICAgIH0pXG4gICAgKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKXtcblxuICAgIHJldHVybiBmYXN0bignZGl2Jywge2NsYXNzOiAnc3RhdHMnfSxcbiAgICAgICAgJ1RoaXMgZXhhbXBsZSBoYXMgJyxcbiAgICAgICAgZmFzdG4uYmluZGluZygnYXR0YWNoZWRFbnRpcycpLFxuICAgICAgICAnIGF0dGFjaGVkIG1vZGVsIGluc3RhbmNlcydcbiAgICApLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhKXtcbiAgICAgICAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGZhc3RuLk1vZGVsLnNldChkYXRhLCAnYXR0YWNoZWRFbnRpcycsIGZhc3RuLk1vZGVsLnByb3RvdHlwZS5hdHRhY2hlZENvdW50KCkpO1xuICAgICAgICB9LDEwMCk7XG4gICAgfSk7XG4gICAgXG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpe1xuICAgIHZhciBzZWFyY2hSZXN1bHQgPSByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdCxcbiAgICAgICAgdXNlcnNTZXJ2aWNlID0gcmVxdWlyZSgnLi91c2VycycpO1xuXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLCB7XG4gICAgICAgICAgICBjbGFzczogZmFzdG4uYmluZGluZygnLicsICduYW1lJywgc2VhcmNoUmVzdWx0LCB1c2Vyc1NlcnZpY2Uuc2VsZWN0ZWRVc2VyLCB1c2Vyc1NlcnZpY2UuZGVsZXRlZFVzZXJzLCBmdW5jdGlvbih1c2VyLCBuYW1lLCBzZWFyY2hSZXN1bHQsIHNlbGVjdGVkVXNlciwgZGVsZXRlZFVzZXJzKXtcbiAgICAgICAgICAgICAgICB2YXIgY2xhc3NlcyA9IFsndXNlciddO1xuXG4gICAgICAgICAgICAgICAgaWYoc2VhcmNoUmVzdWx0ICYmICF+c2VhcmNoUmVzdWx0LmluZGV4T2YodXNlcikpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2hpZGRlbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih1c2VyID09PSBzZWxlY3RlZFVzZXIpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ3NlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKH5kZWxldGVkVXNlcnMuaW5kZXhPZih1c2VyKSl7XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzZXMucHVzaCgnZGVsZXRlZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gY2xhc3NlcztcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG5cbiAgICAgICAgZmFzdG4oJ2ltZycsIHtcbiAgICAgICAgICAgIHNyYzogZmFzdG4uYmluZGluZygncGljdHVyZS5tZWRpdW0nKVxuICAgICAgICB9KSxcblxuICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnZGV0YWlscyd9LFxuXG4gICAgICAgICAgICBmYXN0bignbGFiZWwnLCB7Y2xhc3M6ICduYW1lJ30sXG4gICAgICAgICAgICAgICAgZmFzdG4uYmluZGluZygnbmFtZS5maXJzdCcpLCAnICcsIGZhc3RuLmJpbmRpbmcoJ25hbWUubGFzdCcpXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnaW5mbyd9LFxuXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3AnLCB7Y2xhc3M6J2V4dHJhJ30sXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdhJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhyZWY6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJywgZnVuY3Rpb24oZW1haWwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ21haWx0bzonICsgZW1haWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpXG4gICAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdwJywgZmFzdG4uYmluZGluZygnY2VsbCcsIGZ1bmN0aW9uKGNlbGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdNb2JpbGU6ICcgKyBjZWxsO1xuICAgICAgICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCB7Y2xhc3M6ICdyZW1vdmUnfSwnWCcpXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgICAgICAgICB1c2Vyc1NlcnZpY2UuZGVsZXRlVXNlcihzY29wZS5nZXQoJy4nKSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApXG5cbiAgICApLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgIHVzZXJzU2VydmljZS5zZWxlY3RlZFVzZXIoc2NvcGUuZ2V0KCcuJykpO1xuICAgIH0pO1xufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgdXNlcnNTZXJ2aWNlID0gcmVxdWlyZSgnLi91c2VycycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0JyxcbiAgICAgICAge1xuICAgICAgICAgICAgY2xhc3M6ICd1c2VycycsXG4gICAgICAgICAgICBpdGVtczogdXNlcnNTZXJ2aWNlLnVzZXJzLFxuICAgICAgICAgICAgdGVtcGxhdGU6IGZ1bmN0aW9uKG1vZGVsLCBzY29wZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlcXVpcmUoJy4vdXNlci5qcycpKCkuYmluZGluZygnaXRlbScpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBmYXN0bignYnV0dG9uJywge2NsYXNzOiAnYWRkJ30sICcrJylcbiAgICAgICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICByZXF1aXJlKCcuL25ld1VzZXInKSgpO1xuICAgICAgICB9KVxuICAgICk7XG59OyIsInZhciBjcGpheCA9IHJlcXVpcmUoJ2NwamF4JyksXG4gICAgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbmZ1bmN0aW9uIGdldFVzZXJzKGNhbGxiYWNrKXtcbiAgICBjcGpheCh7XG4gICAgICAgIHVybDogJy4vdXNlcnMuanNvbicsXG4gICAgICAgIGRhdGFUeXBlOiAnanNvbidcbiAgICB9LCBmdW5jdGlvbihlcnJvciwgdXNlcnMpe1xuICAgICAgICBjYWxsYmFjayhlcnJvciwgdXNlcnMubWFwKGZ1bmN0aW9uKHVzZXIpe1xuICAgICAgICAgICAgcmV0dXJuIHVzZXIudXNlcjtcbiAgICAgICAgfSkpO1xuICAgIH0pO1xufTtcblxudmFyIHVzZXJzTW9kZWwgPSBuZXcgZmFzdG4uTW9kZWwoe1xuICAgIHVzZXJzOiBbXSxcbiAgICBkZWxldGVkVXNlcnM6IFtdXG59KTtcblxuZ2V0VXNlcnMoZnVuY3Rpb24oZXJyb3IsIHVzZXJzKXtcbiAgICBpZihlcnJvcil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB1c2Vyc01vZGVsLnNldCgndXNlcnMnLCB1c2Vycyk7XG59KTtcblxuZnVuY3Rpb24gZGVsZXRlVXNlcih1c2VyKXtcbiAgICB1c2Vyc01vZGVsLnB1c2goJ2RlbGV0ZWRVc2VycycsIHVzZXIpO1xufVxuXG5mdW5jdGlvbiBhZGRVc2VyKHVzZXIpe1xuICAgIHVzZXJzTW9kZWwuaW5zZXJ0KCd1c2VycycsIHVzZXIsIDApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICB1c2Vyc01vZGVsOiB1c2Vyc01vZGVsLFxuICAgIHVzZXJzOiBmYXN0bi5iaW5kaW5nKCd1c2Vyc3wqJykuYXR0YWNoKHVzZXJzTW9kZWwpLFxuICAgIGRlbGV0ZWRVc2VyczogZmFzdG4uYmluZGluZygnZGVsZXRlZFVzZXJzfConKS5hdHRhY2godXNlcnNNb2RlbCksXG4gICAgc2VsZWN0ZWRVc2VyOiBmYXN0bi5iaW5kaW5nKCdzZWxlY3RlZCcpLmF0dGFjaCh1c2Vyc01vZGVsKSxcbiAgICBkZWxldGVVc2VyOiBkZWxldGVVc2VyLFxuICAgIGFkZFVzZXI6IGFkZFVzZXJcbn07IiwidmFyIHNldGlmeSA9IHJlcXVpcmUoJ3NldGlmeScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjbGFzczogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNsYXNzTmFtZS5zbGljZShnZW5lcmljLl9pbml0aWFsQ2xhc3Nlcy5sZW5ndGgpO1xuICAgICAgICB9XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkodmFsdWUpKXtcbiAgICAgICAgICAgIHZhbHVlID0gdmFsdWUuam9pbignICcpO1xuICAgICAgICB9XG4gICAgICAgIGVsZW1lbnQuY2xhc3NOYW1lID0gZ2VuZXJpYy5faW5pdGlhbENsYXNzZXMgKyAnICcgKyB2YWx1ZTtcbiAgICB9LFxuICAgIGRpc3BsYXk6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5zdHlsZS5kaXNwbGF5ICE9PSAnbm9uZSc7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gdmFsdWUgPyBudWxsIDogJ25vbmUnO1xuICAgIH0sXG4gICAgZGlzYWJsZWQ6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUpe1xuICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHRleHRDb250ZW50OiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dENvbnRlbnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICB2YXIgaW5wdXRUeXBlID0gZWxlbWVudC50eXBlO1xuXG4gICAgICAgIGlmKGVsZW1lbnQubm9kZU5hbWUgPT09ICdJTlBVVCcgJiYgaW5wdXRUeXBlID09ICdkYXRlJyl7XG4gICAgICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZWxlbWVudC52YWx1ZSA/IG5ldyBEYXRlKGVsZW1lbnQudmFsdWUucmVwbGFjZSgvLS9nLCcvJykucmVwbGFjZSgnVCcsJyAnKSkgOiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YWx1ZSA9IHZhbHVlICE9IG51bGwgPyBuZXcgRGF0ZSh2YWx1ZSkgOiBudWxsO1xuXG4gICAgICAgICAgICBpZighdmFsdWUgfHwgaXNOYU4odmFsdWUpKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGVsZW1lbnQudmFsdWUgPSBbXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlLmdldEZ1bGxZZWFyKCksIFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgKHZhbHVlLmdldE1vbnRoKCkgKyAxKSkuc2xpY2UoLTIpLFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgdmFsdWUuZ2V0RGF0ZSgpKS5zbGljZSgtMilcbiAgICAgICAgICAgICAgICBdLmpvaW4oJy0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBzZXRpZnkoZWxlbWVudCwgdmFsdWUpO1xuICAgIH0sXG4gICAgc3R5bGU6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5zdHlsZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZXN1bHQgPSAnJztcblxuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICB9XG4gICAgfVxufTsiLCIvLyBJcyB0aGUgZW50aXR5IGZpcm1lciB0aGFuIHRoZSBuZXcgZmlybW5lc3Ncbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZW50aXR5LCBmaXJtKXtcbiAgICBpZihmaXJtICE9IG51bGwgJiYgKGVudGl0eS5fZmlybSA9PT0gdW5kZWZpbmVkIHx8IGZpcm0gPCBlbnRpdHkuX2Zpcm0pKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufTsiLCJ2YXIgY29udGFpbmVyQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9jb250YWluZXJDb21wb25lbnQnKSxcbiAgICBzY2hlZHVsZSA9IHJlcXVpcmUoJy4vc2NoZWR1bGUnKSxcbiAgICBmYW5jeVByb3BzID0gcmVxdWlyZSgnLi9mYW5jeVByb3BzJyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnR5KGZhc3RuLCBnZW5lcmljLCBrZXksIHNldHRpbmdzKXtcbiAgICB2YXIgc2V0dGluZyA9IHNldHRpbmdzW2tleV0sXG4gICAgICAgIGJpbmRpbmcgPSBmYXN0bi5pc0JpbmRpbmcoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgcHJvcGVydHkgPSBmYXN0bi5pc1Byb3BlcnR5KHNldHRpbmcpICYmIHNldHRpbmcsXG4gICAgICAgIHZhbHVlID0gIWJpbmRpbmcgJiYgIXByb3BlcnR5ICYmIChrZXkgaW4gc2V0dGluZ3MpID8gc2V0dGluZyA6IHVuZGVmaW5lZDtcblxuICAgIGlmKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUoKXtcbiAgICAgICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmdldENvbnRhaW5lckVsZW1lbnQoKSxcbiAgICAgICAgICAgIHZhbHVlID0gcHJvcGVydHkoKTtcblxuICAgICAgICBpZighZWxlbWVudCB8fCBnZW5lcmljLl9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGlzUHJvcGVydHkgPSBrZXkgaW4gZWxlbWVudCxcbiAgICAgICAgICAgIGZhbmN5UHJvcCA9IGZhbmN5UHJvcHNba2V5XSxcbiAgICAgICAgICAgIHByZXZpb3VzID0gZmFuY3lQcm9wID8gZmFuY3lQcm9wKGdlbmVyaWMsIGVsZW1lbnQpIDogaXNQcm9wZXJ0eSA/IGVsZW1lbnRba2V5XSA6IGVsZW1lbnQuZ2V0QXR0cmlidXRlKGtleSk7XG5cbiAgICAgICAgaWYoIWZhbmN5UHJvcCAmJiAhaXNQcm9wZXJ0eSAmJiB2YWx1ZSA9PSBudWxsKXtcbiAgICAgICAgICAgIHZhbHVlID0gJyc7XG4gICAgICAgIH1cblxuICAgICAgICBpZih2YWx1ZSAhPT0gcHJldmlvdXMpe1xuICAgICAgICAgICAgaWYoZmFuY3lQcm9wKXtcbiAgICAgICAgICAgICAgICBmYW5jeVByb3AoZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoaXNQcm9wZXJ0eSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighcHJvcGVydHkpe1xuICAgICAgICBwcm9wZXJ0eSA9IGZhc3RuLnByb3BlcnR5KHZhbHVlLCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgZ2VuZXJpYy51cGRhdGVQcm9wZXJ0eShnZW5lcmljLCBwcm9wZXJ0eSwgdXBkYXRlKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYoYmluZGluZyl7XG4gICAgICAgIHByb3BlcnR5LmJpbmRpbmcoYmluZGluZyk7XG4gICAgfVxuXG4gICAgcHJvcGVydHkuYWRkVG8oZ2VuZXJpYywga2V5KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgY3JlYXRlUHJvcGVydHkoZmFzdG4sIGdlbmVyaWMsIGtleSwgc2V0dGluZ3MpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkVXBkYXRlSGFuZGxlcihnZW5lcmljLCBldmVudE5hbWUsIHNldHRpbmdzKXtcbiAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpLFxuICAgICAgICBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICAgICAgZ2VuZXJpYy5lbWl0KGV2ZW50TmFtZSwgZXZlbnQsIGdlbmVyaWMuc2NvcGUoKSk7XG4gICAgICAgIH07XG5cbiAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcblxuICAgIGdlbmVyaWMub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkQXV0b0hhbmRsZXIoZ2VuZXJpYywga2V5LCBzZXR0aW5ncyl7XG4gICAgaWYoIXNldHRpbmdzW2tleV0pe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmdldENvbnRhaW5lckVsZW1lbnQoKSxcbiAgICAgICAgYXV0b0V2ZW50ID0gc2V0dGluZ3Nba2V5XS5zcGxpdCgnOicpLFxuICAgICAgICBldmVudE5hbWUgPSBrZXkuc2xpY2UoMik7XG5cbiAgICBkZWxldGUgc2V0dGluZ3Nba2V5XTtcblxuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICB2YXIgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1thdXRvRXZlbnRbMV1dLFxuICAgICAgICAgICAgdmFsdWUgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoZ2VuZXJpYywgZWxlbWVudCkgOiBlbGVtZW50W2F1dG9FdmVudFsxXV07XG5cbiAgICAgICAgZ2VuZXJpY1thdXRvRXZlbnRbMF1dKHZhbHVlKTtcbiAgICB9O1xuXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG5cbiAgICBnZW5lcmljLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGdlbmVyaWNDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGdlbmVyaWMgPSBjb250YWluZXJDb21wb25lbnQodHlwZSwgZmFzdG4pO1xuXG4gICAgZ2VuZXJpYy5faW5pdGlhbENsYXNzZXMgPSAnJztcblxuICAgIGdlbmVyaWMudXBkYXRlUHJvcGVydHkgPSBnZW5lcmljQ29tcG9uZW50LnVwZGF0ZVByb3BlcnR5O1xuICAgIGdlbmVyaWMuY3JlYXRlRWxlbWVudCA9IGdlbmVyaWNDb21wb25lbnQuY3JlYXRlRWxlbWVudDtcbiAgICBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBnZW5lcmljLCBzZXR0aW5ncyk7XG5cbiAgICBnZW5lcmljLnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGdlbmVyaWMuZWxlbWVudCA9IGdlbmVyaWMuY3JlYXRlRWxlbWVudChzZXR0aW5ncy50YWdOYW1lIHx8IHR5cGUpO1xuXG4gICAgICAgIGdlbmVyaWMuZW1pdCgncmVuZGVyJyk7XG5cbiAgICAgICAgcmV0dXJuIGdlbmVyaWM7XG4gICAgfTtcblxuICAgIGdlbmVyaWMub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgZ2VuZXJpYy5faW5pdGlhbENsYXNzZXMgPSBlbGVtZW50LmNsYXNzTmFtZTtcblxuICAgICAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgICAgICBpZihrZXkuc2xpY2UoMCwyKSA9PT0gJ29uJyAmJiBrZXkgaW4gZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkQXV0b0hhbmRsZXIoZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmb3IodmFyIGV2ZW50S2V5IGluIGdlbmVyaWMuX2V2ZW50cyl7XG4gICAgICAgICAgICBpZignb24nICsgZXZlbnRLZXkudG9Mb3dlckNhc2UoKSBpbiBlbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGV2ZW50S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGdlbmVyaWM7XG59O1xuXG5nZW5lcmljQ29tcG9uZW50LnVwZGF0ZVByb3BlcnR5ID0gZnVuY3Rpb24oZ2VuZXJpYywgcHJvcGVydHksIHVwZGF0ZSl7XG4gICAgaWYodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5jb250YWlucyhnZW5lcmljLmVsZW1lbnQpKXtcbiAgICAgICAgc2NoZWR1bGUocHJvcGVydHksIHVwZGF0ZSk7XG4gICAgfWVsc2V7XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgIH1cbn07XG5cbmdlbmVyaWNDb21wb25lbnQuY3JlYXRlRWxlbWVudCA9IGZ1bmN0aW9uKHRhZ05hbWUpe1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZ05hbWUpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBnZW5lcmljQ29tcG9uZW50OyIsInZhciBtZXJnZSA9IHJlcXVpcmUoJ2ZsYXQtbWVyZ2UnKSxcbiAgICBjcmVhdGVDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbXBvbmVudCcpLFxuICAgIGNyZWF0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9wcm9wZXJ0eScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMjtcblxuICAgICAgICBpZihpcy5jb21wb25lbnQoYXJnc1sxXSkgfHwgQXJyYXkuaXNBcnJheShhcmdzWzFdKSB8fCB0eXBlb2YgYXJnc1sxXSAhPT0gJ29iamVjdCcgfHwgIWFyZ3NbMV0pe1xuICAgICAgICAgICAgY2hpbGRyZW5JbmRleC0tO1xuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGFyZ3Muc2xpY2UoY2hpbGRyZW5JbmRleCksIGNvbXBvbmVudHMpO1xuICAgIH1cblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG5cbiAgICBmYXN0bi5wcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5O1xuXG4gICAgZmFzdG4uYmluZGluZyA9IGNyZWF0ZUJpbmRpbmc7XG5cbiAgICBmYXN0bi50b0NvbXBvbmVudCA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIGlmKGNvbXBvbmVudCA9PSBudWxsKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZihpcy5jb21wb25lbnQoY29tcG9uZW50KSl7XG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgICAgICB9XG4gICAgICAgIGlmKHR5cGVvZiBjb21wb25lbnQgIT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bigndGV4dCcsIHt0ZXh0OiBjb21wb25lbnR9KTtcbiAgICAgICAgfVxuICAgICAgICBpZihjcmVsLmlzRWxlbWVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bihjb21wb25lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNOb2RlKGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCd0ZXh0Jywge3RleHQ6IGNvbXBvbmVudC50ZXh0Q29udGVudH0pO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZhc3RuLmlzQ29tcG9uZW50ID0gaXMuY29tcG9uZW50O1xuICAgIGZhc3RuLmlzQmluZGluZyA9IGlzLmJpbmRpbmc7XG4gICAgZmFzdG4uaXNEZWZhdWx0QmluZGluZyA9IGlzLmRlZmF1bHRCaW5kaW5nO1xuICAgIGZhc3RuLmlzQmluZGluZ09iamVjdCA9IGlzLmJpbmRpbmdPYmplY3Q7XG4gICAgZmFzdG4uaXNQcm9wZXJ0eSA9IGlzLnByb3BlcnR5O1xuICAgIGZhc3RuLk1vZGVsID0gRW50aTtcblxuICAgIHJldHVybiBmYXN0bjtcbn07IiwiXG5mdW5jdGlvbiBpc0NvbXBvbmVudCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9jb21wb25lbnQnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmdPYmplY3QodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc1Byb3BlcnR5KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fcHJvcGVydHknIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0RlZmF1bHRCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmcgJiYgJ19kZWZhdWx0X2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb21wb25lbnQ6IGlzQ29tcG9uZW50LFxuICAgIGJpbmRpbmdPYmplY3Q6IGlzQmluZGluZ09iamVjdCxcbiAgICBiaW5kaW5nOiBpc0JpbmRpbmcsXG4gICAgZGVmYXVsdEJpbmRpbmc6IGlzRGVmYXVsdEJpbmRpbmcsXG4gICAgcHJvcGVydHk6IGlzUHJvcGVydHlcbn07IiwidmFyIE1hcCA9IHJlcXVpcmUoJ2VzNi1tYXAnKTtcblxuZnVuY3Rpb24gZWFjaCh2YWx1ZSwgZm4pe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKEFycmF5LmlzQXJyYXkodmFsdWUpKXtcbiAgICAgICAgdmFsdWUuZm9yRWFjaChmbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgICAgIGZuKHZhbHVlW2tleV0sIGtleSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGtleUZvcihvYmplY3QsIHZhbHVlKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgIGlmKG9iamVjdFtrZXldID09PSB2YWx1ZSl7XG4gICAgICAgICAgICByZXR1cm4ga2V5O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiB2YWx1ZXMob2JqZWN0KXtcbiAgICBpZihBcnJheS5pc0FycmF5KG9iamVjdCkpe1xuICAgICAgICByZXR1cm4gb2JqZWN0LnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgcmVzdWx0LnB1c2gob2JqZWN0W2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgc2V0dGluZ3MudGFnTmFtZSA9IHNldHRpbmdzLnRhZ05hbWUgfHwgJ2Rpdic7XG4gICAgXG4gICAgdmFyIGxpc3QgPSBmYXN0bignX2dlbmVyaWMnLCBzZXR0aW5ncywgY2hpbGRyZW4pLFxuICAgICAgICBpdGVtc01hcCA9IG5ldyBNYXAoKSxcbiAgICAgICAgbGFzdFRlbXBsYXRlO1xuXG4gICAgbGlzdC5fdHlwZSA9ICdsaXN0JztcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZUl0ZW1zKCl7XG4gICAgICAgIHZhciB2YWx1ZSA9IGxpc3QuaXRlbXMoKSxcbiAgICAgICAgICAgIHRlbXBsYXRlID0gbGlzdC50ZW1wbGF0ZSgpLFxuICAgICAgICAgICAgZW1wdHlUZW1wbGF0ZSA9IGxpc3QuZW1wdHlUZW1wbGF0ZSgpLFxuICAgICAgICAgICAgbmV3VGVtcGxhdGUgPSBsYXN0VGVtcGxhdGUgIT09IHRlbXBsYXRlO1xuXG4gICAgICAgIGlmKCF0ZW1wbGF0ZSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXRlbXMgPSB2YWx1ZXModmFsdWUpO1xuICAgICAgICAgICAgY3VycmVudEl0ZW1zID0gaXRlbXMuc2xpY2UoKTtcblxuICAgICAgICBpdGVtc01hcC5mb3JFYWNoKGZ1bmN0aW9uKGNvbXBvbmVudCwgaXRlbSl7XG4gICAgICAgICAgICB2YXIgY3VycmVudEluZGV4ID0gY3VycmVudEl0ZW1zLmluZGV4T2YoaXRlbSk7XG5cbiAgICAgICAgICAgIGlmKCFuZXdUZW1wbGF0ZSAmJiB+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXMuc3BsaWNlKGN1cnJlbnRJbmRleCwxKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGxpc3QucmVtb3ZlSXRlbShpdGVtLCBpdGVtc01hcCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBpbmRleCA9IDA7XG5cbiAgICAgICAgZWFjaCh2YWx1ZSwgZnVuY3Rpb24oaXRlbSwga2V5KXtcbiAgICAgICAgICAgIHdoaWxlKGluZGV4IDwgbGlzdC5fY2hpbGRyZW4ubGVuZ3RoICYmIGxpc3QuX2NoaWxkcmVuW2luZGV4XS5fdGVtcGxhdGVkICYmICF+aXRlbXMuaW5kZXhPZihsaXN0Ll9jaGlsZHJlbltpbmRleF0uX2xpc3RJdGVtKSl7XG4gICAgICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGNoaWxkLFxuICAgICAgICAgICAgICAgIG1vZGVsID0gbmV3IGZhc3RuLk1vZGVsKHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbTogaXRlbSxcbiAgICAgICAgICAgICAgICAgICAga2V5OiBrZXlcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYoIWl0ZW1zTWFwLmhhcyhpdGVtKSl7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudCh0ZW1wbGF0ZShtb2RlbCwgbGlzdC5zY29wZSgpKSk7XG4gICAgICAgICAgICAgICAgaWYoIWNoaWxkKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQgPSBmYXN0bigndGVtcGxhdGUnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2hpbGQuX2xpc3RJdGVtID0gaXRlbTtcbiAgICAgICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIGl0ZW1zTWFwLnNldChpdGVtLCBjaGlsZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGl0ZW1zTWFwLmdldChpdGVtKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY2hpbGQpICYmIGxpc3QuX3NldHRpbmdzLmF0dGFjaFRlbXBsYXRlcyAhPT0gZmFsc2Upe1xuICAgICAgICAgICAgICAgIGNoaWxkLmF0dGFjaChtb2RlbCwgMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkLCBpbmRleCk7XG4gICAgICAgICAgICBpbmRleCsrO1xuICAgICAgICB9KTtcblxuICAgICAgICBsYXN0VGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICAgICAgICBpZihpbmRleCA9PT0gMCAmJiBlbXB0eVRlbXBsYXRlKXtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IGZhc3RuLnRvQ29tcG9uZW50KGVtcHR5VGVtcGxhdGUobGlzdC5zY29wZSgpKSk7XG4gICAgICAgICAgICBpZighY2hpbGQpe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4oJ3RlbXBsYXRlJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgaXRlbXNNYXAuc2V0KHt9LCBjaGlsZCk7XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxpc3QucmVtb3ZlSXRlbSA9IGZ1bmN0aW9uKGl0ZW0sIGl0ZW1zTWFwKXtcbiAgICAgICAgdmFyIGNvbXBvbmVudCA9IGl0ZW1zTWFwLmdldChpdGVtKTtcbiAgICAgICAgbGlzdC5yZW1vdmUoY29tcG9uZW50KTtcbiAgICAgICAgY29tcG9uZW50LmRlc3Ryb3koKTtcbiAgICAgICAgaXRlbXNNYXAuZGVsZXRlKGl0ZW0pO1xuICAgIH07XG5cbiAgICBmYXN0bi5wcm9wZXJ0eShbXSwgc2V0dGluZ3MuaXRlbUNoYW5nZXMgfHwgJ3R5cGUgc3RydWN0dXJlJywgdXBkYXRlSXRlbXMpXG4gICAgICAgIC5hZGRUbyhsaXN0LCAnaXRlbXMnKTtcblxuICAgIGZhc3RuLnByb3BlcnR5KHVuZGVmaW5lZCwgJ3ZhbHVlJylcbiAgICAgICAgLmFkZFRvKGxpc3QsICd0ZW1wbGF0ZScpXG4gICAgICAgIC5vbignY2hhbmdlJywgdXBkYXRlSXRlbXMpO1xuXG4gICAgZmFzdG4ucHJvcGVydHkodW5kZWZpbmVkLCAndmFsdWUnKVxuICAgICAgICAuYWRkVG8obGlzdCwgJ2VtcHR5VGVtcGxhdGUnKVxuICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZUl0ZW1zKTtcblxuICAgIHJldHVybiBsaXN0O1xufTsiLCIvKipcblxuICAgIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBhZGQgRXZlbnRFbWl0dGVyIG1ldGhvZHMgdG8gZnVuY3Rpb25zLFxuICAgIHdoaWNoIGNhbm5vdCBiZSBhZGRlZCBpbiB0aGUgdXN1YWwsIENvbnN0cnVjdG9yLnByb3RvdHlwZSBmYXNzaW9uLlxuXG4qL1xuXG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG52YXIgZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlID0gZnVuY3Rpb24oKXt9O1xuZm9yKHZhciBrZXkgaW4gRXZlbnRFbWl0dGVyLnByb3RvdHlwZSl7XG4gICAgZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlW2tleV0gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlW2tleV07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWFrZUZ1bmN0aW9uRW1pdHRlcihvYmplY3Qpe1xuICAgIGlmKE9iamVjdC5zZXRQcm90b3R5cGVPZil7XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZihvYmplY3QsIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSk7XG4gICAgfWVsc2UgaWYoX19wcm90b19fIGluIG9iamVjdCl7XG4gICAgICAgIG9iamVjdC5fX3Byb3RvX18gPSBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGU7XG4gICAgfWVsc2V7XG4gICAgICAgIGZvcih2YXIga2V5IGluIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSl7XG4gICAgICAgICAgICBvYmplY3Rba2V5XSA9IGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldO1xuICAgICAgICB9XG4gICAgfVxufTsiLCJ2YXIgQWpheCA9IHJlcXVpcmUoJ3NpbXBsZS1hamF4Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oc2V0dGluZ3MsIGNhbGxiYWNrKXtcbiAgICBpZih0eXBlb2Ygc2V0dGluZ3MgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgc2V0dGluZ3MgPSB7XG4gICAgICAgICAgICB1cmw6IHNldHRpbmdzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIHNldHRpbmdzICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHRocm93ICdzZXR0aW5ncyBtdXN0IGJlIGEgc3RyaW5nIG9yIG9iamVjdCc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgdGhyb3cgJ2NwamF4IG11c3QgYmUgcGFzc2VkIGEgY2FsbGJhY2sgYXMgdGhlIHNlY29uZCBwYXJhbWV0ZXInO1xuICAgIH1cblxuICAgIHZhciBhamF4ID0gbmV3IEFqYXgoc2V0dGluZ3MpO1xuXG4gICAgYWpheC5vbignc3VjY2VzcycsIGZ1bmN0aW9uKGV2ZW50LCBkYXRhKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEsIGV2ZW50KTtcbiAgICB9KTtcbiAgICBhamF4Lm9uKCdlcnJvcicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGNhbGxiYWNrKGV2ZW50LnRhcmdldC5yZXNwb25zZVRleHQsIG51bGwsIGV2ZW50KTtcbiAgICB9KTtcblxuICAgIGFqYXguc2VuZCgpO1xuXG4gICAgcmV0dXJuIGFqYXg7XG59OyIsInZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgcXVlcnlTdHJpbmcgPSByZXF1aXJlKCdxdWVyeS1zdHJpbmcnKTtcblxuZnVuY3Rpb24gdHJ5UGFyc2VKc29uKGRhdGEpe1xuICAgIHRyeXtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoZGF0YSk7XG4gICAgfWNhdGNoKGVycm9yKXtcbiAgICAgICAgcmV0dXJuIGVycm9yO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gdGltZW91dCgpe1xuICAgdGhpcy5yZXF1ZXN0LmFib3J0KCk7XG4gICB0aGlzLmVtaXQoJ3RpbWVvdXQnKTtcbn1cblxuZnVuY3Rpb24gQWpheChzZXR0aW5ncyl7XG4gICAgdmFyIHF1ZXJ5U3RyaW5nRGF0YSxcbiAgICAgICAgYWpheCA9IHRoaXM7XG5cbiAgICBpZih0eXBlb2Ygc2V0dGluZ3MgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgc2V0dGluZ3MgPSB7XG4gICAgICAgICAgICB1cmw6IHNldHRpbmdzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIHNldHRpbmdzICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHNldHRpbmdzID0ge307XG4gICAgfVxuXG4gICAgYWpheC5zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgIGFqYXgucmVxdWVzdCA9IG5ldyB3aW5kb3cuWE1MSHR0cFJlcXVlc3QoKTtcbiAgICBhamF4LnNldHRpbmdzLm1ldGhvZCA9IGFqYXguc2V0dGluZ3MubWV0aG9kIHx8ICdnZXQnO1xuXG4gICAgaWYoYWpheC5zZXR0aW5ncy5jb3JzKXtcbiAgICAgICAgLy9odHRwOi8vd3d3Lmh0bWw1cm9ja3MuY29tL2VuL3R1dG9yaWFscy9jb3JzL1xuICAgICAgICBpZiAoJ3dpdGhDcmVkZW50aWFscycgaW4gYWpheC5yZXF1ZXN0KSB7XG4gICAgICAgICAgICBhamF4LnJlcXVlc3Qud2l0aENyZWRlbnRpYWxzID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgWERvbWFpblJlcXVlc3QgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICAvLyBPdGhlcndpc2UsIGNoZWNrIGlmIFhEb21haW5SZXF1ZXN0LlxuICAgICAgICAgICAgLy8gWERvbWFpblJlcXVlc3Qgb25seSBleGlzdHMgaW4gSUUsIGFuZCBpcyBJRSdzIHdheSBvZiBtYWtpbmcgQ09SUyByZXF1ZXN0cy5cbiAgICAgICAgICAgIGFqYXgucmVxdWVzdCA9IG5ldyB3aW5kb3cuWERvbWFpblJlcXVlc3QoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIE90aGVyd2lzZSwgQ09SUyBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBicm93c2VyLlxuICAgICAgICAgICAgYWpheC5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignQ29ycyBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoaXMgYnJvd3NlcicpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKGFqYXguc2V0dGluZ3MuY2FjaGUgPT09IGZhbHNlKXtcbiAgICAgICAgYWpheC5zZXR0aW5ncy5kYXRhID0gYWpheC5zZXR0aW5ncy5kYXRhIHx8IHt9O1xuICAgICAgICBhamF4LnNldHRpbmdzLmRhdGEuXyA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgIH1cblxuICAgIGlmKGFqYXguc2V0dGluZ3MubWV0aG9kLnRvTG93ZXJDYXNlKCkgPT09ICdnZXQnICYmIHR5cGVvZiBhamF4LnNldHRpbmdzLmRhdGEgPT09ICdvYmplY3QnKXtcbiAgICAgICAgdmFyIHVybFBhcnRzID0gYWpheC5zZXR0aW5ncy51cmwuc3BsaXQoJz8nKTtcblxuICAgICAgICBxdWVyeVN0cmluZ0RhdGEgPSBxdWVyeVN0cmluZy5wYXJzZSh1cmxQYXJ0c1sxXSk7XG5cbiAgICAgICAgZm9yKHZhciBrZXkgaW4gYWpheC5zZXR0aW5ncy5kYXRhKXtcbiAgICAgICAgICAgIHF1ZXJ5U3RyaW5nRGF0YVtrZXldID0gYWpheC5zZXR0aW5ncy5kYXRhW2tleV07XG4gICAgICAgIH1cblxuICAgICAgICBhamF4LnNldHRpbmdzLnVybCA9IHVybFBhcnRzWzBdICsgJz8nICsgcXVlcnlTdHJpbmcuc3RyaW5naWZ5KHF1ZXJ5U3RyaW5nRGF0YSk7XG4gICAgICAgIGFqYXguc2V0dGluZ3MuZGF0YSA9IG51bGw7XG4gICAgfVxuXG4gICAgYWpheC5yZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ3Byb2dyZXNzJywgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBhamF4LmVtaXQoJ3Byb2dyZXNzJywgZXZlbnQpO1xuICAgIH0sIGZhbHNlKTtcblxuICAgIGFqYXgucmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICB2YXIgZGF0YSA9IGV2ZW50LnRhcmdldC5yZXNwb25zZVRleHQ7XG5cbiAgICAgICAgaWYoYWpheC5zZXR0aW5ncy5kYXRhVHlwZSAmJiBhamF4LnNldHRpbmdzLmRhdGFUeXBlLnRvTG93ZXJDYXNlKCkgPT09ICdqc29uJyl7XG4gICAgICAgICAgICBpZihkYXRhID09PSAnJyl7XG4gICAgICAgICAgICAgICAgZGF0YSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGRhdGEgPSB0cnlQYXJzZUpzb24oZGF0YSk7XG4gICAgICAgICAgICAgICAgaWYoZGF0YSBpbnN0YW5jZW9mIEVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgYWpheC5lbWl0KCdlcnJvcicsIGV2ZW50LCBkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2ZW50LnRhcmdldC5zdGF0dXMgPj0gNDAwKXtcbiAgICAgICAgICAgIGFqYXguZW1pdCgnZXJyb3InLCBldmVudCwgZGF0YSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhamF4LmVtaXQoJ3N1Y2Nlc3MnLCBldmVudCwgZGF0YSk7XG4gICAgICAgIH1cblxuICAgIH0sIGZhbHNlKTtcblxuICAgIGFqYXgucmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgYWpheC5lbWl0KCdlcnJvcicsIGV2ZW50KTtcbiAgICB9LCBmYWxzZSk7XG5cbiAgICBhamF4LnJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignYWJvcnQnLCBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGFqYXguZW1pdCgnYWJvcnQnLCBldmVudCk7XG4gICAgfSwgZmFsc2UpO1xuXG4gICAgYWpheC5yZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWRlbmQnLCBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZXF1ZXN0VGltZW91dCk7XG4gICAgICAgIGFqYXguZW1pdCgnY29tcGxldGUnLCBldmVudCk7XG4gICAgfSwgZmFsc2UpO1xuXG4gICAgYWpheC5yZXF1ZXN0Lm9wZW4oYWpheC5zZXR0aW5ncy5tZXRob2QgfHwgJ2dldCcsIGFqYXguc2V0dGluZ3MudXJsLCB0cnVlKTtcblxuICAgIC8vIFNldCBkZWZhdWx0IGhlYWRlcnNcbiAgICBpZihhamF4LnNldHRpbmdzLmNvbnRlbnRUeXBlICE9PSBmYWxzZSl7XG4gICAgICAgIGFqYXgucmVxdWVzdC5zZXRSZXF1ZXN0SGVhZGVyKCdDb250ZW50LVR5cGUnLCBhamF4LnNldHRpbmdzLmNvbnRlbnRUeXBlIHx8ICdhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04Jyk7XG4gICAgfVxuICAgIGFqYXgucmVxdWVzdC5zZXRSZXF1ZXN0SGVhZGVyKCdYLVJlcXVlc3RlZC1XaXRoJywgYWpheC5zZXR0aW5ncy5yZXF1ZXN0ZWRXaXRoIHx8ICdYTUxIdHRwUmVxdWVzdCcpO1xuICAgIGlmKGFqYXguc2V0dGluZ3MuYXV0aCl7XG4gICAgICAgIGFqYXgucmVxdWVzdC5zZXRSZXF1ZXN0SGVhZGVyKCdBdXRob3JpemF0aW9uJywgYWpheC5zZXR0aW5ncy5hdXRoKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgY3VzdG9tIGhlYWRlcnNcbiAgICBmb3IodmFyIGhlYWRlcktleSBpbiBhamF4LnNldHRpbmdzLmhlYWRlcnMpe1xuICAgICAgICBhamF4LnJlcXVlc3Quc2V0UmVxdWVzdEhlYWRlcihoZWFkZXJLZXksIGFqYXguc2V0dGluZ3MuaGVhZGVyc1toZWFkZXJLZXldKTtcbiAgICB9XG5cbiAgICBpZihhamF4LnNldHRpbmdzLnByb2Nlc3NEYXRhICE9PSBmYWxzZSAmJiBhamF4LnNldHRpbmdzLmRhdGFUeXBlID09PSAnanNvbicpe1xuICAgICAgICBhamF4LnNldHRpbmdzLmRhdGEgPSBKU09OLnN0cmluZ2lmeShhamF4LnNldHRpbmdzLmRhdGEpO1xuICAgIH1cbn1cblxuQWpheC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEV2ZW50RW1pdHRlci5wcm90b3R5cGUpO1xuXG5BamF4LnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24oKXtcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgIHRpbWVvdXQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy5zZXR0aW5ncy50aW1lb3V0IHx8IDEyMDAwMFxuICAgICk7XG4gICAgdGhpcy5yZXF1ZXN0LnNlbmQodGhpcy5zZXR0aW5ncy5kYXRhICYmIHRoaXMuc2V0dGluZ3MuZGF0YSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFqYXg7IiwiLyohXG5cdHF1ZXJ5LXN0cmluZ1xuXHRQYXJzZSBhbmQgc3RyaW5naWZ5IFVSTCBxdWVyeSBzdHJpbmdzXG5cdGh0dHBzOi8vZ2l0aHViLmNvbS9zaW5kcmVzb3JodXMvcXVlcnktc3RyaW5nXG5cdGJ5IFNpbmRyZSBTb3JodXNcblx0TUlUIExpY2Vuc2VcbiovXG4oZnVuY3Rpb24gKCkge1xuXHQndXNlIHN0cmljdCc7XG5cdHZhciBxdWVyeVN0cmluZyA9IHt9O1xuXG5cdHF1ZXJ5U3RyaW5nLnBhcnNlID0gZnVuY3Rpb24gKHN0cikge1xuXHRcdGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJykge1xuXHRcdFx0cmV0dXJuIHt9O1xuXHRcdH1cblxuXHRcdHN0ciA9IHN0ci50cmltKCkucmVwbGFjZSgvXihcXD98IykvLCAnJyk7XG5cblx0XHRpZiAoIXN0cikge1xuXHRcdFx0cmV0dXJuIHt9O1xuXHRcdH1cblxuXHRcdHJldHVybiBzdHIudHJpbSgpLnNwbGl0KCcmJykucmVkdWNlKGZ1bmN0aW9uIChyZXQsIHBhcmFtKSB7XG5cdFx0XHR2YXIgcGFydHMgPSBwYXJhbS5yZXBsYWNlKC9cXCsvZywgJyAnKS5zcGxpdCgnPScpO1xuXHRcdFx0dmFyIGtleSA9IHBhcnRzWzBdO1xuXHRcdFx0dmFyIHZhbCA9IHBhcnRzWzFdO1xuXG5cdFx0XHRrZXkgPSBkZWNvZGVVUklDb21wb25lbnQoa2V5KTtcblx0XHRcdC8vIG1pc3NpbmcgYD1gIHNob3VsZCBiZSBgbnVsbGA6XG5cdFx0XHQvLyBodHRwOi8vdzMub3JnL1RSLzIwMTIvV0QtdXJsLTIwMTIwNTI0LyNjb2xsZWN0LXVybC1wYXJhbWV0ZXJzXG5cdFx0XHR2YWwgPSB2YWwgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBkZWNvZGVVUklDb21wb25lbnQodmFsKTtcblxuXHRcdFx0aWYgKCFyZXQuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuXHRcdFx0XHRyZXRba2V5XSA9IHZhbDtcblx0XHRcdH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShyZXRba2V5XSkpIHtcblx0XHRcdFx0cmV0W2tleV0ucHVzaCh2YWwpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0cmV0W2tleV0gPSBbcmV0W2tleV0sIHZhbF07XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiByZXQ7XG5cdFx0fSwge30pO1xuXHR9O1xuXG5cdHF1ZXJ5U3RyaW5nLnN0cmluZ2lmeSA9IGZ1bmN0aW9uIChvYmopIHtcblx0XHRyZXR1cm4gb2JqID8gT2JqZWN0LmtleXMob2JqKS5tYXAoZnVuY3Rpb24gKGtleSkge1xuXHRcdFx0dmFyIHZhbCA9IG9ialtrZXldO1xuXG5cdFx0XHRpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG5cdFx0XHRcdHJldHVybiB2YWwubWFwKGZ1bmN0aW9uICh2YWwyKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHZhbDIpO1xuXHRcdFx0XHR9KS5qb2luKCcmJyk7XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBlbmNvZGVVUklDb21wb25lbnQoa2V5KSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWwpO1xuXHRcdH0pLmpvaW4oJyYnKSA6ICcnO1xuXHR9O1xuXG5cdGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcblx0XHRkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBxdWVyeVN0cmluZzsgfSk7XG5cdH0gZWxzZSBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcblx0XHRtb2R1bGUuZXhwb3J0cyA9IHF1ZXJ5U3RyaW5nO1xuXHR9IGVsc2Uge1xuXHRcdHNlbGYucXVlcnlTdHJpbmcgPSBxdWVyeVN0cmluZztcblx0fVxufSkoKTtcbiIsIi8vQ29weXJpZ2h0IChDKSAyMDEyIEtvcnkgTnVublxyXG5cclxuLy9QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxyXG5cclxuLy9UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cclxuXHJcbi8vVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXHJcblxyXG4vKlxyXG5cclxuICAgIFRoaXMgY29kZSBpcyBub3QgZm9ybWF0dGVkIGZvciByZWFkYWJpbGl0eSwgYnV0IHJhdGhlciBydW4tc3BlZWQgYW5kIHRvIGFzc2lzdCBjb21waWxlcnMuXHJcblxyXG4gICAgSG93ZXZlciwgdGhlIGNvZGUncyBpbnRlbnRpb24gc2hvdWxkIGJlIHRyYW5zcGFyZW50LlxyXG5cclxuICAgICoqKiBJRSBTVVBQT1JUICoqKlxyXG5cclxuICAgIElmIHlvdSByZXF1aXJlIHRoaXMgbGlicmFyeSB0byB3b3JrIGluIElFNywgYWRkIHRoZSBmb2xsb3dpbmcgYWZ0ZXIgZGVjbGFyaW5nIGNyZWwuXHJcblxyXG4gICAgdmFyIHRlc3REaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSxcclxuICAgICAgICB0ZXN0TGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsYWJlbCcpO1xyXG5cclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCdjbGFzcycsICdhJyk7XHJcbiAgICB0ZXN0RGl2WydjbGFzc05hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydjbGFzcyddID0gJ2NsYXNzTmFtZSc6dW5kZWZpbmVkO1xyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ25hbWUnLCdhJyk7XHJcbiAgICB0ZXN0RGl2WyduYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnbmFtZSddID0gZnVuY3Rpb24oZWxlbWVudCwgdmFsdWUpe1xyXG4gICAgICAgIGVsZW1lbnQuaWQgPSB2YWx1ZTtcclxuICAgIH06dW5kZWZpbmVkO1xyXG5cclxuXHJcbiAgICB0ZXN0TGFiZWwuc2V0QXR0cmlidXRlKCdmb3InLCAnYScpO1xyXG4gICAgdGVzdExhYmVsWydodG1sRm9yJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnZm9yJ10gPSAnaHRtbEZvcic6dW5kZWZpbmVkO1xyXG5cclxuXHJcblxyXG4qL1xyXG5cclxuKGZ1bmN0aW9uIChyb290LCBmYWN0b3J5KSB7XHJcbiAgICBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgbW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5KCk7XHJcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xyXG4gICAgICAgIGRlZmluZShmYWN0b3J5KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcm9vdC5jcmVsID0gZmFjdG9yeSgpO1xyXG4gICAgfVxyXG59KHRoaXMsIGZ1bmN0aW9uICgpIHtcclxuICAgIHZhciBmbiA9ICdmdW5jdGlvbicsXHJcbiAgICAgICAgb2JqID0gJ29iamVjdCcsXHJcbiAgICAgICAgbm9kZVR5cGUgPSAnbm9kZVR5cGUnLFxyXG4gICAgICAgIHRleHRDb250ZW50ID0gJ3RleHRDb250ZW50JyxcclxuICAgICAgICBzZXRBdHRyaWJ1dGUgPSAnc2V0QXR0cmlidXRlJyxcclxuICAgICAgICBhdHRyTWFwU3RyaW5nID0gJ2F0dHJNYXAnLFxyXG4gICAgICAgIGlzTm9kZVN0cmluZyA9ICdpc05vZGUnLFxyXG4gICAgICAgIGlzRWxlbWVudFN0cmluZyA9ICdpc0VsZW1lbnQnLFxyXG4gICAgICAgIGQgPSB0eXBlb2YgZG9jdW1lbnQgPT09IG9iaiA/IGRvY3VtZW50IDoge30sXHJcbiAgICAgICAgaXNUeXBlID0gZnVuY3Rpb24oYSwgdHlwZSl7XHJcbiAgICAgICAgICAgIHJldHVybiB0eXBlb2YgYSA9PT0gdHlwZTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzTm9kZSA9IHR5cGVvZiBOb2RlID09PSBmbiA/IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIE5vZGU7XHJcbiAgICAgICAgfSA6XHJcbiAgICAgICAgLy8gaW4gSUUgPD0gOCBOb2RlIGlzIGFuIG9iamVjdCwgb2J2aW91c2x5Li5cclxuICAgICAgICBmdW5jdGlvbihvYmplY3Qpe1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0ICYmXHJcbiAgICAgICAgICAgICAgICBpc1R5cGUob2JqZWN0LCBvYmopICYmXHJcbiAgICAgICAgICAgICAgICAobm9kZVR5cGUgaW4gb2JqZWN0KSAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdC5vd25lckRvY3VtZW50LG9iaik7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0VsZW1lbnQgPSBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBjcmVsW2lzTm9kZVN0cmluZ10ob2JqZWN0KSAmJiBvYmplY3Rbbm9kZVR5cGVdID09PSAxO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNBcnJheSA9IGZ1bmN0aW9uKGEpe1xyXG4gICAgICAgICAgICByZXR1cm4gYSBpbnN0YW5jZW9mIEFycmF5O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYXBwZW5kQ2hpbGQgPSBmdW5jdGlvbihlbGVtZW50LCBjaGlsZCkge1xyXG4gICAgICAgICAgaWYoIWNyZWxbaXNOb2RlU3RyaW5nXShjaGlsZCkpe1xyXG4gICAgICAgICAgICAgIGNoaWxkID0gZC5jcmVhdGVUZXh0Tm9kZShjaGlsZCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBlbGVtZW50LmFwcGVuZENoaWxkKGNoaWxkKTtcclxuICAgICAgICB9O1xyXG5cclxuXHJcbiAgICBmdW5jdGlvbiBjcmVsKCl7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHMsIC8vTm90ZTogYXNzaWduZWQgdG8gYSB2YXJpYWJsZSB0byBhc3Npc3QgY29tcGlsZXJzLiBTYXZlcyBhYm91dCA0MCBieXRlcyBpbiBjbG9zdXJlIGNvbXBpbGVyLiBIYXMgbmVnbGlnYWJsZSBlZmZlY3Qgb24gcGVyZm9ybWFuY2UuXHJcbiAgICAgICAgICAgIGVsZW1lbnQgPSBhcmdzWzBdLFxyXG4gICAgICAgICAgICBjaGlsZCxcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBhcmdzWzFdLFxyXG4gICAgICAgICAgICBjaGlsZEluZGV4ID0gMixcclxuICAgICAgICAgICAgYXJndW1lbnRzTGVuZ3RoID0gYXJncy5sZW5ndGgsXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZU1hcCA9IGNyZWxbYXR0ck1hcFN0cmluZ107XHJcblxyXG4gICAgICAgIGVsZW1lbnQgPSBjcmVsW2lzRWxlbWVudFN0cmluZ10oZWxlbWVudCkgPyBlbGVtZW50IDogZC5jcmVhdGVFbGVtZW50KGVsZW1lbnQpO1xyXG4gICAgICAgIC8vIHNob3J0Y3V0XHJcbiAgICAgICAgaWYoYXJndW1lbnRzTGVuZ3RoID09PSAxKXtcclxuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZighaXNUeXBlKHNldHRpbmdzLG9iaikgfHwgY3JlbFtpc05vZGVTdHJpbmddKHNldHRpbmdzKSB8fCBpc0FycmF5KHNldHRpbmdzKSkge1xyXG4gICAgICAgICAgICAtLWNoaWxkSW5kZXg7XHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHNob3J0Y3V0IGlmIHRoZXJlIGlzIG9ubHkgb25lIGNoaWxkIHRoYXQgaXMgYSBzdHJpbmdcclxuICAgICAgICBpZigoYXJndW1lbnRzTGVuZ3RoIC0gY2hpbGRJbmRleCkgPT09IDEgJiYgaXNUeXBlKGFyZ3NbY2hpbGRJbmRleF0sICdzdHJpbmcnKSAmJiBlbGVtZW50W3RleHRDb250ZW50XSAhPT0gdW5kZWZpbmVkKXtcclxuICAgICAgICAgICAgZWxlbWVudFt0ZXh0Q29udGVudF0gPSBhcmdzW2NoaWxkSW5kZXhdO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICBmb3IoOyBjaGlsZEluZGV4IDwgYXJndW1lbnRzTGVuZ3RoOyArK2NoaWxkSW5kZXgpe1xyXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBhcmdzW2NoaWxkSW5kZXhdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmKGNoaWxkID09IG51bGwpe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0FycmF5KGNoaWxkKSkge1xyXG4gICAgICAgICAgICAgICAgICBmb3IgKHZhciBpPTA7IGkgPCBjaGlsZC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkW2ldKTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XHJcbiAgICAgICAgICAgIGlmKCFhdHRyaWJ1dGVNYXBba2V5XSl7XHJcbiAgICAgICAgICAgICAgICBlbGVtZW50W3NldEF0dHJpYnV0ZV0oa2V5LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICB2YXIgYXR0ciA9IGF0dHJpYnV0ZU1hcFtrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYodHlwZW9mIGF0dHIgPT09IGZuKXtcclxuICAgICAgICAgICAgICAgICAgICBhdHRyKGVsZW1lbnQsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGF0dHIsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVc2VkIGZvciBtYXBwaW5nIG9uZSBraW5kIG9mIGF0dHJpYnV0ZSB0byB0aGUgc3VwcG9ydGVkIHZlcnNpb24gb2YgdGhhdCBpbiBiYWQgYnJvd3NlcnMuXHJcbiAgICBjcmVsW2F0dHJNYXBTdHJpbmddID0ge307XHJcblxyXG4gICAgY3JlbFtpc0VsZW1lbnRTdHJpbmddID0gaXNFbGVtZW50O1xyXG5cclxuICAgIGNyZWxbaXNOb2RlU3RyaW5nXSA9IGlzTm9kZTtcclxuXHJcbiAgICByZXR1cm4gY3JlbDtcclxufSkpO1xyXG4iLCJ2YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxuICAgIFNldCA9IHJlcXVpcmUoJ2VzNi1zZXQnKSxcbiAgICBXZWFrTWFwID0gcmVxdWlyZSgnZXM2LXdlYWstbWFwJyk7XG5cbmZ1bmN0aW9uIHRvQXJyYXkoaXRlbXMpe1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChpdGVtcyk7XG59XG5cbnZhciBkZWVwUmVnZXggPSAvW3wuXS9pO1xuXG5mdW5jdGlvbiBtYXRjaERlZXAocGF0aCl7XG4gICAgcmV0dXJuIChwYXRoICsgJycpLm1hdGNoKGRlZXBSZWdleCk7XG59XG5cbmZ1bmN0aW9uIGlzRGVlcChwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuICAgIHJldHVybiB+c3RyaW5nUGF0aC5pbmRleE9mKCcuJykgfHwgfnN0cmluZ1BhdGguaW5kZXhPZignKionKSB8fCB+c3RyaW5nUGF0aC5pbmRleE9mKCd8Jyk7XG59XG5cbmZ1bmN0aW9uIGlzV2lsZGNhcmRQYXRoKHBhdGgpe1xuICAgIHZhciBzdHJpbmdQYXRoID0gKHBhdGggKyAnJyk7XG4gICAgcmV0dXJuIH5zdHJpbmdQYXRoLmluZGV4T2YoJyonKTtcbn1cblxuZnVuY3Rpb24gaXNGaWx0ZXJQYXRoKHBhdGgpe1xuICAgIHZhciBzdHJpbmdQYXRoID0gKHBhdGggKyAnJyk7XG4gICAgcmV0dXJuIH5zdHJpbmdQYXRoLmluZGV4T2YoJ3wnKTtcbn1cblxuZnVuY3Rpb24gZ2V0VGFyZ2V0S2V5KHBhdGgpe1xuICAgIHZhciBzdHJpbmdQYXRoID0gKHBhdGggKyAnJyk7XG4gICAgcmV0dXJuIHN0cmluZ1BhdGguc3BsaXQoJ3wnKS5zaGlmdCgpO1xufVxuXG52YXIgYXR0YWNoZWRFbnRpZXMgPSBuZXcgU2V0KCksXG4gICAgdHJhY2tlZE9iamVjdHMgPSBuZXcgV2Vha01hcCgpO1xuXG5mdW5jdGlvbiBsZWZ0QW5kUmVzdChwYXRoKXtcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlIHdoZW4geW91IHdhbnQgdG8gZmlsdGVyIG9uIHNlbGYgKC4pXG4gICAgaWYoc3RyaW5nUGF0aC5zbGljZSgwLDIpID09PSAnLnwnKXtcbiAgICAgICAgcmV0dXJuIFsnLicsIHN0cmluZ1BhdGguc2xpY2UoMildO1xuICAgIH1cblxuICAgIHZhciBtYXRjaCA9IG1hdGNoRGVlcChzdHJpbmdQYXRoKTtcbiAgICBpZihtYXRjaCl7XG4gICAgICAgIHJldHVybiBbc3RyaW5nUGF0aC5zbGljZSgwLCBtYXRjaC5pbmRleCksIHN0cmluZ1BhdGguc2xpY2UobWF0Y2guaW5kZXgrMSldO1xuICAgIH1cbiAgICByZXR1cm4gc3RyaW5nUGF0aDtcbn1cblxuZnVuY3Rpb24gaXNXaWxkY2FyZEtleShrZXkpe1xuICAgIHJldHVybiBrZXkuY2hhckF0KDApID09PSAnKic7XG59XG5cbmZ1bmN0aW9uIGlzRmVyYWxjYXJkS2V5KGtleSl7XG4gICAgcmV0dXJuIGtleSA9PT0gJyoqJztcbn1cblxuZnVuY3Rpb24gYWRkSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgdHJhY2tlZEtleXMgPSB7fTtcbiAgICAgICAgdHJhY2tlZE9iamVjdHMuc2V0KG9iamVjdCwgdHJhY2tlZEtleXMpO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICBoYW5kbGVycyA9IG5ldyBTZXQoKTtcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XSA9IGhhbmRsZXJzO1xuICAgIH1cblxuICAgIGhhbmRsZXJzLmFkZChoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaGFuZGxlcnMuZGVsZXRlKGhhbmRsZXIpO1xufVxuXG5mdW5jdGlvbiB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCl7XG4gICAgaWYoIW9iamVjdCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRLZXkgPSBrZXkgPT09ICcqKicgPyAnKicgOiBrZXksXG4gICAgICAgIHRhcmdldCA9IG9iamVjdFtrZXldLFxuICAgICAgICB0YXJnZXRJc09iamVjdCA9IHRhcmdldCAmJiB0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JztcblxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIHdlYWtNYXAuaGFzKHRhcmdldCkpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZSA9IGZ1bmN0aW9uKHZhbHVlLCBldmVudCwgZW1pdEtleSl7XG4gICAgICAgIGlmKGV2ZW50S2V5ICE9PSAnKicgJiYgdHlwZW9mIG9iamVjdFtldmVudEtleV0gPT09ICdvYmplY3QnICYmIG9iamVjdFtldmVudEtleV0gIT09IHRhcmdldCl7XG4gICAgICAgICAgICBpZih0YXJnZXRJc09iamVjdCl7XG4gICAgICAgICAgICAgICAgd2Vha01hcC5kZWxldGUodGFyZ2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbW92ZUhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcbiAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2ZW50S2V5ID09PSAnKicpe1xuICAgICAgICAgICAgdHJhY2tLZXlzKG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCF3ZWFrTWFwLmhhcyhvYmplY3QpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGtleSAhPT0gJyoqJyB8fCAhcGF0aCl7XG4gICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0cmFja0tleXModGFyZ2V0LCByb290LCByZXN0KXtcbiAgICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXQpO1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihpc0ZlcmFsY2FyZEtleShyb290KSl7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCAnKionICsgKHJlc3QgPyAnLicgOiAnJykgKyAocmVzdCB8fCAnJykpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCByZXN0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcblxuICAgIGlmKCF0YXJnZXRJc09iamVjdCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHdvdWxkIG9idmlvdXNseSBiZSBiZXR0ZXIgaW1wbGVtZW50ZWQgd2l0aCBhIFdlYWtTZXQsXG4gICAgLy8gQnV0IEknbSB0cnlpbmcgdG8ga2VlcCBmaWxlc2l6ZSBkb3duLCBhbmQgSSBkb24ndCByZWFsbHkgd2FudCBhbm90aGVyXG4gICAgLy8gcG9seWZpbGwgd2hlbiBXZWFrTWFwIHdvcmtzIHdlbGwgZW5vdWdoIGZvciB0aGUgdGFzay5cbiAgICB3ZWFrTWFwLnNldCh0YXJnZXQsIG51bGwpO1xuXG4gICAgaWYoIXBhdGgpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHJvb3RBbmRSZXN0ID0gbGVmdEFuZFJlc3QocGF0aCksXG4gICAgICAgIHJvb3QsXG4gICAgICAgIHJlc3Q7XG5cbiAgICBpZighQXJyYXkuaXNBcnJheShyb290QW5kUmVzdCkpe1xuICAgICAgICByb290ID0gcm9vdEFuZFJlc3Q7XG4gICAgfWVsc2V7XG4gICAgICAgIHJvb3QgPSByb290QW5kUmVzdFswXTtcbiAgICAgICAgcmVzdCA9IHJvb3RBbmRSZXN0WzFdO1xuXG4gICAgICAgIC8vIElmIHRoZSByb290IGlzICcuJywgd2F0Y2ggZm9yIGV2ZW50cyBvbiAqXG4gICAgICAgIGlmKHJvb3QgPT09ICcuJyl7XG4gICAgICAgICAgICByb290ID0gJyonO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYodGFyZ2V0SXNPYmplY3QgJiYgaXNXaWxkY2FyZEtleShyb290KSl7XG4gICAgICAgIHRyYWNrS2V5cyh0YXJnZXQsIHJvb3QsIHJlc3QpO1xuICAgIH1cblxuICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIHRhcmdldCwgcm9vdCwgcmVzdCk7XG59XG5cbnZhciB0cmFja2VkRXZlbnRzID0gbmV3IFdlYWtNYXAoKTtcblxuZnVuY3Rpb24gdHJhY2tQYXRoKGVudGksIGV2ZW50TmFtZSl7XG4gICAgdmFyIG9iamVjdCA9IGVudGkuX21vZGVsLFxuICAgICAgICB0cmFja2VkT2JqZWN0UGF0aHMgPSB0cmFja2VkRXZlbnRzLmdldChvYmplY3QpO1xuXG4gICAgaWYoIXRyYWNrZWRPYmplY3RQYXRocyl7XG4gICAgICAgIHRyYWNrZWRPYmplY3RQYXRocyA9IHt9O1xuICAgICAgICB0cmFja2VkRXZlbnRzLnNldChvYmplY3QsIHRyYWNrZWRPYmplY3RQYXRocyk7XG4gICAgfVxuXG4gICAgdmFyIHRyYWNrZWRQYXRocyA9IHRyYWNrZWRPYmplY3RQYXRoc1tldmVudE5hbWVdO1xuXG4gICAgaWYoIXRyYWNrZWRQYXRocyl7XG4gICAgICAgIHRyYWNrZWRQYXRocyA9IHtcbiAgICAgICAgICAgIGVudGlzOiBuZXcgU2V0KCksXG4gICAgICAgICAgICB0cmFja2VkT2JqZWN0czogbmV3IFdlYWtNYXAoKVxuICAgICAgICB9O1xuICAgICAgICB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXSA9IHRyYWNrZWRQYXRocztcbiAgICB9XG5cbiAgICBpZih0cmFja2VkUGF0aHMuZW50aXMuaGFzKGVudGkpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyYWNrZWRQYXRocy5lbnRpcy5hZGQoZW50aSk7XG5cbiAgICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50LCBlbWl0S2V5KXtcbiAgICAgICAgdHJhY2tlZFBhdGhzLmVudGlzLmZvckVhY2goZnVuY3Rpb24oZW50aSl7XG4gICAgICAgICAgICBpZihlbnRpLl9lbWl0dGVkRXZlbnRzW2V2ZW50TmFtZV0gPT09IGVtaXRLZXkpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoZW50aS5fbW9kZWwgIT09IG9iamVjdCl7XG4gICAgICAgICAgICAgICAgdHJhY2tlZFBhdGhzLmVudGlzLmRlbGV0ZShlbnRpKTtcbiAgICAgICAgICAgICAgICBpZih0cmFja2VkUGF0aHMuZW50aXMuc2l6ZSA9PT0gMCl7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXTtcbiAgICAgICAgICAgICAgICAgICAgaWYoIU9iamVjdC5rZXlzKHRyYWNrZWRPYmplY3RQYXRocykubGVuZ3RoKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYWNrZWRFdmVudHMuZGVsZXRlKG9iamVjdCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBlbnRpLl9lbWl0dGVkRXZlbnRzW2V2ZW50TmFtZV0gPSBlbWl0S2V5O1xuXG4gICAgICAgICAgICB2YXIgdGFyZ2V0S2V5ID0gZ2V0VGFyZ2V0S2V5KGV2ZW50TmFtZSksXG4gICAgICAgICAgICAgICAgdmFsdWUgPSBpc1dpbGRjYXJkUGF0aCh0YXJnZXRLZXkpID8gdW5kZWZpbmVkIDogZW50aS5nZXQodGFyZ2V0S2V5KTtcblxuICAgICAgICAgICAgZW50aS5lbWl0KGV2ZW50TmFtZSwgdmFsdWUsIGV2ZW50KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgdHJhY2tlZFBhdGhzLnRyYWNrZWRPYmplY3RzLCBoYW5kbGVyLCB7bW9kZWw6b2JqZWN0fSwgJ21vZGVsJywgZXZlbnROYW1lKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tQYXRocyhlbnRpLCB0YXJnZXQpe1xuICAgIGlmKCFlbnRpLl9ldmVudHMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhlbnRpLl9ldmVudHMpLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBrZXkgPSBrZXlzW2ldLCBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIC8vIEJhaWxvdXQgaWYgdGhlIGV2ZW50IGlzIGEgc2luZ2xlIGtleSxcbiAgICAgICAgLy8gYW5kIHRoZSB0YXJnZXQgaXNudCB0aGUgc2FtZSBhcyB0aGUgZW50aXMgX21vZGVsXG4gICAgICAgIGlmKGVudGkuX21vZGVsICE9PSB0YXJnZXQgJiYgIWlzRGVlcChrZXkpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJhY2tQYXRoKGVudGksIGtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbWl0RXZlbnQob2JqZWN0LCBrZXksIHZhbHVlLCBlbWl0S2V5KXtcblxuICAgIGF0dGFjaGVkRW50aWVzLmZvckVhY2goZnVuY3Rpb24oZW50aSl7XG4gICAgICAgIHRyYWNrUGF0aHMoZW50aSwgb2JqZWN0KTtcbiAgICB9KTtcblxuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYoIXRyYWNrZWRLZXlzKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBldmVudCA9IHtcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgb2JqZWN0OiBvYmplY3RcbiAgICB9O1xuXG4gICAgaWYodHJhY2tlZEtleXNba2V5XSl7XG4gICAgICAgIHRyYWNrZWRLZXlzW2tleV0uZm9yRWFjaChmdW5jdGlvbihoYW5kbGVyKXtcbiAgICAgICAgICAgIGlmKHRyYWNrZWRLZXlzW2tleV0uaGFzKGhhbmRsZXIpKXtcbiAgICAgICAgICAgICAgICBoYW5kbGVyKGV2ZW50LCBlbWl0S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZEtleXNbJyonXSl7XG4gICAgICAgIHRyYWNrZWRLZXlzWycqJ10uZm9yRWFjaChmdW5jdGlvbihoYW5kbGVyKXtcbiAgICAgICAgICAgIGlmKHRyYWNrZWRLZXlzWycqJ10uaGFzKGhhbmRsZXIpKXtcbiAgICAgICAgICAgICAgICBoYW5kbGVyKGV2ZW50LCBlbWl0S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbWl0KGV2ZW50cyl7XG4gICAgdmFyIGVtaXRLZXkgPSB7fTtcbiAgICBldmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGVtaXRFdmVudChldmVudFswXSwgZXZlbnRbMV0sIGV2ZW50WzJdLCBlbWl0S2V5KTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gRW50aShtb2RlbCl7XG4gICAgdmFyIGRldGFjaGVkID0gbW9kZWwgPT09IGZhbHNlO1xuXG4gICAgaWYoIW1vZGVsIHx8ICh0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2RlbCAhPT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBtb2RlbCA9IHt9O1xuICAgIH1cblxuICAgIHRoaXMuX2VtaXR0ZWRFdmVudHMgPSB7fTtcbiAgICBpZihkZXRhY2hlZCl7XG4gICAgICAgIHRoaXMuX21vZGVsID0ge307XG4gICAgfWVsc2V7XG4gICAgICAgIHRoaXMuYXR0YWNoKG1vZGVsKTtcbiAgICB9XG59XG5FbnRpLmdldCA9IGZ1bmN0aW9uKG1vZGVsLCBrZXkpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICByZXR1cm4gbW9kZWw7XG4gICAgfVxuXG5cbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgIHJldHVybiBFbnRpLmdldChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsW2tleV07XG59O1xuRW50aS5zZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5zZXQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ2luYWwgPSBtb2RlbFtrZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXNDaGFuZ2VkID0gIShrZXkgaW4gbW9kZWwpO1xuXG4gICAgbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgdmFyIGV2ZW50cyA9IFtbbW9kZWwsIGtleSwgdmFsdWVdXTtcblxuICAgIGlmKGtleXNDaGFuZ2VkKXtcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5wdXNoID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnB1c2gobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIHRhcmdldC5sZW5ndGgtMSwgdmFsdWVdLFxuICAgICAgICBbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF1cbiAgICBdO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkuaW5zZXJ0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUsIGluZGV4KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDQpe1xuICAgICAgICBpbmRleCA9IHZhbHVlO1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLmluc2VydChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5zcGxpY2UoaW5kZXgsIDAsIHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIGluZGV4LCB2YWx1ZV0sXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxuICAgIF07XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5yZW1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBzdWJLZXkpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkucmVtb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBzdWJLZXkpO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBhIGtleSBvZmYgb2YgYW4gb2JqZWN0IGF0ICdrZXknXG4gICAgaWYoc3ViS2V5ICE9IG51bGwpe1xuICAgICAgICBFbnRpLnJlbW92ZShtb2RlbFtrZXldLCBzdWJLZXkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICB0aHJvdyAnLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZSc7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICBtb2RlbC5zcGxpY2Uoa2V5LCAxKTtcbiAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgfWVsc2V7XG4gICAgICAgIGRlbGV0ZSBtb2RlbFtrZXldO1xuICAgICAgICBldmVudHMucHVzaChbbW9kZWwsIGtleV0pO1xuICAgIH1cblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLm1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBpbmRleCl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5tb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBpbmRleCk7XG4gICAgfVxuXG4gICAgdmFyIG1vZGVsID0gbW9kZWw7XG5cbiAgICBpZihrZXkgPT09IGluZGV4KXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKCFBcnJheS5pc0FycmF5KG1vZGVsKSl7XG4gICAgICAgIHRocm93ICdUaGUgbW9kZWwgaXMgbm90IGFuIGFycmF5Lic7XG4gICAgfVxuXG4gICAgdmFyIGl0ZW0gPSBtb2RlbFtrZXldO1xuXG4gICAgbW9kZWwuc3BsaWNlKGtleSwgMSk7XG5cbiAgICBtb2RlbC5zcGxpY2UoaW5kZXggLSAoaW5kZXggPiBrZXkgPyAwIDogMSksIDAsIGl0ZW0pO1xuXG4gICAgZW1pdChbW21vZGVsLCBpbmRleCwgaXRlbV1dKTtcbn07XG5FbnRpLnVwZGF0ZSA9IGZ1bmN0aW9uKG1vZGVsLCBrZXksIHZhbHVlKXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0LFxuICAgICAgICBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG5cbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgMyl7XG4gICAgICAgIHZhbHVlID0ga2V5O1xuICAgICAgICBrZXkgPSAnLic7XG4gICAgICAgIHRhcmdldCA9IG1vZGVsO1xuICAgIH1lbHNle1xuICAgICAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICAgICAgcmV0dXJuIEVudGkudXBkYXRlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCB2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0YXJnZXQgPSBtb2RlbFtrZXldO1xuXG4gICAgICAgIGlmKHRhcmdldCA9PSBudWxsKXtcbiAgICAgICAgICAgIG1vZGVsW2tleV0gPSBpc0FycmF5ID8gW10gOiB7fTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnVGhlIHZhbHVlIGlzIG5vdCBhbiBvYmplY3QuJztcbiAgICB9XG5cbiAgICBpZih0eXBlb2YgdGFyZ2V0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBvYmplY3QuJztcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRzID0gW107XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVUYXJnZXQodGFyZ2V0LCB2YWx1ZSl7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgICAgIGlmKHRhcmdldFtrZXldICYmIHR5cGVvZiB0YXJnZXRba2V5XSA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIHVwZGF0ZVRhcmdldCh0YXJnZXRba2V5XSwgdmFsdWVba2V5XSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0YXJnZXRba2V5XSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCBrZXksIHZhbHVlW2tleV1dKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlVGFyZ2V0KHRhcmdldCwgdmFsdWUpO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShFdmVudEVtaXR0ZXIucHJvdG90eXBlKTtcbkVudGkucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gRW50aTtcbkVudGkucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKG1vZGVsKXtcbiAgICBpZih0aGlzLl9tb2RlbCAhPT0gbW9kZWwpe1xuICAgICAgICB0aGlzLmRldGFjaCgpO1xuICAgIH1cblxuICAgIGlmKCFhdHRhY2hlZEVudGllcy5oYXModGhpcykpe1xuICAgICAgICBhdHRhY2hlZEVudGllcy5hZGQodGhpcyk7XG4gICAgfVxuICAgIHRoaXMuX2F0dGFjaGVkID0gdHJ1ZTtcbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsO1xufTtcbkVudGkucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCl7XG4gICAgaWYoYXR0YWNoZWRFbnRpZXMuaGFzKHRoaXMpKXtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuZGVsZXRlKHRoaXMpO1xuICAgIH1cblxuICAgIHRoaXMuX2VtaXR0ZWRFdmVudHMgPSB7fTtcbiAgICB0aGlzLl9tb2RlbCA9IHt9O1xuICAgIHRoaXMuX2F0dGFjaGVkID0gZmFsc2U7XG59O1xuRW50aS5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgdGhpcy5kZXRhY2goKTtcbiAgICB0aGlzLl9ldmVudHMgPSBudWxsO1xufVxuRW50aS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICByZXR1cm4gRW50aS5nZXQodGhpcy5fbW9kZWwsIGtleSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICByZXR1cm4gRW50aS5zZXQodGhpcy5fbW9kZWwsIGtleSwgdmFsdWUpO1xufTtcblxuRW50aS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHJldHVybiBFbnRpLnB1c2guYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihrZXksIHZhbHVlLCBpbmRleCl7XG4gICAgcmV0dXJuIEVudGkuaW5zZXJ0LmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oa2V5LCBzdWJLZXkpe1xuICAgIHJldHVybiBFbnRpLnJlbW92ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLm1vdmUgPSBmdW5jdGlvbihrZXksIGluZGV4KXtcbiAgICByZXR1cm4gRW50aS5tb3ZlLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgcmV0dXJuIEVudGkudXBkYXRlLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcbkVudGkucHJvdG90eXBlLmlzQXR0YWNoZWQgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiB0aGlzLl9hdHRhY2hlZDtcbn07XG5FbnRpLnByb3RvdHlwZS5hdHRhY2hlZENvdW50ID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gYXR0YWNoZWRFbnRpZXMuc2l6ZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRW50aTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IFNldCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzZXQsIGl0ZXJhdG9yLCByZXN1bHQ7XG5cdGlmICh0eXBlb2YgU2V0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHNldCA9IG5ldyBTZXQoWydyYXonLCAnZHdhJywgJ3RyenknXSk7XG5cdGlmIChzZXQuc2l6ZSAhPT0gMykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5hZGQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuY2xlYXIgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuZGVsZXRlICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmVudHJpZXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5oYXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQua2V5cyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC52YWx1ZXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblxuXHRpdGVyYXRvciA9IHNldC52YWx1ZXMoKTtcblx0cmVzdWx0ID0gaXRlcmF0b3IubmV4dCgpO1xuXHRpZiAocmVzdWx0LmRvbmUgIT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG5cdGlmIChyZXN1bHQudmFsdWUgIT09ICdyYXonKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiB0cnVlO1xufTtcbiIsIi8vIEV4cG9ydHMgdHJ1ZSBpZiBlbnZpcm9ubWVudCBwcm92aWRlcyBuYXRpdmUgYFNldGAgaW1wbGVtZW50YXRpb24sXG4vLyB3aGF0ZXZlciB0aGF0IGlzLlxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0aWYgKHR5cGVvZiBTZXQgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKFNldC5wcm90b3R5cGUpID09PSAnW29iamVjdCBTZXRdJyk7XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjb250YWlucyAgICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuICAsIGQgICAgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3InKVxuICAsIHRvU3RyaW5nVGFnU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLnRvU3RyaW5nVGFnXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFNldEl0ZXJhdG9yO1xuXG5TZXRJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHNldCwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgU2V0SXRlcmF0b3IpKSByZXR1cm4gbmV3IFNldEl0ZXJhdG9yKHNldCwga2luZCk7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgc2V0Ll9fc2V0RGF0YV9fLCBzZXQpO1xuXHRpZiAoIWtpbmQpIGtpbmQgPSAndmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXkrdmFsdWUnKSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRlbHNlIGtpbmQgPSAndmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19raW5kX18nLCBkKCcnLCBraW5kKSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTZXRJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5TZXRJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTZXRJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fbGlzdF9fW2ldO1xuXHRcdHJldHVybiBbdGhpcy5fX2xpc3RfX1tpXSwgdGhpcy5fX2xpc3RfX1tpXV07XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBTZXQgSXRlcmF0b3JdJzsgfSlcbn0pO1xuZGVmaW5lUHJvcGVydHkoU2V0SXRlcmF0b3IucHJvdG90eXBlLCB0b1N0cmluZ1RhZ1N5bWJvbCxcblx0ZCgnYycsICdTZXQgSXRlcmF0b3InKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjb3B5ICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvY29weScpXG4gICwgbWFwICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L21hcCcpXG4gICwgY2FsbGFibGUgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWxpZFZhbHVlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuXG4gICwgYmluZCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eVxuICAsIGRlZmluZTtcblxuZGVmaW5lID0gZnVuY3Rpb24gKG5hbWUsIGRlc2MsIGJpbmRUbykge1xuXHR2YXIgdmFsdWUgPSB2YWxpZFZhbHVlKGRlc2MpICYmIGNhbGxhYmxlKGRlc2MudmFsdWUpLCBkZ3M7XG5cdGRncyA9IGNvcHkoZGVzYyk7XG5cdGRlbGV0ZSBkZ3Mud3JpdGFibGU7XG5cdGRlbGV0ZSBkZ3MudmFsdWU7XG5cdGRncy5nZXQgPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwodGhpcywgbmFtZSkpIHJldHVybiB2YWx1ZTtcblx0XHRkZXNjLnZhbHVlID0gYmluZC5jYWxsKHZhbHVlLCAoYmluZFRvID09IG51bGwpID8gdGhpcyA6IHRoaXNbYmluZFRvXSk7XG5cdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgbmFtZSwgZGVzYyk7XG5cdFx0cmV0dXJuIHRoaXNbbmFtZV07XG5cdH07XG5cdHJldHVybiBkZ3M7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChwcm9wcy8qLCBiaW5kVG8qLykge1xuXHR2YXIgYmluZFRvID0gYXJndW1lbnRzWzFdO1xuXHRyZXR1cm4gbWFwKHByb3BzLCBmdW5jdGlvbiAoZGVzYywgbmFtZSkge1xuXHRcdHJldHVybiBkZWZpbmUobmFtZSwgZGVzYywgYmluZFRvKTtcblx0fSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXNzaWduICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2Fzc2lnbicpXG4gICwgbm9ybWFsaXplT3B0cyA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zJylcbiAgLCBpc0NhbGxhYmxlICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUnKVxuICAsIGNvbnRhaW5zICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcblxuICAsIGQ7XG5cbmQgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkc2NyLCB2YWx1ZS8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIHcsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICgoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHx8ICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpKSB7XG5cdFx0b3B0aW9ucyA9IHZhbHVlO1xuXHRcdHZhbHVlID0gZHNjcjtcblx0XHRkc2NyID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRvcHRpb25zID0gYXJndW1lbnRzWzJdO1xuXHR9XG5cdGlmIChkc2NyID09IG51bGwpIHtcblx0XHRjID0gdyA9IHRydWU7XG5cdFx0ZSA9IGZhbHNlO1xuXHR9IGVsc2Uge1xuXHRcdGMgPSBjb250YWlucy5jYWxsKGRzY3IsICdjJyk7XG5cdFx0ZSA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2UnKTtcblx0XHR3ID0gY29udGFpbnMuY2FsbChkc2NyLCAndycpO1xuXHR9XG5cblx0ZGVzYyA9IHsgdmFsdWU6IHZhbHVlLCBjb25maWd1cmFibGU6IGMsIGVudW1lcmFibGU6IGUsIHdyaXRhYmxlOiB3IH07XG5cdHJldHVybiAhb3B0aW9ucyA/IGRlc2MgOiBhc3NpZ24obm9ybWFsaXplT3B0cyhvcHRpb25zKSwgZGVzYyk7XG59O1xuXG5kLmdzID0gZnVuY3Rpb24gKGRzY3IsIGdldCwgc2V0LyosIG9wdGlvbnMqLykge1xuXHR2YXIgYywgZSwgb3B0aW9ucywgZGVzYztcblx0aWYgKHR5cGVvZiBkc2NyICE9PSAnc3RyaW5nJykge1xuXHRcdG9wdGlvbnMgPSBzZXQ7XG5cdFx0c2V0ID0gZ2V0O1xuXHRcdGdldCA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1szXTtcblx0fVxuXHRpZiAoZ2V0ID09IG51bGwpIHtcblx0XHRnZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoIWlzQ2FsbGFibGUoZ2V0KSkge1xuXHRcdG9wdGlvbnMgPSBnZXQ7XG5cdFx0Z2V0ID0gc2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKHNldCA9PSBudWxsKSB7XG5cdFx0c2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKHNldCkpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHRydWU7XG5cdFx0ZSA9IGZhbHNlO1xuXHR9IGVsc2Uge1xuXHRcdGMgPSBjb250YWlucy5jYWxsKGRzY3IsICdjJyk7XG5cdFx0ZSA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2UnKTtcblx0fVxuXG5cdGRlc2MgPSB7IGdldDogZ2V0LCBzZXQ6IHNldCwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlIH07XG5cdHJldHVybiAhb3B0aW9ucyA/IGRlc2MgOiBhc3NpZ24obm9ybWFsaXplT3B0cyhvcHRpb25zKSwgZGVzYyk7XG59O1xuIiwiLy8gSW5zcGlyZWQgYnkgR29vZ2xlIENsb3N1cmU6XG4vLyBodHRwOi8vY2xvc3VyZS1saWJyYXJ5Lmdvb2dsZWNvZGUuY29tL3N2bi9kb2NzL1xuLy8gY2xvc3VyZV9nb29nX2FycmF5X2FycmF5LmpzLmh0bWwjZ29vZy5hcnJheS5jbGVhclxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciB2YWx1ZSA9IHJlcXVpcmUoJy4uLy4uL29iamVjdC92YWxpZC12YWx1ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFsdWUodGhpcykubGVuZ3RoID0gMDtcblx0cmV0dXJuIHRoaXM7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9Qb3NJbnQgPSByZXF1aXJlKCcuLi8uLi9udW1iZXIvdG8tcG9zLWludGVnZXInKVxuICAsIHZhbHVlICAgID0gcmVxdWlyZSgnLi4vLi4vb2JqZWN0L3ZhbGlkLXZhbHVlJylcblxuICAsIGluZGV4T2YgPSBBcnJheS5wcm90b3R5cGUuaW5kZXhPZlxuICAsIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eVxuICAsIGFicyA9IE1hdGguYWJzLCBmbG9vciA9IE1hdGguZmxvb3I7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHNlYXJjaEVsZW1lbnQvKiwgZnJvbUluZGV4Ki8pIHtcblx0dmFyIGksIGwsIGZyb21JbmRleCwgdmFsO1xuXHRpZiAoc2VhcmNoRWxlbWVudCA9PT0gc2VhcmNoRWxlbWVudCkgeyAvL2pzbGludDogaWdub3JlXG5cdFx0cmV0dXJuIGluZGV4T2YuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcblx0fVxuXG5cdGwgPSB0b1Bvc0ludCh2YWx1ZSh0aGlzKS5sZW5ndGgpO1xuXHRmcm9tSW5kZXggPSBhcmd1bWVudHNbMV07XG5cdGlmIChpc05hTihmcm9tSW5kZXgpKSBmcm9tSW5kZXggPSAwO1xuXHRlbHNlIGlmIChmcm9tSW5kZXggPj0gMCkgZnJvbUluZGV4ID0gZmxvb3IoZnJvbUluZGV4KTtcblx0ZWxzZSBmcm9tSW5kZXggPSB0b1Bvc0ludCh0aGlzLmxlbmd0aCkgLSBmbG9vcihhYnMoZnJvbUluZGV4KSk7XG5cblx0Zm9yIChpID0gZnJvbUluZGV4OyBpIDwgbDsgKytpKSB7XG5cdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwodGhpcywgaSkpIHtcblx0XHRcdHZhbCA9IHRoaXNbaV07XG5cdFx0XHRpZiAodmFsICE9PSB2YWwpIHJldHVybiBpOyAvL2pzbGludDogaWdub3JlXG5cdFx0fVxuXHR9XG5cdHJldHVybiAtMTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBNYXRoLnNpZ25cblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzaWduID0gTWF0aC5zaWduO1xuXHRpZiAodHlwZW9mIHNpZ24gIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuICgoc2lnbigxMCkgPT09IDEpICYmIChzaWduKC0yMCkgPT09IC0xKSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHR2YWx1ZSA9IE51bWJlcih2YWx1ZSk7XG5cdGlmIChpc05hTih2YWx1ZSkgfHwgKHZhbHVlID09PSAwKSkgcmV0dXJuIHZhbHVlO1xuXHRyZXR1cm4gKHZhbHVlID4gMCkgPyAxIDogLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2lnbiA9IHJlcXVpcmUoJy4uL21hdGgvc2lnbicpXG5cbiAgLCBhYnMgPSBNYXRoLmFicywgZmxvb3IgPSBNYXRoLmZsb29yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoaXNOYU4odmFsdWUpKSByZXR1cm4gMDtcblx0dmFsdWUgPSBOdW1iZXIodmFsdWUpO1xuXHRpZiAoKHZhbHVlID09PSAwKSB8fCAhaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG5cdHJldHVybiBzaWduKHZhbHVlKSAqIGZsb29yKGFicyh2YWx1ZSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvSW50ZWdlciA9IHJlcXVpcmUoJy4vdG8taW50ZWdlcicpXG5cbiAgLCBtYXggPSBNYXRoLm1heDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHsgcmV0dXJuIG1heCgwLCB0b0ludGVnZXIodmFsdWUpKTsgfTtcbiIsIi8vIEludGVybmFsIG1ldGhvZCwgdXNlZCBieSBpdGVyYXRpb24gZnVuY3Rpb25zLlxuLy8gQ2FsbHMgYSBmdW5jdGlvbiBmb3IgZWFjaCBrZXktdmFsdWUgcGFpciBmb3VuZCBpbiBvYmplY3Rcbi8vIE9wdGlvbmFsbHkgdGFrZXMgY29tcGFyZUZuIHRvIGl0ZXJhdGUgb2JqZWN0IGluIHNwZWNpZmljIG9yZGVyXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGlzQ2FsbGFibGUgPSByZXF1aXJlKCcuL2lzLWNhbGxhYmxlJylcbiAgLCBjYWxsYWJsZSAgID0gcmVxdWlyZSgnLi92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsdWUgICAgICA9IHJlcXVpcmUoJy4vdmFsaWQtdmFsdWUnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLCBrZXlzID0gT2JqZWN0LmtleXNcbiAgLCBwcm9wZXJ0eUlzRW51bWVyYWJsZSA9IE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGU7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG1ldGhvZCwgZGVmVmFsKSB7XG5cdHJldHVybiBmdW5jdGlvbiAob2JqLCBjYi8qLCB0aGlzQXJnLCBjb21wYXJlRm4qLykge1xuXHRcdHZhciBsaXN0LCB0aGlzQXJnID0gYXJndW1lbnRzWzJdLCBjb21wYXJlRm4gPSBhcmd1bWVudHNbM107XG5cdFx0b2JqID0gT2JqZWN0KHZhbHVlKG9iaikpO1xuXHRcdGNhbGxhYmxlKGNiKTtcblxuXHRcdGxpc3QgPSBrZXlzKG9iaik7XG5cdFx0aWYgKGNvbXBhcmVGbikge1xuXHRcdFx0bGlzdC5zb3J0KGlzQ2FsbGFibGUoY29tcGFyZUZuKSA/IGNvbXBhcmVGbi5iaW5kKG9iaikgOiB1bmRlZmluZWQpO1xuXHRcdH1cblx0XHRyZXR1cm4gbGlzdFttZXRob2RdKGZ1bmN0aW9uIChrZXksIGluZGV4KSB7XG5cdFx0XHRpZiAoIXByb3BlcnR5SXNFbnVtZXJhYmxlLmNhbGwob2JqLCBrZXkpKSByZXR1cm4gZGVmVmFsO1xuXHRcdFx0cmV0dXJuIGNhbGwuY2FsbChjYiwgdGhpc0FyZywgb2JqW2tleV0sIGtleSwgb2JqLCBpbmRleCk7XG5cdFx0fSk7XG5cdH07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LmFzc2lnblxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIGFzc2lnbiA9IE9iamVjdC5hc3NpZ24sIG9iajtcblx0aWYgKHR5cGVvZiBhc3NpZ24gIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0b2JqID0geyBmb286ICdyYXonIH07XG5cdGFzc2lnbihvYmosIHsgYmFyOiAnZHdhJyB9LCB7IHRyenk6ICd0cnp5JyB9KTtcblx0cmV0dXJuIChvYmouZm9vICsgb2JqLmJhciArIG9iai50cnp5KSA9PT0gJ3JhemR3YXRyenknO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGtleXMgID0gcmVxdWlyZSgnLi4va2V5cycpXG4gICwgdmFsdWUgPSByZXF1aXJlKCcuLi92YWxpZC12YWx1ZScpXG5cbiAgLCBtYXggPSBNYXRoLm1heDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZGVzdCwgc3JjLyosIOKApnNyY24qLykge1xuXHR2YXIgZXJyb3IsIGksIGwgPSBtYXgoYXJndW1lbnRzLmxlbmd0aCwgMiksIGFzc2lnbjtcblx0ZGVzdCA9IE9iamVjdCh2YWx1ZShkZXN0KSk7XG5cdGFzc2lnbiA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHR0cnkgeyBkZXN0W2tleV0gPSBzcmNba2V5XTsgfSBjYXRjaCAoZSkge1xuXHRcdFx0aWYgKCFlcnJvcikgZXJyb3IgPSBlO1xuXHRcdH1cblx0fTtcblx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkge1xuXHRcdHNyYyA9IGFyZ3VtZW50c1tpXTtcblx0XHRrZXlzKHNyYykuZm9yRWFjaChhc3NpZ24pO1xuXHR9XG5cdGlmIChlcnJvciAhPT0gdW5kZWZpbmVkKSB0aHJvdyBlcnJvcjtcblx0cmV0dXJuIGRlc3Q7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXNzaWduID0gcmVxdWlyZSgnLi9hc3NpZ24nKVxuICAsIHZhbHVlICA9IHJlcXVpcmUoJy4vdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG5cdHZhciBjb3B5ID0gT2JqZWN0KHZhbHVlKG9iaikpO1xuXHRpZiAoY29weSAhPT0gb2JqKSByZXR1cm4gY29weTtcblx0cmV0dXJuIGFzc2lnbih7fSwgb2JqKTtcbn07XG4iLCIvLyBXb3JrYXJvdW5kIGZvciBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvdjgvaXNzdWVzL2RldGFpbD9pZD0yODA0XG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIHNoaW07XG5cbmlmICghcmVxdWlyZSgnLi9zZXQtcHJvdG90eXBlLW9mL2lzLWltcGxlbWVudGVkJykoKSkge1xuXHRzaGltID0gcmVxdWlyZSgnLi9zZXQtcHJvdG90eXBlLW9mL3NoaW0nKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgbnVsbE9iamVjdCwgcHJvcHMsIGRlc2M7XG5cdGlmICghc2hpbSkgcmV0dXJuIGNyZWF0ZTtcblx0aWYgKHNoaW0ubGV2ZWwgIT09IDEpIHJldHVybiBjcmVhdGU7XG5cblx0bnVsbE9iamVjdCA9IHt9O1xuXHRwcm9wcyA9IHt9O1xuXHRkZXNjID0geyBjb25maWd1cmFibGU6IGZhbHNlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0dmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhPYmplY3QucHJvdG90eXBlKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG5cdFx0aWYgKG5hbWUgPT09ICdfX3Byb3RvX18nKSB7XG5cdFx0XHRwcm9wc1tuYW1lXSA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0XHRcdHZhbHVlOiB1bmRlZmluZWQgfTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0cHJvcHNbbmFtZV0gPSBkZXNjO1xuXHR9KTtcblx0T2JqZWN0LmRlZmluZVByb3BlcnRpZXMobnVsbE9iamVjdCwgcHJvcHMpO1xuXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShzaGltLCAnbnVsbFBvbHlmaWxsJywgeyBjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogZmFsc2UsIHZhbHVlOiBudWxsT2JqZWN0IH0pO1xuXG5cdHJldHVybiBmdW5jdGlvbiAocHJvdG90eXBlLCBwcm9wcykge1xuXHRcdHJldHVybiBjcmVhdGUoKHByb3RvdHlwZSA9PT0gbnVsbCkgPyBudWxsT2JqZWN0IDogcHJvdG90eXBlLCBwcm9wcyk7XG5cdH07XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vX2l0ZXJhdGUnKSgnZm9yRWFjaCcpO1xuIiwiLy8gRGVwcmVjYXRlZFxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikgeyByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ2Z1bmN0aW9uJzsgfTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1hcCA9IHsgZnVuY3Rpb246IHRydWUsIG9iamVjdDogdHJ1ZSB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAoKHggIT0gbnVsbCkgJiYgbWFwW3R5cGVvZiB4XSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LmtleXNcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHRyeSB7XG5cdFx0T2JqZWN0LmtleXMoJ3ByaW1pdGl2ZScpO1xuXHRcdHJldHVybiB0cnVlO1xuXHR9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGtleXMgPSBPYmplY3Qua2V5cztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG5cdHJldHVybiBrZXlzKG9iamVjdCA9PSBudWxsID8gb2JqZWN0IDogT2JqZWN0KG9iamVjdCkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNhbGxhYmxlID0gcmVxdWlyZSgnLi92YWxpZC1jYWxsYWJsZScpXG4gICwgZm9yRWFjaCAgPSByZXF1aXJlKCcuL2Zvci1lYWNoJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqLCBjYi8qLCB0aGlzQXJnKi8pIHtcblx0dmFyIG8gPSB7fSwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXTtcblx0Y2FsbGFibGUoY2IpO1xuXHRmb3JFYWNoKG9iaiwgZnVuY3Rpb24gKHZhbHVlLCBrZXksIG9iaiwgaW5kZXgpIHtcblx0XHRvW2tleV0gPSBjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCBrZXksIG9iaiwgaW5kZXgpO1xuXHR9KTtcblx0cmV0dXJuIG87XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZm9yRWFjaCA9IEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlO1xuXG52YXIgcHJvY2VzcyA9IGZ1bmN0aW9uIChzcmMsIG9iaikge1xuXHR2YXIga2V5O1xuXHRmb3IgKGtleSBpbiBzcmMpIG9ialtrZXldID0gc3JjW2tleV07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvcHRpb25zLyosIOKApm9wdGlvbnMqLykge1xuXHR2YXIgcmVzdWx0ID0gY3JlYXRlKG51bGwpO1xuXHRmb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbiAob3B0aW9ucykge1xuXHRcdGlmIChvcHRpb25zID09IG51bGwpIHJldHVybjtcblx0XHRwcm9jZXNzKE9iamVjdChvcHRpb25zKSwgcmVzdWx0KTtcblx0fSk7XG5cdHJldHVybiByZXN1bHQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gT2JqZWN0LnNldFByb3RvdHlwZU9mXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBnZXRQcm90b3R5cGVPZiA9IE9iamVjdC5nZXRQcm90b3R5cGVPZlxuICAsIHggPSB7fTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoLypjdXN0b21DcmVhdGUqLykge1xuXHR2YXIgc2V0UHJvdG90eXBlT2YgPSBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0ICAsIGN1c3RvbUNyZWF0ZSA9IGFyZ3VtZW50c1swXSB8fCBjcmVhdGU7XG5cdGlmICh0eXBlb2Ygc2V0UHJvdG90eXBlT2YgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIGdldFByb3RvdHlwZU9mKHNldFByb3RvdHlwZU9mKGN1c3RvbUNyZWF0ZShudWxsKSwgeCkpID09PSB4O1xufTtcbiIsIi8vIEJpZyB0aGFua3MgdG8gQFdlYlJlZmxlY3Rpb24gZm9yIHNvcnRpbmcgdGhpcyBvdXRcbi8vIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL1dlYlJlZmxlY3Rpb24vNTU5MzU1NFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCAgICAgID0gcmVxdWlyZSgnLi4vaXMtb2JqZWN0JylcbiAgLCB2YWx1ZSAgICAgICAgID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgaXNQcm90b3R5cGVPZiA9IE9iamVjdC5wcm90b3R5cGUuaXNQcm90b3R5cGVPZlxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgbnVsbERlc2MgPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfVxuICAsIHZhbGlkYXRlO1xuXG52YWxpZGF0ZSA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHR2YWx1ZShvYmopO1xuXHRpZiAoKHByb3RvdHlwZSA9PT0gbnVsbCkgfHwgaXNPYmplY3QocHJvdG90eXBlKSkgcmV0dXJuIG9iajtcblx0dGhyb3cgbmV3IFR5cGVFcnJvcignUHJvdG90eXBlIG11c3QgYmUgbnVsbCBvciBhbiBvYmplY3QnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uIChzdGF0dXMpIHtcblx0dmFyIGZuLCBzZXQ7XG5cdGlmICghc3RhdHVzKSByZXR1cm4gbnVsbDtcblx0aWYgKHN0YXR1cy5sZXZlbCA9PT0gMikge1xuXHRcdGlmIChzdGF0dXMuc2V0KSB7XG5cdFx0XHRzZXQgPSBzdGF0dXMuc2V0O1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0c2V0LmNhbGwodmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLCBwcm90b3R5cGUpO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Zm4gPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdFx0dmFsaWRhdGUob2JqLCBwcm90b3R5cGUpLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH07XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGZuID0gZnVuY3Rpb24gc2VsZihvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0dmFyIGlzTnVsbEJhc2U7XG5cdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSk7XG5cdFx0XHRpc051bGxCYXNlID0gaXNQcm90b3R5cGVPZi5jYWxsKHNlbGYubnVsbFBvbHlmaWxsLCBvYmopO1xuXHRcdFx0aWYgKGlzTnVsbEJhc2UpIGRlbGV0ZSBzZWxmLm51bGxQb2x5ZmlsbC5fX3Byb3RvX187XG5cdFx0XHRpZiAocHJvdG90eXBlID09PSBudWxsKSBwcm90b3R5cGUgPSBzZWxmLm51bGxQb2x5ZmlsbDtcblx0XHRcdG9iai5fX3Byb3RvX18gPSBwcm90b3R5cGU7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVmaW5lUHJvcGVydHkoc2VsZi5udWxsUG9seWZpbGwsICdfX3Byb3RvX18nLCBudWxsRGVzYyk7XG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH07XG5cdH1cblx0cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShmbiwgJ2xldmVsJywgeyBjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogZmFsc2UsIHZhbHVlOiBzdGF0dXMubGV2ZWwgfSk7XG59KChmdW5jdGlvbiAoKSB7XG5cdHZhciB4ID0gT2JqZWN0LmNyZWF0ZShudWxsKSwgeSA9IHt9LCBzZXRcblx0ICAsIGRlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKE9iamVjdC5wcm90b3R5cGUsICdfX3Byb3RvX18nKTtcblxuXHRpZiAoZGVzYykge1xuXHRcdHRyeSB7XG5cdFx0XHRzZXQgPSBkZXNjLnNldDsgLy8gT3BlcmEgY3Jhc2hlcyBhdCB0aGlzIHBvaW50XG5cdFx0XHRzZXQuY2FsbCh4LCB5KTtcblx0XHR9IGNhdGNoIChpZ25vcmUpIHsgfVxuXHRcdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IHNldDogc2V0LCBsZXZlbDogMiB9O1xuXHR9XG5cblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMiB9O1xuXG5cdHggPSB7fTtcblx0eC5fX3Byb3RvX18gPSB5O1xuXHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBsZXZlbDogMSB9O1xuXG5cdHJldHVybiBmYWxzZTtcbn0oKSkpKTtcblxucmVxdWlyZSgnLi4vY3JlYXRlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZuKSB7XG5cdGlmICh0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpIHRocm93IG5ldyBUeXBlRXJyb3IoZm4gKyBcIiBpcyBub3QgYSBmdW5jdGlvblwiKTtcblx0cmV0dXJuIGZuO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgdXNlIG51bGwgb3IgdW5kZWZpbmVkXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gU3RyaW5nLnByb3RvdHlwZS5jb250YWluc1xuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc3RyID0gJ3JhemR3YXRyenknO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0aWYgKHR5cGVvZiBzdHIuY29udGFpbnMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuICgoc3RyLmNvbnRhaW5zKCdkd2EnKSA9PT0gdHJ1ZSkgJiYgKHN0ci5jb250YWlucygnZm9vJykgPT09IGZhbHNlKSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaW5kZXhPZiA9IFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc2VhcmNoU3RyaW5nLyosIHBvc2l0aW9uKi8pIHtcblx0cmV0dXJuIGluZGV4T2YuY2FsbCh0aGlzLCBzZWFyY2hTdHJpbmcsIGFyZ3VtZW50c1sxXSkgPiAtMTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmdcblxuICAsIGlkID0gdG9TdHJpbmcuY2FsbCgnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICh0eXBlb2YgeCA9PT0gJ3N0cmluZycpIHx8ICh4ICYmICh0eXBlb2YgeCA9PT0gJ29iamVjdCcpICYmXG5cdFx0KCh4IGluc3RhbmNlb2YgU3RyaW5nKSB8fCAodG9TdHJpbmcuY2FsbCh4KSA9PT0gaWQpKSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjb250YWlucyAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIEFycmF5SXRlcmF0b3I7XG5cbkFycmF5SXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhcnIsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEFycmF5SXRlcmF0b3IpKSByZXR1cm4gbmV3IEFycmF5SXRlcmF0b3IoYXJyLCBraW5kKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBhcnIpO1xuXHRpZiAoIWtpbmQpIGtpbmQgPSAndmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXkrdmFsdWUnKSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRlbHNlIGlmIChjb250YWlucy5jYWxsKGtpbmQsICdrZXknKSkga2luZCA9ICdrZXknO1xuXHRlbHNlIGtpbmQgPSAndmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19raW5kX18nLCBkKCcnLCBraW5kKSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihBcnJheUl0ZXJhdG9yLCBJdGVyYXRvcik7XG5cbkFycmF5SXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoQXJyYXlJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fbGlzdF9fW2ldO1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAna2V5K3ZhbHVlJykgcmV0dXJuIFtpLCB0aGlzLl9fbGlzdF9fW2ldXTtcblx0XHRyZXR1cm4gaTtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEFycmF5IEl0ZXJhdG9yXSc7IH0pXG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIGlzU3RyaW5nID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBnZXQgICAgICA9IHJlcXVpcmUoJy4vZ2V0JylcblxuICAsIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5LCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGl0ZXJhYmxlLCBjYi8qLCB0aGlzQXJnKi8pIHtcblx0dmFyIG1vZGUsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIHJlc3VsdCwgZG9CcmVhaywgYnJva2VuLCBpLCBsLCBjaGFyLCBjb2RlO1xuXHRpZiAoaXNBcnJheShpdGVyYWJsZSkpIG1vZGUgPSAnYXJyYXknO1xuXHRlbHNlIGlmIChpc1N0cmluZyhpdGVyYWJsZSkpIG1vZGUgPSAnc3RyaW5nJztcblx0ZWxzZSBpdGVyYWJsZSA9IGdldChpdGVyYWJsZSk7XG5cblx0Y2FsbGFibGUoY2IpO1xuXHRkb0JyZWFrID0gZnVuY3Rpb24gKCkgeyBicm9rZW4gPSB0cnVlOyB9O1xuXHRpZiAobW9kZSA9PT0gJ2FycmF5Jykge1xuXHRcdGl0ZXJhYmxlLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCBkb0JyZWFrKTtcblx0XHRcdGlmIChicm9rZW4pIHJldHVybiB0cnVlO1xuXHRcdH0pO1xuXHRcdHJldHVybjtcblx0fVxuXHRpZiAobW9kZSA9PT0gJ3N0cmluZycpIHtcblx0XHRsID0gaXRlcmFibGUubGVuZ3RoO1xuXHRcdGZvciAoaSA9IDA7IGkgPCBsOyArK2kpIHtcblx0XHRcdGNoYXIgPSBpdGVyYWJsZVtpXTtcblx0XHRcdGlmICgoaSArIDEpIDwgbCkge1xuXHRcdFx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdFx0XHRpZiAoKGNvZGUgPj0gMHhEODAwKSAmJiAoY29kZSA8PSAweERCRkYpKSBjaGFyICs9IGl0ZXJhYmxlWysraV07XG5cdFx0XHR9XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIGNoYXIsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgYnJlYWs7XG5cdFx0fVxuXHRcdHJldHVybjtcblx0fVxuXHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cblx0d2hpbGUgKCFyZXN1bHQuZG9uZSkge1xuXHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgcmVzdWx0LnZhbHVlLCBkb0JyZWFrKTtcblx0XHRpZiAoYnJva2VuKSByZXR1cm47XG5cdFx0cmVzdWx0ID0gaXRlcmFibGUubmV4dCgpO1xuXHR9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIEFycmF5SXRlcmF0b3IgID0gcmVxdWlyZSgnLi9hcnJheScpXG4gICwgU3RyaW5nSXRlcmF0b3IgPSByZXF1aXJlKCcuL3N0cmluZycpXG4gICwgaXRlcmFibGUgICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLWl0ZXJhYmxlJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG5cdGlmICh0eXBlb2YgaXRlcmFibGUob2JqKVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpIHJldHVybiBvYmpbaXRlcmF0b3JTeW1ib2xdKCk7XG5cdGlmIChpc1N0cmluZyhvYmopKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKG9iaik7XG5cdHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihvYmopO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsZWFyICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2NsZWFyJylcbiAgLCBhc3NpZ24gICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2Fzc2lnbicpXG4gICwgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsdWUgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC12YWx1ZScpXG4gICwgZCAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBhdXRvQmluZCA9IHJlcXVpcmUoJ2QvYXV0by1iaW5kJylcbiAgLCBTeW1ib2wgICA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBJdGVyYXRvcjtcblxubW9kdWxlLmV4cG9ydHMgPSBJdGVyYXRvciA9IGZ1bmN0aW9uIChsaXN0LCBjb250ZXh0KSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBJdGVyYXRvcikpIHJldHVybiBuZXcgSXRlcmF0b3IobGlzdCwgY29udGV4dCk7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fbGlzdF9fOiBkKCd3JywgdmFsdWUobGlzdCkpLFxuXHRcdF9fY29udGV4dF9fOiBkKCd3JywgY29udGV4dCksXG5cdFx0X19uZXh0SW5kZXhfXzogZCgndycsIDApXG5cdH0pO1xuXHRpZiAoIWNvbnRleHQpIHJldHVybjtcblx0Y2FsbGFibGUoY29udGV4dC5vbik7XG5cdGNvbnRleHQub24oJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdGNvbnRleHQub24oJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdGNvbnRleHQub24oJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xufTtcblxuZGVmaW5lUHJvcGVydGllcyhJdGVyYXRvci5wcm90b3R5cGUsIGFzc2lnbih7XG5cdGNvbnN0cnVjdG9yOiBkKEl0ZXJhdG9yKSxcblx0X25leHQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHZhciBpO1xuXHRcdGlmICghdGhpcy5fX2xpc3RfXykgcmV0dXJuO1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRpID0gdGhpcy5fX3JlZG9fXy5zaGlmdCgpO1xuXHRcdFx0aWYgKGkgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGk7XG5cdFx0fVxuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPCB0aGlzLl9fbGlzdF9fLmxlbmd0aCkgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0bmV4dDogZChmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9jcmVhdGVSZXN1bHQodGhpcy5fbmV4dCgpKTsgfSksXG5cdF9jcmVhdGVSZXN1bHQ6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAoaSA9PT0gdW5kZWZpbmVkKSByZXR1cm4geyBkb25lOiB0cnVlLCB2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0cmV0dXJuIHsgZG9uZTogZmFsc2UsIHZhbHVlOiB0aGlzLl9yZXNvbHZlKGkpIH07XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkgeyByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTsgfSksXG5cdF91bkJpbmQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHRoaXMuX19saXN0X18gPSBudWxsO1xuXHRcdGRlbGV0ZSB0aGlzLl9fcmVkb19fO1xuXHRcdGlmICghdGhpcy5fX2NvbnRleHRfXykgcmV0dXJuO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfYWRkJywgdGhpcy5fb25BZGQpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfZGVsZXRlJywgdGhpcy5fb25EZWxldGUpO1xuXHRcdHRoaXMuX19jb250ZXh0X18ub2ZmKCdfY2xlYXInLCB0aGlzLl9vbkNsZWFyKTtcblx0XHR0aGlzLl9fY29udGV4dF9fID0gbnVsbDtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IEl0ZXJhdG9yXSc7IH0pXG59LCBhdXRvQmluZCh7XG5cdF9vbkFkZDogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0Kyt0aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSB7XG5cdFx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19yZWRvX18nLCBkKCdjJywgW2luZGV4XSkpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID49IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gKytyZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHRcdHRoaXMuX19yZWRvX18ucHVzaChpbmRleCk7XG5cdH0pLFxuXHRfb25EZWxldGU6IGQoZnVuY3Rpb24gKGluZGV4KSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKGluZGV4ID49IHRoaXMuX19uZXh0SW5kZXhfXykgcmV0dXJuO1xuXHRcdC0tdGhpcy5fX25leHRJbmRleF9fO1xuXHRcdGlmICghdGhpcy5fX3JlZG9fXykgcmV0dXJuO1xuXHRcdGkgPSB0aGlzLl9fcmVkb19fLmluZGV4T2YoaW5kZXgpO1xuXHRcdGlmIChpICE9PSAtMSkgdGhpcy5fX3JlZG9fXy5zcGxpY2UoaSwgMSk7XG5cdFx0dGhpcy5fX3JlZG9fXy5mb3JFYWNoKGZ1bmN0aW9uIChyZWRvLCBpKSB7XG5cdFx0XHRpZiAocmVkbyA+IGluZGV4KSB0aGlzLl9fcmVkb19fW2ldID0gLS1yZWRvO1xuXHRcdH0sIHRoaXMpO1xuXHR9KSxcblx0X29uQ2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICh0aGlzLl9fcmVkb19fKSBjbGVhci5jYWxsKHRoaXMuX19yZWRvX18pO1xuXHRcdHRoaXMuX19uZXh0SW5kZXhfXyA9IDA7XG5cdH0pXG59KSkpO1xuXG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChmdW5jdGlvbiAoKSB7XG5cdHJldHVybiB0aGlzO1xufSkpO1xuZGVmaW5lUHJvcGVydHkoSXRlcmF0b3IucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJycsICdJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3RyaW5nICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBpdGVyYXRvclN5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS5pdGVyYXRvclxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG5cdGlmIChpc0FycmF5KHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdGlmIChpc1N0cmluZyh2YWx1ZSkpIHJldHVybiB0cnVlO1xuXHRyZXR1cm4gKHR5cGVvZiB2YWx1ZVtpdGVyYXRvclN5bWJvbF0gPT09ICdmdW5jdGlvbicpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IFN5bWJvbCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0eXBlb2YgU3ltYm9sICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHN5bWJvbCA9IFN5bWJvbCgndGVzdCBzeW1ib2wnKTtcblx0dHJ5IHsgU3RyaW5nKHN5bWJvbCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSAnc3ltYm9sJykgcmV0dXJuIHRydWU7XG5cblx0Ly8gUmV0dXJuICd0cnVlJyBmb3IgcG9seWZpbGxzXG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzQ29uY2F0U3ByZWFkYWJsZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvUHJpbWl0aXZlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1N0cmluZ1RhZyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudW5zY29wYWJsZXMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAoeCAmJiAoKHR5cGVvZiB4ID09PSAnc3ltYm9sJykgfHwgKHhbJ0BAdG9TdHJpbmdUYWcnXSA9PT0gJ1N5bWJvbCcpKSkgfHwgZmFsc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCB2YWxpZGF0ZVN5bWJvbCA9IHJlcXVpcmUoJy4vdmFsaWRhdGUtc3ltYm9sJylcblxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5LCBvYmpQcm90b3R5cGUgPSBPYmplY3QucHJvdG90eXBlXG4gICwgU3ltYm9sLCBIaWRkZW5TeW1ib2wsIGdsb2JhbFN5bWJvbHMgPSBjcmVhdGUobnVsbCk7XG5cbnZhciBnZW5lcmF0ZU5hbWUgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgY3JlYXRlZCA9IGNyZWF0ZShudWxsKTtcblx0cmV0dXJuIGZ1bmN0aW9uIChkZXNjKSB7XG5cdFx0dmFyIHBvc3RmaXggPSAwLCBuYW1lO1xuXHRcdHdoaWxlIChjcmVhdGVkW2Rlc2MgKyAocG9zdGZpeCB8fCAnJyldKSArK3Bvc3RmaXg7XG5cdFx0ZGVzYyArPSAocG9zdGZpeCB8fCAnJyk7XG5cdFx0Y3JlYXRlZFtkZXNjXSA9IHRydWU7XG5cdFx0bmFtZSA9ICdAQCcgKyBkZXNjO1xuXHRcdGRlZmluZVByb3BlcnR5KG9ialByb3RvdHlwZSwgbmFtZSwgZC5ncyhudWxsLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGQodmFsdWUpKTtcblx0XHR9KSk7XG5cdFx0cmV0dXJuIG5hbWU7XG5cdH07XG59KCkpO1xuXG5IaWRkZW5TeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBIaWRkZW5TeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHJldHVybiBTeW1ib2woZGVzY3JpcHRpb24pO1xufTtcbm1vZHVsZS5leHBvcnRzID0gU3ltYm9sID0gZnVuY3Rpb24gU3ltYm9sKGRlc2NyaXB0aW9uKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgU3ltYm9sKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHRzeW1ib2wgPSBjcmVhdGUoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSk7XG5cdGRlc2NyaXB0aW9uID0gKGRlc2NyaXB0aW9uID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyhkZXNjcmlwdGlvbikpO1xuXHRyZXR1cm4gZGVmaW5lUHJvcGVydGllcyhzeW1ib2wsIHtcblx0XHRfX2Rlc2NyaXB0aW9uX186IGQoJycsIGRlc2NyaXB0aW9uKSxcblx0XHRfX25hbWVfXzogZCgnJywgZ2VuZXJhdGVOYW1lKGRlc2NyaXB0aW9uKSlcblx0fSk7XG59O1xuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wsIHtcblx0Zm9yOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoZ2xvYmFsU3ltYm9sc1trZXldKSByZXR1cm4gZ2xvYmFsU3ltYm9sc1trZXldO1xuXHRcdHJldHVybiAoZ2xvYmFsU3ltYm9sc1trZXldID0gU3ltYm9sKFN0cmluZyhrZXkpKSk7XG5cdH0pLFxuXHRrZXlGb3I6IGQoZnVuY3Rpb24gKHMpIHtcblx0XHR2YXIga2V5O1xuXHRcdHZhbGlkYXRlU3ltYm9sKHMpO1xuXHRcdGZvciAoa2V5IGluIGdsb2JhbFN5bWJvbHMpIGlmIChnbG9iYWxTeW1ib2xzW2tleV0gPT09IHMpIHJldHVybiBrZXk7XG5cdH0pLFxuXHRoYXNJbnN0YW5jZTogZCgnJywgU3ltYm9sKCdoYXNJbnN0YW5jZScpKSxcblx0aXNDb25jYXRTcHJlYWRhYmxlOiBkKCcnLCBTeW1ib2woJ2lzQ29uY2F0U3ByZWFkYWJsZScpKSxcblx0aXRlcmF0b3I6IGQoJycsIFN5bWJvbCgnaXRlcmF0b3InKSksXG5cdG1hdGNoOiBkKCcnLCBTeW1ib2woJ21hdGNoJykpLFxuXHRyZXBsYWNlOiBkKCcnLCBTeW1ib2woJ3JlcGxhY2UnKSksXG5cdHNlYXJjaDogZCgnJywgU3ltYm9sKCdzZWFyY2gnKSksXG5cdHNwZWNpZXM6IGQoJycsIFN5bWJvbCgnc3BlY2llcycpKSxcblx0c3BsaXQ6IGQoJycsIFN5bWJvbCgnc3BsaXQnKSksXG5cdHRvUHJpbWl0aXZlOiBkKCcnLCBTeW1ib2woJ3RvUHJpbWl0aXZlJykpLFxuXHR0b1N0cmluZ1RhZzogZCgnJywgU3ltYm9sKCd0b1N0cmluZ1RhZycpKSxcblx0dW5zY29wYWJsZXM6IGQoJycsIFN5bWJvbCgndW5zY29wYWJsZXMnKSlcbn0pO1xuZGVmaW5lUHJvcGVydGllcyhIaWRkZW5TeW1ib2wucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFN5bWJvbCksXG5cdHRvU3RyaW5nOiBkKCcnLCBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbmFtZV9fOyB9KVxufSk7XG5cbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLnByb3RvdHlwZSwge1xuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnU3ltYm9sICgnICsgdmFsaWRhdGVTeW1ib2wodGhpcykuX19kZXNjcmlwdGlvbl9fICsgJyknOyB9KSxcblx0dmFsdWVPZjogZChmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSlcbn0pO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLCBkKCcnLFxuXHRmdW5jdGlvbiAoKSB7IHJldHVybiB2YWxpZGF0ZVN5bWJvbCh0aGlzKTsgfSkpO1xuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1N5bWJvbCcpKTtcblxuZGVmaW5lUHJvcGVydHkoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLFxuXHRkKCdjJywgU3ltYm9sLnByb3RvdHlwZVtTeW1ib2wudG9QcmltaXRpdmVdKSk7XG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1N0cmluZ1RhZ10pKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3ltYm9sID0gcmVxdWlyZSgnLi9pcy1zeW1ib2wnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc1N5bWJvbCh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgYSBzeW1ib2xcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIvLyBUaGFua3MgQG1hdGhpYXNieW5lbnNcbi8vIGh0dHA6Ly9tYXRoaWFzYnluZW5zLmJlL25vdGVzL2phdmFzY3JpcHQtdW5pY29kZSNpdGVyYXRpbmctb3Zlci1zeW1ib2xzXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgU3RyaW5nSXRlcmF0b3I7XG5cblN0cmluZ0l0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc3RyKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBTdHJpbmdJdGVyYXRvcikpIHJldHVybiBuZXcgU3RyaW5nSXRlcmF0b3Ioc3RyKTtcblx0c3RyID0gU3RyaW5nKHN0cik7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgc3RyKTtcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fbGVuZ3RoX18nLCBkKCcnLCBzdHIubGVuZ3RoKSk7XG5cbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFN0cmluZ0l0ZXJhdG9yLCBJdGVyYXRvcik7XG5cblN0cmluZ0l0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKFN0cmluZ0l0ZXJhdG9yKSxcblx0X25leHQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICghdGhpcy5fX2xpc3RfXykgcmV0dXJuO1xuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPCB0aGlzLl9fbGVuZ3RoX18pIHJldHVybiB0aGlzLl9fbmV4dEluZGV4X18rKztcblx0XHR0aGlzLl91bkJpbmQoKTtcblx0fSksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0dmFyIGNoYXIgPSB0aGlzLl9fbGlzdF9fW2ldLCBjb2RlO1xuXHRcdGlmICh0aGlzLl9fbmV4dEluZGV4X18gPT09IHRoaXMuX19sZW5ndGhfXykgcmV0dXJuIGNoYXI7XG5cdFx0Y29kZSA9IGNoYXIuY2hhckNvZGVBdCgwKTtcblx0XHRpZiAoKGNvZGUgPj0gMHhEODAwKSAmJiAoY29kZSA8PSAweERCRkYpKSByZXR1cm4gY2hhciArIHRoaXMuX19saXN0X19bdGhpcy5fX25leHRJbmRleF9fKytdO1xuXHRcdHJldHVybiBjaGFyO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgU3RyaW5nIEl0ZXJhdG9yXSc7IH0pXG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzSXRlcmFibGUgPSByZXF1aXJlKCcuL2lzLWl0ZXJhYmxlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNJdGVyYWJsZSh2YWx1ZSkpIHRocm93IG5ldyBUeXBlRXJyb3IodmFsdWUgKyBcIiBpcyBub3QgaXRlcmFibGVcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTeW1ib2wgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodHlwZW9mIFN5bWJvbCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzeW1ib2wgPSBTeW1ib2woJ3Rlc3Qgc3ltYm9sJyk7XG5cdHRyeSB7IFN0cmluZyhzeW1ib2wpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gJ3N5bWJvbCcpIHJldHVybiB0cnVlO1xuXG5cdC8vIFJldHVybiAndHJ1ZScgZm9yIHBvbHlmaWxsc1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc0NvbmNhdFNwcmVhZGFibGUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzUmVnRXhwICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9QcmltaXRpdmUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvU3RyaW5nVGFnICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC51bnNjb3BhYmxlcyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkID0gcmVxdWlyZSgnZCcpXG5cbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBnZW5lcmF0ZU5hbWUsIFN5bWJvbDtcblxuZ2VuZXJhdGVOYW1lID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIGNyZWF0ZWQgPSBjcmVhdGUobnVsbCk7XG5cdHJldHVybiBmdW5jdGlvbiAoZGVzYykge1xuXHRcdHZhciBwb3N0Zml4ID0gMDtcblx0XHR3aGlsZSAoY3JlYXRlZFtkZXNjICsgKHBvc3RmaXggfHwgJycpXSkgKytwb3N0Zml4O1xuXHRcdGRlc2MgKz0gKHBvc3RmaXggfHwgJycpO1xuXHRcdGNyZWF0ZWRbZGVzY10gPSB0cnVlO1xuXHRcdHJldHVybiAnQEAnICsgZGVzYztcblx0fTtcbn0oKSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU3ltYm9sID0gZnVuY3Rpb24gKGRlc2NyaXB0aW9uKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgU3ltYm9sKSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0fVxuXHRzeW1ib2wgPSBjcmVhdGUoU3ltYm9sLnByb3RvdHlwZSk7XG5cdGRlc2NyaXB0aW9uID0gKGRlc2NyaXB0aW9uID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyhkZXNjcmlwdGlvbikpO1xuXHRyZXR1cm4gZGVmaW5lUHJvcGVydGllcyhzeW1ib2wsIHtcblx0XHRfX2Rlc2NyaXB0aW9uX186IGQoJycsIGRlc2NyaXB0aW9uKSxcblx0XHRfX25hbWVfXzogZCgnJywgZ2VuZXJhdGVOYW1lKGRlc2NyaXB0aW9uKSlcblx0fSk7XG59O1xuXG5PYmplY3QuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wsIHtcblx0Y3JlYXRlOiBkKCcnLCBTeW1ib2woJ2NyZWF0ZScpKSxcblx0aGFzSW5zdGFuY2U6IGQoJycsIFN5bWJvbCgnaGFzSW5zdGFuY2UnKSksXG5cdGlzQ29uY2F0U3ByZWFkYWJsZTogZCgnJywgU3ltYm9sKCdpc0NvbmNhdFNwcmVhZGFibGUnKSksXG5cdGlzUmVnRXhwOiBkKCcnLCBTeW1ib2woJ2lzUmVnRXhwJykpLFxuXHRpdGVyYXRvcjogZCgnJywgU3ltYm9sKCdpdGVyYXRvcicpKSxcblx0dG9QcmltaXRpdmU6IGQoJycsIFN5bWJvbCgndG9QcmltaXRpdmUnKSksXG5cdHRvU3RyaW5nVGFnOiBkKCcnLCBTeW1ib2woJ3RvU3RyaW5nVGFnJykpLFxuXHR1bnNjb3BhYmxlczogZCgnJywgU3ltYm9sKCd1bnNjb3BhYmxlcycpKVxufSk7XG5cbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLnByb3RvdHlwZSwge1xuXHRwcm9wZXJUb1N0cmluZzogZChmdW5jdGlvbiAoKSB7XG5cdFx0cmV0dXJuICdTeW1ib2wgKCcgKyB0aGlzLl9fZGVzY3JpcHRpb25fXyArICcpJztcblx0fSksXG5cdHRvU3RyaW5nOiBkKCcnLCBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbmFtZV9fOyB9KVxufSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvUHJpbWl0aXZlLCBkKCcnLFxuXHRmdW5jdGlvbiAoaGludCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoXCJDb252ZXJzaW9uIG9mIHN5bWJvbCBvYmplY3RzIGlzIG5vdCBhbGxvd2VkXCIpO1xuXHR9KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ1N5bWJvbCcpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG5cbiAgLCBhcHBseSA9IEZ1bmN0aW9uLnByb3RvdHlwZS5hcHBseSwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZXNjcmlwdG9yID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSB9XG5cbiAgLCBvbiwgb25jZSwgb2ZmLCBlbWl0LCBtZXRob2RzLCBkZXNjcmlwdG9ycywgYmFzZTtcblxub24gPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIGRhdGE7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHtcblx0XHRkYXRhID0gZGVzY3JpcHRvci52YWx1ZSA9IGNyZWF0ZShudWxsKTtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19lZV9fJywgZGVzY3JpcHRvcik7XG5cdFx0ZGVzY3JpcHRvci52YWx1ZSA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0ZGF0YSA9IHRoaXMuX19lZV9fO1xuXHR9XG5cdGlmICghZGF0YVt0eXBlXSkgZGF0YVt0eXBlXSA9IGxpc3RlbmVyO1xuXHRlbHNlIGlmICh0eXBlb2YgZGF0YVt0eXBlXSA9PT0gJ29iamVjdCcpIGRhdGFbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG5cdGVsc2UgZGF0YVt0eXBlXSA9IFtkYXRhW3R5cGVdLCBsaXN0ZW5lcl07XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5vbmNlID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBvbmNlLCBzZWxmO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblx0c2VsZiA9IHRoaXM7XG5cdG9uLmNhbGwodGhpcywgdHlwZSwgb25jZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRvZmYuY2FsbChzZWxmLCB0eXBlLCBvbmNlKTtcblx0XHRhcHBseS5jYWxsKGxpc3RlbmVyLCB0aGlzLCBhcmd1bWVudHMpO1xuXHR9KTtcblxuXHRvbmNlLl9fZWVPbmNlTGlzdGVuZXJfXyA9IGxpc3RlbmVyO1xuXHRyZXR1cm4gdGhpcztcbn07XG5cbm9mZiA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgZGF0YSwgbGlzdGVuZXJzLCBjYW5kaWRhdGUsIGk7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHJldHVybiB0aGlzO1xuXHRkYXRhID0gdGhpcy5fX2VlX187XG5cdGlmICghZGF0YVt0eXBlXSkgcmV0dXJuIHRoaXM7XG5cdGxpc3RlbmVycyA9IGRhdGFbdHlwZV07XG5cblx0aWYgKHR5cGVvZiBsaXN0ZW5lcnMgPT09ICdvYmplY3QnKSB7XG5cdFx0Zm9yIChpID0gMDsgKGNhbmRpZGF0ZSA9IGxpc3RlbmVyc1tpXSk7ICsraSkge1xuXHRcdFx0aWYgKChjYW5kaWRhdGUgPT09IGxpc3RlbmVyKSB8fFxuXHRcdFx0XHRcdChjYW5kaWRhdGUuX19lZU9uY2VMaXN0ZW5lcl9fID09PSBsaXN0ZW5lcikpIHtcblx0XHRcdFx0aWYgKGxpc3RlbmVycy5sZW5ndGggPT09IDIpIGRhdGFbdHlwZV0gPSBsaXN0ZW5lcnNbaSA/IDAgOiAxXTtcblx0XHRcdFx0ZWxzZSBsaXN0ZW5lcnMuc3BsaWNlKGksIDEpO1xuXHRcdFx0fVxuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRpZiAoKGxpc3RlbmVycyA9PT0gbGlzdGVuZXIpIHx8XG5cdFx0XHRcdChsaXN0ZW5lcnMuX19lZU9uY2VMaXN0ZW5lcl9fID09PSBsaXN0ZW5lcikpIHtcblx0XHRcdGRlbGV0ZSBkYXRhW3R5cGVdO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB0aGlzO1xufTtcblxuZW1pdCA9IGZ1bmN0aW9uICh0eXBlKSB7XG5cdHZhciBpLCBsLCBsaXN0ZW5lciwgbGlzdGVuZXJzLCBhcmdzO1xuXG5cdGlmICghaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCAnX19lZV9fJykpIHJldHVybjtcblx0bGlzdGVuZXJzID0gdGhpcy5fX2VlX19bdHlwZV07XG5cdGlmICghbGlzdGVuZXJzKSByZXR1cm47XG5cblx0aWYgKHR5cGVvZiBsaXN0ZW5lcnMgPT09ICdvYmplY3QnKSB7XG5cdFx0bCA9IGFyZ3VtZW50cy5sZW5ndGg7XG5cdFx0YXJncyA9IG5ldyBBcnJheShsIC0gMSk7XG5cdFx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cblx0XHRsaXN0ZW5lcnMgPSBsaXN0ZW5lcnMuc2xpY2UoKTtcblx0XHRmb3IgKGkgPSAwOyAobGlzdGVuZXIgPSBsaXN0ZW5lcnNbaV0pOyArK2kpIHtcblx0XHRcdGFwcGx5LmNhbGwobGlzdGVuZXIsIHRoaXMsIGFyZ3MpO1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcblx0XHRjYXNlIDE6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzKTtcblx0XHRcdGJyZWFrO1xuXHRcdGNhc2UgMjpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3VtZW50c1sxXSk7XG5cdFx0XHRicmVhaztcblx0XHRjYXNlIDM6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG5cdFx0XHRicmVhaztcblx0XHRkZWZhdWx0OlxuXHRcdFx0bCA9IGFyZ3VtZW50cy5sZW5ndGg7XG5cdFx0XHRhcmdzID0gbmV3IEFycmF5KGwgLSAxKTtcblx0XHRcdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIHtcblx0XHRcdFx0YXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cdFx0XHR9XG5cdFx0XHRhcHBseS5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJncyk7XG5cdFx0fVxuXHR9XG59O1xuXG5tZXRob2RzID0ge1xuXHRvbjogb24sXG5cdG9uY2U6IG9uY2UsXG5cdG9mZjogb2ZmLFxuXHRlbWl0OiBlbWl0XG59O1xuXG5kZXNjcmlwdG9ycyA9IHtcblx0b246IGQob24pLFxuXHRvbmNlOiBkKG9uY2UpLFxuXHRvZmY6IGQob2ZmKSxcblx0ZW1pdDogZChlbWl0KVxufTtcblxuYmFzZSA9IGRlZmluZVByb3BlcnRpZXMoe30sIGRlc2NyaXB0b3JzKTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gZnVuY3Rpb24gKG8pIHtcblx0cmV0dXJuIChvID09IG51bGwpID8gY3JlYXRlKGJhc2UpIDogZGVmaW5lUHJvcGVydGllcyhPYmplY3QobyksIGRlc2NyaXB0b3JzKTtcbn07XG5leHBvcnRzLm1ldGhvZHMgPSBtZXRob2RzO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGVJbmRleE9mICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YnKVxuICAsIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY2FsbGFibGUgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBlZSAgICAgICAgICAgICA9IHJlcXVpcmUoJ2V2ZW50LWVtaXR0ZXInKVxuICAsIFN5bWJvbCAgICAgICAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG4gICwgaXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvdmFsaWQtaXRlcmFibGUnKVxuICAsIGZvck9mICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL2Zvci1vZicpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuL2xpYi9pdGVyYXRvcicpXG4gICwgaXNOYXRpdmUgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgU2V0UG9seSwgZ2V0VmFsdWVzO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNldFBvbHkgPSBmdW5jdGlvbiAoLyppdGVyYWJsZSovKSB7XG5cdHZhciBpdGVyYWJsZSA9IGFyZ3VtZW50c1swXTtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFNldFBvbHkpKSByZXR1cm4gbmV3IFNldFBvbHkoaXRlcmFibGUpO1xuXHRpZiAodGhpcy5fX3NldERhdGFfXyAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcih0aGlzICsgXCIgY2Fubm90IGJlIHJlaW5pdGlhbGl6ZWRcIik7XG5cdH1cblx0aWYgKGl0ZXJhYmxlICE9IG51bGwpIGl0ZXJhdG9yKGl0ZXJhYmxlKTtcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fc2V0RGF0YV9fJywgZCgnYycsIFtdKSk7XG5cdGlmICghaXRlcmFibGUpIHJldHVybjtcblx0Zm9yT2YoaXRlcmFibGUsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdGlmIChlSW5kZXhPZi5jYWxsKHRoaXMsIHZhbHVlKSAhPT0gLTEpIHJldHVybjtcblx0XHR0aGlzLnB1c2godmFsdWUpO1xuXHR9LCB0aGlzLl9fc2V0RGF0YV9fKTtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFNldFBvbHksIFNldCk7XG5cdFNldFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShTZXQucHJvdG90eXBlLCB7XG5cdFx0Y29uc3RydWN0b3I6IGQoU2V0UG9seSlcblx0fSk7XG59XG5cbmVlKE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKFNldFBvbHkucHJvdG90eXBlLCB7XG5cdGFkZDogZChmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRpZiAodGhpcy5oYXModmFsdWUpKSByZXR1cm4gdGhpcztcblx0XHR0aGlzLmVtaXQoJ19hZGQnLCB0aGlzLl9fc2V0RGF0YV9fLnB1c2godmFsdWUpIC0gMSwgdmFsdWUpO1xuXHRcdHJldHVybiB0aGlzO1xuXHR9KSxcblx0Y2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICghdGhpcy5fX3NldERhdGFfXy5sZW5ndGgpIHJldHVybjtcblx0XHRjbGVhci5jYWxsKHRoaXMuX19zZXREYXRhX18pO1xuXHRcdHRoaXMuZW1pdCgnX2NsZWFyJyk7XG5cdH0pLFxuXHRkZWxldGU6IGQoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0dmFyIGluZGV4ID0gZUluZGV4T2YuY2FsbCh0aGlzLl9fc2V0RGF0YV9fLCB2YWx1ZSk7XG5cdFx0aWYgKGluZGV4ID09PSAtMSkgcmV0dXJuIGZhbHNlO1xuXHRcdHRoaXMuX19zZXREYXRhX18uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR0aGlzLmVtaXQoJ19kZWxldGUnLCBpbmRleCwgdmFsdWUpO1xuXHRcdHJldHVybiB0cnVlO1xuXHR9KSxcblx0ZW50cmllczogZChmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgSXRlcmF0b3IodGhpcywgJ2tleSt2YWx1ZScpOyB9KSxcblx0Zm9yRWFjaDogZChmdW5jdGlvbiAoY2IvKiwgdGhpc0FyZyovKSB7XG5cdFx0dmFyIHRoaXNBcmcgPSBhcmd1bWVudHNbMV0sIGl0ZXJhdG9yLCByZXN1bHQsIHZhbHVlO1xuXHRcdGNhbGxhYmxlKGNiKTtcblx0XHRpdGVyYXRvciA9IHRoaXMudmFsdWVzKCk7XG5cdFx0cmVzdWx0ID0gaXRlcmF0b3IuX25leHQoKTtcblx0XHR3aGlsZSAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHZhbHVlID0gaXRlcmF0b3IuX3Jlc29sdmUocmVzdWx0KTtcblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIHZhbHVlLCB0aGlzKTtcblx0XHRcdHJlc3VsdCA9IGl0ZXJhdG9yLl9uZXh0KCk7XG5cdFx0fVxuXHR9KSxcblx0aGFzOiBkKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdHJldHVybiAoZUluZGV4T2YuY2FsbCh0aGlzLl9fc2V0RGF0YV9fLCB2YWx1ZSkgIT09IC0xKTtcblx0fSksXG5cdGtleXM6IGQoZ2V0VmFsdWVzID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy52YWx1ZXMoKTsgfSksXG5cdHNpemU6IGQuZ3MoZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX3NldERhdGFfXy5sZW5ndGg7IH0pLFxuXHR2YWx1ZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMpOyB9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgU2V0XSc7IH0pXG59KSk7XG5kZWZpbmVQcm9wZXJ0eShTZXRQb2x5LnByb3RvdHlwZSwgU3ltYm9sLml0ZXJhdG9yLCBkKGdldFZhbHVlcykpO1xuZGVmaW5lUHJvcGVydHkoU2V0UG9seS5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdTZXQnKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBXZWFrTWFwIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHdlYWtNYXAsIHg7XG5cdGlmICh0eXBlb2YgV2Vha01hcCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAoU3RyaW5nKFdlYWtNYXAucHJvdG90eXBlKSAhPT0gJ1tvYmplY3QgV2Vha01hcF0nKSByZXR1cm4gZmFsc2U7XG5cdHRyeSB7XG5cdFx0Ly8gV2ViS2l0IGRvZXNuJ3Qgc3VwcG9ydCBhcmd1bWVudHMgYW5kIGNyYXNoZXNcblx0XHR3ZWFrTWFwID0gbmV3IFdlYWtNYXAoW1t4ID0ge30sICdvbmUnXSwgW3t9LCAndHdvJ10sIFt7fSwgJ3RocmVlJ11dKTtcblx0fSBjYXRjaCAoZSkge1xuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXHRpZiAodHlwZW9mIHdlYWtNYXAuc2V0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh3ZWFrTWFwLnNldCh7fSwgMSkgIT09IHdlYWtNYXApIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiB3ZWFrTWFwLmRlbGV0ZSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHdlYWtNYXAuaGFzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh3ZWFrTWFwLmdldCh4KSAhPT0gJ29uZScpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIvLyBFeHBvcnRzIHRydWUgaWYgZW52aXJvbm1lbnQgcHJvdmlkZXMgbmF0aXZlIGBXZWFrTWFwYCBpbXBsZW1lbnRhdGlvbiwgd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgV2Vha01hcCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChuZXcgV2Vha01hcCgpKSA9PT0gJ1tvYmplY3QgV2Vha01hcF0nKTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjb3B5ICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvY29weScpXG4gICwgbWFwICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L21hcCcpXG4gICwgY2FsbGFibGUgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWxpZFZhbHVlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuXG4gICwgYmluZCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eVxuICAsIGRlZmluZTtcblxuZGVmaW5lID0gZnVuY3Rpb24gKG5hbWUsIGRlc2MsIGJpbmRUbykge1xuXHR2YXIgdmFsdWUgPSB2YWxpZFZhbHVlKGRlc2MpICYmIGNhbGxhYmxlKGRlc2MudmFsdWUpLCBkZ3M7XG5cdGRncyA9IGNvcHkoZGVzYyk7XG5cdGRlbGV0ZSBkZ3Mud3JpdGFibGU7XG5cdGRlbGV0ZSBkZ3MudmFsdWU7XG5cdGRncy5nZXQgPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwodGhpcywgbmFtZSkpIHJldHVybiB2YWx1ZTtcblx0XHRkZXNjLnZhbHVlID0gYmluZC5jYWxsKHZhbHVlLCAoYmluZFRvID09IG51bGwpID8gdGhpcyA6IHRoaXNbYmluZFRvXSk7XG5cdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgbmFtZSwgZGVzYyk7XG5cdFx0cmV0dXJuIHRoaXNbbmFtZV07XG5cdH07XG5cdHJldHVybiBkZ3M7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChwcm9wcy8qLCBiaW5kVG8qLykge1xuXHR2YXIgYmluZFRvID0gYXJndW1lbnRzWzFdO1xuXHRyZXR1cm4gbWFwKHByb3BzLCBmdW5jdGlvbiAoZGVzYywgbmFtZSkge1xuXHRcdHJldHVybiBkZWZpbmUobmFtZSwgZGVzYywgYmluZFRvKTtcblx0fSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXNzaWduICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2Fzc2lnbicpXG4gICwgbm9ybWFsaXplT3B0cyA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zJylcbiAgLCBpc0NhbGxhYmxlICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUnKVxuICAsIGNvbnRhaW5zICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcblxuICAsIGQ7XG5cbmQgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkc2NyLCB2YWx1ZS8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIHcsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICgoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHx8ICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpKSB7XG5cdFx0b3B0aW9ucyA9IHZhbHVlO1xuXHRcdHZhbHVlID0gZHNjcjtcblx0XHRkc2NyID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRvcHRpb25zID0gYXJndW1lbnRzWzJdO1xuXHR9XG5cdGlmIChkc2NyID09IG51bGwpIHtcblx0XHRjID0gdyA9IHRydWU7XG5cdFx0ZSA9IGZhbHNlO1xuXHR9IGVsc2Uge1xuXHRcdGMgPSBjb250YWlucy5jYWxsKGRzY3IsICdjJyk7XG5cdFx0ZSA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2UnKTtcblx0XHR3ID0gY29udGFpbnMuY2FsbChkc2NyLCAndycpO1xuXHR9XG5cblx0ZGVzYyA9IHsgdmFsdWU6IHZhbHVlLCBjb25maWd1cmFibGU6IGMsIGVudW1lcmFibGU6IGUsIHdyaXRhYmxlOiB3IH07XG5cdHJldHVybiAhb3B0aW9ucyA/IGRlc2MgOiBhc3NpZ24obm9ybWFsaXplT3B0cyhvcHRpb25zKSwgZGVzYyk7XG59O1xuXG5kLmdzID0gZnVuY3Rpb24gKGRzY3IsIGdldCwgc2V0LyosIG9wdGlvbnMqLykge1xuXHR2YXIgYywgZSwgb3B0aW9ucywgZGVzYztcblx0aWYgKHR5cGVvZiBkc2NyICE9PSAnc3RyaW5nJykge1xuXHRcdG9wdGlvbnMgPSBzZXQ7XG5cdFx0c2V0ID0gZ2V0O1xuXHRcdGdldCA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1szXTtcblx0fVxuXHRpZiAoZ2V0ID09IG51bGwpIHtcblx0XHRnZXQgPSB1bmRlZmluZWQ7XG5cdH0gZWxzZSBpZiAoIWlzQ2FsbGFibGUoZ2V0KSkge1xuXHRcdG9wdGlvbnMgPSBnZXQ7XG5cdFx0Z2V0ID0gc2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKHNldCA9PSBudWxsKSB7XG5cdFx0c2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKHNldCkpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHRydWU7XG5cdFx0ZSA9IGZhbHNlO1xuXHR9IGVsc2Uge1xuXHRcdGMgPSBjb250YWlucy5jYWxsKGRzY3IsICdjJyk7XG5cdFx0ZSA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ2UnKTtcblx0fVxuXG5cdGRlc2MgPSB7IGdldDogZ2V0LCBzZXQ6IHNldCwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlIH07XG5cdHJldHVybiAhb3B0aW9ucyA/IGRlc2MgOiBhc3NpZ24obm9ybWFsaXplT3B0cyhvcHRpb25zKSwgZGVzYyk7XG59O1xuIiwiLy8gSW5zcGlyZWQgYnkgR29vZ2xlIENsb3N1cmU6XG4vLyBodHRwOi8vY2xvc3VyZS1saWJyYXJ5Lmdvb2dsZWNvZGUuY29tL3N2bi9kb2NzL1xuLy8gY2xvc3VyZV9nb29nX2FycmF5X2FycmF5LmpzLmh0bWwjZ29vZy5hcnJheS5jbGVhclxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciB2YWx1ZSA9IHJlcXVpcmUoJy4uLy4uL29iamVjdC92YWxpZC12YWx1ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFsdWUodGhpcykubGVuZ3RoID0gMDtcblx0cmV0dXJuIHRoaXM7XG59O1xuIiwiLy8gSW50ZXJuYWwgbWV0aG9kLCB1c2VkIGJ5IGl0ZXJhdGlvbiBmdW5jdGlvbnMuXG4vLyBDYWxscyBhIGZ1bmN0aW9uIGZvciBlYWNoIGtleS12YWx1ZSBwYWlyIGZvdW5kIGluIG9iamVjdFxuLy8gT3B0aW9uYWxseSB0YWtlcyBjb21wYXJlRm4gdG8gaXRlcmF0ZSBvYmplY3QgaW4gc3BlY2lmaWMgb3JkZXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNDYWxsYWJsZSA9IHJlcXVpcmUoJy4vaXMtY2FsbGFibGUnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICAgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGwsIGtleXMgPSBPYmplY3Qua2V5c1xuICAsIHByb3BlcnR5SXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCBkZWZWYWwpIHtcblx0cmV0dXJuIGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcsIGNvbXBhcmVGbiovKSB7XG5cdFx0dmFyIGxpc3QsIHRoaXNBcmcgPSBhcmd1bWVudHNbMl0sIGNvbXBhcmVGbiA9IGFyZ3VtZW50c1szXTtcblx0XHRvYmogPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdFx0Y2FsbGFibGUoY2IpO1xuXG5cdFx0bGlzdCA9IGtleXMob2JqKTtcblx0XHRpZiAoY29tcGFyZUZuKSB7XG5cdFx0XHRsaXN0LnNvcnQoaXNDYWxsYWJsZShjb21wYXJlRm4pID8gY29tcGFyZUZuLmJpbmQob2JqKSA6IHVuZGVmaW5lZCk7XG5cdFx0fVxuXHRcdHJldHVybiBsaXN0W21ldGhvZF0oZnVuY3Rpb24gKGtleSwgaW5kZXgpIHtcblx0XHRcdGlmICghcHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmosIGtleSkpIHJldHVybiBkZWZWYWw7XG5cdFx0XHRyZXR1cm4gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCBvYmpba2V5XSwga2V5LCBvYmosIGluZGV4KTtcblx0XHR9KTtcblx0fTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3QuYXNzaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgYXNzaWduID0gT2JqZWN0LmFzc2lnbiwgb2JqO1xuXHRpZiAodHlwZW9mIGFzc2lnbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRvYmogPSB7IGZvbzogJ3JheicgfTtcblx0YXNzaWduKG9iaiwgeyBiYXI6ICdkd2EnIH0sIHsgdHJ6eTogJ3RyenknIH0pO1xuXHRyZXR1cm4gKG9iai5mb28gKyBvYmouYmFyICsgb2JqLnRyenkpID09PSAncmF6ZHdhdHJ6eSc7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyAgPSByZXF1aXJlKCcuLi9rZXlzJylcbiAgLCB2YWx1ZSA9IHJlcXVpcmUoJy4uL3ZhbGlkLXZhbHVlJylcblxuICAsIG1heCA9IE1hdGgubWF4O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkZXN0LCBzcmMvKiwg4oCmc3JjbiovKSB7XG5cdHZhciBlcnJvciwgaSwgbCA9IG1heChhcmd1bWVudHMubGVuZ3RoLCAyKSwgYXNzaWduO1xuXHRkZXN0ID0gT2JqZWN0KHZhbHVlKGRlc3QpKTtcblx0YXNzaWduID0gZnVuY3Rpb24gKGtleSkge1xuXHRcdHRyeSB7IGRlc3Rba2V5XSA9IHNyY1trZXldOyB9IGNhdGNoIChlKSB7XG5cdFx0XHRpZiAoIWVycm9yKSBlcnJvciA9IGU7XG5cdFx0fVxuXHR9O1xuXHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSB7XG5cdFx0c3JjID0gYXJndW1lbnRzW2ldO1xuXHRcdGtleXMoc3JjKS5mb3JFYWNoKGFzc2lnbik7XG5cdH1cblx0aWYgKGVycm9yICE9PSB1bmRlZmluZWQpIHRocm93IGVycm9yO1xuXHRyZXR1cm4gZGVzdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc3NpZ24gPSByZXF1aXJlKCcuL2Fzc2lnbicpXG4gICwgdmFsdWUgID0gcmVxdWlyZSgnLi92YWxpZC12YWx1ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0dmFyIGNvcHkgPSBPYmplY3QodmFsdWUob2JqKSk7XG5cdGlmIChjb3B5ICE9PSBvYmopIHJldHVybiBjb3B5O1xuXHRyZXR1cm4gYXNzaWduKHt9LCBvYmopO1xufTtcbiIsIi8vIFdvcmthcm91bmQgZm9yIGh0dHA6Ly9jb2RlLmdvb2dsZS5jb20vcC92OC9pc3N1ZXMvZGV0YWlsP2lkPTI4MDRcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgc2hpbTtcblxuaWYgKCFyZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2YvaXMtaW1wbGVtZW50ZWQnKSgpKSB7XG5cdHNoaW0gPSByZXF1aXJlKCcuL3NldC1wcm90b3R5cGUtb2Yvc2hpbScpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBudWxsT2JqZWN0LCBwcm9wcywgZGVzYztcblx0aWYgKCFzaGltKSByZXR1cm4gY3JlYXRlO1xuXHRpZiAoc2hpbS5sZXZlbCAhPT0gMSkgcmV0dXJuIGNyZWF0ZTtcblxuXHRudWxsT2JqZWN0ID0ge307XG5cdHByb3BzID0ge307XG5cdGRlc2MgPSB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKE9iamVjdC5wcm90b3R5cGUpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcblx0XHRpZiAobmFtZSA9PT0gJ19fcHJvdG9fXycpIHtcblx0XHRcdHByb3BzW25hbWVdID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHRcdFx0dmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRwcm9wc1tuYW1lXSA9IGRlc2M7XG5cdH0pO1xuXHRPYmplY3QuZGVmaW5lUHJvcGVydGllcyhudWxsT2JqZWN0LCBwcm9wcyk7XG5cblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHNoaW0sICdudWxsUG9seWZpbGwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IG51bGxPYmplY3QgfSk7XG5cblx0cmV0dXJuIGZ1bmN0aW9uIChwcm90b3R5cGUsIHByb3BzKSB7XG5cdFx0cmV0dXJuIGNyZWF0ZSgocHJvdG90eXBlID09PSBudWxsKSA/IG51bGxPYmplY3QgOiBwcm90b3R5cGUsIHByb3BzKTtcblx0fTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9faXRlcmF0ZScpKCdmb3JFYWNoJyk7XG4iLCIvLyBEZXByZWNhdGVkXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7IHJldHVybiB0eXBlb2Ygb2JqID09PSAnZnVuY3Rpb24nOyB9O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgbWFwID0geyBmdW5jdGlvbjogdHJ1ZSwgb2JqZWN0OiB0cnVlIH07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICgoeCAhPSBudWxsKSAmJiBtYXBbdHlwZW9mIHhdKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Qua2V5c1xuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dHJ5IHtcblx0XHRPYmplY3Qua2V5cygncHJpbWl0aXZlJyk7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIga2V5cyA9IE9iamVjdC5rZXlzO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmplY3QpIHtcblx0cmV0dXJuIGtleXMob2JqZWN0ID09IG51bGwgPyBvYmplY3QgOiBPYmplY3Qob2JqZWN0KSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCcuL3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBmb3JFYWNoICA9IHJlcXVpcmUoJy4vZm9yLWVhY2gnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbyA9IHt9LCB0aGlzQXJnID0gYXJndW1lbnRzWzJdO1xuXHRjYWxsYWJsZShjYik7XG5cdGZvckVhY2gob2JqLCBmdW5jdGlvbiAodmFsdWUsIGtleSwgb2JqLCBpbmRleCkge1xuXHRcdG9ba2V5XSA9IGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGtleSwgb2JqLCBpbmRleCk7XG5cdH0pO1xuXHRyZXR1cm4gbztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2gsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG5cbnZhciBwcm9jZXNzID0gZnVuY3Rpb24gKHNyYywgb2JqKSB7XG5cdHZhciBrZXk7XG5cdGZvciAoa2V5IGluIHNyYykgb2JqW2tleV0gPSBzcmNba2V5XTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMvKiwg4oCmb3B0aW9ucyovKSB7XG5cdHZhciByZXN1bHQgPSBjcmVhdGUobnVsbCk7XG5cdGZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uIChvcHRpb25zKSB7XG5cdFx0aWYgKG9wdGlvbnMgPT0gbnVsbCkgcmV0dXJuO1xuXHRcdHByb2Nlc3MoT2JqZWN0KG9wdGlvbnMpLCByZXN1bHQpO1xuXHR9KTtcblx0cmV0dXJuIHJlc3VsdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGdldFByb3RvdHlwZU9mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mXG4gICwgeCA9IHt9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgvKmN1c3RvbUNyZWF0ZSovKSB7XG5cdHZhciBzZXRQcm90b3R5cGVPZiA9IE9iamVjdC5zZXRQcm90b3R5cGVPZlxuXHQgICwgY3VzdG9tQ3JlYXRlID0gYXJndW1lbnRzWzBdIHx8IGNyZWF0ZTtcblx0aWYgKHR5cGVvZiBzZXRQcm90b3R5cGVPZiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gZ2V0UHJvdG90eXBlT2Yoc2V0UHJvdG90eXBlT2YoY3VzdG9tQ3JlYXRlKG51bGwpLCB4KSkgPT09IHg7XG59O1xuIiwiLy8gQmlnIHRoYW5rcyB0byBAV2ViUmVmbGVjdGlvbiBmb3Igc29ydGluZyB0aGlzIG91dFxuLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vV2ViUmVmbGVjdGlvbi81NTkzNTU0XG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGlzT2JqZWN0ICAgICAgPSByZXF1aXJlKCcuLi9pcy1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgPSByZXF1aXJlKCcuLi92YWxpZC12YWx1ZScpXG5cbiAgLCBpc1Byb3RvdHlwZU9mID0gT2JqZWN0LnByb3RvdHlwZS5pc1Byb3RvdHlwZU9mXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBudWxsRGVzYyA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0dmFsdWU6IHVuZGVmaW5lZCB9XG4gICwgdmFsaWRhdGU7XG5cbnZhbGlkYXRlID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdHZhbHVlKG9iaik7XG5cdGlmICgocHJvdG90eXBlID09PSBudWxsKSB8fCBpc09iamVjdChwcm90b3R5cGUpKSByZXR1cm4gb2JqO1xuXHR0aHJvdyBuZXcgVHlwZUVycm9yKCdQcm90b3R5cGUgbXVzdCBiZSBudWxsIG9yIGFuIG9iamVjdCcpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKHN0YXR1cykge1xuXHR2YXIgZm4sIHNldDtcblx0aWYgKCFzdGF0dXMpIHJldHVybiBudWxsO1xuXHRpZiAoc3RhdHVzLmxldmVsID09PSAyKSB7XG5cdFx0aWYgKHN0YXR1cy5zZXQpIHtcblx0XHRcdHNldCA9IHN0YXR1cy5zZXQ7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHRzZXQuY2FsbCh2YWxpZGF0ZShvYmosIHByb3RvdHlwZSksIHByb3RvdHlwZSk7XG5cdFx0XHRcdHJldHVybiBvYmo7XG5cdFx0XHR9O1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSkuX19wcm90b19fID0gcHJvdG90eXBlO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0Zm4gPSBmdW5jdGlvbiBzZWxmKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHR2YXIgaXNOdWxsQmFzZTtcblx0XHRcdHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKTtcblx0XHRcdGlzTnVsbEJhc2UgPSBpc1Byb3RvdHlwZU9mLmNhbGwoc2VsZi5udWxsUG9seWZpbGwsIG9iaik7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVsZXRlIHNlbGYubnVsbFBvbHlmaWxsLl9fcHJvdG9fXztcblx0XHRcdGlmIChwcm90b3R5cGUgPT09IG51bGwpIHByb3RvdHlwZSA9IHNlbGYubnVsbFBvbHlmaWxsO1xuXHRcdFx0b2JqLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdGlmIChpc051bGxCYXNlKSBkZWZpbmVQcm9wZXJ0eShzZWxmLm51bGxQb2x5ZmlsbCwgJ19fcHJvdG9fXycsIG51bGxEZXNjKTtcblx0XHRcdHJldHVybiBvYmo7XG5cdFx0fTtcblx0fVxuXHRyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGZuLCAnbGV2ZWwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IHN0YXR1cy5sZXZlbCB9KTtcbn0oKGZ1bmN0aW9uICgpIHtcblx0dmFyIHggPSBPYmplY3QuY3JlYXRlKG51bGwpLCB5ID0ge30sIHNldFxuXHQgICwgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoT2JqZWN0LnByb3RvdHlwZSwgJ19fcHJvdG9fXycpO1xuXG5cdGlmIChkZXNjKSB7XG5cdFx0dHJ5IHtcblx0XHRcdHNldCA9IGRlc2Muc2V0OyAvLyBPcGVyYSBjcmFzaGVzIGF0IHRoaXMgcG9pbnRcblx0XHRcdHNldC5jYWxsKHgsIHkpO1xuXHRcdH0gY2F0Y2ggKGlnbm9yZSkgeyB9XG5cdFx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgc2V0OiBzZXQsIGxldmVsOiAyIH07XG5cdH1cblxuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAyIH07XG5cblx0eCA9IHt9O1xuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAxIH07XG5cblx0cmV0dXJuIGZhbHNlO1xufSgpKSkpO1xuXG5yZXF1aXJlKCcuLi9jcmVhdGUnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZm4pIHtcblx0aWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IFR5cGVFcnJvcihmbiArIFwiIGlzIG5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRyZXR1cm4gZm47XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNPYmplY3QgPSByZXF1aXJlKCcuL2lzLW9iamVjdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBhbiBPYmplY3RcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSBudWxsIG9yIHVuZGVmaW5lZFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IFN0cmluZy5wcm90b3R5cGUuY29udGFpbnNcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHN0ciA9ICdyYXpkd2F0cnp5JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2Ygc3RyLmNvbnRhaW5zICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHN0ci5jb250YWlucygnZHdhJykgPT09IHRydWUpICYmIChzdHIuY29udGFpbnMoJ2ZvbycpID09PSBmYWxzZSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGluZGV4T2YgPSBTdHJpbmcucHJvdG90eXBlLmluZGV4T2Y7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHNlYXJjaFN0cmluZy8qLCBwb3NpdGlvbiovKSB7XG5cdHJldHVybiBpbmRleE9mLmNhbGwodGhpcywgc2VhcmNoU3RyaW5nLCBhcmd1bWVudHNbMV0pID4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nXG5cbiAgLCBpZCA9IHRvU3RyaW5nLmNhbGwoJycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAodHlwZW9mIHggPT09ICdzdHJpbmcnKSB8fCAoeCAmJiAodHlwZW9mIHggPT09ICdvYmplY3QnKSAmJlxuXHRcdCgoeCBpbnN0YW5jZW9mIFN0cmluZykgfHwgKHRvU3RyaW5nLmNhbGwoeCkgPT09IGlkKSkpIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGdlbmVyYXRlZCA9IE9iamVjdC5jcmVhdGUobnVsbClcblxuICAsIHJhbmRvbSA9IE1hdGgucmFuZG9tO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN0cjtcblx0ZG8geyBzdHIgPSByYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMik7IH0gd2hpbGUgKGdlbmVyYXRlZFtzdHJdKTtcblx0cmV0dXJuIHN0cjtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNvbnRhaW5zICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgQXJyYXlJdGVyYXRvcjtcblxuQXJyYXlJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFyciwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgQXJyYXlJdGVyYXRvcikpIHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihhcnIsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIGFycik7XG5cdGlmICgha2luZCkga2luZCA9ICd2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleSt2YWx1ZScpKSBraW5kID0gJ2tleSt2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleScpKSBraW5kID0gJ2tleSc7XG5cdGVsc2Uga2luZCA9ICd2YWx1ZSc7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2tpbmRfXycsIGQoJycsIGtpbmQpKTtcbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKEFycmF5SXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuQXJyYXlJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChBcnJheUl0ZXJhdG9yKSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ3ZhbHVlJykgcmV0dXJuIHRoaXMuX19saXN0X19baV07XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICdrZXkrdmFsdWUnKSByZXR1cm4gW2ksIHRoaXMuX19saXN0X19baV1dO1xuXHRcdHJldHVybiBpO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgQXJyYXkgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGdldCAgICAgID0gcmVxdWlyZSgnLi9nZXQnKVxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXksIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoaXRlcmFibGUsIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbW9kZSwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgcmVzdWx0LCBkb0JyZWFrLCBicm9rZW4sIGksIGwsIGNoYXIsIGNvZGU7XG5cdGlmIChpc0FycmF5KGl0ZXJhYmxlKSkgbW9kZSA9ICdhcnJheSc7XG5cdGVsc2UgaWYgKGlzU3RyaW5nKGl0ZXJhYmxlKSkgbW9kZSA9ICdzdHJpbmcnO1xuXHRlbHNlIGl0ZXJhYmxlID0gZ2V0KGl0ZXJhYmxlKTtcblxuXHRjYWxsYWJsZShjYik7XG5cdGRvQnJlYWsgPSBmdW5jdGlvbiAoKSB7IGJyb2tlbiA9IHRydWU7IH07XG5cdGlmIChtb2RlID09PSAnYXJyYXknKSB7XG5cdFx0aXRlcmFibGUuc29tZShmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgcmV0dXJuIHRydWU7XG5cdFx0fSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cdGlmIChtb2RlID09PSAnc3RyaW5nJykge1xuXHRcdGwgPSBpdGVyYWJsZS5sZW5ndGg7XG5cdFx0Zm9yIChpID0gMDsgaSA8IGw7ICsraSkge1xuXHRcdFx0Y2hhciA9IGl0ZXJhYmxlW2ldO1xuXHRcdFx0aWYgKChpICsgMSkgPCBsKSB7XG5cdFx0XHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0XHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIGNoYXIgKz0gaXRlcmFibGVbKytpXTtcblx0XHRcdH1cblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgY2hhciwgZG9CcmVhayk7XG5cdFx0XHRpZiAoYnJva2VuKSBicmVhaztcblx0XHR9XG5cdFx0cmV0dXJuO1xuXHR9XG5cdHJlc3VsdCA9IGl0ZXJhYmxlLm5leHQoKTtcblxuXHR3aGlsZSAoIXJlc3VsdC5kb25lKSB7XG5cdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCByZXN1bHQudmFsdWUsIGRvQnJlYWspO1xuXHRcdGlmIChicm9rZW4pIHJldHVybjtcblx0XHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cdH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N0cmluZyA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgQXJyYXlJdGVyYXRvciAgPSByZXF1aXJlKCcuL2FycmF5JylcbiAgLCBTdHJpbmdJdGVyYXRvciA9IHJlcXVpcmUoJy4vc3RyaW5nJylcbiAgLCBpdGVyYWJsZSAgICAgICA9IHJlcXVpcmUoJy4vdmFsaWQtaXRlcmFibGUnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0aWYgKHR5cGVvZiBpdGVyYWJsZShvYmopW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG9ialtpdGVyYXRvclN5bWJvbF0oKTtcblx0aWYgKGlzU3RyaW5nKG9iaikpIHJldHVybiBuZXcgU3RyaW5nSXRlcmF0b3Iob2JqKTtcblx0cmV0dXJuIG5ldyBBcnJheUl0ZXJhdG9yKG9iaik7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGFzc2lnbiAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvYXNzaWduJylcbiAgLCBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCBkICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGF1dG9CaW5kID0gcmVxdWlyZSgnZC9hdXRvLWJpbmQnKVxuICAsIFN5bWJvbCAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIEl0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEl0ZXJhdG9yID0gZnVuY3Rpb24gKGxpc3QsIGNvbnRleHQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBJdGVyYXRvcihsaXN0LCBjb250ZXh0KTtcblx0ZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG5cdFx0X19saXN0X186IGQoJ3cnLCB2YWx1ZShsaXN0KSksXG5cdFx0X19jb250ZXh0X186IGQoJ3cnLCBjb250ZXh0KSxcblx0XHRfX25leHRJbmRleF9fOiBkKCd3JywgMClcblx0fSk7XG5cdGlmICghY29udGV4dCkgcmV0dXJuO1xuXHRjYWxsYWJsZShjb250ZXh0Lm9uKTtcblx0Y29udGV4dC5vbignX2FkZCcsIHRoaXMuX29uQWRkKTtcblx0Y29udGV4dC5vbignX2RlbGV0ZScsIHRoaXMuX29uRGVsZXRlKTtcblx0Y29udGV4dC5vbignX2NsZWFyJywgdGhpcy5fb25DbGVhcik7XG59O1xuXG5kZWZpbmVQcm9wZXJ0aWVzKEl0ZXJhdG9yLnByb3RvdHlwZSwgYXNzaWduKHtcblx0Y29uc3RydWN0b3I6IGQoSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIHtcblx0XHRcdGkgPSB0aGlzLl9fcmVkb19fLnNoaWZ0KCk7XG5cdFx0XHRpZiAoaSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gaTtcblx0XHR9XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19saXN0X18ubGVuZ3RoKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRuZXh0OiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX2NyZWF0ZVJlc3VsdCh0aGlzLl9uZXh0KCkpOyB9KSxcblx0X2NyZWF0ZVJlc3VsdDogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmIChpID09PSB1bmRlZmluZWQpIHJldHVybiB7IGRvbmU6IHRydWUsIHZhbHVlOiB1bmRlZmluZWQgfTtcblx0XHRyZXR1cm4geyBkb25lOiBmYWxzZSwgdmFsdWU6IHRoaXMuX3Jlc29sdmUoaSkgfTtcblx0fSksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7IHJldHVybiB0aGlzLl9fbGlzdF9fW2ldOyB9KSxcblx0X3VuQmluZDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dGhpcy5fX2xpc3RfXyA9IG51bGw7XG5cdFx0ZGVsZXRlIHRoaXMuX19yZWRvX187XG5cdFx0aWYgKCF0aGlzLl9fY29udGV4dF9fKSByZXR1cm47XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xuXHRcdHRoaXMuX19jb250ZXh0X18gPSBudWxsO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgSXRlcmF0b3JdJzsgfSlcbn0sIGF1dG9CaW5kKHtcblx0X29uQWRkOiBkKGZ1bmN0aW9uIChpbmRleCkge1xuXHRcdGlmIChpbmRleCA+PSB0aGlzLl9fbmV4dEluZGV4X18pIHJldHVybjtcblx0XHQrK3RoaXMuX19uZXh0SW5kZXhfXztcblx0XHRpZiAoIXRoaXMuX19yZWRvX18pIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX3JlZG9fXycsIGQoJ2MnLCBbaW5kZXhdKSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuX19yZWRvX18uZm9yRWFjaChmdW5jdGlvbiAocmVkbywgaSkge1xuXHRcdFx0aWYgKHJlZG8gPj0gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSArK3JlZG87XG5cdFx0fSwgdGhpcyk7XG5cdFx0dGhpcy5fX3JlZG9fXy5wdXNoKGluZGV4KTtcblx0fSksXG5cdF9vbkRlbGV0ZTogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHR2YXIgaTtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0LS10aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSByZXR1cm47XG5cdFx0aSA9IHRoaXMuX19yZWRvX18uaW5kZXhPZihpbmRleCk7XG5cdFx0aWYgKGkgIT09IC0xKSB0aGlzLl9fcmVkb19fLnNwbGljZShpLCAxKTtcblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID4gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSAtLXJlZG87XG5cdFx0fSwgdGhpcyk7XG5cdH0pLFxuXHRfb25DbGVhcjogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIGNsZWFyLmNhbGwodGhpcy5fX3JlZG9fXyk7XG5cdFx0dGhpcy5fX25leHRJbmRleF9fID0gMDtcblx0fSlcbn0pKSk7XG5cbmRlZmluZVByb3BlcnR5KEl0ZXJhdG9yLnByb3RvdHlwZSwgU3ltYm9sLml0ZXJhdG9yLCBkKGZ1bmN0aW9uICgpIHtcblx0cmV0dXJuIHRoaXM7XG59KSk7XG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnJywgJ0l0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxzZTtcblx0aWYgKGlzQXJyYXkodmFsdWUpKSByZXR1cm4gdHJ1ZTtcblx0aWYgKGlzU3RyaW5nKHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdHJldHVybiAodHlwZW9mIHZhbHVlW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJyk7XG59O1xuIiwiLy8gVGhhbmtzIEBtYXRoaWFzYnluZW5zXG4vLyBodHRwOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LXVuaWNvZGUjaXRlcmF0aW5nLW92ZXItc3ltYm9sc1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFN0cmluZ0l0ZXJhdG9yO1xuXG5TdHJpbmdJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHN0cikge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgU3RyaW5nSXRlcmF0b3IpKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKHN0cik7XG5cdHN0ciA9IFN0cmluZyhzdHIpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIHN0cik7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2xlbmd0aF9fJywgZCgnJywgc3RyLmxlbmd0aCkpO1xuXG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTdHJpbmdJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5TdHJpbmdJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTdHJpbmdJdGVyYXRvciksXG5cdF9uZXh0OiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19saXN0X18pIHJldHVybjtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fIDwgdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdHZhciBjaGFyID0gdGhpcy5fX2xpc3RfX1tpXSwgY29kZTtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fID09PSB0aGlzLl9fbGVuZ3RoX18pIHJldHVybiBjaGFyO1xuXHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0aWYgKChjb2RlID49IDB4RDgwMCkgJiYgKGNvZGUgPD0gMHhEQkZGKSkgcmV0dXJuIGNoYXIgKyB0aGlzLl9fbGlzdF9fW3RoaXMuX19uZXh0SW5kZXhfXysrXTtcblx0XHRyZXR1cm4gY2hhcjtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFN0cmluZyBJdGVyYXRvcl0nOyB9KVxufSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0l0ZXJhYmxlID0gcmVxdWlyZSgnLi9pcy1pdGVyYWJsZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzSXRlcmFibGUodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGl0ZXJhYmxlXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gU3ltYm9sIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHR5cGVvZiBTeW1ib2wgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c3ltYm9sID0gU3ltYm9sKCd0ZXN0IHN5bWJvbCcpO1xuXHR0cnkgeyBTdHJpbmcoc3ltYm9sKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgPT09ICdzeW1ib2wnKSByZXR1cm4gdHJ1ZTtcblxuXHQvLyBSZXR1cm4gJ3RydWUnIGZvciBwb2x5ZmlsbHNcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNDb25jYXRTcHJlYWRhYmxlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9QcmltaXRpdmUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvU3RyaW5nVGFnICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC51bnNjb3BhYmxlcyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICh4ICYmICgodHlwZW9mIHggPT09ICdzeW1ib2wnKSB8fCAoeFsnQEB0b1N0cmluZ1RhZyddID09PSAnU3ltYm9sJykpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIHZhbGlkYXRlU3ltYm9sID0gcmVxdWlyZSgnLi92YWxpZGF0ZS1zeW1ib2wnKVxuXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksIG9ialByb3RvdHlwZSA9IE9iamVjdC5wcm90b3R5cGVcbiAgLCBTeW1ib2wsIEhpZGRlblN5bWJvbCwgZ2xvYmFsU3ltYm9scyA9IGNyZWF0ZShudWxsKTtcblxudmFyIGdlbmVyYXRlTmFtZSA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBjcmVhdGVkID0gY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKGRlc2MpIHtcblx0XHR2YXIgcG9zdGZpeCA9IDAsIG5hbWU7XG5cdFx0d2hpbGUgKGNyZWF0ZWRbZGVzYyArIChwb3N0Zml4IHx8ICcnKV0pICsrcG9zdGZpeDtcblx0XHRkZXNjICs9IChwb3N0Zml4IHx8ICcnKTtcblx0XHRjcmVhdGVkW2Rlc2NdID0gdHJ1ZTtcblx0XHRuYW1lID0gJ0BAJyArIGRlc2M7XG5cdFx0ZGVmaW5lUHJvcGVydHkob2JqUHJvdG90eXBlLCBuYW1lLCBkLmdzKG51bGwsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgbmFtZSwgZCh2YWx1ZSkpO1xuXHRcdH0pKTtcblx0XHRyZXR1cm4gbmFtZTtcblx0fTtcbn0oKSk7XG5cbkhpZGRlblN5bWJvbCA9IGZ1bmN0aW9uIFN5bWJvbChkZXNjcmlwdGlvbikge1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIEhpZGRlblN5bWJvbCkgdGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0cmV0dXJuIFN5bWJvbChkZXNjcmlwdGlvbik7XG59O1xubW9kdWxlLmV4cG9ydHMgPSBTeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBTeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHN5bWJvbCA9IGNyZWF0ZShIaWRkZW5TeW1ib2wucHJvdG90eXBlKTtcblx0ZGVzY3JpcHRpb24gPSAoZGVzY3JpcHRpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKGRlc2NyaXB0aW9uKSk7XG5cdHJldHVybiBkZWZpbmVQcm9wZXJ0aWVzKHN5bWJvbCwge1xuXHRcdF9fZGVzY3JpcHRpb25fXzogZCgnJywgZGVzY3JpcHRpb24pLFxuXHRcdF9fbmFtZV9fOiBkKCcnLCBnZW5lcmF0ZU5hbWUoZGVzY3JpcHRpb24pKVxuXHR9KTtcbn07XG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbCwge1xuXHRmb3I6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChnbG9iYWxTeW1ib2xzW2tleV0pIHJldHVybiBnbG9iYWxTeW1ib2xzW2tleV07XG5cdFx0cmV0dXJuIChnbG9iYWxTeW1ib2xzW2tleV0gPSBTeW1ib2woU3RyaW5nKGtleSkpKTtcblx0fSksXG5cdGtleUZvcjogZChmdW5jdGlvbiAocykge1xuXHRcdHZhciBrZXk7XG5cdFx0dmFsaWRhdGVTeW1ib2wocyk7XG5cdFx0Zm9yIChrZXkgaW4gZ2xvYmFsU3ltYm9scykgaWYgKGdsb2JhbFN5bWJvbHNba2V5XSA9PT0gcykgcmV0dXJuIGtleTtcblx0fSksXG5cdGhhc0luc3RhbmNlOiBkKCcnLCBTeW1ib2woJ2hhc0luc3RhbmNlJykpLFxuXHRpc0NvbmNhdFNwcmVhZGFibGU6IGQoJycsIFN5bWJvbCgnaXNDb25jYXRTcHJlYWRhYmxlJykpLFxuXHRpdGVyYXRvcjogZCgnJywgU3ltYm9sKCdpdGVyYXRvcicpKSxcblx0bWF0Y2g6IGQoJycsIFN5bWJvbCgnbWF0Y2gnKSksXG5cdHJlcGxhY2U6IGQoJycsIFN5bWJvbCgncmVwbGFjZScpKSxcblx0c2VhcmNoOiBkKCcnLCBTeW1ib2woJ3NlYXJjaCcpKSxcblx0c3BlY2llczogZCgnJywgU3ltYm9sKCdzcGVjaWVzJykpLFxuXHRzcGxpdDogZCgnJywgU3ltYm9sKCdzcGxpdCcpKSxcblx0dG9QcmltaXRpdmU6IGQoJycsIFN5bWJvbCgndG9QcmltaXRpdmUnKSksXG5cdHRvU3RyaW5nVGFnOiBkKCcnLCBTeW1ib2woJ3RvU3RyaW5nVGFnJykpLFxuXHR1bnNjb3BhYmxlczogZCgnJywgU3ltYm9sKCd1bnNjb3BhYmxlcycpKVxufSk7XG5kZWZpbmVQcm9wZXJ0aWVzKEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3ltYm9sKSxcblx0dG9TdHJpbmc6IGQoJycsIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19uYW1lX187IH0pXG59KTtcblxuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wucHJvdG90eXBlLCB7XG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdTeW1ib2wgKCcgKyB2YWxpZGF0ZVN5bWJvbCh0aGlzKS5fX2Rlc2NyaXB0aW9uX18gKyAnKSc7IH0pLFxuXHR2YWx1ZU9mOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KVxufSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsIGQoJycsXG5cdGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU3ltYm9sJykpO1xuXG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1ByaW1pdGl2ZV0pKTtcbmRlZmluZVByb3BlcnR5KEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZyxcblx0ZCgnYycsIFN5bWJvbC5wcm90b3R5cGVbU3ltYm9sLnRvU3RyaW5nVGFnXSkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTeW1ib2wgPSByZXF1aXJlKCcuL2lzLXN5bWJvbCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzU3ltYm9sKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBhIHN5bWJvbFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgb2JqZWN0ICAgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuICAsIHJhbmRvbVVuaXEgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvcmFuZG9tLXVuaXEnKVxuICAsIGQgICAgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgZ2V0SXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZ2V0JylcbiAgLCBmb3JPZiAgICAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci9mb3Itb2YnKVxuICAsIHRvU3RyaW5nVGFnU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLnRvU3RyaW5nVGFnXG4gICwgaXNOYXRpdmUgICAgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksIGdldFByb3RvdHlwZU9mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mXG4gICwgV2Vha01hcFBvbHk7XG5cbm1vZHVsZS5leHBvcnRzID0gV2Vha01hcFBvbHkgPSBmdW5jdGlvbiAoLyppdGVyYWJsZSovKSB7XG5cdHZhciBpdGVyYWJsZSA9IGFyZ3VtZW50c1swXSwgc2VsZjtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFdlYWtNYXBQb2x5KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQ29uc3RydWN0b3IgcmVxdWlyZXMgXFwnbmV3XFwnJyk7XG5cdGlmIChpc05hdGl2ZSAmJiBzZXRQcm90b3R5cGVPZiAmJiAoV2Vha01hcCAhPT0gV2Vha01hcFBvbHkpKSB7XG5cdFx0c2VsZiA9IHNldFByb3RvdHlwZU9mKG5ldyBXZWFrTWFwKCksIGdldFByb3RvdHlwZU9mKHRoaXMpKTtcblx0fSBlbHNlIHtcblx0XHRzZWxmID0gdGhpcztcblx0fVxuXHRpZiAoaXRlcmFibGUgIT0gbnVsbCkge1xuXHRcdGlmICghaXNBcnJheShpdGVyYWJsZSkpIGl0ZXJhYmxlID0gZ2V0SXRlcmF0b3IoaXRlcmFibGUpO1xuXHR9XG5cdGRlZmluZVByb3BlcnR5KHNlbGYsICdfX3dlYWtNYXBEYXRhX18nLCBkKCdjJywgJyR3ZWFrTWFwJCcgKyByYW5kb21VbmlxKCkpKTtcblx0aWYgKCFpdGVyYWJsZSkgcmV0dXJuIHNlbGY7XG5cdGZvck9mKGl0ZXJhYmxlLCBmdW5jdGlvbiAodmFsKSB7XG5cdFx0dmFsdWUodmFsKTtcblx0XHRzZWxmLnNldCh2YWxbMF0sIHZhbFsxXSk7XG5cdH0pO1xuXHRyZXR1cm4gc2VsZjtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFdlYWtNYXBQb2x5LCBXZWFrTWFwKTtcblx0V2Vha01hcFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShXZWFrTWFwLnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKFdlYWtNYXBQb2x5KVxuXHR9KTtcbn1cblxuT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoV2Vha01hcFBvbHkucHJvdG90eXBlLCB7XG5cdGRlbGV0ZTogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0KGtleSksIHRoaXMuX193ZWFrTWFwRGF0YV9fKSkge1xuXHRcdFx0ZGVsZXRlIGtleVt0aGlzLl9fd2Vha01hcERhdGFfX107XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9KSxcblx0Z2V0OiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3Qoa2V5KSwgdGhpcy5fX3dlYWtNYXBEYXRhX18pKSB7XG5cdFx0XHRyZXR1cm4ga2V5W3RoaXMuX193ZWFrTWFwRGF0YV9fXTtcblx0XHR9XG5cdH0pLFxuXHRoYXM6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdHJldHVybiBoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXyk7XG5cdH0pLFxuXHRzZXQ6IGQoZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcblx0XHRkZWZpbmVQcm9wZXJ0eShvYmplY3Qoa2V5KSwgdGhpcy5fX3dlYWtNYXBEYXRhX18sIGQoJ2MnLCB2YWx1ZSkpO1xuXHRcdHJldHVybiB0aGlzO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgV2Vha01hcF0nOyB9KVxufSk7XG5kZWZpbmVQcm9wZXJ0eShXZWFrTWFwUG9seS5wcm90b3R5cGUsIHRvU3RyaW5nVGFnU3ltYm9sLCBkKCdjJywgJ1dlYWtNYXAnKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBNYXAgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgbWFwLCBpdGVyYXRvciwgcmVzdWx0O1xuXHRpZiAodHlwZW9mIE1hcCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHR0cnkge1xuXHRcdC8vIFdlYktpdCBkb2Vzbid0IHN1cHBvcnQgYXJndW1lbnRzIGFuZCBjcmFzaGVzXG5cdFx0bWFwID0gbmV3IE1hcChbWydyYXonLCAnb25lJ10sIFsnZHdhJywgJ3R3byddLCBbJ3RyenknLCAndGhyZWUnXV0pO1xuXHR9IGNhdGNoIChlKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cdGlmIChtYXAuc2l6ZSAhPT0gMykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5jbGVhciAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5kZWxldGUgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZW50cmllcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5mb3JFYWNoICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmdldCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5oYXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAua2V5cyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5zZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAudmFsdWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cblx0aXRlcmF0b3IgPSBtYXAuZW50cmllcygpO1xuXHRyZXN1bHQgPSBpdGVyYXRvci5uZXh0KCk7XG5cdGlmIChyZXN1bHQuZG9uZSAhPT0gZmFsc2UpIHJldHVybiBmYWxzZTtcblx0aWYgKCFyZXN1bHQudmFsdWUpIHJldHVybiBmYWxzZTtcblx0aWYgKHJlc3VsdC52YWx1ZVswXSAhPT0gJ3JheicpIHJldHVybiBmYWxzZTtcblx0aWYgKHJlc3VsdC52YWx1ZVsxXSAhPT0gJ29uZScpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIHRydWU7XG59O1xuIiwiLy8gRXhwb3J0cyB0cnVlIGlmIGVudmlyb25tZW50IHByb3ZpZGVzIG5hdGl2ZSBgTWFwYCBpbXBsZW1lbnRhdGlvbixcbi8vIHdoYXRldmVyIHRoYXQgaXMuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIE1hcCA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoTWFwLnByb3RvdHlwZSkgPT09ICdbb2JqZWN0IE1hcF0nKTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvcHJpbWl0aXZlLXNldCcpKCdrZXknLFxuXHQndmFsdWUnLCAna2V5K3ZhbHVlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGQgICAgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3InKVxuICAsIHRvU3RyaW5nVGFnU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLnRvU3RyaW5nVGFnXG4gICwga2luZHMgICAgICAgICAgICAgPSByZXF1aXJlKCcuL2l0ZXJhdG9yLWtpbmRzJylcblxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIHVuQmluZCA9IEl0ZXJhdG9yLnByb3RvdHlwZS5fdW5CaW5kXG4gICwgTWFwSXRlcmF0b3I7XG5cbk1hcEl0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWFwLCBraW5kKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBNYXBJdGVyYXRvcikpIHJldHVybiBuZXcgTWFwSXRlcmF0b3IobWFwLCBraW5kKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBtYXAuX19tYXBLZXlzRGF0YV9fLCBtYXApO1xuXHRpZiAoIWtpbmQgfHwgIWtpbmRzW2tpbmRdKSBraW5kID0gJ2tleSt2YWx1ZSc7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fa2luZF9fOiBkKCcnLCBraW5kKSxcblx0XHRfX3ZhbHVlc19fOiBkKCd3JywgbWFwLl9fbWFwVmFsdWVzRGF0YV9fKVxuXHR9KTtcbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKE1hcEl0ZXJhdG9yLCBJdGVyYXRvcik7XG5cbk1hcEl0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKE1hcEl0ZXJhdG9yKSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ3ZhbHVlJykgcmV0dXJuIHRoaXMuX192YWx1ZXNfX1tpXTtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ2tleScpIHJldHVybiB0aGlzLl9fbGlzdF9fW2ldO1xuXHRcdHJldHVybiBbdGhpcy5fX2xpc3RfX1tpXSwgdGhpcy5fX3ZhbHVlc19fW2ldXTtcblx0fSksXG5cdF91bkJpbmQ6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHRoaXMuX192YWx1ZXNfXyA9IG51bGw7XG5cdFx0dW5CaW5kLmNhbGwodGhpcyk7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBNYXAgSXRlcmF0b3JdJzsgfSlcbn0pO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KE1hcEl0ZXJhdG9yLnByb3RvdHlwZSwgdG9TdHJpbmdUYWdTeW1ib2wsXG5cdGQoJ2MnLCAnTWFwIEl0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY29weSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2NvcHknKVxuICAsIG1hcCAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9tYXAnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcblxuICAsIGJpbmQgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZWZpbmU7XG5cbmRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXNjLCBiaW5kVG8pIHtcblx0dmFyIHZhbHVlID0gdmFsaWRWYWx1ZShkZXNjKSAmJiBjYWxsYWJsZShkZXNjLnZhbHVlKSwgZGdzO1xuXHRkZ3MgPSBjb3B5KGRlc2MpO1xuXHRkZWxldGUgZGdzLndyaXRhYmxlO1xuXHRkZWxldGUgZGdzLnZhbHVlO1xuXHRkZ3MuZ2V0ID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpKSByZXR1cm4gdmFsdWU7XG5cdFx0ZGVzYy52YWx1ZSA9IGJpbmQuY2FsbCh2YWx1ZSwgKGJpbmRUbyA9PSBudWxsKSA/IHRoaXMgOiB0aGlzW2JpbmRUb10pO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGRlc2MpO1xuXHRcdHJldHVybiB0aGlzW25hbWVdO1xuXHR9O1xuXHRyZXR1cm4gZGdzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAocHJvcHMvKiwgYmluZFRvKi8pIHtcblx0dmFyIGJpbmRUbyA9IGFyZ3VtZW50c1sxXTtcblx0cmV0dXJuIG1hcChwcm9wcywgZnVuY3Rpb24gKGRlc2MsIG5hbWUpIHtcblx0XHRyZXR1cm4gZGVmaW5lKG5hbWUsIGRlc2MsIGJpbmRUbyk7XG5cdH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIG5vcm1hbGl6ZU9wdHMgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucycpXG4gICwgaXNDYWxsYWJsZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlJylcbiAgLCBjb250YWlucyAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG5cbiAgLCBkO1xuXG5kID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZHNjciwgdmFsdWUvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCB3LCBvcHRpb25zLCBkZXNjO1xuXHRpZiAoKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB8fCAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSkge1xuXHRcdG9wdGlvbnMgPSB2YWx1ZTtcblx0XHR2YWx1ZSA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1syXTtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHcgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdFx0dyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ3cnKTtcblx0fVxuXG5cdGRlc2MgPSB7IHZhbHVlOiB2YWx1ZSwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlLCB3cml0YWJsZTogdyB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcblxuZC5ncyA9IGZ1bmN0aW9uIChkc2NyLCBnZXQsIHNldC8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IGdldDtcblx0XHRnZXQgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbM107XG5cdH1cblx0aWYgKGdldCA9PSBudWxsKSB7XG5cdFx0Z2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKGdldCkpIHtcblx0XHRvcHRpb25zID0gZ2V0O1xuXHRcdGdldCA9IHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmIChzZXQgPT0gbnVsbCkge1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShzZXQpKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdH1cblxuXHRkZXNjID0geyBnZXQ6IGdldCwgc2V0OiBzZXQsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcbiIsIi8vIEluc3BpcmVkIGJ5IEdvb2dsZSBDbG9zdXJlOlxuLy8gaHR0cDovL2Nsb3N1cmUtbGlicmFyeS5nb29nbGVjb2RlLmNvbS9zdm4vZG9jcy9cbi8vIGNsb3N1cmVfZ29vZ19hcnJheV9hcnJheS5qcy5odG1sI2dvb2cuYXJyYXkuY2xlYXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmFsdWUgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhbHVlKHRoaXMpLmxlbmd0aCA9IDA7XG5cdHJldHVybiB0aGlzO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvUG9zSW50ID0gcmVxdWlyZSgnLi4vLi4vbnVtYmVyL3RvLXBvcy1pbnRlZ2VyJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJy4uLy4uL29iamVjdC92YWxpZC12YWx1ZScpXG5cbiAgLCBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2ZcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBhYnMgPSBNYXRoLmFicywgZmxvb3IgPSBNYXRoLmZsb29yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hFbGVtZW50LyosIGZyb21JbmRleCovKSB7XG5cdHZhciBpLCBsLCBmcm9tSW5kZXgsIHZhbDtcblx0aWYgKHNlYXJjaEVsZW1lbnQgPT09IHNlYXJjaEVsZW1lbnQpIHsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdHJldHVybiBpbmRleE9mLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG5cdH1cblxuXHRsID0gdG9Qb3NJbnQodmFsdWUodGhpcykubGVuZ3RoKTtcblx0ZnJvbUluZGV4ID0gYXJndW1lbnRzWzFdO1xuXHRpZiAoaXNOYU4oZnJvbUluZGV4KSkgZnJvbUluZGV4ID0gMDtcblx0ZWxzZSBpZiAoZnJvbUluZGV4ID49IDApIGZyb21JbmRleCA9IGZsb29yKGZyb21JbmRleCk7XG5cdGVsc2UgZnJvbUluZGV4ID0gdG9Qb3NJbnQodGhpcy5sZW5ndGgpIC0gZmxvb3IoYWJzKGZyb21JbmRleCkpO1xuXG5cdGZvciAoaSA9IGZyb21JbmRleDsgaSA8IGw7ICsraSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIGkpKSB7XG5cdFx0XHR2YWwgPSB0aGlzW2ldO1xuXHRcdFx0aWYgKHZhbCAhPT0gdmFsKSByZXR1cm4gaTsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdH1cblx0fVxuXHRyZXR1cm4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gTWF0aC5zaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc2lnbiA9IE1hdGguc2lnbjtcblx0aWYgKHR5cGVvZiBzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHNpZ24oMTApID09PSAxKSAmJiAoc2lnbigtMjApID09PSAtMSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0dmFsdWUgPSBOdW1iZXIodmFsdWUpO1xuXHRpZiAoaXNOYU4odmFsdWUpIHx8ICh2YWx1ZSA9PT0gMCkpIHJldHVybiB2YWx1ZTtcblx0cmV0dXJuICh2YWx1ZSA+IDApID8gMSA6IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNpZ24gPSByZXF1aXJlKCcuLi9tYXRoL3NpZ24nKVxuXG4gICwgYWJzID0gTWF0aC5hYnMsIGZsb29yID0gTWF0aC5mbG9vcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKGlzTmFOKHZhbHVlKSkgcmV0dXJuIDA7XG5cdHZhbHVlID0gTnVtYmVyKHZhbHVlKTtcblx0aWYgKCh2YWx1ZSA9PT0gMCkgfHwgIWlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuXHRyZXR1cm4gc2lnbih2YWx1ZSkgKiBmbG9vcihhYnModmFsdWUpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b0ludGVnZXIgPSByZXF1aXJlKCcuL3RvLWludGVnZXInKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7IHJldHVybiBtYXgoMCwgdG9JbnRlZ2VyKHZhbHVlKSk7IH07XG4iLCIvLyBJbnRlcm5hbCBtZXRob2QsIHVzZWQgYnkgaXRlcmF0aW9uIGZ1bmN0aW9ucy5cbi8vIENhbGxzIGEgZnVuY3Rpb24gZm9yIGVhY2gga2V5LXZhbHVlIHBhaXIgZm91bmQgaW4gb2JqZWN0XG4vLyBPcHRpb25hbGx5IHRha2VzIGNvbXBhcmVGbiB0byBpdGVyYXRlIG9iamVjdCBpbiBzcGVjaWZpYyBvcmRlclxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc0NhbGxhYmxlID0gcmVxdWlyZSgnLi9pcy1jYWxsYWJsZScpXG4gICwgY2FsbGFibGUgICA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbHVlICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwga2V5cyA9IE9iamVjdC5rZXlzXG4gICwgcHJvcGVydHlJc0VudW1lcmFibGUgPSBPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChtZXRob2QsIGRlZlZhbCkge1xuXHRyZXR1cm4gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZywgY29tcGFyZUZuKi8pIHtcblx0XHR2YXIgbGlzdCwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgY29tcGFyZUZuID0gYXJndW1lbnRzWzNdO1xuXHRcdG9iaiA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0XHRjYWxsYWJsZShjYik7XG5cblx0XHRsaXN0ID0ga2V5cyhvYmopO1xuXHRcdGlmIChjb21wYXJlRm4pIHtcblx0XHRcdGxpc3Quc29ydChpc0NhbGxhYmxlKGNvbXBhcmVGbikgPyBjb21wYXJlRm4uYmluZChvYmopIDogdW5kZWZpbmVkKTtcblx0XHR9XG5cdFx0cmV0dXJuIGxpc3RbbWV0aG9kXShmdW5jdGlvbiAoa2V5LCBpbmRleCkge1xuXHRcdFx0aWYgKCFwcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iaiwga2V5KSkgcmV0dXJuIGRlZlZhbDtcblx0XHRcdHJldHVybiBjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIG9ialtrZXldLCBrZXksIG9iaiwgaW5kZXgpO1xuXHRcdH0pO1xuXHR9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5hc3NpZ25cblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBhc3NpZ24gPSBPYmplY3QuYXNzaWduLCBvYmo7XG5cdGlmICh0eXBlb2YgYXNzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdG9iaiA9IHsgZm9vOiAncmF6JyB9O1xuXHRhc3NpZ24ob2JqLCB7IGJhcjogJ2R3YScgfSwgeyB0cnp5OiAndHJ6eScgfSk7XG5cdHJldHVybiAob2JqLmZvbyArIG9iai5iYXIgKyBvYmoudHJ6eSkgPT09ICdyYXpkd2F0cnp5Jztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzICA9IHJlcXVpcmUoJy4uL2tleXMnKVxuICAsIHZhbHVlID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRlc3QsIHNyYy8qLCDigKZzcmNuKi8pIHtcblx0dmFyIGVycm9yLCBpLCBsID0gbWF4KGFyZ3VtZW50cy5sZW5ndGgsIDIpLCBhc3NpZ247XG5cdGRlc3QgPSBPYmplY3QodmFsdWUoZGVzdCkpO1xuXHRhc3NpZ24gPSBmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dHJ5IHsgZGVzdFtrZXldID0gc3JjW2tleV07IH0gY2F0Y2ggKGUpIHtcblx0XHRcdGlmICghZXJyb3IpIGVycm9yID0gZTtcblx0XHR9XG5cdH07XG5cdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIHtcblx0XHRzcmMgPSBhcmd1bWVudHNbaV07XG5cdFx0a2V5cyhzcmMpLmZvckVhY2goYXNzaWduKTtcblx0fVxuXHRpZiAoZXJyb3IgIT09IHVuZGVmaW5lZCkgdGhyb3cgZXJyb3I7XG5cdHJldHVybiBkZXN0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiA9IHJlcXVpcmUoJy4vYXNzaWduJylcbiAgLCB2YWx1ZSAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuXHR2YXIgY29weSA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0aWYgKGNvcHkgIT09IG9iaikgcmV0dXJuIGNvcHk7XG5cdHJldHVybiBhc3NpZ24oe30sIG9iaik7XG59O1xuIiwiLy8gV29ya2Fyb3VuZCBmb3IgaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9MjgwNFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBzaGltO1xuXG5pZiAoIXJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZCcpKCkpIHtcblx0c2hpbSA9IHJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9zaGltJyk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIG51bGxPYmplY3QsIHByb3BzLCBkZXNjO1xuXHRpZiAoIXNoaW0pIHJldHVybiBjcmVhdGU7XG5cdGlmIChzaGltLmxldmVsICE9PSAxKSByZXR1cm4gY3JlYXRlO1xuXG5cdG51bGxPYmplY3QgPSB7fTtcblx0cHJvcHMgPSB7fTtcblx0ZGVzYyA9IHsgY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfTtcblx0T2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoT2JqZWN0LnByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuXHRcdGlmIChuYW1lID09PSAnX19wcm90b19fJykge1xuXHRcdFx0cHJvcHNbbmFtZV0gPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdFx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHByb3BzW25hbWVdID0gZGVzYztcblx0fSk7XG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKG51bGxPYmplY3QsIHByb3BzKTtcblxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoc2hpbSwgJ251bGxQb2x5ZmlsbCcsIHsgY29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IGZhbHNlLCB2YWx1ZTogbnVsbE9iamVjdCB9KTtcblxuXHRyZXR1cm4gZnVuY3Rpb24gKHByb3RvdHlwZSwgcHJvcHMpIHtcblx0XHRyZXR1cm4gY3JlYXRlKChwcm90b3R5cGUgPT09IG51bGwpID8gbnVsbE9iamVjdCA6IHByb3RvdHlwZSwgcHJvcHMpO1xuXHR9O1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL19pdGVyYXRlJykoJ2ZvckVhY2gnKTtcbiIsIi8vIERlcHJlY2F0ZWRcblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHsgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbic7IH07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBtYXAgPSB7IGZ1bmN0aW9uOiB0cnVlLCBvYmplY3Q6IHRydWUgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKCh4ICE9IG51bGwpICYmIG1hcFt0eXBlb2YgeF0pIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5rZXlzXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR0cnkge1xuXHRcdE9iamVjdC5rZXlzKCdwcmltaXRpdmUnKTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzID0gT2JqZWN0LmtleXM7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iamVjdCkge1xuXHRyZXR1cm4ga2V5cyhvYmplY3QgPT0gbnVsbCA/IG9iamVjdCA6IE9iamVjdChvYmplY3QpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjYWxsYWJsZSA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIGZvckVhY2ggID0gcmVxdWlyZSgnLi9mb3ItZWFjaCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZyovKSB7XG5cdHZhciBvID0ge30sIHRoaXNBcmcgPSBhcmd1bWVudHNbMl07XG5cdGNhbGxhYmxlKGNiKTtcblx0Zm9yRWFjaChvYmosIGZ1bmN0aW9uICh2YWx1ZSwga2V5LCBvYmosIGluZGV4KSB7XG5cdFx0b1trZXldID0gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwga2V5LCBvYmosIGluZGV4KTtcblx0fSk7XG5cdHJldHVybiBvO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZTtcblxudmFyIHByb2Nlc3MgPSBmdW5jdGlvbiAoc3JjLCBvYmopIHtcblx0dmFyIGtleTtcblx0Zm9yIChrZXkgaW4gc3JjKSBvYmpba2V5XSA9IHNyY1trZXldO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucy8qLCDigKZvcHRpb25zKi8pIHtcblx0dmFyIHJlc3VsdCA9IGNyZWF0ZShudWxsKTtcblx0Zm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24gKG9wdGlvbnMpIHtcblx0XHRpZiAob3B0aW9ucyA9PSBudWxsKSByZXR1cm47XG5cdFx0cHJvY2VzcyhPYmplY3Qob3B0aW9ucyksIHJlc3VsdCk7XG5cdH0pO1xuXHRyZXR1cm4gcmVzdWx0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXJnLyosIOKApmFyZ3MqLykge1xuXHR2YXIgc2V0ID0gY3JlYXRlKG51bGwpO1xuXHRmb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbiAobmFtZSkgeyBzZXRbbmFtZV0gPSB0cnVlOyB9KTtcblx0cmV0dXJuIHNldDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBPYmplY3Quc2V0UHJvdG90eXBlT2Zcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGdldFByb3RvdHlwZU9mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mXG4gICwgeCA9IHt9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgvKmN1c3RvbUNyZWF0ZSovKSB7XG5cdHZhciBzZXRQcm90b3R5cGVPZiA9IE9iamVjdC5zZXRQcm90b3R5cGVPZlxuXHQgICwgY3VzdG9tQ3JlYXRlID0gYXJndW1lbnRzWzBdIHx8IGNyZWF0ZTtcblx0aWYgKHR5cGVvZiBzZXRQcm90b3R5cGVPZiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gZ2V0UHJvdG90eXBlT2Yoc2V0UHJvdG90eXBlT2YoY3VzdG9tQ3JlYXRlKG51bGwpLCB4KSkgPT09IHg7XG59O1xuIiwiLy8gQmlnIHRoYW5rcyB0byBAV2ViUmVmbGVjdGlvbiBmb3Igc29ydGluZyB0aGlzIG91dFxuLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vV2ViUmVmbGVjdGlvbi81NTkzNTU0XG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGlzT2JqZWN0ICAgICAgPSByZXF1aXJlKCcuLi9pcy1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgPSByZXF1aXJlKCcuLi92YWxpZC12YWx1ZScpXG5cbiAgLCBpc1Byb3RvdHlwZU9mID0gT2JqZWN0LnByb3RvdHlwZS5pc1Byb3RvdHlwZU9mXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBudWxsRGVzYyA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUsXG5cdFx0dmFsdWU6IHVuZGVmaW5lZCB9XG4gICwgdmFsaWRhdGU7XG5cbnZhbGlkYXRlID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdHZhbHVlKG9iaik7XG5cdGlmICgocHJvdG90eXBlID09PSBudWxsKSB8fCBpc09iamVjdChwcm90b3R5cGUpKSByZXR1cm4gb2JqO1xuXHR0aHJvdyBuZXcgVHlwZUVycm9yKCdQcm90b3R5cGUgbXVzdCBiZSBudWxsIG9yIGFuIG9iamVjdCcpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKHN0YXR1cykge1xuXHR2YXIgZm4sIHNldDtcblx0aWYgKCFzdGF0dXMpIHJldHVybiBudWxsO1xuXHRpZiAoc3RhdHVzLmxldmVsID09PSAyKSB7XG5cdFx0aWYgKHN0YXR1cy5zZXQpIHtcblx0XHRcdHNldCA9IHN0YXR1cy5zZXQ7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHRzZXQuY2FsbCh2YWxpZGF0ZShvYmosIHByb3RvdHlwZSksIHByb3RvdHlwZSk7XG5cdFx0XHRcdHJldHVybiBvYmo7XG5cdFx0XHR9O1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmbiA9IGZ1bmN0aW9uIChvYmosIHByb3RvdHlwZSkge1xuXHRcdFx0XHR2YWxpZGF0ZShvYmosIHByb3RvdHlwZSkuX19wcm90b19fID0gcHJvdG90eXBlO1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0Zm4gPSBmdW5jdGlvbiBzZWxmKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHR2YXIgaXNOdWxsQmFzZTtcblx0XHRcdHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKTtcblx0XHRcdGlzTnVsbEJhc2UgPSBpc1Byb3RvdHlwZU9mLmNhbGwoc2VsZi5udWxsUG9seWZpbGwsIG9iaik7XG5cdFx0XHRpZiAoaXNOdWxsQmFzZSkgZGVsZXRlIHNlbGYubnVsbFBvbHlmaWxsLl9fcHJvdG9fXztcblx0XHRcdGlmIChwcm90b3R5cGUgPT09IG51bGwpIHByb3RvdHlwZSA9IHNlbGYubnVsbFBvbHlmaWxsO1xuXHRcdFx0b2JqLl9fcHJvdG9fXyA9IHByb3RvdHlwZTtcblx0XHRcdGlmIChpc051bGxCYXNlKSBkZWZpbmVQcm9wZXJ0eShzZWxmLm51bGxQb2x5ZmlsbCwgJ19fcHJvdG9fXycsIG51bGxEZXNjKTtcblx0XHRcdHJldHVybiBvYmo7XG5cdFx0fTtcblx0fVxuXHRyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGZuLCAnbGV2ZWwnLCB7IGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0ZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiBmYWxzZSwgdmFsdWU6IHN0YXR1cy5sZXZlbCB9KTtcbn0oKGZ1bmN0aW9uICgpIHtcblx0dmFyIHggPSBPYmplY3QuY3JlYXRlKG51bGwpLCB5ID0ge30sIHNldFxuXHQgICwgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoT2JqZWN0LnByb3RvdHlwZSwgJ19fcHJvdG9fXycpO1xuXG5cdGlmIChkZXNjKSB7XG5cdFx0dHJ5IHtcblx0XHRcdHNldCA9IGRlc2Muc2V0OyAvLyBPcGVyYSBjcmFzaGVzIGF0IHRoaXMgcG9pbnRcblx0XHRcdHNldC5jYWxsKHgsIHkpO1xuXHRcdH0gY2F0Y2ggKGlnbm9yZSkgeyB9XG5cdFx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgc2V0OiBzZXQsIGxldmVsOiAyIH07XG5cdH1cblxuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAyIH07XG5cblx0eCA9IHt9O1xuXHR4Ll9fcHJvdG9fXyA9IHk7XG5cdGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YoeCkgPT09IHkpIHJldHVybiB7IGxldmVsOiAxIH07XG5cblx0cmV0dXJuIGZhbHNlO1xufSgpKSkpO1xuXG5yZXF1aXJlKCcuLi9jcmVhdGUnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZm4pIHtcblx0aWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IFR5cGVFcnJvcihmbiArIFwiIGlzIG5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRyZXR1cm4gZm47XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB1c2UgbnVsbCBvciB1bmRlZmluZWRcIik7XG5cdHJldHVybiB2YWx1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKClcblx0PyBTdHJpbmcucHJvdG90eXBlLmNvbnRhaW5zXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzdHIgPSAncmF6ZHdhdHJ6eSc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHRpZiAodHlwZW9mIHN0ci5jb250YWlucyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKChzdHIuY29udGFpbnMoJ2R3YScpID09PSB0cnVlKSAmJiAoc3RyLmNvbnRhaW5zKCdmb28nKSA9PT0gZmFsc2UpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpbmRleE9mID0gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hTdHJpbmcvKiwgcG9zaXRpb24qLykge1xuXHRyZXR1cm4gaW5kZXhPZi5jYWxsKHRoaXMsIHNlYXJjaFN0cmluZywgYXJndW1lbnRzWzFdKSA+IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZ1xuXG4gICwgaWQgPSB0b1N0cmluZy5jYWxsKCcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKHR5cGVvZiB4ID09PSAnc3RyaW5nJykgfHwgKHggJiYgKHR5cGVvZiB4ID09PSAnb2JqZWN0JykgJiZcblx0XHQoKHggaW5zdGFuY2VvZiBTdHJpbmcpIHx8ICh0b1N0cmluZy5jYWxsKHgpID09PSBpZCkpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNvbnRhaW5zICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG4gICwgZCAgICAgICAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgQXJyYXlJdGVyYXRvcjtcblxuQXJyYXlJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFyciwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgQXJyYXlJdGVyYXRvcikpIHJldHVybiBuZXcgQXJyYXlJdGVyYXRvcihhcnIsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIGFycik7XG5cdGlmICgha2luZCkga2luZCA9ICd2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleSt2YWx1ZScpKSBraW5kID0gJ2tleSt2YWx1ZSc7XG5cdGVsc2UgaWYgKGNvbnRhaW5zLmNhbGwoa2luZCwgJ2tleScpKSBraW5kID0gJ2tleSc7XG5cdGVsc2Uga2luZCA9ICd2YWx1ZSc7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2tpbmRfXycsIGQoJycsIGtpbmQpKTtcbn07XG5pZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKEFycmF5SXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuQXJyYXlJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChBcnJheUl0ZXJhdG9yKSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ3ZhbHVlJykgcmV0dXJuIHRoaXMuX19saXN0X19baV07XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICdrZXkrdmFsdWUnKSByZXR1cm4gW2ksIHRoaXMuX19saXN0X19baV1dO1xuXHRcdHJldHVybiBpO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgQXJyYXkgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FsbGFibGUgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgaXNTdHJpbmcgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGdldCAgICAgID0gcmVxdWlyZSgnLi9nZXQnKVxuXG4gICwgaXNBcnJheSA9IEFycmF5LmlzQXJyYXksIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoaXRlcmFibGUsIGNiLyosIHRoaXNBcmcqLykge1xuXHR2YXIgbW9kZSwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgcmVzdWx0LCBkb0JyZWFrLCBicm9rZW4sIGksIGwsIGNoYXIsIGNvZGU7XG5cdGlmIChpc0FycmF5KGl0ZXJhYmxlKSkgbW9kZSA9ICdhcnJheSc7XG5cdGVsc2UgaWYgKGlzU3RyaW5nKGl0ZXJhYmxlKSkgbW9kZSA9ICdzdHJpbmcnO1xuXHRlbHNlIGl0ZXJhYmxlID0gZ2V0KGl0ZXJhYmxlKTtcblxuXHRjYWxsYWJsZShjYik7XG5cdGRvQnJlYWsgPSBmdW5jdGlvbiAoKSB7IGJyb2tlbiA9IHRydWU7IH07XG5cdGlmIChtb2RlID09PSAnYXJyYXknKSB7XG5cdFx0aXRlcmFibGUuc29tZShmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgdmFsdWUsIGRvQnJlYWspO1xuXHRcdFx0aWYgKGJyb2tlbikgcmV0dXJuIHRydWU7XG5cdFx0fSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cdGlmIChtb2RlID09PSAnc3RyaW5nJykge1xuXHRcdGwgPSBpdGVyYWJsZS5sZW5ndGg7XG5cdFx0Zm9yIChpID0gMDsgaSA8IGw7ICsraSkge1xuXHRcdFx0Y2hhciA9IGl0ZXJhYmxlW2ldO1xuXHRcdFx0aWYgKChpICsgMSkgPCBsKSB7XG5cdFx0XHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0XHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIGNoYXIgKz0gaXRlcmFibGVbKytpXTtcblx0XHRcdH1cblx0XHRcdGNhbGwuY2FsbChjYiwgdGhpc0FyZywgY2hhciwgZG9CcmVhayk7XG5cdFx0XHRpZiAoYnJva2VuKSBicmVhaztcblx0XHR9XG5cdFx0cmV0dXJuO1xuXHR9XG5cdHJlc3VsdCA9IGl0ZXJhYmxlLm5leHQoKTtcblxuXHR3aGlsZSAoIXJlc3VsdC5kb25lKSB7XG5cdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCByZXN1bHQudmFsdWUsIGRvQnJlYWspO1xuXHRcdGlmIChicm9rZW4pIHJldHVybjtcblx0XHRyZXN1bHQgPSBpdGVyYWJsZS5uZXh0KCk7XG5cdH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N0cmluZyA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgQXJyYXlJdGVyYXRvciAgPSByZXF1aXJlKCcuL2FycmF5JylcbiAgLCBTdHJpbmdJdGVyYXRvciA9IHJlcXVpcmUoJy4vc3RyaW5nJylcbiAgLCBpdGVyYWJsZSAgICAgICA9IHJlcXVpcmUoJy4vdmFsaWQtaXRlcmFibGUnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcblx0aWYgKHR5cGVvZiBpdGVyYWJsZShvYmopW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG9ialtpdGVyYXRvclN5bWJvbF0oKTtcblx0aWYgKGlzU3RyaW5nKG9iaikpIHJldHVybiBuZXcgU3RyaW5nSXRlcmF0b3Iob2JqKTtcblx0cmV0dXJuIG5ldyBBcnJheUl0ZXJhdG9yKG9iaik7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xlYXIgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvY2xlYXInKVxuICAsIGFzc2lnbiAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvYXNzaWduJylcbiAgLCBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCBkICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGF1dG9CaW5kID0gcmVxdWlyZSgnZC9hdXRvLWJpbmQnKVxuICAsIFN5bWJvbCAgID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIEl0ZXJhdG9yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEl0ZXJhdG9yID0gZnVuY3Rpb24gKGxpc3QsIGNvbnRleHQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBJdGVyYXRvcihsaXN0LCBjb250ZXh0KTtcblx0ZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG5cdFx0X19saXN0X186IGQoJ3cnLCB2YWx1ZShsaXN0KSksXG5cdFx0X19jb250ZXh0X186IGQoJ3cnLCBjb250ZXh0KSxcblx0XHRfX25leHRJbmRleF9fOiBkKCd3JywgMClcblx0fSk7XG5cdGlmICghY29udGV4dCkgcmV0dXJuO1xuXHRjYWxsYWJsZShjb250ZXh0Lm9uKTtcblx0Y29udGV4dC5vbignX2FkZCcsIHRoaXMuX29uQWRkKTtcblx0Y29udGV4dC5vbignX2RlbGV0ZScsIHRoaXMuX29uRGVsZXRlKTtcblx0Y29udGV4dC5vbignX2NsZWFyJywgdGhpcy5fb25DbGVhcik7XG59O1xuXG5kZWZpbmVQcm9wZXJ0aWVzKEl0ZXJhdG9yLnByb3RvdHlwZSwgYXNzaWduKHtcblx0Y29uc3RydWN0b3I6IGQoSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dmFyIGk7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIHtcblx0XHRcdGkgPSB0aGlzLl9fcmVkb19fLnNoaWZ0KCk7XG5cdFx0XHRpZiAoaSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gaTtcblx0XHR9XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19saXN0X18ubGVuZ3RoKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRuZXh0OiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX2NyZWF0ZVJlc3VsdCh0aGlzLl9uZXh0KCkpOyB9KSxcblx0X2NyZWF0ZVJlc3VsdDogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmIChpID09PSB1bmRlZmluZWQpIHJldHVybiB7IGRvbmU6IHRydWUsIHZhbHVlOiB1bmRlZmluZWQgfTtcblx0XHRyZXR1cm4geyBkb25lOiBmYWxzZSwgdmFsdWU6IHRoaXMuX3Jlc29sdmUoaSkgfTtcblx0fSksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7IHJldHVybiB0aGlzLl9fbGlzdF9fW2ldOyB9KSxcblx0X3VuQmluZDogZChmdW5jdGlvbiAoKSB7XG5cdFx0dGhpcy5fX2xpc3RfXyA9IG51bGw7XG5cdFx0ZGVsZXRlIHRoaXMuX19yZWRvX187XG5cdFx0aWYgKCF0aGlzLl9fY29udGV4dF9fKSByZXR1cm47XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19hZGQnLCB0aGlzLl9vbkFkZCk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19kZWxldGUnLCB0aGlzLl9vbkRlbGV0ZSk7XG5cdFx0dGhpcy5fX2NvbnRleHRfXy5vZmYoJ19jbGVhcicsIHRoaXMuX29uQ2xlYXIpO1xuXHRcdHRoaXMuX19jb250ZXh0X18gPSBudWxsO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgSXRlcmF0b3JdJzsgfSlcbn0sIGF1dG9CaW5kKHtcblx0X29uQWRkOiBkKGZ1bmN0aW9uIChpbmRleCkge1xuXHRcdGlmIChpbmRleCA+PSB0aGlzLl9fbmV4dEluZGV4X18pIHJldHVybjtcblx0XHQrK3RoaXMuX19uZXh0SW5kZXhfXztcblx0XHRpZiAoIXRoaXMuX19yZWRvX18pIHtcblx0XHRcdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX3JlZG9fXycsIGQoJ2MnLCBbaW5kZXhdKSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuX19yZWRvX18uZm9yRWFjaChmdW5jdGlvbiAocmVkbywgaSkge1xuXHRcdFx0aWYgKHJlZG8gPj0gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSArK3JlZG87XG5cdFx0fSwgdGhpcyk7XG5cdFx0dGhpcy5fX3JlZG9fXy5wdXNoKGluZGV4KTtcblx0fSksXG5cdF9vbkRlbGV0ZTogZChmdW5jdGlvbiAoaW5kZXgpIHtcblx0XHR2YXIgaTtcblx0XHRpZiAoaW5kZXggPj0gdGhpcy5fX25leHRJbmRleF9fKSByZXR1cm47XG5cdFx0LS10aGlzLl9fbmV4dEluZGV4X187XG5cdFx0aWYgKCF0aGlzLl9fcmVkb19fKSByZXR1cm47XG5cdFx0aSA9IHRoaXMuX19yZWRvX18uaW5kZXhPZihpbmRleCk7XG5cdFx0aWYgKGkgIT09IC0xKSB0aGlzLl9fcmVkb19fLnNwbGljZShpLCAxKTtcblx0XHR0aGlzLl9fcmVkb19fLmZvckVhY2goZnVuY3Rpb24gKHJlZG8sIGkpIHtcblx0XHRcdGlmIChyZWRvID4gaW5kZXgpIHRoaXMuX19yZWRvX19baV0gPSAtLXJlZG87XG5cdFx0fSwgdGhpcyk7XG5cdH0pLFxuXHRfb25DbGVhcjogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKHRoaXMuX19yZWRvX18pIGNsZWFyLmNhbGwodGhpcy5fX3JlZG9fXyk7XG5cdFx0dGhpcy5fX25leHRJbmRleF9fID0gMDtcblx0fSlcbn0pKSk7XG5cbmRlZmluZVByb3BlcnR5KEl0ZXJhdG9yLnByb3RvdHlwZSwgU3ltYm9sLml0ZXJhdG9yLCBkKGZ1bmN0aW9uICgpIHtcblx0cmV0dXJuIHRoaXM7XG59KSk7XG5kZWZpbmVQcm9wZXJ0eShJdGVyYXRvci5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnJywgJ0l0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTdHJpbmcgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy9pcy1zdHJpbmcnKVxuICAsIGl0ZXJhdG9yU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLml0ZXJhdG9yXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxzZTtcblx0aWYgKGlzQXJyYXkodmFsdWUpKSByZXR1cm4gdHJ1ZTtcblx0aWYgKGlzU3RyaW5nKHZhbHVlKSkgcmV0dXJuIHRydWU7XG5cdHJldHVybiAodHlwZW9mIHZhbHVlW2l0ZXJhdG9yU3ltYm9sXSA9PT0gJ2Z1bmN0aW9uJyk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gU3ltYm9sIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHR5cGVvZiBTeW1ib2wgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c3ltYm9sID0gU3ltYm9sKCd0ZXN0IHN5bWJvbCcpO1xuXHR0cnkgeyBTdHJpbmcoc3ltYm9sKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgPT09ICdzeW1ib2wnKSByZXR1cm4gdHJ1ZTtcblxuXHQvLyBSZXR1cm4gJ3RydWUnIGZvciBwb2x5ZmlsbHNcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNDb25jYXRTcHJlYWRhYmxlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9QcmltaXRpdmUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvU3RyaW5nVGFnICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC51bnNjb3BhYmxlcyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHgpIHtcblx0cmV0dXJuICh4ICYmICgodHlwZW9mIHggPT09ICdzeW1ib2wnKSB8fCAoeFsnQEB0b1N0cmluZ1RhZyddID09PSAnU3ltYm9sJykpKSB8fCBmYWxzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIHZhbGlkYXRlU3ltYm9sID0gcmVxdWlyZSgnLi92YWxpZGF0ZS1zeW1ib2wnKVxuXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksIG9ialByb3RvdHlwZSA9IE9iamVjdC5wcm90b3R5cGVcbiAgLCBTeW1ib2wsIEhpZGRlblN5bWJvbCwgZ2xvYmFsU3ltYm9scyA9IGNyZWF0ZShudWxsKTtcblxudmFyIGdlbmVyYXRlTmFtZSA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBjcmVhdGVkID0gY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKGRlc2MpIHtcblx0XHR2YXIgcG9zdGZpeCA9IDAsIG5hbWU7XG5cdFx0d2hpbGUgKGNyZWF0ZWRbZGVzYyArIChwb3N0Zml4IHx8ICcnKV0pICsrcG9zdGZpeDtcblx0XHRkZXNjICs9IChwb3N0Zml4IHx8ICcnKTtcblx0XHRjcmVhdGVkW2Rlc2NdID0gdHJ1ZTtcblx0XHRuYW1lID0gJ0BAJyArIGRlc2M7XG5cdFx0ZGVmaW5lUHJvcGVydHkob2JqUHJvdG90eXBlLCBuYW1lLCBkLmdzKG51bGwsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgbmFtZSwgZCh2YWx1ZSkpO1xuXHRcdH0pKTtcblx0XHRyZXR1cm4gbmFtZTtcblx0fTtcbn0oKSk7XG5cbkhpZGRlblN5bWJvbCA9IGZ1bmN0aW9uIFN5bWJvbChkZXNjcmlwdGlvbikge1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIEhpZGRlblN5bWJvbCkgdGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0cmV0dXJuIFN5bWJvbChkZXNjcmlwdGlvbik7XG59O1xubW9kdWxlLmV4cG9ydHMgPSBTeW1ib2wgPSBmdW5jdGlvbiBTeW1ib2woZGVzY3JpcHRpb24pIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBTeW1ib2wpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdHN5bWJvbCA9IGNyZWF0ZShIaWRkZW5TeW1ib2wucHJvdG90eXBlKTtcblx0ZGVzY3JpcHRpb24gPSAoZGVzY3JpcHRpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKGRlc2NyaXB0aW9uKSk7XG5cdHJldHVybiBkZWZpbmVQcm9wZXJ0aWVzKHN5bWJvbCwge1xuXHRcdF9fZGVzY3JpcHRpb25fXzogZCgnJywgZGVzY3JpcHRpb24pLFxuXHRcdF9fbmFtZV9fOiBkKCcnLCBnZW5lcmF0ZU5hbWUoZGVzY3JpcHRpb24pKVxuXHR9KTtcbn07XG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbCwge1xuXHRmb3I6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChnbG9iYWxTeW1ib2xzW2tleV0pIHJldHVybiBnbG9iYWxTeW1ib2xzW2tleV07XG5cdFx0cmV0dXJuIChnbG9iYWxTeW1ib2xzW2tleV0gPSBTeW1ib2woU3RyaW5nKGtleSkpKTtcblx0fSksXG5cdGtleUZvcjogZChmdW5jdGlvbiAocykge1xuXHRcdHZhciBrZXk7XG5cdFx0dmFsaWRhdGVTeW1ib2wocyk7XG5cdFx0Zm9yIChrZXkgaW4gZ2xvYmFsU3ltYm9scykgaWYgKGdsb2JhbFN5bWJvbHNba2V5XSA9PT0gcykgcmV0dXJuIGtleTtcblx0fSksXG5cdGhhc0luc3RhbmNlOiBkKCcnLCBTeW1ib2woJ2hhc0luc3RhbmNlJykpLFxuXHRpc0NvbmNhdFNwcmVhZGFibGU6IGQoJycsIFN5bWJvbCgnaXNDb25jYXRTcHJlYWRhYmxlJykpLFxuXHRpdGVyYXRvcjogZCgnJywgU3ltYm9sKCdpdGVyYXRvcicpKSxcblx0bWF0Y2g6IGQoJycsIFN5bWJvbCgnbWF0Y2gnKSksXG5cdHJlcGxhY2U6IGQoJycsIFN5bWJvbCgncmVwbGFjZScpKSxcblx0c2VhcmNoOiBkKCcnLCBTeW1ib2woJ3NlYXJjaCcpKSxcblx0c3BlY2llczogZCgnJywgU3ltYm9sKCdzcGVjaWVzJykpLFxuXHRzcGxpdDogZCgnJywgU3ltYm9sKCdzcGxpdCcpKSxcblx0dG9QcmltaXRpdmU6IGQoJycsIFN5bWJvbCgndG9QcmltaXRpdmUnKSksXG5cdHRvU3RyaW5nVGFnOiBkKCcnLCBTeW1ib2woJ3RvU3RyaW5nVGFnJykpLFxuXHR1bnNjb3BhYmxlczogZCgnJywgU3ltYm9sKCd1bnNjb3BhYmxlcycpKVxufSk7XG5kZWZpbmVQcm9wZXJ0aWVzKEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3ltYm9sKSxcblx0dG9TdHJpbmc6IGQoJycsIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19uYW1lX187IH0pXG59KTtcblxuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wucHJvdG90eXBlLCB7XG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdTeW1ib2wgKCcgKyB2YWxpZGF0ZVN5bWJvbCh0aGlzKS5fX2Rlc2NyaXB0aW9uX18gKyAnKSc7IH0pLFxuXHR2YWx1ZU9mOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KVxufSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsIGQoJycsXG5cdGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbGlkYXRlU3ltYm9sKHRoaXMpOyB9KSk7XG5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU3ltYm9sJykpO1xuXG5kZWZpbmVQcm9wZXJ0eShIaWRkZW5TeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsXG5cdGQoJ2MnLCBTeW1ib2wucHJvdG90eXBlW1N5bWJvbC50b1ByaW1pdGl2ZV0pKTtcbmRlZmluZVByb3BlcnR5KEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZyxcblx0ZCgnYycsIFN5bWJvbC5wcm90b3R5cGVbU3ltYm9sLnRvU3RyaW5nVGFnXSkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNTeW1ib2wgPSByZXF1aXJlKCcuL2lzLXN5bWJvbCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzU3ltYm9sKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBhIHN5bWJvbFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIi8vIFRoYW5rcyBAbWF0aGlhc2J5bmVuc1xuLy8gaHR0cDovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC11bmljb2RlI2l0ZXJhdGluZy1vdmVyLXN5bWJvbHNcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi8nKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTdHJpbmdJdGVyYXRvcjtcblxuU3RyaW5nSXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzdHIpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFN0cmluZ0l0ZXJhdG9yKSkgcmV0dXJuIG5ldyBTdHJpbmdJdGVyYXRvcihzdHIpO1xuXHRzdHIgPSBTdHJpbmcoc3RyKTtcblx0SXRlcmF0b3IuY2FsbCh0aGlzLCBzdHIpO1xuXHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX19sZW5ndGhfXycsIGQoJycsIHN0ci5sZW5ndGgpKTtcblxufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU3RyaW5nSXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuU3RyaW5nSXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU3RyaW5nSXRlcmF0b3IpLFxuXHRfbmV4dDogZChmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCF0aGlzLl9fbGlzdF9fKSByZXR1cm47XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA8IHRoaXMuX19sZW5ndGhfXykgcmV0dXJuIHRoaXMuX19uZXh0SW5kZXhfXysrO1xuXHRcdHRoaXMuX3VuQmluZCgpO1xuXHR9KSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHtcblx0XHR2YXIgY2hhciA9IHRoaXMuX19saXN0X19baV0sIGNvZGU7XG5cdFx0aWYgKHRoaXMuX19uZXh0SW5kZXhfXyA9PT0gdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gY2hhcjtcblx0XHRjb2RlID0gY2hhci5jaGFyQ29kZUF0KDApO1xuXHRcdGlmICgoY29kZSA+PSAweEQ4MDApICYmIChjb2RlIDw9IDB4REJGRikpIHJldHVybiBjaGFyICsgdGhpcy5fX2xpc3RfX1t0aGlzLl9fbmV4dEluZGV4X18rK107XG5cdFx0cmV0dXJuIGNoYXI7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBTdHJpbmcgSXRlcmF0b3JdJzsgfSlcbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNJdGVyYWJsZSA9IHJlcXVpcmUoJy4vaXMtaXRlcmFibGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKCFpc0l0ZXJhYmxlKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcih2YWx1ZSArIFwiIGlzIG5vdCBpdGVyYWJsZVwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/IFN5bWJvbCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBzeW1ib2w7XG5cdGlmICh0eXBlb2YgU3ltYm9sICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHN5bWJvbCA9IFN5bWJvbCgndGVzdCBzeW1ib2wnKTtcblx0dHJ5IHsgU3RyaW5nKHN5bWJvbCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSAnc3ltYm9sJykgcmV0dXJuIHRydWU7XG5cblx0Ly8gUmV0dXJuICd0cnVlJyBmb3IgcG9seWZpbGxzXG5cdGlmICh0eXBlb2YgU3ltYm9sLmlzQ29uY2F0U3ByZWFkYWJsZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNSZWdFeHAgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1ByaW1pdGl2ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9TdHJpbmdUYWcgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnVuc2NvcGFibGVzICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgPSByZXF1aXJlKCdkJylcblxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGdlbmVyYXRlTmFtZSwgU3ltYm9sO1xuXG5nZW5lcmF0ZU5hbWUgPSAoZnVuY3Rpb24gKCkge1xuXHR2YXIgY3JlYXRlZCA9IGNyZWF0ZShudWxsKTtcblx0cmV0dXJuIGZ1bmN0aW9uIChkZXNjKSB7XG5cdFx0dmFyIHBvc3RmaXggPSAwO1xuXHRcdHdoaWxlIChjcmVhdGVkW2Rlc2MgKyAocG9zdGZpeCB8fCAnJyldKSArK3Bvc3RmaXg7XG5cdFx0ZGVzYyArPSAocG9zdGZpeCB8fCAnJyk7XG5cdFx0Y3JlYXRlZFtkZXNjXSA9IHRydWU7XG5cdFx0cmV0dXJuICdAQCcgKyBkZXNjO1xuXHR9O1xufSgpKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW1ib2wgPSBmdW5jdGlvbiAoZGVzY3JpcHRpb24pIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHRoaXMgaW5zdGFuY2VvZiBTeW1ib2wpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHR9XG5cdHN5bWJvbCA9IGNyZWF0ZShTeW1ib2wucHJvdG90eXBlKTtcblx0ZGVzY3JpcHRpb24gPSAoZGVzY3JpcHRpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKGRlc2NyaXB0aW9uKSk7XG5cdHJldHVybiBkZWZpbmVQcm9wZXJ0aWVzKHN5bWJvbCwge1xuXHRcdF9fZGVzY3JpcHRpb25fXzogZCgnJywgZGVzY3JpcHRpb24pLFxuXHRcdF9fbmFtZV9fOiBkKCcnLCBnZW5lcmF0ZU5hbWUoZGVzY3JpcHRpb24pKVxuXHR9KTtcbn07XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbCwge1xuXHRjcmVhdGU6IGQoJycsIFN5bWJvbCgnY3JlYXRlJykpLFxuXHRoYXNJbnN0YW5jZTogZCgnJywgU3ltYm9sKCdoYXNJbnN0YW5jZScpKSxcblx0aXNDb25jYXRTcHJlYWRhYmxlOiBkKCcnLCBTeW1ib2woJ2lzQ29uY2F0U3ByZWFkYWJsZScpKSxcblx0aXNSZWdFeHA6IGQoJycsIFN5bWJvbCgnaXNSZWdFeHAnKSksXG5cdGl0ZXJhdG9yOiBkKCcnLCBTeW1ib2woJ2l0ZXJhdG9yJykpLFxuXHR0b1ByaW1pdGl2ZTogZCgnJywgU3ltYm9sKCd0b1ByaW1pdGl2ZScpKSxcblx0dG9TdHJpbmdUYWc6IGQoJycsIFN5bWJvbCgndG9TdHJpbmdUYWcnKSksXG5cdHVuc2NvcGFibGVzOiBkKCcnLCBTeW1ib2woJ3Vuc2NvcGFibGVzJykpXG59KTtcblxuZGVmaW5lUHJvcGVydGllcyhTeW1ib2wucHJvdG90eXBlLCB7XG5cdHByb3BlclRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRyZXR1cm4gJ1N5bWJvbCAoJyArIHRoaXMuX19kZXNjcmlwdGlvbl9fICsgJyknO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoJycsIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19uYW1lX187IH0pXG59KTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9QcmltaXRpdmUsIGQoJycsXG5cdGZ1bmN0aW9uIChoaW50KSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcihcIkNvbnZlcnNpb24gb2Ygc3ltYm9sIG9iamVjdHMgaXMgbm90IGFsbG93ZWRcIik7XG5cdH0pKTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShTeW1ib2wucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU3ltYm9sJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCAgICAgICAgPSByZXF1aXJlKCdkJylcbiAgLCBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcblxuICAsIGFwcGx5ID0gRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5LCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGxcbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIGRlZmluZVByb3BlcnRpZXMgPSBPYmplY3QuZGVmaW5lUHJvcGVydGllc1xuICAsIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eVxuICAsIGRlc2NyaXB0b3IgPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlIH1cblxuICAsIG9uLCBvbmNlLCBvZmYsIGVtaXQsIG1ldGhvZHMsIGRlc2NyaXB0b3JzLCBiYXNlO1xuXG5vbiA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgZGF0YTtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkge1xuXHRcdGRhdGEgPSBkZXNjcmlwdG9yLnZhbHVlID0gY3JlYXRlKG51bGwpO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2VlX18nLCBkZXNjcmlwdG9yKTtcblx0XHRkZXNjcmlwdG9yLnZhbHVlID0gbnVsbDtcblx0fSBlbHNlIHtcblx0XHRkYXRhID0gdGhpcy5fX2VlX187XG5cdH1cblx0aWYgKCFkYXRhW3R5cGVdKSBkYXRhW3R5cGVdID0gbGlzdGVuZXI7XG5cdGVsc2UgaWYgKHR5cGVvZiBkYXRhW3R5cGVdID09PSAnb2JqZWN0JykgZGF0YVt0eXBlXS5wdXNoKGxpc3RlbmVyKTtcblx0ZWxzZSBkYXRhW3R5cGVdID0gW2RhdGFbdHlwZV0sIGxpc3RlbmVyXTtcblxuXHRyZXR1cm4gdGhpcztcbn07XG5cbm9uY2UgPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIG9uY2UsIHNlbGY7XG5cblx0Y2FsbGFibGUobGlzdGVuZXIpO1xuXHRzZWxmID0gdGhpcztcblx0b24uY2FsbCh0aGlzLCB0eXBlLCBvbmNlID0gZnVuY3Rpb24gKCkge1xuXHRcdG9mZi5jYWxsKHNlbGYsIHR5cGUsIG9uY2UpO1xuXHRcdGFwcGx5LmNhbGwobGlzdGVuZXIsIHRoaXMsIGFyZ3VtZW50cyk7XG5cdH0pO1xuXG5cdG9uY2UuX19lZU9uY2VMaXN0ZW5lcl9fID0gbGlzdGVuZXI7XG5cdHJldHVybiB0aGlzO1xufTtcblxub2ZmID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBkYXRhLCBsaXN0ZW5lcnMsIGNhbmRpZGF0ZSwgaTtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkgcmV0dXJuIHRoaXM7XG5cdGRhdGEgPSB0aGlzLl9fZWVfXztcblx0aWYgKCFkYXRhW3R5cGVdKSByZXR1cm4gdGhpcztcblx0bGlzdGVuZXJzID0gZGF0YVt0eXBlXTtcblxuXHRpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ29iamVjdCcpIHtcblx0XHRmb3IgKGkgPSAwOyAoY2FuZGlkYXRlID0gbGlzdGVuZXJzW2ldKTsgKytpKSB7XG5cdFx0XHRpZiAoKGNhbmRpZGF0ZSA9PT0gbGlzdGVuZXIpIHx8XG5cdFx0XHRcdFx0KGNhbmRpZGF0ZS5fX2VlT25jZUxpc3RlbmVyX18gPT09IGxpc3RlbmVyKSkge1xuXHRcdFx0XHRpZiAobGlzdGVuZXJzLmxlbmd0aCA9PT0gMikgZGF0YVt0eXBlXSA9IGxpc3RlbmVyc1tpID8gMCA6IDFdO1xuXHRcdFx0XHRlbHNlIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGlmICgobGlzdGVuZXJzID09PSBsaXN0ZW5lcikgfHxcblx0XHRcdFx0KGxpc3RlbmVycy5fX2VlT25jZUxpc3RlbmVyX18gPT09IGxpc3RlbmVyKSkge1xuXHRcdFx0ZGVsZXRlIGRhdGFbdHlwZV07XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHRoaXM7XG59O1xuXG5lbWl0ID0gZnVuY3Rpb24gKHR5cGUpIHtcblx0dmFyIGksIGwsIGxpc3RlbmVyLCBsaXN0ZW5lcnMsIGFyZ3M7XG5cblx0aWYgKCFoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfX2VlX18nKSkgcmV0dXJuO1xuXHRsaXN0ZW5lcnMgPSB0aGlzLl9fZWVfX1t0eXBlXTtcblx0aWYgKCFsaXN0ZW5lcnMpIHJldHVybjtcblxuXHRpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ29iamVjdCcpIHtcblx0XHRsID0gYXJndW1lbnRzLmxlbmd0aDtcblx0XHRhcmdzID0gbmV3IEFycmF5KGwgLSAxKTtcblx0XHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuXHRcdGxpc3RlbmVycyA9IGxpc3RlbmVycy5zbGljZSgpO1xuXHRcdGZvciAoaSA9IDA7IChsaXN0ZW5lciA9IGxpc3RlbmVyc1tpXSk7ICsraSkge1xuXHRcdFx0YXBwbHkuY2FsbChsaXN0ZW5lciwgdGhpcywgYXJncyk7XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuXHRcdGNhc2UgMTpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMpO1xuXHRcdFx0YnJlYWs7XG5cdFx0Y2FzZSAyOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJndW1lbnRzWzFdKTtcblx0XHRcdGJyZWFrO1xuXHRcdGNhc2UgMzpcblx0XHRcdGNhbGwuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcblx0XHRcdGJyZWFrO1xuXHRcdGRlZmF1bHQ6XG5cdFx0XHRsID0gYXJndW1lbnRzLmxlbmd0aDtcblx0XHRcdGFyZ3MgPSBuZXcgQXJyYXkobCAtIDEpO1xuXHRcdFx0Zm9yIChpID0gMTsgaSA8IGw7ICsraSkge1xuXHRcdFx0XHRhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblx0XHRcdH1cblx0XHRcdGFwcGx5LmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmdzKTtcblx0XHR9XG5cdH1cbn07XG5cbm1ldGhvZHMgPSB7XG5cdG9uOiBvbixcblx0b25jZTogb25jZSxcblx0b2ZmOiBvZmYsXG5cdGVtaXQ6IGVtaXRcbn07XG5cbmRlc2NyaXB0b3JzID0ge1xuXHRvbjogZChvbiksXG5cdG9uY2U6IGQob25jZSksXG5cdG9mZjogZChvZmYpLFxuXHRlbWl0OiBkKGVtaXQpXG59O1xuXG5iYXNlID0gZGVmaW5lUHJvcGVydGllcyh7fSwgZGVzY3JpcHRvcnMpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBmdW5jdGlvbiAobykge1xuXHRyZXR1cm4gKG8gPT0gbnVsbCkgPyBjcmVhdGUoYmFzZSkgOiBkZWZpbmVQcm9wZXJ0aWVzKE9iamVjdChvKSwgZGVzY3JpcHRvcnMpO1xufTtcbmV4cG9ydHMubWV0aG9kcyA9IG1ldGhvZHM7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGVhciAgICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9jbGVhcicpXG4gICwgZUluZGV4T2YgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvZS1pbmRleC1vZicpXG4gICwgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjYWxsYWJsZSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWxpZFZhbHVlICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXZlbnQtZW1pdHRlcicpXG4gICwgU3ltYm9sICAgICAgICAgPSByZXF1aXJlKCdlczYtc3ltYm9sJylcbiAgLCBpdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZScpXG4gICwgZm9yT2YgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZm9yLW9mJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vbGliL2l0ZXJhdG9yJylcbiAgLCBpc05hdGl2ZSAgICAgICA9IHJlcXVpcmUoJy4vaXMtbmF0aXZlLWltcGxlbWVudGVkJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgTWFwUG9seTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYXBQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF0sIGtleXMsIHZhbHVlcztcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIE1hcFBvbHkpKSByZXR1cm4gbmV3IE1hcFBvbHkoaXRlcmFibGUpO1xuXHRpZiAodGhpcy5fX21hcEtleXNEYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSBpdGVyYXRvcihpdGVyYWJsZSk7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fbWFwS2V5c0RhdGFfXzogZCgnYycsIGtleXMgPSBbXSksXG5cdFx0X19tYXBWYWx1ZXNEYXRhX186IGQoJ2MnLCB2YWx1ZXMgPSBbXSlcblx0fSk7XG5cdGlmICghaXRlcmFibGUpIHJldHVybjtcblx0Zm9yT2YoaXRlcmFibGUsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdHZhciBrZXkgPSB2YWxpZFZhbHVlKHZhbHVlKVswXTtcblx0XHR2YWx1ZSA9IHZhbHVlWzFdO1xuXHRcdGlmIChlSW5kZXhPZi5jYWxsKGtleXMsIGtleSkgIT09IC0xKSByZXR1cm47XG5cdFx0a2V5cy5wdXNoKGtleSk7XG5cdFx0dmFsdWVzLnB1c2godmFsdWUpO1xuXHR9LCB0aGlzKTtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKE1hcFBvbHksIE1hcCk7XG5cdE1hcFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShNYXAucHJvdG90eXBlLCB7XG5cdFx0Y29uc3RydWN0b3I6IGQoTWFwUG9seSlcblx0fSk7XG59XG5cbmVlKGRlZmluZVByb3BlcnRpZXMoTWFwUG9seS5wcm90b3R5cGUsIHtcblx0Y2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICghdGhpcy5fX21hcEtleXNEYXRhX18ubGVuZ3RoKSByZXR1cm47XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXyk7XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fbWFwVmFsdWVzRGF0YV9fKTtcblx0XHR0aGlzLmVtaXQoJ19jbGVhcicpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHR2YXIgaW5kZXggPSBlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpO1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHJldHVybiBmYWxzZTtcblx0XHR0aGlzLl9fbWFwS2V5c0RhdGFfXy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdHRoaXMuX19tYXBWYWx1ZXNEYXRhX18uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR0aGlzLmVtaXQoJ19kZWxldGUnLCBpbmRleCwga2V5KTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSksXG5cdGVudHJpZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXkrdmFsdWUnKTsgfSksXG5cdGZvckVhY2g6IGQoZnVuY3Rpb24gKGNiLyosIHRoaXNBcmcqLykge1xuXHRcdHZhciB0aGlzQXJnID0gYXJndW1lbnRzWzFdLCBpdGVyYXRvciwgcmVzdWx0O1xuXHRcdGNhbGxhYmxlKGNiKTtcblx0XHRpdGVyYXRvciA9IHRoaXMuZW50cmllcygpO1xuXHRcdHJlc3VsdCA9IGl0ZXJhdG9yLl9uZXh0KCk7XG5cdFx0d2hpbGUgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHRoaXMuX19tYXBWYWx1ZXNEYXRhX19bcmVzdWx0XSxcblx0XHRcdFx0dGhpcy5fX21hcEtleXNEYXRhX19bcmVzdWx0XSwgdGhpcyk7XG5cdFx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdH1cblx0fSksXG5cdGdldDogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dmFyIGluZGV4ID0gZUluZGV4T2YuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXywga2V5KTtcblx0XHRpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XG5cdFx0cmV0dXJuIHRoaXMuX19tYXBWYWx1ZXNEYXRhX19baW5kZXhdO1xuXHR9KSxcblx0aGFzOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRyZXR1cm4gKGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSkgIT09IC0xKTtcblx0fSksXG5cdGtleXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXknKTsgfSksXG5cdHNldDogZChmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSksIGVtaXQ7XG5cdFx0aWYgKGluZGV4ID09PSAtMSkge1xuXHRcdFx0aW5kZXggPSB0aGlzLl9fbWFwS2V5c0RhdGFfXy5wdXNoKGtleSkgLSAxO1xuXHRcdFx0ZW1pdCA9IHRydWU7XG5cdFx0fVxuXHRcdHRoaXMuX19tYXBWYWx1ZXNEYXRhX19baW5kZXhdID0gdmFsdWU7XG5cdFx0aWYgKGVtaXQpIHRoaXMuZW1pdCgnX2FkZCcsIGluZGV4LCBrZXkpO1xuXHRcdHJldHVybiB0aGlzO1xuXHR9KSxcblx0c2l6ZTogZC5ncyhmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbWFwS2V5c0RhdGFfXy5sZW5ndGg7IH0pLFxuXHR2YWx1ZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICd2YWx1ZScpOyB9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgTWFwXSc7IH0pXG59KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoTWFwUG9seS5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChmdW5jdGlvbiAoKSB7XG5cdHJldHVybiB0aGlzLmVudHJpZXMoKTtcbn0pKTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShNYXBQb2x5LnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ01hcCcpKTtcbiIsImZ1bmN0aW9uIGZsYXRNZXJnZShhLGIpe1xuICAgIGlmKCFiIHx8IHR5cGVvZiBiICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGIgPSB7fTtcbiAgICB9XG5cbiAgICBpZighYSB8fCB0eXBlb2YgYSAhPT0gJ29iamVjdCcpe1xuICAgICAgICBhID0gbmV3IGIuY29uc3RydWN0b3IoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gbmV3IGEuY29uc3RydWN0b3IoKSxcbiAgICAgICAgYUtleXMgPSBPYmplY3Qua2V5cyhhKSxcbiAgICAgICAgYktleXMgPSBPYmplY3Qua2V5cyhiKTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFthS2V5c1tpXV0gPSBhW2FLZXlzW2ldXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYktleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYktleXNbaV1dID0gYltiS2V5c1tpXV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmbGF0TWVyZ2U7IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc1NhbWUoYSwgYil7XG4gICAgaWYoYSA9PT0gYil7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGlmKFxuICAgICAgICB0eXBlb2YgYSAhPT0gdHlwZW9mIGIgfHwgXG4gICAgICAgIHR5cGVvZiBhID09PSAnb2JqZWN0JyAmJiBcbiAgICAgICAgIShhIGluc3RhbmNlb2YgRGF0ZSAmJiBiIGluc3RhbmNlb2YgRGF0ZSlcbiAgICApe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIGEgKyAnJyA9PT0gYiArICcnO1xufTsiLCJ2YXIgdW5zdXBwb3J0ZWRUeXBlcyA9IFsnbnVtYmVyJywgJ2VtYWlsJywgJ3RpbWUnLCAnY29sb3InLCAnbW9udGgnLCAncmFuZ2UnLCAnZGF0ZSddO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcbiAgICB2YXIgY2FuU2V0ID0gZWxlbWVudC5zZXRTZWxlY3Rpb25SYW5nZSAmJlxuICAgICAgICAgICAgICAgICF+dW5zdXBwb3J0ZWRUeXBlcy5pbmRleE9mKGVsZW1lbnQudHlwZSkgJiZcbiAgICAgICAgICAgICAgICBlbGVtZW50ID09PSBkb2N1bWVudC5hY3RpdmVFbGVtZW50O1xuXG4gICAgaWYgKGNhblNldCkge1xuICAgICAgICB2YXIgc3RhcnQgPSBlbGVtZW50LnNlbGVjdGlvblN0YXJ0LFxuICAgICAgICAgICAgZW5kID0gZWxlbWVudC5zZWxlY3Rpb25FbmQ7XG5cbiAgICAgICAgZWxlbWVudC52YWx1ZSA9IHZhbHVlO1xuICAgICAgICBlbGVtZW50LnNldFNlbGVjdGlvblJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGVsZW1lbnQudmFsdWUgPSB2YWx1ZTtcbiAgICB9XG59OyIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG5mdW5jdGlvbiBrZXlzQXJlRGlmZmVyZW50KGtleXMxLCBrZXlzMil7XG4gICAgaWYoa2V5czEgPT09IGtleXMyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZigha2V5czEgfHwgIWtleXMyIHx8IGtleXMxLmxlbmd0aCAhPT0ga2V5czIubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzMS5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKCF+a2V5czIuaW5kZXhPZihrZXlzMVtpXSkpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSl7XG4gICAgICAgIHJlc3VsdC50eXBlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ2tleXMnIGluIGNoYW5nZXNUb1RyYWNrICYmIGtleXNBcmVEaWZmZXJlbnQodGhpcy5fbGFzdEtleXMsIGdldEtleXModmFsdWUpKSl7XG4gICAgICAgIHJlc3VsdC5rZXlzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKXtcbiAgICAgICAgdmFyIGxhc3RWYWx1ZSA9IHRoaXMuX2xhc3RWYWx1ZTtcblxuICAgICAgICBpZignc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgKCFsYXN0VmFsdWUgfHwgdHlwZW9mIGxhc3RWYWx1ZSAhPT0gJ29iamVjdCcgfHwgT2JqZWN0LmtleXModmFsdWUpLnNvbWUoZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWVba2V5W2luZGV4XV0gIT09IGxhc3RWYWx1ZVtrZXlbaW5kZXhdXTtcbiAgICAgICAgfSkpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zaGFsbG93U3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZignc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiAhZGVlcEVxdWFsKHZhbHVlLCBsYXN0VmFsdWUpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdyZWZlcmVuY2UnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKXtcbiAgICAgICAgICAgIHJlc3VsdC5yZWZlcmVuY2UgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbGFzdFZhbHVlID0gJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSkgOiAnc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSwgdHJ1ZSwgMSk6IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RSZWZlcmVuY2UgPSB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0S2V5cyA9IG5ld0tleXM7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaGF0Q2hhbmdlZDsiLCIoZnVuY3Rpb24gKEJ1ZmZlcil7XG52YXIgY2xvbmUgPSAoZnVuY3Rpb24oKSB7XG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQ2xvbmVzIChjb3BpZXMpIGFuIE9iamVjdCB1c2luZyBkZWVwIGNvcHlpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBzdXBwb3J0cyBjaXJjdWxhciByZWZlcmVuY2VzIGJ5IGRlZmF1bHQsIGJ1dCBpZiB5b3UgYXJlIGNlcnRhaW5cbiAqIHRoZXJlIGFyZSBubyBjaXJjdWxhciByZWZlcmVuY2VzIGluIHlvdXIgb2JqZWN0LCB5b3UgY2FuIHNhdmUgc29tZSBDUFUgdGltZVxuICogYnkgY2FsbGluZyBjbG9uZShvYmosIGZhbHNlKS5cbiAqXG4gKiBDYXV0aW9uOiBpZiBgY2lyY3VsYXJgIGlzIGZhbHNlIGFuZCBgcGFyZW50YCBjb250YWlucyBjaXJjdWxhciByZWZlcmVuY2VzLFxuICogeW91ciBwcm9ncmFtIG1heSBlbnRlciBhbiBpbmZpbml0ZSBsb29wIGFuZCBjcmFzaC5cbiAqXG4gKiBAcGFyYW0gYHBhcmVudGAgLSB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZFxuICogQHBhcmFtIGBjaXJjdWxhcmAgLSBzZXQgdG8gdHJ1ZSBpZiB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZCBtYXkgY29udGFpblxuICogICAgY2lyY3VsYXIgcmVmZXJlbmNlcy4gKG9wdGlvbmFsIC0gdHJ1ZSBieSBkZWZhdWx0KVxuICogQHBhcmFtIGBkZXB0aGAgLSBzZXQgdG8gYSBudW1iZXIgaWYgdGhlIG9iamVjdCBpcyBvbmx5IHRvIGJlIGNsb25lZCB0b1xuICogICAgYSBwYXJ0aWN1bGFyIGRlcHRoLiAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBJbmZpbml0eSlcbiAqIEBwYXJhbSBgcHJvdG90eXBlYCAtIHNldHMgdGhlIHByb3RvdHlwZSB0byBiZSB1c2VkIHdoZW4gY2xvbmluZyBhbiBvYmplY3QuXG4gKiAgICAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBwYXJlbnQgcHJvdG90eXBlKS5cbiovXG5mdW5jdGlvbiBjbG9uZShwYXJlbnQsIGNpcmN1bGFyLCBkZXB0aCwgcHJvdG90eXBlKSB7XG4gIHZhciBmaWx0ZXI7XG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT09ICdvYmplY3QnKSB7XG4gICAgZGVwdGggPSBjaXJjdWxhci5kZXB0aDtcbiAgICBwcm90b3R5cGUgPSBjaXJjdWxhci5wcm90b3R5cGU7XG4gICAgZmlsdGVyID0gY2lyY3VsYXIuZmlsdGVyO1xuICAgIGNpcmN1bGFyID0gY2lyY3VsYXIuY2lyY3VsYXJcbiAgfVxuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAoY2xvbmUuX19pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCBfX2dldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbiBjbG9uZVByb3RvdHlwZShwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG4vLyBwcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG5cbmZ1bmN0aW9uIF9fb2JqVG9TdHIobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufTtcbmNsb25lLl9fb2JqVG9TdHIgPSBfX29ialRvU3RyO1xuXG5mdW5jdGlvbiBfX2lzRGF0ZShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgRGF0ZV0nO1xufTtcbmNsb25lLl9faXNEYXRlID0gX19pc0RhdGU7XG5cbmZ1bmN0aW9uIF9faXNBcnJheShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5jbG9uZS5fX2lzQXJyYXkgPSBfX2lzQXJyYXk7XG5cbmZ1bmN0aW9uIF9faXNSZWdFeHAobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufTtcbmNsb25lLl9faXNSZWdFeHAgPSBfX2lzUmVnRXhwO1xuXG5mdW5jdGlvbiBfX2dldFJlZ0V4cEZsYWdzKHJlKSB7XG4gIHZhciBmbGFncyA9ICcnO1xuICBpZiAocmUuZ2xvYmFsKSBmbGFncyArPSAnZyc7XG4gIGlmIChyZS5pZ25vcmVDYXNlKSBmbGFncyArPSAnaSc7XG4gIGlmIChyZS5tdWx0aWxpbmUpIGZsYWdzICs9ICdtJztcbiAgcmV0dXJuIGZsYWdzO1xufTtcbmNsb25lLl9fZ2V0UmVnRXhwRmxhZ3MgPSBfX2dldFJlZ0V4cEZsYWdzO1xuXG5yZXR1cm4gY2xvbmU7XG59KSgpO1xuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcbn1cblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyKSIsInZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgb2JqZWN0S2V5cyA9IHJlcXVpcmUoJy4vbGliL2tleXMuanMnKTtcbnZhciBpc0FyZ3VtZW50cyA9IHJlcXVpcmUoJy4vbGliL2lzX2FyZ3VtZW50cy5qcycpO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgb3B0cykge1xuICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9wdHMuc3RyaWN0ID8gYWN0dWFsID09PSBleHBlY3RlZCA6IGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCwgb3B0cyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyICh4KSB7XG4gIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHgubGVuZ3RoICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHguY29weSAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgeC5zbGljZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoeC5sZW5ndGggPiAwICYmIHR5cGVvZiB4WzBdICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYiwgb3B0cykge1xuICB2YXIgaSwga2V5O1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG9wdHMpO1xuICB9XG4gIGlmIChpc0J1ZmZlcihhKSkge1xuICAgIGlmICghaXNCdWZmZXIoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYVtpXSAhPT0gYltpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0cnkge1xuICAgIHZhciBrYSA9IG9iamVjdEtleXMoYSksXG4gICAgICAgIGtiID0gb2JqZWN0S2V5cyhiKTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBvcHRzKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0eXBlb2YgYSA9PT0gdHlwZW9mIGI7XG59XG4iLCJ2YXIgc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA9IChmdW5jdGlvbigpe1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZ3VtZW50cylcbn0pKCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPyBzdXBwb3J0ZWQgOiB1bnN1cHBvcnRlZDtcblxuZXhwb3J0cy5zdXBwb3J0ZWQgPSBzdXBwb3J0ZWQ7XG5mdW5jdGlvbiBzdXBwb3J0ZWQob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn07XG5cbmV4cG9ydHMudW5zdXBwb3J0ZWQgPSB1bnN1cHBvcnRlZDtcbmZ1bmN0aW9uIHVuc3VwcG9ydGVkKG9iamVjdCl7XG4gIHJldHVybiBvYmplY3QgJiZcbiAgICB0eXBlb2Ygb2JqZWN0ID09ICdvYmplY3QnICYmXG4gICAgdHlwZW9mIG9iamVjdC5sZW5ndGggPT0gJ251bWJlcicgJiZcbiAgICBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2FsbGVlJykgJiZcbiAgICAhT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpIHx8XG4gICAgZmFsc2U7XG59O1xuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gID8gT2JqZWN0LmtleXMgOiBzaGltO1xuXG5leHBvcnRzLnNoaW0gPSBzaGltO1xuZnVuY3Rpb24gc2hpbSAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIGtleXMucHVzaChrZXkpO1xuICByZXR1cm4ga2V5cztcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIFdoYXRDaGFuZ2VkID0gcmVxdWlyZSgnd2hhdC1jaGFuZ2VkJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBjcmVhdGVCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyksXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlciA9IHJlcXVpcmUoJy4vbWFrZUZ1bmN0aW9uRW1pdHRlcicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0eShjdXJyZW50VmFsdWUsIGNoYW5nZXMsIHVwZGF0ZXIpe1xuICAgIGlmKHR5cGVvZiBjaGFuZ2VzID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgdXBkYXRlciA9IGNoYW5nZXM7XG4gICAgICAgIGNoYW5nZXMgPSBudWxsO1xuICAgIH1cblxuICAgIHZhciBiaW5kaW5nLFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgYXR0YWNoQ2hhbmdlLFxuICAgICAgICBwcmV2aW91cyA9IG5ldyBXaGF0Q2hhbmdlZChjdXJyZW50VmFsdWUsIGNoYW5nZXMgfHwgJ3ZhbHVlIHR5cGUgcmVmZXJlbmNlIGtleXMnKTtcblxuICAgIGZ1bmN0aW9uIHByb3BlcnR5KHZhbHVlKXtcbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmcgJiYgYmluZGluZygpIHx8IHByb3BlcnR5Ll92YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcblxuICAgICAgICAgICAgaWYoIU9iamVjdC5rZXlzKHByZXZpb3VzLnVwZGF0ZSh2YWx1ZSkpLmxlbmd0aCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9wZXJ0eS5fdmFsdWUgPSB2YWx1ZTtcblxuICAgICAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICAgICAgYmluZGluZyh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkuX3ZhbHVlID0gYmluZGluZygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5lbWl0KCdjaGFuZ2UnLCBwcm9wZXJ0eS5fdmFsdWUpO1xuICAgICAgICAgICAgcHJvcGVydHkudXBkYXRlKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgfVxuXG4gICAgcHJvcGVydHkuX3ZhbHVlID0gY3VycmVudFZhbHVlO1xuICAgIHByb3BlcnR5Ll91cGRhdGUgPSB1cGRhdGVyO1xuXG4gICAgcHJvcGVydHkuX2Zpcm0gPSAxO1xuXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlcihwcm9wZXJ0eSk7XG5cbiAgICBwcm9wZXJ0eS5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICAgICAgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobmV3QmluZGluZyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihuZXdCaW5kaW5nID09PSBiaW5kaW5nKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcgPSBuZXdCaW5kaW5nO1xuICAgICAgICBpZihtb2RlbCl7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hdHRhY2gobW9kZWwsIHByb3BlcnR5Ll9maXJtKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgIHByb3BlcnR5KGJpbmRpbmcoKSk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgZmlybSl7XG4gICAgICAgIGlmKGZpcm1lcihwcm9wZXJ0eSwgZmlybSkpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgcHJvcGVydHkuX2Zpcm0gPSBmaXJtO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgbW9kZWwgPSBvYmplY3Q7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocHJvcGVydHkuX2V2ZW50cyAmJiAnYXR0YWNoJyBpbiBwcm9wZXJ0eS5fZXZlbnRzKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmVtaXQoJ2F0dGFjaCcsIG9iamVjdCwgMSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgfTtcbiAgICBwcm9wZXJ0eS5kZXRhY2ggPSBmdW5jdGlvbihmaXJtKXtcbiAgICAgICAgaWYoZmlybWVyKHByb3BlcnR5LCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHByb3BlcnR5KTtcbiAgICAgICAgICAgIGJpbmRpbmcuZGV0YWNoKDEpO1xuICAgICAgICAgICAgbW9kZWwgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocHJvcGVydHkuX2V2ZW50cyAmJiAnZGV0YWNoJyBpbiBwcm9wZXJ0eS5fZXZlbnRzKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmVtaXQoJ2RldGFjaCcsIDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkudXBkYXRlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoIXByb3BlcnR5Ll9kZXN0cm95ZWQpe1xuXG4gICAgICAgICAgICBpZihwcm9wZXJ0eS5fdXBkYXRlKXtcbiAgICAgICAgICAgICAgICBwcm9wZXJ0eS5fdXBkYXRlKHByb3BlcnR5Ll92YWx1ZSwgcHJvcGVydHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9wZXJ0eS5lbWl0KCd1cGRhdGUnLCBwcm9wZXJ0eS5fdmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LnVwZGF0ZXIgPSBmdW5jdGlvbihmbil7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eS5fdXBkYXRlO1xuICAgICAgICB9XG4gICAgICAgIHByb3BlcnR5Ll91cGRhdGUgPSBmbjtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5Ll9kZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICAgICAgcHJvcGVydHkuZGV0YWNoKCk7XG4gICAgICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nLmRlc3Ryb3kodHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYWRkVG8gPSBmdW5jdGlvbihjb21wb25lbnQsIGtleSl7XG4gICAgICAgIGNvbXBvbmVudFtrZXldID0gcHJvcGVydHk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZVByb3BlcnR5OyIsInZhciB0b2RvID0gW10sXG4gICAgdG9kb0tleXMgPSBbXSxcbiAgICBzY2hlZHVsZWQsXG4gICAgdXBkYXRlcyA9IDA7XG5cbmZ1bmN0aW9uIHJ1bigpe1xuICAgIHZhciBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgd2hpbGUodG9kby5sZW5ndGggJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IDE2KXtcbiAgICAgICAgdG9kb0tleXMuc2hpZnQoKTtcbiAgICAgICAgdG9kby5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgaWYodG9kby5sZW5ndGgpe1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzY2hlZHVsZShrZXksIGZuKXtcbiAgICBpZih+dG9kb0tleXMuaW5kZXhPZihrZXkpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRvZG8ucHVzaChmbik7XG4gICAgdG9kb0tleXMucHVzaChrZXkpO1xuXG4gICAgaWYoIXNjaGVkdWxlZCl7XG4gICAgICAgIHNjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW4pO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzY2hlZHVsZTsiLCJ2YXIgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbmZ1bmN0aW9uIHRleHRDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzKXtcbiAgICB2YXIgdGV4dCA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIHRleHQuY3JlYXRlVGV4dE5vZGUgPSB0ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlO1xuICAgIHRleHQudGV4dCA9IGZhc3RuLnByb3BlcnR5KCcnKTtcbiAgICB0ZXh0Ll91cGRhdGVUZXh0ID0gZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpZighdGV4dC5lbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRleHQuZWxlbWVudC50ZXh0Q29udGVudCA9IHZhbHVlO1xuICAgIH07XG4gICAgdGV4dC5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICB0ZXh0LmVsZW1lbnQgPSB0ZXh0LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgICAgdGV4dC5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuICAgIHRleHQudGV4dC5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0ZXh0Ll91cGRhdGVUZXh0KHZhbHVlKTtcbiAgICB9KTtcbiAgICB0ZXh0Lm9uKCd1cGRhdGUnLCB0ZXh0LnRleHQudXBkYXRlKTtcblxuICAgIHJldHVybiB0ZXh0O1xufTtcblxudGV4dENvbXBvbmVudC5jcmVhdGVUZXh0Tm9kZSA9IGZ1bmN0aW9uKHRleHQpe1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gdGV4dENvbXBvbmVudDsiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIga01heExlbmd0aCA9IDB4M2ZmZmZmZmZcblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gNDIgPT09IGFyci5mb28oKSAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pXG5cbiAgdmFyIHR5cGUgPSB0eXBlb2Ygc3ViamVjdFxuXG4gIC8vIEZpbmQgdGhlIGxlbmd0aFxuICB2YXIgbGVuZ3RoXG4gIGlmICh0eXBlID09PSAnbnVtYmVyJylcbiAgICBsZW5ndGggPSBzdWJqZWN0ID4gMCA/IHN1YmplY3QgPj4+IDAgOiAwXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKGVuY29kaW5nID09PSAnYmFzZTY0JylcbiAgICAgIHN1YmplY3QgPSBiYXNlNjRjbGVhbihzdWJqZWN0KVxuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdvYmplY3QnICYmIHN1YmplY3QgIT09IG51bGwpIHsgLy8gYXNzdW1lIG9iamVjdCBpcyBhcnJheS1saWtlXG4gICAgaWYgKHN1YmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShzdWJqZWN0LmRhdGEpKVxuICAgICAgc3ViamVjdCA9IHN1YmplY3QuZGF0YVxuICAgIGxlbmd0aCA9ICtzdWJqZWN0Lmxlbmd0aCA+IDAgPyBNYXRoLmZsb29yKCtzdWJqZWN0Lmxlbmd0aCkgOiAwXG4gIH0gZWxzZVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcblxuICBpZiAodGhpcy5sZW5ndGggPiBrTWF4TGVuZ3RoKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG5cbiAgdmFyIGJ1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBQcmVmZXJyZWQ6IFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYnVmID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBUSElTIGluc3RhbmNlIG9mIEJ1ZmZlciAoY3JlYXRlZCBieSBgbmV3YClcbiAgICBidWYgPSB0aGlzXG4gICAgYnVmLmxlbmd0aCA9IGxlbmd0aFxuICAgIGJ1Zi5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgaVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgdHlwZW9mIHN1YmplY3QuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHtcbiAgICAvLyBTcGVlZCBvcHRpbWl6YXRpb24gLS0gdXNlIHNldCBpZiB3ZSdyZSBjb3B5aW5nIGZyb20gYSB0eXBlZCBhcnJheVxuICAgIGJ1Zi5fc2V0KHN1YmplY3QpXG4gIH0gZWxzZSBpZiAoaXNBcnJheWlzaChzdWJqZWN0KSkge1xuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheVxuICAgIGlmIChCdWZmZXIuaXNCdWZmZXIoc3ViamVjdCkpIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKylcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdC5yZWFkVUludDgoaSlcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKVxuICAgICAgICBidWZbaV0gPSAoKHN1YmplY3RbaV0gJSAyNTYpICsgMjU2KSAlIDI1NlxuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGJ1Zi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgIW5vWmVybykge1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgYnVmW2ldID0gMFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW4gJiYgYVtpXSA9PT0gYltpXTsgaSsrKSB7fVxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0WywgbGVuZ3RoXSknKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKHRvdGFsTGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICB0b3RhbExlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdG90YWxMZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcih0b3RhbExlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHZhciByZXRcbiAgc3RyID0gc3RyICsgJydcbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdyYXcnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCAqIDJcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggPj4+IDFcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuLy8gdG9TdHJpbmcoZW5jb2RpbmcsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kID4+PiAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKVxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiAoYikge1xuICBpZighQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heClcbiAgICAgIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGJ5dGUgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKGJ5dGUpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gYnl0ZVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIGJpbmFyeVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGFzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiB1dGYxNmxlV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gU3VwcG9ydCBib3RoIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZylcbiAgLy8gYW5kIHRoZSBsZWdhY3kgKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIGlmICghaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHV0ZjE2bGVXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgcmV0dXJuIGFzY2lpU2xpY2UoYnVmLCBzdGFydCwgZW5kKVxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW47XG4gICAgaWYgKHN0YXJ0IDwgMClcbiAgICAgIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKVxuICAgICAgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KVxuICAgIGVuZCA9IHN0YXJ0XG5cbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgcmV0dXJuIEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgdmFyIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZCwgdHJ1ZSlcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgICByZXR1cm4gbmV3QnVmXG4gIH1cbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSlcbiAgICByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpc1xuXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICghdGFyZ2V0X3N0YXJ0KSB0YXJnZXRfc3RhcnQgPSAwXG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgc291cmNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0JylcbiAgaWYgKHRhcmdldF9zdGFydCA8IDAgfHwgdGFyZ2V0X3N0YXJ0ID49IHRhcmdldC5sZW5ndGgpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gc291cmNlLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHNvdXJjZS5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpXG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgPCBlbmQgLSBzdGFydClcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnRcblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0X3N0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldF9zdGFydClcbiAgfVxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFR5cGVFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLXpdL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiBpc0FycmF5aXNoIChzdWJqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcidcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIHZhciBiID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBpZiAoYiA8PSAweDdGKSB7XG4gICAgICBieXRlQXJyYXkucHVzaChiKVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgc3RhcnQgPSBpXG4gICAgICBpZiAoYiA+PSAweEQ4MDAgJiYgYiA8PSAweERGRkYpIGkrK1xuICAgICAgdmFyIGggPSBlbmNvZGVVUklDb21wb25lbnQoc3RyLnNsaWNlKHN0YXJ0LCBpKzEpKS5zdWJzdHIoMSkuc3BsaXQoJyUnKVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBoLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSlcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoc3RyKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSlcbiAgICAgIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG4iLCJ2YXIgbG9va3VwID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuXG47KGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cdCd1c2Ugc3RyaWN0JztcblxuICB2YXIgQXJyID0gKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJylcbiAgICA/IFVpbnQ4QXJyYXlcbiAgICA6IEFycmF5XG5cblx0dmFyIFBMVVMgICA9ICcrJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSCAgPSAnLycuY2hhckNvZGVBdCgwKVxuXHR2YXIgTlVNQkVSID0gJzAnLmNoYXJDb2RlQXQoMClcblx0dmFyIExPV0VSICA9ICdhJy5jaGFyQ29kZUF0KDApXG5cdHZhciBVUFBFUiAgPSAnQScuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSClcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24oYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBuQml0cyA9IC03LFxuICAgICAgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwLFxuICAgICAgZCA9IGlzTEUgPyAtMSA6IDEsXG4gICAgICBzID0gYnVmZmVyW29mZnNldCArIGldO1xuXG4gIGkgKz0gZDtcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgcyA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IGVMZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBlID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gbUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzO1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSk7XG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICBlID0gZSAtIGVCaWFzO1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pO1xufTtcblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKSxcbiAgICAgIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKSxcbiAgICAgIGQgPSBpc0xFID8gMSA6IC0xLFxuICAgICAgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMDtcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMDtcbiAgICBlID0gZU1heDtcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMik7XG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tO1xuICAgICAgYyAqPSAyO1xuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gYztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpO1xuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrKztcbiAgICAgIGMgLz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwO1xuICAgICAgZSA9IGVNYXg7XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IGUgKyBlQmlhcztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IDA7XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCk7XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbTtcbiAgZUxlbiArPSBtTGVuO1xuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpO1xuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyODtcbn07XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG5mdW5jdGlvbiBFdmVudEVtaXR0ZXIoKSB7XG4gIHRoaXMuX2V2ZW50cyA9IHRoaXMuX2V2ZW50cyB8fCB7fTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gdGhpcy5fbWF4TGlzdGVuZXJzIHx8IHVuZGVmaW5lZDtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjEwLnhcbkV2ZW50RW1pdHRlci5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX2V2ZW50cyA9IHVuZGVmaW5lZDtcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX21heExpc3RlbmVycyA9IHVuZGVmaW5lZDtcblxuLy8gQnkgZGVmYXVsdCBFdmVudEVtaXR0ZXJzIHdpbGwgcHJpbnQgYSB3YXJuaW5nIGlmIG1vcmUgdGhhbiAxMCBsaXN0ZW5lcnMgYXJlXG4vLyBhZGRlZCB0byBpdC4gVGhpcyBpcyBhIHVzZWZ1bCBkZWZhdWx0IHdoaWNoIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxuRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnMgPSAxMDtcblxuLy8gT2J2aW91c2x5IG5vdCBhbGwgRW1pdHRlcnMgc2hvdWxkIGJlIGxpbWl0ZWQgdG8gMTAuIFRoaXMgZnVuY3Rpb24gYWxsb3dzXG4vLyB0aGF0IHRvIGJlIGluY3JlYXNlZC4gU2V0IHRvIHplcm8gZm9yIHVubGltaXRlZC5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuc2V0TWF4TGlzdGVuZXJzID0gZnVuY3Rpb24obikge1xuICBpZiAoIWlzTnVtYmVyKG4pIHx8IG4gPCAwIHx8IGlzTmFOKG4pKVxuICAgIHRocm93IFR5cGVFcnJvcignbiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJyk7XG4gIHRoaXMuX21heExpc3RlbmVycyA9IG47XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgZXIsIGhhbmRsZXIsIGxlbiwgYXJncywgaSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIElmIHRoZXJlIGlzIG5vICdlcnJvcicgZXZlbnQgbGlzdGVuZXIgdGhlbiB0aHJvdy5cbiAgaWYgKHR5cGUgPT09ICdlcnJvcicpIHtcbiAgICBpZiAoIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNPYmplY3QodGhpcy5fZXZlbnRzLmVycm9yKSAmJiAhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCkpIHtcbiAgICAgIGVyID0gYXJndW1lbnRzWzFdO1xuICAgICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXI7IC8vIFVuaGFuZGxlZCAnZXJyb3InIGV2ZW50XG4gICAgICB9XG4gICAgICB0aHJvdyBUeXBlRXJyb3IoJ1VuY2F1Z2h0LCB1bnNwZWNpZmllZCBcImVycm9yXCIgZXZlbnQuJyk7XG4gICAgfVxuICB9XG5cbiAgaGFuZGxlciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNVbmRlZmluZWQoaGFuZGxlcikpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGhhbmRsZXIpKSB7XG4gICAgc3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAvLyBmYXN0IGNhc2VzXG4gICAgICBjYXNlIDE6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICAvLyBzbG93ZXJcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgaGFuZGxlci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QoaGFuZGxlcikpIHtcbiAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cbiAgICBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgbGVuID0gbGlzdGVuZXJzLmxlbmd0aDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICBpZiAodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKVxuICAgIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICBpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKSA/XG4gICAgICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyIDogbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICBlbHNlIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIGVsc2VcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG5cbiAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkgJiYgIXRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQpIHtcbiAgICB2YXIgbTtcbiAgICBpZiAoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpIHtcbiAgICAgIG0gPSB0aGlzLl9tYXhMaXN0ZW5lcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9XG5cbiAgICBpZiAobSAmJiBtID4gMCAmJiB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoID4gbSkge1xuICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgJ2xlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gJyArXG4gICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgIGlmICh0eXBlb2YgY29uc29sZS50cmFjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBub3Qgc3VwcG9ydGVkIGluIElFIDEwXG4gICAgICAgIGNvbnNvbGUudHJhY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgdmFyIGZpcmVkID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gZygpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuXG4gICAgaWYgKCFmaXJlZCkge1xuICAgICAgZmlyZWQgPSB0cnVlO1xuICAgICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBnLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHRoaXMub24odHlwZSwgZyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBlbWl0cyBhICdyZW1vdmVMaXN0ZW5lcicgZXZlbnQgaWZmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZFxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBsaXN0LCBwb3NpdGlvbiwgbGVuZ3RoLCBpO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIGxlbmd0aCA9IGxpc3QubGVuZ3RoO1xuICBwb3NpdGlvbiA9IC0xO1xuXG4gIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fFxuICAgICAgKGlzRnVuY3Rpb24obGlzdC5saXN0ZW5lcikgJiYgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcblxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGxpc3QpKSB7XG4gICAgZm9yIChpID0gbGVuZ3RoOyBpLS0gPiAwOykge1xuICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8XG4gICAgICAgICAgKGxpc3RbaV0ubGlzdGVuZXIgJiYgbGlzdFtpXS5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uIDwgMClcbiAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnNwbGljZShwb3NpdGlvbiwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIga2V5LCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8gbm90IGxpc3RlbmluZyBmb3IgcmVtb3ZlTGlzdGVuZXIsIG5vIG5lZWQgdG8gZW1pdFxuICBpZiAoIXRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKVxuICAgICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGZvciAoa2V5IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhrZXkpO1xuICAgIH1cbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNGdW5jdGlvbihsaXN0ZW5lcnMpKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnMpO1xuICB9IGVsc2Uge1xuICAgIC8vIExJRk8gb3JkZXJcbiAgICB3aGlsZSAobGlzdGVuZXJzLmxlbmd0aClcbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2xpc3RlbmVycy5sZW5ndGggLSAxXSk7XG4gIH1cbiAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IFtdO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIGVsc2VcbiAgICByZXQgPSB0aGlzLl9ldmVudHNbdHlwZV0uc2xpY2UoKTtcbiAgcmV0dXJuIHJldDtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIWVtaXR0ZXIuX2V2ZW50cyB8fCAhZW1pdHRlci5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IDA7XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24oZW1pdHRlci5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSAxO1xuICBlbHNlXG4gICAgcmV0ID0gZW1pdHRlci5fZXZlbnRzW3R5cGVdLmxlbmd0aDtcbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBpc051bWJlcihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbiJdfQ==
