(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

function createBinding(path){
    if(arguments.length > 1){
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
        binding._model.detach();
        binding.emit('detach', 1);
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
        binding._model._events[path] = function(){
            binding._change(binding._model.get(path));
        };
    }

    return binding;
}

module.exports = createBinding;
},{"./firmer":14,"./is":17,"./makeFunctionEmitter":19,"enti":21,"same-value":174}],2:[function(require,module,exports){
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

},{"./binding":1,"./is":17}],3:[function(require,module,exports){
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
},{"./is":17,"crel":20,"events":187}],4:[function(require,module,exports){
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
},{"../":16,"../genericComponent":15,"../listComponent":18,"../textComponent":182}],5:[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(){    
    return fastn('div', {class: 'github-fork-ribbon-wrapper right'},
        fastn('div', {class: 'github-fork-ribbon'},
            fastn('a', {href: 'https://github.com/korynunn/fastn'}, 'Fork me')
        )
    );
};
},{"./fastn":4}],6:[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(searchModel){
    return fastn('header', {'class':'mainHeader'},
        fastn('img', {src: './fastn-sml.png'}),
        fastn('h1', 'fastn', fastn('span', {class: 'faint'}, '.js')),
        fastn('span',
            'User list example. ',
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
        ),
        require('./searchBar')()
    );
};
},{"./fastn":4,"./search":8,"./searchBar":9}],7:[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(model){

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

            model.insert('users', scope.get('.'), 0);
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
},{"./fastn":4}],8:[function(require,module,exports){
var fastn = require('./fastn'),
    users = require('./users'),
    searchModel = {
        userSearch: '',
        result: null
    },
    userSearch = fastn.binding('userSearch').attach(searchModel)
        .on('change', function(search){
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
},{"./fastn":4,"./users":13}],9:[function(require,module,exports){
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
},{"./fastn":4,"./search":8}],10:[function(require,module,exports){
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
},{"./fastn":4}],11:[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(selectedUser, deleteUser){
    var searchResult = require('./search').result;

    return fastn('div', {
            class: fastn.binding('.', 'name', searchResult, selectedUser, 'deleted', function(user, name, searchResult, selectedUser, deleted){
                var classes = ['user'];

                if(searchResult && !~searchResult.indexOf(user)){
                    classes.push('hidden');
                }
                if(user === selectedUser){
                    classes.push('selected');
                }
                if(deleted){
                    classes.push('deleted');
                }
                return classes;
            })
        },

        fastn('img', { 
            src: fastn.binding('.',  selectedUser, 'picture', function(user, selectedUser, picture){
                return user === selectedUser ? picture.large : picture.medium;
            })
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
                scope.set('deleted', true);
                deleteUser();
            })
        )

    ).on('click', function(event, scope){
        selectedUser(scope.get('.'));
    });
};
},{"./fastn":4,"./search":8}],12:[function(require,module,exports){
var fastn = require('./fastn');

module.exports = function(){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', 
        {
            class: 'users',
            items: fastn.binding('users|*'), 
            template: function(model, scope){

                function deleteUser(){
                    var deletedUsers = scope.get('deletedUsers') ||[];
                    deletedUsers.push(model.get('item'));
                    scope.set('deletedUsers', deletedUsers);
                }

                    return require('./user.js')(selectedUser, deleteUser).binding('item');
            }
        },
        fastn('button', {class: 'add'}, '+')
        .on('click', function(event, scope){
            require('./newUser')(scope);
        })
    );
};
},{"./fastn":4,"./newUser":7,"./user.js":11}],13:[function(require,module,exports){
var users = [
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"scarlett",
                "last":"dean"
            },
            "location":{
                "street":"2671 country club rd",
                "city":"fort collins",
                "state":"delaware",
                "zip":"56724"
            },
            "email":"scarlett.dean40@example.com",
            "username":"redbird618",
            "password":"circle",
            "salt":"TOyuCOdH",
            "md5":"2d3e0dc020a826898102c6ecf8bb60e2",
            "sha1":"01ba8ecbf3a137941f4e8b6650fb4b9c6abca7f8",
            "sha256":"d56a1cfdbcaf3a28e17e10b8cb11ce018b4ba730bc5bbe720f617451f36a8ece",
            "registered":"1255249913",
            "dob":"33324504",
            "phone":"(102)-210-9357",
            "cell":"(457)-769-7688",
            "SSN":"676-73-9766",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/43.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/43.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/43.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"72dbf72fcce35bdf"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"margie",
                "last":"ward"
            },
            "location":{
                "street":"6544 w dallas st",
                "city":"lansing",
                "state":"montana",
                "zip":"61858"
            },
            "email":"margie.ward28@example.com",
            "username":"silvertiger433",
            "password":"hihihi",
            "salt":"8Cd6yyqT",
            "md5":"cd3f29328cf437c111c197bab1627729",
            "sha1":"8afe26596e2a389d4ea0ffb3661910c14ba80d28",
            "sha256":"8cc8f9775e6d1fd7ad38af9559912eaa3267d822a1924d052ca0bb4d47da0fcd",
            "registered":"925308686",
            "dob":"305047894",
            "phone":"(167)-525-3937",
            "cell":"(929)-457-9252",
            "SSN":"409-42-7684",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/87.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/87.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/87.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"0d7acff68dc57358"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"caroline",
                "last":"mills"
            },
            "location":{
                "street":"4763 hogan st",
                "city":"grand rapids",
                "state":"connecticut",
                "zip":"75013"
            },
            "email":"caroline.mills14@example.com",
            "username":"smallrabbit946",
            "password":"venice",
            "salt":"db5V2tuk",
            "md5":"df8c9ef067d135c17b45c2d508a9770c",
            "sha1":"88526ed45793aab9ab7f322a9af11a7a8f7d601f",
            "sha256":"ca97ba7e4e6a25d0feb312d4079e87ff7a56fe9b02bfd2b3d44326048fb72f6d",
            "registered":"1281652204",
            "dob":"63723858",
            "phone":"(237)-512-6551",
            "cell":"(556)-866-4898",
            "SSN":"140-33-6569",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/41.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/41.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/41.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"e9a54170cc1f3cae"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"kathy",
                "last":"perry"
            },
            "location":{
                "street":"4222 pecan acres ln",
                "city":"cupertino",
                "state":"pennsylvania",
                "zip":"94452"
            },
            "email":"kathy.perry94@example.com",
            "username":"yellowkoala360",
            "password":"freeze",
            "salt":"Gdfp031s",
            "md5":"4a9300564d3c47c404639d3a2b5983e1",
            "sha1":"0b51f81b16a16a6c8e76a79aa007dc22ad787287",
            "sha256":"fd4b7724b39dcee744a26025657710d67325c7c4797c4c0a9817fae7c9633b73",
            "registered":"1411499473",
            "dob":"258139320",
            "phone":"(822)-311-9368",
            "cell":"(939)-310-4960",
            "SSN":"484-52-6155",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/35.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/35.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/35.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"076fe2847eb3c78d"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"mario",
                "last":"newman"
            },
            "location":{
                "street":"4304 plum st",
                "city":"new haven",
                "state":"rhode island",
                "zip":"80486"
            },
            "email":"mario.newman76@example.com",
            "username":"beautifulfish481",
            "password":"aikido",
            "salt":"OQ8wtlqg",
            "md5":"933f695a27e0aecc40fc353fdbbcb36b",
            "sha1":"f2e6e194dc0d41d40f301cc759d867ad2de5a5fc",
            "sha256":"81552b18e672b2ad07da091d92dd21f3794bde1d68e824247e8f0cd363a80df9",
            "registered":"1146070335",
            "dob":"163878483",
            "phone":"(526)-244-2427",
            "cell":"(912)-296-7266",
            "SSN":"603-96-8702",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/0.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/0.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/0.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"1c93dd0f5604911e"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"nelson",
                "last":"kelley"
            },
            "location":{
                "street":"8534 e north st",
                "city":"greeley",
                "state":"kansas",
                "zip":"66792"
            },
            "email":"nelson.kelley43@example.com",
            "username":"lazyladybug725",
            "password":"carolina",
            "salt":"PgUS2jIQ",
            "md5":"2672ece018079469773763328586c8a7",
            "sha1":"0e0df4a60bfebfb3a4fa871749b761c9a639889b",
            "sha256":"5a591d8daa7bc48e584ce5d90bbdde2dbcf0755f3f7939c7115a35de7aa0a396",
            "registered":"1316597905",
            "dob":"274444440",
            "phone":"(924)-798-6948",
            "cell":"(692)-116-8311",
            "SSN":"773-88-6973",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/63.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/63.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/63.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7de9819f465438bd"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"brandie",
                "last":"lucas"
            },
            "location":{
                "street":"6306 shady ln dr",
                "city":"detroit",
                "state":"washington",
                "zip":"15408"
            },
            "email":"brandie.lucas56@example.com",
            "username":"redswan784",
            "password":"joanne",
            "salt":"kI6JTGrY",
            "md5":"cd45d1d42bdeb74dcd82ca76ab0d7132",
            "sha1":"5ffba113cb334a6baf1ca9ea6e2edd7dc6ae4636",
            "sha256":"ae2bd576e72c2be0a85a06d3ee59a063fd97feaf83068d51d3387c933c0d72aa",
            "registered":"1201980090",
            "dob":"31396014",
            "phone":"(585)-968-1772",
            "cell":"(832)-445-7941",
            "SSN":"560-11-2474",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/29.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/29.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/29.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7f249e48d9fe53b9"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"nicholas",
                "last":"wells"
            },
            "location":{
                "street":"1158 edwards rd",
                "city":"caldwell",
                "state":"indiana",
                "zip":"58639"
            },
            "email":"nicholas.wells86@example.com",
            "username":"yellowfish410",
            "password":"bigone",
            "salt":"hQFEF8QD",
            "md5":"609858c7574db1419dd5af877facacda",
            "sha1":"7796f29d2265167e2a2e090a8b65311f3b2a5dcb",
            "sha256":"49eeeab0b61e0ac37c3f03b7a3bdab48b9c118cf03885acf5576c3b0153c3cd5",
            "registered":"1081760284",
            "dob":"464481379",
            "phone":"(794)-563-5386",
            "cell":"(612)-482-8033",
            "SSN":"217-25-2956",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/41.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/41.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/41.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7b6cf4b547c2de2a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"tanya",
                "last":"day"
            },
            "location":{
                "street":"5614 mcclellan rd",
                "city":"joliet",
                "state":"california",
                "zip":"47631"
            },
            "email":"tanya.day16@example.com",
            "username":"orangepeacock538",
            "password":"cash",
            "salt":"PKcaVoO0",
            "md5":"cc0fe330eed411ac147de226d7d5a5a3",
            "sha1":"77aea84a63a86bc932248cb0d181b43e6f0fb392",
            "sha256":"324aff38ba52e8700e971b2441dec781132aebc117fd26bc5d3bf02f81a35122",
            "registered":"1235772063",
            "dob":"92590329",
            "phone":"(820)-921-6199",
            "cell":"(343)-733-9511",
            "SSN":"826-42-2039",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/85.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/85.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/85.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d994301762bdf012"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"max",
                "last":"garrett"
            },
            "location":{
                "street":"4537 lakeview st",
                "city":"mesquite",
                "state":"maryland",
                "zip":"68214"
            },
            "email":"max.garrett39@example.com",
            "username":"whitecat990",
            "password":"orgy",
            "salt":"0FCmpeAe",
            "md5":"adfce0019a9004c369b6d5d9f4334cb0",
            "sha1":"9fa18523a92355a4bf18b5eda6b735781012e416",
            "sha256":"d94f7b2fdb8637fd5c2d19f24ad8d8df646d63a19fdf811680ba56db6c6ce089",
            "registered":"1176530354",
            "dob":"379263974",
            "phone":"(575)-243-5439",
            "cell":"(327)-938-9243",
            "SSN":"490-94-8661",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/59.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/59.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/59.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"730c82826d2d8a10"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"jeremiah",
                "last":"alvarez"
            },
            "location":{
                "street":"1703 edwards rd",
                "city":"red bluff",
                "state":"louisiana",
                "zip":"72648"
            },
            "email":"jeremiah.alvarez78@example.com",
            "username":"purplewolf664",
            "password":"bob123",
            "salt":"feuEKKTZ",
            "md5":"dc6642b991e04ac802dce388e4929ca4",
            "sha1":"5e8ef0693b814d80c215c7c0ac0ed0088a71f64f",
            "sha256":"50fabd752bb2a58b3a6cb84a7d57df8942bedadc47c1717628355a9ca704e0a5",
            "registered":"1210801500",
            "dob":"443198578",
            "phone":"(325)-589-9760",
            "cell":"(961)-805-1155",
            "SSN":"340-55-7777",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/29.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/29.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/29.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"f77521ef3c87acc2"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"cory",
                "last":"davis"
            },
            "location":{
                "street":"6981 miller ave",
                "city":"bakersfield",
                "state":"ohio",
                "zip":"53346"
            },
            "email":"cory.davis52@example.com",
            "username":"greenwolf935",
            "password":"18436572",
            "salt":"rOfjljhg",
            "md5":"fc15d9eaf7ec8bb5d2f332f6e7f35807",
            "sha1":"a0110e3dbb2243d38151178bc2294b5ebd4fa63b",
            "sha256":"8ca2736f64820761346bde2883f59c0ddcf8f7ecdb409e32d974ad394f321d71",
            "registered":"1263516629",
            "dob":"434984133",
            "phone":"(945)-338-9972",
            "cell":"(448)-632-5094",
            "SSN":"320-32-2830",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/89.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/89.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/89.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"e3b438d4d0af8af4"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"abigail",
                "last":"gray"
            },
            "location":{
                "street":"2824 paddock way",
                "city":"medford",
                "state":"maine",
                "zip":"14542"
            },
            "email":"abigail.gray67@example.com",
            "username":"bigwolf721",
            "password":"weston",
            "salt":"AFUKGVzE",
            "md5":"0f3799b05d08fe7b99a44a95f9ccfca8",
            "sha1":"64c8a493bf0905550c7bd0c81a4b962e02a3724b",
            "sha256":"664a1f71cbd7cf698efc5016c5e5fc48a135605741ceae52caa2e96863d04107",
            "registered":"1172997691",
            "dob":"271650204",
            "phone":"(768)-645-2340",
            "cell":"(929)-445-5522",
            "SSN":"934-87-9582",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/2.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/2.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/2.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"3055bc827f0ba077"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"jeffrey",
                "last":"ruiz"
            },
            "location":{
                "street":"4303 marsh ln",
                "city":"cleveland",
                "state":"south dakota",
                "zip":"62967"
            },
            "email":"jeffrey.ruiz30@example.com",
            "username":"purplecat328",
            "password":"womble",
            "salt":"mc4WBybZ",
            "md5":"7ea51c70f0dde81ba65921fdbf070784",
            "sha1":"d240a46ce504f88811d74461006f8f8f8d016a88",
            "sha256":"cff7f385e1dbd8dfe0f7a15cccf1bf3bbb4cf03445e0d6245834c83c3f5c7704",
            "registered":"1393025209",
            "dob":"434083449",
            "phone":"(719)-514-5973",
            "cell":"(905)-738-5179",
            "SSN":"227-82-1951",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/76.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/76.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/76.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"022da5e6144594a6"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"jane",
                "last":"rogers"
            },
            "location":{
                "street":"5478 timber wolf trail",
                "city":"columbus",
                "state":"washington",
                "zip":"93078"
            },
            "email":"jane.rogers60@example.com",
            "username":"beautifullion44",
            "password":"highheel",
            "salt":"tKYzBbiF",
            "md5":"77ee2662459df8e7c5c7138f3fb7d06d",
            "sha1":"6c613228a05d70287fcf6687ae1441996a0c33c4",
            "sha256":"4653e95dc3158b8354536bcec6843560841071f44d8e3d4283a2323327ae5971",
            "registered":"947161457",
            "dob":"75703783",
            "phone":"(313)-767-5665",
            "cell":"(323)-411-1433",
            "SSN":"582-15-5278",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/25.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/25.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/25.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"864ecff993b1c4bc"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"arianna",
                "last":"miles"
            },
            "location":{
                "street":"3641 sunset st",
                "city":"grand prairie",
                "state":"louisiana",
                "zip":"69528"
            },
            "email":"arianna.miles54@example.com",
            "username":"crazyduck879",
            "password":"bigfoot",
            "salt":"2Mk7NrxP",
            "md5":"cad06176fff8e6dec348c2f1e040399e",
            "sha1":"7b7b1100a4b6849993a0ca54fe5f498f600860ec",
            "sha256":"036a2a2c0eb1c3b7bded6caf6b650e02e200ebb30445af8a6a731e1624cb9e83",
            "registered":"1092142284",
            "dob":"459963597",
            "phone":"(929)-740-2755",
            "cell":"(150)-499-6470",
            "SSN":"795-72-6321",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/27.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/27.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/27.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"87ffdd51d621142a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"vickie",
                "last":"carpenter"
            },
            "location":{
                "street":"3829 shady ln dr",
                "city":"roanoke",
                "state":"wyoming",
                "zip":"63820"
            },
            "email":"vickie.carpenter10@example.com",
            "username":"yellowpeacock248",
            "password":"lancia",
            "salt":"ndLUmIPH",
            "md5":"5e493f38ba26741801e0df88c6a2af14",
            "sha1":"0e6bfc8c07018b99fdd9820973bda94d415c529e",
            "sha256":"6ac40d7f30e556584a74b0189bff943dfcf25e63432541e05696385c0c112976",
            "registered":"1374061074",
            "dob":"287326616",
            "phone":"(346)-395-7876",
            "cell":"(206)-645-2708",
            "SSN":"680-24-2225",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/65.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/65.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/65.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"0c7cb14f1f887877"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"allison",
                "last":"oliver"
            },
            "location":{
                "street":"6586 plum st",
                "city":"grants pass",
                "state":"new york",
                "zip":"89008"
            },
            "email":"allison.oliver50@example.com",
            "username":"bluepeacock119",
            "password":"mang",
            "salt":"yKfi6MtS",
            "md5":"de8f44ee459f9c51d8949aaf1ebf0235",
            "sha1":"223b201fb06da0e3f6689c57765167cac58ab825",
            "sha256":"ffcd1f9d64cb8f0075733be6912eba5e0dddba25c5271ebd3447567714cc5779",
            "registered":"1167177797",
            "dob":"421426300",
            "phone":"(817)-273-9797",
            "cell":"(247)-289-9765",
            "SSN":"704-71-6969",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/33.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/33.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/33.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"83846000e13f2f4a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"deann",
                "last":"bates"
            },
            "location":{
                "street":"7414 w 6th st",
                "city":"evansville",
                "state":"ohio",
                "zip":"95046"
            },
            "email":"deann.bates96@example.com",
            "username":"orangekoala685",
            "password":"giorgio",
            "salt":"shKCDCW0",
            "md5":"fcfb3b93afa0ff32160b193c0cb3f038",
            "sha1":"046a6dc3040e5dfa97f6fe21d83b70f5afbca2e9",
            "sha256":"d3315d6600173a3f2ba5ff020c99c5b040b889d349bf8308352fb682f37b6f7f",
            "registered":"1051112647",
            "dob":"259489041",
            "phone":"(592)-356-3251",
            "cell":"(664)-235-4124",
            "SSN":"443-43-9735",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/49.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/49.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/49.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"93f889e53d140634"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"mildred",
                "last":"frazier"
            },
            "location":{
                "street":"3026 railroad st",
                "city":"allen",
                "state":"maryland",
                "zip":"83577"
            },
            "email":"mildred.frazier18@example.com",
            "username":"whitebutterfly571",
            "password":"hooter",
            "salt":"0eFpFWWh",
            "md5":"4522511812a1e20beea03a255ddc6935",
            "sha1":"232862fee04ee0613cb7b6d8a6d086072f97a8ce",
            "sha256":"b332e278b3486df04ece41ab761c4dfebcb873b6288e79c16dea61f87e98a5fd",
            "registered":"1234978001",
            "dob":"295728876",
            "phone":"(433)-254-8066",
            "cell":"(401)-240-1553",
            "SSN":"554-29-8016",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/31.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/31.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/31.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"b3114592144c61ec"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"leona",
                "last":"gray"
            },
            "location":{
                "street":"5253 miller ave",
                "city":"everett",
                "state":"connecticut",
                "zip":"36228"
            },
            "email":"leona.gray63@example.com",
            "username":"blackostrich794",
            "password":"clippers",
            "salt":"fQjWkiOy",
            "md5":"b57340e735f7b0987481efb38f420c98",
            "sha1":"5274b0849c0ead8deeff0bea79bcdac8a76c4c1a",
            "sha256":"0cb8e15d1317972da096c31b198a16d6390de8d7f24ce6b34ef97365accef384",
            "registered":"1239872388",
            "dob":"153160313",
            "phone":"(480)-738-2416",
            "cell":"(733)-407-3388",
            "SSN":"709-26-9242",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/18.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/18.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/18.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"c93ef226c2f08ea6"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"kelly",
                "last":"montgomery"
            },
            "location":{
                "street":"8762 paddock way",
                "city":"stockton",
                "state":"kansas",
                "zip":"91921"
            },
            "email":"kelly.montgomery29@example.com",
            "username":"brownladybug510",
            "password":"possum",
            "salt":"0DPrSo2k",
            "md5":"18d8399112d65692013d4a793536bf74",
            "sha1":"ed503fed9c3304beced1ac8cbc6c72928fe28183",
            "sha256":"32356d371712f8634f61daf7906e5acb6b9befedb2334712ce4405759fbfaa71",
            "registered":"1180849615",
            "dob":"376325308",
            "phone":"(844)-619-9663",
            "cell":"(785)-787-9812",
            "SSN":"238-96-7073",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/26.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/26.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/26.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"61b45c11947b4918"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"roger",
                "last":"kim"
            },
            "location":{
                "street":"2555 lakeview st",
                "city":"fremont",
                "state":"montana",
                "zip":"88915"
            },
            "email":"roger.kim59@example.com",
            "username":"silverlion443",
            "password":"jillian",
            "salt":"YtyFNKIT",
            "md5":"a467093deea39a2372ff0621e3c4a731",
            "sha1":"3cbfc12a72e9a46527e6a7db702b8fc0a2f1c4b9",
            "sha256":"b19de0adcdbcfa602883a24c85f5367efe402d83cee0905c02b0f1af66eccc4a",
            "registered":"1325634976",
            "dob":"240866756",
            "phone":"(734)-762-6287",
            "cell":"(545)-808-4677",
            "SSN":"644-81-1113",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/76.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/76.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/76.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"a55a6f96efbf2188"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"amanda",
                "last":"fleming"
            },
            "location":{
                "street":"3636 w dallas st",
                "city":"henderson",
                "state":"south carolina",
                "zip":"35633"
            },
            "email":"amanda.fleming70@example.com",
            "username":"beautifulostrich593",
            "password":"smithers",
            "salt":"MMsuee6M",
            "md5":"085f9c40dbb63737b0796896719b682c",
            "sha1":"1c9369f25926e106e61edf736b01c2556e3415ec",
            "sha256":"5c10d2887ba1c8c9ca4cc2358fe8b35c30a064ddf66d4fa7f181f47216a6714e",
            "registered":"1379687053",
            "dob":"434504113",
            "phone":"(726)-582-7336",
            "cell":"(124)-555-3198",
            "SSN":"147-96-6925",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/63.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/63.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/63.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"30c558fca64b906a"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"dean",
                "last":"curtis"
            },
            "location":{
                "street":"1179 stevens creek blvd",
                "city":"eureka",
                "state":"north carolina",
                "zip":"25529"
            },
            "email":"dean.curtis83@example.com",
            "username":"smallleopard547",
            "password":"demo",
            "salt":"6kX9EWQh",
            "md5":"ca81799fcbecff3bec77f51f82336713",
            "sha1":"230baf11ae40de147909e8dca5d48a75bb6f1f8d",
            "sha256":"05e7101f50b0a56514842662a7d5b3b3c248d365bce5eb876d6fb124335843df",
            "registered":"1418450414",
            "dob":"149918287",
            "phone":"(225)-492-6623",
            "cell":"(232)-476-2448",
            "SSN":"824-24-2760",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/56.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/56.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/56.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"6d77d569ff29fd98"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"valerie",
                "last":"beck"
            },
            "location":{
                "street":"1431 college st",
                "city":"york",
                "state":"kentucky",
                "zip":"12365"
            },
            "email":"valerie.beck19@example.com",
            "username":"blueleopard107",
            "password":"jammin",
            "salt":"RY0zeKV8",
            "md5":"172306950eff4dfefe34d1fedd2d1c03",
            "sha1":"78d6e68cbceb3c85f5537bd79e506932791eb670",
            "sha256":"b0f1aa427dc38e188d75940aa46f9c917b2de29dd1a36661db41b121d6cd5a38",
            "registered":"1371337638",
            "dob":"72920311",
            "phone":"(243)-769-4737",
            "cell":"(867)-210-7187",
            "SSN":"713-70-9876",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/91.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/91.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/91.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"75e225a7131f8eb4"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"daryl",
                "last":"shaw"
            },
            "location":{
                "street":"3546 karen dr",
                "city":"albuquerque",
                "state":"wyoming",
                "zip":"38500"
            },
            "email":"daryl.shaw15@example.com",
            "username":"bluefrog565",
            "password":"flamingo",
            "salt":"ItD0r1WF",
            "md5":"48c5126333328d8e5a33490fa4352017",
            "sha1":"19a64ddeb29b7adb65403af4c83d697d73349e8e",
            "sha256":"94ff2d2179a227d598a5da4486818db9d54451dffe01261146bd019ccd7952b2",
            "registered":"940455813",
            "dob":"113952584",
            "phone":"(543)-174-5545",
            "cell":"(342)-103-2028",
            "SSN":"845-47-2468",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/75.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/75.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/75.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"cb50e14935a024f1"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"peggy",
                "last":"oliver"
            },
            "location":{
                "street":"4828 miller ave",
                "city":"flowermound",
                "state":"new mexico",
                "zip":"87544"
            },
            "email":"peggy.oliver50@example.com",
            "username":"smallleopard243",
            "password":"strawber",
            "salt":"fFiodfju",
            "md5":"6d80abd02f001eaa75a7c71fc0264596",
            "sha1":"f883d1b2fc346661f5ab8274ce3176d56e082ba1",
            "sha256":"2a29bbb643e86b0f529c7f8636d33e75b23fc8b917c493df1ea6ac4e03a669b3",
            "registered":"1046374376",
            "dob":"474575575",
            "phone":"(334)-687-1022",
            "cell":"(302)-842-5847",
            "SSN":"527-52-2478",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/2.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/2.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/2.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"17df19dc8d136061"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"allan",
                "last":"reynolds"
            },
            "location":{
                "street":"9598 wheeler ridge dr",
                "city":"belen",
                "state":"alaska",
                "zip":"64464"
            },
            "email":"allan.reynolds47@example.com",
            "username":"tinyfrog307",
            "password":"viper",
            "salt":"KcBayQGU",
            "md5":"a419a8432f914ad8930ff99eca55c058",
            "sha1":"eaae26a797bf68b863604dce32c20da4c5b63e07",
            "sha256":"73ef6c2c1eb48d4531c06e8b874412936f6b4e957042f2c3b56375e654b54077",
            "registered":"1190226090",
            "dob":"200687786",
            "phone":"(531)-912-2367",
            "cell":"(881)-493-9893",
            "SSN":"251-88-1479",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/78.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/78.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/78.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"bba1a82e12134a49"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"zoey",
                "last":"harris"
            },
            "location":{
                "street":"9808 karen dr",
                "city":"sacramento",
                "state":"wisconsin",
                "zip":"91717"
            },
            "email":"zoey.harris89@example.com",
            "username":"smallfrog294",
            "password":"titts",
            "salt":"LcrBpCzO",
            "md5":"a98f438d2b49c6bd35c7ebb94c4acc8e",
            "sha1":"e56040cd77981c4b2d02663f5fa4f91fa218128f",
            "sha256":"08b5448963db20c0bd84e5f19cdeaeba61a704f49a028f6696bb0e620e475892",
            "registered":"1407097133",
            "dob":"344456674",
            "phone":"(928)-789-2623",
            "cell":"(135)-807-6506",
            "SSN":"154-82-5539",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/95.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/95.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/95.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d7d5f1ae8cc3144a"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"chester",
                "last":"lucas"
            },
            "location":{
                "street":"2803 w belt line rd",
                "city":"red bluff",
                "state":"idaho",
                "zip":"55656"
            },
            "email":"chester.lucas20@example.com",
            "username":"bluedog563",
            "password":"pictere",
            "salt":"kofjuBvg",
            "md5":"aa4779d7ccd7a31f78962f376ac2ae7c",
            "sha1":"a7ae3a6256d6765178da91320af9e1cdd85d13bc",
            "sha256":"a3e6b6ebc6ce10073069fa016e6ddca261fb04891765cfdd1136a8b8e6a3f01f",
            "registered":"950282393",
            "dob":"352287963",
            "phone":"(585)-115-1118",
            "cell":"(967)-330-1687",
            "SSN":"873-80-2356",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/47.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/47.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/47.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"11eab1fdf1c0ad4a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"cherly",
                "last":"sutton"
            },
            "location":{
                "street":"6113 oak lawn ave",
                "city":"coppell",
                "state":"kentucky",
                "zip":"78471"
            },
            "email":"cherly.sutton57@example.com",
            "username":"heavymeercat950",
            "password":"727272",
            "salt":"VJ4bz1XE",
            "md5":"095dc5a7924f850f87bf6cb33c29f830",
            "sha1":"ce6011cc8374c2b109fc2205f5629de4b0bd060b",
            "sha256":"6bf35a7e5cc0026869d3b2a9e09e8ba3541b2b3e05515cf11f32ac90e2f6d646",
            "registered":"1106336971",
            "dob":"326754423",
            "phone":"(316)-267-5023",
            "cell":"(490)-654-5693",
            "SSN":"140-98-2264",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/22.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/22.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/22.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"30eafef05cb282ac"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"jordan",
                "last":"hamilton"
            },
            "location":{
                "street":"8670 parker rd",
                "city":"iowa park",
                "state":"pennsylvania",
                "zip":"90550"
            },
            "email":"jordan.hamilton97@example.com",
            "username":"brownfrog768",
            "password":"pounded",
            "salt":"lmRf799w",
            "md5":"53c89d33ee3ae637d3272cfdd03170c5",
            "sha1":"4817e8c87520d6af819b389f12612790a7cce32f",
            "sha256":"889adeded6bfe10c84b33039eb66550decc3fa90c3353b5e79f531295cb28b7d",
            "registered":"1161732511",
            "dob":"427800762",
            "phone":"(483)-860-8064",
            "cell":"(486)-773-3706",
            "SSN":"559-20-4899",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/6.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/6.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/6.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"9bf5a5b5f04112d0"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"genesis",
                "last":"fletcher"
            },
            "location":{
                "street":"5922 depaul dr",
                "city":"allen",
                "state":"nevada",
                "zip":"11164"
            },
            "email":"genesis.fletcher54@example.com",
            "username":"redcat972",
            "password":"line",
            "salt":"sftDilXP",
            "md5":"bda1955407cc8a94bf42a88cb61e0030",
            "sha1":"7fc48dc06bf55eb65e46635035fb3f058fb39148",
            "sha256":"dfe10b3d55d67adf835d3cc408dadc1959c5189c924d3b554039620a28da0a94",
            "registered":"1071144816",
            "dob":"73503534",
            "phone":"(436)-769-4861",
            "cell":"(930)-925-4369",
            "SSN":"252-45-8632",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/29.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/29.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/29.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d11e909767ce5d32"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"todd",
                "last":"simpson"
            },
            "location":{
                "street":"8738 w belt line rd",
                "city":"fort collins",
                "state":"colorado",
                "zip":"64240"
            },
            "email":"todd.simpson34@example.com",
            "username":"smallcat30",
            "password":"dream",
            "salt":"lJkVRaSw",
            "md5":"abee8b31f18110c978c09f9e8d6d3006",
            "sha1":"4d7011abdf4d3d30a808866ccf865d464aebc665",
            "sha256":"72f6ace59277d750d15a74d8a8478baf729008bb1e680e0a59afd3c2c91cb8da",
            "registered":"962668109",
            "dob":"303094671",
            "phone":"(456)-869-6300",
            "cell":"(785)-293-5012",
            "SSN":"464-79-5887",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/1.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/1.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/1.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d309a3ccf50293db"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"luke",
                "last":"moore"
            },
            "location":{
                "street":"7232 college st",
                "city":"duncanville",
                "state":"oregon",
                "zip":"18403"
            },
            "email":"luke.moore78@example.com",
            "username":"bluefrog544",
            "password":"hannah1",
            "salt":"S19z8xAW",
            "md5":"d878553aeced3208683fe03d7c7c976c",
            "sha1":"33c15b0cb890def433778e0d8fa32ee4fe9741f9",
            "sha256":"1b3686f6c6c2df374014d03a40e122cd2e668f49f6b62442e5a45be8e3dbc006",
            "registered":"1174733274",
            "dob":"325268504",
            "phone":"(549)-728-6811",
            "cell":"(770)-361-8771",
            "SSN":"728-22-7502",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/13.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/13.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/13.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"12525a58dae5919b"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"louella",
                "last":"adams"
            },
            "location":{
                "street":"8296 depaul dr",
                "city":"red oak",
                "state":"north dakota",
                "zip":"22539"
            },
            "email":"louella.adams94@example.com",
            "username":"crazypanda354",
            "password":"space",
            "salt":"qZYRMNT3",
            "md5":"3f1c06973000a824a770dd8a87d61110",
            "sha1":"31024f1a96aa483a15ac576f480797a339dd33b4",
            "sha256":"6a249b61d424386ee02b7f48176788066f5d8195e463c335a891b6d18dd9efed",
            "registered":"1359807389",
            "dob":"436653124",
            "phone":"(899)-357-9720",
            "cell":"(410)-220-5562",
            "SSN":"343-25-7161",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/76.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/76.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/76.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"75824f719fae1ed9"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"erika",
                "last":"reynolds"
            },
            "location":{
                "street":"7980 depaul dr",
                "city":"columbus",
                "state":"tennessee",
                "zip":"72335"
            },
            "email":"erika.reynolds89@example.com",
            "username":"ticklishdog21",
            "password":"kenneth",
            "salt":"Reyqwy6C",
            "md5":"fb7ee70122fbfc72b80dea6e84960a56",
            "sha1":"ba3fab67d974a89c2b40bb5e24f40b67c444ceba",
            "sha256":"f0a4b8e03900ea3e0fc22481fe301ce203b5be7a678e87aa0b333c517782d68d",
            "registered":"1362569460",
            "dob":"53965039",
            "phone":"(411)-703-5419",
            "cell":"(392)-482-1719",
            "SSN":"176-29-8015",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/12.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/12.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/12.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"6dda9a9f5614503b"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"eugene",
                "last":"oliver"
            },
            "location":{
                "street":"6460 ash dr",
                "city":"desoto",
                "state":"pennsylvania",
                "zip":"37300"
            },
            "email":"eugene.oliver52@example.com",
            "username":"yellowelephant912",
            "password":"01234567",
            "salt":"7TfPlPJM",
            "md5":"15515a2c12f8291bf7eb233068085cff",
            "sha1":"a7609b77f61e549201d5897ea2f2bad43cdf02f9",
            "sha256":"cf9f76fc90968fcfefe4c9eb77ff8afd56c356ff01cda2cb9d1d79342382e515",
            "registered":"1075359241",
            "dob":"95352003",
            "phone":"(100)-522-4699",
            "cell":"(598)-489-3648",
            "SSN":"176-91-1722",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/26.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/26.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/26.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"6c2a0547dc897ca1"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"kristin",
                "last":"hansen"
            },
            "location":{
                "street":"4607 fincher rd",
                "city":"modesto",
                "state":"north dakota",
                "zip":"84779"
            },
            "email":"kristin.hansen92@example.com",
            "username":"yellowgorilla616",
            "password":"2727",
            "salt":"QLmKFulj",
            "md5":"d1315ccbfbf64b79472320bd0f3e063f",
            "sha1":"e2191bf6d0fe37b10b5d9657c1fbff5a271d0fe9",
            "sha256":"467836e8b1a48237be4b97799dcd9b1dba102f3636c623ce880f798de046543d",
            "registered":"1257598399",
            "dob":"59303210",
            "phone":"(588)-648-1163",
            "cell":"(991)-495-6558",
            "SSN":"518-14-8860",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/68.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/68.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/68.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d480e6d71e9cadf9"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"arnold",
                "last":"jimenez"
            },
            "location":{
                "street":"2736 miller ave",
                "city":"albany",
                "state":"arkansas",
                "zip":"65329"
            },
            "email":"arnold.jimenez21@example.com",
            "username":"silvergorilla472",
            "password":"skydive",
            "salt":"KJPKUOzA",
            "md5":"4f811daf6c7a42312a8d19f468d390f8",
            "sha1":"78589a105c80aa50ba74b12d0ef1c651dc365fb9",
            "sha256":"bdcb4510b48e693080d1e2d6579ee072fcbb21c212bc9b2a0caa2369dc774383",
            "registered":"1057619956",
            "dob":"160357473",
            "phone":"(666)-775-2250",
            "cell":"(635)-989-4541",
            "SSN":"587-80-3653",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/68.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/68.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/68.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"c604294fbc8e53f7"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"amelia",
                "last":"rodriguez"
            },
            "location":{
                "street":"2779 shady ln dr",
                "city":"shelby",
                "state":"minnesota",
                "zip":"74853"
            },
            "email":"amelia.rodriguez38@example.com",
            "username":"whitekoala856",
            "password":"snowball",
            "salt":"IMOg8Zdo",
            "md5":"7bc715b7869eaf2fb87c056bd70389f5",
            "sha1":"901ecbe0ba396c8c20486ca8576858cfd5e944c6",
            "sha256":"9daddad001eeda3af78b053fe8d6119930d2e252bc0e8f80cc6129a63c164d35",
            "registered":"1086350157",
            "dob":"25924395",
            "phone":"(458)-409-3774",
            "cell":"(954)-780-8004",
            "SSN":"930-24-1252",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/87.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/87.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/87.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"be12d51e98060884"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"max",
                "last":"henry"
            },
            "location":{
                "street":"1496 parker rd",
                "city":"dumas",
                "state":"kentucky",
                "zip":"82386"
            },
            "email":"max.henry51@example.com",
            "username":"lazykoala431",
            "password":"live",
            "salt":"3EOKiPda",
            "md5":"939643388edefbe4365f9a20c9b9a6bf",
            "sha1":"9450626b9bdb1288a06efe68054b90a9a161aa20",
            "sha256":"cae02f129b1fc2822d2dcf0b372062457e91ef259501ab2ff830546ea57eaa33",
            "registered":"1245770211",
            "dob":"186281449",
            "phone":"(790)-822-6842",
            "cell":"(351)-777-5311",
            "SSN":"911-47-2973",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/65.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/65.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/65.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7ddfd7e50c1790af"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"willie",
                "last":"palmer"
            },
            "location":{
                "street":"6302 bollinger rd",
                "city":"detroit",
                "state":"ohio",
                "zip":"86313"
            },
            "email":"willie.palmer59@example.com",
            "username":"organicgorilla539",
            "password":"brutus",
            "salt":"JI6ZyKVS",
            "md5":"0d3560ee512ad16eee83b10cc3dceede",
            "sha1":"07172881c89c31bd6aa73e68074bf44ca13344b4",
            "sha256":"660fe5ac4448aeb2f073e45d2b7778021dc3c7b57e50f256036e28d5157bcf31",
            "registered":"1046189137",
            "dob":"36767423",
            "phone":"(714)-701-7913",
            "cell":"(442)-510-1776",
            "SSN":"752-56-5736",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/30.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/30.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/30.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"b7e23530f51113aa"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"tyler",
                "last":"collins"
            },
            "location":{
                "street":"7474 fairview st",
                "city":"the colony",
                "state":"maryland",
                "zip":"68116"
            },
            "email":"tyler.collins80@example.com",
            "username":"purplecat609",
            "password":"parrot",
            "salt":"o5HpMLDs",
            "md5":"c0219f64ee8b757c88bbfa6a64059a70",
            "sha1":"a206c07f48ef42e08e1d00b75fe16217eddc662f",
            "sha256":"8d849cffa64feab1a1621956f953fa94dfb84bc738256052dca6e4e2ce85a92f",
            "registered":"1349233849",
            "dob":"174110032",
            "phone":"(897)-132-8236",
            "cell":"(619)-173-9400",
            "SSN":"564-53-4212",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/5.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/5.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/5.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"b00be0634d933d91"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"francis",
                "last":"andrews"
            },
            "location":{
                "street":"2798 fincher rd",
                "city":"helena",
                "state":"south dakota",
                "zip":"48799"
            },
            "email":"francis.andrews24@example.com",
            "username":"bluebear731",
            "password":"1969",
            "salt":"Ik6dxyr5",
            "md5":"6f5f2dacb632cc74992a8196db40ffc6",
            "sha1":"cc3ae5a2503074fc5c38b52f4744cb85a5f34c63",
            "sha256":"6935e097d0b25f1d4e8166ea9d916ba7ed0e0fb0bf58494c565873504d7773db",
            "registered":"1148124369",
            "dob":"169255348",
            "phone":"(165)-767-8016",
            "cell":"(935)-484-4409",
            "SSN":"913-89-5930",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/76.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/76.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/76.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"5f3002cf92889ca8"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"maxine",
                "last":"henderson"
            },
            "location":{
                "street":"2675 dane st",
                "city":"cincinnati",
                "state":"maine",
                "zip":"69978"
            },
            "email":"maxine.henderson26@example.com",
            "username":"yellowostrich913",
            "password":"matrix1",
            "salt":"jVP4cF5E",
            "md5":"c196333b04c9d0761ca5172523423a87",
            "sha1":"f9fb45ea021301a24885b8a8b926bca169ac8714",
            "sha256":"8d97a197bb2240b16a801977f2d11b402e6fb4f5282106a904c8f03cc7323087",
            "registered":"1333719431",
            "dob":"116226344",
            "phone":"(943)-880-4924",
            "cell":"(463)-686-1906",
            "SSN":"633-10-1001",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/29.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/29.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/29.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"3e2878fabd9163a5"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"tracy",
                "last":"hopkins"
            },
            "location":{
                "street":"7166 hunters creek dr",
                "city":"hamsburg",
                "state":"virginia",
                "zip":"45097"
            },
            "email":"tracy.hopkins68@example.com",
            "username":"purpleladybug948",
            "password":"allen",
            "salt":"IQ7l3x7N",
            "md5":"aa79a2d15f7efeaa36236e0722cbb5fb",
            "sha1":"9acfd5a13f13ae660989e0054c1840c8ba0643da",
            "sha256":"8f7966b25932df160c346f13d919eb6bbfcd654e9695c6cfea376ff29727e020",
            "registered":"1201172871",
            "dob":"469473230",
            "phone":"(826)-527-2905",
            "cell":"(986)-523-6144",
            "SSN":"273-24-6328",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/13.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/13.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/13.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"a190a4b49614a04b"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"amelia",
                "last":"nichols"
            },
            "location":{
                "street":"5546 ash dr",
                "city":"allen",
                "state":"new york",
                "zip":"66020"
            },
            "email":"amelia.nichols69@example.com",
            "username":"whiteladybug953",
            "password":"obiwan",
            "salt":"FD2cXHVi",
            "md5":"e9264a79c3cd28bda8c4640dd2ed0b0f",
            "sha1":"419422255a3eacdd277fd05550bf81f4c17935b7",
            "sha256":"9c4e57b04cda934c7ea844c0d7aa54590f51d6acd512d5c701b6516c14eef906",
            "registered":"1068503047",
            "dob":"110387893",
            "phone":"(699)-299-5398",
            "cell":"(787)-238-5401",
            "SSN":"618-20-8430",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/91.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/91.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/91.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"84ed0e4fd84e8c0c"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"aubree",
                "last":"peterson"
            },
            "location":{
                "street":"8586 edwards rd",
                "city":"cape fear",
                "state":"new mexico",
                "zip":"53210"
            },
            "email":"aubree.peterson31@example.com",
            "username":"bigduck911",
            "password":"carbon",
            "salt":"a2d56avQ",
            "md5":"76ade0d06d10a05aabf4212d1387c858",
            "sha1":"84bdb80b7e48a6a9164af8e027f0cf9420a4d9c2",
            "sha256":"2bd09018e47b5b876f98670887c03d16e82b9135ed8e6815e71bcc08cc8ec1b3",
            "registered":"1124395277",
            "dob":"23074917",
            "phone":"(126)-548-1106",
            "cell":"(404)-356-1250",
            "SSN":"804-35-7391",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/38.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/38.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/38.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"446f4b2c220c8a5e"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"jean",
                "last":"peters"
            },
            "location":{
                "street":"4181 washington ave",
                "city":"bernalillo",
                "state":"indiana",
                "zip":"77128"
            },
            "email":"jean.peters98@example.com",
            "username":"silverelephant303",
            "password":"meatball",
            "salt":"wW59f0Ry",
            "md5":"b779afd3799f7c9ac9dc5e1fc970af2f",
            "sha1":"af5d2f820d50344f0188a04a8fcec36d6c4101ca",
            "sha256":"d390bb00c66a0c14103a2807f6321475ab22dd45f8b20169e3f920655c50b0a5",
            "registered":"1001971653",
            "dob":"272199429",
            "phone":"(373)-419-2794",
            "cell":"(599)-196-1249",
            "SSN":"726-23-4768",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/45.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/45.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/45.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"fd07550ed470e234"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"camila",
                "last":"stanley"
            },
            "location":{
                "street":"4769 hunters creek dr",
                "city":"billings",
                "state":"oklahoma",
                "zip":"24256"
            },
            "email":"camila.stanley86@example.com",
            "username":"goldenmeercat505",
            "password":"jules",
            "salt":"5g60m7PB",
            "md5":"5b8ec3df6e2cd0a445b5e24efd19b60c",
            "sha1":"e5481df672958551afbd0b4e801ca8c5a2202eac",
            "sha256":"60ab2c9319f8edd0fc2bffefbc74260f902f449cca386b6c17731d64c884a3da",
            "registered":"1342636694",
            "dob":"153610753",
            "phone":"(920)-333-5269",
            "cell":"(350)-652-4182",
            "SSN":"614-75-7283",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/11.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/11.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/11.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"306385e47efed0ce"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"tonya",
                "last":"jordan"
            },
            "location":{
                "street":"3579 wheeler ridge dr",
                "city":"flowermound",
                "state":"oklahoma",
                "zip":"56510"
            },
            "email":"tonya.jordan33@example.com",
            "username":"lazyfrog9",
            "password":"precious",
            "salt":"WdMYsYDe",
            "md5":"02fd5f7330826af32e2a41384077edf8",
            "sha1":"1b6e5490161ab3d712d9461413d4444eee49c1c8",
            "sha256":"b3a7aa42548db5b65db9fd4f8ed352fd2d01025881a1aef078f540ceb2cc8085",
            "registered":"1331868807",
            "dob":"292596956",
            "phone":"(112)-889-4875",
            "cell":"(909)-552-5586",
            "SSN":"960-45-6782",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/22.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/22.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/22.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"66a7b13696be02dc"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"roger",
                "last":"stephens"
            },
            "location":{
                "street":"8944 green rd",
                "city":"rochester",
                "state":"rhode island",
                "zip":"89970"
            },
            "email":"roger.stephens71@example.com",
            "username":"ticklishrabbit636",
            "password":"bryan1",
            "salt":"aBX4k5vW",
            "md5":"206c90df6937b9732646deb007ce7a51",
            "sha1":"41762e376d92dfb34ff2904d4a71d4875661d501",
            "sha256":"1a6dea8006b30ad1f1ff7e9ccf7022f753ddccefac7acb68ee7ed014b463c8b1",
            "registered":"1360324609",
            "dob":"412562808",
            "phone":"(417)-945-3743",
            "cell":"(312)-876-9955",
            "SSN":"536-92-1185",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/63.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/63.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/63.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"3591ce466a378e15"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"gene",
                "last":"wallace"
            },
            "location":{
                "street":"1128 adams st",
                "city":"allen",
                "state":"alaska",
                "zip":"11107"
            },
            "email":"gene.wallace91@example.com",
            "username":"bluelion276",
            "password":"emilia",
            "salt":"VkhKteu3",
            "md5":"18f6ba0231ae236fb75cfe6348cdca8d",
            "sha1":"ef28c5de2a8353c546e7a09bbf20d5fc25b7ac1b",
            "sha256":"aa89bed4f0477ecfe41181e152d9623bc8d1521aa81d25e2a85cb6a05cf4de42",
            "registered":"1044416154",
            "dob":"141441240",
            "phone":"(673)-393-7931",
            "cell":"(132)-779-2998",
            "SSN":"669-85-3679",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/9.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/9.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/9.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7558d5bc6e9521f5"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"kylie",
                "last":"peterson"
            },
            "location":{
                "street":"4595 poplar dr",
                "city":"albany",
                "state":"california",
                "zip":"17668"
            },
            "email":"kylie.peterson38@example.com",
            "username":"blackgorilla230",
            "password":"utopia",
            "salt":"nQ3TovID",
            "md5":"b35896a3c65e9557fab6e0f22a20540d",
            "sha1":"02c2d4fd0c29ea007003ef638bf5d387e89f6df7",
            "sha256":"496ff0d33b2acb162b14c29b36b557bf119772deeeb0d67e0d68d2ec0e39e5b1",
            "registered":"1057781452",
            "dob":"247685152",
            "phone":"(337)-665-9677",
            "cell":"(531)-127-8486",
            "SSN":"771-68-8445",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/0.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/0.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/0.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"2fea98af722d1fb5"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"cassandra",
                "last":"ward"
            },
            "location":{
                "street":"6097 forest ln",
                "city":"rio rancho",
                "state":"kansas",
                "zip":"44728"
            },
            "email":"cassandra.ward48@example.com",
            "username":"bigostrich366",
            "password":"55bgates",
            "salt":"Vx42nrf0",
            "md5":"67d52a6e2264a1a021c8426142044335",
            "sha1":"2ba8965c3eb6ba1c640416610ac6d0ef0cd2cd27",
            "sha256":"016414f5235b2e2bb99672f54f9d3b637a4ad7ce4ed82ed5d89fe0253123639c",
            "registered":"1365231471",
            "dob":"289198993",
            "phone":"(809)-597-9843",
            "cell":"(460)-389-6901",
            "SSN":"720-29-8856",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/34.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/34.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/34.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"02588515474084c4"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"amy",
                "last":"watson"
            },
            "location":{
                "street":"2626 cherry st",
                "city":"addison",
                "state":"louisiana",
                "zip":"54800"
            },
            "email":"amy.watson70@example.com",
            "username":"orangefrog920",
            "password":"angel1",
            "salt":"BhYHwLP0",
            "md5":"8f0e2c4a06500fcbf536573362b00378",
            "sha1":"01709422e2341f1aa523a0c88adcf1eaacbf7c18",
            "sha256":"21d60d467ac5b0b4aed0742259f99bc3d16edc07bf142b09c856d868fdad9e3c",
            "registered":"995826488",
            "dob":"298605573",
            "phone":"(244)-294-8426",
            "cell":"(578)-219-9196",
            "SSN":"990-49-7152",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/41.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/41.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/41.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"f9bf679547371e63"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"carter",
                "last":"duncan"
            },
            "location":{
                "street":"6661 ash dr",
                "city":"grand prairie",
                "state":"new hampshire",
                "zip":"22659"
            },
            "email":"carter.duncan67@example.com",
            "username":"heavybear254",
            "password":"wwwwwwww",
            "salt":"mFk72PoY",
            "md5":"6a9d79cee1640415371e60067ab39bc0",
            "sha1":"88c72fd0bd9c1af847c0da91de225f53821ab31a",
            "sha256":"e55286bcb793b71fe455126386ec0fa1fe39bca83025b11f5de18f5eed50fb9e",
            "registered":"963659093",
            "dob":"273841255",
            "phone":"(614)-925-9901",
            "cell":"(891)-893-1935",
            "SSN":"297-85-2039",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/26.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/26.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/26.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"6a740e6566420af2"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"alyssa",
                "last":"barnes"
            },
            "location":{
                "street":"6977 white oak dr",
                "city":"los angeles",
                "state":"iowa",
                "zip":"92273"
            },
            "email":"alyssa.barnes79@example.com",
            "username":"blackduck71",
            "password":"sprinter",
            "salt":"Uy4CIi4H",
            "md5":"382a8e8f84a22a0e9e8d5991babca8d3",
            "sha1":"a24cd2471ce0d91e990a8b8d8f8c6774b8d3dfb8",
            "sha256":"027f9ea42fd3b1a9a6604e8a1d993581001fd88cb8722cf39aae5522fac23bf7",
            "registered":"1385281928",
            "dob":"268418707",
            "phone":"(870)-525-9134",
            "cell":"(359)-160-5409",
            "SSN":"981-23-5790",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/65.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/65.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/65.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"12e53428853c1ac5"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"denise",
                "last":"martin"
            },
            "location":{
                "street":"1821 robinson rd",
                "city":"utica",
                "state":"connecticut",
                "zip":"70672"
            },
            "email":"denise.martin41@example.com",
            "username":"redbear157",
            "password":"monty1",
            "salt":"jWZUnxaS",
            "md5":"b602482827466ed878d57dc4e7102f09",
            "sha1":"7ee633176c7811aa585f92230246367d2d7981ef",
            "sha256":"0dbda630cabfbcdebc255c54bbc98dd4189b6416799eb88387b6351b9aab3dd4",
            "registered":"1286763363",
            "dob":"49389657",
            "phone":"(749)-559-7719",
            "cell":"(413)-370-9019",
            "SSN":"122-61-9056",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/21.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/21.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/21.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"f2093ee96d2a97ce"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"ross",
                "last":"morris"
            },
            "location":{
                "street":"5254 lovers ln",
                "city":"eureka",
                "state":"west virginia",
                "zip":"53235"
            },
            "email":"ross.morris35@example.com",
            "username":"tinytiger548",
            "password":"thanatos",
            "salt":"yq4MxBtQ",
            "md5":"2df4c8e8f1ed819d200fbf94bcc241bb",
            "sha1":"4fa80ee545486dd86936046ef5dd0647e7001eec",
            "sha256":"f682f1ff7ebcc72a84693be66c17fda58c4b12975b697616890e51cf07b2fefc",
            "registered":"1240934816",
            "dob":"228171311",
            "phone":"(727)-918-9792",
            "cell":"(608)-955-3744",
            "SSN":"478-98-4287",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/73.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/73.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/73.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"e50f8d9345ac71d9"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"herminia",
                "last":"fowler"
            },
            "location":{
                "street":"5894 w campbell ave",
                "city":"dumas",
                "state":"virginia",
                "zip":"88145"
            },
            "email":"herminia.fowler57@example.com",
            "username":"crazylion514",
            "password":"smoker",
            "salt":"XBsDprgu",
            "md5":"0149632b43b2aa8a00022fb5b4a88037",
            "sha1":"efd68755f51cf2307f87776d5e5ec62098b39ed9",
            "sha256":"f76c8042cc4500803f213269e341ee693834ea9a4d7a0c25bc2dec9f2679f00f",
            "registered":"1058876105",
            "dob":"371564829",
            "phone":"(414)-664-7866",
            "cell":"(794)-992-3432",
            "SSN":"331-81-5879",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/5.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/5.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/5.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"c3355b0c643208e9"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"melissa",
                "last":"fletcher"
            },
            "location":{
                "street":"5646 paddock way",
                "city":"eugene",
                "state":"idaho",
                "zip":"20505"
            },
            "email":"melissa.fletcher93@example.com",
            "username":"purplebear571",
            "password":"sweetie",
            "salt":"6vAkea7v",
            "md5":"98c49f5327f1229ebb9ae98a98e9d4ac",
            "sha1":"fba927b54fa4dc6a341f142c15fbe4b2259722df",
            "sha256":"68f626680eb2a30c179f860f4f55345c3ff89b7019146d57db82c832aba74abc",
            "registered":"971331439",
            "dob":"474916896",
            "phone":"(707)-932-6639",
            "cell":"(731)-747-3792",
            "SSN":"158-10-6899",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/71.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/71.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/71.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"018d8b7daeeabb41"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"crystal",
                "last":"allen"
            },
            "location":{
                "street":"1748 central st",
                "city":"new haven",
                "state":"oklahoma",
                "zip":"18577"
            },
            "email":"crystal.allen25@example.com",
            "username":"blueduck18",
            "password":"angus",
            "salt":"7idUF5nB",
            "md5":"7bba0b91bd467e841a120f4e631ceafc",
            "sha1":"6c6d17dd0216a4b1b2649f10e4bedaa2665320e2",
            "sha256":"7330267df017bfd9b1000f7af32e2f5f02d6fa8bd644f4576a71358482847313",
            "registered":"962627335",
            "dob":"226323821",
            "phone":"(205)-292-7052",
            "cell":"(288)-843-4445",
            "SSN":"494-74-8187",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/18.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/18.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/18.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"a19eaaff14a67cfd"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"wendy",
                "last":"freeman"
            },
            "location":{
                "street":"5101 lovers ln",
                "city":"shelby",
                "state":"california",
                "zip":"85716"
            },
            "email":"wendy.freeman40@example.com",
            "username":"biggorilla989",
            "password":"123321",
            "salt":"c5mLkK0B",
            "md5":"9669e0eb6e7e1168e3fda6c1419f55bd",
            "sha1":"900cc697f2f1fd94dd639664510dd8f561676c68",
            "sha256":"48208e759b14073b1687e6d601a4c1b27c1c5df2c92165579eedf393e686cb09",
            "registered":"994189147",
            "dob":"312573309",
            "phone":"(522)-144-5196",
            "cell":"(323)-862-3853",
            "SSN":"255-66-8785",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/36.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/36.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/36.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"c7e2c80707888331"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"eduardo",
                "last":"marshall"
            },
            "location":{
                "street":"7595 e north st",
                "city":"helena",
                "state":"tennessee",
                "zip":"82333"
            },
            "email":"eduardo.marshall50@example.com",
            "username":"purplesnake540",
            "password":"archange",
            "salt":"IdjtCMug",
            "md5":"b0936cae3393e11418e16f254b954378",
            "sha1":"5b8fc329e52a133bcbeb770309fdce6986b219ec",
            "sha256":"85521843f2c9c58f2d839dbd10174804e5a29d498c32e86ab5f3fb1c3e080650",
            "registered":"1281485774",
            "dob":"203943140",
            "phone":"(470)-645-2680",
            "cell":"(959)-624-7558",
            "SSN":"729-86-2987",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/63.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/63.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/63.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"9c639e9c72af705a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"julie",
                "last":"grant"
            },
            "location":{
                "street":"2480 lakeview st",
                "city":"stanley",
                "state":"indiana",
                "zip":"44275"
            },
            "email":"julie.grant48@example.com",
            "username":"greengoose383",
            "password":"idiot",
            "salt":"RIPP97RL",
            "md5":"302f4ee6eb5d6028154dfea3faf4ea95",
            "sha1":"2280a244fde55e88a03b5a0d585863ae3042b3fe",
            "sha256":"9db0ad90d477c2607d5a1e2337b8f0c5d4ad804f3e1b67e138c8f9c7e2484101",
            "registered":"1019205142",
            "dob":"178236364",
            "phone":"(914)-857-3797",
            "cell":"(985)-732-9383",
            "SSN":"483-76-7894",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/11.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/11.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/11.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"26a9e56107b37828"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"douglas",
                "last":"davis"
            },
            "location":{
                "street":"9688 e little york rd",
                "city":"providence",
                "state":"maryland",
                "zip":"81065"
            },
            "email":"douglas.davis39@example.com",
            "username":"orangegoose178",
            "password":"miami",
            "salt":"kufess6G",
            "md5":"636e1e3b566fe98c39fecfa19c988e6b",
            "sha1":"59757ede91b4ca576de0f3b7da894a3dd3703124",
            "sha256":"8fec2bf24db7c049d6dfe81c48aa35bf9e26cc0836393578ecafbe8994717f8b",
            "registered":"1356638820",
            "dob":"46960410",
            "phone":"(851)-648-7657",
            "cell":"(193)-909-4855",
            "SSN":"710-36-9693",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/68.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/68.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/68.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"96d3721965dfef01"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"candice",
                "last":"morris"
            },
            "location":{
                "street":"8779 taylor st",
                "city":"long beach",
                "state":"nevada",
                "zip":"52806"
            },
            "email":"candice.morris23@example.com",
            "username":"silversnake949",
            "password":"yankee",
            "salt":"KtpKIAzX",
            "md5":"ce5dd8d172d2ea9f95b19d004ec98921",
            "sha1":"42c30c657c5674a273f39ec6403d2033f785d86d",
            "sha256":"958dbba1d3a882906685848f92ed31911c8979ac937c745b2e141b7384175782",
            "registered":"1143749048",
            "dob":"482219683",
            "phone":"(610)-497-8925",
            "cell":"(863)-751-9201",
            "SSN":"938-18-2117",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/14.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/14.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/14.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"83e28de0318c979e"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"jack",
                "last":"stevens"
            },
            "location":{
                "street":"9403 sunset st",
                "city":"sacramento",
                "state":"kentucky",
                "zip":"20887"
            },
            "email":"jack.stevens83@example.com",
            "username":"silverbutterfly500",
            "password":"calling",
            "salt":"m26wwJyn",
            "md5":"58f3421a4a890a71a59f737d4404956e",
            "sha1":"adcf872c01711d60bd4eeb1b59c3a1c6b9185efa",
            "sha256":"565c3fc8ea904ed943b5870613e5faca499a8d315be9539336134667d1089270",
            "registered":"1352502803",
            "dob":"189012350",
            "phone":"(554)-629-3489",
            "cell":"(385)-651-2876",
            "SSN":"119-11-6308",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/16.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/16.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/16.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"75c21721c03b9d97"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"barry",
                "last":"williamson"
            },
            "location":{
                "street":"3333 karen dr",
                "city":"san jose",
                "state":"wisconsin",
                "zip":"60471"
            },
            "email":"barry.williamson42@example.com",
            "username":"smallfish358",
            "password":"1066",
            "salt":"jCsCW0o4",
            "md5":"1137c9e0a13ffa62bf63667a1f55c36f",
            "sha1":"90ea018826814532fc965203e8ed3eb78029ac3d",
            "sha256":"fa0c98e01b70f5b6f504cd74f7b55445b8e8a3f08757d11bb6b3616859ffad29",
            "registered":"1383027649",
            "dob":"292250760",
            "phone":"(691)-421-5018",
            "cell":"(637)-421-7586",
            "SSN":"314-60-6488",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/60.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/60.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/60.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"684eefcc063489da"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"christina",
                "last":"stevens"
            },
            "location":{
                "street":"7032 green rd",
                "city":"helena",
                "state":"oklahoma",
                "zip":"49340"
            },
            "email":"christina.stevens22@example.com",
            "username":"orangefish828",
            "password":"police",
            "salt":"EoQju0RA",
            "md5":"d3195f414639edd2f2a1cd4ebe469633",
            "sha1":"6047a7df501fa6a191fbcc39296e6b7e72b2574e",
            "sha256":"42db779b0fea4cb94b02fe1287e056abbcd7c38b1061d099b5a171b549bf2e8b",
            "registered":"1058896497",
            "dob":"229950603",
            "phone":"(556)-962-2161",
            "cell":"(747)-466-9680",
            "SSN":"194-30-4240",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/35.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/35.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/35.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"19f25a9edc452ed1"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"hazel",
                "last":"powell"
            },
            "location":{
                "street":"1640 pockrus page rd",
                "city":"long beach",
                "state":"vermont",
                "zip":"95438"
            },
            "email":"hazel.powell19@example.com",
            "username":"lazysnake722",
            "password":"willow",
            "salt":"xEjLSwlh",
            "md5":"9a2e7970286cc519babf57b03b55c98b",
            "sha1":"1cdee2acec5a19461e136ceffcf27a06b2f04d2b",
            "sha256":"0fca3057a04215fcc9cc15c921efb366ee6236e27c2e97dfb9895bab994c45fb",
            "registered":"1395929582",
            "dob":"183758835",
            "phone":"(192)-359-7483",
            "cell":"(499)-912-8584",
            "SSN":"193-24-2872",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/41.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/41.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/41.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"56ef416ef08e2f04"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"levi",
                "last":"hunt"
            },
            "location":{
                "street":"9164 hogan st",
                "city":"seagoville",
                "state":"north dakota",
                "zip":"29338"
            },
            "email":"levi.hunt41@example.com",
            "username":"smallbutterfly154",
            "password":"bigfoot",
            "salt":"yr0yfu0e",
            "md5":"4043abe35d50bce97dc241faeae591e1",
            "sha1":"452c766c34cd860d0c1c94ed9f30210db3322738",
            "sha256":"3ddeccbd5f6d6fbd418c83d370d11edf29540bab0bac2a5ff49dcd81c35d0763",
            "registered":"1384125831",
            "dob":"6249290",
            "phone":"(137)-800-1918",
            "cell":"(117)-841-1956",
            "SSN":"259-80-1891",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/79.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/79.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/79.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"a85a4490924cb38a"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"wyatt",
                "last":"davis"
            },
            "location":{
                "street":"6619 edwards rd",
                "city":"princeton",
                "state":"new hampshire",
                "zip":"75337"
            },
            "email":"wyatt.davis22@example.com",
            "username":"blackleopard457",
            "password":"thumbnils",
            "salt":"Fl816Sty",
            "md5":"a4565f8eea3321a6db505fe2f580308d",
            "sha1":"329741ca227ae00973b6dd18287d424ac40b9ab4",
            "sha256":"74a665ed6563f3cb6b0cf576fe853f283e2406fbd385719aa5b25bf67977a4b2",
            "registered":"917387662",
            "dob":"312434873",
            "phone":"(805)-392-4010",
            "cell":"(997)-620-6996",
            "SSN":"944-89-8285",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/18.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/18.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/18.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"f9f96eb10138e53e"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"seth",
                "last":"gardner"
            },
            "location":{
                "street":"5437 lakeshore rd",
                "city":"nashville",
                "state":"new hampshire",
                "zip":"72809"
            },
            "email":"seth.gardner98@example.com",
            "username":"whitekoala554",
            "password":"444444",
            "salt":"3DyvBooO",
            "md5":"1c1a5629ae48cdaa2cf127e58e5419e4",
            "sha1":"d1c9d9b272c24da58cdde93e2022e908a4cfde3a",
            "sha256":"b843781113bcfdbe04cfc16ebd5bdb257fb9805df7400a265456015e86d3a33e",
            "registered":"1397868247",
            "dob":"22829736",
            "phone":"(996)-172-6343",
            "cell":"(547)-483-2306",
            "SSN":"543-32-8478",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/73.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/73.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/73.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"ce9893b9f71a8397"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"marvin",
                "last":"morgan"
            },
            "location":{
                "street":"9113 marsh ln",
                "city":"pittsburgh",
                "state":"new york",
                "zip":"36262"
            },
            "email":"marvin.morgan46@example.com",
            "username":"silversnake592",
            "password":"sister",
            "salt":"CD10SeNd",
            "md5":"efd146fb3688a02bad6c8b0e6138b2a4",
            "sha1":"8b40cf55873394ca400259a3a0a464b71b5848a4",
            "sha256":"49754d6d7871d9a5afdb31ff27e60126f7b4d3684b0b4ec2353dc2b5c6bc23de",
            "registered":"1342997885",
            "dob":"161364898",
            "phone":"(989)-132-7743",
            "cell":"(493)-752-1276",
            "SSN":"304-94-8460",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/7.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/7.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/7.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"575934590bd7b824"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"louis",
                "last":"hoffman"
            },
            "location":{
                "street":"5122 fincher rd",
                "city":"helena",
                "state":"mississippi",
                "zip":"11881"
            },
            "email":"louis.hoffman49@example.com",
            "username":"silvergoose519",
            "password":"raven1",
            "salt":"7SJpjgC6",
            "md5":"e6e9c1229bea7dc67cc11dea71573a87",
            "sha1":"bb2a1545739c1ba64334e28d6b0ba53e825e2b3b",
            "sha256":"c833198c99acbf4263c24c4f483e5f38369172b0d626f4af5de8931b73f8c70d",
            "registered":"948923227",
            "dob":"318464447",
            "phone":"(714)-588-6499",
            "cell":"(185)-775-9863",
            "SSN":"710-57-1718",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/53.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/53.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/53.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"3ac028961b0a6fb3"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"vernon",
                "last":"myers"
            },
            "location":{
                "street":"8962 thornridge cir",
                "city":"arlington",
                "state":"kentucky",
                "zip":"48556"
            },
            "email":"vernon.myers89@example.com",
            "username":"organicrabbit533",
            "password":"server",
            "salt":"9QUpwqSU",
            "md5":"9e0c8e316eeea0b866edb327af2b5049",
            "sha1":"a4905ac44c2a82e9b5ee46c10dc03fd78d8b511e",
            "sha256":"1f5f4bc341e398e2416a7fecba41931380088067fa75f94a5e0ad065a5063a22",
            "registered":"1011104908",
            "dob":"120069645",
            "phone":"(877)-607-7399",
            "cell":"(463)-527-7174",
            "SSN":"288-39-7122",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/39.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/39.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/39.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"601324356611c76e"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"michael",
                "last":"stanley"
            },
            "location":{
                "street":"3591 northaven rd",
                "city":"spokane",
                "state":"south carolina",
                "zip":"65536"
            },
            "email":"michael.stanley80@example.com",
            "username":"goldengorilla941",
            "password":"karen",
            "salt":"YxzqpFSI",
            "md5":"d3aac1331467d09a9846120cb758aa27",
            "sha1":"139c47815ab7a58522064de901f699493c07e65c",
            "sha256":"f621166ca9c6af623e74d517424519d554b4a177010618c85959a8ccae1ba8cc",
            "registered":"1073903437",
            "dob":"30517571",
            "phone":"(749)-645-1781",
            "cell":"(107)-795-3707",
            "SSN":"461-40-2491",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/54.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/54.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/54.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"6c11646c0a6324ac"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"clifton",
                "last":"may"
            },
            "location":{
                "street":"4886 nowlin rd",
                "city":"pittsburgh",
                "state":"mississippi",
                "zip":"11257"
            },
            "email":"clifton.may27@example.com",
            "username":"lazyladybug897",
            "password":"flasher",
            "salt":"C4hvjgpo",
            "md5":"c41815c9ce309db0714835b6e329e9a2",
            "sha1":"c46020d5575496cb3f1f3365733f3984966ae5cf",
            "sha256":"e8c2f57d81e2810382a7fddd8caf601bb8d197c260c56706c626f3de71b3a7a9",
            "registered":"1164854467",
            "dob":"137325896",
            "phone":"(615)-882-3924",
            "cell":"(910)-897-2797",
            "SSN":"787-89-2716",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/41.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/41.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/41.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"bb2f523cba9e1195"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"joann",
                "last":"oliver"
            },
            "location":{
                "street":"1148 dane st",
                "city":"grants pass",
                "state":"minnesota",
                "zip":"54722"
            },
            "email":"joann.oliver85@example.com",
            "username":"bluemouse316",
            "password":"backbone",
            "salt":"KsC6NRNU",
            "md5":"01c8b2483e1e5540ff2d1cb46d8433bc",
            "sha1":"24a09f6fd6bab759bfe250316896cfd3e486ad3c",
            "sha256":"3f9540230beb3e808f4714e4f16620730942409a778c984ab02f9af0ed3bcc7c",
            "registered":"1106348215",
            "dob":"319719040",
            "phone":"(342)-168-6776",
            "cell":"(226)-151-1212",
            "SSN":"738-32-4813",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/28.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/28.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/28.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"060952788034ae1d"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"sean",
                "last":"burton"
            },
            "location":{
                "street":"6894 spring st",
                "city":"allen",
                "state":"delaware",
                "zip":"80285"
            },
            "email":"sean.burton52@example.com",
            "username":"heavyladybug225",
            "password":"color",
            "salt":"2geGm0L4",
            "md5":"544bbd3ef7a21ea3d0bf7e22c6456683",
            "sha1":"d359fce3a439770d8f94e7a830e85f695be56171",
            "sha256":"b093f20e61985a8b5f06a36955f059a899510791731804f461bb41412f5840ae",
            "registered":"1090987799",
            "dob":"63442632",
            "phone":"(787)-250-4304",
            "cell":"(583)-816-1798",
            "SSN":"591-77-3247",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/10.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/10.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/10.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"d33af135e341d00a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"carole",
                "last":"barrett"
            },
            "location":{
                "street":"7341 e sandy lake rd",
                "city":"stockton",
                "state":"wisconsin",
                "zip":"58704"
            },
            "email":"carole.barrett22@example.com",
            "username":"smallgorilla918",
            "password":"kittycat",
            "salt":"pk6uNo7X",
            "md5":"5da09fe49cb651a1fb445820fcdc9510",
            "sha1":"1127fa1a7c88c47ad235e8245671ebb93d37f73a",
            "sha256":"fb8a3569dff5f4fdf24b25187469a27e21705afc1e3a50b99c28fcf38794ab9d",
            "registered":"1035684176",
            "dob":"445320955",
            "phone":"(174)-985-5579",
            "cell":"(844)-662-4722",
            "SSN":"968-56-3651",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/43.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/43.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/43.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"7d1d1d0aa5daec24"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"brad",
                "last":"carr"
            },
            "location":{
                "street":"2194 poplar dr",
                "city":"columbus",
                "state":"florida",
                "zip":"33702"
            },
            "email":"brad.carr36@example.com",
            "username":"smallgorilla737",
            "password":"lobo",
            "salt":"KwtKFe1I",
            "md5":"154e91f8d6fa7895606ff7918a186c8d",
            "sha1":"240799162ec0b6d6a0c17f850ccbe2e71e5d176e",
            "sha256":"a70ebe14d812a4b0aa0131696a570c202e9e922d4afeec8eb0f46e67de8435ba",
            "registered":"1299521744",
            "dob":"190980394",
            "phone":"(960)-967-8638",
            "cell":"(737)-631-2224",
            "SSN":"143-50-4051",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/70.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/70.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/70.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"2cff0e19f5d93f2e"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"john",
                "last":"grant"
            },
            "location":{
                "street":"4599 shady ln dr",
                "city":"desoto",
                "state":"maine",
                "zip":"39593"
            },
            "email":"john.grant71@example.com",
            "username":"lazybear981",
            "password":"cavalier",
            "salt":"eX1LcplN",
            "md5":"6ef83c21e79d52f94b641a893c2d08ff",
            "sha1":"e8d79400d4f2b4bd665ca28dcdc22ff61b8bf7c1",
            "sha256":"ebead4ce9041576d8011ab8d7cc3627243e7977d562775907cdd5d1587b158b5",
            "registered":"1079048131",
            "dob":"254505585",
            "phone":"(708)-664-5173",
            "cell":"(840)-684-7145",
            "SSN":"101-60-8579",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/27.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/27.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/27.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"677dcd1e6f6aeef9"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"kay",
                "last":"george"
            },
            "location":{
                "street":"6939 prospect rd",
                "city":"cupertino",
                "state":"oregon",
                "zip":"51645"
            },
            "email":"kay.george74@example.com",
            "username":"greensnake947",
            "password":"cruise",
            "salt":"GasUFhEM",
            "md5":"26f07e0b7584c65c2532d4f9a0ca18f9",
            "sha1":"68630e6d05f25e67f35317e29e9f98f10599ac37",
            "sha256":"03a8ebd0ed1ac1b62701a5805a2fc2ae57c7eb122b0768abf232ff20ce8ec8bd",
            "registered":"1120150315",
            "dob":"183516208",
            "phone":"(452)-903-9637",
            "cell":"(121)-941-2718",
            "SSN":"566-94-6475",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/57.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/57.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/57.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"ab64778822451204"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"owen",
                "last":"carlson"
            },
            "location":{
                "street":"1639 locust rd",
                "city":"los lunas",
                "state":"michigan",
                "zip":"43728"
            },
            "email":"owen.carlson46@example.com",
            "username":"purplegorilla50",
            "password":"clay",
            "salt":"01eFZw6U",
            "md5":"a45de4a64d92e3d712a61551849b615c",
            "sha1":"28d82523733ccb6924fb23d69f304602d8cf3aaa",
            "sha256":"c976e81ca58f14dd70a053889f5e608157a25273cd95b5aa5e37ac9017a6807e",
            "registered":"1171847375",
            "dob":"424603388",
            "phone":"(789)-603-8300",
            "cell":"(738)-527-7005",
            "SSN":"859-29-8576",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/6.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/6.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/6.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"a40125829e46e1d8"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"rosa",
                "last":"edwards"
            },
            "location":{
                "street":"4325 hickory creek dr",
                "city":"seagoville",
                "state":"ohio",
                "zip":"48548"
            },
            "email":"rosa.edwards77@example.com",
            "username":"ticklishladybug926",
            "password":"hotgirls",
            "salt":"eKpcfUBs",
            "md5":"c3df0bc279338acee1f5dbbf17632c99",
            "sha1":"22e7a7f092bfd7ae6c06117c337a579b7ad57e4f",
            "sha256":"11f216e752a01502904d7bc0c4bc80f330d5efb55b02bb58264fbaf2060e57a3",
            "registered":"1298992901",
            "dob":"143891178",
            "phone":"(339)-300-7289",
            "cell":"(218)-870-2028",
            "SSN":"335-70-3190",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/9.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/9.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/9.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"8f5c95aec07ccee9"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"bill",
                "last":"bradley"
            },
            "location":{
                "street":"2268 camden ave",
                "city":"las vegas",
                "state":"connecticut",
                "zip":"93899"
            },
            "email":"bill.bradley13@example.com",
            "username":"lazylion520",
            "password":"cirrus",
            "salt":"Ey2fTXwE",
            "md5":"dd63b708699002bfb2b93870f3211ffc",
            "sha1":"5364f3484fdb9f9a3d94df57f9a6a8f5300fe31d",
            "sha256":"f78aa4ec156712cb6b2ff3296fb71bd854c996bfe4b4801e7c4e95de4bb60e9f",
            "registered":"1179619022",
            "dob":"176602272",
            "phone":"(146)-301-2298",
            "cell":"(157)-494-1117",
            "SSN":"308-43-5372",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/52.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/52.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/52.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"76acf4483b3d7921"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"tracey",
                "last":"miller"
            },
            "location":{
                "street":"3395 mcgowen st",
                "city":"tacoma",
                "state":"utah",
                "zip":"62632"
            },
            "email":"tracey.miller12@example.com",
            "username":"redbird248",
            "password":"fatima",
            "salt":"TpTP4h0j",
            "md5":"9019f370b23ba764cb2c7287798b2e30",
            "sha1":"46b4b355cfb14fc6dc6d7988a18e724efe414046",
            "sha256":"5c7f78dbca291ed47b5f9ca556bd066388dd64e23b7cb4513e5deb3218dbe4d0",
            "registered":"988220374",
            "dob":"294624426",
            "phone":"(482)-990-1552",
            "cell":"(264)-995-8194",
            "SSN":"214-88-9535",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/30.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/30.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/30.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"bca7a6d1b3227be3"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"bella",
                "last":"kennedy"
            },
            "location":{
                "street":"8408 prospect rd",
                "city":"columbus",
                "state":"vermont",
                "zip":"79050"
            },
            "email":"bella.kennedy92@example.com",
            "username":"greenkoala555",
            "password":"small",
            "salt":"rB9snkyX",
            "md5":"075f95c60ec057bae012d283cf95c1f7",
            "sha1":"056fdd15e9f305a8ac663b31414767eb71e2f5c5",
            "sha256":"a19e4acab718fdb7b8949c18e55849542d726fe9900c2857c88cf9a502ab287b",
            "registered":"1066684404",
            "dob":"270505449",
            "phone":"(931)-224-6799",
            "cell":"(594)-707-1509",
            "SSN":"303-40-1805",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/13.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/13.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/13.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"683f7771145e762c"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"miss",
                "first":"janet",
                "last":"rice"
            },
            "location":{
                "street":"5826 oak ridge ln",
                "city":"fountain valley",
                "state":"maine",
                "zip":"64649"
            },
            "email":"janet.rice66@example.com",
            "username":"silverpanda45",
            "password":"fuzzy",
            "salt":"y1av4ZZL",
            "md5":"4c190177b56881896a9326cdc4591f45",
            "sha1":"9b61399749bdee3523d44c91006e9aa00cae22ec",
            "sha256":"c364b5f39c559e47a07f40a219a075ce8ff90c77652913a12125832ca0a99168",
            "registered":"1369439365",
            "dob":"477417173",
            "phone":"(853)-840-2378",
            "cell":"(191)-264-7377",
            "SSN":"406-19-5326",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/81.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/81.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/81.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"21d88a39c58d3d9d"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"hilda",
                "last":"campbell"
            },
            "location":{
                "street":"1580 plum st",
                "city":"akron",
                "state":"florida",
                "zip":"25842"
            },
            "email":"hilda.campbell87@example.com",
            "username":"whitepanda243",
            "password":"festival",
            "salt":"UOfhF0l0",
            "md5":"a6cef3fd379656f2d112c887afb4b14e",
            "sha1":"e011f56d6eb3b66f5979747445d9c01b896961a0",
            "sha256":"2ff47605b7dcdf4dd2b245ef6a5d740481d9fc431dc508ee8733eef1c680cf35",
            "registered":"938217366",
            "dob":"446148636",
            "phone":"(739)-118-5365",
            "cell":"(584)-889-4759",
            "SSN":"864-19-3264",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/48.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/48.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/48.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"1b24409664da5330"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"ronnie",
                "last":"mcdonalid"
            },
            "location":{
                "street":"5705 walnut hill ln",
                "city":"duncanville",
                "state":"arizona",
                "zip":"31991"
            },
            "email":"ronnie.mcdonalid61@example.com",
            "username":"crazypanda362",
            "password":"shell",
            "salt":"pRnHqXEx",
            "md5":"d56c15e4bc933b562f4f5c854dc0d3d9",
            "sha1":"f1610b35ad03985db7da9a0037bcc8d63d69eef5",
            "sha256":"4421742ffa46934933fcc735b7f48d81f9beb11599a0539bdd8383837b03709a",
            "registered":"939335339",
            "dob":"165878626",
            "phone":"(439)-250-4342",
            "cell":"(488)-123-2260",
            "SSN":"918-87-6797",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/70.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/70.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/70.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"4bd25dfc57aef385"
    },
    {
        "user":{
            "gender":"male",
            "name":{
                "title":"mr",
                "first":"roland",
                "last":"hale"
            },
            "location":{
                "street":"3103 woodland st",
                "city":"mesquite",
                "state":"connecticut",
                "zip":"89727"
            },
            "email":"roland.hale57@example.com",
            "username":"bluewolf686",
            "password":"cougars",
            "salt":"JHZhKxFe",
            "md5":"095d66c12df3dfced0eebfa7b1d385b2",
            "sha1":"a8763a37aff94429ef92843ad11c3434aa579a52",
            "sha256":"b4c10dd6da0ea750f9ccd255ad0ef645bf54af0c24bdd0de5f9efae1b7312b13",
            "registered":"938365316",
            "dob":"181213329",
            "phone":"(562)-853-8677",
            "cell":"(235)-872-6222",
            "SSN":"464-69-5509",
            "picture":{
                "large":"http://api.randomuser.me/portraits/men/38.jpg",
                "medium":"http://api.randomuser.me/portraits/med/men/38.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/men/38.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"2d4ddc9c0374229a"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"june",
                "last":"washington"
            },
            "location":{
                "street":"6911 timber wolf trail",
                "city":"los angeles",
                "state":"minnesota",
                "zip":"66795"
            },
            "email":"june.washington23@example.com",
            "username":"bigelephant12",
            "password":"condom",
            "salt":"mS5vlqEt",
            "md5":"d4c3057454312220ce776c2303ea9d3e",
            "sha1":"06713c3b683b3a29aa6686f9bcc715ba7fda5612",
            "sha256":"ec70e0fb3f19192e252cbb6810a04885ba6df3991c7ad8ca2637505513d735ae",
            "registered":"1211097354",
            "dob":"440346587",
            "phone":"(966)-840-5291",
            "cell":"(648)-621-9419",
            "SSN":"232-10-4425",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/48.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/48.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/48.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"c1dfe94424234855"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"mrs",
                "first":"jamie",
                "last":"caldwell"
            },
            "location":{
                "street":"2071 bruce st",
                "city":"evansville",
                "state":"new mexico",
                "zip":"63484"
            },
            "email":"jamie.caldwell25@example.com",
            "username":"greenbutterfly329",
            "password":"fettish",
            "salt":"RBUFgc4y",
            "md5":"ac47ae10ba5c134856135270ea323c98",
            "sha1":"f99ffb7c66ed05e92913d070af56b878ad8b4e49",
            "sha256":"cb8cde12b6ca3a106b0f840d79e2da29405a6226a28507776be3656ef7d37a53",
            "registered":"1175987664",
            "dob":"374381997",
            "phone":"(501)-666-1585",
            "cell":"(925)-603-2272",
            "SSN":"809-12-6941",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/44.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/44.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/44.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"710ce026642dd6cf"
    },
    {
        "user":{
            "gender":"female",
            "name":{
                "title":"ms",
                "first":"glenda",
                "last":"ferguson"
            },
            "location":{
                "street":"6805 country club rd",
                "city":"bozeman",
                "state":"new hampshire",
                "zip":"50140"
            },
            "email":"glenda.ferguson68@example.com",
            "username":"purpleladybug454",
            "password":"jayhawk",
            "salt":"RdUDQZKL",
            "md5":"a7d17d51754b4e0fce18bbf4dfb6f2f0",
            "sha1":"a94d7f6c4d4f216c8ffe55f1d8b8e3b3a1374160",
            "sha256":"5aac203f5e300d20b69caaff1e7998a14095d65a8d354f10c8e217de048c5792",
            "registered":"1020660980",
            "dob":"22633480",
            "phone":"(951)-629-2834",
            "cell":"(329)-541-8348",
            "SSN":"979-43-9688",
            "picture":{
                "large":"http://api.randomuser.me/portraits/women/2.jpg",
                "medium":"http://api.randomuser.me/portraits/med/women/2.jpg",
                "thumbnail":"http://api.randomuser.me/portraits/thumb/women/2.jpg"
            },
            "version":"0.4.1"
        },
        "seed":"e57deeb05040343a"
    }
];

module.exports = users.map(function(user){
    return user.user;
});

},{}],14:[function(require,module,exports){
// Is the entity firmer than the new firmness
module.exports = function(entity, firm){
    if(firm != null && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
};
},{}],15:[function(require,module,exports){
var crel = require('crel'),
    containerComponent = require('./containerComponent'),
    setify = require('setify');

var fancyProps = {
    class: function(generic, element, value){
        if(arguments.length === 2){
            return element.className.slice(generic._initialClasses.length);
        }
        if(Array.isArray(value)){
            value = value.join(' ');
        }
        element.className = generic._initialClasses + ' ' + value;
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

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && (key in settings) ? setting : undefined;

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
},{"./containerComponent":3,"crel":20,"setify":175}],16:[function(require,module,exports){
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
},{"./binding":1,"./component":2,"./is":17,"./property":181,"crel":20,"enti":21,"flat-merge":173}],17:[function(require,module,exports){

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
},{}],18:[function(require,module,exports){
var crel = require('crel'),
    Map = require('es6-map'),
    genericComponent = require('./genericComponent');

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
    var list = genericComponent(type, fastn, settings, children),
        itemsMap = new Map();

    function updateItems(value){
        var template = list._settings.template,
            emptyTemplate = list._settings.emptyTemplate;

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

    list.render = function(){
        this.element = crel(settings.tagName || 'div');
        this.emit('render');
    };

    fastn.property([], settings.itemChanges || 'type structure')
        .addTo(list, 'items');

    if(settings.items){
        list.items.binding(settings.items)
            .on('update', updateItems);
    }

    return list;
};
},{"./genericComponent":15,"crel":20,"es6-map":75}],19:[function(require,module,exports){
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
},{"events":187}],20:[function(require,module,exports){
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

},{}],21:[function(require,module,exports){
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

            if(isFilterPath(eventName)){
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

},{"es6-set":22,"es6-weak-map":130,"events":187}],22:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Set : require('./polyfill');

},{"./is-implemented":23,"./polyfill":74}],23:[function(require,module,exports){
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

},{}],24:[function(require,module,exports){
// Exports true if environment provides native `Set` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Set === 'undefined') return false;
	return (Object.prototype.toString.call(Set.prototype) === '[object Set]');
}());

},{}],25:[function(require,module,exports){
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

},{"d":27,"es5-ext/object/set-prototype-of":49,"es5-ext/string/#/contains":54,"es6-iterator":61,"es6-symbol":70}],26:[function(require,module,exports){
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

},{"es5-ext/object/copy":39,"es5-ext/object/map":47,"es5-ext/object/valid-callable":52,"es5-ext/object/valid-value":53}],27:[function(require,module,exports){
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

},{"es5-ext/object/assign":36,"es5-ext/object/is-callable":42,"es5-ext/object/normalize-options":48,"es5-ext/string/#/contains":54}],28:[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

'use strict';

var value = require('../../object/valid-value');

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":53}],29:[function(require,module,exports){
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

},{"../../number/to-pos-integer":34,"../../object/valid-value":53}],30:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Math.sign
	: require('./shim');

},{"./is-implemented":31,"./shim":32}],31:[function(require,module,exports){
'use strict';

module.exports = function () {
	var sign = Math.sign;
	if (typeof sign !== 'function') return false;
	return ((sign(10) === 1) && (sign(-20) === -1));
};

},{}],32:[function(require,module,exports){
'use strict';

module.exports = function (value) {
	value = Number(value);
	if (isNaN(value) || (value === 0)) return value;
	return (value > 0) ? 1 : -1;
};

},{}],33:[function(require,module,exports){
'use strict';

var sign = require('../math/sign')

  , abs = Math.abs, floor = Math.floor;

module.exports = function (value) {
	if (isNaN(value)) return 0;
	value = Number(value);
	if ((value === 0) || !isFinite(value)) return value;
	return sign(value) * floor(abs(value));
};

},{"../math/sign":30}],34:[function(require,module,exports){
'use strict';

var toInteger = require('./to-integer')

  , max = Math.max;

module.exports = function (value) { return max(0, toInteger(value)); };

},{"./to-integer":33}],35:[function(require,module,exports){
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

},{"./is-callable":42,"./valid-callable":52,"./valid-value":53}],36:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.assign
	: require('./shim');

},{"./is-implemented":37,"./shim":38}],37:[function(require,module,exports){
'use strict';

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== 'function') return false;
	obj = { foo: 'raz' };
	assign(obj, { bar: 'dwa' }, { trzy: 'trzy' });
	return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
};

},{}],38:[function(require,module,exports){
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

},{"../keys":44,"../valid-value":53}],39:[function(require,module,exports){
'use strict';

var assign = require('./assign')
  , value  = require('./valid-value');

module.exports = function (obj) {
	var copy = Object(value(obj));
	if (copy !== obj) return copy;
	return assign({}, obj);
};

},{"./assign":36,"./valid-value":53}],40:[function(require,module,exports){
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

},{"./set-prototype-of/is-implemented":50,"./set-prototype-of/shim":51}],41:[function(require,module,exports){
'use strict';

module.exports = require('./_iterate')('forEach');

},{"./_iterate":35}],42:[function(require,module,exports){
// Deprecated

'use strict';

module.exports = function (obj) { return typeof obj === 'function'; };

},{}],43:[function(require,module,exports){
'use strict';

var map = { function: true, object: true };

module.exports = function (x) {
	return ((x != null) && map[typeof x]) || false;
};

},{}],44:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.keys
	: require('./shim');

},{"./is-implemented":45,"./shim":46}],45:[function(require,module,exports){
'use strict';

module.exports = function () {
	try {
		Object.keys('primitive');
		return true;
	} catch (e) { return false; }
};

},{}],46:[function(require,module,exports){
'use strict';

var keys = Object.keys;

module.exports = function (object) {
	return keys(object == null ? object : Object(object));
};

},{}],47:[function(require,module,exports){
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

},{"./for-each":41,"./valid-callable":52}],48:[function(require,module,exports){
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

},{}],49:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? Object.setPrototypeOf
	: require('./shim');

},{"./is-implemented":50,"./shim":51}],50:[function(require,module,exports){
'use strict';

var create = Object.create, getPrototypeOf = Object.getPrototypeOf
  , x = {};

module.exports = function (/*customCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf
	  , customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== 'function') return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), x)) === x;
};

},{}],51:[function(require,module,exports){
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

},{"../create":40,"../is-object":43,"../valid-value":53}],52:[function(require,module,exports){
'use strict';

module.exports = function (fn) {
	if (typeof fn !== 'function') throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],53:[function(require,module,exports){
'use strict';

module.exports = function (value) {
	if (value == null) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{}],54:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')()
	? String.prototype.contains
	: require('./shim');

},{"./is-implemented":55,"./shim":56}],55:[function(require,module,exports){
'use strict';

var str = 'razdwatrzy';

module.exports = function () {
	if (typeof str.contains !== 'function') return false;
	return ((str.contains('dwa') === true) && (str.contains('foo') === false));
};

},{}],56:[function(require,module,exports){
'use strict';

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],57:[function(require,module,exports){
'use strict';

var toString = Object.prototype.toString

  , id = toString.call('');

module.exports = function (x) {
	return (typeof x === 'string') || (x && (typeof x === 'object') &&
		((x instanceof String) || (toString.call(x) === id))) || false;
};

},{}],58:[function(require,module,exports){
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

},{"./":61,"d":27,"es5-ext/object/set-prototype-of":49,"es5-ext/string/#/contains":54}],59:[function(require,module,exports){
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

},{"./get":60,"es5-ext/object/valid-callable":52,"es5-ext/string/is-string":57}],60:[function(require,module,exports){
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

},{"./array":58,"./string":68,"./valid-iterable":69,"es5-ext/string/is-string":57,"es6-symbol":63}],61:[function(require,module,exports){
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

},{"d":27,"d/auto-bind":26,"es5-ext/array/#/clear":28,"es5-ext/object/assign":36,"es5-ext/object/valid-callable":52,"es5-ext/object/valid-value":53,"es6-symbol":63}],62:[function(require,module,exports){
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

},{"es5-ext/string/is-string":57,"es6-symbol":63}],63:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":64,"./polyfill":66}],64:[function(require,module,exports){
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

},{}],65:[function(require,module,exports){
'use strict';

module.exports = function (x) {
	return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
};

},{}],66:[function(require,module,exports){
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

},{"./validate-symbol":67,"d":27}],67:[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":65}],68:[function(require,module,exports){
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

},{"./":61,"d":27,"es5-ext/object/set-prototype-of":49}],69:[function(require,module,exports){
'use strict';

var isIterable = require('./is-iterable');

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":62}],70:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./is-implemented":71,"./polyfill":72,"dup":63}],71:[function(require,module,exports){
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

},{}],72:[function(require,module,exports){
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

},{"d":27}],73:[function(require,module,exports){
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

},{"d":27,"es5-ext/object/valid-callable":52}],74:[function(require,module,exports){
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

},{"./is-native-implemented":24,"./lib/iterator":25,"d":27,"es5-ext/array/#/clear":28,"es5-ext/array/#/e-index-of":29,"es5-ext/object/set-prototype-of":49,"es5-ext/object/valid-callable":52,"es6-iterator/for-of":59,"es6-iterator/valid-iterable":69,"es6-symbol":70,"event-emitter":73}],75:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Map : require('./polyfill');

},{"./is-implemented":76,"./polyfill":129}],76:[function(require,module,exports){
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

},{}],77:[function(require,module,exports){
// Exports true if environment provides native `Map` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof Map === 'undefined') return false;
	return (Object.prototype.toString.call(Map.prototype) === '[object Map]');
}());

},{}],78:[function(require,module,exports){
'use strict';

module.exports = require('es5-ext/object/primitive-set')('key',
	'value', 'key+value');

},{"es5-ext/object/primitive-set":103}],79:[function(require,module,exports){
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

},{"./iterator-kinds":78,"d":81,"es5-ext/object/set-prototype-of":104,"es6-iterator":116,"es6-symbol":125}],80:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"dup":26,"es5-ext/object/copy":93,"es5-ext/object/map":101,"es5-ext/object/valid-callable":107,"es5-ext/object/valid-value":108}],81:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27,"es5-ext/object/assign":90,"es5-ext/object/is-callable":96,"es5-ext/object/normalize-options":102,"es5-ext/string/#/contains":109}],82:[function(require,module,exports){
arguments[4][28][0].apply(exports,arguments)
},{"../../object/valid-value":108,"dup":28}],83:[function(require,module,exports){
arguments[4][29][0].apply(exports,arguments)
},{"../../number/to-pos-integer":88,"../../object/valid-value":108,"dup":29}],84:[function(require,module,exports){
arguments[4][30][0].apply(exports,arguments)
},{"./is-implemented":85,"./shim":86,"dup":30}],85:[function(require,module,exports){
arguments[4][31][0].apply(exports,arguments)
},{"dup":31}],86:[function(require,module,exports){
arguments[4][32][0].apply(exports,arguments)
},{"dup":32}],87:[function(require,module,exports){
arguments[4][33][0].apply(exports,arguments)
},{"../math/sign":84,"dup":33}],88:[function(require,module,exports){
arguments[4][34][0].apply(exports,arguments)
},{"./to-integer":87,"dup":34}],89:[function(require,module,exports){
arguments[4][35][0].apply(exports,arguments)
},{"./is-callable":96,"./valid-callable":107,"./valid-value":108,"dup":35}],90:[function(require,module,exports){
arguments[4][36][0].apply(exports,arguments)
},{"./is-implemented":91,"./shim":92,"dup":36}],91:[function(require,module,exports){
arguments[4][37][0].apply(exports,arguments)
},{"dup":37}],92:[function(require,module,exports){
arguments[4][38][0].apply(exports,arguments)
},{"../keys":98,"../valid-value":108,"dup":38}],93:[function(require,module,exports){
arguments[4][39][0].apply(exports,arguments)
},{"./assign":90,"./valid-value":108,"dup":39}],94:[function(require,module,exports){
arguments[4][40][0].apply(exports,arguments)
},{"./set-prototype-of/is-implemented":105,"./set-prototype-of/shim":106,"dup":40}],95:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"./_iterate":89,"dup":41}],96:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"dup":42}],97:[function(require,module,exports){
arguments[4][43][0].apply(exports,arguments)
},{"dup":43}],98:[function(require,module,exports){
arguments[4][44][0].apply(exports,arguments)
},{"./is-implemented":99,"./shim":100,"dup":44}],99:[function(require,module,exports){
arguments[4][45][0].apply(exports,arguments)
},{"dup":45}],100:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"dup":46}],101:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"./for-each":95,"./valid-callable":107,"dup":47}],102:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}],103:[function(require,module,exports){
'use strict';

var forEach = Array.prototype.forEach, create = Object.create;

module.exports = function (arg/*, …args*/) {
	var set = create(null);
	forEach.call(arguments, function (name) { set[name] = true; });
	return set;
};

},{}],104:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"./is-implemented":105,"./shim":106,"dup":49}],105:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],106:[function(require,module,exports){
arguments[4][51][0].apply(exports,arguments)
},{"../create":94,"../is-object":97,"../valid-value":108,"dup":51}],107:[function(require,module,exports){
arguments[4][52][0].apply(exports,arguments)
},{"dup":52}],108:[function(require,module,exports){
arguments[4][53][0].apply(exports,arguments)
},{"dup":53}],109:[function(require,module,exports){
arguments[4][54][0].apply(exports,arguments)
},{"./is-implemented":110,"./shim":111,"dup":54}],110:[function(require,module,exports){
arguments[4][55][0].apply(exports,arguments)
},{"dup":55}],111:[function(require,module,exports){
arguments[4][56][0].apply(exports,arguments)
},{"dup":56}],112:[function(require,module,exports){
arguments[4][57][0].apply(exports,arguments)
},{"dup":57}],113:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./":116,"d":81,"dup":58,"es5-ext/object/set-prototype-of":104,"es5-ext/string/#/contains":109}],114:[function(require,module,exports){
arguments[4][59][0].apply(exports,arguments)
},{"./get":115,"dup":59,"es5-ext/object/valid-callable":107,"es5-ext/string/is-string":112}],115:[function(require,module,exports){
arguments[4][60][0].apply(exports,arguments)
},{"./array":113,"./string":123,"./valid-iterable":124,"dup":60,"es5-ext/string/is-string":112,"es6-symbol":118}],116:[function(require,module,exports){
arguments[4][61][0].apply(exports,arguments)
},{"d":81,"d/auto-bind":80,"dup":61,"es5-ext/array/#/clear":82,"es5-ext/object/assign":90,"es5-ext/object/valid-callable":107,"es5-ext/object/valid-value":108,"es6-symbol":118}],117:[function(require,module,exports){
arguments[4][62][0].apply(exports,arguments)
},{"dup":62,"es5-ext/string/is-string":112,"es6-symbol":118}],118:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./is-implemented":119,"./polyfill":121,"dup":63}],119:[function(require,module,exports){
arguments[4][64][0].apply(exports,arguments)
},{"dup":64}],120:[function(require,module,exports){
arguments[4][65][0].apply(exports,arguments)
},{"dup":65}],121:[function(require,module,exports){
arguments[4][66][0].apply(exports,arguments)
},{"./validate-symbol":122,"d":81,"dup":66}],122:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"./is-symbol":120,"dup":67}],123:[function(require,module,exports){
arguments[4][68][0].apply(exports,arguments)
},{"./":116,"d":81,"dup":68,"es5-ext/object/set-prototype-of":104}],124:[function(require,module,exports){
arguments[4][69][0].apply(exports,arguments)
},{"./is-iterable":117,"dup":69}],125:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./is-implemented":126,"./polyfill":127,"dup":63}],126:[function(require,module,exports){
arguments[4][71][0].apply(exports,arguments)
},{"dup":71}],127:[function(require,module,exports){
arguments[4][72][0].apply(exports,arguments)
},{"d":81,"dup":72}],128:[function(require,module,exports){
arguments[4][73][0].apply(exports,arguments)
},{"d":81,"dup":73,"es5-ext/object/valid-callable":107}],129:[function(require,module,exports){
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

},{"./is-native-implemented":77,"./lib/iterator":79,"d":81,"es5-ext/array/#/clear":82,"es5-ext/array/#/e-index-of":83,"es5-ext/object/set-prototype-of":104,"es5-ext/object/valid-callable":107,"es5-ext/object/valid-value":108,"es6-iterator/for-of":114,"es6-iterator/valid-iterable":124,"es6-symbol":125,"event-emitter":128}],130:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ?
		WeakMap : require('./polyfill');

},{"./is-implemented":131,"./polyfill":172}],131:[function(require,module,exports){
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

},{}],132:[function(require,module,exports){
// Exports true if environment provides native `WeakMap` implementation,
// whatever that is.

'use strict';

module.exports = (function () {
	if (typeof WeakMap === 'undefined') return false;
	return (Object.prototype.toString.call(WeakMap.prototype) ===
			'[object WeakMap]');
}());

},{}],133:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"dup":26,"es5-ext/object/copy":140,"es5-ext/object/map":148,"es5-ext/object/valid-callable":153,"es5-ext/object/valid-value":155}],134:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27,"es5-ext/object/assign":137,"es5-ext/object/is-callable":143,"es5-ext/object/normalize-options":149,"es5-ext/string/#/contains":156}],135:[function(require,module,exports){
arguments[4][28][0].apply(exports,arguments)
},{"../../object/valid-value":155,"dup":28}],136:[function(require,module,exports){
arguments[4][35][0].apply(exports,arguments)
},{"./is-callable":143,"./valid-callable":153,"./valid-value":155,"dup":35}],137:[function(require,module,exports){
arguments[4][36][0].apply(exports,arguments)
},{"./is-implemented":138,"./shim":139,"dup":36}],138:[function(require,module,exports){
arguments[4][37][0].apply(exports,arguments)
},{"dup":37}],139:[function(require,module,exports){
arguments[4][38][0].apply(exports,arguments)
},{"../keys":145,"../valid-value":155,"dup":38}],140:[function(require,module,exports){
arguments[4][39][0].apply(exports,arguments)
},{"./assign":137,"./valid-value":155,"dup":39}],141:[function(require,module,exports){
arguments[4][40][0].apply(exports,arguments)
},{"./set-prototype-of/is-implemented":151,"./set-prototype-of/shim":152,"dup":40}],142:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"./_iterate":136,"dup":41}],143:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"dup":42}],144:[function(require,module,exports){
arguments[4][43][0].apply(exports,arguments)
},{"dup":43}],145:[function(require,module,exports){
arguments[4][44][0].apply(exports,arguments)
},{"./is-implemented":146,"./shim":147,"dup":44}],146:[function(require,module,exports){
arguments[4][45][0].apply(exports,arguments)
},{"dup":45}],147:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"dup":46}],148:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"./for-each":142,"./valid-callable":153,"dup":47}],149:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}],150:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"./is-implemented":151,"./shim":152,"dup":49}],151:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],152:[function(require,module,exports){
arguments[4][51][0].apply(exports,arguments)
},{"../create":141,"../is-object":144,"../valid-value":155,"dup":51}],153:[function(require,module,exports){
arguments[4][52][0].apply(exports,arguments)
},{"dup":52}],154:[function(require,module,exports){
'use strict';

var isObject = require('./is-object');

module.exports = function (value) {
	if (!isObject(value)) throw new TypeError(value + " is not an Object");
	return value;
};

},{"./is-object":144}],155:[function(require,module,exports){
arguments[4][53][0].apply(exports,arguments)
},{"dup":53}],156:[function(require,module,exports){
arguments[4][54][0].apply(exports,arguments)
},{"./is-implemented":157,"./shim":158,"dup":54}],157:[function(require,module,exports){
arguments[4][55][0].apply(exports,arguments)
},{"dup":55}],158:[function(require,module,exports){
arguments[4][56][0].apply(exports,arguments)
},{"dup":56}],159:[function(require,module,exports){
arguments[4][57][0].apply(exports,arguments)
},{"dup":57}],160:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./":163,"d":134,"dup":58,"es5-ext/object/set-prototype-of":150,"es5-ext/string/#/contains":156}],161:[function(require,module,exports){
arguments[4][59][0].apply(exports,arguments)
},{"./get":162,"dup":59,"es5-ext/object/valid-callable":153,"es5-ext/string/is-string":159}],162:[function(require,module,exports){
arguments[4][60][0].apply(exports,arguments)
},{"./array":160,"./string":165,"./valid-iterable":166,"dup":60,"es5-ext/string/is-string":159,"es6-symbol":167}],163:[function(require,module,exports){
arguments[4][61][0].apply(exports,arguments)
},{"d":134,"d/auto-bind":133,"dup":61,"es5-ext/array/#/clear":135,"es5-ext/object/assign":137,"es5-ext/object/valid-callable":153,"es5-ext/object/valid-value":155,"es6-symbol":167}],164:[function(require,module,exports){
arguments[4][62][0].apply(exports,arguments)
},{"dup":62,"es5-ext/string/is-string":159,"es6-symbol":167}],165:[function(require,module,exports){
arguments[4][68][0].apply(exports,arguments)
},{"./":163,"d":134,"dup":68,"es5-ext/object/set-prototype-of":150}],166:[function(require,module,exports){
arguments[4][69][0].apply(exports,arguments)
},{"./is-iterable":164,"dup":69}],167:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./is-implemented":168,"./polyfill":170,"dup":63}],168:[function(require,module,exports){
arguments[4][64][0].apply(exports,arguments)
},{"dup":64}],169:[function(require,module,exports){
arguments[4][65][0].apply(exports,arguments)
},{"dup":65}],170:[function(require,module,exports){
arguments[4][66][0].apply(exports,arguments)
},{"./validate-symbol":171,"d":134,"dup":66}],171:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"./is-symbol":169,"dup":67}],172:[function(require,module,exports){
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

},{"./is-native-implemented":132,"d":134,"es5-ext/object/set-prototype-of":150,"es5-ext/object/valid-object":154,"es5-ext/object/valid-value":155,"es6-iterator/for-of":161,"es6-iterator/get":162,"es6-symbol":167}],173:[function(require,module,exports){
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
},{}],174:[function(require,module,exports){
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
},{}],175:[function(require,module,exports){
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
},{}],176:[function(require,module,exports){
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
},{"clone":177,"deep-equal":178}],177:[function(require,module,exports){
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

},{"buffer":183}],178:[function(require,module,exports){
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

},{"./lib/is_arguments.js":179,"./lib/keys.js":180}],179:[function(require,module,exports){
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

},{}],180:[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],181:[function(require,module,exports){
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
},{"./binding":1,"./firmer":14,"./is":17,"./makeFunctionEmitter":19,"enti":21,"what-changed":176}],182:[function(require,module,exports){
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
},{"./is":17,"crel":20,"events":187}],183:[function(require,module,exports){
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

},{"base64-js":184,"ieee754":185,"is-array":186}],184:[function(require,module,exports){
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

},{}],185:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],186:[function(require,module,exports){

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

},{}],187:[function(require,module,exports){
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

},{}],188:[function(require,module,exports){
var fastn = require('./fastn'),
    crel = require('crel');

var model = new fastn.Model({
        users: require('./users.js')
    });

var app = fastn('div',
    require('./header')(),
    require('./userList')(),
    require('./stats')(),
    require('./forkBanner')()
);

app.attach(model);

window.onload = function(){
   
    app.render();

    document.body.appendChild(app.element);
};
},{"./fastn":4,"./forkBanner":5,"./header":6,"./stats":10,"./userList":12,"./users.js":13,"crel":20}]},{},[188])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsImJpbmRpbmcuanMiLCJjb21wb25lbnQuanMiLCJjb250YWluZXJDb21wb25lbnQuanMiLCJleGFtcGxlL2Zhc3RuLmpzIiwiZXhhbXBsZS9mb3JrQmFubmVyLmpzIiwiZXhhbXBsZS9oZWFkZXIuanMiLCJleGFtcGxlL25ld1VzZXIuanMiLCJleGFtcGxlL3NlYXJjaC5qcyIsImV4YW1wbGUvc2VhcmNoQmFyLmpzIiwiZXhhbXBsZS9zdGF0cy5qcyIsImV4YW1wbGUvdXNlci5qcyIsImV4YW1wbGUvdXNlckxpc3QuanMiLCJleGFtcGxlL3VzZXJzLmpzIiwiZmlybWVyLmpzIiwiZ2VuZXJpY0NvbXBvbmVudC5qcyIsImluZGV4LmpzIiwiaXMuanMiLCJsaXN0Q29tcG9uZW50LmpzIiwibWFrZUZ1bmN0aW9uRW1pdHRlci5qcyIsIm5vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCJub2RlX21vZHVsZXMvZW50aS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9pcy1uYXRpdmUtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9saWIvaXRlcmF0b3IuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9hdXRvLWJpbmQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L2FycmF5LyMvY2xlYXIuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9hcnJheS8jL2UtaW5kZXgtb2YuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaW5kZXguanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9tYXRoL3NpZ24vc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L251bWJlci90by1pbnRlZ2VyLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvbnVtYmVyL3RvLXBvcy1pbnRlZ2VyLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L19pdGVyYXRlLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2Fzc2lnbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9hc3NpZ24vaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvYXNzaWduL3NoaW0uanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvY29weS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9jcmVhdGUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvZm9yLWVhY2guanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtY2FsbGFibGUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvaXMtb2JqZWN0LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L2tleXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qva2V5cy9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9rZXlzL3NoaW0uanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvbWFwLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L25vcm1hbGl6ZS1vcHRpb25zLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mL3NoaW0uanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zL2lzLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNS1leHQvc3RyaW5nLyMvY29udGFpbnMvc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczUtZXh0L3N0cmluZy9pcy1zdHJpbmcuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2FycmF5LmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9mb3Itb2YuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2dldC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3IvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL2lzLWl0ZXJhYmxlLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci9ub2RlX21vZHVsZXMvZXM2LXN5bWJvbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvaXMtaW1wbGVtZW50ZWQuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2lzLXN5bWJvbC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvcG9seWZpbGwuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXM2LWl0ZXJhdG9yL25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL3ZhbGlkYXRlLXN5bWJvbC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtaXRlcmF0b3Ivc3RyaW5nLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L25vZGVfbW9kdWxlcy9lczYtc3ltYm9sL2lzLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2VzNi1zZXQvbm9kZV9tb2R1bGVzL2VzNi1zeW1ib2wvcG9seWZpbGwuanMiLCJub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZXM2LXNldC9ub2RlX21vZHVsZXMvZXZlbnQtZW1pdHRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9lczYtc2V0L3BvbHlmaWxsLmpzIiwibm9kZV9tb2R1bGVzL2VzNi1tYXAvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZXM2LW1hcC9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL2xpYi9pdGVyYXRvci1raW5kcy5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL2xpYi9pdGVyYXRvci5qcyIsIm5vZGVfbW9kdWxlcy9lczYtbWFwL25vZGVfbW9kdWxlcy9lczUtZXh0L29iamVjdC9wcmltaXRpdmUtc2V0LmpzIiwibm9kZV9tb2R1bGVzL2VzNi1tYXAvcG9seWZpbGwuanMiLCJub2RlX21vZHVsZXMvZXM2LXdlYWstbWFwL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9pcy1pbXBsZW1lbnRlZC5qcyIsIm5vZGVfbW9kdWxlcy9lczYtd2Vhay1tYXAvaXMtbmF0aXZlLWltcGxlbWVudGVkLmpzIiwibm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9ub2RlX21vZHVsZXMvZXM1LWV4dC9vYmplY3QvdmFsaWQtb2JqZWN0LmpzIiwibm9kZV9tb2R1bGVzL2VzNi13ZWFrLW1hcC9wb2x5ZmlsbC5qcyIsIm5vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3NhbWUtdmFsdWUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2V0aWZ5L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2Nsb25lL2Nsb25lLmpzIiwibm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIm5vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2tleXMuanMiLCJwcm9wZXJ0eS5qcyIsInRleHRDb21wb25lbnQuanMiLCIuLi8uLi8uLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIuLi8uLi8uLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWIvYjY0LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2V2ZW50cy9ldmVudHMuanMiLCJleGFtcGxlL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsN0dBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDck1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDemtCQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRUE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdDRDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpLFxuICAgIGZpcm1lciA9IHJlcXVpcmUoJy4vZmlybWVyJyksXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlciA9IHJlcXVpcmUoJy4vbWFrZUZ1bmN0aW9uRW1pdHRlcicpLFxuICAgIHNhbWUgPSByZXF1aXJlKCdzYW1lLXZhbHVlJyk7XG5cbmZ1bmN0aW9uIGZ1c2VCaW5kaW5nKCl7XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuXG4gICAgdmFyIGJpbmRpbmdzID0gYXJncy5zbGljZSgpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZygncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIHJlc3VsdEJpbmRpbmcuX2FyZ3VtZW50cyA9IGFyZ3M7XG5cbiAgICBpZih0eXBlb2YgYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdID09PSAnZnVuY3Rpb24nICYmICFpcy5iaW5kaW5nKGJpbmRpbmdzW2JpbmRpbmdzLmxlbmd0aC0xXSkpe1xuICAgICAgICB1cGRhdGVUcmFuc2Zvcm0gPSB0cmFuc2Zvcm07XG4gICAgICAgIHRyYW5zZm9ybSA9IGJpbmRpbmdzLnBvcCgpO1xuICAgIH1cblxuICAgIHJlc3VsdEJpbmRpbmcuX21vZGVsLl9ldmVudHMgPSB7fTtcbiAgICByZXN1bHRCaW5kaW5nLl9zZXQgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGlmKHVwZGF0ZVRyYW5zZm9ybSl7XG4gICAgICAgICAgICBzZWxmQ2hhbmdpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdmFyIG5ld1ZhbHVlID0gdXBkYXRlVHJhbnNmb3JtKHZhbHVlKTtcbiAgICAgICAgICAgIGlmKCFzYW1lKG5ld1ZhbHVlLCBiaW5kaW5nc1swXSgpKSl7XG4gICAgICAgICAgICAgICAgYmluZGluZ3NbMF0obmV3VmFsdWUpO1xuICAgICAgICAgICAgICAgIHJlc3VsdEJpbmRpbmcuX2NoYW5nZShuZXdWYWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzZWxmQ2hhbmdpbmcgPSBmYWxzZTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICByZXN1bHRCaW5kaW5nLl9jaGFuZ2UodmFsdWUpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGNoYW5nZSgpe1xuICAgICAgICBpZihzZWxmQ2hhbmdpbmcpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdEJpbmRpbmcodHJhbnNmb3JtLmFwcGx5KG51bGwsIGJpbmRpbmdzLm1hcChmdW5jdGlvbihiaW5kaW5nKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nKCk7XG4gICAgICAgIH0pKSk7XG4gICAgfVxuXG4gICAgYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nLCBpbmRleCl7XG4gICAgICAgIGlmKHR5cGVvZiBiaW5kaW5nID09PSAnc3RyaW5nJyl7XG4gICAgICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZyhiaW5kaW5nKTtcbiAgICAgICAgICAgIGJpbmRpbmdzLnNwbGljZShpbmRleCwxLGJpbmRpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcub24oJ2NoYW5nZScsIGNoYW5nZSk7XG4gICAgICAgIHJlc3VsdEJpbmRpbmcub24oJ2RldGFjaCcsIGJpbmRpbmcuZGV0YWNoKTtcbiAgICB9KTtcblxuICAgIHZhciBsYXN0QXR0YWNoZWQ7XG4gICAgcmVzdWx0QmluZGluZy5vbignYXR0YWNoJywgZnVuY3Rpb24ob2JqZWN0KXtcbiAgICAgICAgc2VsZkNoYW5naW5nID0gdHJ1ZTtcbiAgICAgICAgYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKXtcbiAgICAgICAgICAgIGJpbmRpbmcuYXR0YWNoKG9iamVjdCwgMSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzZWxmQ2hhbmdpbmcgPSBmYWxzZTtcbiAgICAgICAgaWYobGFzdEF0dGFjaGVkICE9PSBvYmplY3Qpe1xuICAgICAgICAgICAgY2hhbmdlKCk7XG4gICAgICAgIH1cbiAgICAgICAgbGFzdEF0dGFjaGVkID0gb2JqZWN0O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdEJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJpbmRpbmcocGF0aCl7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA+IDEpe1xuICAgICAgICByZXR1cm4gZnVzZUJpbmRpbmcuYXBwbHkobnVsbCwgYXJndW1lbnRzKTtcbiAgICB9XG5cbiAgICBpZihwYXRoID09IG51bGwpe1xuICAgICAgICB0aHJvdyBcImJpbmRpbmdzIG11c3QgYmUgY3JlYXRlZCB3aXRoIGEga2V5IChhbmQgb3IgZmlsdGVyKVwiO1xuICAgIH1cblxuICAgIHZhciB2YWx1ZSxcbiAgICAgICAgYmluZGluZyA9IGZ1bmN0aW9uIGJpbmRpbmcobmV3VmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihwYXRoID09PSAnLicpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5fc2V0KG5ld1ZhbHVlKTtcbiAgICB9O1xuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIoYmluZGluZyk7XG4gICAgYmluZGluZy5zZXRNYXhMaXN0ZW5lcnMoMTAwMDApO1xuICAgIGJpbmRpbmcuX2FyZ3VtZW50cyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgYmluZGluZy5fbW9kZWwgPSBuZXcgRW50aShmYWxzZSk7XG4gICAgYmluZGluZy5fZmFzdG5fYmluZGluZyA9IHBhdGg7XG4gICAgYmluZGluZy5fZmlybSA9IDE7XG4gICAgYmluZGluZy5fbW9kZWwuX2V2ZW50cyA9IHt9O1xuXG4gICAgYmluZGluZy5hdHRhY2ggPSBmdW5jdGlvbihvYmplY3QsIGZpcm0pe1xuXG4gICAgICAgIC8vIElmIHRoZSBiaW5kaW5nIGlzIGJlaW5nIGFza2VkIHRvIGF0dGFjaCBsb29zbHkgdG8gYW4gb2JqZWN0LFxuICAgICAgICAvLyBidXQgaXQgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkIGFzIGJlaW5nIGZpcm1seSBhdHRhY2hlZCwgZG8gbm90IGF0dGFjaC5cbiAgICAgICAgaWYoZmlybWVyKGJpbmRpbmcsIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5fZmlybSA9IGZpcm07XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZy5fbW9kZWwuZ2V0KCcuJykgPT09IG9iamVjdCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX21vZGVsLmF0dGFjaChvYmplY3QpO1xuICAgICAgICBiaW5kaW5nLl9jaGFuZ2UoYmluZGluZy5fbW9kZWwuZ2V0KHBhdGgpKTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIDEpO1xuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGV0YWNoID0gZnVuY3Rpb24oZmlybSl7XG4gICAgICAgIGlmKGZpcm1lcihiaW5kaW5nLCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgICBiaW5kaW5nLl9tb2RlbC5kZXRhY2goKTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdkZXRhY2gnLCAxKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9zZXQgPSBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgIGlmKHNhbWUoYmluZGluZy5fbW9kZWwuZ2V0KHBhdGgpLCBuZXdWYWx1ZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFiaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICAgICAgYmluZGluZy5fbW9kZWwuYXR0YWNoKGJpbmRpbmcuX21vZGVsLmdldCgnLicpKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLl9tb2RlbC5zZXQocGF0aCwgbmV3VmFsdWUpO1xuICAgIH07XG4gICAgYmluZGluZy5fY2hhbmdlID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICB2YWx1ZSA9IG5ld1ZhbHVlO1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2NoYW5nZScsIGJpbmRpbmcoKSk7XG4gICAgfTtcbiAgICBiaW5kaW5nLmNsb25lID0gZnVuY3Rpb24oa2VlcEF0dGFjaG1lbnQpe1xuICAgICAgICB2YXIgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcuYXBwbHkobnVsbCwgYmluZGluZy5fYXJndW1lbnRzKTtcblxuICAgICAgICBpZihrZWVwQXR0YWNobWVudCl7XG4gICAgICAgICAgICBuZXdCaW5kaW5nLmF0dGFjaChiaW5kaW5nLl9tb2RlbCwgYmluZGluZy5fZmlybSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3QmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGVzdHJveSA9IGZ1bmN0aW9uKHNvZnQpe1xuICAgICAgICBpZihiaW5kaW5nLl9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKHNvZnQgJiYgKCFiaW5kaW5nLl9ldmVudHMgfHwgYmluZGluZy5fZXZlbnRzLmNoYW5nZSkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcuX2Rlc3Ryb3llZCA9IHRydWU7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICBiaW5kaW5nLmRldGFjaCgpO1xuICAgICAgICBiaW5kaW5nLl9tb2RlbC5kZXN0cm95KCk7XG4gICAgfTtcblxuICAgIGlmKHBhdGggIT09ICcuJyl7XG4gICAgICAgIGJpbmRpbmcuX21vZGVsLl9ldmVudHNbcGF0aF0gPSBmdW5jdGlvbigpe1xuICAgICAgICAgICAgYmluZGluZy5fY2hhbmdlKGJpbmRpbmcuX21vZGVsLmdldChwYXRoKSk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRpbmc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlQmluZGluZzsiLCJ2YXIgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhzZXR0aW5ncyk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICByZXN1bHRba2V5XSA9IHNldHRpbmdzW2tleV07XG4gICAgICAgIGlmKGlzLmJpbmRpbmdPYmplY3QocmVzdWx0W2tleV0pKXtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZmFzdG4uYmluZGluZyhcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZmFzdG5fYmluZGluZyxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZGVmYXVsdFZhbHVlLFxuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldLnRyYW5zZm9ybVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW4oaXRlbSl7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoaXRlbSkgPyBpdGVtLnJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGVsZW1lbnQpe1xuICAgICAgICBpZihlbGVtZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0LmNvbmNhdChmbGF0dGVuKGVsZW1lbnQpKTtcbiAgICB9LFtdKSA6IGl0ZW07XG59XG5cbmZ1bmN0aW9uIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsIGNhbGwsIGFyZ3Mpe1xuICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMoY29tcG9uZW50KTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgdmFyIHByb3BlcnR5ID0gY29tcG9uZW50W2tleXNbaV1dO1xuXG4gICAgICAgIGlmKCFpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBwcm9wZXJ0eVtjYWxsXS5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgaWYoaXMucHJvcGVydHkoc2V0dGluZ3Nba2V5XSkpe1xuICAgICAgICAgICAgY29tcG9uZW50W2tleV0gPSBzZXR0aW5nc1trZXldO1xuICAgICAgICB9ZWxzZSBpZihpcy5wcm9wZXJ0eShjb21wb25lbnRba2V5XSkpe1xuICAgICAgICAgICAgaWYoaXMuYmluZGluZyhzZXR0aW5nc1trZXldKSl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50W2tleV0uYmluZGluZyhzZXR0aW5nc1trZXldKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudFtrZXldKHNldHRpbmdzW2tleV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29tcG9uZW50W2tleV0uYWRkVG8oY29tcG9uZW50LCBrZXkpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuLCBjb21wb25lbnRzKXtcbiAgICB2YXIgY29tcG9uZW50LFxuICAgICAgICBiaW5kaW5nLFxuICAgICAgICBzY29wZSA9IG5ldyBmYXN0bi5Nb2RlbChmYWxzZSk7XG5cbiAgICBzZXR0aW5ncyA9IGRlcmVmZXJlbmNlU2V0dGluZ3Moc2V0dGluZ3MgfHwge30pO1xuICAgIGNoaWxkcmVuID0gZmxhdHRlbihjaGlsZHJlbik7XG5cbiAgICBpZighKHR5cGUgaW4gY29tcG9uZW50cykpe1xuICAgICAgICBpZighKCdfZ2VuZXJpYycgaW4gY29tcG9uZW50cykpe1xuICAgICAgICAgICAgdGhyb3cgJ05vIGNvbXBvbmVudCBvZiB0eXBlIFwiJyArIHR5cGUgKyAnXCIgaXMgbG9hZGVkJztcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzLl9nZW5lcmljKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1lbHNle1xuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzW3R5cGVdKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1cblxuICAgIGlmKGlzLmNvbXBvbmVudChjb21wb25lbnQpKXtcbiAgICAgICAgLy8gVGhlIGNvbXBvbmVudCBjb25zdHJ1Y3RvciByZXR1cm5lZCBhIHJlYWR5LXRvLWdvIGNvbXBvbmVudC5cbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9XG5cbiAgICBjb21wb25lbnQuX3R5cGUgPSB0eXBlO1xuICAgIGNvbXBvbmVudC5fc2V0dGluZ3MgPSBzZXR0aW5ncztcbiAgICBjb21wb25lbnQuX2Zhc3RuX2NvbXBvbmVudCA9IHRydWU7XG4gICAgY29tcG9uZW50Ll9jaGlsZHJlbiA9IGNoaWxkcmVuO1xuXG4gICAgY29tcG9uZW50LmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgZmlybSl7XG4gICAgICAgIGJpbmRpbmcuYXR0YWNoKG9iamVjdCwgZmlybSk7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5kZXRhY2ggPSBmdW5jdGlvbihmaXJtKXtcbiAgICAgICAgYmluZGluZy5kZXRhY2goZmlybSk7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdkZXRhY2gnLCAxKTtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LnNjb3BlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIHNjb3BlO1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKGNvbXBvbmVudC5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuX2Rlc3Ryb3llZCA9IHRydWU7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdkZXN0cm95Jyk7XG4gICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gbnVsbDtcbiAgICAgICAgc2NvcGUuZGVzdHJveSgpO1xuICAgICAgICBiaW5kaW5nLmRlc3Ryb3koKTtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9O1xuXG4gICAgdmFyIGxhc3RCb3VuZDtcbiAgICBmdW5jdGlvbiBlbWl0QXR0YWNoKCl7XG4gICAgICAgIHZhciBuZXdCb3VuZCA9IGJpbmRpbmcoKTtcbiAgICAgICAgaWYobmV3Qm91bmQgIT09IGxhc3RCb3VuZCl7XG4gICAgICAgICAgICBsYXN0Qm91bmQgPSBuZXdCb3VuZDtcbiAgICAgICAgICAgIHNjb3BlLmF0dGFjaChsYXN0Qm91bmQpO1xuICAgICAgICAgICAgY29tcG9uZW50LmVtaXQoJ2F0dGFjaCcsIGxhc3RCb3VuZCwgMSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb21wb25lbnQuYmluZGluZyA9IGZ1bmN0aW9uKG5ld0JpbmRpbmcpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFpcy5iaW5kaW5nKG5ld0JpbmRpbmcpKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKG5ld0JpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBuZXdCaW5kaW5nLmF0dGFjaChiaW5kaW5nLm1vZGVsLCBiaW5kaW5nLl9maXJtKTtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIGVtaXRBdHRhY2gpO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG5cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgZW1pdEF0dGFjaCk7XG4gICAgICAgIGVtaXRBdHRhY2goYmluZGluZygpKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KGNvbXBvbmVudC5fdHlwZSwgZmFzdG4sIGNvbXBvbmVudC5fc2V0dGluZ3MsIGNvbXBvbmVudC5fY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiAhY2hpbGQuX3RlbXBsYXRlZDtcbiAgICAgICAgfSkubWFwKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiBjaGlsZC5jbG9uZSgpO1xuICAgICAgICB9KSwgY29tcG9uZW50cyk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5jaGlsZHJlbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQuX2NoaWxkcmVuLnNsaWNlKCk7XG4gICAgfTtcblxuICAgIGluZmxhdGVQcm9wZXJ0aWVzKGNvbXBvbmVudCwgc2V0dGluZ3MpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnYXR0YWNoJywgYXJndW1lbnRzKTtcbiAgICB9KTtcbiAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvckVhY2hQcm9wZXJ0eShjb21wb25lbnQsICd1cGRhdGUnLCBhcmd1bWVudHMpO1xuICAgIH0pO1xuICAgIGNvbXBvbmVudC5vbignZGV0YWNoJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yRWFjaFByb3BlcnR5KGNvbXBvbmVudCwgJ2RldGFjaCcsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG4gICAgY29tcG9uZW50Lm9uY2UoJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3JFYWNoUHJvcGVydHkoY29tcG9uZW50LCAnZGVzdHJveScsIGFyZ3VtZW50cyk7XG4gICAgfSk7XG5cbiAgICB2YXIgZGVmYXVsdEJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCcuJyk7XG4gICAgZGVmYXVsdEJpbmRpbmcuX2RlZmF1bHRfYmluZGluZyA9IHRydWU7XG5cbiAgICBjb21wb25lbnQuYmluZGluZyhkZWZhdWx0QmluZGluZyk7XG5cbiAgICBpZihmYXN0bi5kZWJ1Zyl7XG4gICAgICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIHR5cGVvZiBjb21wb25lbnQuZWxlbWVudCA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50Ll9jb21wb25lbnQgPSBjb21wb25lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjb21wb25lbnQ7XG59O1xuIiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHR5cGUsIGZhc3RuKXtcbiAgICB2YXIgY29udGFpbmVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG4gICAgY29udGFpbmVyLmluc2VydCA9IGZ1bmN0aW9uKGNvbXBvbmVudCwgaW5kZXgpe1xuICAgICAgICBpZihpbmRleCAmJiB0eXBlb2YgaW5kZXggPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgIGNvbXBvbmVudCA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgY29tcG9uZW50LmZvckVhY2goY29udGFpbmVyLmluc2VydCk7XG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpLFxuICAgICAgICAgICAgbmV3Q29tcG9uZW50ID0gZmFzdG4udG9Db21wb25lbnQoY29tcG9uZW50KTtcblxuICAgICAgICBpZighaXMuY29tcG9uZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgaWYofmN1cnJlbnRJbmRleCl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoY3VycmVudEluZGV4LCAxLCBuZXdDb21wb25lbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoaXNOYU4oaW5kZXgpKXtcbiAgICAgICAgICAgIGluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgICAgaWYoY3VycmVudEluZGV4ICE9PSBpbmRleCl7XG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShjdXJyZW50SW5kZXgsIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsIDAsIG5ld0NvbXBvbmVudCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjb250YWluZXIuZ2V0Q29udGFpbmVyRWxlbWVudCgpICYmICFuZXdDb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBuZXdDb21wb25lbnQucmVuZGVyKCk7XG4gICAgICAgIH1cblxuICAgICAgICBuZXdDb21wb25lbnQuYXR0YWNoKGNvbnRhaW5lci5zY29wZSgpLCAxKTtcblxuICAgICAgICBjb250YWluZXIuX2luc2VydChuZXdDb21wb25lbnQuZWxlbWVudCwgaW5kZXgpO1xuXG4gICAgICAgIHJldHVybiBjb250YWluZXI7XG4gICAgfTtcblxuICAgIHZhciB4ID0gMDtcblxuICAgIGNvbnRhaW5lci5faW5zZXJ0ID0gZnVuY3Rpb24oZWxlbWVudCwgaW5kZXgpe1xuICAgICAgICB2YXIgY29udGFpbmVyRWxlbWVudCA9IGNvbnRhaW5lci5nZXRDb250YWluZXJFbGVtZW50KCk7XG4gICAgICAgIGlmKCFjb250YWluZXJFbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbnRhaW5lckVsZW1lbnQuY2hpbGROb2Rlc1tpbmRleF0gPT09IGVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29udGFpbmVyRWxlbWVudC5pbnNlcnRCZWZvcmUoZWxlbWVudCwgY29udGFpbmVyRWxlbWVudC5jaGlsZE5vZGVzW2luZGV4XSk7XG4gICAgfTtcblxuICAgIGNvbnRhaW5lci5yZW1vdmUgPSBmdW5jdGlvbihjb21wb25lbnQpe1xuICAgICAgICB2YXIgaW5kZXggPSBjb250YWluZXIuX2NoaWxkcmVuLmluZGV4T2YoY29tcG9uZW50KTtcbiAgICAgICAgaWYofmluZGV4KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50LmRldGFjaCgxKTtcblxuICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBjb250YWluZXIuX3JlbW92ZShjb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9yZW1vdmUgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgdmFyIGNvbnRhaW5lckVsZW1lbnQgPSBjb250YWluZXIuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuXG4gICAgICAgIGlmKCFlbGVtZW50IHx8ICFjb250YWluZXJFbGVtZW50IHx8IGVsZW1lbnQucGFyZW50Tm9kZSAhPT0gY29udGFpbmVyRWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50LnJlbW92ZUNoaWxkKGVsZW1lbnQpO1xuICAgIH07XG5cbiAgICBjb250YWluZXIuZW1wdHkgPSBmdW5jdGlvbigpe1xuICAgICAgICB3aGlsZShjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aCl7XG4gICAgICAgICAgICBjb250YWluZXIuX3JlbW92ZShjb250YWluZXIuX2NoaWxkcmVuLnBvcCgpLmRldGFjaCgxKS5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBjb250YWluZXIuZ2V0Q29udGFpbmVyRWxlbWVudCA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjb250YWluZXIuY29udGFpbmVyRWxlbWVudCB8fCBjb250YWluZXIuZWxlbWVudDtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICBjb250YWluZXIuaW5zZXJ0KGNvbnRhaW5lci5fY2hpbGRyZW4pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhLCBmaXJtKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW5baV0uYXR0YWNoKGRhdGEsIGZpcm0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb250YWluZXIub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbihkYXRhLCBmaXJtKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW5baV0uZGVzdHJveShmaXJtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn07IiwiLypcbiAgICBBIGNvbnZlbmllbmNlIHNpbmdsZXRvbiB0aGF0IHNldHMgdXAgZmFzdG4gc28gaXQgY2FuIGJlIHJlcXVpcmVkIGZyb20gb3RoZXIgZmlsZXMuXG4qL1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4uLycpKHsgLy8gUmVxdWlyZSBmYXN0blxuXG4gICAgLy8gc2V0IHVwIGZhc3RuIHdpdGggYWxsIHRoZSBjb21wb25lbnRzIHlvdSBuZWVkIGZvciB5b3VyIGFwcGxpY2F0aW9uXG5cbiAgICAvLyBUaGUgbGlzdCBjb21wb25lbnQgaXMgdXNlZCB0byByZW5kZXIgaXRlbXMgYmFzZWQgb24gYSBzZXQgb2YgZGF0YS5cbiAgICBsaXN0OiByZXF1aXJlKCcuLi9saXN0Q29tcG9uZW50JyksXG5cbiAgICAvLyBUaGUgdGV4dCBjb21wb25lbnQgaXMgdXNlZCB0byByZW5kZXIgdGV4dCBvciBiaW5kaW5ncyBwYXNzZWQgYXMgY2hpbGRyZW4gdG8gb3RoZXIgY29tcG9uZW50cy5cbiAgICB0ZXh0OiByZXF1aXJlKCcuLi90ZXh0Q29tcG9uZW50JyksXG5cbiAgICAvLyBUaGUgX2dlbmVyaWMgY29tcG9uZW50IGlzIGEgY2F0Y2gtYWxsIGZvciBhbnkgY29tcG9uZW50IHR5cGUgdGhhdFxuICAgIC8vICBkb2VzbnQgbWF0Y2ggYW55IG90aGVyIGNvbXBvbmVudCBjb25zdHJ1Y3RvciwgZWc6ICdkaXYnXG4gICAgX2dlbmVyaWM6IHJlcXVpcmUoJy4uL2dlbmVyaWNDb21wb25lbnQnKVxuXG59LCB0cnVlKTsgLy8gUGFzcyB0cnVlIGFzIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHRvIHR1cm4gb24gZGVidWcgbW9kZS4iLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKXsgICAgXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLCB7Y2xhc3M6ICdnaXRodWItZm9yay1yaWJib24td3JhcHBlciByaWdodCd9LFxuICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnZ2l0aHViLWZvcmstcmliYm9uJ30sXG4gICAgICAgICAgICBmYXN0bignYScsIHtocmVmOiAnaHR0cHM6Ly9naXRodWIuY29tL2tvcnludW5uL2Zhc3RuJ30sICdGb3JrIG1lJylcbiAgICAgICAgKVxuICAgICk7XG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWFyY2hNb2RlbCl7XG4gICAgcmV0dXJuIGZhc3RuKCdoZWFkZXInLCB7J2NsYXNzJzonbWFpbkhlYWRlcid9LFxuICAgICAgICBmYXN0bignaW1nJywge3NyYzogJy4vZmFzdG4tc21sLnBuZyd9KSxcbiAgICAgICAgZmFzdG4oJ2gxJywgJ2Zhc3RuJywgZmFzdG4oJ3NwYW4nLCB7Y2xhc3M6ICdmYWludCd9LCAnLmpzJykpLFxuICAgICAgICBmYXN0bignc3BhbicsXG4gICAgICAgICAgICAnVXNlciBsaXN0IGV4YW1wbGUuICcsXG4gICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCd1c2Vyc3wqLmRlbGV0ZWQnLCByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdCwgIGZ1bmN0aW9uKHVzZXJzLCByZXN1bHRzKXtcbiAgICAgICAgICAgICAgICBpZighdXNlcnMpe1xuICAgICAgICAgICAgICAgICAgICB1c2VycyA9IFtdO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciB0b3RhbCA9IHVzZXJzLmZpbHRlcihmdW5jdGlvbih1c2VyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhdXNlci5kZWxldGVkO1xuICAgICAgICAgICAgICAgICAgICB9KS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gJyc7XG5cbiAgICAgICAgICAgICAgICBpZihyZXN1bHRzKXtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ICs9ICdTaG93aW5nICcgKyByZXN1bHRzLmxlbmd0aCArJyBvZiAnO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSB0b3RhbDtcblxuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICcgdXNlcnMnXG4gICAgICAgICksXG4gICAgICAgIHJlcXVpcmUoJy4vc2VhcmNoQmFyJykoKVxuICAgICk7XG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihtb2RlbCl7XG5cbiAgICB2YXIgbmV3VXNlckRpYWxvZyA9IGZhc3RuKCdkaXYnLCB7Y2xhc3M6J25ld1VzZXIgZGlhbG9nJ30sXG4gICAgICAgIGZhc3RuKCdmb3JtJywge2NsYXNzOiAnbW9kYWwnfSwgXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ0ZpcnN0IE5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmZpcnN0JyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdmaWVsZCcsXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgJ1N1cm5hbWUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmxhc3QnKSxcbiAgICAgICAgICAgICAgICAgICAgb25jaGFuZ2U6ICd2YWx1ZTp2YWx1ZSdcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKSxcblxuICAgICAgICAgICAgZmFzdG4oJ2ZpZWxkJyxcbiAgICAgICAgICAgICAgICBmYXN0bignbGFiZWwnLCAnRW1haWwnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpLFxuICAgICAgICAgICAgICAgICAgICBvbmNoYW5nZTogJ3ZhbHVlOnZhbHVlJ1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZmllbGQnLFxuICAgICAgICAgICAgICAgIGZhc3RuKCdsYWJlbCcsICdNb2JpbGUnKSxcbiAgICAgICAgICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCdjZWxsJyksXG4gICAgICAgICAgICAgICAgICAgIG9uY2hhbmdlOiAndmFsdWU6dmFsdWUnXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCAnQWRkJylcbiAgICAgICAgKVxuICAgICAgICAub24oJ3N1Ym1pdCcsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgICBtb2RlbC5pbnNlcnQoJ3VzZXJzJywgc2NvcGUuZ2V0KCcuJyksIDApO1xuICAgICAgICB9KVxuICAgIClcbiAgICAub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBpZihldmVudC50YXJnZXQgPT09IHRoaXMuZWxlbWVudCl7XG4gICAgICAgICAgICBjbG9zZU1vZGFsKCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGZ1bmN0aW9uIGNsb3NlTW9kYWwoKXtcbiAgICAgICAgbmV3VXNlckRpYWxvZy5lbGVtZW50LmNsYXNzTGlzdC5hZGQoJ2Nsb3NlZCcpO1xuXG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQobmV3VXNlckRpYWxvZy5lbGVtZW50KTtcbiAgICAgICAgICAgIG5ld1VzZXJEaWFsb2cuZGVzdHJveSgpO1xuICAgICAgICB9LDMwMCk7XG4gICAgfVxuXG4gICAgdmFyIHJhbmRvbUltYWdlSWQgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDApO1xuXG4gICAgbmV3VXNlckRpYWxvZy5hdHRhY2goe1xuICAgICAgICAnZ2VuZGVyJzpudWxsLFxuICAgICAgICAnbmFtZSc6e1xuICAgICAgICAgICAgJ3RpdGxlJzpudWxsLFxuICAgICAgICAgICAgJ2ZpcnN0JzpudWxsLFxuICAgICAgICAgICAgJ2xhc3QnOm51bGxcbiAgICAgICAgfSxcbiAgICAgICAgJ2VtYWlsJzpudWxsLFxuICAgICAgICAnZG9iJzpudWxsLFxuICAgICAgICAnY2VsbCc6bnVsbCxcbiAgICAgICAgJ3BpY3R1cmUnOntcbiAgICAgICAgICAgICdsYXJnZSc6J2h0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vJyArIHJhbmRvbUltYWdlSWQgKyAnLmpwZycsXG4gICAgICAgICAgICAnbWVkaXVtJzonaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vJyArIHJhbmRvbUltYWdlSWQgKyAnLmpwZycsXG4gICAgICAgICAgICAndGh1bWJuYWlsJzonaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8nICsgcmFuZG9tSW1hZ2VJZCArICcuanBnJ1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBuZXdVc2VyRGlhbG9nLnJlbmRlcigpO1xuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChuZXdVc2VyRGlhbG9nLmVsZW1lbnQpO1xufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgdXNlcnMgPSByZXF1aXJlKCcuL3VzZXJzJyksXG4gICAgc2VhcmNoTW9kZWwgPSB7XG4gICAgICAgIHVzZXJTZWFyY2g6ICcnLFxuICAgICAgICByZXN1bHQ6IG51bGxcbiAgICB9LFxuICAgIHVzZXJTZWFyY2ggPSBmYXN0bi5iaW5kaW5nKCd1c2VyU2VhcmNoJykuYXR0YWNoKHNlYXJjaE1vZGVsKVxuICAgICAgICAub24oJ2NoYW5nZScsIGZ1bmN0aW9uKHNlYXJjaCl7XG4gICAgICAgICAgICBpZighc2VhcmNoKXtcbiAgICAgICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCBudWxsKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmYXN0bi5Nb2RlbC5zZXQoc2VhcmNoTW9kZWwsICdyZXN1bHQnLCB1c2Vycy5maWx0ZXIoZnVuY3Rpb24odXNlcil7XG4gICAgICAgICAgICAgICAgaWYoIXVzZXIgfHwgIXVzZXIubmFtZSB8fCAhdXNlci5uYW1lLmZpcnN0IHx8ICF1c2VyLm5hbWUubGFzdCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIH51c2VyLm5hbWUuZmlyc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKSB8fCB+dXNlci5uYW1lLmxhc3QudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHNlYXJjaE1vZGVsOiBzZWFyY2hNb2RlbCxcbiAgICB1c2VyU2VhcmNoOiB1c2VyU2VhcmNoLFxuICAgIHJlc3VsdDogZmFzdG4uYmluZGluZygncmVzdWx0JykuYXR0YWNoKHNlYXJjaE1vZGVsKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyksXG4gICAgc2VhcmNoID0gcmVxdWlyZSgnLi9zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiBmYXN0bignbmF2Jywge2NsYXNzOiAnc2VhcmNoJ30sXG4gICAgICAgIGZhc3RuKCdsYWJlbCcsICdTZWFyY2gnKSwgXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHsgXG4gICAgICAgICAgICB2YWx1ZTogc2VhcmNoLnVzZXJTZWFyY2gsXG4gICAgICAgICAgICBvbmtleXVwOiAndmFsdWU6dmFsdWUnXG4gICAgICAgIH0pXG4gICAgKVxufTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCcuL2Zhc3RuJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKXtcblxuICAgIHJldHVybiBmYXN0bignZGl2Jywge2NsYXNzOiAnc3RhdHMnfSxcbiAgICAgICAgJ1RoaXMgZXhhbXBsZSBoYXMgJyxcbiAgICAgICAgZmFzdG4uYmluZGluZygnYXR0YWNoZWRFbnRpcycpLFxuICAgICAgICAnIGF0dGFjaGVkIG1vZGVsIGluc3RhbmNlcydcbiAgICApLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhKXtcbiAgICAgICAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGZhc3RuLk1vZGVsLnNldChkYXRhLCAnYXR0YWNoZWRFbnRpcycsIGZhc3RuLk1vZGVsLnByb3RvdHlwZS5hdHRhY2hlZENvdW50KCkpO1xuICAgICAgICB9LDEwMCk7XG4gICAgfSk7XG4gICAgXG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpe1xuICAgIHZhciBzZWFyY2hSZXN1bHQgPSByZXF1aXJlKCcuL3NlYXJjaCcpLnJlc3VsdDtcblxuICAgIHJldHVybiBmYXN0bignZGl2Jywge1xuICAgICAgICAgICAgY2xhc3M6IGZhc3RuLmJpbmRpbmcoJy4nLCAnbmFtZScsIHNlYXJjaFJlc3VsdCwgc2VsZWN0ZWRVc2VyLCAnZGVsZXRlZCcsIGZ1bmN0aW9uKHVzZXIsIG5hbWUsIHNlYXJjaFJlc3VsdCwgc2VsZWN0ZWRVc2VyLCBkZWxldGVkKXtcbiAgICAgICAgICAgICAgICB2YXIgY2xhc3NlcyA9IFsndXNlciddO1xuXG4gICAgICAgICAgICAgICAgaWYoc2VhcmNoUmVzdWx0ICYmICF+c2VhcmNoUmVzdWx0LmluZGV4T2YodXNlcikpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2hpZGRlbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih1c2VyID09PSBzZWxlY3RlZFVzZXIpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ3NlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKGRlbGV0ZWQpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2RlbGV0ZWQnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsYXNzZXM7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9LFxuXG4gICAgICAgIGZhc3RuKCdpbWcnLCB7IFxuICAgICAgICAgICAgc3JjOiBmYXN0bi5iaW5kaW5nKCcuJywgIHNlbGVjdGVkVXNlciwgJ3BpY3R1cmUnLCBmdW5jdGlvbih1c2VyLCBzZWxlY3RlZFVzZXIsIHBpY3R1cmUpe1xuICAgICAgICAgICAgICAgIHJldHVybiB1c2VyID09PSBzZWxlY3RlZFVzZXIgPyBwaWN0dXJlLmxhcmdlIDogcGljdHVyZS5tZWRpdW07XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KSxcblxuICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnZGV0YWlscyd9LFxuXG4gICAgICAgICAgICBmYXN0bignbGFiZWwnLCB7Y2xhc3M6ICduYW1lJ30sXG4gICAgICAgICAgICAgICAgZmFzdG4uYmluZGluZygnbmFtZS5maXJzdCcpLCAnICcsIGZhc3RuLmJpbmRpbmcoJ25hbWUubGFzdCcpXG4gICAgICAgICAgICApLFxuXG4gICAgICAgICAgICBmYXN0bignZGl2Jywge2NsYXNzOiAnaW5mbyd9LFxuXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3AnLCB7Y2xhc3M6J2V4dHJhJ30sXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdhJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhyZWY6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJywgZnVuY3Rpb24oZW1haWwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ21haWx0bzonICsgZW1haWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCdlbWFpbCcpXG4gICAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgICAgIGZhc3RuKCdwJywgZmFzdG4uYmluZGluZygnY2VsbCcsIGZ1bmN0aW9uKGNlbGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdNb2JpbGU6ICcgKyBjZWxsO1xuICAgICAgICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICksXG5cbiAgICAgICAgICAgIGZhc3RuKCdidXR0b24nLCB7Y2xhc3M6ICdyZW1vdmUnfSwnWCcpXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgICAgICAgICBzY29wZS5zZXQoJ2RlbGV0ZWQnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICBkZWxldGVVc2VyKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApXG5cbiAgICApLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgIHNlbGVjdGVkVXNlcihzY29wZS5nZXQoJy4nKSk7XG4gICAgfSk7XG59OyIsInZhciBmYXN0biA9IHJlcXVpcmUoJy4vZmFzdG4nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpe1xuICAgIHZhciBzZWxlY3RlZFVzZXIgPSBmYXN0bi5iaW5kaW5nKCdzZWxlY3RlZFVzZXInKS5hdHRhY2goe30pO1xuXG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0JywgXG4gICAgICAgIHtcbiAgICAgICAgICAgIGNsYXNzOiAndXNlcnMnLFxuICAgICAgICAgICAgaXRlbXM6IGZhc3RuLmJpbmRpbmcoJ3VzZXJzfConKSwgXG4gICAgICAgICAgICB0ZW1wbGF0ZTogZnVuY3Rpb24obW9kZWwsIHNjb3BlKXtcblxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGRlbGV0ZVVzZXIoKXtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlbGV0ZWRVc2VycyA9IHNjb3BlLmdldCgnZGVsZXRlZFVzZXJzJykgfHxbXTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlZFVzZXJzLnB1c2gobW9kZWwuZ2V0KCdpdGVtJykpO1xuICAgICAgICAgICAgICAgICAgICBzY29wZS5zZXQoJ2RlbGV0ZWRVc2VycycsIGRlbGV0ZWRVc2Vycyk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXF1aXJlKCcuL3VzZXIuanMnKShzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpLmJpbmRpbmcoJ2l0ZW0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZmFzdG4oJ2J1dHRvbicsIHtjbGFzczogJ2FkZCd9LCAnKycpXG4gICAgICAgIC5vbignY2xpY2snLCBmdW5jdGlvbihldmVudCwgc2NvcGUpe1xuICAgICAgICAgICAgcmVxdWlyZSgnLi9uZXdVc2VyJykoc2NvcGUpO1xuICAgICAgICB9KVxuICAgICk7XG59OyIsInZhciB1c2VycyA9IFtcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwic2NhcmxldHRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRlYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI2NzEgY291bnRyeSBjbHViIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmb3J0IGNvbGxpbnNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJkZWxhd2FyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NjcyNFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwic2NhcmxldHQuZGVhbjQwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJyZWRiaXJkNjE4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjaXJjbGVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVE95dUNPZEhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyZDNlMGRjMDIwYTgyNjg5ODEwMmM2ZWNmOGJiNjBlMlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwMWJhOGVjYmYzYTEzNzk0MWY0ZThiNjY1MGZiNGI5YzZhYmNhN2Y4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZDU2YTFjZmRiY2FmM2EyOGUxN2UxMGI4Y2IxMWNlMDE4YjRiYTczMGJjNWJiZTcyMGY2MTc0NTFmMzZhOGVjZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjU1MjQ5OTEzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzMzMjQ1MDRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxMDIpLTIxMC05MzU3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NTcpLTc2OS03Njg4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjc2LTczLTk3NjZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjcyZGJmNzJmY2NlMzViZGZcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWFyZ2llXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXJkXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NTQ0IHcgZGFsbGFzIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsYW5zaW5nXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibW9udGFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MTg1OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWFyZ2llLndhcmQyOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVydGlnZXI0MzNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhpaGloaVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI4Q2Q2eXlxVFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNkM2YyOTMyOGNmNDM3YzExMWMxOTdiYWIxNjI3NzI5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjhhZmUyNjU5NmUyYTM4OWQ0ZWEwZmZiMzY2MTkxMGMxNGJhODBkMjhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4Y2M4Zjk3NzVlNmQxZmQ3YWQzOGFmOTU1OTkxMmVhYTMyNjdkODIyYTE5MjRkMDUyY2EwYmI0ZDQ3ZGEwZmNkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkyNTMwODY4NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMwNTA0Nzg5NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE2NyktNTI1LTM5MzdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkyOSktNDU3LTkyNTJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0MDktNDItNzY4NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vODcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzg3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzg3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMGQ3YWNmZjY4ZGM1NzM1OFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2Fyb2xpbmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1pbGxzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NzYzIGhvZ2FuIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFuZCByYXBpZHNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3NTAxM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2Fyb2xpbmUubWlsbHMxNEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxyYWJiaXQ5NDZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInZlbmljZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJkYjVWMnR1a1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRmOGM5ZWYwNjdkMTM1YzE3YjQ1YzJkNTA4YTk3NzBjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjg4NTI2ZWQ0NTc5M2FhYjlhYjdmMzIyYTlhZjExYTdhOGY3ZDYwMWZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjYTk3YmE3ZTRlNmEyNWQwZmViMzEyZDQwNzllODdmZjdhNTZmZTliMDJiZmQyYjNkNDQzMjYwNDhmYjcyZjZkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyODE2NTIyMDRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI2MzcyMzg1OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDIzNyktNTEyLTY1NTFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU1NiktODY2LTQ4OThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNDAtMzMtNjU2OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTlhNTQxNzBjYzFmM2NhZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImthdGh5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwZXJyeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDIyMiBwZWNhbiBhY3JlcyBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY3VwZXJ0aW5vXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicGVubnN5bHZhbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjk0NDUyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJrYXRoeS5wZXJyeTk0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3drb2FsYTM2MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZnJlZXplXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkdkZnAwMzFzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNGE5MzAwNTY0ZDNjNDdjNDA0NjM5ZDNhMmI1OTgzZTFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMGI1MWY4MWIxNmExNmE2YzhlNzZhNzlhYTAwN2RjMjJhZDc4NzI4N1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImZkNGI3NzI0YjM5ZGNlZTc0NGEyNjAyNTY1NzcxMGQ2NzMyNWM3YzQ3OTdjNGMwYTk4MTdmYWU3Yzk2MzNiNzNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTQxMTQ5OTQ3M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI1ODEzOTMyMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgyMiktMzExLTkzNjhcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkzOSktMzEwLTQ5NjBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0ODQtNTItNjE1NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMDc2ZmUyODQ3ZWIzYzc4ZFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXJpb1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibmV3bWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MzA0IHBsdW0gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm5ldyBoYXZlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInJob2RlIGlzbGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MDQ4NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWFyaW8ubmV3bWFuNzZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJlYXV0aWZ1bGZpc2g0ODFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFpa2lkb1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJPUTh3dGxxZ1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjkzM2Y2OTVhMjdlMGFlY2M0MGZjMzUzZmRiYmNiMzZiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImYyZTZlMTk0ZGMwZDQxZDQwZjMwMWNjNzU5ZDg2N2FkMmRlNWE1ZmNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4MTU1MmIxOGU2NzJiMmFkMDdkYTA5MWQ5MmRkMjFmMzc5NGJkZTFkNjhlODI0MjQ3ZThmMGNkMzYzYTgwZGY5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNDYwNzAzMzVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNjM4Nzg0ODNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MjYpLTI0NC0yNDI3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MTIpLTI5Ni03MjY2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjAzLTk2LTg3MDJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjFjOTNkZDBmNTYwNDkxMWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibmVsc29uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJrZWxsZXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg1MzQgZSBub3J0aCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JlZWxleVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImthbnNhc1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2Njc5MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibmVsc29uLmtlbGxleTQzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5bGFkeWJ1ZzcyNVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2Fyb2xpbmFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUGdVUzJqSVFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyNjcyZWNlMDE4MDc5NDY5NzczNzYzMzI4NTg2YzhhN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwZTBkZjRhNjBiZmViZmIzYTRmYTg3MTc0OWI3NjFjOWE2Mzk4ODliXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNWE1OTFkOGRhYTdiYzQ4ZTU4NGNlNWQ5MGJiZGRlMmRiY2YwNzU1ZjNmNzkzOWM3MTE1YTM1ZGU3YWEwYTM5NlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzE2NTk3OTA1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjc0NDQ0NDQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTI0KS03OTgtNjk0OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjkyKS0xMTYtODMxMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc3My04OC02OTczXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3ZGU5ODE5ZjQ2NTQzOGJkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJyYW5kaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImx1Y2FzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MzA2IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkZXRyb2l0XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2FzaGluZ3RvblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxNTQwOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYnJhbmRpZS5sdWNhczU2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJyZWRzd2FuNzg0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqb2FubmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwia0k2SlRHcllcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjZDQ1ZDFkNDJiZGViNzRkY2Q4MmNhNzZhYjBkNzEzMlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1ZmZiYTExM2NiMzM0YTZiYWYxY2E5ZWE2ZTJlZGQ3ZGM2YWU0NjM2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYWUyYmQ1NzZlNzJjMmJlMGE4NWEwNmQzZWU1OWEwNjNmZDk3ZmVhZjgzMDY4ZDUxZDMzODdjOTMzYzBkNzJhYVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjAxOTgwMDkwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzEzOTYwMTRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1ODUpLTk2OC0xNzcyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4MzIpLTQ0NS03OTQxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTYwLTExLTI0NzRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdmMjQ5ZTQ4ZDlmZTUzYjlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibmljaG9sYXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndlbGxzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxMTU4IGVkd2FyZHMgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNhbGR3ZWxsXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW5kaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1ODYzOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibmljaG9sYXMud2VsbHM4NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93ZmlzaDQxMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmlnb25lXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImhRRkVGOFFEXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNjA5ODU4Yzc1NzRkYjE0MTlkZDVhZjg3N2ZhY2FjZGFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzc5NmYyOWQyMjY1MTY3ZTJhMmUwOTBhOGI2NTMxMWYzYjJhNWRjYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ5ZWVlYWIwYjYxZTBhYzM3YzNmMDNiN2EzYmRhYjQ4YjljMTE4Y2YwMzg4NWFjZjU1NzZjM2IwMTUzYzNjZDVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA4MTc2MDI4NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ2NDQ4MTM3OVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc5NCktNTYzLTUzODZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYxMiktNDgyLTgwMzNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMTctMjUtMjk1NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2I2Y2Y0YjU0N2MyZGUyYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRhbnlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU2MTQgbWNjbGVsbGFuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJqb2xpZXRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjYWxpZm9ybmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ3NjMxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0YW55YS5kYXkxNkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlcGVhY29jazUzOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2FzaFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJQS2NhVm9PMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNjMGZlMzMwZWVkNDExYWMxNDdkZTIyNmQ3ZDVhNWEzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjc3YWVhODRhNjNhODZiYzkzMjI0OGNiMGQxODFiNDNlNmYwZmIzOTJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIzMjRhZmYzOGJhNTJlODcwMGU5NzFiMjQ0MWRlYzc4MTEzMmFlYmMxMTdmZDI2YmM1ZDNiZjAyZjgxYTM1MTIyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMzU3NzIwNjNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI5MjU5MDMyOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgyMCktOTIxLTYxOTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM0MyktNzMzLTk1MTFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4MjYtNDItMjAzOVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vODUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzg1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzg1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDk5NDMwMTc2MmJkZjAxMlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXhcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdhcnJldHRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ1MzcgbGFrZXZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm1lc3F1aXRlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFyeWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjgyMTRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1heC5nYXJyZXR0MzlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRlY2F0OTkwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJvcmd5XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjBGQ21wZUFlXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWRmY2UwMDE5YTkwMDRjMzY5YjZkNWQ5ZjQzMzRjYjBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOWZhMTg1MjNhOTIzNTVhNGJmMThiNWVkYTZiNzM1NzgxMDEyZTQxNlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImQ5NGY3YjJmZGI4NjM3ZmQ1YzJkMTlmMjRhZDhkOGRmNjQ2ZDYzYTE5ZmRmODExNjgwYmE1NmRiNmM2Y2UwODlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3NjUzMDM1NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM3OTI2Mzk3NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU3NSktMjQzLTU0MzlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyNyktOTM4LTkyNDNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0OTAtOTQtODY2MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzU5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzU5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzMwYzgyODI2ZDJkOGExMFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqZXJlbWlhaFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYWx2YXJlelwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTcwMyBlZHdhcmRzIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyZWQgYmx1ZmZcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJsb3Vpc2lhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzI2NDhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImplcmVtaWFoLmFsdmFyZXo3OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxld29sZjY2NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYm9iMTIzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImZldUVLS1RaXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZGM2NjQyYjk5MWUwNGFjODAyZGNlMzg4ZTQ5MjljYTRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNWU4ZWYwNjkzYjgxNGQ4MGMyMTVjN2MwYWMwZWQwMDg4YTcxZjY0ZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjUwZmFiZDc1MmJiMmE1OGIzYTZjYjg0YTdkNTdkZjg5NDJiZWRhZGM0N2MxNzE3NjI4MzU1YTljYTcwNGUwYTVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIxMDgwMTUwMFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ0MzE5ODU3OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMyNSktNTg5LTk3NjBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk2MSktODA1LTExNTVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzNDAtNTUtNzc3N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZjc3NTIxZWYzYzg3YWNjMlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjb3J5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkYXZpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjk4MSBtaWxsZXIgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiYWtlcnNmaWVsZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTMzNDZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNvcnkuZGF2aXM1MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW53b2xmOTM1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxODQzNjU3MlwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJyT2ZqbGpoZ1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImZjMTVkOWVhZjdlYzhiYjVkMmYzMzJmNmU3ZjM1ODA3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImEwMTEwZTNkYmIyMjQzZDM4MTUxMTc4YmMyMjk0YjVlYmQ0ZmE2M2JcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4Y2EyNzM2ZjY0ODIwNzYxMzQ2YmRlMjg4M2Y1OWMwZGRjZjhmN2VjZGI0MDllMzJkOTc0YWQzOTRmMzIxZDcxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNjM1MTY2MjlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MzQ5ODQxMzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NDUpLTMzOC05OTcyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NDgpLTYzMi01MDk0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzIwLTMyLTI4MzBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi84OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzg5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi84OS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImUzYjQzOGQ0ZDBhZjhhZjRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhYmlnYWlsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJncmF5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyODI0IHBhZGRvY2sgd2F5XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJtZWRmb3JkXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFpbmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTQ1NDJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFiaWdhaWwuZ3JheTY3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWd3b2xmNzIxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3ZXN0b25cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiQUZVS0dWekVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwZjM3OTliMDVkMDhmZTdiOTlhNDRhOTVmOWNjZmNhOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2NGM4YTQ5M2JmMDkwNTU1MGM3YmQwYzgxYTRiOTYyZTAyYTM3MjRiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjY0YTFmNzFjYmQ3Y2Y2OThlZmM1MDE2YzVlNWZjNDhhMTM1NjA1NzQxY2VhZTUyY2FhMmU5Njg2M2QwNDEwN1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTcyOTk3NjkxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjcxNjUwMjA0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzY4KS02NDUtMjM0MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTI5KS00NDUtNTUyMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkzNC04Ny05NTgyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzMDU1YmM4MjdmMGJhMDc3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImplZmZyZXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJ1aXpcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQzMDMgbWFyc2ggbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNsZXZlbGFuZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInNvdXRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2Mjk2N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamVmZnJleS5ydWl6MzBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWNhdDMyOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwid29tYmxlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm1jNFdCeWJaXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiN2VhNTFjNzBmMGRkZTgxYmE2NTkyMWZkYmYwNzA3ODRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZDI0MGE0NmNlNTA0Zjg4ODExZDc0NDYxMDA2ZjhmOGY4ZDAxNmE4OFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNmZjdmMzg1ZTFkYmQ4ZGZlMGY3YTE1Y2NjZjFiZjNiYmI0Y2YwMzQ0NWUwZDYyNDU4MzRjODNjM2Y1Yzc3MDRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM5MzAyNTIwOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQzNDA4MzQ0OVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcxOSktNTE0LTU5NzNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkwNSktNzM4LTUxNzlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMjctODItMTk1MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMDIyZGE1ZTYxNDQ1OTRhNlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImphbmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJvZ2Vyc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTQ3OCB0aW1iZXIgd29sZiB0cmFpbFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29sdW1idXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3YXNoaW5ndG9uXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkzMDc4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqYW5lLnJvZ2VyczYwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiZWF1dGlmdWxsaW9uNDRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhpZ2hoZWVsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInRLWXpCYmlGXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNzdlZTI2NjI0NTlkZjhlN2M1YzcxMzhmM2ZiN2QwNmRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNmM2MTMyMjhhMDVkNzAyODdmY2Y2Njg3YWUxNDQxOTk2YTBjMzNjNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ2NTNlOTVkYzMxNThiODM1NDUzNmJjZWM2ODQzNTYwODQxMDcxZjQ0ZDhlM2Q0MjgzYTIzMjMzMjdhZTU5NzFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTQ3MTYxNDU3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNzU3MDM3ODNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMTMpLTc2Ny01NjY1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMjMpLTQxMS0xNDMzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTgyLTE1LTUyNzhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yNS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjg2NGVjZmY5OTNiMWM0YmNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhcmlhbm5hXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtaWxlc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzY0MSBzdW5zZXQgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW5kIHByYWlyaWVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJsb3Vpc2lhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjk1MjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFyaWFubmEubWlsZXM1NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiY3JhenlkdWNrODc5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJiaWdmb290XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjJNazdOcnhQXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2FkMDYxNzZmZmY4ZTZkZWMzNDhjMmYxZTA0MDM5OWVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiN2I3YjExMDBhNGI2ODQ5OTkzYTBjYTU0ZmU1ZjQ5OGY2MDA4NjBlY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjAzNmEyYTJjMGViMWMzYjdiZGVkNmNhZjZiNjUwZTAyZTIwMGViYjMwNDQ1YWY4YTZhNzMxZTE2MjRjYjllODNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA5MjE0MjI4NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ1OTk2MzU5N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkyOSktNzQwLTI3NTVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE1MCktNDk5LTY0NzBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3OTUtNzItNjMyMVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODdmZmRkNTFkNjIxMTQyYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ2aWNraWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhcnBlbnRlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzgyOSBzaGFkeSBsbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicm9hbm9rZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInd5b21pbmdcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjM4MjBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInZpY2tpZS5jYXJwZW50ZXIxMEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93cGVhY29jazI0OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibGFuY2lhXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm5kTFVtSVBIXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNWU0OTNmMzhiYTI2NzQxODAxZTBkZjg4YzZhMmFmMTRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMGU2YmZjOGMwNzAxOGI5OWZkZDk4MjA5NzNiZGE5NGQ0MTVjNTI5ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjZhYzQwZDdmMzBlNTU2NTg0YTc0YjAxODliZmY5NDNkZmNmMjVlNjM0MzI1NDFlMDU2OTYzODVjMGMxMTI5NzZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM3NDA2MTA3NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI4NzMyNjYxNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDM0NiktMzk1LTc4NzZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIwNiktNjQ1LTI3MDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2ODAtMjQtMjIyNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzY1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMGM3Y2IxNGYxZjg4Nzg3N1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbGxpc29uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJvbGl2ZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY1ODYgcGx1bSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbnRzIHBhc3NcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgeW9ya1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4OTAwOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWxsaXNvbi5vbGl2ZXI1MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZXBlYWNvY2sxMTlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1hbmdcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieUtmaTZNdFNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkZThmNDRlZTQ1OWY5YzUxZDg5NDlhYWYxZWJmMDIzNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMjNiMjAxZmIwNmRhMGUzZjY2ODljNTc3NjUxNjdjYWM1OGFiODI1XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmZjZDFmOWQ2NGNiOGYwMDc1NzMzYmU2OTEyZWJhNWUwZGRkYmEyNWM1MjcxZWJkMzQ0NzU2NzcxNGNjNTc3OVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTY3MTc3Nzk3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDIxNDI2MzAwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODE3KS0yNzMtOTc5N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjQ3KS0yODktOTc2NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcwNC03MS02OTY5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4Mzg0NjAwMGUxM2YyZjRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZGVhbm5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJhdGVzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3NDE0IHcgNnRoIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldmFuc3ZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2hpb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5NTA0NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZGVhbm4uYmF0ZXM5NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3Jhbmdla29hbGE2ODVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImdpb3JnaW9cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwic2hLQ0RDVzBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJmY2ZiM2I5M2FmYTBmZjMyMTYwYjE5M2MwY2IzZjAzOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwNDZhNmRjMzA0MGU1ZGZhOTdmNmZlMjFkODNiNzBmNWFmYmNhMmU5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZDMzMTVkNjYwMDE3M2EzZjJiYTVmZjAyMGM5OWM1YjA0MGI4ODlkMzQ5YmY4MzA4MzUyZmI2ODJmMzdiNmY3ZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDUxMTEyNjQ3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU5NDg5MDQxXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTkyKS0zNTYtMzI1MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjY0KS0yMzUtNDEyNFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ0My00My05NzM1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI5M2Y4ODllNTNkMTQwNjM0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtaWxkcmVkXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmcmF6aWVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzMDI2IHJhaWxyb2FkIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgzNTc3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtaWxkcmVkLmZyYXppZXIxOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVidXR0ZXJmbHk1NzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhvb3RlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIwZUZwRldXaFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjQ1MjI1MTE4MTJhMWUyMGJlZWEwM2EyNTVkZGM2OTM1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIzMjg2MmZlZTA0ZWUwNjEzY2I3YjZkOGE2ZDA4NjA3MmY5N2E4Y2VcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiMzMyZTI3OGIzNDg2ZGYwNGVjZTQxYWI3NjFjNGRmZWJjYjg3M2I2Mjg4ZTc5YzE2ZGVhNjFmODdlOThhNWZkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMzQ5NzgwMDFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyOTU3Mjg4NzZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MzMpLTI1NC04MDY2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0MDEpLTI0MC0xNTUzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTU0LTI5LTgwMTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzMxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImIzMTE0NTkyMTQ0YzYxZWNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJsZW9uYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JheVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTI1MyBtaWxsZXIgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldmVyZXR0XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzYyMjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImxlb25hLmdyYXk2M0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmxhY2tvc3RyaWNoNzk0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjbGlwcGVyc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJmUWpXa2lPeVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImI1NzM0MGU3MzVmN2IwOTg3NDgxZWZiMzhmNDIwYzk4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjUyNzRiMDg0OWMwZWFkOGRlZWZmMGJlYTc5YmNkYWM4YTc2YzRjMWFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwY2I4ZTE1ZDEzMTc5NzJkYTA5NmMzMWIxOThhMTZkNjM5MGRlOGQ3ZjI0Y2U2YjM0ZWY5NzM2NWFjY2VmMzg0XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMzk4NzIzODhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNTMxNjAzMTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0ODApLTczOC0yNDE2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzMpLTQwNy0zMzg4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzA5LTI2LTkyNDJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImM5M2VmMjI2YzJmMDhlYTZcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia2VsbHlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vbnRnb21lcnlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg3NjIgcGFkZG9jayB3YXlcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInN0b2NrdG9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2Fuc2FzXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkxOTIxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJrZWxseS5tb250Z29tZXJ5MjlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJyb3dubGFkeWJ1ZzUxMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicG9zc3VtXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjBEUHJTbzJrXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMThkODM5OTExMmQ2NTY5MjAxM2Q0YTc5MzUzNmJmNzRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZWQ1MDNmZWQ5YzMzMDRiZWNlZDFhYzhjYmM2YzcyOTI4ZmUyODE4M1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjMyMzU2ZDM3MTcxMmY4NjM0ZjYxZGFmNzkwNmU1YWNiNmI5YmVmZWRiMjMzNDcxMmNlNDQwNTc1OWZiZmFhNzFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE4MDg0OTYxNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM3NjMyNTMwOFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg0NCktNjE5LTk2NjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc4NSktNzg3LTk4MTJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMzgtOTYtNzA3M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjFiNDVjMTE5NDdiNDkxOFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb2dlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwia2ltXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNTU1IGxha2V2aWV3IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmcmVtb250XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibW9udGFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4ODkxNVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9nZXIua2ltNTlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmxpb240NDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImppbGxpYW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiWXR5Rk5LSVRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhNDY3MDkzZGVlYTM5YTIzNzJmZjA2MjFlM2M0YTczMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIzY2JmYzEyYTcyZTlhNDY1MjdlNmE3ZGI3MDJiOGZjMGEyZjFjNGI5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjE5ZGUwYWRjZGJjZmE2MDI4ODNhMjRjODVmNTM2N2VmZTQwMmQ4M2NlZTA5MDVjMDJiMGYxYWY2NmVjY2M0YVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzI1NjM0OTc2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjQwODY2NzU2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzM0KS03NjItNjI4N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTQ1KS04MDgtNDY3N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY0NC04MS0xMTEzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhNTVhNmY5NmVmYmYyMTg4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFtYW5kYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZmxlbWluZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzYzNiB3IGRhbGxhcyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVuZGVyc29uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggY2Fyb2xpbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzU2MzNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFtYW5kYS5mbGVtaW5nNzBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJlYXV0aWZ1bG9zdHJpY2g1OTNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNtaXRoZXJzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIk1Nc3VlZTZNXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDg1ZjljNDBkYmI2MzczN2IwNzk2ODk2NzE5YjY4MmNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMWM5MzY5ZjI1OTI2ZTEwNmU2MWVkZjczNmIwMWMyNTU2ZTM0MTVlY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjVjMTBkMjg4N2JhMWM4YzljYTRjYzIzNThmZThiMzVjMzBhMDY0ZGRmNjZkNGZhN2YxODFmNDcyMTZhNjcxNGVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM3OTY4NzA1M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQzNDUwNDExM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcyNiktNTgyLTczMzZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEyNCktNTU1LTMxOThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNDctOTYtNjkyNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzYzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzBjNTU4ZmNhNjRiOTA2YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkZWFuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjdXJ0aXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjExNzkgc3RldmVucyBjcmVlayBibHZkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldXJla2FcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJub3J0aCBjYXJvbGluYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyNTUyOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZGVhbi5jdXJ0aXM4M0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxsZW9wYXJkNTQ3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJkZW1vXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjZrWDlFV1FoXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2E4MTc5OWZjYmVjZmYzYmVjNzdmNTFmODIzMzY3MTNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjMwYmFmMTFhZTQwZGUxNDc5MDllOGRjYTVkNDhhNzViYjZmMWY4ZFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjA1ZTcxMDFmNTBiMGE1NjUxNDg0MjY2MmE3ZDViM2IzYzI0OGQzNjViY2U1ZWI4NzZkNmZiMTI0MzM1ODQzZGZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTQxODQ1MDQxNFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE0OTkxODI4N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDIyNSktNDkyLTY2MjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIzMiktNDc2LTI0NDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4MjQtMjQtMjc2MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzU2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzU2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmQ3N2Q1NjlmZjI5ZmQ5OFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInZhbGVyaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJlY2tcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE0MzEgY29sbGVnZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwieW9ya1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjEyMzY1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ2YWxlcmllLmJlY2sxOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWxlb3BhcmQxMDdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImphbW1pblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSWTB6ZUtWOFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE3MjMwNjk1MGVmZjRkZmVmZTM0ZDFmZWRkMmQxYzAzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjc4ZDZlNjhjYmNlYjNjODVmNTUzN2JkNzllNTA2OTMyNzkxZWI2NzBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiMGYxYWE0MjdkYzM4ZTE4OGQ3NTk0MGFhNDZmOWM5MTdiMmRlMjlkZDFhMzY2NjFkYjQxYjEyMWQ2Y2Q1YTM4XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNzEzMzc2MzhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI3MjkyMDMxMVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDI0MyktNzY5LTQ3MzdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg2NyktMjEwLTcxODdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MTMtNzAtOTg3NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzkxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzkxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzVlMjI1YTcxMzFmOGViNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkYXJ5bFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic2hhd1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzU0NiBrYXJlbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxidXF1ZXJxdWVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3eW9taW5nXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM4NTAwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkYXJ5bC5zaGF3MTVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVmcm9nNTY1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmbGFtaW5nb1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJdEQwcjFXRlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjQ4YzUxMjYzMzMzMjhkOGU1YTMzNDkwZmE0MzUyMDE3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjE5YTY0ZGRlYjI5YjdhZGI2NTQwM2FmNGM4M2Q2OTdkNzMzNDllOGVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5NGZmMmQyMTc5YTIyN2Q1OThhNWRhNDQ4NjgxOGRiOWQ1NDQ1MWRmZmUwMTI2MTE0NmJkMDE5Y2NkNzk1MmIyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk0MDQ1NTgxM1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjExMzk1MjU4NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU0MyktMTc0LTU1NDVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM0MiktMTAzLTIwMjhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4NDUtNDctMjQ2OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiY2I1MGUxNDkzNWEwMjRmMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInBlZ2d5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJvbGl2ZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ4MjggbWlsbGVyIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZmxvd2VybW91bmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgbWV4aWNvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg3NTQ0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJwZWdneS5vbGl2ZXI1MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxsZW9wYXJkMjQzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzdHJhd2JlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJmRmlvZGZqdVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZkODBhYmQwMmYwMDFlYWE3NWE3YzcxZmMwMjY0NTk2XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImY4ODNkMWIyZmMzNDY2NjFmNWFiODI3NGNlMzE3NmQ1NmUwODJiYTFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyYTI5YmJiNjQzZTg2YjBmNTI5YzdmODYzNmQzM2U3NWIyM2ZjOGI5MTdjNDkzZGYxZWE2YWM0ZTAzYTY2OWIzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNDYzNzQzNzZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NzQ1NzU1NzVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMzQpLTY4Ny0xMDIyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMDIpLTg0Mi01ODQ3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTI3LTUyLTI0NzhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjE3ZGYxOWRjOGQxMzYwNjFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYWxsYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJleW5vbGRzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5NTk4IHdoZWVsZXIgcmlkZ2UgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJlbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiYWxhc2thXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY0NDY0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbGxhbi5yZXlub2xkczQ3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aW55ZnJvZzMwN1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidmlwZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS2NCYXlRR1VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhNDE5YTg0MzJmOTE0YWQ4OTMwZmY5OWVjYTU1YzA1OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlYWFlMjZhNzk3YmY2OGI4NjM2MDRkY2UzMmMyMGRhNGM1YjYzZTA3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzNlZjZjMmMxZWI0OGQ0NTMxYzA2ZThiODc0NDEyOTM2ZjZiNGU5NTcwNDJmMmMzYjU2Mzc1ZTY1NGI1NDA3N1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTkwMjI2MDkwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjAwNjg3Nzg2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTMxKS05MTItMjM2N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODgxKS00OTMtOTg5M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1MS04OC0xNDc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiYmExYTgyZTEyMTM0YTQ5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiem9leVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGFycmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5ODA4IGthcmVuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzYWNyYW1lbnRvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2lzY29uc2luXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkxNzE3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ6b2V5LmhhcnJpczg5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGZyb2cyOTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInRpdHRzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkxjckJwQ3pPXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTk4ZjQzOGQyYjQ5YzZiZDM1YzdlYmI5NGM0YWNjOGVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZTU2MDQwY2Q3Nzk4MWM0YjJkMDI2NjNmNWZhNGY5MWZhMjE4MTI4ZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjA4YjU0NDg5NjNkYjIwYzBiZDg0ZTVmMTljZGVhZWJhNjFhNzA0ZjQ5YTAyOGY2Njk2YmIwZTYyMGU0NzU4OTJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTQwNzA5NzEzM1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM0NDQ1NjY3NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkyOCktNzg5LTI2MjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEzNSktODA3LTY1MDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNTQtODItNTUzOVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vOTUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzk1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzk1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDdkNWYxYWU4Y2MzMTQ0YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjaGVzdGVyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJsdWNhc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjgwMyB3IGJlbHQgbGluZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmVkIGJsdWZmXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaWRhaG9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTU2NTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNoZXN0ZXIubHVjYXMyMEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWRvZzU2M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicGljdGVyZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJrb2ZqdUJ2Z1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImFhNDc3OWQ3Y2NkN2EzMWY3ODk2MmYzNzZhYzJhZTdjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE3YWUzYTYyNTZkNjc2NTE3OGRhOTEzMjBhZjllMWNkZDg1ZDEzYmNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhM2U2YjZlYmM2Y2UxMDA3MzA2OWZhMDE2ZTZkZGNhMjYxZmIwNDg5MTc2NWNmZGQxMTM2YThiOGU2YTNmMDFmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk1MDI4MjM5M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM1MjI4Nzk2M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU4NSktMTE1LTExMThcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk2NyktMzMwLTE2ODdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4NzMtODAtMjM1NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzQ3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNDcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzQ3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTFlYWIxZmRmMWMwYWQ0YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjaGVybHlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN1dHRvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjExMyBvYWsgbGF3biBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvcHBlbGxcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrZW50dWNreVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3ODQ3MVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2hlcmx5LnN1dHRvbjU3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJoZWF2eW1lZXJjYXQ5NTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjcyNzI3MlwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJWSjRiejFYRVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjA5NWRjNWE3OTI0Zjg1MGY4N2JmNmNiMzNjMjlmODMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImNlNjAxMWNjODM3NGMyYjEwOWZjMjIwNWY1NjI5ZGU0YjBiZDA2MGJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2YmYzNWE3ZTVjYzAwMjY4NjlkM2IyYTllMDllOGJhMzU0MWIyYjNlMDU1MTVjZjExZjMyYWM5MGUyZjZkNjQ2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExMDYzMzY5NzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMjY3NTQ0MjNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMTYpLTI2Ny01MDIzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0OTApLTY1NC01NjkzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTQwLTk4LTIyNjRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwZWFmZWYwNWNiMjgyYWNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiam9yZGFuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYW1pbHRvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODY3MCBwYXJrZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImlvd2EgcGFya1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInBlbm5zeWx2YW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MDU1MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiam9yZGFuLmhhbWlsdG9uOTdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJyb3duZnJvZzc2OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicG91bmRlZFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJsbVJmNzk5d1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjUzYzg5ZDMzZWUzYWU2MzdkMzI3MmNmZGQwMzE3MGM1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQ4MTdlOGM4NzUyMGQ2YWY4MTliMzg5ZjEyNjEyNzkwYTdjY2UzMmZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4ODlhZGVkZWQ2YmZlMTBjODRiMzMwMzllYjY2NTUwZGVjYzNmYTkwYzMzNTNiNWU3OWY1MzEyOTVjYjI4YjdkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNjE3MzI1MTFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Mjc4MDA3NjJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0ODMpLTg2MC04MDY0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0ODYpLTc3My0zNzA2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTU5LTIwLTQ4OTlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjliZjVhNWI1ZjA0MTEyZDBcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJnZW5lc2lzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmbGV0Y2hlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTkyMiBkZXBhdWwgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV2YWRhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjExMTY0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJnZW5lc2lzLmZsZXRjaGVyNTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGNhdDk3MlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibGluZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJzZnREaWxYUFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImJkYTE5NTU0MDdjYzhhOTRiZjQyYTg4Y2I2MWUwMDMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjdmYzQ4ZGMwNmJmNTVlYjY1ZTQ2NjM1MDM1ZmIzZjA1OGZiMzkxNDhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkZmUxMGIzZDU1ZDY3YWRmODM1ZDNjYzQwOGRhZGMxOTU5YzUxODljOTI0ZDNiNTU0MDM5NjIwYTI4ZGEwYTk0XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzExNDQ4MTZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI3MzUwMzUzNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQzNiktNzY5LTQ4NjFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkzMCktOTI1LTQzNjlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNTItNDUtODYzMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDExZTkwOTc2N2NlNWQzMlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0b2RkXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzaW1wc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NzM4IHcgYmVsdCBsaW5lIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmb3J0IGNvbGxpbnNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb2xvcmFkb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NDI0MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidG9kZC5zaW1wc29uMzRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsY2F0MzBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImRyZWFtXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImxKa1ZSYVN3XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWJlZThiMzFmMTgxMTBjOTc4YzA5ZjllOGQ2ZDMwMDZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNGQ3MDExYWJkZjRkM2QzMGE4MDg4NjZjY2Y4NjVkNDY0YWViYzY2NVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjcyZjZhY2U1OTI3N2Q3NTBkMTVhNzRkOGE4NDc4YmFmNzI5MDA4YmIxZTY4MGUwYTU5YWZkM2MyYzkxY2I4ZGFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTYyNjY4MTA5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzAzMDk0NjcxXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDU2KS04NjktNjMwMFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzg1KS0yOTMtNTAxMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ2NC03OS01ODg3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkMzA5YTNjY2Y1MDI5M2RiXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImx1a2VcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vb3JlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3MjMyIGNvbGxlZ2Ugc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImR1bmNhbnZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib3JlZ29uXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE4NDAzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsdWtlLm1vb3JlNzhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVmcm9nNTQ0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJoYW5uYWgxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlMxOXo4eEFXXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDg3ODU1M2FlY2VkMzIwODY4M2ZlMDNkN2M3Yzk3NmNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMzNjMTViMGNiODkwZGVmNDMzNzc4ZTBkOGZhMzJlZTRmZTk3NDFmOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjFiMzY4NmY2YzZjMmRmMzc0MDE0ZDAzYTQwZTEyMmNkMmU2NjhmNDlmNmI2MjQ0MmU1YTQ1YmU4ZTNkYmMwMDZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3NDczMzI3NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMyNTI2ODUwNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU0OSktNzI4LTY4MTFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc3MCktMzYxLTg3NzFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MjgtMjItNzUwMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzEzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTI1MjVhNThkYWU1OTE5YlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJsb3VlbGxhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhZGFtc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODI5NiBkZXBhdWwgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJlZCBvYWtcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJub3J0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjI1MzlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImxvdWVsbGEuYWRhbXM5NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiY3JhenlwYW5kYTM1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic3BhY2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwicVpZUk1OVDNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIzZjFjMDY5NzMwMDBhODI0YTc3MGRkOGE4N2Q2MTExMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIzMTAyNGYxYTk2YWE0ODNhMTVhYzU3NmY0ODA3OTdhMzM5ZGQzM2I0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNmEyNDliNjFkNDI0Mzg2ZWUwMmI3ZjQ4MTc2Nzg4MDY2ZjVkODE5NWU0NjNjMzM1YTg5MWI2ZDE4ZGQ5ZWZlZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzU5ODA3Mzg5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM2NjUzMTI0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODk5KS0zNTctOTcyMFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDEwKS0yMjAtNTU2MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjM0My0yNS03MTYxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NTgyNGY3MTlmYWUxZWQ5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJlcmlrYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicmV5bm9sZHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc5ODAgZGVwYXVsIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb2x1bWJ1c1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInRlbm5lc3NlZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MjMzNVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZXJpa2EucmV5bm9sZHM4OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwidGlja2xpc2hkb2cyMVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwia2VubmV0aFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSZXlxd3k2Q1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImZiN2VlNzAxMjJmYmZjNzJiODBkZWE2ZTg0OTYwYTU2XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImJhM2ZhYjY3ZDk3NGE4OWMyYjQwYmI1ZTI0ZjQwYjY3YzQ0NGNlYmFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmMGE0YjhlMDM5MDBlYTNlMGZjMjI0ODFmZTMwMWNlMjAzYjViZTdhNjc4ZTg3YWEwYjMzM2M1MTc3ODJkNjhkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNjI1Njk0NjBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI1Mzk2NTAzOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQxMSktNzAzLTU0MTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM5MiktNDgyLTE3MTlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNzYtMjktODAxNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzEyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzEyLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmRkYTlhOWY1NjE0NTAzYlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJldWdlbmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjQ2MCBhc2ggZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRlc290b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInBlbm5zeWx2YW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNzMwMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZXVnZW5lLm9saXZlcjUyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dlbGVwaGFudDkxMlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMDEyMzQ1NjdcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiN1RmUGxQSk1cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxNTUxNWEyYzEyZjgyOTFiZjdlYjIzMzA2ODA4NWNmZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhNzYwOWI3N2Y2MWU1NDkyMDFkNTg5N2VhMmYyYmFkNDNjZGYwMmY5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2Y5Zjc2ZmM5MDk2OGZjZmVmZTRjOWViNzdmZjhhZmQ1NmMzNTZmZjAxY2RhMmNiOWQxZDc5MzQyMzgyZTUxNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDc1MzU5MjQxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiOTUzNTIwMDNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxMDApLTUyMi00Njk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1OTgpLTQ4OS0zNjQ4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTc2LTkxLTE3MjJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8yNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjZjMmEwNTQ3ZGM4OTdjYTFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia3Jpc3RpblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGFuc2VuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NjA3IGZpbmNoZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm1vZGVzdG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJub3J0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODQ3NzlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImtyaXN0aW4uaGFuc2VuOTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2dvcmlsbGE2MTZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjI3MjdcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUUxtS0Z1bGpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkMTMxNWNjYmZiZjY0Yjc5NDcyMzIwYmQwZjNlMDYzZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlMjE5MWJmNmQwZmUzN2IxMGI1ZDk2NTdjMWZiZmY1YTI3MWQwZmU5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDY3ODM2ZThiMWE0ODIzN2JlNGI5Nzc5OWRjZDliMWRiYTEwMmYzNjM2YzYyM2NlODgwZjc5OGRlMDQ2NTQzZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjU3NTk4Mzk5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNTkzMDMyMTBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1ODgpLTY0OC0xMTYzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5OTEpLTQ5NS02NTU4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTE4LTE0LTg4NjBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi82OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQ0ODBlNmQ3MWU5Y2FkZjlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYXJub2xkXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJqaW1lbmV6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNzM2IG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsYmFueVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImFya2Fuc2FzXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY1MzI5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhcm5vbGQuamltZW5lejIxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJnb3JpbGxhNDcyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJza3lkaXZlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIktKUEtVT3pBXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNGY4MTFkYWY2YzdhNDIzMTJhOGQxOWY0NjhkMzkwZjhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzg1ODlhMTA1YzgwYWE1MGJhNzRiMTJkMGVmMWM2NTFkYzM2NWZiOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImJkY2I0NTEwYjQ4ZTY5MzA4MGQxZTJkNjU3OWVlMDcyZmNiYjIxYzIxMmJjOWIyYTBjYWEyMzY5ZGM3NzQzODNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1NzYxOTk1NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2MDM1NzQ3M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDY2NiktNzc1LTIyNTBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYzNSktOTg5LTQ1NDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1ODctODAtMzY1M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzY4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzYwNDI5NGZiYzhlNTNmN1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbWVsaWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJvZHJpZ3VlelwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjc3OSBzaGFkeSBsbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2hlbGJ5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlubmVzb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc0ODUzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbWVsaWEucm9kcmlndWV6MzhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRla29hbGE4NTZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNub3diYWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklNT2c4WmRvXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiN2JjNzE1Yjc4NjllYWYyZmI4N2MwNTZiZDcwMzg5ZjVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOTAxZWNiZTBiYTM5NmM4YzIwNDg2Y2E4NTc2ODU4Y2ZkNWU5NDRjNlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjlkYWRkYWQwMDFlZWRhM2FmNzhiMDUzZmU4ZDYxMTk5MzBkMmUyNTJiYzBlOGY4MGNjNjEyOWE2M2MxNjRkMzVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA4NjM1MDE1N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI1OTI0Mzk1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDU4KS00MDktMzc3NFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTU0KS03ODAtODAwNFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkzMC0yNC0xMjUyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiZTEyZDUxZTk4MDYwODg0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1heFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGVucnlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE0OTYgcGFya2VyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkdW1hc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgyMzg2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXguaGVucnk1MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWtvYWxhNDMxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsaXZlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjNFT0tpUGRhXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOTM5NjQzMzg4ZWRlZmJlNDM2NWY5YTIwYzliOWE2YmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOTQ1MDYyNmI5YmRiMTI4OGEwNmVmZTY4MDU0YjkwYTlhMTYxYWEyMFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNhZTAyZjEyOWIxZmMyODIyZDJkY2YwYjM3MjA2MjQ1N2U5MWVmMjU5NTAxYWIyZmY4MzA1NDZlYTU3ZWFhMzNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI0NTc3MDIxMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE4NjI4MTQ0OVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc5MCktODIyLTY4NDJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM1MSktNzc3LTUzMTFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MTEtNDctMjk3M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzY1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2RkZmQ3ZTUwYzE3OTBhZlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ3aWxsaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBhbG1lclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjMwMiBib2xsaW5nZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRldHJvaXRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvaGlvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg2MzEzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ3aWxsaWUucGFsbWVyNTlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yZ2FuaWNnb3JpbGxhNTM5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJicnV0dXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSkk2WnlLVlNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwZDM1NjBlZTUxMmFkMTZlZWU4M2IxMGNjM2RjZWVkZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwNzE3Mjg4MWM4OWMzMWJkNmFhNzNlNjgwNzRiZjQ0Y2ExMzM0NGI0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjYwZmU1YWM0NDQ4YWViMmYwNzNlNDVkMmI3Nzc4MDIxZGMzYzdiNTdlNTBmMjU2MDM2ZTI4ZDUxNTdiY2YzMVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDQ2MTg5MTM3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzY3Njc0MjNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MTQpLTcwMS03OTEzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NDIpLTUxMC0xNzc2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzUyLTU2LTU3MzZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImI3ZTIzNTMwZjUxMTEzYWFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidHlsZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNvbGxpbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc0NzQgZmFpcnZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInRoZSBjb2xvbnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYXJ5bGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2ODExNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidHlsZXIuY29sbGluczgwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVjYXQ2MDlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInBhcnJvdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJvNUhwTUxEc1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImMwMjE5ZjY0ZWU4Yjc1N2M4OGJiZmE2YTY0MDU5YTcwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImEyMDZjMDdmNDhlZjQyZTA4ZTFkMDBiNzVmZTE2MjE3ZWRkYzY2MmZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4ZDg0OWNmZmE2NGZlYWIxYTE2MjE5NTZmOTUzZmE5NGRmYjg0YmM3MzgyNTYwNTJkY2E2ZTRlMmNlODVhOTJmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNDkyMzM4NDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNzQxMTAwMzJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4OTcpLTEzMi04MjM2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2MTkpLTE3My05NDAwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTY0LTUzLTQyMTJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImIwMGJlMDYzNGQ5MzNkOTFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZnJhbmNpc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYW5kcmV3c1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjc5OCBmaW5jaGVyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZWxlbmFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJzb3V0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDg3OTlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImZyYW5jaXMuYW5kcmV3czI0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlYmVhcjczMVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMTk2OVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJazZkeHlyNVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZmNWYyZGFjYjYzMmNjNzQ5OTJhODE5NmRiNDBmZmM2XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImNjM2FlNWEyNTAzMDc0ZmM1YzM4YjUyZjQ3NDRjYjg1YTVmMzRjNjNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2OTM1ZTA5N2QwYjI1ZjFkNGU4MTY2ZWE5ZDkxNmJhN2VkMGUwZmIwYmY1ODQ5NGM1NjU4NzM1MDRkNzc3M2RiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNDgxMjQzNjlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNjkyNTUzNDhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNjUpLTc2Ny04MDE2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MzUpLTQ4NC00NDA5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTEzLTg5LTU5MzBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjVmMzAwMmNmOTI4ODljYThcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXhpbmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhlbmRlcnNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjY3NSBkYW5lIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjaW5jaW5uYXRpXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFpbmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjk5NzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1heGluZS5oZW5kZXJzb24yNkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93b3N0cmljaDkxM1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibWF0cml4MVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJqVlA0Y0Y1RVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImMxOTYzMzNiMDRjOWQwNzYxY2E1MTcyNTIzNDIzYTg3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImY5ZmI0NWVhMDIxMzAxYTI0ODg1YjhhOGI5MjZiY2ExNjlhYzg3MTRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4ZDk3YTE5N2JiMjI0MGIxNmE4MDE5NzdmMmQxMWI0MDJlNmZiNGY1MjgyMTA2YTkwNGM4ZjAzY2M3MzIzMDg3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMzM3MTk0MzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxMTYyMjYzNDRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NDMpLTg4MC00OTI0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NjMpLTY4Ni0xOTA2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjMzLTEwLTEwMDFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjNlMjg3OGZhYmQ5MTYzYTVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidHJhY3lcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhvcGtpbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjcxNjYgaHVudGVycyBjcmVlayBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGFtc2J1cmdcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2aXJnaW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0NTA5N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidHJhY3kuaG9wa2luczY4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVsYWR5YnVnOTQ4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJUTdsM3g3TlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImFhNzlhMmQxNWY3ZWZlYWEzNjIzNmUwNzIyY2JiNWZiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjlhY2ZkNWExM2YxM2FlNjYwOTg5ZTAwNTRjMTg0MGM4YmEwNjQzZGFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4Zjc5NjZiMjU5MzJkZjE2MGMzNDZmMTNkOTE5ZWI2YmJmY2Q2NTRlOTY5NWM2Y2ZlYTM3NmZmMjk3MjdlMDIwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMDExNzI4NzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Njk0NzMyMzBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MjYpLTUyNy0yOTA1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5ODYpLTUyMy02MTQ0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjczLTI0LTYzMjhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xMy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImExOTBhNGI0OTYxNGEwNGJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFtZWxpYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibmljaG9sc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTU0NiBhc2ggZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IHlvcmtcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjYwMjBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFtZWxpYS5uaWNob2xzNjlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRlbGFkeWJ1Zzk1M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwib2Jpd2FuXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkZEMmNYSFZpXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZTkyNjRhNzljM2NkMjhiZGE4YzQ2NDBkZDJlZDBiMGZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDE5NDIyMjU1YTNlYWNkZDI3N2ZkMDU1NTBiZjgxZjRjMTc5MzViN1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjljNGU1N2IwNGNkYTkzNGM3ZWE4NDRjMGQ3YWE1NDU5MGY1MWQ2YWNkNTEyZDVjNzAxYjY1MTZjMTRlZWY5MDZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA2ODUwMzA0N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjExMDM4Nzg5M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDY5OSktMjk5LTUzOThcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc4NyktMjM4LTU0MDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MTgtMjAtODQzMFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzkxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzkxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODRlZDBlNGZkODRlOGMwY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhdWJyZWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBldGVyc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NTg2IGVkd2FyZHMgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNhcGUgZmVhclwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBtZXhpY29cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTMyMTBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImF1YnJlZS5wZXRlcnNvbjMxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWdkdWNrOTExXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXJib25cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiYTJkNTZhdlFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3NmFkZTBkMDZkMTBhMDVhYWJmNDIxMmQxMzg3Yzg1OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4NGJkYjgwYjdlNDhhNmE5MTY0YWY4ZTAyN2YwY2Y5NDIwYTRkOWMyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMmJkMDkwMThlNDdiNWI4NzZmOTg2NzA4ODdjMDNkMTZlODJiOTEzNWVkOGU2ODE1ZTcxYmNjMDhjYzhlYzFiM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTI0Mzk1Mjc3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjMwNzQ5MTdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxMjYpLTU0OC0xMTA2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0MDQpLTM1Ni0xMjUwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODA0LTM1LTczOTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjQ0NmY0YjJjMjIwYzhhNWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImplYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBldGVyc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDE4MSB3YXNoaW5ndG9uIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYmVybmFsaWxsb1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImluZGlhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzcxMjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImplYW4ucGV0ZXJzOThAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmVsZXBoYW50MzAzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtZWF0YmFsbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ3VzU5ZjBSeVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImI3NzlhZmQzNzk5ZjdjOWFjOWRjNWUxZmM5NzBhZjJmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImFmNWQyZjgyMGQ1MDM0NGYwMTg4YTA0YThmY2VjMzZkNmM0MTAxY2FcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkMzkwYmIwMGM2NmEwYzE0MTAzYTI4MDdmNjMyMTQ3NWFiMjJkZDQ1ZjhiMjAxNjllM2Y5MjA2NTVjNTBiMGE1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMDE5NzE2NTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzIxOTk0MjlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzNzMpLTQxOS0yNzk0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1OTkpLTE5Ni0xMjQ5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzI2LTIzLTQ3NjhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImZkMDc1NTBlZDQ3MGUyMzRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYW1pbGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0YW5sZXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ3NjkgaHVudGVycyBjcmVlayBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYmlsbGluZ3NcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyNDI1NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2FtaWxhLnN0YW5sZXk4NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ29sZGVubWVlcmNhdDUwNVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwianVsZXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiNWc2MG03UEJcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1YjhlYzNkZjZlMmNkMGE0NDViNWUyNGVmZDE5YjYwY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlNTQ4MWRmNjcyOTU4NTUxYWZiZDBiNGU4MDFjYThjNWEyMjAyZWFjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjBhYjJjOTMxOWY4ZWRkMGZjMmJmZmVmYmM3NDI2MGY5MDJmNDQ5Y2NhMzg2YjZjMTc3MzFkNjRjODg0YTNkYVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzQyNjM2Njk0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTUzNjEwNzUzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTIwKS0zMzMtNTI2OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzUwKS02NTItNDE4MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjYxNC03NS03MjgzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzMDYzODVlNDdlZmVkMGNlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0b255YVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiam9yZGFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNTc5IHdoZWVsZXIgcmlkZ2UgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZsb3dlcm1vdW5kXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2tsYWhvbWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTY1MTBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRvbnlhLmpvcmRhbjMzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5ZnJvZzlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInByZWNpb3VzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIldkTVlzWURlXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDJmZDVmNzMzMDgyNmFmMzJlMmE0MTM4NDA3N2VkZjhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMWI2ZTU0OTAxNjFhYjNkNzEyZDk0NjE0MTNkNDQ0NGVlZTQ5YzFjOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIzYTdhYTQyNTQ4ZGI1YjY1ZGI5ZmQ0ZjhlZDM1MmZkMmQwMTAyNTg4MWExYWVmMDc4ZjU0MGNlYjJjYzgwODVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTMzMTg2ODgwN1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5MjU5Njk1NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDExMiktODg5LTQ4NzVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkwOSktNTUyLTU1ODZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NjAtNDUtNjc4MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIyLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjZhN2IxMzY5NmJlMDJkY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb2dlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RlcGhlbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg5NDQgZ3JlZW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJvY2hlc3RlclwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInJob2RlIGlzbGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4OTk3MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9nZXIuc3RlcGhlbnM3MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwidGlja2xpc2hyYWJiaXQ2MzZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJyeWFuMVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJhQlg0azV2V1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjIwNmM5MGRmNjkzN2I5NzMyNjQ2ZGViMDA3Y2U3YTUxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQxNzYyZTM3NmQ5MmRmYjM0ZmYyOTA0ZDRhNzFkNDg3NTY2MWQ1MDFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIxYTZkZWE4MDA2YjMwYWQxZjFmZjdlOWNjZjcwMjJmNzUzZGRjY2VmYWM3YWNiNjhlZTdlZDAxNGI0NjNjOGIxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNjAzMjQ2MDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MTI1NjI4MDhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MTcpLTk0NS0zNzQzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMTIpLTg3Ni05OTU1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTM2LTkyLTExODVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjM1OTFjZTQ2NmEzNzhlMTVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZ2VuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2FsbGFjZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTEyOCBhZGFtcyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhbGFza2FcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTExMDdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImdlbmUud2FsbGFjZTkxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlbGlvbjI3NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZW1pbGlhXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlZraEt0ZXUzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMThmNmJhMDIzMWFlMjM2ZmI3NWNmZTYzNDhjZGNhOGRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZWYyOGM1ZGUyYTgzNTNjNTQ2ZTdhMDliYmYyMGQ1ZmMyNWI3YWMxYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImFhODliZWQ0ZjA0NzdlY2ZlNDExODFlMTUyZDk2MjNiYzhkMTUyMWFhODFkMjVlMmE4NWNiNmEwNWNmNGRlNDJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA0NDQxNjE1NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE0MTQ0MTI0MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDY3MyktMzkzLTc5MzFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEzMiktNzc5LTI5OThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2NjktODUtMzY3OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi85LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi85LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzU1OGQ1YmM2ZTk1MjFmNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImt5bGllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwZXRlcnNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDU5NSBwb3BsYXIgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsYmFueVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNhbGlmb3JuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTc2NjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImt5bGllLnBldGVyc29uMzhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsYWNrZ29yaWxsYTIzMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidXRvcGlhXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm5RM1RvdklEXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjM1ODk2YTNjNjVlOTU1N2ZhYjZlMGYyMmEyMDU0MGRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDJjMmQ0ZmQwYzI5ZWEwMDcwMDNlZjYzOGJmNWQzODdlODlmNmRmN1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ5NmZmMGQzM2IyYWNiMTYyYjE0YzI5YjM2YjU1N2JmMTE5NzcyZGVlZWIwZDY3ZTBkNjhkMmVjMGUzOWU1YjFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1Nzc4MTQ1MlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI0NzY4NTE1MlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMzNyktNjY1LTk2NzdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDUzMSktMTI3LTg0ODZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3NzEtNjgtODQ0NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8wLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMmZlYTk4YWY3MjJkMWZiNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhc3NhbmRyYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2FyZFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjA5NyBmb3Jlc3QgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJpbyByYW5jaG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDQ3MjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhc3NhbmRyYS53YXJkNDhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ29zdHJpY2gzNjZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjU1YmdhdGVzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlZ4NDJucmYwXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNjdkNTJhNmUyMjY0YTFhMDIxYzg0MjYxNDIwNDQzMzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMmJhODk2NWMzZWI2YmExYzY0MDQxNjYxMGFjNmQwZWYwY2QyY2QyN1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjAxNjQxNGY1MjM1YjJlMmJiOTk2NzJmNTRmOWQzYjYzN2E0YWQ3Y2U0ZWQ4MmVkNWQ4OWZlMDI1MzEyMzYzOWNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2NTIzMTQ3MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI4OTE5ODk5M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgwOSktNTk3LTk4NDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ2MCktMzg5LTY5MDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MjAtMjktODg1NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM0LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMDI1ODg1MTU0NzQwODRjNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW15XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXRzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI2MjYgY2hlcnJ5IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhZGRpc29uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibG91aXNpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU0ODAwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbXkud2F0c29uNzBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZWZyb2c5MjBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFuZ2VsMVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJCaFlId0xQMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjhmMGUyYzRhMDY1MDBmY2JmNTM2NTczMzYyYjAwMzc4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjAxNzA5NDIyZTIzNDFmMWFhNTIzYTBjODhhZGNmMWVhYWNiZjdjMThcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyMWQ2MGQ0NjdhYzViMGI0YWVkMDc0MjI1OWY5OWJjM2QxNmVkYzA3YmYxNDJiMDljODU2ZDg2OGZkYWQ5ZTNjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk5NTgyNjQ4OFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5ODYwNTU3M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDI0NCktMjk0LTg0MjZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU3OCktMjE5LTkxOTZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5OTAtNDktNzE1MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZjliZjY3OTU0NzM3MWU2M1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXJ0ZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImR1bmNhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjY2MSBhc2ggZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW5kIHByYWlyaWVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjIyNjU5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYXJ0ZXIuZHVuY2FuNjdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImhlYXZ5YmVhcjI1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwid3d3d3d3d3dcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibUZrNzJQb1lcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2YTlkNzljZWUxNjQwNDE1MzcxZTYwMDY3YWIzOWJjMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4OGM3MmZkMGJkOWMxYWY4NDdjMGRhOTFkZTIyNWY1MzgyMWFiMzFhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZTU1Mjg2YmNiNzkzYjcxZmU0NTUxMjYzODZlYzBmYTFmZTM5YmNhODMwMjViMTFmNWRlMThmNWVlZDUwZmI5ZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NjM2NTkwOTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzM4NDEyNTVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2MTQpLTkyNS05OTAxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4OTEpLTg5My0xOTM1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjk3LTg1LTIwMzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8yNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjZhNzQwZTY1NjY0MjBhZjJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYWx5c3NhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJiYXJuZXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY5Nzcgd2hpdGUgb2FrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb3MgYW5nZWxlc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImlvd2FcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTIyNzNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFseXNzYS5iYXJuZXM3OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmxhY2tkdWNrNzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNwcmludGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlV5NENJaTRIXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMzgyYThlOGY4NGEyMmEwZTllOGQ1OTkxYmFiY2E4ZDNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTI0Y2QyNDcxY2UwZDkxZTk5MGE4YjhkOGY4YzY3NzRiOGQzZGZiOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjAyN2Y5ZWE0MmZkM2IxYTlhNjYwNGU4YTFkOTkzNTgxMDAxZmQ4OGNiODcyMmNmMzlhYWU1NTIyZmFjMjNiZjdcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM4NTI4MTkyOFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI2ODQxODcwN1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg3MCktNTI1LTkxMzRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM1OSktMTYwLTU0MDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5ODEtMjMtNTc5MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzY1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTJlNTM0Mjg4NTNjMWFjNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRlbmlzZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWFydGluXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxODIxIHJvYmluc29uIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ1dGljYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjcwNjcyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkZW5pc2UubWFydGluNDFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGJlYXIxNTdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1vbnR5MVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJqV1pVbnhhU1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImI2MDI0ODI4Mjc0NjZlZDg3OGQ1N2RjNGU3MTAyZjA5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjdlZTYzMzE3NmM3ODExYWE1ODVmOTIyMzAyNDYzNjdkMmQ3OTgxZWZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwZGJkYTYzMGNhYmZiY2RlYmMyNTVjNTRiYmM5OGRkNDE4OWI2NDE2Nzk5ZWI4ODM4N2I2MzUxYjlhYWIzZGQ0XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyODY3NjMzNjNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0OTM4OTY1N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc0OSktNTU5LTc3MTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQxMyktMzcwLTkwMTlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxMjItNjEtOTA1NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZjIwOTNlZTk2ZDJhOTdjZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb3NzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtb3JyaXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjUyNTQgbG92ZXJzIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldXJla2FcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3ZXN0IHZpcmdpbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUzMjM1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb3NzLm1vcnJpczM1QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aW55dGlnZXI1NDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInRoYW5hdG9zXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInlxNE14QnRRXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMmRmNGM4ZThmMWVkODE5ZDIwMGZiZjk0YmNjMjQxYmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNGZhODBlZTU0NTQ4NmRkODY5MzYwNDZlZjVkZDA2NDdlNzAwMWVlY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImY2ODJmMWZmN2ViY2M3MmE4NDY5M2JlNjZjMTdmZGE1OGM0YjEyOTc1YjY5NzYxNjg5MGU1MWNmMDdiMmZlZmNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI0MDkzNDgxNlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyODE3MTMxMVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcyNyktOTE4LTk3OTJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYwOCktOTU1LTM3NDRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NzgtOTgtNDI4N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzczLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzczLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTUwZjhkOTM0NWFjNzFkOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiaGVybWluaWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZvd2xlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTg5NCB3IGNhbXBiZWxsIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVtYXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2aXJnaW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4ODE0NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiaGVybWluaWEuZm93bGVyNTdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImNyYXp5bGlvbjUxNFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic21va2VyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlhCc0Rwcmd1XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDE0OTYzMmI0M2IyYWE4YTAwMDIyZmI1YjRhODgwMzdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZWZkNjg3NTVmNTFjZjIzMDdmODc3NzZkNWU1ZWM2MjA5OGIzOWVkOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImY3NmM4MDQyY2M0NTAwODAzZjIxMzI2OWUzNDFlZTY5MzgzNGVhOWE0ZDdhMGMyNWJjMmRlYzlmMjY3OWYwMGZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1ODg3NjEwNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM3MTU2NDgyOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQxNCktNjY0LTc4NjZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc5NCktOTkyLTM0MzJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMzEtODEtNTg3OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi81LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzMzNTViMGM2NDMyMDhlOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1lbGlzc2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZsZXRjaGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NjQ2IHBhZGRvY2sgd2F5XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldWdlbmVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpZGFob1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyMDUwNVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWVsaXNzYS5mbGV0Y2hlcjkzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGViZWFyNTcxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzd2VldGllXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjZ2QWtlYTd2XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOThjNDlmNTMyN2YxMjI5ZWJiOWFlOThhOThlOWQ0YWNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZmJhOTI3YjU0ZmE0ZGM2YTM0MWYxNDJjMTVmYmU0YjIyNTk3MjJkZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjY4ZjYyNjY4MGViMmEzMGMxNzlmODYwZjRmNTUzNDVjM2ZmODliNzAxOTE0NmQ1N2RiODJjODMyYWJhNzRhYmNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTcxMzMxNDM5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDc0OTE2ODk2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzA3KS05MzItNjYzOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzMxKS03NDctMzc5MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE1OC0xMC02ODk5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi83MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNzEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwMThkOGI3ZGFlZWFiYjQxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNyeXN0YWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImFsbGVuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNzQ4IGNlbnRyYWwgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm5ldyBoYXZlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9rbGFob21hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE4NTc3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjcnlzdGFsLmFsbGVuMjVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVkdWNrMThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFuZ3VzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjdpZFVGNW5CXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiN2JiYTBiOTFiZDQ2N2U4NDFhMTIwZjRlNjMxY2VhZmNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNmM2ZDE3ZGQwMjE2YTRiMWIyNjQ5ZjEwZTRiZWRhYTI2NjUzMjBlMlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjczMzAyNjdkZjAxN2JmZDliMTAwMGY3YWYzMmUyZjVmMDJkNmZhOGJkNjQ0ZjQ1NzZhNzEzNTg0ODI4NDczMTNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTYyNjI3MzM1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI2MzIzODIxXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjA1KS0yOTItNzA1MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjg4KS04NDMtNDQ0NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ5NC03NC04MTg3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhMTllYWFmZjE0YTY3Y2ZkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ3ZW5keVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZnJlZW1hblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTEwMSBsb3ZlcnMgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNoZWxieVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNhbGlmb3JuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODU3MTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIndlbmR5LmZyZWVtYW40MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnZ29yaWxsYTk4OVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMTIzMzIxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImM1bUxrSzBCXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOTY2OWUwZWI2ZTdlMTE2OGUzZmRhNmMxNDE5ZjU1YmRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOTAwY2M2OTdmMmYxZmQ5NGRkNjM5NjY0NTEwZGQ4ZjU2MTY3NmM2OFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ4MjA4ZTc1OWIxNDA3M2IxNjg3ZTZkNjAxYTRjMWIyN2MxYzVkZjJjOTIxNjU1NzllZWRmMzkzZTY4NmNiMDlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTk0MTg5MTQ3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzEyNTczMzA5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTIyKS0xNDQtNTE5NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzIzKS04NjItMzg1M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1NS02Ni04Nzg1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjN2UyYzgwNzA3ODg4MzMxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImVkdWFyZG9cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1hcnNoYWxsXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3NTk1IGUgbm9ydGggc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInRlbm5lc3NlZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MjMzM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZWR1YXJkby5tYXJzaGFsbDUwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVzbmFrZTU0MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYXJjaGFuZ2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSWRqdENNdWdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiMDkzNmNhZTMzOTNlMTE0MThlMTZmMjU0Yjk1NDM3OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1YjhmYzMyOWU1MmExMzNiY2JlYjc3MDMwOWZkY2U2OTg2YjIxOWVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiODU1MjE4NDNmMmM5YzU4ZjJkODM5ZGJkMTAxNzQ4MDRlNWEyOWQ0OThjMzJlODZhYjVmM2ZiMWMzZTA4MDY1MFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjgxNDg1Nzc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjAzOTQzMTQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDcwKS02NDUtMjY4MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTU5KS02MjQtNzU1OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyOS04Ni0yOTg3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI5YzYzOWU5YzcyYWY3MDVhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwianVsaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdyYW50XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNDgwIGxha2V2aWV3IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzdGFubGV5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW5kaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0NDI3NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwianVsaWUuZ3JhbnQ0OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW5nb29zZTM4M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaWRpb3RcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUklQUDk3UkxcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIzMDJmNGVlNmViNWQ2MDI4MTU0ZGZlYTNmYWY0ZWE5NVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMjgwYTI0NGZkZTU1ZTg4YTAzYjVhMGQ1ODU4NjNhZTMwNDJiM2ZlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOWRiMGFkOTBkNDc3YzI2MDdkNWExZTIzMzdiOGYwYzVkNGFkODA0ZjNlMWI2N2UxMzhjOGY5YzdlMjQ4NDEwMVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDE5MjA1MTQyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTc4MjM2MzY0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTE0KS04NTctMzc5N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTg1KS03MzItOTM4M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ4My03Ni03ODk0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyNmE5ZTU2MTA3YjM3ODI4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRvdWdsYXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRhdmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5Njg4IGUgbGl0dGxlIHlvcmsgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInByb3ZpZGVuY2VcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYXJ5bGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MTA2NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZG91Z2xhcy5kYXZpczM5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2Vnb29zZTE3OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibWlhbWlcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwia3VmZXNzNkdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2MzZlMWUzYjU2NmZlOThjMzlmZWNmYTE5Yzk4OGU2YlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1OTc1N2VkZTkxYjRjYTU3NmRlMGYzYjdkYTg5NGEzZGQzNzAzMTI0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGZlYzJiZjI0ZGI3YzA0OWQ2ZGZlODFjNDhhYTM1YmY5ZTI2Y2MwODM2MzkzNTc4ZWNhZmJlODk5NDcxN2Y4YlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzU2NjM4ODIwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDY5NjA0MTBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NTEpLTY0OC03NjU3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxOTMpLTkwOS00ODU1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzEwLTM2LTk2OTNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjk2ZDM3MjE5NjVkZmVmMDFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYW5kaWNlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtb3JyaXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg3NzkgdGF5bG9yIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb25nIGJlYWNoXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV2YWRhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUyODA2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYW5kaWNlLm1vcnJpczIzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJzbmFrZTk0OVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwieWFua2VlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkt0cEtJQXpYXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2U1ZGQ4ZDE3MmQyZWE5Zjk1YjE5ZDAwNGVjOTg5MjFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDJjMzBjNjU3YzU2NzRhMjczZjM5ZWM2NDAzZDIwMzNmNzg1ZDg2ZFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjk1OGRiYmExZDNhODgyOTA2Njg1ODQ4ZjkyZWQzMTkxMWM4OTc5YWM5MzdjNzQ1YjJlMTQxYjczODQxNzU3ODJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE0Mzc0OTA0OFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ4MjIxOTY4M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDYxMCktNDk3LTg5MjVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg2MyktNzUxLTkyMDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MzgtMTgtMjExN1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzE0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzE0LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODNlMjhkZTAzMThjOTc5ZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqYWNrXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGV2ZW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5NDAzIHN1bnNldCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2FjcmFtZW50b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjIwODg3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqYWNrLnN0ZXZlbnM4M0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyYnV0dGVyZmx5NTAwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYWxsaW5nXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm0yNnd3SnluXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNThmMzQyMWE0YTg5MGE3MWE1OWY3MzdkNDQwNDk1NmVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYWRjZjg3MmMwMTcxMWQ2MGJkNGVlYjFiNTljM2ExYzZiOTE4NWVmYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjU2NWMzZmM4ZWE5MDRlZDk0M2I1ODcwNjEzZTVmYWNhNDk5YThkMzE1YmU5NTM5MzM2MTM0NjY3ZDEwODkyNzBcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM1MjUwMjgwM1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE4OTAxMjM1MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU1NCktNjI5LTM0ODlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM4NSktNjUxLTI4NzZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxMTktMTEtNjMwOFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzE2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzE2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzVjMjE3MjFjMDNiOWQ5N1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJiYXJyeVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2lsbGlhbXNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzMzMyBrYXJlbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2FuIGpvc2VcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3aXNjb25zaW5cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjA0NzFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImJhcnJ5LndpbGxpYW1zb240MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxmaXNoMzU4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxMDY2XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImpDc0NXMG80XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMTEzN2M5ZTBhMTNmZmE2MmJmNjM2NjdhMWY1NWMzNmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOTBlYTAxODgyNjgxNDUzMmZjOTY1MjAzZThlZDNlYjc4MDI5YWMzZFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImZhMGM5OGUwMWI3MGY1YjZmNTA0Y2Q3NGY3YjU1NDQ1YjhlOGEzZjA4NzU3ZDExYmI2YjM2MTY4NTlmZmFkMjlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM4MzAyNzY0OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5MjI1MDc2MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDY5MSktNDIxLTUwMThcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYzNyktNDIxLTc1ODZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMTQtNjAtNjQ4OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjg0ZWVmY2MwNjM0ODlkYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNocmlzdGluYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RldmVuc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzAzMiBncmVlbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVsZW5hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2tsYWhvbWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDkzNDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNocmlzdGluYS5zdGV2ZW5zMjJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZWZpc2g4MjhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInBvbGljZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJFb1FqdTBSQVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQzMTk1ZjQxNDYzOWVkZDJmMmExY2Q0ZWJlNDY5NjMzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjYwNDdhN2RmNTAxZmE2YTE5MWZiY2MzOTI5NmU2YjdlNzJiMjU3NGVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0MmRiNzc5YjBmZWE0Y2I5NGIwMmZlMTI4N2UwNTZhYmJjZDdjMzhiMTA2MWQwOTliNWExNzFiNTQ5YmYyZThiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTg4OTY0OTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjk5NTA2MDNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NTYpLTk2Mi0yMTYxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3NDcpLTQ2Ni05NjgwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTk0LTMwLTQyNDBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zNS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjE5ZjI1YTllZGM0NTJlZDFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImhhemVsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwb3dlbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE2NDAgcG9ja3J1cyBwYWdlIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb25nIGJlYWNoXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidmVybW9udFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5NTQzOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiaGF6ZWwucG93ZWxsMTlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlzbmFrZTcyMlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwid2lsbG93XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInhFakxTd2xoXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOWEyZTc5NzAyODZjYzUxOWJhYmY1N2IwM2I1NWM5OGJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMWNkZWUyYWNlYzVhMTk0NjFlMTM2Y2VmZmNmMjdhMDZiMmYwNGQyYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjBmY2EzMDU3YTA0MjE1ZmNjOWNjMTVjOTIxZWZiMzY2ZWU2MjM2ZTI3YzJlOTdkZmI5ODk1YmFiOTk0YzQ1ZmJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM5NTkyOTU4MlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE4Mzc1ODgzNVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE5MiktMzU5LTc0ODNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ5OSktOTEyLTg1ODRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxOTMtMjQtMjg3MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNTZlZjQxNmVmMDhlMmYwNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJsZXZpXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJodW50XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5MTY0IGhvZ2FuIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzZWFnb3ZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibm9ydGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI5MzM4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsZXZpLmh1bnQ0MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxidXR0ZXJmbHkxNTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJpZ2Zvb3RcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieXIweWZ1MGVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0MDQzYWJlMzVkNTBiY2U5N2RjMjQxZmFlYWU1OTFlMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0NTJjNzY2YzM0Y2Q4NjBkMGMxYzk0ZWQ5ZjMwMjEwZGIzMzIyNzM4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiM2RkZWNjYmQ1ZjZkNmZiZDQxOGM4M2QzNzBkMTFlZGYyOTU0MGJhYjBiYWMyYTVmZjQ5ZGNkODFjMzVkMDc2M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzg0MTI1ODMxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNjI0OTI5MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEzNyktODAwLTE5MThcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDExNyktODQxLTE5NTZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNTktODAtMTg5MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTg1YTQ0OTA5MjRjYjM4YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ3eWF0dFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGF2aXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY2MTkgZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicHJpbmNldG9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IGhhbXBzaGlyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3NTMzN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwid3lhdHQuZGF2aXMyMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmxhY2tsZW9wYXJkNDU3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ0aHVtYm5pbHNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiRmw4MTZTdHlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhNDU2NWY4ZWVhMzMyMWE2ZGI1MDVmZTJmNTgwMzA4ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIzMjk3NDFjYTIyN2FlMDA5NzNiNmRkMTgyODdkNDI0YWM0MGI5YWI0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzRhNjY1ZWQ2NTYzZjNjYjZiMGNmNTc2ZmU4NTNmMjgzZTI0MDZmYmQzODU3MTlhYTViMjViZjY3OTc3YTRiMlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MTczODc2NjJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTI0MzQ4NzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MDUpLTM5Mi00MDEwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5OTcpLTYyMC02OTk2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTQ0LTg5LTgyODVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImY5Zjk2ZWIxMDEzOGU1M2VcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwic2V0aFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ2FyZG5lclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTQzNyBsYWtlc2hvcmUgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm5hc2h2aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBoYW1wc2hpcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzI4MDlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInNldGguZ2FyZG5lcjk4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWtvYWxhNTU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCI0NDQ0NDRcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiM0R5dkJvb09cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxYzFhNTYyOWFlNDhjZGFhMmNmMTI3ZTU4ZTU0MTllNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJkMWM5ZDliMjcyYzI0ZGE1OGNkZGU5M2UyMDIyZTkwOGE0Y2ZkZTNhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjg0Mzc4MTExM2JjZmRiZTA0Y2ZjMTZlYmQ1YmRiMjU3ZmI5ODA1ZGY3NDAwYTI2NTQ1NjAxNWU4NmQzYTMzZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzk3ODY4MjQ3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI4Mjk3MzZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5OTYpLTE3Mi02MzQzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1NDcpLTQ4My0yMzA2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTQzLTMyLTg0NzhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzczLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImNlOTg5M2I5ZjcxYTgzOTdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWFydmluXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtb3JnYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjkxMTMgbWFyc2ggbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInBpdHRzYnVyZ2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgeW9ya1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNjI2MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWFydmluLm1vcmdhbjQ2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJzbmFrZTU5MlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic2lzdGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkNEMTBTZU5kXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZWZkMTQ2ZmIzNjg4YTAyYmFkNmM4YjBlNjEzOGIyYTRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOGI0MGNmNTU4NzMzOTRjYTQwMDI1OWEzYTBhNDY0YjcxYjU4NDhhNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ5NzU0ZDZkNzg3MWQ5YTVhZmRiMzFmZjI3ZTYwMTI2ZjdiNGQzNjg0YjBiNGVjMjM1M2RjMmI1YzZiYzIzZGVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM0Mjk5Nzg4NVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2MTM2NDg5OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk4OSktMTMyLTc3NDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ5MyktNzUyLTEyNzZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMDQtOTQtODQ2MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNTc1OTM0NTkwYmQ3YjgyNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJsb3Vpc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaG9mZm1hblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTEyMiBmaW5jaGVyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZWxlbmFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaXNzaXNzaXBwaVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMTg4MVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibG91aXMuaG9mZm1hbjQ5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJnb29zZTUxOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicmF2ZW4xXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjdTSnBqZ0M2XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZTZlOWMxMjI5YmVhN2RjNjdjYzExZGVhNzE1NzNhODdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYmIyYTE1NDU3MzljMWJhNjQzMzRlMjhkNmIwYmE1M2U4MjVlMmIzYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImM4MzMxOThjOTlhY2JmNDI2M2MyNGM0ZjQ4M2U1ZjM4MzY5MTcyYjBkNjI2ZjRhZjVkZTg5MzFiNzNmOGM3MGRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTQ4OTIzMjI3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzE4NDY0NDQ3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzE0KS01ODgtNjQ5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTg1KS03NzUtOTg2M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcxMC01Ny0xNzE4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzYWMwMjg5NjFiMGE2ZmIzXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInZlcm5vblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibXllcnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg5NjIgdGhvcm5yaWRnZSBjaXJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFybGluZ3RvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ4NTU2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ2ZXJub24ubXllcnM4OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JnYW5pY3JhYmJpdDUzM1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic2VydmVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjlRVXB3cVNVXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOWUwYzhlMzE2ZWVlYTBiODY2ZWRiMzI3YWYyYjUwNDlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTQ5MDVhYzQ0YzJhODJlOWI1ZWU0NmMxMGRjMDNmZDc4ZDhiNTExZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjFmNWY0YmMzNDFlMzk4ZTI0MTZhN2ZlY2JhNDE5MzEzODAwODgwNjdmYTc1Zjk0YTVlMGFkMDY1YTUwNjNhMjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAxMTEwNDkwOFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjEyMDA2OTY0NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg3NyktNjA3LTczOTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ2MyktNTI3LTcxNzRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyODgtMzktNzEyMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzM5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzM5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjAxMzI0MzU2NjExYzc2ZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtaWNoYWVsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGFubGV5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNTkxIG5vcnRoYXZlbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic3Bva2FuZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInNvdXRoIGNhcm9saW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY1NTM2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtaWNoYWVsLnN0YW5sZXk4MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ29sZGVuZ29yaWxsYTk0MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwia2FyZW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiWXh6cXBGU0lcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkM2FhYzEzMzE0NjdkMDlhOTg0NjEyMGNiNzU4YWEyN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxMzljNDc4MTVhYjdhNTg1MjIwNjRkZTkwMWY2OTk0OTNjMDdlNjVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjYyMTE2NmNhOWM2YWY2MjNlNzRkNTE3NDI0NTE5ZDU1NGI0YTE3NzAxMDYxOGM4NTk1OWE4Y2NhZTFiYThjY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDczOTAzNDM3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzA1MTc1NzFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3NDkpLTY0NS0xNzgxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMDcpLTc5NS0zNzA3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDYxLTQwLTI0OTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81NC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzU0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81NC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjZjMTE2NDZjMGE2MzI0YWNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2xpZnRvblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWF5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0ODg2IG5vd2xpbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicGl0dHNidXJnaFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pc3Npc3NpcHBpXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjExMjU3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjbGlmdG9uLm1heTI3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5bGFkeWJ1Zzg5N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZmxhc2hlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJDNGh2amdwb1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImM0MTgxNWM5Y2UzMDlkYjA3MTQ4MzViNmUzMjllOWEyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImM0NjAyMGQ1NTc1NDk2Y2IzZjFmMzM2NTczM2YzOTg0OTY2YWU1Y2ZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlOGMyZjU3ZDgxZTI4MTAzODJhN2ZkZGQ4Y2FmNjAxYmI4ZDE5N2MyNjBjNTY3MDZjNjI2ZjNkZTcxYjNhN2E5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNjQ4NTQ0NjdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxMzczMjU4OTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2MTUpLTg4Mi0zOTI0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MTApLTg5Ny0yNzk3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzg3LTg5LTI3MTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi80MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJiMmY1MjNjYmE5ZTExOTVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImpvYW5uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJvbGl2ZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjExNDggZGFuZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbnRzIHBhc3NcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaW5uZXNvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTQ3MjJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImpvYW5uLm9saXZlcjg1QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlbW91c2UzMTZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJhY2tib25lXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIktzQzZOUk5VXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDFjOGIyNDgzZTFlNTU0MGZmMmQxY2I0NmQ4NDMzYmNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjRhMDlmNmZkNmJhYjc1OWJmZTI1MDMxNjg5NmNmZDNlNDg2YWQzY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjNmOTU0MDIzMGJlYjNlODA4ZjQ3MTRlNGYxNjYyMDczMDk0MjQwOWE3NzhjOTg0YWIwMmY5YWYwZWQzYmNjN2NcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTEwNjM0ODIxNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxOTcxOTA0MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDM0MiktMTY4LTY3NzZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIyNiktMTUxLTEyMTJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MzgtMzItNDgxM1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMDYwOTUyNzg4MDM0YWUxZFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJzZWFuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJidXJ0b25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY4OTQgc3ByaW5nIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImRlbGF3YXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgwMjg1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJzZWFuLmJ1cnRvbjUyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJoZWF2eWxhZHlidWcyMjVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNvbG9yXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjJnZUdtMEw0XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNTQ0YmJkM2VmN2EyMWVhM2QwYmY3ZTIyYzY0NTY2ODNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZDM1OWZjZTNhNDM5NzcwZDhmOTRlN2E4MzBlODVmNjk1YmU1NjE3MVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIwOTNmMjBlNjE5ODVhOGI1ZjA2YTM2OTU1ZjA1OWE4OTk1MTA3OTE3MzE4MDRmNDYxYmI0MTQxMmY1ODQwYWVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA5MDk4Nzc5OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjYzNDQyNjMyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzg3KS0yNTAtNDMwNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTgzKS04MTYtMTc5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU5MS03Ny0zMjQ3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkMzNhZjEzNWUzNDFkMDBhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2Fyb2xlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJiYXJyZXR0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3MzQxIGUgc2FuZHkgbGFrZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic3RvY2t0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3aXNjb25zaW5cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTg3MDRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhcm9sZS5iYXJyZXR0MjJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZ29yaWxsYTkxOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwia2l0dHljYXRcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwicGs2dU5vN1hcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1ZGEwOWZlNDljYjY1MWExZmI0NDU4MjBmY2RjOTUxMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxMTI3ZmExYTdjODhjNDdhZDIzNWU4MjQ1NjcxZWJiOTNkMzdmNzNhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmI4YTM1NjlkZmY1ZjRmZGYyNGIyNTE4NzQ2OWEyN2UyMTcwNWFmYzFlM2E1MGI5OWMyOGZjZjM4Nzk0YWI5ZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDM1Njg0MTc2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDQ1MzIwOTU1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTc0KS05ODUtNTU3OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODQ0KS02NjItNDcyMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk2OC01Ni0zNjUxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3ZDFkMWQwYWE1ZGFlYzI0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJyYWRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhcnJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjIxOTQgcG9wbGFyIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb2x1bWJ1c1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImZsb3JpZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzM3MDJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImJyYWQuY2FycjM2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGdvcmlsbGE3MzdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImxvYm9cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS3d0S0ZlMUlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxNTRlOTFmOGQ2ZmE3ODk1NjA2ZmY3OTE4YTE4NmM4ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyNDA3OTkxNjJlYzBiNmQ2YTBjMTdmODUwY2NiZTJlNzFlNWQxNzZlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYTcwZWJlMTRkODEyYTRiMGFhMDEzMTY5NmE1NzBjMjAyZTllOTIyZDRhZmVlYzhlYjBmNDZlNjdkZTg0MzViYVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjk5NTIxNzQ0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTkwOTgwMzk0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTYwKS05NjctODYzOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzM3KS02MzEtMjIyNFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0My01MC00MDUxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyY2ZmMGUxOWY1ZDkzZjJlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImpvaG5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdyYW50XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NTk5IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkZXNvdG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzOTU5M1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiam9obi5ncmFudDcxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5YmVhcjk4MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2F2YWxpZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZVgxTGNwbE5cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2ZWY4M2MyMWU3OWQ1MmY5NGI2NDFhODkzYzJkMDhmZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlOGQ3OTQwMGQ0ZjJiNGJkNjY1Y2EyOGRjZGMyMmZmNjFiOGJmN2MxXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZWJlYWQ0Y2U5MDQxNTc2ZDgwMTFhYjhkN2NjMzYyNzI0M2U3OTc3ZDU2Mjc3NTkwN2NkZDVkMTU4N2IxNThiNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDc5MDQ4MTMxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU0NTA1NTg1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzA4KS02NjQtNTE3M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODQwKS02ODQtNzE0NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjEwMS02MC04NTc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMjcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMjcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2NzdkY2QxZTZmNmFlZWY5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImtheVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ2VvcmdlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTM5IHByb3NwZWN0IHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjdXBlcnRpbm9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvcmVnb25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTE2NDVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImtheS5nZW9yZ2U3NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW5zbmFrZTk0N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY3J1aXNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkdhc1VGaEVNXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMjZmMDdlMGI3NTg0YzY1YzI1MzJkNGY5YTBjYTE4ZjlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNjg2MzBlNmQwNWYyNWU2N2YzNTMxN2UyOWU5Zjk4ZjEwNTk5YWMzN1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjAzYThlYmQwZWQxYWMxYjYyNzAxYTU4MDVhMmZjMmFlNTdjN2ViMTIyYjA3NjhhYmYyMzJmZjIwY2U4ZWM4YmRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTEyMDE1MDMxNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE4MzUxNjIwOFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ1MiktOTAzLTk2MzdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEyMSktOTQxLTI3MThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NjYtOTQtNjQ3NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNTcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzU3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzU3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYWI2NDc3ODgyMjQ1MTIwNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJvd2VuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjYXJsc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNjM5IGxvY3VzdCByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibG9zIGx1bmFzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWljaGlnYW5cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDM3MjhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm93ZW4uY2FybHNvbjQ2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVnb3JpbGxhNTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNsYXlcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMDFlRlp3NlVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhNDVkZTRhNjRkOTJlM2Q3MTJhNjE1NTE4NDliNjE1Y1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyOGQ4MjUyMzczM2NjYjY5MjRmYjIzZDY5ZjMwNDYwMmQ4Y2YzYWFhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYzk3NmU4MWNhNThmMTRkZDcwYTA1Mzg4OWY1ZTYwODE1N2EyNTI3M2NkOTViNWFhNWUzN2FjOTAxN2E2ODA3ZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTcxODQ3Mzc1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDI0NjAzMzg4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzg5KS02MDMtODMwMFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzM4KS01MjctNzAwNVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg1OS0yOS04NTc2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhNDAxMjU4MjllNDZlMWQ4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb3NhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJlZHdhcmRzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MzI1IGhpY2tvcnkgY3JlZWsgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNlYWdvdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvaGlvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ4NTQ4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb3NhLmVkd2FyZHM3N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwidGlja2xpc2hsYWR5YnVnOTI2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJob3RnaXJsc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJlS3BjZlVCc1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImMzZGYwYmMyNzkzMzhhY2VlMWY1ZGJiZjE3NjMyYzk5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIyZTdhN2YwOTJiZmQ3YWU2YzA2MTE3YzMzN2E1NzliN2FkNTdlNGZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIxMWYyMTZlNzUyYTAxNTAyOTA0ZDdiYzBjNGJjODBmMzMwZDVlZmI1NWIwMmJiNTgyNjRmYmFmMjA2MGU1N2EzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyOTg5OTI5MDFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNDM4OTExNzhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMzkpLTMwMC03Mjg5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMTgpLTg3MC0yMDI4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzM1LTcwLTMxOTBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjhmNWM5NWFlYzA3Y2NlZTlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYmlsbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYnJhZGxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjI2OCBjYW1kZW4gYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsYXMgdmVnYXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5Mzg5OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYmlsbC5icmFkbGV5MTNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlsaW9uNTIwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjaXJydXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiRXkyZlRYd0VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkZDYzYjcwODY5OTAwMmJmYjJiOTM4NzBmMzIxMWZmY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1MzY0ZjM0ODRmZGI5ZjlhM2Q5NGRmNTdmOWE2YThmNTMwMGZlMzFkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjc4YWE0ZWMxNTY3MTJjYjZiMmZmMzI5NmZiNzFiZDg1NGM5OTZiZmU0YjQ4MDFlN2M0ZTk1ZGU0YmI2MGU5ZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc5NjE5MDIyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTc2NjAyMjcyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTQ2KS0zMDEtMjI5OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTU3KS00OTQtMTExN1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMwOC00My01MzcyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81Mi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NmFjZjQ0ODNiM2Q3OTIxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidHJhY2V5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtaWxsZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjMzOTUgbWNnb3dlbiBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwidGFjb21hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidXRhaFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MjYzMlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidHJhY2V5Lm1pbGxlcjEyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJyZWRiaXJkMjQ4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmYXRpbWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVHBUUDRoMGpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5MDE5ZjM3MGIyM2JhNzY0Y2IyYzcyODc3OThiMmUzMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0NmI0YjM1NWNmYjE0ZmM2ZGM2ZDc5ODhhMThlNzI0ZWZlNDE0MDQ2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNWM3Zjc4ZGJjYTI5MWVkNDdiNWY5Y2E1NTZiZDA2NjM4OGRkNjRlMjNiN2NiNDUxM2U1ZGViMzIxOGRiZTRkMFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5ODgyMjAzNzRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyOTQ2MjQ0MjZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0ODIpLTk5MC0xNTUyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyNjQpLTk5NS04MTk0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjE0LTg4LTk1MzVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJjYTdhNmQxYjMyMjdiZTNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYmVsbGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImtlbm5lZHlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg0MDggcHJvc3BlY3QgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidmVybW9udFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3OTA1MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYmVsbGEua2VubmVkeTkyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbmtvYWxhNTU1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzbWFsbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJyQjlzbmt5WFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjA3NWY5NWM2MGVjMDU3YmFlMDEyZDI4M2NmOTVjMWY3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA1NmZkZDE1ZTlmMzA1YThhYzY2M2IzMTQxNDc2N2ViNzFlMmY1YzVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhMTllNGFjYWI3MThmZGI3Yjg5NDljMThlNTU4NDk1NDJkNzI2ZmU5OTAwYzI4NTdjODhjZjlhNTAyYWIyODdiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNjY2ODQ0MDRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzA1MDU0NDlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MzEpLTIyNC02Nzk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1OTQpLTcwNy0xNTA5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzAzLTQwLTE4MDVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjY4M2Y3NzcxMTQ1ZTc2MmNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImphbmV0XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyaWNlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1ODI2IG9hayByaWRnZSBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZm91bnRhaW4gdmFsbGV5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFpbmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjQ2NDlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphbmV0LnJpY2U2NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVycGFuZGE0NVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZnV6enlcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieTFhdjRaWkxcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0YzE5MDE3N2I1Njg4MTg5NmE5MzI2Y2RjNDU5MWY0NVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5YjYxMzk5NzQ5YmRlZTM1MjNkNDRjOTEwMDZlOWFhMDBjYWUyMmVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYzM2NGI1ZjM5YzU1OWU0N2EwN2Y0MGEyMTlhMDc1Y2U4ZmY5MGM3NzY1MjkxM2ExMjEyNTgzMmNhMGE5OTE2OFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzY5NDM5MzY1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDc3NDE3MTczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODUzKS04NDAtMjM3OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTkxKS0yNjQtNzM3N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQwNi0xOS01MzI2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyMWQ4OGEzOWM1OGQzZDlkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiaGlsZGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhbXBiZWxsXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNTgwIHBsdW0gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFrcm9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZmxvcmlkYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyNTg0MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiaGlsZGEuY2FtcGJlbGw4N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVwYW5kYTI0M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZmVzdGl2YWxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVU9maEYwbDBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhNmNlZjNmZDM3OTY1NmYyZDExMmM4ODdhZmI0YjE0ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlMDExZjU2ZDZlYjNiNjZmNTk3OTc0NzQ0NWQ5YzAxYjg5Njk2MWEwXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMmZmNDc2MDViN2RjZGY0ZGQyYjI0NWVmNmE1ZDc0MDQ4MWQ5ZmM0MzFkYzUwOGVlODczM2VlZjFjNjgwY2YzNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MzgyMTczNjZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDYxNDg2MzZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MzkpLTExOC01MzY1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1ODQpLTg4OS00NzU5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODY0LTE5LTMyNjRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjFiMjQ0MDk2NjRkYTUzMzBcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9ubmllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtY2RvbmFsaWRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU3MDUgd2FsbnV0IGhpbGwgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImR1bmNhbnZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiYXJpem9uYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzMTk5MVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9ubmllLm1jZG9uYWxpZDYxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eXBhbmRhMzYyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzaGVsbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJwUm5IcVhFeFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQ1NmMxNWU0YmM5MzNiNTYyZjRmNWM4NTRkYzBkM2Q5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImYxNjEwYjM1YWQwMzk4NWRiN2RhOWEwMDM3YmNjOGQ2M2Q2OWVlZjVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0NDIxNzQyZmZhNDY5MzQ5MzNmY2M3MzViN2Y0OGQ4MWY5YmViMTE1OTlhMDUzOWJkZDgzODM4MzdiMDM3MDlhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkzOTMzNTMzOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2NTg3ODYyNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQzOSktMjUwLTQzNDJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ4OCktMTIzLTIyNjBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MTgtODctNjc5N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzcwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzcwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNGJkMjVkZmM1N2FlZjM4NVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb2xhbmRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhhbGVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjMxMDMgd29vZGxhbmQgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm1lc3F1aXRlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODk3MjdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvbGFuZC5oYWxlNTdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWV3b2xmNjg2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjb3VnYXJzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkpIWmhLeEZlXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDk1ZDY2YzEyZGYzZGZjZWQwZWViZmE3YjFkMzg1YjJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTg3NjNhMzdhZmY5NDQyOWVmOTI4NDNhZDExYzM0MzRhYTU3OWE1MlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImI0YzEwZGQ2ZGEwZWE3NTBmOWNjZDI1NWFkMGVmNjQ1YmY1NGFmMGMyNGJkZDBkZTVmOWVmYWUxYjczMTJiMTNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTM4MzY1MzE2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTgxMjEzMzI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTYyKS04NTMtODY3N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjM1KS04NzItNjIyMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ2NC02OS01NTA5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8zOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMzguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyZDRkZGM5YzAzNzQyMjlhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwianVuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2FzaGluZ3RvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjkxMSB0aW1iZXIgd29sZiB0cmFpbFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibG9zIGFuZ2VsZXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaW5uZXNvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjY3OTVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImp1bmUud2FzaGluZ3RvbjIzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWdlbGVwaGFudDEyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjb25kb21cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibVM1dmxxRXRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkNGMzMDU3NDU0MzEyMjIwY2U3NzZjMjMwM2VhOWQzZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwNjcxM2MzYjY4M2IzYTI5YWE2Njg2ZjliY2M3MTViYTdmZGE1NjEyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZWM3MGUwZmIzZjE5MTkyZTI1MmNiYjY4MTBhMDQ4ODViYTZkZjM5OTFjN2FkOGNhMjYzNzUwNTUxM2Q3MzVhZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjExMDk3MzU0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDQwMzQ2NTg3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTY2KS04NDAtNTI5MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjQ4KS02MjEtOTQxOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIzMi0xMC00NDI1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjMWRmZTk0NDI0MjM0ODU1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImphbWllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjYWxkd2VsbFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjA3MSBicnVjZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXZhbnN2aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBtZXhpY29cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjM0ODRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphbWllLmNhbGR3ZWxsMjVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVuYnV0dGVyZmx5MzI5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmZXR0aXNoXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJCVUZnYzR5XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWM0N2FlMTBiYTVjMTM0ODU2MTM1MjcwZWEzMjNjOThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjk5ZmZiN2M2NmVkMDVlOTI5MTNkMDcwYWY1NmI4NzhhZDhiNGU0OVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNiOGNkZTEyYjZjYTNhMTA2YjBmODQwZDc5ZTJkYTI5NDA1YTYyMjZhMjg1MDc3NzZiZTM2NTZlZjdkMzdhNTNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3NTk4NzY2NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM3NDM4MTk5N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDUwMSktNjY2LTE1ODVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkyNSktNjAzLTIyNzJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4MDktMTItNjk0MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ0LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzEwY2UwMjY2NDJkZDZjZlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImdsZW5kYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZmVyZ3Vzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY4MDUgY291bnRyeSBjbHViIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJib3plbWFuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IGhhbXBzaGlyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MDE0MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZ2xlbmRhLmZlcmd1c29uNjhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWxhZHlidWc0NTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImpheWhhd2tcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUmRVRFFaS0xcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhN2QxN2Q1MTc1NGI0ZTBmY2UxOGJiZjRkZmI2ZjJmMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhOTRkN2Y2YzRkNGYyMTZjOGZmZTU1ZjFkOGI4ZTNiM2ExMzc0MTYwXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNWFhYzIwM2Y1ZTMwMGQyMGI2OWNhYWZmMWU3OTk4YTE0MDk1ZDY1YThkMzU0ZjEwYzhlMjE3ZGUwNDhjNTc5MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDIwNjYwOTgwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI2MzM0ODBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NTEpLTYyOS0yODM0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMjkpLTU0MS04MzQ4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTc5LTQzLTk2ODhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImU1N2RlZWIwNTA0MDM0M2FcIlxuICAgIH1cbl07XG5cbm1vZHVsZS5leHBvcnRzID0gdXNlcnMubWFwKGZ1bmN0aW9uKHVzZXIpe1xuICAgIHJldHVybiB1c2VyLnVzZXI7XG59KTtcbiIsIi8vIElzIHRoZSBlbnRpdHkgZmlybWVyIHRoYW4gdGhlIG5ldyBmaXJtbmVzc1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbnRpdHksIGZpcm0pe1xuICAgIGlmKGZpcm0gIT0gbnVsbCAmJiAoZW50aXR5Ll9maXJtID09PSB1bmRlZmluZWQgfHwgZmlybSA8IGVudGl0eS5fZmlybSkpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIGNvbnRhaW5lckNvbXBvbmVudCA9IHJlcXVpcmUoJy4vY29udGFpbmVyQ29tcG9uZW50JyksXG4gICAgc2V0aWZ5ID0gcmVxdWlyZSgnc2V0aWZ5Jyk7XG5cbnZhciBmYW5jeVByb3BzID0ge1xuICAgIGNsYXNzOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY2xhc3NOYW1lLnNsaWNlKGdlbmVyaWMuX2luaXRpYWxDbGFzc2VzLmxlbmd0aCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheSh2YWx1ZSkpe1xuICAgICAgICAgICAgdmFsdWUgPSB2YWx1ZS5qb2luKCcgJyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC5jbGFzc05hbWUgPSBnZW5lcmljLl9pbml0aWFsQ2xhc3NlcyArICcgJyArIHZhbHVlO1xuICAgIH0sXG4gICAgZGlzYWJsZWQ6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUpe1xuICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHRleHRDb250ZW50OiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dENvbnRlbnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICB2YXIgaW5wdXRUeXBlID0gZWxlbWVudC50eXBlO1xuXG4gICAgICAgIGlmKGVsZW1lbnQubm9kZU5hbWUgPT09ICdJTlBVVCcgJiYgaW5wdXRUeXBlID09ICdkYXRlJyl7XG4gICAgICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IERhdGUoZWxlbWVudC52YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICAgICAgICAgIGlmKGlzTmFOKHZhbHVlKSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC52YWx1ZSA9IG51bGw7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gKHZhbHVlLnRvSlNPTigpICsgJycpLnNwbGl0KCdUJykuc2hpZnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBzZXRpZnkoZWxlbWVudCwgdmFsdWUpO1xuICAgIH0sXG4gICAgc3R5bGU6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5zdHlsZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZXN1bHQgPSAnJztcblxuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoZmFzdG4sIGdlbmVyaWMsIGtleSwgc2V0dGluZ3Mpe1xuICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XSxcbiAgICAgICAgYmluZGluZyA9IGZhc3RuLmlzQmluZGluZyhzZXR0aW5nKSAmJiBzZXR0aW5nLFxuICAgICAgICBwcm9wZXJ0eSA9IGZhc3RuLmlzUHJvcGVydHkoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgdmFsdWUgPSAhYmluZGluZyAmJiAhcHJvcGVydHkgJiYgKGtleSBpbiBzZXR0aW5ncykgPyBzZXR0aW5nIDogdW5kZWZpbmVkO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4ucHJvcGVydHkoKTtcbiAgICAgICAgcHJvcGVydHkodmFsdWUpO1xuICAgICAgICBwcm9wZXJ0eS5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICAgICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmdldENvbnRhaW5lckVsZW1lbnQoKTtcblxuICAgICAgICAgICAgaWYoIWVsZW1lbnQpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGlzUHJvcGVydHkgPSBrZXkgaW4gZWxlbWVudCxcbiAgICAgICAgICAgICAgICBmYW5jeVByb3AgPSBmYW5jeVByb3BzW2tleV0sXG4gICAgICAgICAgICAgICAgcHJldmlvdXMgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoZ2VuZXJpYywgZWxlbWVudCkgOiBpc1Byb3BlcnR5ID8gZWxlbWVudFtrZXldIDogZWxlbWVudC5nZXRBdHRyaWJ1dGUoa2V5KTtcblxuICAgICAgICAgICAgaWYoIWZhbmN5UHJvcCAmJiAhaXNQcm9wZXJ0eSAmJiB2YWx1ZSA9PSBudWxsKXtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9ICcnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih2YWx1ZSAhPT0gcHJldmlvdXMpe1xuICAgICAgICAgICAgICAgIGlmKGZhbmN5UHJvcCl7XG4gICAgICAgICAgICAgICAgICAgIGZhbmN5UHJvcChnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZihpc1Byb3BlcnR5KXtcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYoYmluZGluZyl7XG4gICAgICAgIHByb3BlcnR5LmJpbmRpbmcoYmluZGluZyk7XG4gICAgfVxuXG4gICAgcHJvcGVydHkuYWRkVG8oZ2VuZXJpYywga2V5KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgY3JlYXRlUHJvcGVydHkoZmFzdG4sIGdlbmVyaWMsIGtleSwgc2V0dGluZ3MpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkVXBkYXRlSGFuZGxlcihnZW5lcmljLCBldmVudE5hbWUsIHNldHRpbmdzKXtcbiAgICB2YXIgZWxlbWVudCA9IGdlbmVyaWMuZ2V0Q29udGFpbmVyRWxlbWVudCgpLFxuICAgICAgICBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICAgICAgZ2VuZXJpYy5lbWl0KGV2ZW50TmFtZSwgZXZlbnQsIGdlbmVyaWMuc2NvcGUoKSk7XG4gICAgICAgIH07XG5cbiAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcblxuICAgIGdlbmVyaWMub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkQXV0b0hhbmRsZXIoZ2VuZXJpYywga2V5LCBzZXR0aW5ncyl7XG4gICAgaWYoIXNldHRpbmdzW2tleV0pe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmdldENvbnRhaW5lckVsZW1lbnQoKSxcbiAgICAgICAgYXV0b0V2ZW50ID0gc2V0dGluZ3Nba2V5XS5zcGxpdCgnOicpLFxuICAgICAgICBldmVudE5hbWUgPSBrZXkuc2xpY2UoMik7XG5cbiAgICBkZWxldGUgc2V0dGluZ3Nba2V5XTtcblxuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICB2YXIgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1thdXRvRXZlbnRbMV1dLFxuICAgICAgICAgICAgdmFsdWUgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoZ2VuZXJpYywgZWxlbWVudCkgOiBlbGVtZW50W2F1dG9FdmVudFsxXV07XG5cbiAgICAgICAgZ2VuZXJpY1thdXRvRXZlbnRbMF1dKHZhbHVlKTtcbiAgICB9O1xuXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG5cbiAgICBnZW5lcmljLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGdlbmVyaWMgPSBjb250YWluZXJDb21wb25lbnQodHlwZSwgZmFzdG4pO1xuXG4gICAgY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3MpO1xuXG4gICAgZ2VuZXJpYy5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQgPSBjcmVsKHR5cGUpO1xuXG4gICAgICAgIGdlbmVyaWMuZW1pdCgncmVuZGVyJyk7XG5cbiAgICAgICAgcmV0dXJuIGdlbmVyaWM7XG4gICAgfTtcblxuICAgIGdlbmVyaWMub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5nZXRDb250YWluZXJFbGVtZW50KCk7XG5cbiAgICAgICAgZ2VuZXJpYy5faW5pdGlhbENsYXNzZXMgPSBlbGVtZW50LmNsYXNzTmFtZTtcblxuICAgICAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgICAgICBpZihrZXkuc2xpY2UoMCwyKSA9PT0gJ29uJyAmJiBrZXkgaW4gZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkQXV0b0hhbmRsZXIoZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmb3IodmFyIGV2ZW50S2V5IGluIGdlbmVyaWMuX2V2ZW50cyl7XG4gICAgICAgICAgICBpZignb24nICsgZXZlbnRLZXkudG9Mb3dlckNhc2UoKSBpbiBlbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGV2ZW50S2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGdlbmVyaWM7XG59OyIsInZhciBtZXJnZSA9IHJlcXVpcmUoJ2ZsYXQtbWVyZ2UnKSxcbiAgICBjcmVhdGVDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbXBvbmVudCcpLFxuICAgIGNyZWF0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9wcm9wZXJ0eScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMjtcblxuICAgICAgICBpZihpcy5jb21wb25lbnQoYXJnc1sxXSkgfHwgQXJyYXkuaXNBcnJheShhcmdzWzFdKSB8fCB0eXBlb2YgYXJnc1sxXSAhPT0gJ29iamVjdCcgfHwgIWFyZ3NbMV0pe1xuICAgICAgICAgICAgY2hpbGRyZW5JbmRleC0tO1xuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGFyZ3Muc2xpY2UoY2hpbGRyZW5JbmRleCksIGNvbXBvbmVudHMpO1xuICAgIH1cblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG5cbiAgICBmYXN0bi5wcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5O1xuXG4gICAgZmFzdG4uYmluZGluZyA9IGNyZWF0ZUJpbmRpbmc7XG5cbiAgICBmYXN0bi50b0NvbXBvbmVudCA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIGlmKGNvbXBvbmVudCA9PSBudWxsKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZihpcy5jb21wb25lbnQoY29tcG9uZW50KSl7XG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgICAgICB9XG4gICAgICAgIGlmKHR5cGVvZiBjb21wb25lbnQgIT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bigndGV4dCcsIHt0ZXh0OiBjb21wb25lbnR9KTtcbiAgICAgICAgfVxuICAgICAgICBpZihjcmVsLmlzRWxlbWVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBmYXN0bihjb21wb25lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNOb2RlKGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCd0ZXh0Jywge3RleHQ6IGNvbXBvbmVudC50ZXh0Q29udGVudH0pO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZhc3RuLmlzQ29tcG9uZW50ID0gaXMuY29tcG9uZW50O1xuICAgIGZhc3RuLmlzQmluZGluZyA9IGlzLmJpbmRpbmc7XG4gICAgZmFzdG4uaXNEZWZhdWx0QmluZGluZyA9IGlzLmRlZmF1bHRCaW5kaW5nO1xuICAgIGZhc3RuLmlzQmluZGluZ09iamVjdCA9IGlzLmJpbmRpbmdPYmplY3Q7XG4gICAgZmFzdG4uaXNQcm9wZXJ0eSA9IGlzLnByb3BlcnR5O1xuICAgIGZhc3RuLk1vZGVsID0gRW50aTtcblxuICAgIHJldHVybiBmYXN0bjtcbn07IiwiXG5mdW5jdGlvbiBpc0NvbXBvbmVudCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9jb21wb25lbnQnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmdPYmplY3QodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc1Byb3BlcnR5KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fcHJvcGVydHknIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0RlZmF1bHRCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmcgJiYgJ19kZWZhdWx0X2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb21wb25lbnQ6IGlzQ29tcG9uZW50LFxuICAgIGJpbmRpbmdPYmplY3Q6IGlzQmluZGluZ09iamVjdCxcbiAgICBiaW5kaW5nOiBpc0JpbmRpbmcsXG4gICAgZGVmYXVsdEJpbmRpbmc6IGlzRGVmYXVsdEJpbmRpbmcsXG4gICAgcHJvcGVydHk6IGlzUHJvcGVydHlcbn07IiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgTWFwID0gcmVxdWlyZSgnZXM2LW1hcCcpLFxuICAgIGdlbmVyaWNDb21wb25lbnQgPSByZXF1aXJlKCcuL2dlbmVyaWNDb21wb25lbnQnKTtcblxuZnVuY3Rpb24gZWFjaCh2YWx1ZSwgZm4pe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKEFycmF5LmlzQXJyYXkodmFsdWUpKXtcbiAgICAgICAgdmFsdWUuZm9yRWFjaChmbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgICAgIGZuKHZhbHVlW2tleV0sIGtleSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGtleUZvcihvYmplY3QsIHZhbHVlKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgIGlmKG9iamVjdFtrZXldID09PSB2YWx1ZSl7XG4gICAgICAgICAgICByZXR1cm4ga2V5O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiB2YWx1ZXMob2JqZWN0KXtcbiAgICBpZihBcnJheS5pc0FycmF5KG9iamVjdCkpe1xuICAgICAgICByZXR1cm4gb2JqZWN0LnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgcmVzdWx0LnB1c2gob2JqZWN0W2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGxpc3QgPSBnZW5lcmljQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pLFxuICAgICAgICBpdGVtc01hcCA9IG5ldyBNYXAoKTtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZUl0ZW1zKHZhbHVlKXtcbiAgICAgICAgdmFyIHRlbXBsYXRlID0gbGlzdC5fc2V0dGluZ3MudGVtcGxhdGUsXG4gICAgICAgICAgICBlbXB0eVRlbXBsYXRlID0gbGlzdC5fc2V0dGluZ3MuZW1wdHlUZW1wbGF0ZTtcblxuICAgICAgICBpZighdGVtcGxhdGUpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW1zID0gdmFsdWVzKHZhbHVlKTtcbiAgICAgICAgICAgIGN1cnJlbnRJdGVtcyA9IGl0ZW1zLnNsaWNlKCk7XG5cbiAgICAgICAgaXRlbXNNYXAuZm9yRWFjaChmdW5jdGlvbihjb21wb25lbnQsIGl0ZW0pe1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRJbmRleCA9IGN1cnJlbnRJdGVtcy5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXMuc3BsaWNlKGN1cnJlbnRJbmRleCwxKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGxpc3QucmVtb3ZlSXRlbShpdGVtLCBpdGVtc01hcCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBpbmRleCA9IDA7XG5cbiAgICAgICAgZWFjaCh2YWx1ZSwgZnVuY3Rpb24oaXRlbSwga2V5KXtcbiAgICAgICAgICAgIHdoaWxlKGluZGV4IDwgbGlzdC5fY2hpbGRyZW4ubGVuZ3RoICYmIGxpc3QuX2NoaWxkcmVuW2luZGV4XS5fdGVtcGxhdGVkICYmICF+aXRlbXMuaW5kZXhPZihsaXN0Ll9jaGlsZHJlbltpbmRleF0uX2xpc3RJdGVtKSl7XG4gICAgICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGNoaWxkLFxuICAgICAgICAgICAgICAgIG1vZGVsID0gbmV3IGZhc3RuLk1vZGVsKHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbTogaXRlbSxcbiAgICAgICAgICAgICAgICAgICAga2V5OiBrZXlcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYoIWl0ZW1zTWFwLmhhcyhpdGVtKSl7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudCh0ZW1wbGF0ZShtb2RlbCwgbGlzdC5zY29wZSgpKSk7XG4gICAgICAgICAgICAgICAgaWYoIWNoaWxkKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQgPSBmYXN0bigndGVtcGxhdGUnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2hpbGQuX2xpc3RJdGVtID0gaXRlbTtcbiAgICAgICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIGl0ZW1zTWFwLnNldChpdGVtLCBjaGlsZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGl0ZW1zTWFwLmdldChpdGVtKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY2hpbGQpICYmIGxpc3QuX3NldHRpbmdzLmF0dGFjaFRlbXBsYXRlcyAhPT0gZmFsc2Upe1xuICAgICAgICAgICAgICAgIGNoaWxkLmF0dGFjaChtb2RlbCwgMik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkLCBpbmRleCk7XG4gICAgICAgICAgICBpbmRleCsrO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZihpbmRleCA9PT0gMCAmJiBlbXB0eVRlbXBsYXRlKXtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IGZhc3RuLnRvQ29tcG9uZW50KGVtcHR5VGVtcGxhdGUobGlzdC5zY29wZSgpKSk7XG4gICAgICAgICAgICBpZighY2hpbGQpe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gZmFzdG4oJ3RlbXBsYXRlJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgaXRlbXNNYXAuc2V0KHt9LCBjaGlsZCk7XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxpc3QucmVtb3ZlSXRlbSA9IGZ1bmN0aW9uKGl0ZW0sIGl0ZW1zTWFwKXtcbiAgICAgICAgdmFyIGNvbXBvbmVudCA9IGl0ZW1zTWFwLmdldChpdGVtKTtcbiAgICAgICAgbGlzdC5yZW1vdmUoY29tcG9uZW50KTtcbiAgICAgICAgY29tcG9uZW50LmRlc3Ryb3koKTtcbiAgICAgICAgaXRlbXNNYXAuZGVsZXRlKGl0ZW0pO1xuICAgIH07XG5cbiAgICBsaXN0LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHRoaXMuZWxlbWVudCA9IGNyZWwoc2V0dGluZ3MudGFnTmFtZSB8fCAnZGl2Jyk7XG4gICAgICAgIHRoaXMuZW1pdCgncmVuZGVyJyk7XG4gICAgfTtcblxuICAgIGZhc3RuLnByb3BlcnR5KFtdLCBzZXR0aW5ncy5pdGVtQ2hhbmdlcyB8fCAndHlwZSBzdHJ1Y3R1cmUnKVxuICAgICAgICAuYWRkVG8obGlzdCwgJ2l0ZW1zJyk7XG5cbiAgICBpZihzZXR0aW5ncy5pdGVtcyl7XG4gICAgICAgIGxpc3QuaXRlbXMuYmluZGluZyhzZXR0aW5ncy5pdGVtcylcbiAgICAgICAgICAgIC5vbigndXBkYXRlJywgdXBkYXRlSXRlbXMpO1xuICAgIH1cblxuICAgIHJldHVybiBsaXN0O1xufTsiLCIvKipcblxuICAgIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBhZGQgRXZlbnRFbWl0dGVyIG1ldGhvZHMgdG8gZnVuY3Rpb25zLFxuICAgIHdoaWNoIGNhbm5vdCBiZSBhZGRlZCBpbiB0aGUgdXN1YWwsIENvbnN0cnVjdG9yLnByb3RvdHlwZSBmYXNzaW9uLlxuXG4qL1xuXG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG52YXIgZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlID0gZnVuY3Rpb24oKXt9O1xuZm9yKHZhciBrZXkgaW4gRXZlbnRFbWl0dGVyLnByb3RvdHlwZSl7XG4gICAgZnVuY3Rpb25FbWl0dGVyUHJvdG90eXBlW2tleV0gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlW2tleV07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWFrZUZ1bmN0aW9uRW1pdHRlcihvYmplY3Qpe1xuICAgIGlmKE9iamVjdC5zZXRQcm90b3R5cGVPZil7XG4gICAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZihvYmplY3QsIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSk7XG4gICAgfWVsc2UgaWYoX19wcm90b19fIGluIG9iamVjdCl7XG4gICAgICAgIG9iamVjdC5fX3Byb3RvX18gPSBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGU7XG4gICAgfWVsc2V7XG4gICAgICAgIGZvcih2YXIga2V5IGluIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZSl7XG4gICAgICAgICAgICBvYmplY3Rba2V5XSA9IGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldO1xuICAgICAgICB9XG4gICAgfVxufTsiLCIvL0NvcHlyaWdodCAoQykgMjAxMiBLb3J5IE51bm5cclxuXHJcbi8vUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcclxuXHJcbi8vVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXHJcblxyXG4vL1RIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxyXG5cclxuLypcclxuXHJcbiAgICBUaGlzIGNvZGUgaXMgbm90IGZvcm1hdHRlZCBmb3IgcmVhZGFiaWxpdHksIGJ1dCByYXRoZXIgcnVuLXNwZWVkIGFuZCB0byBhc3Npc3QgY29tcGlsZXJzLlxyXG5cclxuICAgIEhvd2V2ZXIsIHRoZSBjb2RlJ3MgaW50ZW50aW9uIHNob3VsZCBiZSB0cmFuc3BhcmVudC5cclxuXHJcbiAgICAqKiogSUUgU1VQUE9SVCAqKipcclxuXHJcbiAgICBJZiB5b3UgcmVxdWlyZSB0aGlzIGxpYnJhcnkgdG8gd29yayBpbiBJRTcsIGFkZCB0aGUgZm9sbG93aW5nIGFmdGVyIGRlY2xhcmluZyBjcmVsLlxyXG5cclxuICAgIHZhciB0ZXN0RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcbiAgICAgICAgdGVzdExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGFiZWwnKTtcclxuXHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnYScpO1xyXG4gICAgdGVzdERpdlsnY2xhc3NOYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnY2xhc3MnXSA9ICdjbGFzc05hbWUnOnVuZGVmaW5lZDtcclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCduYW1lJywnYScpO1xyXG4gICAgdGVzdERpdlsnbmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ25hbWUnXSA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcclxuICAgICAgICBlbGVtZW50LmlkID0gdmFsdWU7XHJcbiAgICB9OnVuZGVmaW5lZDtcclxuXHJcblxyXG4gICAgdGVzdExhYmVsLnNldEF0dHJpYnV0ZSgnZm9yJywgJ2EnKTtcclxuICAgIHRlc3RMYWJlbFsnaHRtbEZvciddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2ZvciddID0gJ2h0bWxGb3InOnVuZGVmaW5lZDtcclxuXHJcblxyXG5cclxuKi9cclxuXHJcbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xyXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcclxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJvb3QuY3JlbCA9IGZhY3RvcnkoKTtcclxuICAgIH1cclxufSh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICB2YXIgZm4gPSAnZnVuY3Rpb24nLFxyXG4gICAgICAgIG9iaiA9ICdvYmplY3QnLFxyXG4gICAgICAgIG5vZGVUeXBlID0gJ25vZGVUeXBlJyxcclxuICAgICAgICB0ZXh0Q29udGVudCA9ICd0ZXh0Q29udGVudCcsXHJcbiAgICAgICAgc2V0QXR0cmlidXRlID0gJ3NldEF0dHJpYnV0ZScsXHJcbiAgICAgICAgYXR0ck1hcFN0cmluZyA9ICdhdHRyTWFwJyxcclxuICAgICAgICBpc05vZGVTdHJpbmcgPSAnaXNOb2RlJyxcclxuICAgICAgICBpc0VsZW1lbnRTdHJpbmcgPSAnaXNFbGVtZW50JyxcclxuICAgICAgICBkID0gdHlwZW9mIGRvY3VtZW50ID09PSBvYmogPyBkb2N1bWVudCA6IHt9LFxyXG4gICAgICAgIGlzVHlwZSA9IGZ1bmN0aW9uKGEsIHR5cGUpe1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc05vZGUgPSB0eXBlb2YgTm9kZSA9PT0gZm4gPyBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBOb2RlO1xyXG4gICAgICAgIH0gOlxyXG4gICAgICAgIC8vIGluIElFIDw9IDggTm9kZSBpcyBhbiBvYmplY3QsIG9idmlvdXNseS4uXHJcbiAgICAgICAgZnVuY3Rpb24ob2JqZWN0KXtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdCwgb2JqKSAmJlxyXG4gICAgICAgICAgICAgICAgKG5vZGVUeXBlIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbFtpc05vZGVTdHJpbmddKG9iamVjdCkgJiYgb2JqZWN0W25vZGVUeXBlXSA9PT0gMTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzQXJyYXkgPSBmdW5jdGlvbihhKXtcclxuICAgICAgICAgICAgcmV0dXJuIGEgaW5zdGFuY2VvZiBBcnJheTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGFwcGVuZENoaWxkID0gZnVuY3Rpb24oZWxlbWVudCwgY2hpbGQpIHtcclxuICAgICAgICAgIGlmKCFjcmVsW2lzTm9kZVN0cmluZ10oY2hpbGQpKXtcclxuICAgICAgICAgICAgICBjaGlsZCA9IGQuY3JlYXRlVGV4dE5vZGUoY2hpbGQpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgZWxlbWVudC5hcHBlbmRDaGlsZChjaGlsZCk7XHJcbiAgICAgICAgfTtcclxuXHJcblxyXG4gICAgZnVuY3Rpb24gY3JlbCgpe1xyXG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLCAvL05vdGU6IGFzc2lnbmVkIHRvIGEgdmFyaWFibGUgdG8gYXNzaXN0IGNvbXBpbGVycy4gU2F2ZXMgYWJvdXQgNDAgYnl0ZXMgaW4gY2xvc3VyZSBjb21waWxlci4gSGFzIG5lZ2xpZ2FibGUgZWZmZWN0IG9uIHBlcmZvcm1hbmNlLlxyXG4gICAgICAgICAgICBlbGVtZW50ID0gYXJnc1swXSxcclxuICAgICAgICAgICAgY2hpbGQsXHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gYXJnc1sxXSxcclxuICAgICAgICAgICAgY2hpbGRJbmRleCA9IDIsXHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0xlbmd0aCA9IGFyZ3MubGVuZ3RoLFxyXG4gICAgICAgICAgICBhdHRyaWJ1dGVNYXAgPSBjcmVsW2F0dHJNYXBTdHJpbmddO1xyXG5cclxuICAgICAgICBlbGVtZW50ID0gY3JlbFtpc0VsZW1lbnRTdHJpbmddKGVsZW1lbnQpID8gZWxlbWVudCA6IGQuY3JlYXRlRWxlbWVudChlbGVtZW50KTtcclxuICAgICAgICAvLyBzaG9ydGN1dFxyXG4gICAgICAgIGlmKGFyZ3VtZW50c0xlbmd0aCA9PT0gMSl7XHJcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYoIWlzVHlwZShzZXR0aW5ncyxvYmopIHx8IGNyZWxbaXNOb2RlU3RyaW5nXShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudFt0ZXh0Q29udGVudF0gIT09IHVuZGVmaW5lZCl7XHJcbiAgICAgICAgICAgIGVsZW1lbnRbdGV4dENvbnRlbnRdID0gYXJnc1tjaGlsZEluZGV4XTtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgZm9yKDsgY2hpbGRJbmRleCA8IGFyZ3VtZW50c0xlbmd0aDsgKytjaGlsZEluZGV4KXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gYXJnc1tjaGlsZEluZGV4XTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZihjaGlsZCA9PSBudWxsKXtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgY2hpbGQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xyXG4gICAgICAgICAgICBpZighYXR0cmlidXRlTWFwW2tleV0pe1xyXG4gICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShhdHRyLCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlZCBmb3IgbWFwcGluZyBvbmUga2luZCBvZiBhdHRyaWJ1dGUgdG8gdGhlIHN1cHBvcnRlZCB2ZXJzaW9uIG9mIHRoYXQgaW4gYmFkIGJyb3dzZXJzLlxyXG4gICAgY3JlbFthdHRyTWFwU3RyaW5nXSA9IHt9O1xyXG5cclxuICAgIGNyZWxbaXNFbGVtZW50U3RyaW5nXSA9IGlzRWxlbWVudDtcclxuXHJcbiAgICBjcmVsW2lzTm9kZVN0cmluZ10gPSBpc05vZGU7XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBTZXQgPSByZXF1aXJlKCdlczYtc2V0JyksXG4gICAgV2Vha01hcCA9IHJlcXVpcmUoJ2VzNi13ZWFrLW1hcCcpO1xuXG5mdW5jdGlvbiB0b0FycmF5KGl0ZW1zKXtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoaXRlbXMpO1xufVxuXG52YXIgZGVlcFJlZ2V4ID0gL1t8Ll0vaTtcblxuZnVuY3Rpb24gbWF0Y2hEZWVwKHBhdGgpe1xuICAgIHJldHVybiAocGF0aCArICcnKS5tYXRjaChkZWVwUmVnZXgpO1xufVxuXG5mdW5jdGlvbiBpc0RlZXAocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gfnN0cmluZ1BhdGguaW5kZXhPZignLicpIHx8IH5zdHJpbmdQYXRoLmluZGV4T2YoJyoqJykgfHwgfnN0cmluZ1BhdGguaW5kZXhPZignfCcpO1xufVxuXG5mdW5jdGlvbiBpc0ZpbHRlclBhdGgocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gfnN0cmluZ1BhdGguaW5kZXhPZignfCcpO1xufVxuXG5mdW5jdGlvbiBnZXRUYXJnZXRLZXkocGF0aCl7XG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcbiAgICByZXR1cm4gc3RyaW5nUGF0aC5zcGxpdCgnfCcpLnNoaWZ0KCk7XG59XG5cbnZhciBhdHRhY2hlZEVudGllcyA9IG5ldyBTZXQoKSxcbiAgICB0cmFja2VkT2JqZWN0cyA9IG5ldyBXZWFrTWFwKCk7XG5cbmZ1bmN0aW9uIGxlZnRBbmRSZXN0KHBhdGgpe1xuICAgIHZhciBtYXRjaCA9IG1hdGNoRGVlcChwYXRoKTtcbiAgICBpZihtYXRjaCl7XG4gICAgICAgIHJldHVybiBbcGF0aC5zbGljZSgwLCBtYXRjaC5pbmRleCksIHBhdGguc2xpY2UobWF0Y2guaW5kZXgrMSldO1xuICAgIH1cbiAgICByZXR1cm4gcGF0aDtcbn1cblxuZnVuY3Rpb24gaXNXaWxkY2FyZEtleShrZXkpe1xuICAgIHJldHVybiBrZXkuY2hhckF0KDApID09PSAnKic7XG59XG5cbmZ1bmN0aW9uIGlzRmVyYWxjYXJkS2V5KGtleSl7XG4gICAgcmV0dXJuIGtleSA9PT0gJyoqJztcbn1cblxuZnVuY3Rpb24gYWRkSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgdHJhY2tlZEtleXMgPSB7fTtcbiAgICAgICAgdHJhY2tlZE9iamVjdHMuc2V0KG9iamVjdCwgdHJhY2tlZEtleXMpO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICBoYW5kbGVycyA9IG5ldyBTZXQoKTtcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XSA9IGhhbmRsZXJzO1xuICAgIH1cblxuICAgIGhhbmRsZXJzLmFkZChoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlcil7XG4gICAgdmFyIHRyYWNrZWRLZXlzID0gdHJhY2tlZE9iamVjdHMuZ2V0KG9iamVjdCk7XG5cbiAgICBpZih0cmFja2VkS2V5cyA9PSBudWxsKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XG5cbiAgICBpZighaGFuZGxlcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaGFuZGxlcnMuZGVsZXRlKGhhbmRsZXIpO1xufVxuXG5mdW5jdGlvbiB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCl7XG4gICAgaWYoIW9iamVjdCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnRLZXkgPSBrZXkgPT09ICcqKicgPyAnKicgOiBrZXksXG4gICAgICAgIHRhcmdldCA9IG9iamVjdFtrZXldLFxuICAgICAgICB0YXJnZXRJc09iamVjdCA9IHRhcmdldCAmJiB0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JztcblxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIHdlYWtNYXAuaGFzKHRhcmdldCkpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZSA9IGZ1bmN0aW9uKHZhbHVlLCBldmVudCwgZW1pdEtleSl7XG4gICAgICAgIGlmKGV2ZW50S2V5ICE9PSAnKicgJiYgdHlwZW9mIG9iamVjdFtldmVudEtleV0gPT09ICdvYmplY3QnICYmIG9iamVjdFtldmVudEtleV0gIT09IHRhcmdldCl7XG4gICAgICAgICAgICBpZih0YXJnZXRJc09iamVjdCl7XG4gICAgICAgICAgICAgICAgd2Vha01hcC5kZWxldGUodGFyZ2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbW92ZUhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcbiAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHdlYWtNYXAsIGhhbmRsZXIsIG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2ZW50S2V5ID09PSAnKicpe1xuICAgICAgICAgICAgdHJhY2tLZXlzKG9iamVjdCwga2V5LCBwYXRoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCF3ZWFrTWFwLmhhcyhvYmplY3QpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGtleSAhPT0gJyoqJyB8fCAhcGF0aCl7XG4gICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0cmFja0tleXModGFyZ2V0LCByb290LCByZXN0KXtcbiAgICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXQpO1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihpc0ZlcmFsY2FyZEtleShyb290KSl7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCAnKionICsgKHJlc3QgPyAnLicgOiAnJykgKyAocmVzdCB8fCAnJykpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgd2Vha01hcCwgaGFuZGxlciwgdGFyZ2V0LCBrZXlzW2ldLCByZXN0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEhhbmRsZXIob2JqZWN0LCBldmVudEtleSwgaGFuZGxlKTtcblxuICAgIGlmKCF0YXJnZXRJc09iamVjdCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHdvdWxkIG9idmlvdXNseSBiZSBiZXR0ZXIgaW1wbGVtZW50ZWQgd2l0aCBhIFdlYWtTZXQsXG4gICAgLy8gQnV0IEknbSB0cnlpbmcgdG8ga2VlcCBmaWxlc2l6ZSBkb3duLCBhbmQgSSBkb24ndCByZWFsbHkgd2FudCBhbm90aGVyXG4gICAgLy8gcG9seWZpbGwgd2hlbiBXZWFrTWFwIHdvcmtzIHdlbGwgZW5vdWdoIGZvciB0aGUgdGFzay5cbiAgICB3ZWFrTWFwLnNldCh0YXJnZXQsIG51bGwpO1xuXG4gICAgaWYoIXBhdGgpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHJvb3RBbmRSZXN0ID0gbGVmdEFuZFJlc3QocGF0aCksXG4gICAgICAgIHJvb3QsXG4gICAgICAgIHJlc3Q7XG5cbiAgICBpZighQXJyYXkuaXNBcnJheShyb290QW5kUmVzdCkpe1xuICAgICAgICByb290ID0gcm9vdEFuZFJlc3Q7XG4gICAgfWVsc2V7XG4gICAgICAgIHJvb3QgPSByb290QW5kUmVzdFswXTtcbiAgICAgICAgcmVzdCA9IHJvb3RBbmRSZXN0WzFdO1xuICAgIH1cblxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIGlzV2lsZGNhcmRLZXkocm9vdCkpe1xuICAgICAgICB0cmFja0tleXModGFyZ2V0LCByb290LCByZXN0KTtcbiAgICB9XG5cbiAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB3ZWFrTWFwLCBoYW5kbGVyLCB0YXJnZXQsIHJvb3QsIHJlc3QpO1xufVxuXG52YXIgdHJhY2tlZEV2ZW50cyA9IG5ldyBXZWFrTWFwKCk7XG5cbmZ1bmN0aW9uIHRyYWNrUGF0aChlbnRpLCBldmVudE5hbWUpe1xuICAgIHZhciBvYmplY3QgPSBlbnRpLl9tb2RlbCxcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzID0gdHJhY2tlZEV2ZW50cy5nZXQob2JqZWN0KTtcblxuICAgIGlmKCF0cmFja2VkT2JqZWN0UGF0aHMpe1xuICAgICAgICB0cmFja2VkT2JqZWN0UGF0aHMgPSB7fTtcbiAgICAgICAgdHJhY2tlZEV2ZW50cy5zZXQob2JqZWN0LCB0cmFja2VkT2JqZWN0UGF0aHMpO1xuICAgIH1cblxuICAgIHZhciB0cmFja2VkUGF0aHMgPSB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXTtcblxuICAgIGlmKCF0cmFja2VkUGF0aHMpe1xuICAgICAgICB0cmFja2VkUGF0aHMgPSB7XG4gICAgICAgICAgICBlbnRpczogbmV3IFNldCgpLFxuICAgICAgICAgICAgdHJhY2tlZE9iamVjdHM6IG5ldyBXZWFrTWFwKClcbiAgICAgICAgfTtcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV0gPSB0cmFja2VkUGF0aHM7XG4gICAgfVxuXG4gICAgaWYodHJhY2tlZFBhdGhzLmVudGlzLmhhcyhlbnRpKSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cmFja2VkUGF0aHMuZW50aXMuYWRkKGVudGkpO1xuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpe1xuICAgICAgICB0cmFja2VkUGF0aHMuZW50aXMuZm9yRWFjaChmdW5jdGlvbihlbnRpKXtcbiAgICAgICAgICAgIGlmKGVudGkuX21vZGVsICE9PSBvYmplY3Qpe1xuICAgICAgICAgICAgICAgIHRyYWNrZWRQYXRocy5lbnRpcy5kZWxldGUoZW50aSk7XG4gICAgICAgICAgICAgICAgaWYodHJhY2tlZFBhdGhzLmVudGlzLnNpemUgPT09IDApe1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV07XG4gICAgICAgICAgICAgICAgICAgIGlmKCFPYmplY3Qua2V5cyh0cmFja2VkT2JqZWN0UGF0aHMpLmxlbmd0aCl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFja2VkRXZlbnRzLmRlbGV0ZShvYmplY3QpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGVudGkuX2VtaXR0ZWRFdmVudHNbZXZlbnROYW1lXSA9PT0gZW1pdEtleSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZW50aS5fZW1pdHRlZEV2ZW50c1tldmVudE5hbWVdID0gZW1pdEtleTtcblxuICAgICAgICAgICAgaWYoaXNGaWx0ZXJQYXRoKGV2ZW50TmFtZSkpe1xuICAgICAgICAgICAgICAgIGVudGkuZW1pdChldmVudE5hbWUsIGVudGkuZ2V0KGdldFRhcmdldEtleShldmVudE5hbWUpKSwgZXZlbnQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZW50aS5lbWl0KGV2ZW50TmFtZSwgdmFsdWUsIGV2ZW50KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgdHJhY2tlZFBhdGhzLnRyYWNrZWRPYmplY3RzLCBoYW5kbGVyLCB7bW9kZWw6b2JqZWN0fSwgJ21vZGVsJywgZXZlbnROYW1lKTtcbn1cblxuZnVuY3Rpb24gdHJhY2tQYXRocyhlbnRpLCB0YXJnZXQpe1xuICAgIGlmKCFlbnRpLl9ldmVudHMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhlbnRpLl9ldmVudHMpLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBrZXkgPSBrZXlzW2ldLCBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIC8vIEJhaWxvdXQgaWYgdGhlIGV2ZW50IGlzIGEgc2luZ2xlIGtleSxcbiAgICAgICAgLy8gYW5kIHRoZSB0YXJnZXQgaXNudCB0aGUgc2FtZSBhcyB0aGUgZW50aXMgX21vZGVsXG4gICAgICAgIGlmKGVudGkuX21vZGVsICE9PSB0YXJnZXQgJiYgIWlzRGVlcChrZXkpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJhY2tQYXRoKGVudGksIGtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbWl0RXZlbnQob2JqZWN0LCBrZXksIHZhbHVlLCBlbWl0S2V5KXtcblxuICAgIGF0dGFjaGVkRW50aWVzLmZvckVhY2goZnVuY3Rpb24oZW50aSl7XG4gICAgICAgIHRyYWNrUGF0aHMoZW50aSwgb2JqZWN0KTtcbiAgICB9KTtcblxuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xuXG4gICAgaWYoIXRyYWNrZWRLZXlzKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBldmVudCA9IHtcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgb2JqZWN0OiBvYmplY3RcbiAgICB9O1xuXG4gICAgaWYodHJhY2tlZEtleXNba2V5XSl7XG4gICAgICAgIHRyYWNrZWRLZXlzW2tleV0uZm9yRWFjaChmdW5jdGlvbihoYW5kbGVyKXtcbiAgICAgICAgICAgIGlmKHRyYWNrZWRLZXlzW2tleV0uaGFzKGhhbmRsZXIpKXtcbiAgICAgICAgICAgICAgICBoYW5kbGVyKHZhbHVlLCBldmVudCwgZW1pdEtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmKHRyYWNrZWRLZXlzWycqJ10pe1xuICAgICAgICB0cmFja2VkS2V5c1snKiddLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlcil7XG4gICAgICAgICAgICBpZih0cmFja2VkS2V5c1snKiddLmhhcyhoYW5kbGVyKSl7XG4gICAgICAgICAgICAgICAgaGFuZGxlcih2YWx1ZSwgZXZlbnQsIGVtaXRLZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGVtaXQoZXZlbnRzKXtcbiAgICB2YXIgZW1pdEtleSA9IHt9O1xuICAgIGV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgZW1pdEV2ZW50KGV2ZW50WzBdLCBldmVudFsxXSwgZXZlbnRbMl0sIGVtaXRLZXkpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBFbnRpKG1vZGVsKXtcbiAgICB2YXIgZGV0YWNoZWQgPSBtb2RlbCA9PT0gZmFsc2U7XG5cbiAgICBpZighbW9kZWwgfHwgKHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZGVsICE9PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIG1vZGVsID0ge307XG4gICAgfVxuXG4gICAgdGhpcy5fZW1pdHRlZEV2ZW50cyA9IHt9O1xuICAgIGlmKGRldGFjaGVkKXtcbiAgICAgICAgdGhpcy5fbW9kZWwgPSB7fTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdGhpcy5hdHRhY2gobW9kZWwpO1xuICAgIH1cbn1cbkVudGkuZ2V0ID0gZnVuY3Rpb24obW9kZWwsIGtleSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICByZXR1cm4gbW9kZWw7XG4gICAgfVxuXG5cbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XG4gICAgICAgIHJldHVybiBFbnRpLmdldChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsW2tleV07XG59O1xuRW50aS5zZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5zZXQobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ2luYWwgPSBtb2RlbFtrZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXNDaGFuZ2VkID0gIShrZXkgaW4gbW9kZWwpO1xuXG4gICAgbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgdmFyIGV2ZW50cyA9IFtbbW9kZWwsIGtleSwgdmFsdWVdXTtcblxuICAgIGlmKGtleXNDaGFuZ2VkKXtcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5wdXNoID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnB1c2gobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIHRhcmdldC5sZW5ndGgtMSwgdmFsdWVdLFxuICAgICAgICBbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF1cbiAgICBdO1xuXG4gICAgZW1pdChldmVudHMpO1xufTtcbkVudGkuaW5zZXJ0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUsIGluZGV4KXtcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cblxuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDQpe1xuICAgICAgICBpbmRleCA9IHZhbHVlO1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLmluc2VydChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5zcGxpY2UoaW5kZXgsIDAsIHZhbHVlKTtcblxuICAgIHZhciBldmVudHMgPSBbXG4gICAgICAgIFt0YXJnZXQsIGluZGV4LCB2YWx1ZV0sXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxuICAgIF07XG5cbiAgICBlbWl0KGV2ZW50cyk7XG59O1xuRW50aS5yZW1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBzdWJLZXkpe1xuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgcmV0dXJuIEVudGkucmVtb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBzdWJLZXkpO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBhIGtleSBvZmYgb2YgYW4gb2JqZWN0IGF0ICdrZXknXG4gICAgaWYoc3ViS2V5ICE9IG51bGwpe1xuICAgICAgICBFbnRpLnJlbW92ZShtb2RlbFtrZXldLCBzdWJLZXkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICB0aHJvdyAnLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZSc7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xuICAgICAgICBtb2RlbC5zcGxpY2Uoa2V5LCAxKTtcbiAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XG4gICAgfWVsc2V7XG4gICAgICAgIGRlbGV0ZSBtb2RlbFtrZXldO1xuICAgICAgICBldmVudHMucHVzaChbbW9kZWwsIGtleV0pO1xuICAgIH1cblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLm1vdmUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCBpbmRleCl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xuICAgICAgICByZXR1cm4gRW50aS5tb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBpbmRleCk7XG4gICAgfVxuXG4gICAgdmFyIG1vZGVsID0gbW9kZWw7XG5cbiAgICBpZihrZXkgPT09IGluZGV4KXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKCFBcnJheS5pc0FycmF5KG1vZGVsKSl7XG4gICAgICAgIHRocm93ICdUaGUgbW9kZWwgaXMgbm90IGFuIGFycmF5Lic7XG4gICAgfVxuXG4gICAgdmFyIGl0ZW0gPSBtb2RlbFtrZXldO1xuXG4gICAgbW9kZWwuc3BsaWNlKGtleSwgMSk7XG5cbiAgICBtb2RlbC5zcGxpY2UoaW5kZXggLSAoaW5kZXggPiBrZXkgPyAwIDogMSksIDAsIGl0ZW0pO1xuXG4gICAgZW1pdChbbW9kZWwsIGluZGV4LCBpdGVtXSk7XG59O1xuRW50aS51cGRhdGUgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldCxcbiAgICAgICAgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkodmFsdWUpO1xuXG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAga2V5ID0gJy4nO1xuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcbiAgICAgICAgICAgIHJldHVybiBFbnRpLnVwZGF0ZShtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcblxuICAgICAgICBpZih0YXJnZXQgPT0gbnVsbCl7XG4gICAgICAgICAgICBtb2RlbFtrZXldID0gaXNBcnJheSA/IFtdIDoge307XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgdGhyb3cgJ1RoZSB2YWx1ZSBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIHRhcmdldCAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyAnVGhlIHRhcmdldCBpcyBub3QgYW4gb2JqZWN0Lic7XG4gICAgfVxuXG4gICAgdmFyIGV2ZW50cyA9IFtdO1xuXG4gICAgZnVuY3Rpb24gdXBkYXRlVGFyZ2V0KHRhcmdldCwgdmFsdWUpe1xuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBpZih0YXJnZXRba2V5XSAmJiB0eXBlb2YgdGFyZ2V0W2tleV0gPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICB1cGRhdGVUYXJnZXQodGFyZ2V0W2tleV0sIHZhbHVlW2tleV0pO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGFyZ2V0W2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwga2V5LCB2YWx1ZVtrZXldXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICAgICAgZXZlbnRzLnB1c2goW3RhcmdldCwgJ2xlbmd0aCcsIHRhcmdldC5sZW5ndGhdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZVRhcmdldCh0YXJnZXQsIHZhbHVlKTtcblxuICAgIGVtaXQoZXZlbnRzKTtcbn07XG5FbnRpLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5FbnRpLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEVudGk7XG5FbnRpLnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihtb2RlbCl7XG4gICAgaWYodGhpcy5fbW9kZWwgIT09IG1vZGVsKXtcbiAgICAgICAgdGhpcy5kZXRhY2goKTtcbiAgICB9XG5cbiAgICBpZighYXR0YWNoZWRFbnRpZXMuaGFzKHRoaXMpKXtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuYWRkKHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLl9hdHRhY2hlZCA9IHRydWU7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbDtcbn07XG5FbnRpLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpe1xuICAgIGlmKGF0dGFjaGVkRW50aWVzLmhhcyh0aGlzKSl7XG4gICAgICAgIGF0dGFjaGVkRW50aWVzLmRlbGV0ZSh0aGlzKTtcbiAgICB9XG5cbiAgICB0aGlzLl9lbWl0dGVkRXZlbnRzID0ge307XG4gICAgdGhpcy5fbW9kZWwgPSB7fTtcbiAgICB0aGlzLl9hdHRhY2hlZCA9IGZhbHNlO1xufTtcbkVudGkucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xuICAgIHRoaXMuZGV0YWNoKCk7XG4gICAgdGhpcy5fZXZlbnRzID0gbnVsbDtcbn1cbkVudGkucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgcmV0dXJuIEVudGkuZ2V0KHRoaXMuX21vZGVsLCBrZXkpO1xufTtcblxuRW50aS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgcmV0dXJuIEVudGkuc2V0KHRoaXMuX21vZGVsLCBrZXksIHZhbHVlKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICByZXR1cm4gRW50aS5wdXNoLmFwcGx5KG51bGwsIFt0aGlzLl9tb2RlbF0uY29uY2F0KHRvQXJyYXkoYXJndW1lbnRzKSkpO1xufTtcblxuRW50aS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLmluc2VydC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGtleSwgc3ViS2V5KXtcbiAgICByZXR1cm4gRW50aS5yZW1vdmUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5tb3ZlID0gZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgcmV0dXJuIEVudGkubW92ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5cbkVudGkucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgIHJldHVybiBFbnRpLnVwZGF0ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcbn07XG5FbnRpLnByb3RvdHlwZS5pc0F0dGFjaGVkID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gdGhpcy5fYXR0YWNoZWQ7XG59O1xuRW50aS5wcm90b3R5cGUuYXR0YWNoZWRDb3VudCA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIGF0dGFjaGVkRW50aWVzLnNpemU7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVudGk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTZXQgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc2V0LCBpdGVyYXRvciwgcmVzdWx0O1xuXHRpZiAodHlwZW9mIFNldCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzZXQgPSBuZXcgU2V0KFsncmF6JywgJ2R3YScsICd0cnp5J10pO1xuXHRpZiAoc2V0LnNpemUgIT09IDMpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuYWRkICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmNsZWFyICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmRlbGV0ZSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIHNldC5lbnRyaWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQuaGFzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2Ygc2V0LmtleXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBzZXQudmFsdWVzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cblx0aXRlcmF0b3IgPSBzZXQudmFsdWVzKCk7XG5cdHJlc3VsdCA9IGl0ZXJhdG9yLm5leHQoKTtcblx0aWYgKHJlc3VsdC5kb25lICE9PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuXHRpZiAocmVzdWx0LnZhbHVlICE9PSAncmF6JykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHJ1ZTtcbn07XG4iLCIvLyBFeHBvcnRzIHRydWUgaWYgZW52aXJvbm1lbnQgcHJvdmlkZXMgbmF0aXZlIGBTZXRgIGltcGxlbWVudGF0aW9uLFxuLy8gd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgU2V0ID09PSAndW5kZWZpbmVkJykgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChTZXQucHJvdG90eXBlKSA9PT0gJ1tvYmplY3QgU2V0XScpO1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY29udGFpbnMgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcbiAgLCBkICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yJylcbiAgLCB0b1N0cmluZ1RhZ1N5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS50b1N0cmluZ1RhZ1xuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBTZXRJdGVyYXRvcjtcblxuU2V0SXRlcmF0b3IgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZXQsIGtpbmQpIHtcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIFNldEl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBTZXRJdGVyYXRvcihzZXQsIGtpbmQpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIHNldC5fX3NldERhdGFfXywgc2V0KTtcblx0aWYgKCFraW5kKSBraW5kID0gJ3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5K3ZhbHVlJykpIGtpbmQgPSAna2V5K3ZhbHVlJztcblx0ZWxzZSBraW5kID0gJ3ZhbHVlJztcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fa2luZF9fJywgZCgnJywga2luZCkpO1xufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoU2V0SXRlcmF0b3IsIEl0ZXJhdG9yKTtcblxuU2V0SXRlcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvci5wcm90b3R5cGUsIHtcblx0Y29uc3RydWN0b3I6IGQoU2V0SXRlcmF0b3IpLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAndmFsdWUnKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRyZXR1cm4gW3RoaXMuX19saXN0X19baV0sIHRoaXMuX19saXN0X19baV1dO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgU2V0IEl0ZXJhdG9yXSc7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFNldEl0ZXJhdG9yLnByb3RvdHlwZSwgdG9TdHJpbmdUYWdTeW1ib2wsXG5cdGQoJ2MnLCAnU2V0IEl0ZXJhdG9yJykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY29weSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2NvcHknKVxuICAsIG1hcCAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9tYXAnKVxuICAsIGNhbGxhYmxlICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1jYWxsYWJsZScpXG4gICwgdmFsaWRWYWx1ZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcblxuICAsIGJpbmQgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBkZWZpbmU7XG5cbmRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXNjLCBiaW5kVG8pIHtcblx0dmFyIHZhbHVlID0gdmFsaWRWYWx1ZShkZXNjKSAmJiBjYWxsYWJsZShkZXNjLnZhbHVlKSwgZGdzO1xuXHRkZ3MgPSBjb3B5KGRlc2MpO1xuXHRkZWxldGUgZGdzLndyaXRhYmxlO1xuXHRkZWxldGUgZGdzLnZhbHVlO1xuXHRkZ3MuZ2V0ID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpKSByZXR1cm4gdmFsdWU7XG5cdFx0ZGVzYy52YWx1ZSA9IGJpbmQuY2FsbCh2YWx1ZSwgKGJpbmRUbyA9PSBudWxsKSA/IHRoaXMgOiB0aGlzW2JpbmRUb10pO1xuXHRcdGRlZmluZVByb3BlcnR5KHRoaXMsIG5hbWUsIGRlc2MpO1xuXHRcdHJldHVybiB0aGlzW25hbWVdO1xuXHR9O1xuXHRyZXR1cm4gZGdzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAocHJvcHMvKiwgYmluZFRvKi8pIHtcblx0dmFyIGJpbmRUbyA9IGFyZ3VtZW50c1sxXTtcblx0cmV0dXJuIG1hcChwcm9wcywgZnVuY3Rpb24gKGRlc2MsIG5hbWUpIHtcblx0XHRyZXR1cm4gZGVmaW5lKG5hbWUsIGRlc2MsIGJpbmRUbyk7XG5cdH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIG5vcm1hbGl6ZU9wdHMgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9ub3JtYWxpemUtb3B0aW9ucycpXG4gICwgaXNDYWxsYWJsZSAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L2lzLWNhbGxhYmxlJylcbiAgLCBjb250YWlucyAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvIy9jb250YWlucycpXG5cbiAgLCBkO1xuXG5kID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZHNjciwgdmFsdWUvKiwgb3B0aW9ucyovKSB7XG5cdHZhciBjLCBlLCB3LCBvcHRpb25zLCBkZXNjO1xuXHRpZiAoKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB8fCAodHlwZW9mIGRzY3IgIT09ICdzdHJpbmcnKSkge1xuXHRcdG9wdGlvbnMgPSB2YWx1ZTtcblx0XHR2YWx1ZSA9IGRzY3I7XG5cdFx0ZHNjciA9IG51bGw7XG5cdH0gZWxzZSB7XG5cdFx0b3B0aW9ucyA9IGFyZ3VtZW50c1syXTtcblx0fVxuXHRpZiAoZHNjciA9PSBudWxsKSB7XG5cdFx0YyA9IHcgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdFx0dyA9IGNvbnRhaW5zLmNhbGwoZHNjciwgJ3cnKTtcblx0fVxuXG5cdGRlc2MgPSB7IHZhbHVlOiB2YWx1ZSwgY29uZmlndXJhYmxlOiBjLCBlbnVtZXJhYmxlOiBlLCB3cml0YWJsZTogdyB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcblxuZC5ncyA9IGZ1bmN0aW9uIChkc2NyLCBnZXQsIHNldC8qLCBvcHRpb25zKi8pIHtcblx0dmFyIGMsIGUsIG9wdGlvbnMsIGRlc2M7XG5cdGlmICh0eXBlb2YgZHNjciAhPT0gJ3N0cmluZycpIHtcblx0XHRvcHRpb25zID0gc2V0O1xuXHRcdHNldCA9IGdldDtcblx0XHRnZXQgPSBkc2NyO1xuXHRcdGRzY3IgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdG9wdGlvbnMgPSBhcmd1bWVudHNbM107XG5cdH1cblx0aWYgKGdldCA9PSBudWxsKSB7XG5cdFx0Z2V0ID0gdW5kZWZpbmVkO1xuXHR9IGVsc2UgaWYgKCFpc0NhbGxhYmxlKGdldCkpIHtcblx0XHRvcHRpb25zID0gZ2V0O1xuXHRcdGdldCA9IHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmIChzZXQgPT0gbnVsbCkge1xuXHRcdHNldCA9IHVuZGVmaW5lZDtcblx0fSBlbHNlIGlmICghaXNDYWxsYWJsZShzZXQpKSB7XG5cdFx0b3B0aW9ucyA9IHNldDtcblx0XHRzZXQgPSB1bmRlZmluZWQ7XG5cdH1cblx0aWYgKGRzY3IgPT0gbnVsbCkge1xuXHRcdGMgPSB0cnVlO1xuXHRcdGUgPSBmYWxzZTtcblx0fSBlbHNlIHtcblx0XHRjID0gY29udGFpbnMuY2FsbChkc2NyLCAnYycpO1xuXHRcdGUgPSBjb250YWlucy5jYWxsKGRzY3IsICdlJyk7XG5cdH1cblxuXHRkZXNjID0geyBnZXQ6IGdldCwgc2V0OiBzZXQsIGNvbmZpZ3VyYWJsZTogYywgZW51bWVyYWJsZTogZSB9O1xuXHRyZXR1cm4gIW9wdGlvbnMgPyBkZXNjIDogYXNzaWduKG5vcm1hbGl6ZU9wdHMob3B0aW9ucyksIGRlc2MpO1xufTtcbiIsIi8vIEluc3BpcmVkIGJ5IEdvb2dsZSBDbG9zdXJlOlxuLy8gaHR0cDovL2Nsb3N1cmUtbGlicmFyeS5nb29nbGVjb2RlLmNvbS9zdm4vZG9jcy9cbi8vIGNsb3N1cmVfZ29vZ19hcnJheV9hcnJheS5qcy5odG1sI2dvb2cuYXJyYXkuY2xlYXJcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdmFsdWUgPSByZXF1aXJlKCcuLi8uLi9vYmplY3QvdmFsaWQtdmFsdWUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhbHVlKHRoaXMpLmxlbmd0aCA9IDA7XG5cdHJldHVybiB0aGlzO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRvUG9zSW50ID0gcmVxdWlyZSgnLi4vLi4vbnVtYmVyL3RvLXBvcy1pbnRlZ2VyJylcbiAgLCB2YWx1ZSAgICA9IHJlcXVpcmUoJy4uLy4uL29iamVjdC92YWxpZC12YWx1ZScpXG5cbiAgLCBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2ZcbiAgLCBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHlcbiAgLCBhYnMgPSBNYXRoLmFicywgZmxvb3IgPSBNYXRoLmZsb29yO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzZWFyY2hFbGVtZW50LyosIGZyb21JbmRleCovKSB7XG5cdHZhciBpLCBsLCBmcm9tSW5kZXgsIHZhbDtcblx0aWYgKHNlYXJjaEVsZW1lbnQgPT09IHNlYXJjaEVsZW1lbnQpIHsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdHJldHVybiBpbmRleE9mLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG5cdH1cblxuXHRsID0gdG9Qb3NJbnQodmFsdWUodGhpcykubGVuZ3RoKTtcblx0ZnJvbUluZGV4ID0gYXJndW1lbnRzWzFdO1xuXHRpZiAoaXNOYU4oZnJvbUluZGV4KSkgZnJvbUluZGV4ID0gMDtcblx0ZWxzZSBpZiAoZnJvbUluZGV4ID49IDApIGZyb21JbmRleCA9IGZsb29yKGZyb21JbmRleCk7XG5cdGVsc2UgZnJvbUluZGV4ID0gdG9Qb3NJbnQodGhpcy5sZW5ndGgpIC0gZmxvb3IoYWJzKGZyb21JbmRleCkpO1xuXG5cdGZvciAoaSA9IGZyb21JbmRleDsgaSA8IGw7ICsraSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIGkpKSB7XG5cdFx0XHR2YWwgPSB0aGlzW2ldO1xuXHRcdFx0aWYgKHZhbCAhPT0gdmFsKSByZXR1cm4gaTsgLy9qc2xpbnQ6IGlnbm9yZVxuXHRcdH1cblx0fVxuXHRyZXR1cm4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpXG5cdD8gTWF0aC5zaWduXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc2lnbiA9IE1hdGguc2lnbjtcblx0aWYgKHR5cGVvZiBzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHNpZ24oMTApID09PSAxKSAmJiAoc2lnbigtMjApID09PSAtMSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0dmFsdWUgPSBOdW1iZXIodmFsdWUpO1xuXHRpZiAoaXNOYU4odmFsdWUpIHx8ICh2YWx1ZSA9PT0gMCkpIHJldHVybiB2YWx1ZTtcblx0cmV0dXJuICh2YWx1ZSA+IDApID8gMSA6IC0xO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNpZ24gPSByZXF1aXJlKCcuLi9tYXRoL3NpZ24nKVxuXG4gICwgYWJzID0gTWF0aC5hYnMsIGZsb29yID0gTWF0aC5mbG9vcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsdWUpIHtcblx0aWYgKGlzTmFOKHZhbHVlKSkgcmV0dXJuIDA7XG5cdHZhbHVlID0gTnVtYmVyKHZhbHVlKTtcblx0aWYgKCh2YWx1ZSA9PT0gMCkgfHwgIWlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuXHRyZXR1cm4gc2lnbih2YWx1ZSkgKiBmbG9vcihhYnModmFsdWUpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b0ludGVnZXIgPSByZXF1aXJlKCcuL3RvLWludGVnZXInKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7IHJldHVybiBtYXgoMCwgdG9JbnRlZ2VyKHZhbHVlKSk7IH07XG4iLCIvLyBJbnRlcm5hbCBtZXRob2QsIHVzZWQgYnkgaXRlcmF0aW9uIGZ1bmN0aW9ucy5cbi8vIENhbGxzIGEgZnVuY3Rpb24gZm9yIGVhY2gga2V5LXZhbHVlIHBhaXIgZm91bmQgaW4gb2JqZWN0XG4vLyBPcHRpb25hbGx5IHRha2VzIGNvbXBhcmVGbiB0byBpdGVyYXRlIG9iamVjdCBpbiBzcGVjaWZpYyBvcmRlclxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc0NhbGxhYmxlID0gcmVxdWlyZSgnLi9pcy1jYWxsYWJsZScpXG4gICwgY2FsbGFibGUgICA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbHVlICAgICAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwga2V5cyA9IE9iamVjdC5rZXlzXG4gICwgcHJvcGVydHlJc0VudW1lcmFibGUgPSBPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChtZXRob2QsIGRlZlZhbCkge1xuXHRyZXR1cm4gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZywgY29tcGFyZUZuKi8pIHtcblx0XHR2YXIgbGlzdCwgdGhpc0FyZyA9IGFyZ3VtZW50c1syXSwgY29tcGFyZUZuID0gYXJndW1lbnRzWzNdO1xuXHRcdG9iaiA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0XHRjYWxsYWJsZShjYik7XG5cblx0XHRsaXN0ID0ga2V5cyhvYmopO1xuXHRcdGlmIChjb21wYXJlRm4pIHtcblx0XHRcdGxpc3Quc29ydChpc0NhbGxhYmxlKGNvbXBhcmVGbikgPyBjb21wYXJlRm4uYmluZChvYmopIDogdW5kZWZpbmVkKTtcblx0XHR9XG5cdFx0cmV0dXJuIGxpc3RbbWV0aG9kXShmdW5jdGlvbiAoa2V5LCBpbmRleCkge1xuXHRcdFx0aWYgKCFwcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iaiwga2V5KSkgcmV0dXJuIGRlZlZhbDtcblx0XHRcdHJldHVybiBjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIG9ialtrZXldLCBrZXksIG9iaiwgaW5kZXgpO1xuXHRcdH0pO1xuXHR9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5hc3NpZ25cblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBhc3NpZ24gPSBPYmplY3QuYXNzaWduLCBvYmo7XG5cdGlmICh0eXBlb2YgYXNzaWduICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdG9iaiA9IHsgZm9vOiAncmF6JyB9O1xuXHRhc3NpZ24ob2JqLCB7IGJhcjogJ2R3YScgfSwgeyB0cnp5OiAndHJ6eScgfSk7XG5cdHJldHVybiAob2JqLmZvbyArIG9iai5iYXIgKyBvYmoudHJ6eSkgPT09ICdyYXpkd2F0cnp5Jztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzICA9IHJlcXVpcmUoJy4uL2tleXMnKVxuICAsIHZhbHVlID0gcmVxdWlyZSgnLi4vdmFsaWQtdmFsdWUnKVxuXG4gICwgbWF4ID0gTWF0aC5tYXg7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRlc3QsIHNyYy8qLCDigKZzcmNuKi8pIHtcblx0dmFyIGVycm9yLCBpLCBsID0gbWF4KGFyZ3VtZW50cy5sZW5ndGgsIDIpLCBhc3NpZ247XG5cdGRlc3QgPSBPYmplY3QodmFsdWUoZGVzdCkpO1xuXHRhc3NpZ24gPSBmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dHJ5IHsgZGVzdFtrZXldID0gc3JjW2tleV07IH0gY2F0Y2ggKGUpIHtcblx0XHRcdGlmICghZXJyb3IpIGVycm9yID0gZTtcblx0XHR9XG5cdH07XG5cdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIHtcblx0XHRzcmMgPSBhcmd1bWVudHNbaV07XG5cdFx0a2V5cyhzcmMpLmZvckVhY2goYXNzaWduKTtcblx0fVxuXHRpZiAoZXJyb3IgIT09IHVuZGVmaW5lZCkgdGhyb3cgZXJyb3I7XG5cdHJldHVybiBkZXN0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzc2lnbiA9IHJlcXVpcmUoJy4vYXNzaWduJylcbiAgLCB2YWx1ZSAgPSByZXF1aXJlKCcuL3ZhbGlkLXZhbHVlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuXHR2YXIgY29weSA9IE9iamVjdCh2YWx1ZShvYmopKTtcblx0aWYgKGNvcHkgIT09IG9iaikgcmV0dXJuIGNvcHk7XG5cdHJldHVybiBhc3NpZ24oe30sIG9iaik7XG59O1xuIiwiLy8gV29ya2Fyb3VuZCBmb3IgaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9MjgwNFxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBzaGltO1xuXG5pZiAoIXJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9pcy1pbXBsZW1lbnRlZCcpKCkpIHtcblx0c2hpbSA9IHJlcXVpcmUoJy4vc2V0LXByb3RvdHlwZS1vZi9zaGltJyk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIG51bGxPYmplY3QsIHByb3BzLCBkZXNjO1xuXHRpZiAoIXNoaW0pIHJldHVybiBjcmVhdGU7XG5cdGlmIChzaGltLmxldmVsICE9PSAxKSByZXR1cm4gY3JlYXRlO1xuXG5cdG51bGxPYmplY3QgPSB7fTtcblx0cHJvcHMgPSB7fTtcblx0ZGVzYyA9IHsgY29uZmlndXJhYmxlOiBmYWxzZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdHZhbHVlOiB1bmRlZmluZWQgfTtcblx0T2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoT2JqZWN0LnByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuXHRcdGlmIChuYW1lID09PSAnX19wcm90b19fJykge1xuXHRcdFx0cHJvcHNbbmFtZV0gPSB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogZmFsc2UsIHdyaXRhYmxlOiB0cnVlLFxuXHRcdFx0XHR2YWx1ZTogdW5kZWZpbmVkIH07XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHByb3BzW25hbWVdID0gZGVzYztcblx0fSk7XG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKG51bGxPYmplY3QsIHByb3BzKTtcblxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoc2hpbSwgJ251bGxQb2x5ZmlsbCcsIHsgY29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IGZhbHNlLCB2YWx1ZTogbnVsbE9iamVjdCB9KTtcblxuXHRyZXR1cm4gZnVuY3Rpb24gKHByb3RvdHlwZSwgcHJvcHMpIHtcblx0XHRyZXR1cm4gY3JlYXRlKChwcm90b3R5cGUgPT09IG51bGwpID8gbnVsbE9iamVjdCA6IHByb3RvdHlwZSwgcHJvcHMpO1xuXHR9O1xufSgpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL19pdGVyYXRlJykoJ2ZvckVhY2gnKTtcbiIsIi8vIERlcHJlY2F0ZWRcblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHsgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbic7IH07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBtYXAgPSB7IGZ1bmN0aW9uOiB0cnVlLCBvYmplY3Q6IHRydWUgfTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKCh4ICE9IG51bGwpICYmIG1hcFt0eXBlb2YgeF0pIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5rZXlzXG5cdDogcmVxdWlyZSgnLi9zaGltJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR0cnkge1xuXHRcdE9iamVjdC5rZXlzKCdwcmltaXRpdmUnKTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBrZXlzID0gT2JqZWN0LmtleXM7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iamVjdCkge1xuXHRyZXR1cm4ga2V5cyhvYmplY3QgPT0gbnVsbCA/IG9iamVjdCA6IE9iamVjdChvYmplY3QpKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjYWxsYWJsZSA9IHJlcXVpcmUoJy4vdmFsaWQtY2FsbGFibGUnKVxuICAsIGZvckVhY2ggID0gcmVxdWlyZSgnLi9mb3ItZWFjaCcpXG5cbiAgLCBjYWxsID0gRnVuY3Rpb24ucHJvdG90eXBlLmNhbGw7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaiwgY2IvKiwgdGhpc0FyZyovKSB7XG5cdHZhciBvID0ge30sIHRoaXNBcmcgPSBhcmd1bWVudHNbMl07XG5cdGNhbGxhYmxlKGNiKTtcblx0Zm9yRWFjaChvYmosIGZ1bmN0aW9uICh2YWx1ZSwga2V5LCBvYmosIGluZGV4KSB7XG5cdFx0b1trZXldID0gY2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwga2V5LCBvYmosIGluZGV4KTtcblx0fSk7XG5cdHJldHVybiBvO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZTtcblxudmFyIHByb2Nlc3MgPSBmdW5jdGlvbiAoc3JjLCBvYmopIHtcblx0dmFyIGtleTtcblx0Zm9yIChrZXkgaW4gc3JjKSBvYmpba2V5XSA9IHNyY1trZXldO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucy8qLCDigKZvcHRpb25zKi8pIHtcblx0dmFyIHJlc3VsdCA9IGNyZWF0ZShudWxsKTtcblx0Zm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24gKG9wdGlvbnMpIHtcblx0XHRpZiAob3B0aW9ucyA9PSBudWxsKSByZXR1cm47XG5cdFx0cHJvY2VzcyhPYmplY3Qob3B0aW9ucyksIHJlc3VsdCk7XG5cdH0pO1xuXHRyZXR1cm4gcmVzdWx0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IE9iamVjdC5zZXRQcm90b3R5cGVPZlxuXHQ6IHJlcXVpcmUoJy4vc2hpbScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZ2V0UHJvdG90eXBlT2YgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2ZcbiAgLCB4ID0ge307XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKC8qY3VzdG9tQ3JlYXRlKi8pIHtcblx0dmFyIHNldFByb3RvdHlwZU9mID0gT2JqZWN0LnNldFByb3RvdHlwZU9mXG5cdCAgLCBjdXN0b21DcmVhdGUgPSBhcmd1bWVudHNbMF0gfHwgY3JlYXRlO1xuXHRpZiAodHlwZW9mIHNldFByb3RvdHlwZU9mICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiBnZXRQcm90b3R5cGVPZihzZXRQcm90b3R5cGVPZihjdXN0b21DcmVhdGUobnVsbCksIHgpKSA9PT0geDtcbn07XG4iLCIvLyBCaWcgdGhhbmtzIHRvIEBXZWJSZWZsZWN0aW9uIGZvciBzb3J0aW5nIHRoaXMgb3V0XG4vLyBodHRwczovL2dpc3QuZ2l0aHViLmNvbS9XZWJSZWZsZWN0aW9uLzU1OTM1NTRcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNPYmplY3QgICAgICA9IHJlcXVpcmUoJy4uL2lzLW9iamVjdCcpXG4gICwgdmFsdWUgICAgICAgICA9IHJlcXVpcmUoJy4uL3ZhbGlkLXZhbHVlJylcblxuICAsIGlzUHJvdG90eXBlT2YgPSBPYmplY3QucHJvdG90eXBlLmlzUHJvdG90eXBlT2ZcbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIG51bGxEZXNjID0geyBjb25maWd1cmFibGU6IHRydWUsIGVudW1lcmFibGU6IGZhbHNlLCB3cml0YWJsZTogdHJ1ZSxcblx0XHR2YWx1ZTogdW5kZWZpbmVkIH1cbiAgLCB2YWxpZGF0ZTtcblxudmFsaWRhdGUgPSBmdW5jdGlvbiAob2JqLCBwcm90b3R5cGUpIHtcblx0dmFsdWUob2JqKTtcblx0aWYgKChwcm90b3R5cGUgPT09IG51bGwpIHx8IGlzT2JqZWN0KHByb3RvdHlwZSkpIHJldHVybiBvYmo7XG5cdHRocm93IG5ldyBUeXBlRXJyb3IoJ1Byb3RvdHlwZSBtdXN0IGJlIG51bGwgb3IgYW4gb2JqZWN0Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoc3RhdHVzKSB7XG5cdHZhciBmbiwgc2V0O1xuXHRpZiAoIXN0YXR1cykgcmV0dXJuIG51bGw7XG5cdGlmIChzdGF0dXMubGV2ZWwgPT09IDIpIHtcblx0XHRpZiAoc3RhdHVzLnNldCkge1xuXHRcdFx0c2V0ID0gc3RhdHVzLnNldDtcblx0XHRcdGZuID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHRcdHNldC5jYWxsKHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKSwgcHJvdG90eXBlKTtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH07XG5cdFx0fSBlbHNlIHtcblx0XHRcdGZuID0gZnVuY3Rpb24gKG9iaiwgcHJvdG90eXBlKSB7XG5cdFx0XHRcdHZhbGlkYXRlKG9iaiwgcHJvdG90eXBlKS5fX3Byb3RvX18gPSBwcm90b3R5cGU7XG5cdFx0XHRcdHJldHVybiBvYmo7XG5cdFx0XHR9O1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRmbiA9IGZ1bmN0aW9uIHNlbGYob2JqLCBwcm90b3R5cGUpIHtcblx0XHRcdHZhciBpc051bGxCYXNlO1xuXHRcdFx0dmFsaWRhdGUob2JqLCBwcm90b3R5cGUpO1xuXHRcdFx0aXNOdWxsQmFzZSA9IGlzUHJvdG90eXBlT2YuY2FsbChzZWxmLm51bGxQb2x5ZmlsbCwgb2JqKTtcblx0XHRcdGlmIChpc051bGxCYXNlKSBkZWxldGUgc2VsZi5udWxsUG9seWZpbGwuX19wcm90b19fO1xuXHRcdFx0aWYgKHByb3RvdHlwZSA9PT0gbnVsbCkgcHJvdG90eXBlID0gc2VsZi5udWxsUG9seWZpbGw7XG5cdFx0XHRvYmouX19wcm90b19fID0gcHJvdG90eXBlO1xuXHRcdFx0aWYgKGlzTnVsbEJhc2UpIGRlZmluZVByb3BlcnR5KHNlbGYubnVsbFBvbHlmaWxsLCAnX19wcm90b19fJywgbnVsbERlc2MpO1xuXHRcdFx0cmV0dXJuIG9iajtcblx0XHR9O1xuXHR9XG5cdHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkoZm4sICdsZXZlbCcsIHsgY29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IGZhbHNlLCB2YWx1ZTogc3RhdHVzLmxldmVsIH0pO1xufSgoZnVuY3Rpb24gKCkge1xuXHR2YXIgeCA9IE9iamVjdC5jcmVhdGUobnVsbCksIHkgPSB7fSwgc2V0XG5cdCAgLCBkZXNjID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihPYmplY3QucHJvdG90eXBlLCAnX19wcm90b19fJyk7XG5cblx0aWYgKGRlc2MpIHtcblx0XHR0cnkge1xuXHRcdFx0c2V0ID0gZGVzYy5zZXQ7IC8vIE9wZXJhIGNyYXNoZXMgYXQgdGhpcyBwb2ludFxuXHRcdFx0c2V0LmNhbGwoeCwgeSk7XG5cdFx0fSBjYXRjaCAoaWdub3JlKSB7IH1cblx0XHRpZiAoT2JqZWN0LmdldFByb3RvdHlwZU9mKHgpID09PSB5KSByZXR1cm4geyBzZXQ6IHNldCwgbGV2ZWw6IDIgfTtcblx0fVxuXG5cdHguX19wcm90b19fID0geTtcblx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgbGV2ZWw6IDIgfTtcblxuXHR4ID0ge307XG5cdHguX19wcm90b19fID0geTtcblx0aWYgKE9iamVjdC5nZXRQcm90b3R5cGVPZih4KSA9PT0geSkgcmV0dXJuIHsgbGV2ZWw6IDEgfTtcblxuXHRyZXR1cm4gZmFsc2U7XG59KCkpKSk7XG5cbnJlcXVpcmUoJy4uL2NyZWF0ZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChmbikge1xuXHRpZiAodHlwZW9mIGZuICE9PSAnZnVuY3Rpb24nKSB0aHJvdyBuZXcgVHlwZUVycm9yKGZuICsgXCIgaXMgbm90IGEgZnVuY3Rpb25cIik7XG5cdHJldHVybiBmbjtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSBudWxsIG9yIHVuZGVmaW5lZFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKVxuXHQ/IFN0cmluZy5wcm90b3R5cGUuY29udGFpbnNcblx0OiByZXF1aXJlKCcuL3NoaW0nKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHN0ciA9ICdyYXpkd2F0cnp5JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2Ygc3RyLmNvbnRhaW5zICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoKHN0ci5jb250YWlucygnZHdhJykgPT09IHRydWUpICYmIChzdHIuY29udGFpbnMoJ2ZvbycpID09PSBmYWxzZSkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGluZGV4T2YgPSBTdHJpbmcucHJvdG90eXBlLmluZGV4T2Y7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHNlYXJjaFN0cmluZy8qLCBwb3NpdGlvbiovKSB7XG5cdHJldHVybiBpbmRleE9mLmNhbGwodGhpcywgc2VhcmNoU3RyaW5nLCBhcmd1bWVudHNbMV0pID4gLTE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nXG5cbiAgLCBpZCA9IHRvU3RyaW5nLmNhbGwoJycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh4KSB7XG5cdHJldHVybiAodHlwZW9mIHggPT09ICdzdHJpbmcnKSB8fCAoeCAmJiAodHlwZW9mIHggPT09ICdvYmplY3QnKSAmJlxuXHRcdCgoeCBpbnN0YW5jZW9mIFN0cmluZykgfHwgKHRvU3RyaW5nLmNhbGwoeCkgPT09IGlkKSkpIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgY29udGFpbnMgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L3N0cmluZy8jL2NvbnRhaW5zJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi8nKVxuXG4gICwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHlcbiAgLCBBcnJheUl0ZXJhdG9yO1xuXG5BcnJheUl0ZXJhdG9yID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXJyLCBraW5kKSB7XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBBcnJheUl0ZXJhdG9yKSkgcmV0dXJuIG5ldyBBcnJheUl0ZXJhdG9yKGFyciwga2luZCk7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgYXJyKTtcblx0aWYgKCFraW5kKSBraW5kID0gJ3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5K3ZhbHVlJykpIGtpbmQgPSAna2V5K3ZhbHVlJztcblx0ZWxzZSBpZiAoY29udGFpbnMuY2FsbChraW5kLCAna2V5JykpIGtpbmQgPSAna2V5Jztcblx0ZWxzZSBraW5kID0gJ3ZhbHVlJztcblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fa2luZF9fJywgZCgnJywga2luZCkpO1xufTtcbmlmIChzZXRQcm90b3R5cGVPZikgc2V0UHJvdG90eXBlT2YoQXJyYXlJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5BcnJheUl0ZXJhdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSXRlcmF0b3IucHJvdG90eXBlLCB7XG5cdGNvbnN0cnVjdG9yOiBkKEFycmF5SXRlcmF0b3IpLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdGlmICh0aGlzLl9fa2luZF9fID09PSAndmFsdWUnKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRpZiAodGhpcy5fX2tpbmRfXyA9PT0gJ2tleSt2YWx1ZScpIHJldHVybiBbaSwgdGhpcy5fX2xpc3RfX1tpXV07XG5cdFx0cmV0dXJuIGk7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBBcnJheSBJdGVyYXRvcl0nOyB9KVxufSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjYWxsYWJsZSA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCBpc1N0cmluZyA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgZ2V0ICAgICAgPSByZXF1aXJlKCcuL2dldCcpXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChpdGVyYWJsZSwgY2IvKiwgdGhpc0FyZyovKSB7XG5cdHZhciBtb2RlLCB0aGlzQXJnID0gYXJndW1lbnRzWzJdLCByZXN1bHQsIGRvQnJlYWssIGJyb2tlbiwgaSwgbCwgY2hhciwgY29kZTtcblx0aWYgKGlzQXJyYXkoaXRlcmFibGUpKSBtb2RlID0gJ2FycmF5Jztcblx0ZWxzZSBpZiAoaXNTdHJpbmcoaXRlcmFibGUpKSBtb2RlID0gJ3N0cmluZyc7XG5cdGVsc2UgaXRlcmFibGUgPSBnZXQoaXRlcmFibGUpO1xuXG5cdGNhbGxhYmxlKGNiKTtcblx0ZG9CcmVhayA9IGZ1bmN0aW9uICgpIHsgYnJva2VuID0gdHJ1ZTsgfTtcblx0aWYgKG1vZGUgPT09ICdhcnJheScpIHtcblx0XHRpdGVyYWJsZS5zb21lKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCB2YWx1ZSwgZG9CcmVhayk7XG5cdFx0XHRpZiAoYnJva2VuKSByZXR1cm4gdHJ1ZTtcblx0XHR9KTtcblx0XHRyZXR1cm47XG5cdH1cblx0aWYgKG1vZGUgPT09ICdzdHJpbmcnKSB7XG5cdFx0bCA9IGl0ZXJhYmxlLmxlbmd0aDtcblx0XHRmb3IgKGkgPSAwOyBpIDwgbDsgKytpKSB7XG5cdFx0XHRjaGFyID0gaXRlcmFibGVbaV07XG5cdFx0XHRpZiAoKGkgKyAxKSA8IGwpIHtcblx0XHRcdFx0Y29kZSA9IGNoYXIuY2hhckNvZGVBdCgwKTtcblx0XHRcdFx0aWYgKChjb2RlID49IDB4RDgwMCkgJiYgKGNvZGUgPD0gMHhEQkZGKSkgY2hhciArPSBpdGVyYWJsZVsrK2ldO1xuXHRcdFx0fVxuXHRcdFx0Y2FsbC5jYWxsKGNiLCB0aGlzQXJnLCBjaGFyLCBkb0JyZWFrKTtcblx0XHRcdGlmIChicm9rZW4pIGJyZWFrO1xuXHRcdH1cblx0XHRyZXR1cm47XG5cdH1cblx0cmVzdWx0ID0gaXRlcmFibGUubmV4dCgpO1xuXG5cdHdoaWxlICghcmVzdWx0LmRvbmUpIHtcblx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHJlc3VsdC52YWx1ZSwgZG9CcmVhayk7XG5cdFx0aWYgKGJyb2tlbikgcmV0dXJuO1xuXHRcdHJlc3VsdCA9IGl0ZXJhYmxlLm5leHQoKTtcblx0fVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGlzU3RyaW5nID0gcmVxdWlyZSgnZXM1LWV4dC9zdHJpbmcvaXMtc3RyaW5nJylcbiAgLCBBcnJheUl0ZXJhdG9yICA9IHJlcXVpcmUoJy4vYXJyYXknKVxuICAsIFN0cmluZ0l0ZXJhdG9yID0gcmVxdWlyZSgnLi9zdHJpbmcnKVxuICAsIGl0ZXJhYmxlICAgICAgID0gcmVxdWlyZSgnLi92YWxpZC1pdGVyYWJsZScpXG4gICwgaXRlcmF0b3JTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykuaXRlcmF0b3I7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuXHRpZiAodHlwZW9mIGl0ZXJhYmxlKG9iailbaXRlcmF0b3JTeW1ib2xdID09PSAnZnVuY3Rpb24nKSByZXR1cm4gb2JqW2l0ZXJhdG9yU3ltYm9sXSgpO1xuXHRpZiAoaXNTdHJpbmcob2JqKSkgcmV0dXJuIG5ldyBTdHJpbmdJdGVyYXRvcihvYmopO1xuXHRyZXR1cm4gbmV3IEFycmF5SXRlcmF0b3Iob2JqKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGVhciAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9jbGVhcicpXG4gICwgYXNzaWduICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9hc3NpZ24nKVxuICAsIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIHZhbHVlICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuICAsIGQgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgYXV0b0JpbmQgPSByZXF1aXJlKCdkL2F1dG8tYmluZCcpXG4gICwgU3ltYm9sICAgPSByZXF1aXJlKCdlczYtc3ltYm9sJylcblxuICAsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgSXRlcmF0b3I7XG5cbm1vZHVsZS5leHBvcnRzID0gSXRlcmF0b3IgPSBmdW5jdGlvbiAobGlzdCwgY29udGV4dCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgSXRlcmF0b3IpKSByZXR1cm4gbmV3IEl0ZXJhdG9yKGxpc3QsIGNvbnRleHQpO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX2xpc3RfXzogZCgndycsIHZhbHVlKGxpc3QpKSxcblx0XHRfX2NvbnRleHRfXzogZCgndycsIGNvbnRleHQpLFxuXHRcdF9fbmV4dEluZGV4X186IGQoJ3cnLCAwKVxuXHR9KTtcblx0aWYgKCFjb250ZXh0KSByZXR1cm47XG5cdGNhbGxhYmxlKGNvbnRleHQub24pO1xuXHRjb250ZXh0Lm9uKCdfYWRkJywgdGhpcy5fb25BZGQpO1xuXHRjb250ZXh0Lm9uKCdfZGVsZXRlJywgdGhpcy5fb25EZWxldGUpO1xuXHRjb250ZXh0Lm9uKCdfY2xlYXInLCB0aGlzLl9vbkNsZWFyKTtcbn07XG5cbmRlZmluZVByb3BlcnRpZXMoSXRlcmF0b3IucHJvdG90eXBlLCBhc3NpZ24oe1xuXHRjb25zdHJ1Y3RvcjogZChJdGVyYXRvciksXG5cdF9uZXh0OiBkKGZ1bmN0aW9uICgpIHtcblx0XHR2YXIgaTtcblx0XHRpZiAoIXRoaXMuX19saXN0X18pIHJldHVybjtcblx0XHRpZiAodGhpcy5fX3JlZG9fXykge1xuXHRcdFx0aSA9IHRoaXMuX19yZWRvX18uc2hpZnQoKTtcblx0XHRcdGlmIChpICE9PSB1bmRlZmluZWQpIHJldHVybiBpO1xuXHRcdH1cblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fIDwgdGhpcy5fX2xpc3RfXy5sZW5ndGgpIHJldHVybiB0aGlzLl9fbmV4dEluZGV4X18rKztcblx0XHR0aGlzLl91bkJpbmQoKTtcblx0fSksXG5cdG5leHQ6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fY3JlYXRlUmVzdWx0KHRoaXMuX25leHQoKSk7IH0pLFxuXHRfY3JlYXRlUmVzdWx0OiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKGkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IHVuZGVmaW5lZCB9O1xuXHRcdHJldHVybiB7IGRvbmU6IGZhbHNlLCB2YWx1ZTogdGhpcy5fcmVzb2x2ZShpKSB9O1xuXHR9KSxcblx0X3Jlc29sdmU6IGQoZnVuY3Rpb24gKGkpIHsgcmV0dXJuIHRoaXMuX19saXN0X19baV07IH0pLFxuXHRfdW5CaW5kOiBkKGZ1bmN0aW9uICgpIHtcblx0XHR0aGlzLl9fbGlzdF9fID0gbnVsbDtcblx0XHRkZWxldGUgdGhpcy5fX3JlZG9fXztcblx0XHRpZiAoIXRoaXMuX19jb250ZXh0X18pIHJldHVybjtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2FkZCcsIHRoaXMuX29uQWRkKTtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2RlbGV0ZScsIHRoaXMuX29uRGVsZXRlKTtcblx0XHR0aGlzLl9fY29udGV4dF9fLm9mZignX2NsZWFyJywgdGhpcy5fb25DbGVhcik7XG5cdFx0dGhpcy5fX2NvbnRleHRfXyA9IG51bGw7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBJdGVyYXRvcl0nOyB9KVxufSwgYXV0b0JpbmQoe1xuXHRfb25BZGQ6IGQoZnVuY3Rpb24gKGluZGV4KSB7XG5cdFx0aWYgKGluZGV4ID49IHRoaXMuX19uZXh0SW5kZXhfXykgcmV0dXJuO1xuXHRcdCsrdGhpcy5fX25leHRJbmRleF9fO1xuXHRcdGlmICghdGhpcy5fX3JlZG9fXykge1xuXHRcdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fcmVkb19fJywgZCgnYycsIFtpbmRleF0pKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5fX3JlZG9fXy5mb3JFYWNoKGZ1bmN0aW9uIChyZWRvLCBpKSB7XG5cdFx0XHRpZiAocmVkbyA+PSBpbmRleCkgdGhpcy5fX3JlZG9fX1tpXSA9ICsrcmVkbztcblx0XHR9LCB0aGlzKTtcblx0XHR0aGlzLl9fcmVkb19fLnB1c2goaW5kZXgpO1xuXHR9KSxcblx0X29uRGVsZXRlOiBkKGZ1bmN0aW9uIChpbmRleCkge1xuXHRcdHZhciBpO1xuXHRcdGlmIChpbmRleCA+PSB0aGlzLl9fbmV4dEluZGV4X18pIHJldHVybjtcblx0XHQtLXRoaXMuX19uZXh0SW5kZXhfXztcblx0XHRpZiAoIXRoaXMuX19yZWRvX18pIHJldHVybjtcblx0XHRpID0gdGhpcy5fX3JlZG9fXy5pbmRleE9mKGluZGV4KTtcblx0XHRpZiAoaSAhPT0gLTEpIHRoaXMuX19yZWRvX18uc3BsaWNlKGksIDEpO1xuXHRcdHRoaXMuX19yZWRvX18uZm9yRWFjaChmdW5jdGlvbiAocmVkbywgaSkge1xuXHRcdFx0aWYgKHJlZG8gPiBpbmRleCkgdGhpcy5fX3JlZG9fX1tpXSA9IC0tcmVkbztcblx0XHR9LCB0aGlzKTtcblx0fSksXG5cdF9vbkNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAodGhpcy5fX3JlZG9fXykgY2xlYXIuY2FsbCh0aGlzLl9fcmVkb19fKTtcblx0XHR0aGlzLl9fbmV4dEluZGV4X18gPSAwO1xuXHR9KVxufSkpKTtcblxuZGVmaW5lUHJvcGVydHkoSXRlcmF0b3IucHJvdG90eXBlLCBTeW1ib2wuaXRlcmF0b3IsIGQoZnVuY3Rpb24gKCkge1xuXHRyZXR1cm4gdGhpcztcbn0pKTtcbmRlZmluZVByb3BlcnR5KEl0ZXJhdG9yLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCcnLCAnSXRlcmF0b3InKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N0cmluZyAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvc3RyaW5nL2lzLXN0cmluZycpXG4gICwgaXRlcmF0b3JTeW1ib2wgPSByZXF1aXJlKCdlczYtc3ltYm9sJykuaXRlcmF0b3JcblxuICAsIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuXHRpZiAoaXNBcnJheSh2YWx1ZSkpIHJldHVybiB0cnVlO1xuXHRpZiAoaXNTdHJpbmcodmFsdWUpKSByZXR1cm4gdHJ1ZTtcblx0cmV0dXJuICh0eXBlb2YgdmFsdWVbaXRlcmF0b3JTeW1ib2xdID09PSAnZnVuY3Rpb24nKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9pcy1pbXBsZW1lbnRlZCcpKCkgPyBTeW1ib2wgOiByZXF1aXJlKCcuL3BvbHlmaWxsJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodHlwZW9mIFN5bWJvbCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRzeW1ib2wgPSBTeW1ib2woJ3Rlc3Qgc3ltYm9sJyk7XG5cdHRyeSB7IFN0cmluZyhzeW1ib2wpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxuXHRpZiAodHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gJ3N5bWJvbCcpIHJldHVybiB0cnVlO1xuXG5cdC8vIFJldHVybiAndHJ1ZScgZm9yIHBvbHlmaWxsc1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc0NvbmNhdFNwcmVhZGFibGUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLml0ZXJhdG9yICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1ByaW1pdGl2ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudG9TdHJpbmdUYWcgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnVuc2NvcGFibGVzICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoeCkge1xuXHRyZXR1cm4gKHggJiYgKCh0eXBlb2YgeCA9PT0gJ3N5bWJvbCcpIHx8ICh4WydAQHRvU3RyaW5nVGFnJ10gPT09ICdTeW1ib2wnKSkpIHx8IGZhbHNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgdmFsaWRhdGVTeW1ib2wgPSByZXF1aXJlKCcuL3ZhbGlkYXRlLXN5bWJvbCcpXG5cbiAgLCBjcmVhdGUgPSBPYmplY3QuY3JlYXRlLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eSwgb2JqUHJvdG90eXBlID0gT2JqZWN0LnByb3RvdHlwZVxuICAsIFN5bWJvbCwgSGlkZGVuU3ltYm9sLCBnbG9iYWxTeW1ib2xzID0gY3JlYXRlKG51bGwpO1xuXG52YXIgZ2VuZXJhdGVOYW1lID0gKGZ1bmN0aW9uICgpIHtcblx0dmFyIGNyZWF0ZWQgPSBjcmVhdGUobnVsbCk7XG5cdHJldHVybiBmdW5jdGlvbiAoZGVzYykge1xuXHRcdHZhciBwb3N0Zml4ID0gMCwgbmFtZTtcblx0XHR3aGlsZSAoY3JlYXRlZFtkZXNjICsgKHBvc3RmaXggfHwgJycpXSkgKytwb3N0Zml4O1xuXHRcdGRlc2MgKz0gKHBvc3RmaXggfHwgJycpO1xuXHRcdGNyZWF0ZWRbZGVzY10gPSB0cnVlO1xuXHRcdG5hbWUgPSAnQEAnICsgZGVzYztcblx0XHRkZWZpbmVQcm9wZXJ0eShvYmpQcm90b3R5cGUsIG5hbWUsIGQuZ3MobnVsbCwgZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCBuYW1lLCBkKHZhbHVlKSk7XG5cdFx0fSkpO1xuXHRcdHJldHVybiBuYW1lO1xuXHR9O1xufSgpKTtcblxuSGlkZGVuU3ltYm9sID0gZnVuY3Rpb24gU3ltYm9sKGRlc2NyaXB0aW9uKSB7XG5cdGlmICh0aGlzIGluc3RhbmNlb2YgSGlkZGVuU3ltYm9sKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdUeXBlRXJyb3I6IFN5bWJvbCBpcyBub3QgYSBjb25zdHJ1Y3RvcicpO1xuXHRyZXR1cm4gU3ltYm9sKGRlc2NyaXB0aW9uKTtcbn07XG5tb2R1bGUuZXhwb3J0cyA9IFN5bWJvbCA9IGZ1bmN0aW9uIFN5bWJvbChkZXNjcmlwdGlvbikge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIFN5bWJvbCkgdGhyb3cgbmV3IFR5cGVFcnJvcignVHlwZUVycm9yOiBTeW1ib2wgaXMgbm90IGEgY29uc3RydWN0b3InKTtcblx0c3ltYm9sID0gY3JlYXRlKEhpZGRlblN5bWJvbC5wcm90b3R5cGUpO1xuXHRkZXNjcmlwdGlvbiA9IChkZXNjcmlwdGlvbiA9PT0gdW5kZWZpbmVkID8gJycgOiBTdHJpbmcoZGVzY3JpcHRpb24pKTtcblx0cmV0dXJuIGRlZmluZVByb3BlcnRpZXMoc3ltYm9sLCB7XG5cdFx0X19kZXNjcmlwdGlvbl9fOiBkKCcnLCBkZXNjcmlwdGlvbiksXG5cdFx0X19uYW1lX186IGQoJycsIGdlbmVyYXRlTmFtZShkZXNjcmlwdGlvbikpXG5cdH0pO1xufTtcbmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLCB7XG5cdGZvcjogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0aWYgKGdsb2JhbFN5bWJvbHNba2V5XSkgcmV0dXJuIGdsb2JhbFN5bWJvbHNba2V5XTtcblx0XHRyZXR1cm4gKGdsb2JhbFN5bWJvbHNba2V5XSA9IFN5bWJvbChTdHJpbmcoa2V5KSkpO1xuXHR9KSxcblx0a2V5Rm9yOiBkKGZ1bmN0aW9uIChzKSB7XG5cdFx0dmFyIGtleTtcblx0XHR2YWxpZGF0ZVN5bWJvbChzKTtcblx0XHRmb3IgKGtleSBpbiBnbG9iYWxTeW1ib2xzKSBpZiAoZ2xvYmFsU3ltYm9sc1trZXldID09PSBzKSByZXR1cm4ga2V5O1xuXHR9KSxcblx0aGFzSW5zdGFuY2U6IGQoJycsIFN5bWJvbCgnaGFzSW5zdGFuY2UnKSksXG5cdGlzQ29uY2F0U3ByZWFkYWJsZTogZCgnJywgU3ltYm9sKCdpc0NvbmNhdFNwcmVhZGFibGUnKSksXG5cdGl0ZXJhdG9yOiBkKCcnLCBTeW1ib2woJ2l0ZXJhdG9yJykpLFxuXHRtYXRjaDogZCgnJywgU3ltYm9sKCdtYXRjaCcpKSxcblx0cmVwbGFjZTogZCgnJywgU3ltYm9sKCdyZXBsYWNlJykpLFxuXHRzZWFyY2g6IGQoJycsIFN5bWJvbCgnc2VhcmNoJykpLFxuXHRzcGVjaWVzOiBkKCcnLCBTeW1ib2woJ3NwZWNpZXMnKSksXG5cdHNwbGl0OiBkKCcnLCBTeW1ib2woJ3NwbGl0JykpLFxuXHR0b1ByaW1pdGl2ZTogZCgnJywgU3ltYm9sKCd0b1ByaW1pdGl2ZScpKSxcblx0dG9TdHJpbmdUYWc6IGQoJycsIFN5bWJvbCgndG9TdHJpbmdUYWcnKSksXG5cdHVuc2NvcGFibGVzOiBkKCcnLCBTeW1ib2woJ3Vuc2NvcGFibGVzJykpXG59KTtcbmRlZmluZVByb3BlcnRpZXMoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTeW1ib2wpLFxuXHR0b1N0cmluZzogZCgnJywgZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX25hbWVfXzsgfSlcbn0pO1xuXG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbC5wcm90b3R5cGUsIHtcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1N5bWJvbCAoJyArIHZhbGlkYXRlU3ltYm9sKHRoaXMpLl9fZGVzY3JpcHRpb25fXyArICcpJzsgfSksXG5cdHZhbHVlT2Y6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gdmFsaWRhdGVTeW1ib2wodGhpcyk7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSwgZCgnJyxcblx0ZnVuY3Rpb24gKCkgeyByZXR1cm4gdmFsaWRhdGVTeW1ib2wodGhpcyk7IH0pKTtcbmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdTeW1ib2wnKSk7XG5cbmRlZmluZVByb3BlcnR5KEhpZGRlblN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSxcblx0ZCgnYycsIFN5bWJvbC5wcm90b3R5cGVbU3ltYm9sLnRvUHJpbWl0aXZlXSkpO1xuZGVmaW5lUHJvcGVydHkoSGlkZGVuU3ltYm9sLnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLFxuXHRkKCdjJywgU3ltYm9sLnByb3RvdHlwZVtTeW1ib2wudG9TdHJpbmdUYWddKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc1N5bWJvbCA9IHJlcXVpcmUoJy4vaXMtc3ltYm9sJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNTeW1ib2wodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGEgc3ltYm9sXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiLy8gVGhhbmtzIEBtYXRoaWFzYnluZW5zXG4vLyBodHRwOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LXVuaWNvZGUjaXRlcmF0aW5nLW92ZXItc3ltYm9sc1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgSXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCcuLycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFN0cmluZ0l0ZXJhdG9yO1xuXG5TdHJpbmdJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHN0cikge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgU3RyaW5nSXRlcmF0b3IpKSByZXR1cm4gbmV3IFN0cmluZ0l0ZXJhdG9yKHN0cik7XG5cdHN0ciA9IFN0cmluZyhzdHIpO1xuXHRJdGVyYXRvci5jYWxsKHRoaXMsIHN0cik7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX2xlbmd0aF9fJywgZCgnJywgc3RyLmxlbmd0aCkpO1xuXG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTdHJpbmdJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5TdHJpbmdJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChTdHJpbmdJdGVyYXRvciksXG5cdF9uZXh0OiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19saXN0X18pIHJldHVybjtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fIDwgdGhpcy5fX2xlbmd0aF9fKSByZXR1cm4gdGhpcy5fX25leHRJbmRleF9fKys7XG5cdFx0dGhpcy5fdW5CaW5kKCk7XG5cdH0pLFxuXHRfcmVzb2x2ZTogZChmdW5jdGlvbiAoaSkge1xuXHRcdHZhciBjaGFyID0gdGhpcy5fX2xpc3RfX1tpXSwgY29kZTtcblx0XHRpZiAodGhpcy5fX25leHRJbmRleF9fID09PSB0aGlzLl9fbGVuZ3RoX18pIHJldHVybiBjaGFyO1xuXHRcdGNvZGUgPSBjaGFyLmNoYXJDb2RlQXQoMCk7XG5cdFx0aWYgKChjb2RlID49IDB4RDgwMCkgJiYgKGNvZGUgPD0gMHhEQkZGKSkgcmV0dXJuIGNoYXIgKyB0aGlzLl9fbGlzdF9fW3RoaXMuX19uZXh0SW5kZXhfXysrXTtcblx0XHRyZXR1cm4gY2hhcjtcblx0fSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFN0cmluZyBJdGVyYXRvcl0nOyB9KVxufSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc0l0ZXJhYmxlID0gcmVxdWlyZSgnLi9pcy1pdGVyYWJsZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRpZiAoIWlzSXRlcmFibGUodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGl0ZXJhYmxlXCIpO1xuXHRyZXR1cm4gdmFsdWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIHN5bWJvbDtcblx0aWYgKHR5cGVvZiBTeW1ib2wgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0c3ltYm9sID0gU3ltYm9sKCd0ZXN0IHN5bWJvbCcpO1xuXHR0cnkgeyBTdHJpbmcoc3ltYm9sKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgPT09ICdzeW1ib2wnKSByZXR1cm4gdHJ1ZTtcblxuXHQvLyBSZXR1cm4gJ3RydWUnIGZvciBwb2x5ZmlsbHNcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXNDb25jYXRTcHJlYWRhYmxlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC5pc1JlZ0V4cCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wuaXRlcmF0b3IgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgU3ltYm9sLnRvUHJpbWl0aXZlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIFN5bWJvbC50b1N0cmluZ1RhZyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBTeW1ib2wudW5zY29wYWJsZXMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cblx0cmV0dXJuIHRydWU7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZCA9IHJlcXVpcmUoJ2QnKVxuXG4gICwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgZ2VuZXJhdGVOYW1lLCBTeW1ib2w7XG5cbmdlbmVyYXRlTmFtZSA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBjcmVhdGVkID0gY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKGRlc2MpIHtcblx0XHR2YXIgcG9zdGZpeCA9IDA7XG5cdFx0d2hpbGUgKGNyZWF0ZWRbZGVzYyArIChwb3N0Zml4IHx8ICcnKV0pICsrcG9zdGZpeDtcblx0XHRkZXNjICs9IChwb3N0Zml4IHx8ICcnKTtcblx0XHRjcmVhdGVkW2Rlc2NdID0gdHJ1ZTtcblx0XHRyZXR1cm4gJ0BAJyArIGRlc2M7XG5cdH07XG59KCkpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bWJvbCA9IGZ1bmN0aW9uIChkZXNjcmlwdGlvbikge1xuXHR2YXIgc3ltYm9sO1xuXHRpZiAodGhpcyBpbnN0YW5jZW9mIFN5bWJvbCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ1R5cGVFcnJvcjogU3ltYm9sIGlzIG5vdCBhIGNvbnN0cnVjdG9yJyk7XG5cdH1cblx0c3ltYm9sID0gY3JlYXRlKFN5bWJvbC5wcm90b3R5cGUpO1xuXHRkZXNjcmlwdGlvbiA9IChkZXNjcmlwdGlvbiA9PT0gdW5kZWZpbmVkID8gJycgOiBTdHJpbmcoZGVzY3JpcHRpb24pKTtcblx0cmV0dXJuIGRlZmluZVByb3BlcnRpZXMoc3ltYm9sLCB7XG5cdFx0X19kZXNjcmlwdGlvbl9fOiBkKCcnLCBkZXNjcmlwdGlvbiksXG5cdFx0X19uYW1lX186IGQoJycsIGdlbmVyYXRlTmFtZShkZXNjcmlwdGlvbikpXG5cdH0pO1xufTtcblxuT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoU3ltYm9sLCB7XG5cdGNyZWF0ZTogZCgnJywgU3ltYm9sKCdjcmVhdGUnKSksXG5cdGhhc0luc3RhbmNlOiBkKCcnLCBTeW1ib2woJ2hhc0luc3RhbmNlJykpLFxuXHRpc0NvbmNhdFNwcmVhZGFibGU6IGQoJycsIFN5bWJvbCgnaXNDb25jYXRTcHJlYWRhYmxlJykpLFxuXHRpc1JlZ0V4cDogZCgnJywgU3ltYm9sKCdpc1JlZ0V4cCcpKSxcblx0aXRlcmF0b3I6IGQoJycsIFN5bWJvbCgnaXRlcmF0b3InKSksXG5cdHRvUHJpbWl0aXZlOiBkKCcnLCBTeW1ib2woJ3RvUHJpbWl0aXZlJykpLFxuXHR0b1N0cmluZ1RhZzogZCgnJywgU3ltYm9sKCd0b1N0cmluZ1RhZycpKSxcblx0dW5zY29wYWJsZXM6IGQoJycsIFN5bWJvbCgndW5zY29wYWJsZXMnKSlcbn0pO1xuXG5kZWZpbmVQcm9wZXJ0aWVzKFN5bWJvbC5wcm90b3R5cGUsIHtcblx0cHJvcGVyVG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkge1xuXHRcdHJldHVybiAnU3ltYm9sICgnICsgdGhpcy5fX2Rlc2NyaXB0aW9uX18gKyAnKSc7XG5cdH0pLFxuXHR0b1N0cmluZzogZCgnJywgZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5fX25hbWVfXzsgfSlcbn0pO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1ByaW1pdGl2ZSwgZCgnJyxcblx0ZnVuY3Rpb24gKGhpbnQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ29udmVyc2lvbiBvZiBzeW1ib2wgb2JqZWN0cyBpcyBub3QgYWxsb3dlZFwiKTtcblx0fSkpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KFN5bWJvbC5wcm90b3R5cGUsIFN5bWJvbC50b1N0cmluZ1RhZywgZCgnYycsICdTeW1ib2wnKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBkICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGNhbGxhYmxlID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuXG4gICwgYXBwbHkgPSBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHksIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbFxuICAsIGNyZWF0ZSA9IE9iamVjdC5jcmVhdGUsIGRlZmluZVByb3BlcnR5ID0gT2JqZWN0LmRlZmluZVByb3BlcnR5XG4gICwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZGVzY3JpcHRvciA9IHsgY29uZmlndXJhYmxlOiB0cnVlLCBlbnVtZXJhYmxlOiBmYWxzZSwgd3JpdGFibGU6IHRydWUgfVxuXG4gICwgb24sIG9uY2UsIG9mZiwgZW1pdCwgbWV0aG9kcywgZGVzY3JpcHRvcnMsIGJhc2U7XG5cbm9uID0gZnVuY3Rpb24gKHR5cGUsIGxpc3RlbmVyKSB7XG5cdHZhciBkYXRhO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSB7XG5cdFx0ZGF0YSA9IGRlc2NyaXB0b3IudmFsdWUgPSBjcmVhdGUobnVsbCk7XG5cdFx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fZWVfXycsIGRlc2NyaXB0b3IpO1xuXHRcdGRlc2NyaXB0b3IudmFsdWUgPSBudWxsO1xuXHR9IGVsc2Uge1xuXHRcdGRhdGEgPSB0aGlzLl9fZWVfXztcblx0fVxuXHRpZiAoIWRhdGFbdHlwZV0pIGRhdGFbdHlwZV0gPSBsaXN0ZW5lcjtcblx0ZWxzZSBpZiAodHlwZW9mIGRhdGFbdHlwZV0gPT09ICdvYmplY3QnKSBkYXRhW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuXHRlbHNlIGRhdGFbdHlwZV0gPSBbZGF0YVt0eXBlXSwgbGlzdGVuZXJdO1xuXG5cdHJldHVybiB0aGlzO1xufTtcblxub25jZSA9IGZ1bmN0aW9uICh0eXBlLCBsaXN0ZW5lcikge1xuXHR2YXIgb25jZSwgc2VsZjtcblxuXHRjYWxsYWJsZShsaXN0ZW5lcik7XG5cdHNlbGYgPSB0aGlzO1xuXHRvbi5jYWxsKHRoaXMsIHR5cGUsIG9uY2UgPSBmdW5jdGlvbiAoKSB7XG5cdFx0b2ZmLmNhbGwoc2VsZiwgdHlwZSwgb25jZSk7XG5cdFx0YXBwbHkuY2FsbChsaXN0ZW5lciwgdGhpcywgYXJndW1lbnRzKTtcblx0fSk7XG5cblx0b25jZS5fX2VlT25jZUxpc3RlbmVyX18gPSBsaXN0ZW5lcjtcblx0cmV0dXJuIHRoaXM7XG59O1xuXG5vZmYgPSBmdW5jdGlvbiAodHlwZSwgbGlzdGVuZXIpIHtcblx0dmFyIGRhdGEsIGxpc3RlbmVycywgY2FuZGlkYXRlLCBpO1xuXG5cdGNhbGxhYmxlKGxpc3RlbmVyKTtcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSByZXR1cm4gdGhpcztcblx0ZGF0YSA9IHRoaXMuX19lZV9fO1xuXHRpZiAoIWRhdGFbdHlwZV0pIHJldHVybiB0aGlzO1xuXHRsaXN0ZW5lcnMgPSBkYXRhW3R5cGVdO1xuXG5cdGlmICh0eXBlb2YgbGlzdGVuZXJzID09PSAnb2JqZWN0Jykge1xuXHRcdGZvciAoaSA9IDA7IChjYW5kaWRhdGUgPSBsaXN0ZW5lcnNbaV0pOyArK2kpIHtcblx0XHRcdGlmICgoY2FuZGlkYXRlID09PSBsaXN0ZW5lcikgfHxcblx0XHRcdFx0XHQoY2FuZGlkYXRlLl9fZWVPbmNlTGlzdGVuZXJfXyA9PT0gbGlzdGVuZXIpKSB7XG5cdFx0XHRcdGlmIChsaXN0ZW5lcnMubGVuZ3RoID09PSAyKSBkYXRhW3R5cGVdID0gbGlzdGVuZXJzW2kgPyAwIDogMV07XG5cdFx0XHRcdGVsc2UgbGlzdGVuZXJzLnNwbGljZShpLCAxKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0aWYgKChsaXN0ZW5lcnMgPT09IGxpc3RlbmVyKSB8fFxuXHRcdFx0XHQobGlzdGVuZXJzLl9fZWVPbmNlTGlzdGVuZXJfXyA9PT0gbGlzdGVuZXIpKSB7XG5cdFx0XHRkZWxldGUgZGF0YVt0eXBlXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdGhpcztcbn07XG5cbmVtaXQgPSBmdW5jdGlvbiAodHlwZSkge1xuXHR2YXIgaSwgbCwgbGlzdGVuZXIsIGxpc3RlbmVycywgYXJncztcblxuXHRpZiAoIWhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19fZWVfXycpKSByZXR1cm47XG5cdGxpc3RlbmVycyA9IHRoaXMuX19lZV9fW3R5cGVdO1xuXHRpZiAoIWxpc3RlbmVycykgcmV0dXJuO1xuXG5cdGlmICh0eXBlb2YgbGlzdGVuZXJzID09PSAnb2JqZWN0Jykge1xuXHRcdGwgPSBhcmd1bWVudHMubGVuZ3RoO1xuXHRcdGFyZ3MgPSBuZXcgQXJyYXkobCAtIDEpO1xuXHRcdGZvciAoaSA9IDE7IGkgPCBsOyArK2kpIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXG5cdFx0bGlzdGVuZXJzID0gbGlzdGVuZXJzLnNsaWNlKCk7XG5cdFx0Zm9yIChpID0gMDsgKGxpc3RlbmVyID0gbGlzdGVuZXJzW2ldKTsgKytpKSB7XG5cdFx0XHRhcHBseS5jYWxsKGxpc3RlbmVyLCB0aGlzLCBhcmdzKTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0c3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG5cdFx0Y2FzZSAxOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcyk7XG5cdFx0XHRicmVhaztcblx0XHRjYXNlIDI6XG5cdFx0XHRjYWxsLmNhbGwobGlzdGVuZXJzLCB0aGlzLCBhcmd1bWVudHNbMV0pO1xuXHRcdFx0YnJlYWs7XG5cdFx0Y2FzZSAzOlxuXHRcdFx0Y2FsbC5jYWxsKGxpc3RlbmVycywgdGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuXHRcdFx0YnJlYWs7XG5cdFx0ZGVmYXVsdDpcblx0XHRcdGwgPSBhcmd1bWVudHMubGVuZ3RoO1xuXHRcdFx0YXJncyA9IG5ldyBBcnJheShsIC0gMSk7XG5cdFx0XHRmb3IgKGkgPSAxOyBpIDwgbDsgKytpKSB7XG5cdFx0XHRcdGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXHRcdFx0fVxuXHRcdFx0YXBwbHkuY2FsbChsaXN0ZW5lcnMsIHRoaXMsIGFyZ3MpO1xuXHRcdH1cblx0fVxufTtcblxubWV0aG9kcyA9IHtcblx0b246IG9uLFxuXHRvbmNlOiBvbmNlLFxuXHRvZmY6IG9mZixcblx0ZW1pdDogZW1pdFxufTtcblxuZGVzY3JpcHRvcnMgPSB7XG5cdG9uOiBkKG9uKSxcblx0b25jZTogZChvbmNlKSxcblx0b2ZmOiBkKG9mZiksXG5cdGVtaXQ6IGQoZW1pdClcbn07XG5cbmJhc2UgPSBkZWZpbmVQcm9wZXJ0aWVzKHt9LCBkZXNjcmlwdG9ycyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IGZ1bmN0aW9uIChvKSB7XG5cdHJldHVybiAobyA9PSBudWxsKSA/IGNyZWF0ZShiYXNlKSA6IGRlZmluZVByb3BlcnRpZXMoT2JqZWN0KG8pLCBkZXNjcmlwdG9ycyk7XG59O1xuZXhwb3J0cy5tZXRob2RzID0gbWV0aG9kcztcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsZWFyICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9hcnJheS8jL2NsZWFyJylcbiAgLCBlSW5kZXhPZiAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9lLWluZGV4LW9mJylcbiAgLCBzZXRQcm90b3R5cGVPZiA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3NldC1wcm90b3R5cGUtb2YnKVxuICAsIGNhbGxhYmxlICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtY2FsbGFibGUnKVxuICAsIGQgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgZWUgICAgICAgICAgICAgPSByZXF1aXJlKCdldmVudC1lbWl0dGVyJylcbiAgLCBTeW1ib2wgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKVxuICAsIGl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yL3ZhbGlkLWl0ZXJhYmxlJylcbiAgLCBmb3JPZiAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci9mb3Itb2YnKVxuICAsIEl0ZXJhdG9yICAgICAgID0gcmVxdWlyZSgnLi9saWIvaXRlcmF0b3InKVxuICAsIGlzTmF0aXZlICAgICAgID0gcmVxdWlyZSgnLi9pcy1uYXRpdmUtaW1wbGVtZW50ZWQnKVxuXG4gICwgY2FsbCA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLCBkZWZpbmVQcm9wZXJ0eSA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eVxuICAsIFNldFBvbHksIGdldFZhbHVlcztcblxubW9kdWxlLmV4cG9ydHMgPSBTZXRQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF07XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBTZXRQb2x5KSkgcmV0dXJuIG5ldyBTZXRQb2x5KGl0ZXJhYmxlKTtcblx0aWYgKHRoaXMuX19zZXREYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSBpdGVyYXRvcihpdGVyYWJsZSk7XG5cdGRlZmluZVByb3BlcnR5KHRoaXMsICdfX3NldERhdGFfXycsIGQoJ2MnLCBbXSkpO1xuXHRpZiAoIWl0ZXJhYmxlKSByZXR1cm47XG5cdGZvck9mKGl0ZXJhYmxlLCBmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRpZiAoZUluZGV4T2YuY2FsbCh0aGlzLCB2YWx1ZSkgIT09IC0xKSByZXR1cm47XG5cdFx0dGhpcy5wdXNoKHZhbHVlKTtcblx0fSwgdGhpcy5fX3NldERhdGFfXyk7XG59O1xuXG5pZiAoaXNOYXRpdmUpIHtcblx0aWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihTZXRQb2x5LCBTZXQpO1xuXHRTZXRQb2x5LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoU2V0LnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKFNldFBvbHkpXG5cdH0pO1xufVxuXG5lZShPYmplY3QuZGVmaW5lUHJvcGVydGllcyhTZXRQb2x5LnByb3RvdHlwZSwge1xuXHRhZGQ6IGQoZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0aWYgKHRoaXMuaGFzKHZhbHVlKSkgcmV0dXJuIHRoaXM7XG5cdFx0dGhpcy5lbWl0KCdfYWRkJywgdGhpcy5fX3NldERhdGFfXy5wdXNoKHZhbHVlKSAtIDEsIHZhbHVlKTtcblx0XHRyZXR1cm4gdGhpcztcblx0fSksXG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIXRoaXMuX19zZXREYXRhX18ubGVuZ3RoKSByZXR1cm47XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fc2V0RGF0YV9fKTtcblx0XHR0aGlzLmVtaXQoJ19jbGVhcicpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX3NldERhdGFfXywgdmFsdWUpO1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHJldHVybiBmYWxzZTtcblx0XHR0aGlzLl9fc2V0RGF0YV9fLnNwbGljZShpbmRleCwgMSk7XG5cdFx0dGhpcy5lbWl0KCdfZGVsZXRlJywgaW5kZXgsIHZhbHVlKTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSksXG5cdGVudHJpZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXkrdmFsdWUnKTsgfSksXG5cdGZvckVhY2g6IGQoZnVuY3Rpb24gKGNiLyosIHRoaXNBcmcqLykge1xuXHRcdHZhciB0aGlzQXJnID0gYXJndW1lbnRzWzFdLCBpdGVyYXRvciwgcmVzdWx0LCB2YWx1ZTtcblx0XHRjYWxsYWJsZShjYik7XG5cdFx0aXRlcmF0b3IgPSB0aGlzLnZhbHVlcygpO1xuXHRcdHJlc3VsdCA9IGl0ZXJhdG9yLl9uZXh0KCk7XG5cdFx0d2hpbGUgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHR2YWx1ZSA9IGl0ZXJhdG9yLl9yZXNvbHZlKHJlc3VsdCk7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHZhbHVlLCB2YWx1ZSwgdGhpcyk7XG5cdFx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdH1cblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRyZXR1cm4gKGVJbmRleE9mLmNhbGwodGhpcy5fX3NldERhdGFfXywgdmFsdWUpICE9PSAtMSk7XG5cdH0pLFxuXHRrZXlzOiBkKGdldFZhbHVlcyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMudmFsdWVzKCk7IH0pLFxuXHRzaXplOiBkLmdzKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuX19zZXREYXRhX18ubGVuZ3RoOyB9KSxcblx0dmFsdWVzOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzKTsgfSksXG5cdHRvU3RyaW5nOiBkKGZ1bmN0aW9uICgpIHsgcmV0dXJuICdbb2JqZWN0IFNldF0nOyB9KVxufSkpO1xuZGVmaW5lUHJvcGVydHkoU2V0UG9seS5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChnZXRWYWx1ZXMpKTtcbmRlZmluZVByb3BlcnR5KFNldFBvbHkucHJvdG90eXBlLCBTeW1ib2wudG9TdHJpbmdUYWcsIGQoJ2MnLCAnU2V0JykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vaXMtaW1wbGVtZW50ZWQnKSgpID8gTWFwIDogcmVxdWlyZSgnLi9wb2x5ZmlsbCcpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uICgpIHtcblx0dmFyIG1hcCwgaXRlcmF0b3IsIHJlc3VsdDtcblx0aWYgKHR5cGVvZiBNYXAgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0dHJ5IHtcblx0XHQvLyBXZWJLaXQgZG9lc24ndCBzdXBwb3J0IGFyZ3VtZW50cyBhbmQgY3Jhc2hlc1xuXHRcdG1hcCA9IG5ldyBNYXAoW1sncmF6JywgJ29uZSddLCBbJ2R3YScsICd0d28nXSwgWyd0cnp5JywgJ3RocmVlJ11dKTtcblx0fSBjYXRjaCAoZSkge1xuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXHRpZiAobWFwLnNpemUgIT09IDMpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuY2xlYXIgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZGVsZXRlICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmVudHJpZXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRpZiAodHlwZW9mIG1hcC5nZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuaGFzICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmtleXMgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuc2V0ICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLnZhbHVlcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG5cdGl0ZXJhdG9yID0gbWFwLmVudHJpZXMoKTtcblx0cmVzdWx0ID0gaXRlcmF0b3IubmV4dCgpO1xuXHRpZiAocmVzdWx0LmRvbmUgIT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG5cdGlmICghcmVzdWx0LnZhbHVlKSByZXR1cm4gZmFsc2U7XG5cdGlmIChyZXN1bHQudmFsdWVbMF0gIT09ICdyYXonKSByZXR1cm4gZmFsc2U7XG5cdGlmIChyZXN1bHQudmFsdWVbMV0gIT09ICdvbmUnKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiB0cnVlO1xufTtcbiIsIi8vIEV4cG9ydHMgdHJ1ZSBpZiBlbnZpcm9ubWVudCBwcm92aWRlcyBuYXRpdmUgYE1hcGAgaW1wbGVtZW50YXRpb24sXG4vLyB3aGF0ZXZlciB0aGF0IGlzLlxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblx0aWYgKHR5cGVvZiBNYXAgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gZmFsc2U7XG5cdHJldHVybiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKE1hcC5wcm90b3R5cGUpID09PSAnW29iamVjdCBNYXBdJyk7XG59KCkpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ByaW1pdGl2ZS1zZXQnKSgna2V5Jyxcblx0J3ZhbHVlJywgJ2tleSt2YWx1ZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgc2V0UHJvdG90eXBlT2YgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBkICAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIEl0ZXJhdG9yICAgICAgICAgID0gcmVxdWlyZSgnZXM2LWl0ZXJhdG9yJylcbiAgLCB0b1N0cmluZ1RhZ1N5bWJvbCA9IHJlcXVpcmUoJ2VzNi1zeW1ib2wnKS50b1N0cmluZ1RhZ1xuICAsIGtpbmRzICAgICAgICAgICAgID0gcmVxdWlyZSgnLi9pdGVyYXRvci1raW5kcycpXG5cbiAgLCBkZWZpbmVQcm9wZXJ0aWVzID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXNcbiAgLCB1bkJpbmQgPSBJdGVyYXRvci5wcm90b3R5cGUuX3VuQmluZFxuICAsIE1hcEl0ZXJhdG9yO1xuXG5NYXBJdGVyYXRvciA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG1hcCwga2luZCkge1xuXHRpZiAoISh0aGlzIGluc3RhbmNlb2YgTWFwSXRlcmF0b3IpKSByZXR1cm4gbmV3IE1hcEl0ZXJhdG9yKG1hcCwga2luZCk7XG5cdEl0ZXJhdG9yLmNhbGwodGhpcywgbWFwLl9fbWFwS2V5c0RhdGFfXywgbWFwKTtcblx0aWYgKCFraW5kIHx8ICFraW5kc1traW5kXSkga2luZCA9ICdrZXkrdmFsdWUnO1xuXHRkZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcblx0XHRfX2tpbmRfXzogZCgnJywga2luZCksXG5cdFx0X192YWx1ZXNfXzogZCgndycsIG1hcC5fX21hcFZhbHVlc0RhdGFfXylcblx0fSk7XG59O1xuaWYgKHNldFByb3RvdHlwZU9mKSBzZXRQcm90b3R5cGVPZihNYXBJdGVyYXRvciwgSXRlcmF0b3IpO1xuXG5NYXBJdGVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yLnByb3RvdHlwZSwge1xuXHRjb25zdHJ1Y3RvcjogZChNYXBJdGVyYXRvciksXG5cdF9yZXNvbHZlOiBkKGZ1bmN0aW9uIChpKSB7XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICd2YWx1ZScpIHJldHVybiB0aGlzLl9fdmFsdWVzX19baV07XG5cdFx0aWYgKHRoaXMuX19raW5kX18gPT09ICdrZXknKSByZXR1cm4gdGhpcy5fX2xpc3RfX1tpXTtcblx0XHRyZXR1cm4gW3RoaXMuX19saXN0X19baV0sIHRoaXMuX192YWx1ZXNfX1tpXV07XG5cdH0pLFxuXHRfdW5CaW5kOiBkKGZ1bmN0aW9uICgpIHtcblx0XHR0aGlzLl9fdmFsdWVzX18gPSBudWxsO1xuXHRcdHVuQmluZC5jYWxsKHRoaXMpO1xuXHR9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgTWFwIEl0ZXJhdG9yXSc7IH0pXG59KTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShNYXBJdGVyYXRvci5wcm90b3R5cGUsIHRvU3RyaW5nVGFnU3ltYm9sLFxuXHRkKCdjJywgJ01hcCBJdGVyYXRvcicpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCwgY3JlYXRlID0gT2JqZWN0LmNyZWF0ZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXJnLyosIOKApmFyZ3MqLykge1xuXHR2YXIgc2V0ID0gY3JlYXRlKG51bGwpO1xuXHRmb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbiAobmFtZSkgeyBzZXRbbmFtZV0gPSB0cnVlOyB9KTtcblx0cmV0dXJuIHNldDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGVhciAgICAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvYXJyYXkvIy9jbGVhcicpXG4gICwgZUluZGV4T2YgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L2FycmF5LyMvZS1pbmRleC1vZicpXG4gICwgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC9zZXQtcHJvdG90eXBlLW9mJylcbiAgLCBjYWxsYWJsZSAgICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLWNhbGxhYmxlJylcbiAgLCB2YWxpZFZhbHVlICAgICA9IHJlcXVpcmUoJ2VzNS1leHQvb2JqZWN0L3ZhbGlkLXZhbHVlJylcbiAgLCBkICAgICAgICAgICAgICA9IHJlcXVpcmUoJ2QnKVxuICAsIGVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXZlbnQtZW1pdHRlcicpXG4gICwgU3ltYm9sICAgICAgICAgPSByZXF1aXJlKCdlczYtc3ltYm9sJylcbiAgLCBpdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci92YWxpZC1pdGVyYWJsZScpXG4gICwgZm9yT2YgICAgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZm9yLW9mJylcbiAgLCBJdGVyYXRvciAgICAgICA9IHJlcXVpcmUoJy4vbGliL2l0ZXJhdG9yJylcbiAgLCBpc05hdGl2ZSAgICAgICA9IHJlcXVpcmUoJy4vaXMtbmF0aXZlLWltcGxlbWVudGVkJylcblxuICAsIGNhbGwgPSBGdW5jdGlvbi5wcm90b3R5cGUuY2FsbCwgZGVmaW5lUHJvcGVydGllcyA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzXG4gICwgTWFwUG9seTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYXBQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF0sIGtleXMsIHZhbHVlcztcblx0aWYgKCEodGhpcyBpbnN0YW5jZW9mIE1hcFBvbHkpKSByZXR1cm4gbmV3IE1hcFBvbHkoaXRlcmFibGUpO1xuXHRpZiAodGhpcy5fX21hcEtleXNEYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSBpdGVyYXRvcihpdGVyYWJsZSk7XG5cdGRlZmluZVByb3BlcnRpZXModGhpcywge1xuXHRcdF9fbWFwS2V5c0RhdGFfXzogZCgnYycsIGtleXMgPSBbXSksXG5cdFx0X19tYXBWYWx1ZXNEYXRhX186IGQoJ2MnLCB2YWx1ZXMgPSBbXSlcblx0fSk7XG5cdGlmICghaXRlcmFibGUpIHJldHVybjtcblx0Zm9yT2YoaXRlcmFibGUsIGZ1bmN0aW9uICh2YWx1ZSkge1xuXHRcdHZhciBrZXkgPSB2YWxpZFZhbHVlKHZhbHVlKVswXTtcblx0XHR2YWx1ZSA9IHZhbHVlWzFdO1xuXHRcdGlmIChlSW5kZXhPZi5jYWxsKGtleXMsIGtleSkgIT09IC0xKSByZXR1cm47XG5cdFx0a2V5cy5wdXNoKGtleSk7XG5cdFx0dmFsdWVzLnB1c2godmFsdWUpO1xuXHR9LCB0aGlzKTtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKE1hcFBvbHksIE1hcCk7XG5cdE1hcFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShNYXAucHJvdG90eXBlLCB7XG5cdFx0Y29uc3RydWN0b3I6IGQoTWFwUG9seSlcblx0fSk7XG59XG5cbmVlKGRlZmluZVByb3BlcnRpZXMoTWFwUG9seS5wcm90b3R5cGUsIHtcblx0Y2xlYXI6IGQoZnVuY3Rpb24gKCkge1xuXHRcdGlmICghdGhpcy5fX21hcEtleXNEYXRhX18ubGVuZ3RoKSByZXR1cm47XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXyk7XG5cdFx0Y2xlYXIuY2FsbCh0aGlzLl9fbWFwVmFsdWVzRGF0YV9fKTtcblx0XHR0aGlzLmVtaXQoJ19jbGVhcicpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHR2YXIgaW5kZXggPSBlSW5kZXhPZi5jYWxsKHRoaXMuX19tYXBLZXlzRGF0YV9fLCBrZXkpO1xuXHRcdGlmIChpbmRleCA9PT0gLTEpIHJldHVybiBmYWxzZTtcblx0XHR0aGlzLl9fbWFwS2V5c0RhdGFfXy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdHRoaXMuX19tYXBWYWx1ZXNEYXRhX18uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR0aGlzLmVtaXQoJ19kZWxldGUnLCBpbmRleCwga2V5KTtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSksXG5cdGVudHJpZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXkrdmFsdWUnKTsgfSksXG5cdGZvckVhY2g6IGQoZnVuY3Rpb24gKGNiLyosIHRoaXNBcmcqLykge1xuXHRcdHZhciB0aGlzQXJnID0gYXJndW1lbnRzWzFdLCBpdGVyYXRvciwgcmVzdWx0O1xuXHRcdGNhbGxhYmxlKGNiKTtcblx0XHRpdGVyYXRvciA9IHRoaXMuZW50cmllcygpO1xuXHRcdHJlc3VsdCA9IGl0ZXJhdG9yLl9uZXh0KCk7XG5cdFx0d2hpbGUgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRjYWxsLmNhbGwoY2IsIHRoaXNBcmcsIHRoaXMuX19tYXBWYWx1ZXNEYXRhX19bcmVzdWx0XSxcblx0XHRcdFx0dGhpcy5fX21hcEtleXNEYXRhX19bcmVzdWx0XSwgdGhpcyk7XG5cdFx0XHRyZXN1bHQgPSBpdGVyYXRvci5fbmV4dCgpO1xuXHRcdH1cblx0fSksXG5cdGdldDogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0dmFyIGluZGV4ID0gZUluZGV4T2YuY2FsbCh0aGlzLl9fbWFwS2V5c0RhdGFfXywga2V5KTtcblx0XHRpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XG5cdFx0cmV0dXJuIHRoaXMuX19tYXBWYWx1ZXNEYXRhX19baW5kZXhdO1xuXHR9KSxcblx0aGFzOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRyZXR1cm4gKGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSkgIT09IC0xKTtcblx0fSksXG5cdGtleXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICdrZXknKTsgfSksXG5cdHNldDogZChmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuXHRcdHZhciBpbmRleCA9IGVJbmRleE9mLmNhbGwodGhpcy5fX21hcEtleXNEYXRhX18sIGtleSksIGVtaXQ7XG5cdFx0aWYgKGluZGV4ID09PSAtMSkge1xuXHRcdFx0aW5kZXggPSB0aGlzLl9fbWFwS2V5c0RhdGFfXy5wdXNoKGtleSkgLSAxO1xuXHRcdFx0ZW1pdCA9IHRydWU7XG5cdFx0fVxuXHRcdHRoaXMuX19tYXBWYWx1ZXNEYXRhX19baW5kZXhdID0gdmFsdWU7XG5cdFx0aWYgKGVtaXQpIHRoaXMuZW1pdCgnX2FkZCcsIGluZGV4LCBrZXkpO1xuXHRcdHJldHVybiB0aGlzO1xuXHR9KSxcblx0c2l6ZTogZC5ncyhmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLl9fbWFwS2V5c0RhdGFfXy5sZW5ndGg7IH0pLFxuXHR2YWx1ZXM6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IEl0ZXJhdG9yKHRoaXMsICd2YWx1ZScpOyB9KSxcblx0dG9TdHJpbmc6IGQoZnVuY3Rpb24gKCkgeyByZXR1cm4gJ1tvYmplY3QgTWFwXSc7IH0pXG59KSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoTWFwUG9seS5wcm90b3R5cGUsIFN5bWJvbC5pdGVyYXRvciwgZChmdW5jdGlvbiAoKSB7XG5cdHJldHVybiB0aGlzLmVudHJpZXMoKTtcbn0pKTtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShNYXBQb2x5LnByb3RvdHlwZSwgU3ltYm9sLnRvU3RyaW5nVGFnLCBkKCdjJywgJ01hcCcpKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2lzLWltcGxlbWVudGVkJykoKSA/XG5cdFx0V2Vha01hcCA6IHJlcXVpcmUoJy4vcG9seWZpbGwnKTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG5cdHZhciBtYXA7XG5cdGlmICh0eXBlb2YgV2Vha01hcCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXHRtYXAgPSBuZXcgV2Vha01hcCgpO1xuXHRpZiAodHlwZW9mIG1hcC5zZXQgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKG1hcC5zZXQoe30sIDEpICE9PSBtYXApIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuY2xlYXIgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcblx0aWYgKHR5cGVvZiBtYXAuZGVsZXRlICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG5cdGlmICh0eXBlb2YgbWFwLmhhcyAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG5cdHJldHVybiB0cnVlO1xufTtcbiIsIi8vIEV4cG9ydHMgdHJ1ZSBpZiBlbnZpcm9ubWVudCBwcm92aWRlcyBuYXRpdmUgYFdlYWtNYXBgIGltcGxlbWVudGF0aW9uLFxuLy8gd2hhdGV2ZXIgdGhhdCBpcy5cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cdGlmICh0eXBlb2YgV2Vha01hcCA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoV2Vha01hcC5wcm90b3R5cGUpID09PVxuXHRcdFx0J1tvYmplY3QgV2Vha01hcF0nKTtcbn0oKSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCA9IHJlcXVpcmUoJy4vaXMtb2JqZWN0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG5cdGlmICghaXNPYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKHZhbHVlICsgXCIgaXMgbm90IGFuIE9iamVjdFwiKTtcblx0cmV0dXJuIHZhbHVlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHNldFByb3RvdHlwZU9mICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3Qvc2V0LXByb3RvdHlwZS1vZicpXG4gICwgb2JqZWN0ICAgICAgICAgICAgPSByZXF1aXJlKCdlczUtZXh0L29iamVjdC92YWxpZC1vYmplY3QnKVxuICAsIHZhbHVlICAgICAgICAgICAgID0gcmVxdWlyZSgnZXM1LWV4dC9vYmplY3QvdmFsaWQtdmFsdWUnKVxuICAsIGQgICAgICAgICAgICAgICAgID0gcmVxdWlyZSgnZCcpXG4gICwgZ2V0SXRlcmF0b3IgICAgICAgPSByZXF1aXJlKCdlczYtaXRlcmF0b3IvZ2V0JylcbiAgLCBmb3JPZiAgICAgICAgICAgICA9IHJlcXVpcmUoJ2VzNi1pdGVyYXRvci9mb3Itb2YnKVxuICAsIHRvU3RyaW5nVGFnU3ltYm9sID0gcmVxdWlyZSgnZXM2LXN5bWJvbCcpLnRvU3RyaW5nVGFnXG4gICwgaXNOYXRpdmUgICAgICAgICAgPSByZXF1aXJlKCcuL2lzLW5hdGl2ZS1pbXBsZW1lbnRlZCcpXG5cbiAgLCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSwgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksIHJhbmRvbSA9IE1hdGgucmFuZG9tXG4gICwgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5XG4gICwgZ2VuSWQsIFdlYWtNYXBQb2x5O1xuXG5nZW5JZCA9IChmdW5jdGlvbiAoKSB7XG5cdHZhciBnZW5lcmF0ZWQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXHRyZXR1cm4gZnVuY3Rpb24gKCkge1xuXHRcdHZhciBpZDtcblx0XHRkbyB7IGlkID0gcmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpOyB9IHdoaWxlIChnZW5lcmF0ZWRbaWRdKTtcblx0XHRnZW5lcmF0ZWRbaWRdID0gdHJ1ZTtcblx0XHRyZXR1cm4gaWQ7XG5cdH07XG59KCkpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYWtNYXBQb2x5ID0gZnVuY3Rpb24gKC8qaXRlcmFibGUqLykge1xuXHR2YXIgaXRlcmFibGUgPSBhcmd1bWVudHNbMF07XG5cdGlmICghKHRoaXMgaW5zdGFuY2VvZiBXZWFrTWFwUG9seSkpIHJldHVybiBuZXcgV2Vha01hcFBvbHkoaXRlcmFibGUpO1xuXHRpZiAodGhpcy5fX3dlYWtNYXBEYXRhX18gIT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IodGhpcyArIFwiIGNhbm5vdCBiZSByZWluaXRpYWxpemVkXCIpO1xuXHR9XG5cdGlmIChpdGVyYWJsZSAhPSBudWxsKSB7XG5cdFx0aWYgKCFpc0FycmF5KGl0ZXJhYmxlKSkgaXRlcmFibGUgPSBnZXRJdGVyYXRvcihpdGVyYWJsZSk7XG5cdH1cblx0ZGVmaW5lUHJvcGVydHkodGhpcywgJ19fd2Vha01hcERhdGFfXycsIGQoJ2MnLCAnJHdlYWtNYXAkJyArIGdlbklkKCkpKTtcblx0aWYgKCFpdGVyYWJsZSkgcmV0dXJuO1xuXHRmb3JPZihpdGVyYWJsZSwgZnVuY3Rpb24gKHZhbCkge1xuXHRcdHZhbHVlKHZhbCk7XG5cdFx0dGhpcy5zZXQodmFsWzBdLCB2YWxbMV0pO1xuXHR9LCB0aGlzKTtcbn07XG5cbmlmIChpc05hdGl2ZSkge1xuXHRpZiAoc2V0UHJvdG90eXBlT2YpIHNldFByb3RvdHlwZU9mKFdlYWtNYXBQb2x5LCBXZWFrTWFwKTtcblx0V2Vha01hcFBvbHkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShXZWFrTWFwLnByb3RvdHlwZSwge1xuXHRcdGNvbnN0cnVjdG9yOiBkKFdlYWtNYXBQb2x5KVxuXHR9KTtcbn1cblxuT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoV2Vha01hcFBvbHkucHJvdG90eXBlLCB7XG5cdGNsZWFyOiBkKGZ1bmN0aW9uICgpIHtcblx0XHRkZWZpbmVQcm9wZXJ0eSh0aGlzLCAnX193ZWFrTWFwRGF0YV9fJywgZCgnYycsICckd2Vha01hcCQnICsgZ2VuSWQoKSkpO1xuXHR9KSxcblx0ZGVsZXRlOiBkKGZ1bmN0aW9uIChrZXkpIHtcblx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3Qoa2V5KSwgdGhpcy5fX3dlYWtNYXBEYXRhX18pKSB7XG5cdFx0XHRkZWxldGUga2V5W3RoaXMuX193ZWFrTWFwRGF0YV9fXTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH0pLFxuXHRnZXQ6IGQoZnVuY3Rpb24gKGtleSkge1xuXHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXykpIHtcblx0XHRcdHJldHVybiBrZXlbdGhpcy5fX3dlYWtNYXBEYXRhX19dO1xuXHRcdH1cblx0fSksXG5cdGhhczogZChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0cmV0dXJuIGhhc093blByb3BlcnR5LmNhbGwob2JqZWN0KGtleSksIHRoaXMuX193ZWFrTWFwRGF0YV9fKTtcblx0fSksXG5cdHNldDogZChmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuXHRcdGRlZmluZVByb3BlcnR5KG9iamVjdChrZXkpLCB0aGlzLl9fd2Vha01hcERhdGFfXywgZCgnYycsIHZhbHVlKSk7XG5cdFx0cmV0dXJuIHRoaXM7XG5cdH0pLFxuXHR0b1N0cmluZzogZChmdW5jdGlvbiAoKSB7IHJldHVybiAnW29iamVjdCBXZWFrTWFwXSc7IH0pXG59KTtcbmRlZmluZVByb3BlcnR5KFdlYWtNYXBQb2x5LnByb3RvdHlwZSwgdG9TdHJpbmdUYWdTeW1ib2wsIGQoJ2MnLCAnV2Vha01hcCcpKTtcbiIsImZ1bmN0aW9uIGZsYXRNZXJnZShhLGIpe1xuICAgIGlmKCFiIHx8IHR5cGVvZiBiICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGIgPSB7fTtcbiAgICB9XG5cbiAgICBpZighYSB8fCB0eXBlb2YgYSAhPT0gJ29iamVjdCcpe1xuICAgICAgICBhID0gbmV3IGIuY29uc3RydWN0b3IoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gbmV3IGEuY29uc3RydWN0b3IoKSxcbiAgICAgICAgYUtleXMgPSBPYmplY3Qua2V5cyhhKSxcbiAgICAgICAgYktleXMgPSBPYmplY3Qua2V5cyhiKTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFthS2V5c1tpXV0gPSBhW2FLZXlzW2ldXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYktleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYktleXNbaV1dID0gYltiS2V5c1tpXV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmbGF0TWVyZ2U7IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc1NhbWUoYSwgYil7XG4gICAgaWYoYSA9PT0gYil7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGlmKFxuICAgICAgICB0eXBlb2YgYSAhPT0gdHlwZW9mIGIgfHwgXG4gICAgICAgIHR5cGVvZiBhID09PSAnb2JqZWN0JyAmJiBcbiAgICAgICAgIShhIGluc3RhbmNlb2YgRGF0ZSAmJiBiIGluc3RhbmNlb2YgRGF0ZSlcbiAgICApe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIGEgKyAnJyA9PT0gYiArICcnO1xufTsiLCJ2YXIgdW5zdXBwb3J0ZWRUeXBlcyA9IFsnbnVtYmVyJywgJ2VtYWlsJywgJ3RpbWUnLCAnY29sb3InLCAnbW9udGgnLCAncmFuZ2UnLCAnZGF0ZSddO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcbiAgICB2YXIgY2FuU2V0ID0gZWxlbWVudC5zZXRTZWxlY3Rpb25SYW5nZSAmJlxuICAgICAgICAgICAgICAgICF+dW5zdXBwb3J0ZWRUeXBlcy5pbmRleE9mKGVsZW1lbnQudHlwZSkgJiZcbiAgICAgICAgICAgICAgICBlbGVtZW50ID09PSBkb2N1bWVudC5hY3RpdmVFbGVtZW50O1xuXG4gICAgaWYgKGNhblNldCkge1xuICAgICAgICB2YXIgc3RhcnQgPSBlbGVtZW50LnNlbGVjdGlvblN0YXJ0LFxuICAgICAgICAgICAgZW5kID0gZWxlbWVudC5zZWxlY3Rpb25FbmQ7XG5cbiAgICAgICAgZWxlbWVudC52YWx1ZSA9IHZhbHVlO1xuICAgICAgICBlbGVtZW50LnNldFNlbGVjdGlvblJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGVsZW1lbnQudmFsdWUgPSB2YWx1ZTtcbiAgICB9XG59OyIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG5mdW5jdGlvbiBrZXlzQXJlRGlmZmVyZW50KGtleXMxLCBrZXlzMil7XG4gICAgaWYoa2V5czEgPT09IGtleXMyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZigha2V5czEgfHwgIWtleXMyIHx8IGtleXMxLmxlbmd0aCAhPT0ga2V5czIubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzMS5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKCF+a2V5czIuaW5kZXhPZihrZXlzMVtpXSkpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSl7XG4gICAgICAgIHJlc3VsdC50eXBlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ2tleXMnIGluIGNoYW5nZXNUb1RyYWNrICYmIGtleXNBcmVEaWZmZXJlbnQodGhpcy5fbGFzdEtleXMsIGdldEtleXModmFsdWUpKSl7XG4gICAgICAgIHJlc3VsdC5rZXlzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKXtcbiAgICAgICAgdmFyIGxhc3RWYWx1ZSA9IHRoaXMuX2xhc3RWYWx1ZTtcblxuICAgICAgICBpZignc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgKCFsYXN0VmFsdWUgfHwgdHlwZW9mIGxhc3RWYWx1ZSAhPT0gJ29iamVjdCcgfHwgT2JqZWN0LmtleXModmFsdWUpLnNvbWUoZnVuY3Rpb24oa2V5LCBpbmRleCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWVba2V5W2luZGV4XV0gIT09IGxhc3RWYWx1ZVtrZXlbaW5kZXhdXTtcbiAgICAgICAgfSkpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zaGFsbG93U3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZignc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiAhZGVlcEVxdWFsKHZhbHVlLCBsYXN0VmFsdWUpKXtcbiAgICAgICAgICAgIHJlc3VsdC5zdHJ1Y3R1cmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdyZWZlcmVuY2UnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKXtcbiAgICAgICAgICAgIHJlc3VsdC5yZWZlcmVuY2UgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbGFzdFZhbHVlID0gJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSkgOiAnc2hhbGxvd1N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgPyBjbG9uZSh2YWx1ZSwgdHJ1ZSwgMSk6IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RSZWZlcmVuY2UgPSB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0S2V5cyA9IG5ld0tleXM7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaGF0Q2hhbmdlZDsiLCJ2YXIgY2xvbmUgPSAoZnVuY3Rpb24oKSB7XG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQ2xvbmVzIChjb3BpZXMpIGFuIE9iamVjdCB1c2luZyBkZWVwIGNvcHlpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBzdXBwb3J0cyBjaXJjdWxhciByZWZlcmVuY2VzIGJ5IGRlZmF1bHQsIGJ1dCBpZiB5b3UgYXJlIGNlcnRhaW5cbiAqIHRoZXJlIGFyZSBubyBjaXJjdWxhciByZWZlcmVuY2VzIGluIHlvdXIgb2JqZWN0LCB5b3UgY2FuIHNhdmUgc29tZSBDUFUgdGltZVxuICogYnkgY2FsbGluZyBjbG9uZShvYmosIGZhbHNlKS5cbiAqXG4gKiBDYXV0aW9uOiBpZiBgY2lyY3VsYXJgIGlzIGZhbHNlIGFuZCBgcGFyZW50YCBjb250YWlucyBjaXJjdWxhciByZWZlcmVuY2VzLFxuICogeW91ciBwcm9ncmFtIG1heSBlbnRlciBhbiBpbmZpbml0ZSBsb29wIGFuZCBjcmFzaC5cbiAqXG4gKiBAcGFyYW0gYHBhcmVudGAgLSB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZFxuICogQHBhcmFtIGBjaXJjdWxhcmAgLSBzZXQgdG8gdHJ1ZSBpZiB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZCBtYXkgY29udGFpblxuICogICAgY2lyY3VsYXIgcmVmZXJlbmNlcy4gKG9wdGlvbmFsIC0gdHJ1ZSBieSBkZWZhdWx0KVxuICogQHBhcmFtIGBkZXB0aGAgLSBzZXQgdG8gYSBudW1iZXIgaWYgdGhlIG9iamVjdCBpcyBvbmx5IHRvIGJlIGNsb25lZCB0b1xuICogICAgYSBwYXJ0aWN1bGFyIGRlcHRoLiAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBJbmZpbml0eSlcbiAqIEBwYXJhbSBgcHJvdG90eXBlYCAtIHNldHMgdGhlIHByb3RvdHlwZSB0byBiZSB1c2VkIHdoZW4gY2xvbmluZyBhbiBvYmplY3QuXG4gKiAgICAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBwYXJlbnQgcHJvdG90eXBlKS5cbiovXG5mdW5jdGlvbiBjbG9uZShwYXJlbnQsIGNpcmN1bGFyLCBkZXB0aCwgcHJvdG90eXBlKSB7XG4gIHZhciBmaWx0ZXI7XG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT09ICdvYmplY3QnKSB7XG4gICAgZGVwdGggPSBjaXJjdWxhci5kZXB0aDtcbiAgICBwcm90b3R5cGUgPSBjaXJjdWxhci5wcm90b3R5cGU7XG4gICAgZmlsdGVyID0gY2lyY3VsYXIuZmlsdGVyO1xuICAgIGNpcmN1bGFyID0gY2lyY3VsYXIuY2lyY3VsYXJcbiAgfVxuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAoY2xvbmUuX19pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCBfX2dldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmIChjbG9uZS5fX2lzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbiBjbG9uZVByb3RvdHlwZShwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG4vLyBwcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG5cbmZ1bmN0aW9uIF9fb2JqVG9TdHIobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufTtcbmNsb25lLl9fb2JqVG9TdHIgPSBfX29ialRvU3RyO1xuXG5mdW5jdGlvbiBfX2lzRGF0ZShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgRGF0ZV0nO1xufTtcbmNsb25lLl9faXNEYXRlID0gX19pc0RhdGU7XG5cbmZ1bmN0aW9uIF9faXNBcnJheShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5jbG9uZS5fX2lzQXJyYXkgPSBfX2lzQXJyYXk7XG5cbmZ1bmN0aW9uIF9faXNSZWdFeHAobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufTtcbmNsb25lLl9faXNSZWdFeHAgPSBfX2lzUmVnRXhwO1xuXG5mdW5jdGlvbiBfX2dldFJlZ0V4cEZsYWdzKHJlKSB7XG4gIHZhciBmbGFncyA9ICcnO1xuICBpZiAocmUuZ2xvYmFsKSBmbGFncyArPSAnZyc7XG4gIGlmIChyZS5pZ25vcmVDYXNlKSBmbGFncyArPSAnaSc7XG4gIGlmIChyZS5tdWx0aWxpbmUpIGZsYWdzICs9ICdtJztcbiAgcmV0dXJuIGZsYWdzO1xufTtcbmNsb25lLl9fZ2V0UmVnRXhwRmxhZ3MgPSBfX2dldFJlZ0V4cEZsYWdzO1xuXG5yZXR1cm4gY2xvbmU7XG59KSgpO1xuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcbn1cbiIsInZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgb2JqZWN0S2V5cyA9IHJlcXVpcmUoJy4vbGliL2tleXMuanMnKTtcbnZhciBpc0FyZ3VtZW50cyA9IHJlcXVpcmUoJy4vbGliL2lzX2FyZ3VtZW50cy5qcycpO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgb3B0cykge1xuICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9wdHMuc3RyaWN0ID8gYWN0dWFsID09PSBleHBlY3RlZCA6IGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCwgb3B0cyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyICh4KSB7XG4gIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHgubGVuZ3RoICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHguY29weSAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgeC5zbGljZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoeC5sZW5ndGggPiAwICYmIHR5cGVvZiB4WzBdICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYiwgb3B0cykge1xuICB2YXIgaSwga2V5O1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG9wdHMpO1xuICB9XG4gIGlmIChpc0J1ZmZlcihhKSkge1xuICAgIGlmICghaXNCdWZmZXIoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYVtpXSAhPT0gYltpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0cnkge1xuICAgIHZhciBrYSA9IG9iamVjdEtleXMoYSksXG4gICAgICAgIGtiID0gb2JqZWN0S2V5cyhiKTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBvcHRzKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0eXBlb2YgYSA9PT0gdHlwZW9mIGI7XG59XG4iLCJ2YXIgc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA9IChmdW5jdGlvbigpe1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZ3VtZW50cylcbn0pKCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPyBzdXBwb3J0ZWQgOiB1bnN1cHBvcnRlZDtcblxuZXhwb3J0cy5zdXBwb3J0ZWQgPSBzdXBwb3J0ZWQ7XG5mdW5jdGlvbiBzdXBwb3J0ZWQob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn07XG5cbmV4cG9ydHMudW5zdXBwb3J0ZWQgPSB1bnN1cHBvcnRlZDtcbmZ1bmN0aW9uIHVuc3VwcG9ydGVkKG9iamVjdCl7XG4gIHJldHVybiBvYmplY3QgJiZcbiAgICB0eXBlb2Ygb2JqZWN0ID09ICdvYmplY3QnICYmXG4gICAgdHlwZW9mIG9iamVjdC5sZW5ndGggPT0gJ251bWJlcicgJiZcbiAgICBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2FsbGVlJykgJiZcbiAgICAhT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpIHx8XG4gICAgZmFsc2U7XG59O1xuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gID8gT2JqZWN0LmtleXMgOiBzaGltO1xuXG5leHBvcnRzLnNoaW0gPSBzaGltO1xuZnVuY3Rpb24gc2hpbSAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIGtleXMucHVzaChrZXkpO1xuICByZXR1cm4ga2V5cztcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIFdoYXRDaGFuZ2VkID0gcmVxdWlyZSgnd2hhdC1jaGFuZ2VkJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBjcmVhdGVCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyksXG4gICAgbWFrZUZ1bmN0aW9uRW1pdHRlciA9IHJlcXVpcmUoJy4vbWFrZUZ1bmN0aW9uRW1pdHRlcicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZVByb3BlcnR5KGN1cnJlbnRWYWx1ZSwgY2hhbmdlcyl7XG4gICAgdmFyIGJpbmRpbmcsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBhdHRhY2hpbmcsXG4gICAgICAgIHByZXZpb3VzID0gbmV3IFdoYXRDaGFuZ2VkKGN1cnJlbnRWYWx1ZSwgY2hhbmdlcyB8fCAndmFsdWUgdHlwZSByZWZlcmVuY2Uga2V5cycpO1xuXG4gICAgZnVuY3Rpb24gcHJvcGVydHkodmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZyAmJiBiaW5kaW5nKCkgfHwgcHJvcGVydHkuX3ZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXR0YWNoaW5nKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFPYmplY3Qua2V5cyhwcmV2aW91cy51cGRhdGUodmFsdWUpKS5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIXByb3BlcnR5Ll9kZXN0cm95ZWQpe1xuICAgICAgICAgICAgcHJvcGVydHkuX3ZhbHVlID0gdmFsdWU7XG5cbiAgICAgICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgICAgIGJpbmRpbmcodmFsdWUpO1xuICAgICAgICAgICAgICAgIHByb3BlcnR5Ll92YWx1ZSA9IGJpbmRpbmcoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnY2hhbmdlJywgcHJvcGVydHkuX3ZhbHVlKTtcbiAgICAgICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH1cblxuICAgIHByb3BlcnR5Ll92YWx1ZSA9IGN1cnJlbnRWYWx1ZTtcblxuICAgIHByb3BlcnR5Ll9maXJtID0gMTtcblxuICAgIG1ha2VGdW5jdGlvbkVtaXR0ZXIocHJvcGVydHkpO1xuXG4gICAgcHJvcGVydHkuYmluZGluZyA9IGZ1bmN0aW9uKG5ld0JpbmRpbmcpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFpcy5iaW5kaW5nKG5ld0JpbmRpbmcpKXtcbiAgICAgICAgICAgIG5ld0JpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKG5ld0JpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobmV3QmluZGluZyA9PT0gYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgIGJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHByb3BlcnR5KTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nID0gbmV3QmluZGluZztcbiAgICAgICAgaWYobW9kZWwpe1xuICAgICAgICAgICAgcHJvcGVydHkuYXR0YWNoKG1vZGVsLCBwcm9wZXJ0eS5fZmlybSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBmaXJtKXtcbiAgICAgICAgaWYoZmlybWVyKHByb3BlcnR5LCBmaXJtKSl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBwcm9wZXJ0eS5fZmlybSA9IGZpcm07XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBtb2RlbCA9IG9iamVjdDtcbiAgICAgICAgICAgIGF0dGFjaGluZyA9IHRydWU7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICAgICAgYXR0YWNoaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBwcm9wZXJ0eShiaW5kaW5nKCkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LmRldGFjaCA9IGZ1bmN0aW9uKGZpcm0pe1xuICAgICAgICBpZihmaXJtZXIocHJvcGVydHksIGZpcm0pKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICAgICAgYmluZGluZy5kZXRhY2goMSk7XG4gICAgICAgICAgICBtb2RlbCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcHJvcGVydHkudXBkYXRlKCk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5LnVwZGF0ZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmVtaXQoJ3VwZGF0ZScsIHByb3BlcnR5Ll92YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGVzdHJveSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGlmKCFwcm9wZXJ0eS5fZGVzdHJveWVkKXtcbiAgICAgICAgICAgIHByb3BlcnR5Ll9kZXN0cm95ZWQgPSB0cnVlO1xuICAgICAgICAgICAgcHJvcGVydHkuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICAgICAgcHJvcGVydHkuZGV0YWNoKCk7XG4gICAgICAgICAgICBpZihiaW5kaW5nKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nLmRlc3Ryb3kodHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYWRkVG8gPSBmdW5jdGlvbihjb21wb25lbnQsIGtleSl7XG4gICAgICAgIGNvbXBvbmVudFtrZXldID0gcHJvcGVydHk7XG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3Mpe1xuICAgIHZhciB0ZXh0ID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG4gICAgdGV4dC50ZXh0ID0gZmFzdG4ucHJvcGVydHkoJycpO1xuICAgIHRleHQuX3VwZGF0ZVRleHQgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGlmKCF0ZXh0LmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGV4dC5lbGVtZW50LnRleHRDb250ZW50ID0gdmFsdWU7XG4gICAgfTtcbiAgICB0ZXh0LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHRleHQuZWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgICAgdGV4dC5lbWl0KCdyZW5kZXInKTtcbiAgICB9O1xuICAgIHRleHQudGV4dC5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICB0ZXh0Ll91cGRhdGVUZXh0KHZhbHVlKTtcbiAgICB9KTtcbiAgICB0ZXh0Lm9uKCd1cGRhdGUnLCB0ZXh0LnRleHQudXBkYXRlKTtcblxuICAgIHJldHVybiB0ZXh0O1xufTsiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIGtNYXhMZW5ndGggPSAweDNmZmZmZmZmXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIE5vdGU6XG4gKlxuICogLSBJbXBsZW1lbnRhdGlvbiBtdXN0IHN1cHBvcnQgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMuXG4gKiAgIEZpcmVmb3ggNC0yOSBsYWNrZWQgc3VwcG9ydCwgZml4ZWQgaW4gRmlyZWZveCAzMCsuXG4gKiAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG4gKlxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXkgd2lsbFxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgd2lsbCB3b3JrIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoMSkuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoYXJnKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKSB7XG4gICAgLy8gQXZvaWQgZ29pbmcgdGhyb3VnaCBhbiBBcmd1bWVudHNBZGFwdG9yVHJhbXBvbGluZSBpbiB0aGUgY29tbW9uIGNhc2UuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSByZXR1cm4gbmV3IEJ1ZmZlcihhcmcsIGFyZ3VtZW50c1sxXSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihhcmcpXG4gIH1cblxuICB0aGlzLmxlbmd0aCA9IDBcbiAgdGhpcy5wYXJlbnQgPSB1bmRlZmluZWRcblxuICAvLyBDb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIGZyb21OdW1iZXIodGhpcywgYXJnKVxuICB9XG5cbiAgLy8gU2xpZ2h0bHkgbGVzcyBjb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodGhpcywgYXJnLCBhcmd1bWVudHMubGVuZ3RoID4gMSA/IGFyZ3VtZW50c1sxXSA6ICd1dGY4JylcbiAgfVxuXG4gIC8vIFVudXN1YWwuXG4gIHJldHVybiBmcm9tT2JqZWN0KHRoaXMsIGFyZylcbn1cblxuZnVuY3Rpb24gZnJvbU51bWJlciAodGhhdCwgbGVuZ3RoKSB7XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGggPCAwID8gMCA6IGNoZWNrZWQobGVuZ3RoKSB8IDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGF0W2ldID0gMFxuICAgIH1cbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tU3RyaW5nICh0aGF0LCBzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgIT09ICdzdHJpbmcnIHx8IGVuY29kaW5nID09PSAnJykgZW5jb2RpbmcgPSAndXRmOCdcblxuICAvLyBBc3N1bXB0aW9uOiBieXRlTGVuZ3RoKCkgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyA8IGtNYXhMZW5ndGguXG4gIHZhciBsZW5ndGggPSBieXRlTGVuZ3RoKHN0cmluZywgZW5jb2RpbmcpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIHRoYXQud3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbU9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSkgcmV0dXJuIGZyb21CdWZmZXIodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChpc0FycmF5KG9iamVjdCkpIHJldHVybiBmcm9tQXJyYXkodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChvYmplY3QgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcbiAgfVxuXG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIG9iamVjdC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgIHJldHVybiBmcm9tVHlwZWRBcnJheSh0aGF0LCBvYmplY3QpXG4gIH1cblxuICBpZiAob2JqZWN0Lmxlbmd0aCkgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqZWN0KVxuXG4gIHJldHVybiBmcm9tSnNvbk9iamVjdCh0aGF0LCBvYmplY3QpXG59XG5cbmZ1bmN0aW9uIGZyb21CdWZmZXIgKHRoYXQsIGJ1ZmZlcikge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChidWZmZXIubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgYnVmZmVyLmNvcHkodGhhdCwgMCwgMCwgbGVuZ3RoKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEdXBsaWNhdGUgb2YgZnJvbUFycmF5KCkgdG8ga2VlcCBmcm9tQXJyYXkoKSBtb25vbW9ycGhpYy5cbmZ1bmN0aW9uIGZyb21UeXBlZEFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICAvLyBUcnVuY2F0aW5nIHRoZSBlbGVtZW50cyBpcyBwcm9iYWJseSBub3Qgd2hhdCBwZW9wbGUgZXhwZWN0IGZyb20gdHlwZWRcbiAgLy8gYXJyYXlzIHdpdGggQllURVNfUEVSX0VMRU1FTlQgPiAxIGJ1dCBpdCdzIGNvbXBhdGlibGUgd2l0aCB0aGUgYmVoYXZpb3JcbiAgLy8gb2YgdGhlIG9sZCBCdWZmZXIgY29uc3RydWN0b3IuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlMaWtlICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRGVzZXJpYWxpemUgeyB0eXBlOiAnQnVmZmVyJywgZGF0YTogWzEsMiwzLC4uLl0gfSBpbnRvIGEgQnVmZmVyIG9iamVjdC5cbi8vIFJldHVybnMgYSB6ZXJvLWxlbmd0aCBidWZmZXIgZm9yIGlucHV0cyB0aGF0IGRvbid0IGNvbmZvcm0gdG8gdGhlIHNwZWMuXG5mdW5jdGlvbiBmcm9tSnNvbk9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIHZhciBhcnJheVxuICB2YXIgbGVuZ3RoID0gMFxuXG4gIGlmIChvYmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmplY3QuZGF0YSkpIHtcbiAgICBhcnJheSA9IG9iamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB9XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGFsbG9jYXRlICh0aGF0LCBsZW5ndGgpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0Lmxlbmd0aCA9IGxlbmd0aFxuICAgIHRoYXQuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGZyb21Qb29sID0gbGVuZ3RoICE9PSAwICYmIGxlbmd0aCA8PSBCdWZmZXIucG9vbFNpemUgPj4+IDFcbiAgaWYgKGZyb21Qb29sKSB0aGF0LnBhcmVudCA9IHJvb3RQYXJlbnRcblxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aGAgaGVyZSBiZWNhdXNlIHRoYXQgZmFpbHMgd2hlblxuICAvLyBsZW5ndGggaXMgTmFOICh3aGljaCBpcyBvdGhlcndpc2UgY29lcmNlZCB0byB6ZXJvLilcbiAgaWYgKGxlbmd0aCA+PSBrTWF4TGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIHZhciBpID0gMFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICBpZiAoYVtpXSAhPT0gYltpXSkgYnJlYWtcblxuICAgICsraVxuICB9XG5cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgbGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdCBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIobGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbmZ1bmN0aW9uIGJ5dGVMZW5ndGggKHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSBzdHJpbmcgPSBTdHJpbmcoc3RyaW5nKVxuXG4gIGlmIChzdHJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAncmF3JzpcbiAgICAgIHJldHVybiBzdHJpbmcubGVuZ3RoXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiBzdHJpbmcubGVuZ3RoICogMlxuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXR1cm4gc3RyaW5nLmxlbmd0aCA+Pj4gMVxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gc3RyaW5nLmxlbmd0aFxuICB9XG59XG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4vLyB0b1N0cmluZyhlbmNvZGluZywgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCB8IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kIHwgMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gMFxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmRleE9mID0gZnVuY3Rpb24gaW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0KSB7XG4gIGlmIChieXRlT2Zmc2V0ID4gMHg3ZmZmZmZmZikgYnl0ZU9mZnNldCA9IDB4N2ZmZmZmZmZcbiAgZWxzZSBpZiAoYnl0ZU9mZnNldCA8IC0weDgwMDAwMDAwKSBieXRlT2Zmc2V0ID0gLTB4ODAwMDAwMDBcbiAgYnl0ZU9mZnNldCA+Pj0gMFxuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xXG4gIGlmIChieXRlT2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm4gLTFcblxuICAvLyBOZWdhdGl2ZSBvZmZzZXRzIHN0YXJ0IGZyb20gdGhlIGVuZCBvZiB0aGUgYnVmZmVyXG4gIGlmIChieXRlT2Zmc2V0IDwgMCkgYnl0ZU9mZnNldCA9IE1hdGgubWF4KHRoaXMubGVuZ3RoICsgYnl0ZU9mZnNldCwgMClcblxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAodmFsLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xIC8vIHNwZWNpYWwgY2FzZTogbG9va2luZyBmb3IgZW1wdHkgc3RyaW5nIGFsd2F5cyBmYWlsc1xuICAgIHJldHVybiBTdHJpbmcucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWwpKSB7XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIFsgdmFsIF0sIGJ5dGVPZmZzZXQpXG4gIH1cblxuICBmdW5jdGlvbiBhcnJheUluZGV4T2YgKGFyciwgdmFsLCBieXRlT2Zmc2V0KSB7XG4gICAgdmFyIGZvdW5kSW5kZXggPSAtMVxuICAgIGZvciAodmFyIGkgPSAwOyBieXRlT2Zmc2V0ICsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFycltieXRlT2Zmc2V0ICsgaV0gPT09IHZhbFtmb3VuZEluZGV4ID09PSAtMSA/IDAgOiBpIC0gZm91bmRJbmRleF0pIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggPT09IC0xKSBmb3VuZEluZGV4ID0gaVxuICAgICAgICBpZiAoaSAtIGZvdW5kSW5kZXggKyAxID09PSB2YWwubGVuZ3RoKSByZXR1cm4gYnl0ZU9mZnNldCArIGZvdW5kSW5kZXhcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvdW5kSW5kZXggPSAtMVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbCBtdXN0IGJlIHN0cmluZywgbnVtYmVyIG9yIEJ1ZmZlcicpXG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIGdldCAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQgKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4ocGFyc2VkKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aCB8IDBcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuICB9XG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gcmVhZFVJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiByZWFkVUludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiByZWFkVUludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0taV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gcmVhZEludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiByZWFkSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gcmVhZEludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gcmVhZEZsb2F0TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gcmVhZEZsb2F0QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlVUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlVUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uIGNvcHkgKHRhcmdldCwgdGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldFN0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldFN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldFN0YXJ0KSB0YXJnZXRTdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRTdGFydCA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIH1cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgPCBlbmQgLSBzdGFydCkge1xuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldFN0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiB0b0FycmF5QnVmZmVyICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiBfYXVnbWVudCAoYXJyKSB7XG4gIGFyci5jb25zdHJ1Y3RvciA9IEJ1ZmZlclxuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgc2V0IG1ldGhvZCBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZCwgd2lsbCBiZSByZW1vdmVkIGluIG5vZGUgMC4xMytcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuaW5kZXhPZiA9IEJQLmluZGV4T2ZcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludExFID0gQlAucmVhZFVJbnRMRVxuICBhcnIucmVhZFVJbnRCRSA9IEJQLnJlYWRVSW50QkVcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50TEUgPSBCUC5yZWFkSW50TEVcbiAgYXJyLnJlYWRJbnRCRSA9IEJQLnJlYWRJbnRCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnRMRSA9IEJQLndyaXRlVUludExFXG4gIGFyci53cml0ZVVJbnRCRSA9IEJQLndyaXRlVUludEJFXG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnRMRSA9IEJQLndyaXRlSW50TEVcbiAgYXJyLndyaXRlSW50QkUgPSBCUC53cml0ZUludEJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtelxcLV0vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG4gIHZhciBpID0gMFxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG5cbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICB9XG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDIwMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0xFID8gLTEgOiAxLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzXG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KVxuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbilcbiAgICBlID0gZSAtIGVCaWFzXG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbilcbn1cblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uIChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgYyxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMCksXG4gICAgICBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNMRSA/IDEgOiAtMSxcbiAgICAgIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH1cbiAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIiwidmFyIGZhc3RuID0gcmVxdWlyZSgnLi9mYXN0bicpLFxuICAgIGNyZWwgPSByZXF1aXJlKCdjcmVsJyk7XG5cbnZhciBtb2RlbCA9IG5ldyBmYXN0bi5Nb2RlbCh7XG4gICAgICAgIHVzZXJzOiByZXF1aXJlKCcuL3VzZXJzLmpzJylcbiAgICB9KTtcblxudmFyIGFwcCA9IGZhc3RuKCdkaXYnLFxuICAgIHJlcXVpcmUoJy4vaGVhZGVyJykoKSxcbiAgICByZXF1aXJlKCcuL3VzZXJMaXN0JykoKSxcbiAgICByZXF1aXJlKCcuL3N0YXRzJykoKSxcbiAgICByZXF1aXJlKCcuL2ZvcmtCYW5uZXInKSgpXG4pO1xuXG5hcHAuYXR0YWNoKG1vZGVsKTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG4gICBcbiAgICBhcHAucmVuZGVyKCk7XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGFwcC5lbGVtZW50KTtcbn07Il19
