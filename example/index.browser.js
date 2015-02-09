(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/home/kory/dev/fastn/binding.js":[function(require,module,exports){
var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    watchFilter = require('./filter'),
    is = require('./is');

function bindify(binding, key){
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }
    binding.setMaxListeners(1000);
    binding.model = new Enti(),
    binding._fastn_binding = key;
    binding._firm = false;

    return binding;
}

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

    resultBinding.model.set = function(key, value){
        if(updateTransform){
            selfChanging = true;
            var newValue = updateTransform(value);
            if(newValue !== bindings[0]()){
                bindings[0](newValue);
            }
            selfChanging = false;
        }else{
            this.emit(key, value);
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

    resultBinding.on('attach', function(object){
        selfChanging = true;
        bindings.forEach(function(binding){
            binding.attach(object, true);
        });
        selfChanging = false;
        change();
    });

    return resultBinding;
}

function drill(sourceKey, targetKey){
    var bindings = Array.prototype.slice.call(arguments),
        sourceBinding = createBinding(sourceKey),
        resultBinding = createBinding('result'),
        targetBinding = createBinding(targetKey);

    var remove,
        lastTarget = resultBinding();

    resultBinding.on('attach', sourceBinding.attach);

    sourceBinding.on('change', function(newTarget){
        if(lastTarget !== newTarget){
            lastTarget = newTarget;
            targetBinding.attach(newTarget);
        }
    });

    resultBinding.model.set = function(key, value){
        this.emit(key, value);
    };

    targetBinding.on('change', resultBinding);
    resultBinding.on('detach', sourceBinding.detach);
    sourceBinding.on('detach', targetBinding.detach);

    return resultBinding;
}

function createBinding(keyAndFilter){
    var args = Array.prototype.slice.call(arguments);

    if(args.length > 1){
        return fuseBinding.apply(null, args);
    }

    var keyAndFilterParts = keyAndFilter.split('|'),
        filter = keyAndFilterParts[1],
        key = keyAndFilterParts[0];

    var dotIndex = key.indexOf('.');

    if(key.length > 1 && ~dotIndex){
        return drill(key.slice(0, dotIndex), keyAndFilter.slice(dotIndex+1));
    }

    var value,
        binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        if(key === '.'){
            return;
        }

        binding.model.set(key, newValue);
    };
    bindify(binding, key);
    binding.model._events = {};
    binding.model._events[key] = function(value){
        binding._change(value, value);
    };

    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && binding._firm){
            return binding;
        }

        binding._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        binding.model.attach(object);
        binding._change(binding.model.get(key));
        binding._scope = object;
        binding.emit('attach', object, true);
        return binding;
    };
    binding.detach = function(loose){
        if(loose && binding._firm){
            return binding;
        }

        binding.model.detach();
        binding._change(undefined);
        binding._scope = null;
        binding.emit('detach', true);
        return binding;
    };
    binding.drill = function(drillKey){
        return drill(key, drillKey);
    };
    binding._change = function(newValue, changeTarget){
        value = newValue;
        binding.emit('change', value, changeTarget);
    };
    binding.clone = function(){
        return createBinding.apply(null, args);
    };

    filter && watchFilter(binding, filter);

    return binding;
}

module.exports = createBinding;
},{"./filter":"/home/kory/dev/fastn/filter.js","./is":"/home/kory/dev/fastn/is.js","enti":"/usr/lib/node_modules/enti/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/component.js":[function(require,module,exports){
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
        return result.concat(flatten(element));
    },[]) : item;
}

module.exports = function createComponent(type, fastn, settings, children, components){
    var component,
        model = new Enti({});

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

    component._type = type;
    component._settings = settings;
    component._fastn_component = true;
    component._children = children;
    component._binding;

    component.attach = function(object, loose){
        component._binding.attach(object, loose);
        return component;
    };

    component._attach = function(object, loose){
        if(loose && component._firm){
            return component;
        }

        component._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        model.attach(object instanceof Enti ? object._model : object);
        component.emit('attach', object, true);
        return component;
    };

    component.detach = function(loose){
        if(loose && component._firm){
            return component;
        }

        model.detach();
        component.emit('detach', true);
        return component;
    };

    component.scope = function(){
        return model;
    };

    function emitUpdate(){
        component.emit('update');
    }

    component.destroy = function(){
        component.emit('destroy');
        model.detach();
    };

    component.binding = function(binding){
        if(!arguments.length){
            return component._binding;
        }

        if(!is.binding(binding)){
            binding = createBinding(binding);
        }

        component._binding = binding;

        binding.on('change', function(data){
            component._attach(data, true);
        });
        component._attach(binding(), true);

        return component;
    };

    component.clone = function(){
        return createComponent(component._type, fastn, component._settings, component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return child.clone();
        }), components);
    };

    for(var key in settings){
        if(is.property(component[key])){
            if(is.binding(settings[key])){
                component[key].binding(settings[key]);
            }else{
                component[key](settings[key]);
            }
        }
    }

    component.on('attach', emitUpdate);
    component.on('render', emitUpdate);

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
}

},{"./binding":"/home/kory/dev/fastn/binding.js","./is":"/home/kory/dev/fastn/is.js","enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/containerComponent.js":[function(require,module,exports){
var crel = require('crel'),
    EventEmitter = require('events').EventEmitter,
    is = require('./is');

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
        this.element.insertBefore(element, this.element.childNodes[index]);
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
        if(!element || !container.element || element.parentNode !== container.element){
            return;
        }
        container.element.removeChild(element);
    }

    container.on('render', function(){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i]) && !container._children[i].element){
                container._children[i].render();
            }

            container._insert(container._children[i].element);
        }
    });

    container.on('attach', function(data, loose){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].attach(data, loose);
            }
        }
    });

    container.on('destroy', function(data, loose){
        for(var i = 0; i < container._children.length; i++){
            if(fastn.isComponent(container._children[i])){
                container._children[i].destroy();
            }
        }
    });

    return container;
};
},{"./is":"/home/kory/dev/fastn/is.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/example/header.js":[function(require,module,exports){
module.exports = function(fastn){
    return fastn('header', {'class':'mainHeader'},
        fastn('h1', fastn.binding('users|*.deleted', function(users){
            if(!users){
                users = [];
            }

            return 'Users (' + users.filter(function(user){
                return !user.deleted;
            }).length + ')';
        }))
    );
};
},{}],"/home/kory/dev/fastn/example/index.js":[function(require,module,exports){
var components = {
    _generic: require('../genericComponent'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    Enti = require('enti'),
    crel = require('crel');

var model = {
        uiState: {
            foo: 'bar'
        }
    },
    enti = new Enti(model);

var users = require('./users.json');

users = users.map(function(user){
    var user = user.user;
    // user.deleted = false;
    return user;
});

window.enti = enti;

window.onload = function(){
    var userSearch = fastn.binding('userSearch').attach({
        userSearch: ''
    });

    var app = fastn('div',
        require('./header')(fastn),
        fastn('input', {value: userSearch})
            .on('keyup', function(){
                this.value(this.element.value);
            }),
        require('./userList')(fastn, userSearch)
    );

    app.attach(model);
    app.render();

    window.app = app;
    window.enti = enti;

    setTimeout(function(){
        enti.set('users', users);
    });

    crel(document.body, app.element);
};
},{"../":"/home/kory/dev/fastn/index.js","../genericComponent":"/home/kory/dev/fastn/genericComponent.js","../listComponent":"/home/kory/dev/fastn/listComponent.js","./header":"/home/kory/dev/fastn/example/header.js","./userList":"/home/kory/dev/fastn/example/userList.js","./users.json":"/home/kory/dev/fastn/example/users.json","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/example/user.js":[function(require,module,exports){
var Enti = require('enti');

module.exports = function(fastn, userSearch, selectedUser, deleteUser){

    return fastn('div', {
            'class': fastn.binding('.', 'name', userSearch, selectedUser, 'deleted', function(user, name, search, selectedUser, deleted){
                var classes = ['user'];

                if(!name || !(name.first && ~name.first.indexOf(search)) && !(name.last && ~name.last.indexOf(search))){
                    classes.push('hidden');
                }
                if(user === selectedUser){
                    classes.push('selected');
                }
                if(deleted){
                    classes.push('deleted');
                }
                return classes.join(' ');
            })
        },

        fastn('img', {src: fastn.binding('picture', function(picture){
                return picture && picture.medium;
            })
        }),

        fastn('label', {
            'class': 'name',
            textContent: fastn.binding('name.first', 'name.last', function(firstName, surname){
                return firstName + ' ' + surname;
            })
        }),

        fastn('input', {
            value: fastn.binding('name.first')
        }).on('keyup', function(){
            this.value(this.element.value);
        }),

        fastn('div', {'class': 'details'},

            fastn('p', {'class':'extra'},
                fastn('a', {
                    textContent: fastn.binding('email'),
                    href: fastn.binding('email', function(email){
                        return 'mailto:' + email;
                    })
                }),
                fastn('p', {
                    textContent: fastn.binding('cell', function(cell){
                        return 'Mobile: ' + cell;
                    })
                })
            )

        ),

        fastn('button', {textContent: 'X', 'class': 'remove'})
        .on('click', function(event, scope){
            scope.set('deleted', true);
            deleteUser();
        })

    ).on('click', function(event, scope){
        selectedUser(scope._model);
    });
};
},{"enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/example/userList.js":[function(require,module,exports){
module.exports = function(fastn, userSearch){
    var selectedUser = fastn.binding('selectedUser').attach({});

    return fastn('list', {items: fastn.binding('users'), template: function(item, key, scope){

        function deleteUser(){
            var deletedUsers = scope.get('deletedUsers') ||[];
            deletedUsers.push(item);
            scope.set('deletedUsers', deletedUsers);
        }

        return require('./user.js')(fastn, userSearch, selectedUser, deleteUser);
    }});
};
},{"./user.js":"/home/kory/dev/fastn/example/user.js"}],"/home/kory/dev/fastn/example/users.json":[function(require,module,exports){
module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=[
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
]
},{}],"/home/kory/dev/fastn/filter.js":[function(require,module,exports){
var Enti = require('enti');

function watchFilter(object, filter, handler, model){
    if(!object || typeof object !=='object') {
        return;
    }

    if(!model){
        model = new Enti(object);
    }

    var dotIndex = filter.indexOf('.'),
        isLast = !~dotIndex,
        target = isLast ? filter : filter.slice(0, dotIndex),
        isDoubleStar = target === '**',
        isValueStar = target === '*$',
        rest = isLast ? null : filter.slice(dotIndex+1),
        realKey = target.charAt(0) !== '*',
        childWatches = [];

    function unwatch(){
        model.detach();
        model._events = {};
        while(childWatches.length){
            var remove = childWatches.pop();
            remove && remove();
        }
    }

    function updateOn(key){
        model.on(key, function(){
            unwatch();
            model.attach(object);
            watchFilter(object, filter, handler, model);
        });
    }

    updateOn('*');

    if(realKey){
        if(rest){
            childWatches.push(watchFilter(object[target], rest, handler));
        }else{
            model.on(target, handler);
        }

        updateOn(target);
    }else if(target.charAt(0) === '*'){
        if(!rest){
            model.on('*', handler);
        }
        
        for(var key in object){
            updateOn(key);
            if(rest){
                childWatches.push(watchFilter(object[key], rest, handler));
                if(isDoubleStar){
                    childWatches.push(watchFilter(object[key], '**.' + rest, handler));
                }
            }else{
                if(isValueStar || isDoubleStar){
                    model.on(key, handler);
                }
                if(isDoubleStar){
                    childWatches.push(watchFilter(object[key], '**', handler));
                }
            }
        }
    }

    return unwatch;
}

module.exports = function watch(binding, filter){
    if(!filter){
        return;
    }
    
    var remove,
        lastTarget = binding();

    function handler(target){
        binding._change(binding(), target);
    }

    binding.on('change', function(newTarget){
        if(lastTarget !== newTarget){
            lastTarget = newTarget;
            remove && remove();
            remove = watchFilter(newTarget, filter, handler);
        }
    });

    binding.on('detach', function(newTarget){
        remove && remove();
    });

    remove = watchFilter(lastTarget, filter, handler);
};
},{"enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/genericComponent.js":[function(require,module,exports){
var crel = require('crel'),
    containerComponent = require('./containerComponent');

function createProperty(fastn, generic, key, settings){
    var setting = settings[key],
        binding = fastn.isBinding(setting) && setting,
        property = fastn.isProperty(setting) && setting,
        value = !binding && !property && setting || null;

    if(typeof value === 'function'){
        return;
    } 

    if(!property){
        property = fastn.property(value);
    }else{
        return;
    }

    if(binding){
        property.binding(binding);
    }

    generic.on('update', property.update);
    generic.on('attach', property.attach);
    property.on('update', function(value){
        if(!generic.element){
            return;
        }

        var element = generic.element,
            isProperty = key in element,
            previous = isProperty ? element[key] : element.getAttribute(key);

        if(value == null){
            value = '';
        }

        if(value !== previous){
            if(isProperty){
                element[key] = value;
            }else if(typeof value !== 'function' && typeof value !== 'object'){
                element.setAttribute(key, value);
            }
        }
    });

    generic[key] = property;
}

function createProperties(fastn, generic, settings){
    for(var key in settings){
        createProperty(fastn, generic, key, settings);
    }
}

function addUpdateHandler(generic, eventName, settings){
    var handler = function(event){
        generic.emit(eventName, event, generic.scope());
    };

    generic.element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        generic.element.removeEventListener(eventName, handler);
    });
}

function addAutoHandler(generic, key, settings){
    var autoEvent = settings[key].split(':'),
        eventName = key.slice(2);
        
    delete settings[key];

    var handler = function(event){
        generic[autoEvent[0]](generic.element[autoEvent[1]]);
    };

    generic.element.addEventListener(eventName, handler);

    generic.on('destroy', function(){
        generic.element.removeEventListener(eventName, handler);
    });
}

module.exports = function(type, fastn, settings, children){
    if(children.length === 1 && !fastn.isComponent(children[0])){
        settings.textContent = children.pop();
    }

    var generic = containerComponent(type, fastn);

    createProperties(fastn, generic, settings);

    generic.render = function(){
        generic.element = crel(type);

        generic.emit('render');

        return generic;
    };

    generic.on('render', function(){

        //
        for(var key in settings){
            if(key.slice(0,2) === 'on' && key in generic.element){
                addAutoHandler(generic, key, settings);
            }
        }

        for(var key in generic._events){
            if('on' + key.toLowerCase() in generic.element){
                addUpdateHandler(generic, key);
            }
        }

    });

    return generic;
};
},{"./containerComponent":"/home/kory/dev/fastn/containerComponent.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js"}],"/home/kory/dev/fastn/index.js":[function(require,module,exports){
var merge = require('flat-merge'),
    createComponent = require('./component'),
    createProperty = require('./property'),
    createBinding = require('./binding'),
    is = require('./is');

module.exports = function(components, debug){

    function fastn(type){
        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2;

        if(is.component(args[1]) || typeof args[1] !== 'object' || !args[1]){
            childrenIndex--;
            settings = null;
        }

        return createComponent(type, fastn, settings, args.slice(childrenIndex), components);
    }

    fastn.debug = debug;

    fastn.property = createProperty;

    fastn.binding = createBinding;

    fastn.isComponent = is.component;
    fastn.isBinding = is.binding;
    fastn.isDefaultBinding = is.defaultBinding;
    fastn.isBindingObject = is.bindingObject;
    fastn.isProperty = is.property;

    return fastn;
};
},{"./binding":"/home/kory/dev/fastn/binding.js","./component":"/home/kory/dev/fastn/component.js","./is":"/home/kory/dev/fastn/is.js","./property":"/home/kory/dev/fastn/property.js","flat-merge":"/home/kory/dev/fastn/node_modules/flat-merge/index.js"}],"/home/kory/dev/fastn/is.js":[function(require,module,exports){

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
var crel = require('crel'),
    Enti = require('enti'),
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
                component.destroy();
                list.remove(component);
            }
        }

        var index = 0,
            newItems = [],
            newComponents = [];

        each(value, function(item, key){
            var child,
                lastKey = keyFor(lastItems, item),
                model = new Enti({
                    item: item,
                    key: key
                });

            if(lastKey === false){
                child = template(model, list.scope());
                child._templated = true;

                newItems.push(item);
                newComponents.push(child);
            }else{
                newItems.push(lastItems[lastKey]);
                lastItems.splice(lastKey,1)

                child = lastComponents[lastKey];
                lastComponents.splice(lastKey,1);
                newComponents.push(child);
            }
            
            if(fastn.isComponent(child)){
                if(fastn.isDefaultBinding(child.binding())){
                    child.binding('item');
                }
                child.attach(model, true);
            }

            list.insert(child, index);

            index++;
        });

        lastItems = newItems;
        lastComponents = newComponents;
    }

    list.render = function(){
        this.element = crel('div');
        this.items.on('update', updateItems);
        updateItems(this.items());
        this.emit('render');
    };

    list.items = fastn.property([], updateItems).binding(settings.items);
    list.on('attach', list.items.attach);

    return list;
};
},{"./genericComponent":"/home/kory/dev/fastn/genericComponent.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/node_modules/crel/crel.js":[function(require,module,exports){
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
                ('nodeType' in object) &&
                isType(object.ownerDocument,obj);
        },
        isElement = function (object) {
            return crel.isNode(object) && object.nodeType === 1;
        },
        isArray = function(a){
            return a instanceof Array;
        },
        appendChild = function(element, child) {
          if(!isNode(child)){
              child = document.createTextNode(child);
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
            attributeMap = crel.attrMap;

        element = crel.isElement(element) ? element : document.createElement(element);
        // shortcut
        if(argumentsLength === 1){
            return element;
        }

        if(!isType(settings,obj) || crel.isNode(settings) || isArray(settings)) {
            --childIndex;
            settings = null;
        }

        // shortcut if there is only one child that is a string
        if((argumentsLength - childIndex) === 1 && isType(args[childIndex], 'string') && element.textContent !== undefined){
            element.textContent = args[childIndex];
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
                element.setAttribute(key, settings[key]);
            }else{
                var attr = crel.attrMap[key];
                if(typeof attr === fn){
                    attr(element, settings[key]);
                }else{
                    element.setAttribute(attr, settings[key]);
                }
            }
        }

        return element;
    }

    // Used for mapping one kind of attribute to the supported version of that in bad browsers.
    // String referenced so that compilers maintain the property name.
    crel['attrMap'] = {};

    // String referenced so that compilers maintain the property name.
    crel["isElement"] = isElement;
    crel["isNode"] = isNode;

    return crel;
}));

},{}],"/home/kory/dev/fastn/node_modules/flat-merge/index.js":[function(require,module,exports){
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
        if('structure' in changesToTrack && !deepEqual(value, this._lastValue)){
            result.structure = true;
        }
        if('reference' in changesToTrack && value !== this._lastReference){
            result.reference = true;
        }
    }

    this._lastValue = 'structure' in changesToTrack ? clone(value) : value;
    this._lastReference = value;
    this._lastKeys = newKeys;

    return result;
};

module.exports = WhatChanged;
},{"clone":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/clone/clone.js","deep-equal":"/home/kory/dev/fastn/node_modules/what-changed/node_modules/deep-equal/index.js"}],"/home/kory/dev/fastn/node_modules/what-changed/node_modules/clone/clone.js":[function(require,module,exports){
(function (Buffer){
'use strict';

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

// shim for Node's 'util' package
// DO NOT REMOVE THIS! It is required for compatibility with EnderJS (http://enderjs.com/).
var util = {
  isArray: function (ar) {
    return Array.isArray(ar) || (typeof ar === 'object' && objectToString(ar) === '[object Array]');
  },
  isDate: function (d) {
    return typeof d === 'object' && objectToString(d) === '[object Date]';
  },
  isRegExp: function (re) {
    return typeof re === 'object' && objectToString(re) === '[object RegExp]';
  },
  getRegExpFlags: function (re) {
    var flags = '';
    re.global && (flags += 'g');
    re.ignoreCase && (flags += 'i');
    re.multiline && (flags += 'm');
    return flags;
  }
};


if (typeof module === 'object')
  module.exports = clone;

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

    if (util.isArray(parent)) {
      child = [];
    } else if (util.isRegExp(parent)) {
      child = new RegExp(parent.source, util.getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (util.isDate(parent)) {
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
clone.clonePrototype = function(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

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
  return true;
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
    EventEmitter = require('events').EventEmitter,
    WhatChanged = require('what-changed'),
    is = require('./is');

module.exports = function createProperty(currentValue){
    var binding,
        model,
        previous = new WhatChanged(currentValue, 'value type reference keys');

    function property(value){
        if(!arguments.length){
            return binding && binding() || currentValue;
        }

        if(!Object.keys(previous.update(value)).length){
            return property;
        }

        currentValue = value;
        binding && binding(value);
        property.emit('change', value);
        property.update();

        return property;
    }

    for(var emitterKey in EventEmitter.prototype){
        property[emitterKey] = EventEmitter.prototype[emitterKey];
    }

    property.binding = function(newBinding){
        if(!arguments.length){
            return binding;
        }

        if(newBinding === binding){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
        }
        binding = newBinding;
        if(model){
            property.attach(model, !property._firm);
        }
        property.update();
        return property;
    };
    property.attach = function(object, loose){
        if(loose && property._firm){
            return property;
        }

        property._firm = !loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        if(binding){
            model = object;
            binding.attach(object, true);
            binding.on('change', property);
            property(binding());
        }
        property.update();
        return property;
    };
    property.detach = function(loose){
        if(loose && component._firm){
            return property;
        }

        if(binding){
            binding.removeListener('change', property);
            binding.detach(true);
            model = null;
        }
        property.update();
        return property;
    };
    property.update = function(){
        property.emit('update', currentValue);
    };
    property._fastn_property = true;

    return property;
};
},{"./is":"/home/kory/dev/fastn/is.js","enti":"/usr/lib/node_modules/enti/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js","what-changed":"/home/kory/dev/fastn/node_modules/what-changed/index.js"}],"/usr/lib/node_modules/enti/index.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    WM = require('./weakmap');

var attachedEnties = new WM();

function emit(model, key, value){
    var references = attachedEnties.get(model);

    if(!references || !references.length){
        return;
    }

    var toEmit = references.slice();

    for(var i = 0; i < toEmit.length; i++){
        if(~references.indexOf(toEmit[i])){
            toEmit[i].emit(key, value);
        }
    }
}

function Enti(model){
    if(!model || (typeof model !== 'object' && typeof model !== 'function')){
        model = {};
    }
        
    this.attach(model);
}
Enti.prototype = Object.create(EventEmitter.prototype);
Enti.prototype.constructor = Enti;
var attached = 0;
Enti.prototype.attach = function(model){

    // attached++; 
    // console.log(attached);
    
    this.detach();

    var references = attachedEnties.get(model);


    if(!references){
        references = [];
        attachedEnties.set(model, references);
    }


    references.push(this);

    this._model = model;
};
Enti.prototype.detach = function(){
    if(!this._model){
        return;
    }

    // attached--;
    // console.log(attached);

    var references = attachedEnties.get(this._model);

    if(!references){
        return;
    }

    references.splice(references.indexOf(this),1);

    if(!references.length){
        attachedEnties.delete(this._model);
    }

    this._model = {};
};
Enti.prototype.get = function(key){
    if(key === '.'){
        return this._model;
    }
    return this._model[key];
};

Enti.prototype.set = function(key, value){
    var original = this._model[key];

    if(typeof value !== 'object' && value === original){
        return;
    }

    var keysChanged = !(key in this._model);

    this._model[key] = value;

    emit(this._model, key, value);

    if(keysChanged){
        emit(this._model, '*', this._model);
        if(Array.isArray(this._model)){
            emit(this._model, 'length', this._model.length);
        }
    }
};

Enti.prototype.push = function(key, value){
    var target;
    if(arguments.length < 2){
        value = key;
        key = '.';
        target = this._model;
    }else{
        target = this._model[key];
    }

    if(!Array.isArray(target)){
        throw 'The target is not an array.';
    }

    target.push(value);

    emit(target, target.length-1, value);

    emit(target, 'length', target.length);

    emit(target, '*', target);
};

Enti.prototype.remove = function(key, subKey){

    // Remove a key off of an object at 'key'
    if(subKey != null){
        new Enti(this._model[key]).remove(subKey);
        return;
    }

    if(key === '.'){
        throw '. (self) is not a valid key to remove';
    }

    if(Array.isArray(this._model)){
        this._model.splice(key, 1);
        emit(this._model, 'length', this._model.length);
    }else{
        delete this._model[key];
    }

    emit(this._model, '*', this._model);
};

module.exports = Enti;

},{"./weakmap":"/usr/lib/node_modules/enti/weakmap.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/usr/lib/node_modules/enti/node_modules/leak-map/index.js":[function(require,module,exports){
function validateKey(key){
    if(!key || !(typeof key === 'object' || typeof key === 'function')){
        throw key + " is not a valid WeakMap key.";
    }
}

function LeakMap(){
    this.clear();
}
LeakMap.prototype.clear = function(){
    this._keys = [];
    this._values = [];
};
LeakMap.prototype.delete = function(key){
    validateKey(key);
    var keyIndex = this._keys.indexOf(key);
    if(keyIndex>=0){
        this._keys.splice(keyIndex, 1);
        this._values.splice(keyIndex, 1);
    }
    return false;
};
LeakMap.prototype.get = function(key){
    validateKey(key);
    return this._values[this._keys.indexOf(key)];
};
LeakMap.prototype.has = function(key){
    validateKey(key);
    return !!~this._keys.indexOf(key);
};
LeakMap.prototype.set = function(key, value){
    validateKey(key);

    // Favorite piece of koed evor.
    // IE devs would be prowde
    var keyIndex = (~this._keys.indexOf(key) || (this._keys.push(key), this._keys.length)) - 1;

    this._values[keyIndex] = value;
    return this;
};
LeakMap.prototype.toString = function(){
    return '[object WeakMap]';
};

module.exports = LeakMap;
},{}],"/usr/lib/node_modules/enti/node_modules/weak-map/weak-map.js":[function(require,module,exports){
// Copyright (C) 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Install a leaky WeakMap emulation on platforms that
 * don't provide a built-in one.
 *
 * <p>Assumes that an ES5 platform where, if {@code WeakMap} is
 * already present, then it conforms to the anticipated ES6
 * specification. To run this file on an ES5 or almost ES5
 * implementation where the {@code WeakMap} specification does not
 * quite conform, run <code>repairES5.js</code> first.
 *
 * <p>Even though WeakMapModule is not global, the linter thinks it
 * is, which is why it is in the overrides list below.
 *
 * <p>NOTE: Before using this WeakMap emulation in a non-SES
 * environment, see the note below about hiddenRecord.
 *
 * @author Mark S. Miller
 * @requires crypto, ArrayBuffer, Uint8Array, navigator, console
 * @overrides WeakMap, ses, Proxy
 * @overrides WeakMapModule
 */

/**
 * This {@code WeakMap} emulation is observably equivalent to the
 * ES-Harmony WeakMap, but with leakier garbage collection properties.
 *
 * <p>As with true WeakMaps, in this emulation, a key does not
 * retain maps indexed by that key and (crucially) a map does not
 * retain the keys it indexes. A map by itself also does not retain
 * the values associated with that map.
 *
 * <p>However, the values associated with a key in some map are
 * retained so long as that key is retained and those associations are
 * not overridden. For example, when used to support membranes, all
 * values exported from a given membrane will live for the lifetime
 * they would have had in the absence of an interposed membrane. Even
 * when the membrane is revoked, all objects that would have been
 * reachable in the absence of revocation will still be reachable, as
 * far as the GC can tell, even though they will no longer be relevant
 * to ongoing computation.
 *
 * <p>The API implemented here is approximately the API as implemented
 * in FF6.0a1 and agreed to by MarkM, Andreas Gal, and Dave Herman,
 * rather than the offially approved proposal page. TODO(erights):
 * upgrade the ecmascript WeakMap proposal page to explain this API
 * change and present to EcmaScript committee for their approval.
 *
 * <p>The first difference between the emulation here and that in
 * FF6.0a1 is the presence of non enumerable {@code get___, has___,
 * set___, and delete___} methods on WeakMap instances to represent
 * what would be the hidden internal properties of a primitive
 * implementation. Whereas the FF6.0a1 WeakMap.prototype methods
 * require their {@code this} to be a genuine WeakMap instance (i.e.,
 * an object of {@code [[Class]]} "WeakMap}), since there is nothing
 * unforgeable about the pseudo-internal method names used here,
 * nothing prevents these emulated prototype methods from being
 * applied to non-WeakMaps with pseudo-internal methods of the same
 * names.
 *
 * <p>Another difference is that our emulated {@code
 * WeakMap.prototype} is not itself a WeakMap. A problem with the
 * current FF6.0a1 API is that WeakMap.prototype is itself a WeakMap
 * providing ambient mutability and an ambient communications
 * channel. Thus, if a WeakMap is already present and has this
 * problem, repairES5.js wraps it in a safe wrappper in order to
 * prevent access to this channel. (See
 * PATCH_MUTABLE_FROZEN_WEAKMAP_PROTO in repairES5.js).
 */

/**
 * If this is a full <a href=
 * "http://code.google.com/p/es-lab/wiki/SecureableES5"
 * >secureable ES5</a> platform and the ES-Harmony {@code WeakMap} is
 * absent, install an approximate emulation.
 *
 * <p>If WeakMap is present but cannot store some objects, use our approximate
 * emulation as a wrapper.
 *
 * <p>If this is almost a secureable ES5 platform, then WeakMap.js
 * should be run after repairES5.js.
 *
 * <p>See {@code WeakMap} for documentation of the garbage collection
 * properties of this WeakMap emulation.
 */
(function WeakMapModule() {
  "use strict";

  if (typeof ses !== 'undefined' && ses.ok && !ses.ok()) {
    // already too broken, so give up
    return;
  }

  /**
   * In some cases (current Firefox), we must make a choice betweeen a
   * WeakMap which is capable of using all varieties of host objects as
   * keys and one which is capable of safely using proxies as keys. See
   * comments below about HostWeakMap and DoubleWeakMap for details.
   *
   * This function (which is a global, not exposed to guests) marks a
   * WeakMap as permitted to do what is necessary to index all host
   * objects, at the cost of making it unsafe for proxies.
   *
   * Do not apply this function to anything which is not a genuine
   * fresh WeakMap.
   */
  function weakMapPermitHostObjects(map) {
    // identity of function used as a secret -- good enough and cheap
    if (map.permitHostObjects___) {
      map.permitHostObjects___(weakMapPermitHostObjects);
    }
  }
  if (typeof ses !== 'undefined') {
    ses.weakMapPermitHostObjects = weakMapPermitHostObjects;
  }

  // IE 11 has no Proxy but has a broken WeakMap such that we need to patch
  // it using DoubleWeakMap; this flag tells DoubleWeakMap so.
  var doubleWeakMapCheckSilentFailure = false;

  // Check if there is already a good-enough WeakMap implementation, and if so
  // exit without replacing it.
  if (typeof WeakMap === 'function') {
    var HostWeakMap = WeakMap;
    // There is a WeakMap -- is it good enough?
    if (typeof navigator !== 'undefined' &&
        /Firefox/.test(navigator.userAgent)) {
      // We're now *assuming not*, because as of this writing (2013-05-06)
      // Firefox's WeakMaps have a miscellany of objects they won't accept, and
      // we don't want to make an exhaustive list, and testing for just one
      // will be a problem if that one is fixed alone (as they did for Event).

      // If there is a platform that we *can* reliably test on, here's how to
      // do it:
      //  var problematic = ... ;
      //  var testHostMap = new HostWeakMap();
      //  try {
      //    testHostMap.set(problematic, 1);  // Firefox 20 will throw here
      //    if (testHostMap.get(problematic) === 1) {
      //      return;
      //    }
      //  } catch (e) {}

    } else {
      // IE 11 bug: WeakMaps silently fail to store frozen objects.
      var testMap = new HostWeakMap();
      var testObject = Object.freeze({});
      testMap.set(testObject, 1);
      if (testMap.get(testObject) !== 1) {
        doubleWeakMapCheckSilentFailure = true;
        // Fall through to installing our WeakMap.
      } else {
        module.exports = WeakMap;
        return;
      }
    }
  }

  var hop = Object.prototype.hasOwnProperty;
  var gopn = Object.getOwnPropertyNames;
  var defProp = Object.defineProperty;
  var isExtensible = Object.isExtensible;

  /**
   * Security depends on HIDDEN_NAME being both <i>unguessable</i> and
   * <i>undiscoverable</i> by untrusted code.
   *
   * <p>Given the known weaknesses of Math.random() on existing
   * browsers, it does not generate unguessability we can be confident
   * of.
   *
   * <p>It is the monkey patching logic in this file that is intended
   * to ensure undiscoverability. The basic idea is that there are
   * three fundamental means of discovering properties of an object:
   * The for/in loop, Object.keys(), and Object.getOwnPropertyNames(),
   * as well as some proposed ES6 extensions that appear on our
   * whitelist. The first two only discover enumerable properties, and
   * we only use HIDDEN_NAME to name a non-enumerable property, so the
   * only remaining threat should be getOwnPropertyNames and some
   * proposed ES6 extensions that appear on our whitelist. We monkey
   * patch them to remove HIDDEN_NAME from the list of properties they
   * returns.
   *
   * <p>TODO(erights): On a platform with built-in Proxies, proxies
   * could be used to trap and thereby discover the HIDDEN_NAME, so we
   * need to monkey patch Proxy.create, Proxy.createFunction, etc, in
   * order to wrap the provided handler with the real handler which
   * filters out all traps using HIDDEN_NAME.
   *
   * <p>TODO(erights): Revisit Mike Stay's suggestion that we use an
   * encapsulated function at a not-necessarily-secret name, which
   * uses the Stiegler shared-state rights amplification pattern to
   * reveal the associated value only to the WeakMap in which this key
   * is associated with that value. Since only the key retains the
   * function, the function can also remember the key without causing
   * leakage of the key, so this doesn't violate our general gc
   * goals. In addition, because the name need not be a guarded
   * secret, we could efficiently handle cross-frame frozen keys.
   */
  var HIDDEN_NAME_PREFIX = 'weakmap:';
  var HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'ident:' + Math.random() + '___';

  if (typeof crypto !== 'undefined' &&
      typeof crypto.getRandomValues === 'function' &&
      typeof ArrayBuffer === 'function' &&
      typeof Uint8Array === 'function') {
    var ab = new ArrayBuffer(25);
    var u8s = new Uint8Array(ab);
    crypto.getRandomValues(u8s);
    HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'rand:' +
      Array.prototype.map.call(u8s, function(u8) {
        return (u8 % 36).toString(36);
      }).join('') + '___';
  }

  function isNotHiddenName(name) {
    return !(
        name.substr(0, HIDDEN_NAME_PREFIX.length) == HIDDEN_NAME_PREFIX &&
        name.substr(name.length - 3) === '___');
  }

  /**
   * Monkey patch getOwnPropertyNames to avoid revealing the
   * HIDDEN_NAME.
   *
   * <p>The ES5.1 spec requires each name to appear only once, but as
   * of this writing, this requirement is controversial for ES6, so we
   * made this code robust against this case. If the resulting extra
   * search turns out to be expensive, we can probably relax this once
   * ES6 is adequately supported on all major browsers, iff no browser
   * versions we support at that time have relaxed this constraint
   * without providing built-in ES6 WeakMaps.
   */
  defProp(Object, 'getOwnPropertyNames', {
    value: function fakeGetOwnPropertyNames(obj) {
      return gopn(obj).filter(isNotHiddenName);
    }
  });

  /**
   * getPropertyNames is not in ES5 but it is proposed for ES6 and
   * does appear in our whitelist, so we need to clean it too.
   */
  if ('getPropertyNames' in Object) {
    var originalGetPropertyNames = Object.getPropertyNames;
    defProp(Object, 'getPropertyNames', {
      value: function fakeGetPropertyNames(obj) {
        return originalGetPropertyNames(obj).filter(isNotHiddenName);
      }
    });
  }

  /**
   * <p>To treat objects as identity-keys with reasonable efficiency
   * on ES5 by itself (i.e., without any object-keyed collections), we
   * need to add a hidden property to such key objects when we
   * can. This raises several issues:
   * <ul>
   * <li>Arranging to add this property to objects before we lose the
   *     chance, and
   * <li>Hiding the existence of this new property from most
   *     JavaScript code.
   * <li>Preventing <i>certification theft</i>, where one object is
   *     created falsely claiming to be the key of an association
   *     actually keyed by another object.
   * <li>Preventing <i>value theft</i>, where untrusted code with
   *     access to a key object but not a weak map nevertheless
   *     obtains access to the value associated with that key in that
   *     weak map.
   * </ul>
   * We do so by
   * <ul>
   * <li>Making the name of the hidden property unguessable, so "[]"
   *     indexing, which we cannot intercept, cannot be used to access
   *     a property without knowing the name.
   * <li>Making the hidden property non-enumerable, so we need not
   *     worry about for-in loops or {@code Object.keys},
   * <li>monkey patching those reflective methods that would
   *     prevent extensions, to add this hidden property first,
   * <li>monkey patching those methods that would reveal this
   *     hidden property.
   * </ul>
   * Unfortunately, because of same-origin iframes, we cannot reliably
   * add this hidden property before an object becomes
   * non-extensible. Instead, if we encounter a non-extensible object
   * without a hidden record that we can detect (whether or not it has
   * a hidden record stored under a name secret to us), then we just
   * use the key object itself to represent its identity in a brute
   * force leaky map stored in the weak map, losing all the advantages
   * of weakness for these.
   */
  function getHiddenRecord(key) {
    if (key !== Object(key)) {
      throw new TypeError('Not an object: ' + key);
    }
    var hiddenRecord = key[HIDDEN_NAME];
    if (hiddenRecord && hiddenRecord.key === key) { return hiddenRecord; }
    if (!isExtensible(key)) {
      // Weak map must brute force, as explained in doc-comment above.
      return void 0;
    }

    // The hiddenRecord and the key point directly at each other, via
    // the "key" and HIDDEN_NAME properties respectively. The key
    // field is for quickly verifying that this hidden record is an
    // own property, not a hidden record from up the prototype chain.
    //
    // NOTE: Because this WeakMap emulation is meant only for systems like
    // SES where Object.prototype is frozen without any numeric
    // properties, it is ok to use an object literal for the hiddenRecord.
    // This has two advantages:
    // * It is much faster in a performance critical place
    // * It avoids relying on Object.create(null), which had been
    //   problematic on Chrome 28.0.1480.0. See
    //   https://code.google.com/p/google-caja/issues/detail?id=1687
    hiddenRecord = { key: key };

    // When using this WeakMap emulation on platforms where
    // Object.prototype might not be frozen and Object.create(null) is
    // reliable, use the following two commented out lines instead.
    // hiddenRecord = Object.create(null);
    // hiddenRecord.key = key;

    // Please contact us if you need this to work on platforms where
    // Object.prototype might not be frozen and
    // Object.create(null) might not be reliable.

    try {
      defProp(key, HIDDEN_NAME, {
        value: hiddenRecord,
        writable: false,
        enumerable: false,
        configurable: false
      });
      return hiddenRecord;
    } catch (error) {
      // Under some circumstances, isExtensible seems to misreport whether
      // the HIDDEN_NAME can be defined.
      // The circumstances have not been isolated, but at least affect
      // Node.js v0.10.26 on TravisCI / Linux, but not the same version of
      // Node.js on OS X.
      return void 0;
    }
  }

  /**
   * Monkey patch operations that would make their argument
   * non-extensible.
   *
   * <p>The monkey patched versions throw a TypeError if their
   * argument is not an object, so it should only be done to functions
   * that should throw a TypeError anyway if their argument is not an
   * object.
   */
  (function(){
    var oldFreeze = Object.freeze;
    defProp(Object, 'freeze', {
      value: function identifyingFreeze(obj) {
        getHiddenRecord(obj);
        return oldFreeze(obj);
      }
    });
    var oldSeal = Object.seal;
    defProp(Object, 'seal', {
      value: function identifyingSeal(obj) {
        getHiddenRecord(obj);
        return oldSeal(obj);
      }
    });
    var oldPreventExtensions = Object.preventExtensions;
    defProp(Object, 'preventExtensions', {
      value: function identifyingPreventExtensions(obj) {
        getHiddenRecord(obj);
        return oldPreventExtensions(obj);
      }
    });
  })();

  function constFunc(func) {
    func.prototype = null;
    return Object.freeze(func);
  }

  var calledAsFunctionWarningDone = false;
  function calledAsFunctionWarning() {
    // Future ES6 WeakMap is currently (2013-09-10) expected to reject WeakMap()
    // but we used to permit it and do it ourselves, so warn only.
    if (!calledAsFunctionWarningDone && typeof console !== 'undefined') {
      calledAsFunctionWarningDone = true;
      console.warn('WeakMap should be invoked as new WeakMap(), not ' +
          'WeakMap(). This will be an error in the future.');
    }
  }

  var nextId = 0;

  var OurWeakMap = function() {
    if (!(this instanceof OurWeakMap)) {  // approximate test for new ...()
      calledAsFunctionWarning();
    }

    // We are currently (12/25/2012) never encountering any prematurely
    // non-extensible keys.
    var keys = []; // brute force for prematurely non-extensible keys.
    var values = []; // brute force for corresponding values.
    var id = nextId++;

    function get___(key, opt_default) {
      var index;
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        return id in hiddenRecord ? hiddenRecord[id] : opt_default;
      } else {
        index = keys.indexOf(key);
        return index >= 0 ? values[index] : opt_default;
      }
    }

    function has___(key) {
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        return id in hiddenRecord;
      } else {
        return keys.indexOf(key) >= 0;
      }
    }

    function set___(key, value) {
      var index;
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        hiddenRecord[id] = value;
      } else {
        index = keys.indexOf(key);
        if (index >= 0) {
          values[index] = value;
        } else {
          // Since some browsers preemptively terminate slow turns but
          // then continue computing with presumably corrupted heap
          // state, we here defensively get keys.length first and then
          // use it to update both the values and keys arrays, keeping
          // them in sync.
          index = keys.length;
          values[index] = value;
          // If we crash here, values will be one longer than keys.
          keys[index] = key;
        }
      }
      return this;
    }

    function delete___(key) {
      var hiddenRecord = getHiddenRecord(key);
      var index, lastIndex;
      if (hiddenRecord) {
        return id in hiddenRecord && delete hiddenRecord[id];
      } else {
        index = keys.indexOf(key);
        if (index < 0) {
          return false;
        }
        // Since some browsers preemptively terminate slow turns but
        // then continue computing with potentially corrupted heap
        // state, we here defensively get keys.length first and then use
        // it to update both the keys and the values array, keeping
        // them in sync. We update the two with an order of assignments,
        // such that any prefix of these assignments will preserve the
        // key/value correspondence, either before or after the delete.
        // Note that this needs to work correctly when index === lastIndex.
        lastIndex = keys.length - 1;
        keys[index] = void 0;
        // If we crash here, there's a void 0 in the keys array, but
        // no operation will cause a "keys.indexOf(void 0)", since
        // getHiddenRecord(void 0) will always throw an error first.
        values[index] = values[lastIndex];
        // If we crash here, values[index] cannot be found here,
        // because keys[index] is void 0.
        keys[index] = keys[lastIndex];
        // If index === lastIndex and we crash here, then keys[index]
        // is still void 0, since the aliasing killed the previous key.
        keys.length = lastIndex;
        // If we crash here, keys will be one shorter than values.
        values.length = lastIndex;
        return true;
      }
    }

    return Object.create(OurWeakMap.prototype, {
      get___:    { value: constFunc(get___) },
      has___:    { value: constFunc(has___) },
      set___:    { value: constFunc(set___) },
      delete___: { value: constFunc(delete___) }
    });
  };

  OurWeakMap.prototype = Object.create(Object.prototype, {
    get: {
      /**
       * Return the value most recently associated with key, or
       * opt_default if none.
       */
      value: function get(key, opt_default) {
        return this.get___(key, opt_default);
      },
      writable: true,
      configurable: true
    },

    has: {
      /**
       * Is there a value associated with key in this WeakMap?
       */
      value: function has(key) {
        return this.has___(key);
      },
      writable: true,
      configurable: true
    },

    set: {
      /**
       * Associate value with key in this WeakMap, overwriting any
       * previous association if present.
       */
      value: function set(key, value) {
        return this.set___(key, value);
      },
      writable: true,
      configurable: true
    },

    'delete': {
      /**
       * Remove any association for key in this WeakMap, returning
       * whether there was one.
       *
       * <p>Note that the boolean return here does not work like the
       * {@code delete} operator. The {@code delete} operator returns
       * whether the deletion succeeds at bringing about a state in
       * which the deleted property is absent. The {@code delete}
       * operator therefore returns true if the property was already
       * absent, whereas this {@code delete} method returns false if
       * the association was already absent.
       */
      value: function remove(key) {
        return this.delete___(key);
      },
      writable: true,
      configurable: true
    }
  });

  if (typeof HostWeakMap === 'function') {
    (function() {
      // If we got here, then the platform has a WeakMap but we are concerned
      // that it may refuse to store some key types. Therefore, make a map
      // implementation which makes use of both as possible.

      // In this mode we are always using double maps, so we are not proxy-safe.
      // This combination does not occur in any known browser, but we had best
      // be safe.
      if (doubleWeakMapCheckSilentFailure && typeof Proxy !== 'undefined') {
        Proxy = undefined;
      }

      function DoubleWeakMap() {
        if (!(this instanceof OurWeakMap)) {  // approximate test for new ...()
          calledAsFunctionWarning();
        }

        // Preferable, truly weak map.
        var hmap = new HostWeakMap();

        // Our hidden-property-based pseudo-weak-map. Lazily initialized in the
        // 'set' implementation; thus we can avoid performing extra lookups if
        // we know all entries actually stored are entered in 'hmap'.
        var omap = undefined;

        // Hidden-property maps are not compatible with proxies because proxies
        // can observe the hidden name and either accidentally expose it or fail
        // to allow the hidden property to be set. Therefore, we do not allow
        // arbitrary WeakMaps to switch to using hidden properties, but only
        // those which need the ability, and unprivileged code is not allowed
        // to set the flag.
        //
        // (Except in doubleWeakMapCheckSilentFailure mode in which case we
        // disable proxies.)
        var enableSwitching = false;

        function dget(key, opt_default) {
          if (omap) {
            return hmap.has(key) ? hmap.get(key)
                : omap.get___(key, opt_default);
          } else {
            return hmap.get(key, opt_default);
          }
        }

        function dhas(key) {
          return hmap.has(key) || (omap ? omap.has___(key) : false);
        }

        var dset;
        if (doubleWeakMapCheckSilentFailure) {
          dset = function(key, value) {
            hmap.set(key, value);
            if (!hmap.has(key)) {
              if (!omap) { omap = new OurWeakMap(); }
              omap.set(key, value);
            }
            return this;
          };
        } else {
          dset = function(key, value) {
            if (enableSwitching) {
              try {
                hmap.set(key, value);
              } catch (e) {
                if (!omap) { omap = new OurWeakMap(); }
                omap.set___(key, value);
              }
            } else {
              hmap.set(key, value);
            }
            return this;
          };
        }

        function ddelete(key) {
          var result = !!hmap['delete'](key);
          if (omap) { return omap.delete___(key) || result; }
          return result;
        }

        return Object.create(OurWeakMap.prototype, {
          get___:    { value: constFunc(dget) },
          has___:    { value: constFunc(dhas) },
          set___:    { value: constFunc(dset) },
          delete___: { value: constFunc(ddelete) },
          permitHostObjects___: { value: constFunc(function(token) {
            if (token === weakMapPermitHostObjects) {
              enableSwitching = true;
            } else {
              throw new Error('bogus call to permitHostObjects___');
            }
          })}
        });
      }
      DoubleWeakMap.prototype = OurWeakMap.prototype;
      module.exports = DoubleWeakMap;

      // define .constructor to hide OurWeakMap ctor
      Object.defineProperty(WeakMap.prototype, 'constructor', {
        value: WeakMap,
        enumerable: false,  // as default .constructor is
        configurable: true,
        writable: true
      });
    })();
  } else {
    // There is no host WeakMap, so we must use the emulation.

    // Emulated WeakMaps are incompatible with native proxies (because proxies
    // can observe the hidden name), so we must disable Proxy usage (in
    // ArrayLike and Domado, currently).
    if (typeof Proxy !== 'undefined') {
      Proxy = undefined;
    }

    module.exports = OurWeakMap;
  }
})();

},{}],"/usr/lib/node_modules/enti/weakmap.js":[function(require,module,exports){
var WM;

if(typeof WeakMap !== 'undefined'){
    WM = WeakMap;
}else if(typeof window !== 'undefined'){
    if (navigator.appName == 'Microsoft Internet Explorer'){
        var match = navigator.userAgent.match(/MSIE ([0-9]{1,}[\.0-9]{0,})/);
        if (match && match[1] <= 9){
            // MEMORY LEAKS FOR EVERYONE!!!
            WM = require('leak-map');
        }
    }
}

WM || (WM = require('weak-map'));

module.exports = WM;
},{"leak-map":"/usr/lib/node_modules/enti/node_modules/leak-map/index.js","weak-map":"/usr/lib/node_modules/enti/node_modules/weak-map/weak-map.js"}],"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/buffer/index.js":[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vYmluZGluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvaGVhZGVyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZXhhbXBsZS9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlckxpc3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3VzZXJzLmpzb24iLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9maWx0ZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9nZW5lcmljQ29tcG9uZW50LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9pcy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2xpc3RDb21wb25lbnQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3JlbC9jcmVsLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2ZsYXQtbWVyZ2UvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvY2xvbmUvY2xvbmUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIvaXNfYXJndW1lbnRzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIva2V5cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL3Byb3BlcnR5LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL2VudGkvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvbGVhay1tYXAvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvd2Vhay1tYXAvd2Vhay1tYXAuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS93ZWFrbWFwLmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNzZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3cUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgd2F0Y2hGaWx0ZXIgPSByZXF1aXJlKCcuL2ZpbHRlcicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBiaW5kaWZ5KGJpbmRpbmcsIGtleSl7XG4gICAgZm9yKHZhciBlbWl0dGVyS2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgICAgICBiaW5kaW5nW2VtaXR0ZXJLZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtlbWl0dGVyS2V5XTtcbiAgICB9XG4gICAgYmluZGluZy5zZXRNYXhMaXN0ZW5lcnMoMTAwMCk7XG4gICAgYmluZGluZy5tb2RlbCA9IG5ldyBFbnRpKCksXG4gICAgYmluZGluZy5fZmFzdG5fYmluZGluZyA9IGtleTtcbiAgICBiaW5kaW5nLl9maXJtID0gZmFsc2U7XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxuZnVuY3Rpb24gZnVzZUJpbmRpbmcoKXtcbiAgICB2YXIgYmluZGluZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZygncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIGlmKHR5cGVvZiBiaW5kaW5nc1tiaW5kaW5ncy5sZW5ndGgtMV0gPT09ICdmdW5jdGlvbicgJiYgIWlzLmJpbmRpbmcoYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdKSl7XG4gICAgICAgIHVwZGF0ZVRyYW5zZm9ybSA9IHRyYW5zZm9ybTtcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCk7XG4gICAgfVxuXG4gICAgcmVzdWx0QmluZGluZy5tb2RlbC5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICB2YXIgbmV3VmFsdWUgPSB1cGRhdGVUcmFuc2Zvcm0odmFsdWUpO1xuICAgICAgICAgICAgaWYobmV3VmFsdWUgIT09IGJpbmRpbmdzWzBdKCkpe1xuICAgICAgICAgICAgICAgIGJpbmRpbmdzWzBdKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuZW1pdChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjaGFuZ2UoKXtcbiAgICAgICAgaWYoc2VsZkNoYW5naW5nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRCaW5kaW5nKHRyYW5zZm9ybS5hcHBseShudWxsLCBiaW5kaW5ncy5tYXAoZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZygpO1xuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZywgaW5kZXgpe1xuICAgICAgICBpZih0eXBlb2YgYmluZGluZyA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoYmluZGluZyk7XG4gICAgICAgICAgICBiaW5kaW5ncy5zcGxpY2UoaW5kZXgsMSxiaW5kaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBiaW5kaW5nLmRldGFjaCk7XG4gICAgfSk7XG5cbiAgICByZXN1bHRCaW5kaW5nLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihvYmplY3Qpe1xuICAgICAgICBzZWxmQ2hhbmdpbmcgPSB0cnVlO1xuICAgICAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCB0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICBjaGFuZ2UoKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBkcmlsbChzb3VyY2VLZXksIHRhcmdldEtleSl7XG4gICAgdmFyIGJpbmRpbmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSxcbiAgICAgICAgc291cmNlQmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoc291cmNlS2V5KSxcbiAgICAgICAgcmVzdWx0QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ3Jlc3VsdCcpLFxuICAgICAgICB0YXJnZXRCaW5kaW5nID0gY3JlYXRlQmluZGluZyh0YXJnZXRLZXkpO1xuXG4gICAgdmFyIHJlbW92ZSxcbiAgICAgICAgbGFzdFRhcmdldCA9IHJlc3VsdEJpbmRpbmcoKTtcblxuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIHNvdXJjZUJpbmRpbmcuYXR0YWNoKTtcblxuICAgIHNvdXJjZUJpbmRpbmcub24oJ2NoYW5nZScsIGZ1bmN0aW9uKG5ld1RhcmdldCl7XG4gICAgICAgIGlmKGxhc3RUYXJnZXQgIT09IG5ld1RhcmdldCl7XG4gICAgICAgICAgICBsYXN0VGFyZ2V0ID0gbmV3VGFyZ2V0O1xuICAgICAgICAgICAgdGFyZ2V0QmluZGluZy5hdHRhY2gobmV3VGFyZ2V0KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzdWx0QmluZGluZy5tb2RlbC5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgdGhpcy5lbWl0KGtleSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICB0YXJnZXRCaW5kaW5nLm9uKCdjaGFuZ2UnLCByZXN1bHRCaW5kaW5nKTtcbiAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBzb3VyY2VCaW5kaW5nLmRldGFjaCk7XG4gICAgc291cmNlQmluZGluZy5vbignZGV0YWNoJywgdGFyZ2V0QmluZGluZy5kZXRhY2gpO1xuXG4gICAgcmV0dXJuIHJlc3VsdEJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJpbmRpbmcoa2V5QW5kRmlsdGVyKXtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBpZihhcmdzLmxlbmd0aCA+IDEpe1xuICAgICAgICByZXR1cm4gZnVzZUJpbmRpbmcuYXBwbHkobnVsbCwgYXJncyk7XG4gICAgfVxuXG4gICAgdmFyIGtleUFuZEZpbHRlclBhcnRzID0ga2V5QW5kRmlsdGVyLnNwbGl0KCd8JyksXG4gICAgICAgIGZpbHRlciA9IGtleUFuZEZpbHRlclBhcnRzWzFdLFxuICAgICAgICBrZXkgPSBrZXlBbmRGaWx0ZXJQYXJ0c1swXTtcblxuICAgIHZhciBkb3RJbmRleCA9IGtleS5pbmRleE9mKCcuJyk7XG5cbiAgICBpZihrZXkubGVuZ3RoID4gMSAmJiB+ZG90SW5kZXgpe1xuICAgICAgICByZXR1cm4gZHJpbGwoa2V5LnNsaWNlKDAsIGRvdEluZGV4KSwga2V5QW5kRmlsdGVyLnNsaWNlKGRvdEluZGV4KzEpKTtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUsXG4gICAgICAgIGJpbmRpbmcgPSBmdW5jdGlvbiBiaW5kaW5nKG5ld1ZhbHVlKXtcbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5zZXQoa2V5LCBuZXdWYWx1ZSk7XG4gICAgfTtcbiAgICBiaW5kaWZ5KGJpbmRpbmcsIGtleSk7XG4gICAgYmluZGluZy5tb2RlbC5fZXZlbnRzID0ge307XG4gICAgYmluZGluZy5tb2RlbC5fZXZlbnRzW2tleV0gPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGJpbmRpbmcuX2NoYW5nZSh2YWx1ZSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICBiaW5kaW5nLmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgbG9vc2Upe1xuXG4gICAgICAgIC8vIElmIHRoZSBiaW5kaW5nIGlzIGJlaW5nIGFza2VkIHRvIGF0dGFjaCBsb29zbHkgdG8gYW4gb2JqZWN0LFxuICAgICAgICAvLyBidXQgaXQgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkIGFzIGJlaW5nIGZpcm1seSBhdHRhY2hlZCwgZG8gbm90IGF0dGFjaC5cbiAgICAgICAgaWYobG9vc2UgJiYgYmluZGluZy5fZmlybSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX2Zpcm0gPSAhbG9vc2U7XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5hdHRhY2gob2JqZWN0KTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKGJpbmRpbmcubW9kZWwuZ2V0KGtleSkpO1xuICAgICAgICBiaW5kaW5nLl9zY29wZSA9IG9iamVjdDtcbiAgICAgICAgYmluZGluZy5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIHRydWUpO1xuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBiaW5kaW5nLl9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5kZXRhY2goKTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKHVuZGVmaW5lZCk7XG4gICAgICAgIGJpbmRpbmcuX3Njb3BlID0gbnVsbDtcbiAgICAgICAgYmluZGluZy5lbWl0KCdkZXRhY2gnLCB0cnVlKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLmRyaWxsID0gZnVuY3Rpb24oZHJpbGxLZXkpe1xuICAgICAgICByZXR1cm4gZHJpbGwoa2V5LCBkcmlsbEtleSk7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9jaGFuZ2UgPSBmdW5jdGlvbihuZXdWYWx1ZSwgY2hhbmdlVGFyZ2V0KXtcbiAgICAgICAgdmFsdWUgPSBuZXdWYWx1ZTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdjaGFuZ2UnLCB2YWx1ZSwgY2hhbmdlVGFyZ2V0KTtcbiAgICB9O1xuICAgIGJpbmRpbmcuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQmluZGluZy5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9O1xuXG4gICAgZmlsdGVyICYmIHdhdGNoRmlsdGVyKGJpbmRpbmcsIGZpbHRlcik7XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVCaW5kaW5nOyIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxuZnVuY3Rpb24gZGVyZWZlcmVuY2VTZXR0aW5ncyhzZXR0aW5ncyl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMoc2V0dGluZ3MpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgICAgcmVzdWx0W2tleV0gPSBzZXR0aW5nc1trZXldO1xuICAgICAgICBpZihpcy5iaW5kaW5nT2JqZWN0KHJlc3VsdFtrZXldKSl7XG4gICAgICAgICAgICByZXN1bHRba2V5XSA9IGZhc3RuLmJpbmRpbmcoXG4gICAgICAgICAgICAgICAgcmVzdWx0W2tleV0uX2Zhc3RuX2JpbmRpbmcsXG4gICAgICAgICAgICAgICAgcmVzdWx0W2tleV0uX2RlZmF1bHRWYWx1ZSxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS50cmFuc2Zvcm1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmbGF0dGVuKGl0ZW0pe1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGl0ZW0pID8gaXRlbS5yZWR1Y2UoZnVuY3Rpb24ocmVzdWx0LCBlbGVtZW50KXtcbiAgICAgICAgcmV0dXJuIHJlc3VsdC5jb25jYXQoZmxhdHRlbihlbGVtZW50KSk7XG4gICAgfSxbXSkgOiBpdGVtO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuLCBjb21wb25lbnRzKXtcbiAgICB2YXIgY29tcG9uZW50LFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKHt9KTtcblxuICAgIHNldHRpbmdzID0gZGVyZWZlcmVuY2VTZXR0aW5ncyhzZXR0aW5ncyB8fCB7fSk7XG4gICAgY2hpbGRyZW4gPSBmbGF0dGVuKGNoaWxkcmVuKTtcblxuICAgIGlmKCEodHlwZSBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgIGlmKCEoJ19nZW5lcmljJyBpbiBjb21wb25lbnRzKSl7XG4gICAgICAgICAgICB0aHJvdyAnTm8gY29tcG9uZW50IG9mIHR5cGUgXCInICsgdHlwZSArICdcIiBpcyBsb2FkZWQnO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHMuX2dlbmVyaWModHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfWVsc2V7XG4gICAgICAgIGNvbXBvbmVudCA9IGNvbXBvbmVudHNbdHlwZV0odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfVxuXG4gICAgY29tcG9uZW50Ll90eXBlID0gdHlwZTtcbiAgICBjb21wb25lbnQuX3NldHRpbmdzID0gc2V0dGluZ3M7XG4gICAgY29tcG9uZW50Ll9mYXN0bl9jb21wb25lbnQgPSB0cnVlO1xuICAgIGNvbXBvbmVudC5fY2hpbGRyZW4gPSBjaGlsZHJlbjtcbiAgICBjb21wb25lbnQuX2JpbmRpbmc7XG5cbiAgICBjb21wb25lbnQuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGNvbXBvbmVudC5fYmluZGluZy5hdHRhY2gob2JqZWN0LCBsb29zZSk7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5fYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIGNvbXBvbmVudC5fZmlybSl7XG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50Ll9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZGVsLmF0dGFjaChvYmplY3QgaW5zdGFuY2VvZiBFbnRpID8gb2JqZWN0Ll9tb2RlbCA6IG9iamVjdCk7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIHRydWUpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZGVsLmRldGFjaCgpO1xuICAgICAgICBjb21wb25lbnQuZW1pdCgnZGV0YWNoJywgdHJ1ZSk7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5zY29wZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBtb2RlbDtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gZW1pdFVwZGF0ZSgpe1xuICAgICAgICBjb21wb25lbnQuZW1pdCgndXBkYXRlJyk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50LmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xuICAgICAgICBjb21wb25lbnQuZW1pdCgnZGVzdHJveScpO1xuICAgICAgICBtb2RlbC5kZXRhY2goKTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmJpbmRpbmcgPSBmdW5jdGlvbihiaW5kaW5nKXtcbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudC5fYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFpcy5iaW5kaW5nKGJpbmRpbmcpKXtcbiAgICAgICAgICAgIGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKGJpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50Ll9iaW5kaW5nID0gYmluZGluZztcblxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbihkYXRhKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5fYXR0YWNoKGRhdGEsIHRydWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgY29tcG9uZW50Ll9hdHRhY2goYmluZGluZygpLCB0cnVlKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KGNvbXBvbmVudC5fdHlwZSwgZmFzdG4sIGNvbXBvbmVudC5fc2V0dGluZ3MsIGNvbXBvbmVudC5fY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiAhY2hpbGQuX3RlbXBsYXRlZDtcbiAgICAgICAgfSkubWFwKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiBjaGlsZC5jbG9uZSgpO1xuICAgICAgICB9KSwgY29tcG9uZW50cyk7XG4gICAgfTtcblxuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgaWYoaXMucHJvcGVydHkoY29tcG9uZW50W2tleV0pKXtcbiAgICAgICAgICAgIGlmKGlzLmJpbmRpbmcoc2V0dGluZ3Nba2V5XSkpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudFtrZXldLmJpbmRpbmcoc2V0dGluZ3Nba2V5XSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnRba2V5XShzZXR0aW5nc1trZXldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbXBvbmVudC5vbignYXR0YWNoJywgZW1pdFVwZGF0ZSk7XG4gICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBlbWl0VXBkYXRlKTtcblxuICAgIHZhciBkZWZhdWx0QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJy4nKTtcbiAgICBkZWZhdWx0QmluZGluZy5fZGVmYXVsdF9iaW5kaW5nID0gdHJ1ZTtcblxuICAgIGNvbXBvbmVudC5iaW5kaW5nKGRlZmF1bHRCaW5kaW5nKTtcblxuICAgIGlmKGZhc3RuLmRlYnVnKXtcbiAgICAgICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgaWYoY29tcG9uZW50LmVsZW1lbnQgJiYgdHlwZW9mIGNvbXBvbmVudC5lbGVtZW50ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50LmVsZW1lbnQuX2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn1cbiIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0bil7XG4gICAgdmFyIGNvbnRhaW5lciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIGNvbnRhaW5lci5pbnNlcnQgPSBmdW5jdGlvbihjb21wb25lbnQsIGluZGV4KXtcbiAgICAgICAgaWYoY3JlbC5pc05vZGUoY29tcG9uZW50KSl7XG4gICAgICAgICAgICB2YXIgZWxlbWVudCA9IGNvbXBvbmVudDtcbiAgICAgICAgICAgIGNvbXBvbmVudCA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gZWxlbWVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGlzTmFOKGluZGV4KSl7XG4gICAgICAgICAgICBpbmRleCA9IHRoaXMuX2NoaWxkcmVuLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgY3VycmVudEluZGV4ID0gdGhpcy5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgIHRoaXMuX2NoaWxkcmVuLnNwbGljZShjdXJyZW50SW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgY29tcG9uZW50KTtcblxuICAgICAgICBpZih0aGlzLmVsZW1lbnQgJiYgIWNvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9pbnNlcnQoY29tcG9uZW50LmVsZW1lbnQsIGluZGV4KTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIHRoaXMuZWxlbWVudC5pbnNlcnRCZWZvcmUoZWxlbWVudCwgdGhpcy5lbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLnJlbW92ZSA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIHZhciBpbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBjb250YWluZXIuX3JlbW92ZShjb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9yZW1vdmUgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgIWNvbnRhaW5lci5lbGVtZW50IHx8IGVsZW1lbnQucGFyZW50Tm9kZSAhPT0gY29udGFpbmVyLmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRhaW5lci5lbGVtZW50LnJlbW92ZUNoaWxkKGVsZW1lbnQpO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkgJiYgIWNvbnRhaW5lci5fY2hpbGRyZW5baV0uZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5yZW5kZXIoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29udGFpbmVyLl9pbnNlcnQoY29udGFpbmVyLl9jaGlsZHJlbltpXS5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhLCBsb29zZSl7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbnRhaW5lci5fY2hpbGRyZW5baV0pKXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuW2ldLmF0dGFjaChkYXRhLCBsb29zZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnRhaW5lci5vbignZGVzdHJveScsIGZ1bmN0aW9uKGRhdGEsIGxvb3NlKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW5baV0uZGVzdHJveSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29udGFpbmVyO1xufTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuKXtcbiAgICByZXR1cm4gZmFzdG4oJ2hlYWRlcicsIHsnY2xhc3MnOidtYWluSGVhZGVyJ30sXG4gICAgICAgIGZhc3RuKCdoMScsIGZhc3RuLmJpbmRpbmcoJ3VzZXJzfCouZGVsZXRlZCcsIGZ1bmN0aW9uKHVzZXJzKXtcbiAgICAgICAgICAgIGlmKCF1c2Vycyl7XG4gICAgICAgICAgICAgICAgdXNlcnMgPSBbXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuICdVc2VycyAoJyArIHVzZXJzLmZpbHRlcihmdW5jdGlvbih1c2VyKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gIXVzZXIuZGVsZXRlZDtcbiAgICAgICAgICAgIH0pLmxlbmd0aCArICcpJztcbiAgICAgICAgfSkpXG4gICAgKTtcbn07IiwidmFyIGNvbXBvbmVudHMgPSB7XG4gICAgX2dlbmVyaWM6IHJlcXVpcmUoJy4uL2dlbmVyaWNDb21wb25lbnQnKSxcbiAgICBsaXN0OiByZXF1aXJlKCcuLi9saXN0Q29tcG9uZW50Jylcbn07XG5cbnZhciBmYXN0biA9IHJlcXVpcmUoJy4uLycpKGNvbXBvbmVudHMpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKTtcblxudmFyIG1vZGVsID0ge1xuICAgICAgICB1aVN0YXRlOiB7XG4gICAgICAgICAgICBmb286ICdiYXInXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGVudGkgPSBuZXcgRW50aShtb2RlbCk7XG5cbnZhciB1c2VycyA9IHJlcXVpcmUoJy4vdXNlcnMuanNvbicpO1xuXG51c2VycyA9IHVzZXJzLm1hcChmdW5jdGlvbih1c2VyKXtcbiAgICB2YXIgdXNlciA9IHVzZXIudXNlcjtcbiAgICAvLyB1c2VyLmRlbGV0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4gdXNlcjtcbn0pO1xuXG53aW5kb3cuZW50aSA9IGVudGk7XG5cbndpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbigpe1xuICAgIHZhciB1c2VyU2VhcmNoID0gZmFzdG4uYmluZGluZygndXNlclNlYXJjaCcpLmF0dGFjaCh7XG4gICAgICAgIHVzZXJTZWFyY2g6ICcnXG4gICAgfSk7XG5cbiAgICB2YXIgYXBwID0gZmFzdG4oJ2RpdicsXG4gICAgICAgIHJlcXVpcmUoJy4vaGVhZGVyJykoZmFzdG4pLFxuICAgICAgICBmYXN0bignaW5wdXQnLCB7dmFsdWU6IHVzZXJTZWFyY2h9KVxuICAgICAgICAgICAgLm9uKCdrZXl1cCcsIGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgdGhpcy52YWx1ZSh0aGlzLmVsZW1lbnQudmFsdWUpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgIHJlcXVpcmUoJy4vdXNlckxpc3QnKShmYXN0biwgdXNlclNlYXJjaClcbiAgICApO1xuXG4gICAgYXBwLmF0dGFjaChtb2RlbCk7XG4gICAgYXBwLnJlbmRlcigpO1xuXG4gICAgd2luZG93LmFwcCA9IGFwcDtcbiAgICB3aW5kb3cuZW50aSA9IGVudGk7XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgIGVudGkuc2V0KCd1c2VycycsIHVzZXJzKTtcbiAgICB9KTtcblxuICAgIGNyZWwoZG9jdW1lbnQuYm9keSwgYXBwLmVsZW1lbnQpO1xufTsiLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmYXN0biwgdXNlclNlYXJjaCwgc2VsZWN0ZWRVc2VyLCBkZWxldGVVc2VyKXtcblxuICAgIHJldHVybiBmYXN0bignZGl2Jywge1xuICAgICAgICAgICAgJ2NsYXNzJzogZmFzdG4uYmluZGluZygnLicsICduYW1lJywgdXNlclNlYXJjaCwgc2VsZWN0ZWRVc2VyLCAnZGVsZXRlZCcsIGZ1bmN0aW9uKHVzZXIsIG5hbWUsIHNlYXJjaCwgc2VsZWN0ZWRVc2VyLCBkZWxldGVkKXtcbiAgICAgICAgICAgICAgICB2YXIgY2xhc3NlcyA9IFsndXNlciddO1xuXG4gICAgICAgICAgICAgICAgaWYoIW5hbWUgfHwgIShuYW1lLmZpcnN0ICYmIH5uYW1lLmZpcnN0LmluZGV4T2Yoc2VhcmNoKSkgJiYgIShuYW1lLmxhc3QgJiYgfm5hbWUubGFzdC5pbmRleE9mKHNlYXJjaCkpKXtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3Nlcy5wdXNoKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYodXNlciA9PT0gc2VsZWN0ZWRVc2VyKXtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3Nlcy5wdXNoKCdzZWxlY3RlZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZihkZWxldGVkKXtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3Nlcy5wdXNoKCdkZWxldGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBjbGFzc2VzLmpvaW4oJyAnKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG5cbiAgICAgICAgZmFzdG4oJ2ltZycsIHtzcmM6IGZhc3RuLmJpbmRpbmcoJ3BpY3R1cmUnLCBmdW5jdGlvbihwaWN0dXJlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gcGljdHVyZSAmJiBwaWN0dXJlLm1lZGl1bTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLFxuXG4gICAgICAgIGZhc3RuKCdsYWJlbCcsIHtcbiAgICAgICAgICAgICdjbGFzcyc6ICduYW1lJyxcbiAgICAgICAgICAgIHRleHRDb250ZW50OiBmYXN0bi5iaW5kaW5nKCduYW1lLmZpcnN0JywgJ25hbWUubGFzdCcsIGZ1bmN0aW9uKGZpcnN0TmFtZSwgc3VybmFtZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZpcnN0TmFtZSArICcgJyArIHN1cm5hbWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KSxcblxuICAgICAgICBmYXN0bignaW5wdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogZmFzdG4uYmluZGluZygnbmFtZS5maXJzdCcpXG4gICAgICAgIH0pLm9uKCdrZXl1cCcsIGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICB0aGlzLnZhbHVlKHRoaXMuZWxlbWVudC52YWx1ZSk7XG4gICAgICAgIH0pLFxuXG4gICAgICAgIGZhc3RuKCdkaXYnLCB7J2NsYXNzJzogJ2RldGFpbHMnfSxcblxuICAgICAgICAgICAgZmFzdG4oJ3AnLCB7J2NsYXNzJzonZXh0cmEnfSxcbiAgICAgICAgICAgICAgICBmYXN0bignYScsIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dENvbnRlbnQ6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJyksXG4gICAgICAgICAgICAgICAgICAgIGhyZWY6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJywgZnVuY3Rpb24oZW1haWwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdtYWlsdG86JyArIGVtYWlsO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIGZhc3RuKCdwJywge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0Q29udGVudDogZmFzdG4uYmluZGluZygnY2VsbCcsIGZ1bmN0aW9uKGNlbGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdNb2JpbGU6ICcgKyBjZWxsO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApXG5cbiAgICAgICAgKSxcblxuICAgICAgICBmYXN0bignYnV0dG9uJywge3RleHRDb250ZW50OiAnWCcsICdjbGFzcyc6ICdyZW1vdmUnfSlcbiAgICAgICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICBzY29wZS5zZXQoJ2RlbGV0ZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIGRlbGV0ZVVzZXIoKTtcbiAgICAgICAgfSlcblxuICAgICkub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgc2VsZWN0ZWRVc2VyKHNjb3BlLl9tb2RlbCk7XG4gICAgfSk7XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIHVzZXJTZWFyY2gpe1xuICAgIHZhciBzZWxlY3RlZFVzZXIgPSBmYXN0bi5iaW5kaW5nKCdzZWxlY3RlZFVzZXInKS5hdHRhY2goe30pO1xuXG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0Jywge2l0ZW1zOiBmYXN0bi5iaW5kaW5nKCd1c2VycycpLCB0ZW1wbGF0ZTogZnVuY3Rpb24oaXRlbSwga2V5LCBzY29wZSl7XG5cbiAgICAgICAgZnVuY3Rpb24gZGVsZXRlVXNlcigpe1xuICAgICAgICAgICAgdmFyIGRlbGV0ZWRVc2VycyA9IHNjb3BlLmdldCgnZGVsZXRlZFVzZXJzJykgfHxbXTtcbiAgICAgICAgICAgIGRlbGV0ZWRVc2Vycy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgc2NvcGUuc2V0KCdkZWxldGVkVXNlcnMnLCBkZWxldGVkVXNlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcXVpcmUoJy4vdXNlci5qcycpKGZhc3RuLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpO1xuICAgIH19KTtcbn07IiwibW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9W1xuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJzY2FybGV0dFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGVhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjY3MSBjb3VudHJ5IGNsdWIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZvcnQgY29sbGluc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImRlbGF3YXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU2NzI0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJzY2FybGV0dC5kZWFuNDBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGJpcmQ2MThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNpcmNsZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJUT3l1Q09kSFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjJkM2UwZGMwMjBhODI2ODk4MTAyYzZlY2Y4YmI2MGUyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjAxYmE4ZWNiZjNhMTM3OTQxZjRlOGI2NjUwZmI0YjljNmFiY2E3ZjhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkNTZhMWNmZGJjYWYzYTI4ZTE3ZTEwYjhjYjExY2UwMThiNGJhNzMwYmM1YmJlNzIwZjYxNzQ1MWYzNmE4ZWNlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNTUyNDk5MTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMzMyNDUwNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEwMiktMjEwLTkzNTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ1NyktNzY5LTc2ODhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2NzYtNzMtOTc2NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzJkYmY3MmZjY2UzNWJkZlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXJnaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhcmRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY1NDQgdyBkYWxsYXMgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxhbnNpbmdcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtb250YW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYxODU4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJnaWUud2FyZDI4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJ0aWdlcjQzM1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaGloaWhpXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjhDZDZ5eXFUXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2QzZjI5MzI4Y2Y0MzdjMTExYzE5N2JhYjE2Mjc3MjlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOGFmZTI2NTk2ZTJhMzg5ZDRlYTBmZmIzNjYxOTEwYzE0YmE4MGQyOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhjYzhmOTc3NWU2ZDFmZDdhZDM4YWY5NTU5OTEyZWFhMzI2N2Q4MjJhMTkyNGQwNTJjYTBiYjRkNDdkYTBmY2RcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTI1MzA4Njg2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzA1MDQ3ODk0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTY3KS01MjUtMzkzN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTI5KS00NTctOTI1MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQwOS00Mi03Njg0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwZDdhY2ZmNjhkYzU3MzU4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXJvbGluZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWlsbHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ3NjMgaG9nYW4gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW5kIHJhcGlkc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc1MDEzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYXJvbGluZS5taWxsczE0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbHJhYmJpdDk0NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidmVuaWNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImRiNVYydHVrXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZGY4YzllZjA2N2QxMzVjMTdiNDVjMmQ1MDhhOTc3MGNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiODg1MjZlZDQ1NzkzYWFiOWFiN2YzMjJhOWFmMTFhN2E4ZjdkNjAxZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNhOTdiYTdlNGU2YTI1ZDBmZWIzMTJkNDA3OWU4N2ZmN2E1NmZlOWIwMmJmZDJiM2Q0NDMyNjA0OGZiNzJmNmRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI4MTY1MjIwNFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjYzNzIzODU4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjM3KS01MTItNjU1MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTU2KS04NjYtNDg5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0MC0zMy02NTY5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlOWE1NDE3MGNjMWYzY2FlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia2F0aHlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBlcnJ5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MjIyIHBlY2FuIGFjcmVzIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjdXBlcnRpbm9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJwZW5uc3lsdmFuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTQ0NTJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImthdGh5LnBlcnJ5OTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2tvYWxhMzYwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmcmVlemVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiR2RmcDAzMXNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0YTkzMDA1NjRkM2M0N2M0MDQ2MzlkM2EyYjU5ODNlMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwYjUxZjgxYjE2YTE2YTZjOGU3NmE3OWFhMDA3ZGMyMmFkNzg3Mjg3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmQ0Yjc3MjRiMzlkY2VlNzQ0YTI2MDI1NjU3NzEwZDY3MzI1YzdjNDc5N2M0YzBhOTgxN2ZhZTdjOTYzM2I3M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDExNDk5NDczXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU4MTM5MzIwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODIyKS0zMTEtOTM2OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTM5KS0zMTAtNDk2MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ4NC01Mi02MTU1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwNzZmZTI4NDdlYjNjNzhkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1hcmlvXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJuZXdtYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQzMDQgcGx1bSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmV3IGhhdmVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicmhvZGUgaXNsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgwNDg2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJpby5uZXdtYW43NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmVhdXRpZnVsZmlzaDQ4MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYWlraWRvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIk9ROHd0bHFnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOTMzZjY5NWEyN2UwYWVjYzQwZmMzNTNmZGJiY2IzNmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjJlNmUxOTRkYzBkNDFkNDBmMzAxY2M3NTlkODY3YWQyZGU1YTVmY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjgxNTUyYjE4ZTY3MmIyYWQwN2RhMDkxZDkyZGQyMWYzNzk0YmRlMWQ2OGU4MjQyNDdlOGYwY2QzNjNhODBkZjlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE0NjA3MDMzNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2Mzg3ODQ4M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDUyNiktMjQ0LTI0MjdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkxMiktMjk2LTcyNjZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MDMtOTYtODcwMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8wLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMWM5M2RkMGY1NjA0OTExZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJuZWxzb25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImtlbGxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODUzNCBlIG5vcnRoIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmVlbGV5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2Fuc2FzXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY2NzkyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJuZWxzb24ua2VsbGV5NDNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlsYWR5YnVnNzI1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXJvbGluYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJQZ1VTMmpJUVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjI2NzJlY2UwMTgwNzk0Njk3NzM3NjMzMjg1ODZjOGE3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjBlMGRmNGE2MGJmZWJmYjNhNGZhODcxNzQ5Yjc2MWM5YTYzOTg4OWJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YTU5MWQ4ZGFhN2JjNDhlNTg0Y2U1ZDkwYmJkZGUyZGJjZjA3NTVmM2Y3OTM5YzcxMTVhMzVkZTdhYTBhMzk2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMTY1OTc5MDVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzQ0NDQ0NDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjQpLTc5OC02OTQ4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2OTIpLTExNi04MzExXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzczLTg4LTY5NzNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdkZTk4MTlmNDY1NDM4YmRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYnJhbmRpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibHVjYXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjYzMDYgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRldHJvaXRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3YXNoaW5ndG9uXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE1NDA4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJicmFuZGllLmx1Y2FzNTZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZHN3YW43ODRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImpvYW5uZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJrSTZKVEdyWVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNkNDVkMWQ0MmJkZWI3NGRjZDgyY2E3NmFiMGQ3MTMyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjVmZmJhMTEzY2IzMzRhNmJhZjFjYTllYTZlMmVkZDdkYzZhZTQ2MzZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhZTJiZDU3NmU3MmMyYmUwYTg1YTA2ZDNlZTU5YTA2M2ZkOTdmZWFmODMwNjhkNTFkMzM4N2M5MzNjMGQ3MmFhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMDE5ODAwOTBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTM5NjAxNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU4NSktOTY4LTE3NzJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDgzMiktNDQ1LTc5NDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NjAtMTEtMjQ3NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2YyNDllNDhkOWZlNTNiOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJuaWNob2xhc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2VsbHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjExNTggZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2FsZHdlbGxcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpbmRpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU4NjM5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJuaWNob2xhcy53ZWxsczg2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dmaXNoNDEwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJiaWdvbmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiaFFGRUY4UURcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2MDk4NThjNzU3NGRiMTQxOWRkNWFmODc3ZmFjYWNkYVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3Nzk2ZjI5ZDIyNjUxNjdlMmEyZTA5MGE4YjY1MzExZjNiMmE1ZGNiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDllZWVhYjBiNjFlMGFjMzdjM2YwM2I3YTNiZGFiNDhiOWMxMThjZjAzODg1YWNmNTU3NmMzYjAxNTNjM2NkNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDgxNzYwMjg0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDY0NDgxMzc5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzk0KS01NjMtNTM4NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjEyKS00ODItODAzM1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIxNy0yNS0yOTU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3YjZjZjRiNTQ3YzJkZTJhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidGFueWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRheVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTYxNCBtY2NsZWxsYW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImpvbGlldFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNhbGlmb3JuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDc2MzFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRhbnlhLmRheTE2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2VwZWFjb2NrNTM4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXNoXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlBLY2FWb08wXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2MwZmUzMzBlZWQ0MTFhYzE0N2RlMjI2ZDdkNWE1YTNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzdhZWE4NGE2M2E4NmJjOTMyMjQ4Y2IwZDE4MWI0M2U2ZjBmYjM5MlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjMyNGFmZjM4YmE1MmU4NzAwZTk3MWIyNDQxZGVjNzgxMTMyYWViYzExN2ZkMjZiYzVkM2JmMDJmODFhMzUxMjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzNTc3MjA2M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjkyNTkwMzI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODIwKS05MjEtNjE5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzQzKS03MzMtOTUxMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgyNi00Mi0yMDM5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkOTk0MzAxNzYyYmRmMDEyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1heFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ2FycmV0dFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDUzNyBsYWtldmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibWVzcXVpdGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYXJ5bGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2ODIxNFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWF4LmdhcnJldHQzOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVjYXQ5OTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm9yZ3lcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMEZDbXBlQWVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhZGZjZTAwMTlhOTAwNGMzNjliNmQ1ZDlmNDMzNGNiMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5ZmExODUyM2E5MjM1NWE0YmYxOGI1ZWRhNmI3MzU3ODEwMTJlNDE2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZDk0ZjdiMmZkYjg2MzdmZDVjMmQxOWYyNGFkOGQ4ZGY2NDZkNjNhMTlmZGY4MTE2ODBiYTU2ZGI2YzZjZTA4OVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc2NTMwMzU0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc5MjYzOTc0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTc1KS0yNDMtNTQzOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzI3KS05MzgtOTI0M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ5MC05NC04NjYxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3MzBjODI4MjZkMmQ4YTEwXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImplcmVtaWFoXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhbHZhcmV6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNzAzIGVkd2FyZHMgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJlZCBibHVmZlwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImxvdWlzaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MjY0OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamVyZW1pYWguYWx2YXJlejc4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGV3b2xmNjY0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJib2IxMjNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZmV1RUtLVFpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkYzY2NDJiOTkxZTA0YWM4MDJkY2UzODhlNDkyOWNhNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1ZThlZjA2OTNiODE0ZDgwYzIxNWM3YzBhYzBlZDAwODhhNzFmNjRmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNTBmYWJkNzUyYmIyYTU4YjNhNmNiODRhN2Q1N2RmODk0MmJlZGFkYzQ3YzE3MTc2MjgzNTVhOWNhNzA0ZTBhNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjEwODAxNTAwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDQzMTk4NTc4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzI1KS01ODktOTc2MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTYxKS04MDUtMTE1NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjM0MC01NS03Nzc3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmNzc1MjFlZjNjODdhY2MyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNvcnlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRhdmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTgxIG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJha2Vyc2ZpZWxkXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2hpb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MzM0NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY29yeS5kYXZpczUyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbndvbGY5MzVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjE4NDM2NTcyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInJPZmpsamhnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZmMxNWQ5ZWFmN2VjOGJiNWQyZjMzMmY2ZTdmMzU4MDdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTAxMTBlM2RiYjIyNDNkMzgxNTExNzhiYzIyOTRiNWViZDRmYTYzYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhjYTI3MzZmNjQ4MjA3NjEzNDZiZGUyODgzZjU5YzBkZGNmOGY3ZWNkYjQwOWUzMmQ5NzRhZDM5NGYzMjFkNzFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI2MzUxNjYyOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQzNDk4NDEzM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk0NSktMzM4LTk5NzJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ0OCktNjMyLTUwOTRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMjAtMzItMjgzMFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzg5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vODkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzg5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTNiNDM4ZDRkMGFmOGFmNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFiaWdhaWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdyYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI4MjQgcGFkZG9jayB3YXlcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm1lZGZvcmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxNDU0MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWJpZ2FpbC5ncmF5NjdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ3dvbGY3MjFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIndlc3RvblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJBRlVLR1Z6RVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjBmMzc5OWIwNWQwOGZlN2I5OWE0NGE5NWY5Y2NmY2E4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjY0YzhhNDkzYmYwOTA1NTUwYzdiZDBjODFhNGI5NjJlMDJhMzcyNGJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2NjRhMWY3MWNiZDdjZjY5OGVmYzUwMTZjNWU1ZmM0OGExMzU2MDU3NDFjZWFlNTJjYWEyZTk2ODYzZDA0MTA3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzI5OTc2OTFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzE2NTAyMDRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3NjgpLTY0NS0yMzQwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MjkpLTQ0NS01NTIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTM0LTg3LTk1ODJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwNTViYzgyN2YwYmEwNzdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamVmZnJleVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicnVpelwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDMwMyBtYXJzaCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2xldmVsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYyOTY3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqZWZmcmV5LnJ1aXozMEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlY2F0MzI4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3b21ibGVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibWM0V0J5YlpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3ZWE1MWM3MGYwZGRlODFiYTY1OTIxZmRiZjA3MDc4NFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJkMjQwYTQ2Y2U1MDRmODg4MTFkNzQ0NjEwMDZmOGY4ZjhkMDE2YTg4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2ZmN2YzODVlMWRiZDhkZmUwZjdhMTVjY2NmMWJmM2JiYjRjZjAzNDQ1ZTBkNjI0NTgzNGM4M2MzZjVjNzcwNFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzkzMDI1MjA5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM0MDgzNDQ5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzE5KS01MTQtNTk3M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTA1KS03MzgtNTE3OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIyNy04Mi0xOTUxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwMjJkYTVlNjE0NDU5NGE2XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicm9nZXJzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NDc4IHRpbWJlciB3b2xmIHRyYWlsXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb2x1bWJ1c1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndhc2hpbmd0b25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTMwNzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphbmUucm9nZXJzNjBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJlYXV0aWZ1bGxpb240NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaGlnaGhlZWxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwidEtZekJiaUZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3N2VlMjY2MjQ1OWRmOGU3YzVjNzEzOGYzZmI3ZDA2ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2YzYxMzIyOGEwNWQ3MDI4N2ZjZjY2ODdhZTE0NDE5OTZhMGMzM2M0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDY1M2U5NWRjMzE1OGI4MzU0NTM2YmNlYzY4NDM1NjA4NDEwNzFmNDRkOGUzZDQyODNhMjMyMzMyN2FlNTk3MVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NDcxNjE0NTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI3NTcwMzc4M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMxMyktNzY3LTU2NjVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyMyktNDExLTE0MzNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1ODItMTUtNTI3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODY0ZWNmZjk5M2IxYzRiY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFyaWFubmFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1pbGVzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNjQxIHN1bnNldCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbmQgcHJhaXJpZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImxvdWlzaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2OTUyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYXJpYW5uYS5taWxlczU0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eWR1Y2s4NzlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJpZ2Zvb3RcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMk1rN05yeFBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjYWQwNjE3NmZmZjhlNmRlYzM0OGMyZjFlMDQwMzk5ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3YjdiMTEwMGE0YjY4NDk5OTNhMGNhNTRmZTVmNDk4ZjYwMDg2MGVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDM2YTJhMmMwZWIxYzNiN2JkZWQ2Y2FmNmI2NTBlMDJlMjAwZWJiMzA0NDVhZjhhNmE3MzFlMTYyNGNiOWU4M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDkyMTQyMjg0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDU5OTYzNTk3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTI5KS03NDAtMjc1NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTUwKS00OTktNjQ3MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc5NS03Mi02MzIxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4N2ZmZGQ1MWQ2MjExNDJhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInZpY2tpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FycGVudGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzODI5IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyb2Fub2tlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid3lvbWluZ1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MzgyMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidmlja2llLmNhcnBlbnRlcjEwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dwZWFjb2NrMjQ4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsYW5jaWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibmRMVW1JUEhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1ZTQ5M2YzOGJhMjY3NDE4MDFlMGRmODhjNmEyYWYxNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwZTZiZmM4YzA3MDE4Yjk5ZmRkOTgyMDk3M2JkYTk0ZDQxNWM1MjllXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNmFjNDBkN2YzMGU1NTY1ODRhNzRiMDE4OWJmZjk0M2RmY2YyNWU2MzQzMjU0MWUwNTY5NjM4NWMwYzExMjk3NlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzc0MDYxMDc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjg3MzI2NjE2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzQ2KS0zOTUtNzg3NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjA2KS02NDUtMjcwOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY4MC0yNC0yMjI1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwYzdjYjE0ZjFmODg3ODc3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFsbGlzb25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjU4NiBwbHVtIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFudHMgcGFzc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyB5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg5MDA4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbGxpc29uLm9saXZlcjUwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlcGVhY29jazExOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibWFuZ1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5S2ZpNk10U1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRlOGY0NGVlNDU5ZjljNTFkODk0OWFhZjFlYmYwMjM1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIyM2IyMDFmYjA2ZGEwZTNmNjY4OWM1Nzc2NTE2N2NhYzU4YWI4MjVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmZmNkMWY5ZDY0Y2I4ZjAwNzU3MzNiZTY5MTJlYmE1ZTBkZGRiYTI1YzUyNzFlYmQzNDQ3NTY3NzE0Y2M1Nzc5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNjcxNzc3OTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MjE0MjYzMDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MTcpLTI3My05Nzk3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyNDcpLTI4OS05NzY1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzA0LTcxLTY5NjlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzMzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zMy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjgzODQ2MDAwZTEzZjJmNGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkZWFublwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmF0ZXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc0MTQgdyA2dGggc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV2YW5zdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvaGlvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjk1MDQ2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkZWFubi5iYXRlczk2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2Vrb2FsYTY4NVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZ2lvcmdpb1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJzaEtDRENXMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImZjZmIzYjkzYWZhMGZmMzIxNjBiMTkzYzBjYjNmMDM4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA0NmE2ZGMzMDQwZTVkZmE5N2Y2ZmUyMWQ4M2I3MGY1YWZiY2EyZTlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkMzMxNWQ2NjAwMTczYTNmMmJhNWZmMDIwYzk5YzViMDQwYjg4OWQzNDliZjgzMDgzNTJmYjY4MmYzN2I2ZjdmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTExMTI2NDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTk0ODkwNDFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1OTIpLTM1Ni0zMjUxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2NjQpLTIzNS00MTI0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDQzLTQzLTk3MzVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80OS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjkzZjg4OWU1M2QxNDA2MzRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1pbGRyZWRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZyYXppZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjMwMjYgcmFpbHJvYWQgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFyeWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODM1NzdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1pbGRyZWQuZnJhemllcjE4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWJ1dHRlcmZseTU3MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaG9vdGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjBlRnBGV1doXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNDUyMjUxMTgxMmExZTIwYmVlYTAzYTI1NWRkYzY5MzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjMyODYyZmVlMDRlZTA2MTNjYjdiNmQ4YTZkMDg2MDcyZjk3YThjZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIzMzJlMjc4YjM0ODZkZjA0ZWNlNDFhYjc2MWM0ZGZlYmNiODczYjYyODhlNzljMTZkZWE2MWY4N2U5OGE1ZmRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzNDk3ODAwMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5NTcyODg3NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQzMyktMjU0LTgwNjZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQwMSktMjQwLTE1NTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NTQtMjktODAxNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjMxMTQ1OTIxNDRjNjFlY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxlb25hXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJncmF5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MjUzIG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV2ZXJldHRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNjIyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibGVvbmEuZ3JheTYzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja29zdHJpY2g3OTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNsaXBwZXJzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImZRaldraU95XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjU3MzQwZTczNWY3YjA5ODc0ODFlZmIzOGY0MjBjOThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNTI3NGIwODQ5YzBlYWQ4ZGVlZmYwYmVhNzliY2RhYzhhNzZjNGMxYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjBjYjhlMTVkMTMxNzk3MmRhMDk2YzMxYjE5OGExNmQ2MzkwZGU4ZDdmMjRjZTZiMzRlZjk3MzY1YWNjZWYzODRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzOTg3MjM4OFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE1MzE2MDMxM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MCktNzM4LTI0MTZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDczMyktNDA3LTMzODhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MDktMjYtOTI0MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzE4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzkzZWYyMjZjMmYwOGVhNlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrZWxseVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9udGdvbWVyeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODc2MiBwYWRkb2NrIHdheVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic3RvY2t0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTE5MjFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImtlbGx5Lm1vbnRnb21lcnkyOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYnJvd25sYWR5YnVnNTEwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwb3NzdW1cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMERQclNvMmtcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxOGQ4Mzk5MTEyZDY1NjkyMDEzZDRhNzkzNTM2YmY3NFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZDUwM2ZlZDljMzMwNGJlY2VkMWFjOGNiYzZjNzI5MjhmZTI4MTgzXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMzIzNTZkMzcxNzEyZjg2MzRmNjFkYWY3OTA2ZTVhY2I2YjliZWZlZGIyMzM0NzEyY2U0NDA1NzU5ZmJmYWE3MVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTgwODQ5NjE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc2MzI1MzA4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODQ0KS02MTktOTY2M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzg1KS03ODctOTgxMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIzOC05Ni03MDczXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2MWI0NWMxMTk0N2I0OTE4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvZ2VyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJraW1cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI1NTUgbGFrZXZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZyZW1vbnRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtb250YW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg4OTE1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb2dlci5raW01OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVybGlvbjQ0M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamlsbGlhblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJZdHlGTktJVFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NjcwOTNkZWVhMzlhMjM3MmZmMDYyMWUzYzRhNzMxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjNjYmZjMTJhNzJlOWE0NjUyN2U2YTdkYjcwMmI4ZmMwYTJmMWM0YjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiMTlkZTBhZGNkYmNmYTYwMjg4M2EyNGM4NWY1MzY3ZWZlNDAyZDgzY2VlMDkwNWMwMmIwZjFhZjY2ZWNjYzRhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMjU2MzQ5NzZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNDA4NjY3NTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MzQpLTc2Mi02Mjg3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1NDUpLTgwOC00Njc3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjQ0LTgxLTExMTNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImE1NWE2Zjk2ZWZiZjIxODhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW1hbmRhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmbGVtaW5nXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNjM2IHcgZGFsbGFzIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZW5kZXJzb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJzb3V0aCBjYXJvbGluYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNTYzM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW1hbmRhLmZsZW1pbmc3MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmVhdXRpZnVsb3N0cmljaDU5M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic21pdGhlcnNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiTU1zdWVlNk1cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwODVmOWM0MGRiYjYzNzM3YjA3OTY4OTY3MTliNjgyY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxYzkzNjlmMjU5MjZlMTA2ZTYxZWRmNzM2YjAxYzI1NTZlMzQxNWVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNWMxMGQyODg3YmExYzhjOWNhNGNjMjM1OGZlOGIzNWMzMGEwNjRkZGY2NmQ0ZmE3ZjE4MWY0NzIxNmE2NzE0ZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzc5Njg3MDUzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM0NTA0MTEzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzI2KS01ODItNzMzNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTI0KS01NTUtMzE5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0Ny05Ni02OTI1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzMGM1NThmY2E2NGI5MDZhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRlYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImN1cnRpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTE3OSBzdGV2ZW5zIGNyZWVrIGJsdmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1cmVrYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGNhcm9saW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI1NTI5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkZWFuLmN1cnRpczgzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGxlb3BhcmQ1NDdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImRlbW9cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiNmtYOUVXUWhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjYTgxNzk5ZmNiZWNmZjNiZWM3N2Y1MWY4MjMzNjcxM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMzBiYWYxMWFlNDBkZTE0NzkwOWU4ZGNhNWQ0OGE3NWJiNmYxZjhkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDVlNzEwMWY1MGIwYTU2NTE0ODQyNjYyYTdkNWIzYjNjMjQ4ZDM2NWJjZTVlYjg3NmQ2ZmIxMjQzMzU4NDNkZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDE4NDUwNDE0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTQ5OTE4Mjg3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjI1KS00OTItNjYyM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjMyKS00NzYtMjQ0OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgyNC0yNC0yNzYwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ZDc3ZDU2OWZmMjlmZDk4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidmFsZXJpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmVja1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTQzMSBjb2xsZWdlIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTIzNjVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInZhbGVyaWUuYmVjazE5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlbGVvcGFyZDEwN1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamFtbWluXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJZMHplS1Y4XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMTcyMzA2OTUwZWZmNGRmZWZlMzRkMWZlZGQyZDFjMDNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzhkNmU2OGNiY2ViM2M4NWY1NTM3YmQ3OWU1MDY5MzI3OTFlYjY3MFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIwZjFhYTQyN2RjMzhlMTg4ZDc1OTQwYWE0NmY5YzkxN2IyZGUyOWRkMWEzNjY2MWRiNDFiMTIxZDZjZDVhMzhcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM3MTMzNzYzOFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjcyOTIwMzExXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjQzKS03NjktNDczN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODY3KS0yMTAtNzE4N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcxMy03MC05ODc2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NWUyMjVhNzEzMWY4ZWI0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRhcnlsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzaGF3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNTQ2IGthcmVuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGJ1cXVlcnF1ZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInd5b21pbmdcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzg1MDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRhcnlsLnNoYXcxNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWZyb2c1NjVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZsYW1pbmdvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkl0RDByMVdGXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNDhjNTEyNjMzMzMyOGQ4ZTVhMzM0OTBmYTQzNTIwMTdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMTlhNjRkZGViMjliN2FkYjY1NDAzYWY0YzgzZDY5N2Q3MzM0OWU4ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjk0ZmYyZDIxNzlhMjI3ZDU5OGE1ZGE0NDg2ODE4ZGI5ZDU0NDUxZGZmZTAxMjYxMTQ2YmQwMTljY2Q3OTUyYjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTQwNDU1ODEzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTEzOTUyNTg0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTQzKS0xNzQtNTU0NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzQyKS0xMDMtMjAyOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg0NS00Ny0yNDY4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjYjUwZTE0OTM1YTAyNGYxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicGVnZ3lcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDgyOCBtaWxsZXIgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmbG93ZXJtb3VuZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBtZXhpY29cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODc1NDRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInBlZ2d5Lm9saXZlcjUwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGxlb3BhcmQyNDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInN0cmF3YmVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImZGaW9kZmp1XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmQ4MGFiZDAyZjAwMWVhYTc1YTdjNzFmYzAyNjQ1OTZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjg4M2QxYjJmYzM0NjY2MWY1YWI4Mjc0Y2UzMTc2ZDU2ZTA4MmJhMVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjJhMjliYmI2NDNlODZiMGY1MjljN2Y4NjM2ZDMzZTc1YjIzZmM4YjkxN2M0OTNkZjFlYTZhYzRlMDNhNjY5YjNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA0NjM3NDM3NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ3NDU3NTU3NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMzNCktNjg3LTEwMjJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMwMiktODQyLTU4NDdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MjctNTItMjQ3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTdkZjE5ZGM4ZDEzNjA2MVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbGxhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicmV5bm9sZHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk1OTggd2hlZWxlciByaWRnZSBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYmVsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhbGFza2FcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjQ0NjRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFsbGFuLnJleW5vbGRzNDdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpbnlmcm9nMzA3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ2aXBlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLY0JheVFHVVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0MTlhODQzMmY5MTRhZDg5MzBmZjk5ZWNhNTVjMDU4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImVhYWUyNmE3OTdiZjY4Yjg2MzYwNGRjZTMyYzIwZGE0YzViNjNlMDdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3M2VmNmMyYzFlYjQ4ZDQ1MzFjMDZlOGI4NzQ0MTI5MzZmNmI0ZTk1NzA0MmYyYzNiNTYzNzVlNjU0YjU0MDc3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExOTAyMjYwOTBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMDA2ODc3ODZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MzEpLTkxMi0yMzY3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4ODEpLTQ5My05ODkzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjUxLTg4LTE0NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJiYTFhODJlMTIxMzRhNDlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ6b2V5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYXJyaXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk4MDgga2FyZW4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNhY3JhbWVudG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3aXNjb25zaW5cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTE3MTdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInpvZXkuaGFycmlzODlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZnJvZzI5NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidGl0dHNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiTGNyQnBDek9cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhOThmNDM4ZDJiNDljNmJkMzVjN2ViYjk0YzRhY2M4ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlNTYwNDBjZDc3OTgxYzRiMmQwMjY2M2Y1ZmE0ZjkxZmEyMTgxMjhmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDhiNTQ0ODk2M2RiMjBjMGJkODRlNWYxOWNkZWFlYmE2MWE3MDRmNDlhMDI4ZjY2OTZiYjBlNjIwZTQ3NTg5MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDA3MDk3MTMzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzQ0NDU2Njc0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTI4KS03ODktMjYyM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTM1KS04MDctNjUwNlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE1NC04Mi01NTM5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkN2Q1ZjFhZThjYzMxNDRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNoZXN0ZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImx1Y2FzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyODAzIHcgYmVsdCBsaW5lIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyZWQgYmx1ZmZcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpZGFob1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NTY1NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2hlc3Rlci5sdWNhczIwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlZG9nNTYzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwaWN0ZXJlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImtvZmp1QnZnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWE0Nzc5ZDdjY2Q3YTMxZjc4OTYyZjM3NmFjMmFlN2NcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTdhZTNhNjI1NmQ2NzY1MTc4ZGE5MTMyMGFmOWUxY2RkODVkMTNiY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImEzZTZiNmViYzZjZTEwMDczMDY5ZmEwMTZlNmRkY2EyNjFmYjA0ODkxNzY1Y2ZkZDExMzZhOGI4ZTZhM2YwMWZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTUwMjgyMzkzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzUyMjg3OTYzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTg1KS0xMTUtMTExOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTY3KS0zMzAtMTY4N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg3My04MC0yMzU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNDcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi80Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNDcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMWVhYjFmZGYxYzBhZDRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNoZXJseVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3V0dG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MTEzIG9hayBsYXduIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29wcGVsbFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc4NDcxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjaGVybHkuc3V0dG9uNTdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImhlYXZ5bWVlcmNhdDk1MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiNzI3MjcyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlZKNGJ6MVhFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDk1ZGM1YTc5MjRmODUwZjg3YmY2Y2IzM2MyOWY4MzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiY2U2MDExY2M4Mzc0YzJiMTA5ZmMyMjA1ZjU2MjlkZTRiMGJkMDYwYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjZiZjM1YTdlNWNjMDAyNjg2OWQzYjJhOWUwOWU4YmEzNTQxYjJiM2UwNTUxNWNmMTFmMzJhYzkwZTJmNmQ2NDZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTEwNjMzNjk3MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMyNjc1NDQyM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMxNiktMjY3LTUwMjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ5MCktNjU0LTU2OTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNDAtOTgtMjI2NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIyLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzBlYWZlZjA1Y2IyODJhY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqb3JkYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhhbWlsdG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NjcwIHBhcmtlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaW93YSBwYXJrXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicGVubnN5bHZhbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkwNTUwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqb3JkYW4uaGFtaWx0b245N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYnJvd25mcm9nNzY4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwb3VuZGVkXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImxtUmY3OTl3XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNTNjODlkMzNlZTNhZTYzN2QzMjcyY2ZkZDAzMTcwYzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDgxN2U4Yzg3NTIwZDZhZjgxOWIzODlmMTI2MTI3OTBhN2NjZTMyZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjg4OWFkZWRlZDZiZmUxMGM4NGIzMzAzOWViNjY1NTBkZWNjM2ZhOTBjMzM1M2I1ZTc5ZjUzMTI5NWNiMjhiN2RcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE2MTczMjUxMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQyNzgwMDc2MlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MyktODYwLTgwNjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ4NiktNzczLTM3MDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NTktMjAtNDg5OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOWJmNWE1YjVmMDQxMTJkMFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImdlbmVzaXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZsZXRjaGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1OTIyIGRlcGF1bCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXZhZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTExNjRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImdlbmVzaXMuZmxldGNoZXI1NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkY2F0OTcyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsaW5lXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInNmdERpbFhQXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYmRhMTk1NTQwN2NjOGE5NGJmNDJhODhjYjYxZTAwMzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiN2ZjNDhkYzA2YmY1NWViNjVlNDY2MzUwMzVmYjNmMDU4ZmIzOTE0OFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImRmZTEwYjNkNTVkNjdhZGY4MzVkM2NjNDA4ZGFkYzE5NTljNTE4OWM5MjRkM2I1NTQwMzk2MjBhMjhkYTBhOTRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA3MTE0NDgxNlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjczNTAzNTM0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDM2KS03NjktNDg2MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTMwKS05MjUtNDM2OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1Mi00NS04NjMyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkMTFlOTA5NzY3Y2U1ZDMyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRvZGRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInNpbXBzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg3MzggdyBiZWx0IGxpbmUgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZvcnQgY29sbGluc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbG9yYWRvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY0MjQwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0b2RkLnNpbXBzb24zNEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxjYXQzMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZHJlYW1cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibEprVlJhU3dcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYmVlOGIzMWYxODExMGM5NzhjMDlmOWU4ZDZkMzAwNlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0ZDcwMTFhYmRmNGQzZDMwYTgwODg2NmNjZjg2NWQ0NjRhZWJjNjY1XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzJmNmFjZTU5Mjc3ZDc1MGQxNWE3NGQ4YTg0NzhiYWY3MjkwMDhiYjFlNjgwZTBhNTlhZmQzYzJjOTFjYjhkYVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NjI2NjgxMDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMDMwOTQ2NzFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NTYpLTg2OS02MzAwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3ODUpLTI5My01MDEyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDY0LTc5LTU4ODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQzMDlhM2NjZjUwMjkzZGJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibHVrZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9vcmVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjcyMzIgY29sbGVnZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVuY2FudmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvcmVnb25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTg0MDNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImx1a2UubW9vcmU3OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWZyb2c1NDRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhhbm5haDFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUzE5ejh4QVdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkODc4NTUzYWVjZWQzMjA4NjgzZmUwM2Q3YzdjOTc2Y1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIzM2MxNWIwY2I4OTBkZWY0MzM3NzhlMGQ4ZmEzMmVlNGZlOTc0MWY5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMWIzNjg2ZjZjNmMyZGYzNzQwMTRkMDNhNDBlMTIyY2QyZTY2OGY0OWY2YjYyNDQyZTVhNDViZThlM2RiYzAwNlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc0NzMzMjc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzI1MjY4NTA0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTQ5KS03MjgtNjgxMVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzcwKS0zNjEtODc3MVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyOC0yMi03NTAyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMjUyNWE1OGRhZTU5MTliXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxvdWVsbGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImFkYW1zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4Mjk2IGRlcGF1bCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmVkIG9ha1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyMjUzOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibG91ZWxsYS5hZGFtczk0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eXBhbmRhMzU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzcGFjZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJxWllSTU5UM1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjNmMWMwNjk3MzAwMGE4MjRhNzcwZGQ4YTg3ZDYxMTEwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjMxMDI0ZjFhOTZhYTQ4M2ExNWFjNTc2ZjQ4MDc5N2EzMzlkZDMzYjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2YTI0OWI2MWQ0MjQzODZlZTAyYjdmNDgxNzY3ODgwNjZmNWQ4MTk1ZTQ2M2MzMzVhODkxYjZkMThkZDllZmVkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNTk4MDczODlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MzY2NTMxMjRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4OTkpLTM1Ny05NzIwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0MTApLTIyMC01NTYyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzQzLTI1LTcxNjFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc1ODI0ZjcxOWZhZTFlZDlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImVyaWthXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyZXlub2xkc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzk4MCBkZXBhdWwgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidGVubmVzc2VlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjcyMzM1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJlcmlrYS5yZXlub2xkczg5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaGRvZzIxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJrZW5uZXRoXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJleXF3eTZDXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZmI3ZWU3MDEyMmZiZmM3MmI4MGRlYTZlODQ5NjBhNTZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYmEzZmFiNjdkOTc0YTg5YzJiNDBiYjVlMjRmNDBiNjdjNDQ0Y2ViYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImYwYTRiOGUwMzkwMGVhM2UwZmMyMjQ4MWZlMzAxY2UyMDNiNWJlN2E2NzhlODdhYTBiMzMzYzUxNzc4MmQ2OGRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2MjU2OTQ2MFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjUzOTY1MDM5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDExKS03MDMtNTQxOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzkyKS00ODItMTcxOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE3Ni0yOS04MDE1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ZGRhOWE5ZjU2MTQ1MDNiXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImV1Z2VuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwib2xpdmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NDYwIGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGVzb3RvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicGVubnN5bHZhbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM3MzAwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJldWdlbmUub2xpdmVyNTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2VsZXBoYW50OTEyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIwMTIzNDU2N1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI3VGZQbFBKTVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE1NTE1YTJjMTJmODI5MWJmN2ViMjMzMDY4MDg1Y2ZmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE3NjA5Yjc3ZjYxZTU0OTIwMWQ1ODk3ZWEyZjJiYWQ0M2NkZjAyZjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjZjlmNzZmYzkwOTY4ZmNmZWZlNGM5ZWI3N2ZmOGFmZDU2YzM1NmZmMDFjZGEyY2I5ZDFkNzkzNDIzODJlNTE1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzUzNTkyNDFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI5NTM1MjAwM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEwMCktNTIyLTQ2OTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5OCktNDg5LTM2NDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNzYtOTEtMTcyMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmMyYTA1NDdkYzg5N2NhMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrcmlzdGluXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYW5zZW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ2MDcgZmluY2hlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibW9kZXN0b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NDc3OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia3Jpc3Rpbi5oYW5zZW45MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93Z29yaWxsYTYxNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMjcyN1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJRTG1LRnVsalwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQxMzE1Y2NiZmJmNjRiNzk0NzIzMjBiZDBmM2UwNjNmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImUyMTkxYmY2ZDBmZTM3YjEwYjVkOTY1N2MxZmJmZjVhMjcxZDBmZTlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0Njc4MzZlOGIxYTQ4MjM3YmU0Yjk3Nzk5ZGNkOWIxZGJhMTAyZjM2MzZjNjIzY2U4ODBmNzk4ZGUwNDY1NDNkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNTc1OTgzOTlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI1OTMwMzIxMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU4OCktNjQ4LTExNjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk5MSktNDk1LTY1NThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MTgtMTQtODg2MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzY4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDQ4MGU2ZDcxZTljYWRmOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhcm5vbGRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImppbWVuZXpcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI3MzYgbWlsbGVyIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxiYW55XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiYXJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjUzMjlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFybm9sZC5qaW1lbmV6MjFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmdvcmlsbGE0NzJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNreWRpdmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS0pQS1VPekFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0ZjgxMWRhZjZjN2E0MjMxMmE4ZDE5ZjQ2OGQzOTBmOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3ODU4OWExMDVjODBhYTUwYmE3NGIxMmQwZWYxYzY1MWRjMzY1ZmI5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYmRjYjQ1MTBiNDhlNjkzMDgwZDFlMmQ2NTc5ZWUwNzJmY2JiMjFjMjEyYmM5YjJhMGNhYTIzNjlkYzc3NDM4M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU3NjE5OTU2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTYwMzU3NDczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjY2KS03NzUtMjI1MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjM1KS05ODktNDU0MVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU4Ny04MC0zNjUzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjNjA0Mjk0ZmJjOGU1M2Y3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFtZWxpYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicm9kcmlndWV6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNzc5IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzaGVsYnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaW5uZXNvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzQ4NTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFtZWxpYS5yb2RyaWd1ZXozOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVrb2FsYTg1NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic25vd2JhbGxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSU1PZzhaZG9cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3YmM3MTViNzg2OWVhZjJmYjg3YzA1NmJkNzAzODlmNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MDFlY2JlMGJhMzk2YzhjMjA0ODZjYTg1NzY4NThjZmQ1ZTk0NGM2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOWRhZGRhZDAwMWVlZGEzYWY3OGIwNTNmZThkNjExOTkzMGQyZTI1MmJjMGU4ZjgwY2M2MTI5YTYzYzE2NGQzNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDg2MzUwMTU3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU5MjQzOTVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NTgpLTQwOS0zNzc0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NTQpLTc4MC04MDA0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTMwLTI0LTEyNTJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzg3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84Ny5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJlMTJkNTFlOTgwNjA4ODRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWF4XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoZW5yeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTQ5NiBwYXJrZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImR1bWFzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODIzODZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1heC5oZW5yeTUxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5a29hbGE0MzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImxpdmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiM0VPS2lQZGFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5Mzk2NDMzODhlZGVmYmU0MzY1ZjlhMjBjOWI5YTZiZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5NDUwNjI2YjliZGIxMjg4YTA2ZWZlNjgwNTRiOTBhOWExNjFhYTIwXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2FlMDJmMTI5YjFmYzI4MjJkMmRjZjBiMzcyMDYyNDU3ZTkxZWYyNTk1MDFhYjJmZjgzMDU0NmVhNTdlYWEzM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjQ1NzcwMjExXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTg2MjgxNDQ5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzkwKS04MjItNjg0MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzUxKS03NzctNTMxMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkxMS00Ny0yOTczXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3ZGRmZDdlNTBjMTc5MGFmXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIndpbGxpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGFsbWVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MzAyIGJvbGxpbmdlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGV0cm9pdFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODYzMTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIndpbGxpZS5wYWxtZXI1OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JnYW5pY2dvcmlsbGE1MzlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJydXR1c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJKSTZaeUtWU1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjBkMzU2MGVlNTEyYWQxNmVlZTgzYjEwY2MzZGNlZWRlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA3MTcyODgxYzg5YzMxYmQ2YWE3M2U2ODA3NGJmNDRjYTEzMzQ0YjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2NjBmZTVhYzQ0NDhhZWIyZjA3M2U0NWQyYjc3NzgwMjFkYzNjN2I1N2U1MGYyNTYwMzZlMjhkNTE1N2JjZjMxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNDYxODkxMzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNjc2NzQyM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcxNCktNzAxLTc5MTNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ0MiktNTEwLTE3NzZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3NTItNTYtNTczNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjdlMjM1MzBmNTExMTNhYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0eWxlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY29sbGluc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzQ3NCBmYWlydmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwidGhlIGNvbG9ueVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY4MTE2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0eWxlci5jb2xsaW5zODBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWNhdDYwOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicGFycm90XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm81SHBNTERzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzAyMTlmNjRlZThiNzU3Yzg4YmJmYTZhNjQwNTlhNzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTIwNmMwN2Y0OGVmNDJlMDhlMWQwMGI3NWZlMTYyMTdlZGRjNjYyZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhkODQ5Y2ZmYTY0ZmVhYjFhMTYyMTk1NmY5NTNmYTk0ZGZiODRiYzczODI1NjA1MmRjYTZlNGUyY2U4NWE5MmZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM0OTIzMzg0OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE3NDExMDAzMlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg5NyktMTMyLTgyMzZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYxOSktMTczLTk0MDBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NjQtNTMtNDIxMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjAwYmUwNjM0ZDkzM2Q5MVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJmcmFuY2lzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhbmRyZXdzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNzk4IGZpbmNoZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInNvdXRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0ODc5OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZnJhbmNpcy5hbmRyZXdzMjRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWViZWFyNzMxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxOTY5XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklrNmR4eXI1XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmY1ZjJkYWNiNjMyY2M3NDk5MmE4MTk2ZGI0MGZmYzZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiY2MzYWU1YTI1MDMwNzRmYzVjMzhiNTJmNDc0NGNiODVhNWYzNGM2M1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjY5MzVlMDk3ZDBiMjVmMWQ0ZTgxNjZlYTlkOTE2YmE3ZWQwZTBmYjBiZjU4NDk0YzU2NTg3MzUwNGQ3NzczZGJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE0ODEyNDM2OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2OTI1NTM0OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE2NSktNzY3LTgwMTZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkzNSktNDg0LTQ0MDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MTMtODktNTkzMFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNWYzMDAyY2Y5Mjg4OWNhOFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1heGluZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGVuZGVyc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNjc1IGRhbmUgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNpbmNpbm5hdGlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2OTk3OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWF4aW5lLmhlbmRlcnNvbjI2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dvc3RyaWNoOTEzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtYXRyaXgxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImpWUDRjRjVFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzE5NjMzM2IwNGM5ZDA3NjFjYTUxNzI1MjM0MjNhODdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjlmYjQ1ZWEwMjEzMDFhMjQ4ODViOGE4YjkyNmJjYTE2OWFjODcxNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhkOTdhMTk3YmIyMjQwYjE2YTgwMTk3N2YyZDExYjQwMmU2ZmI0ZjUyODIxMDZhOTA0YzhmMDNjYzczMjMwODdcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTMzMzcxOTQzMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjExNjIyNjM0NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk0MyktODgwLTQ5MjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ2MyktNjg2LTE5MDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MzMtMTAtMTAwMVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiM2UyODc4ZmFiZDkxNjNhNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0cmFjeVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaG9wa2luc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzE2NiBodW50ZXJzIGNyZWVrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoYW1zYnVyZ1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZpcmdpbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ1MDk3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0cmFjeS5ob3BraW5zNjhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWxhZHlidWc5NDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklRN2wzeDdOXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWE3OWEyZDE1ZjdlZmVhYTM2MjM2ZTA3MjJjYmI1ZmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOWFjZmQ1YTEzZjEzYWU2NjA5ODllMDA1NGMxODQwYzhiYTA2NDNkYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhmNzk2NmIyNTkzMmRmMTYwYzM0NmYxM2Q5MTllYjZiYmZjZDY1NGU5Njk1YzZjZmVhMzc2ZmYyOTcyN2UwMjBcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIwMTE3Mjg3MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ2OTQ3MzIzMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgyNiktNTI3LTI5MDVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk4NiktNTIzLTYxNDRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNzMtMjQtNjMyOFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzEzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTE5MGE0YjQ5NjE0YTA0YlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW1lbGlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJuaWNob2xzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NTQ2IGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgeW9ya1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NjAyMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW1lbGlhLm5pY2hvbHM2OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVsYWR5YnVnOTUzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJvYml3YW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiRkQyY1hIVmlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlOTI2NGE3OWMzY2QyOGJkYThjNDY0MGRkMmVkMGIwZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0MTk0MjIyNTVhM2VhY2RkMjc3ZmQwNTU1MGJmODFmNGMxNzkzNWI3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOWM0ZTU3YjA0Y2RhOTM0YzdlYTg0NGMwZDdhYTU0NTkwZjUxZDZhY2Q1MTJkNWM3MDFiNjUxNmMxNGVlZjkwNlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDY4NTAzMDQ3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTEwMzg3ODkzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjk5KS0yOTktNTM5OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzg3KS0yMzgtNTQwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjYxOC0yMC04NDMwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4NGVkMGU0ZmQ4NGU4YzBjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImF1YnJlZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGV0ZXJzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg1ODYgZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2FwZSBmZWFyXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IG1leGljb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MzIxMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYXVicmVlLnBldGVyc29uMzFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ2R1Y2s5MTFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhcmJvblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJhMmQ1NmF2UVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjc2YWRlMGQwNmQxMGEwNWFhYmY0MjEyZDEzODdjODU4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjg0YmRiODBiN2U0OGE2YTkxNjRhZjhlMDI3ZjBjZjk0MjBhNGQ5YzJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyYmQwOTAxOGU0N2I1Yjg3NmY5ODY3MDg4N2MwM2QxNmU4MmI5MTM1ZWQ4ZTY4MTVlNzFiY2MwOGNjOGVjMWIzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExMjQzOTUyNzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMzA3NDkxN1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEyNiktNTQ4LTExMDZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQwNCktMzU2LTEyNTBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4MDQtMzUtNzM5MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNDQ2ZjRiMmMyMjBjOGE1ZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamVhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGV0ZXJzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MTgxIHdhc2hpbmd0b24gYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiZXJuYWxpbGxvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW5kaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3NzEyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamVhbi5wZXRlcnM5OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyZWxlcGhhbnQzMDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1lYXRiYWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIndXNTlmMFJ5XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjc3OWFmZDM3OTlmN2M5YWM5ZGM1ZTFmYzk3MGFmMmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYWY1ZDJmODIwZDUwMzQ0ZjAxODhhMDRhOGZjZWMzNmQ2YzQxMDFjYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImQzOTBiYjAwYzY2YTBjMTQxMDNhMjgwN2Y2MzIxNDc1YWIyMmRkNDVmOGIyMDE2OWUzZjkyMDY1NWM1MGIwYTVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAwMTk3MTY1M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3MjE5OTQyOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDM3MyktNDE5LTI3OTRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5OSktMTk2LTEyNDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MjYtMjMtNDc2OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZmQwNzU1MGVkNDcwZTIzNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhbWlsYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RhbmxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDc2OSBodW50ZXJzIGNyZWVrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiaWxsaW5nc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9rbGFob21hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI0MjU2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYW1pbGEuc3RhbmxleTg2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJnb2xkZW5tZWVyY2F0NTA1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqdWxlc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI1ZzYwbTdQQlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjViOGVjM2RmNmUyY2QwYTQ0NWI1ZTI0ZWZkMTliNjBjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImU1NDgxZGY2NzI5NTg1NTFhZmJkMGI0ZTgwMWNhOGM1YTIyMDJlYWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2MGFiMmM5MzE5ZjhlZGQwZmMyYmZmZWZiYzc0MjYwZjkwMmY0NDljY2EzODZiNmMxNzczMWQ2NGM4ODRhM2RhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNDI2MzY2OTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNTM2MTA3NTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjApLTMzMy01MjY5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNTApLTY1Mi00MTgyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjE0LTc1LTcyODNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwNjM4NWU0N2VmZWQwY2VcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRvbnlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJqb3JkYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM1Nzkgd2hlZWxlciByaWRnZSBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZmxvd2VybW91bmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NjUxMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidG9ueWEuam9yZGFuMzNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlmcm9nOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicHJlY2lvdXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiV2RNWXNZRGVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMmZkNWY3MzMwODI2YWYzMmUyYTQxMzg0MDc3ZWRmOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxYjZlNTQ5MDE2MWFiM2Q3MTJkOTQ2MTQxM2Q0NDQ0ZWVlNDljMWM4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjNhN2FhNDI1NDhkYjViNjVkYjlmZDRmOGVkMzUyZmQyZDAxMDI1ODgxYTFhZWYwNzhmNTQwY2ViMmNjODA4NVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzMxODY4ODA3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjkyNTk2OTU2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTEyKS04ODktNDg3NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTA5KS01NTItNTU4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk2MC00NS02NzgyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2NmE3YjEzNjk2YmUwMmRjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvZ2VyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGVwaGVuc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODk0NCBncmVlbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicm9jaGVzdGVyXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicmhvZGUgaXNsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg5OTcwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb2dlci5zdGVwaGVuczcxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaHJhYmJpdDYzNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYnJ5YW4xXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImFCWDRrNXZXXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMjA2YzkwZGY2OTM3Yjk3MzI2NDZkZWIwMDdjZTdhNTFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDE3NjJlMzc2ZDkyZGZiMzRmZjI5MDRkNGE3MWQ0ODc1NjYxZDUwMVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjFhNmRlYTgwMDZiMzBhZDFmMWZmN2U5Y2NmNzAyMmY3NTNkZGNjZWZhYzdhY2I2OGVlN2VkMDE0YjQ2M2M4YjFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2MDMyNDYwOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQxMjU2MjgwOFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQxNyktOTQ1LTM3NDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMxMiktODc2LTk5NTVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MzYtOTItMTE4NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzU5MWNlNDY2YTM3OGUxNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJnZW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YWxsYWNlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxMTI4IGFkYW1zIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImFsYXNrYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMTEwN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZ2VuZS53YWxsYWNlOTFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVsaW9uMjc2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJlbWlsaWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVmtoS3RldTNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxOGY2YmEwMjMxYWUyMzZmYjc1Y2ZlNjM0OGNkY2E4ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZjI4YzVkZTJhODM1M2M1NDZlN2EwOWJiZjIwZDVmYzI1YjdhYzFiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYWE4OWJlZDRmMDQ3N2VjZmU0MTE4MWUxNTJkOTYyM2JjOGQxNTIxYWE4MWQyNWUyYTg1Y2I2YTA1Y2Y0ZGU0MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDQ0NDE2MTU0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTQxNDQxMjQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjczKS0zOTMtNzkzMVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTMyKS03NzktMjk5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY2OS04NS0zNjc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NTU4ZDViYzZlOTUyMWY1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia3lsaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBldGVyc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NTk1IHBvcGxhciBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxiYW55XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY2FsaWZvcm5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxNzY2OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia3lsaWUucGV0ZXJzb24zOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmxhY2tnb3JpbGxhMjMwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ1dG9waWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiblEzVG92SURcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiMzU4OTZhM2M2NWU5NTU3ZmFiNmUwZjIyYTIwNTQwZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwMmMyZDRmZDBjMjllYTAwNzAwM2VmNjM4YmY1ZDM4N2U4OWY2ZGY3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDk2ZmYwZDMzYjJhY2IxNjJiMTRjMjliMzZiNTU3YmYxMTk3NzJkZWVlYjBkNjdlMGQ2OGQyZWMwZTM5ZTViMVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU3NzgxNDUyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjQ3Njg1MTUyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzM3KS02NjUtOTY3N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTMxKS0xMjctODQ4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc3MS02OC04NDQ1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyZmVhOThhZjcyMmQxZmI1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2Fzc2FuZHJhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXJkXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MDk3IGZvcmVzdCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmlvIHJhbmNob1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImthbnNhc1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0NDcyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2Fzc2FuZHJhLndhcmQ0OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnb3N0cmljaDM2NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiNTViZ2F0ZXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVng0Mm5yZjBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2N2Q1MmE2ZTIyNjRhMWEwMjFjODQyNjE0MjA0NDMzNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyYmE4OTY1YzNlYjZiYTFjNjQwNDE2NjEwYWM2ZDBlZjBjZDJjZDI3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDE2NDE0ZjUyMzViMmUyYmI5OTY3MmY1NGY5ZDNiNjM3YTRhZDdjZTRlZDgyZWQ1ZDg5ZmUwMjUzMTIzNjM5Y1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzY1MjMxNDcxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjg5MTk4OTkzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODA5KS01OTctOTg0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDYwKS0zODktNjkwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyMC0yOS04ODU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwMjU4ODUxNTQ3NDA4NGM0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhdHNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjYyNiBjaGVycnkgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFkZGlzb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJsb3Vpc2lhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTQ4MDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFteS53YXRzb243MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlZnJvZzkyMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYW5nZWwxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkJoWUh3TFAwXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOGYwZTJjNGEwNjUwMGZjYmY1MzY1NzMzNjJiMDAzNzhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDE3MDk0MjJlMjM0MWYxYWE1MjNhMGM4OGFkY2YxZWFhY2JmN2MxOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjIxZDYwZDQ2N2FjNWIwYjRhZWQwNzQyMjU5Zjk5YmMzZDE2ZWRjMDdiZjE0MmIwOWM4NTZkODY4ZmRhZDllM2NcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTk1ODI2NDg4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjk4NjA1NTczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjQ0KS0yOTQtODQyNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTc4KS0yMTktOTE5NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk5MC00OS03MTUyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmOWJmNjc5NTQ3MzcxZTYzXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhcnRlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZHVuY2FuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NjYxIGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbmQgcHJhaXJpZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBoYW1wc2hpcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjI2NTlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhcnRlci5kdW5jYW42N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiaGVhdnliZWFyMjU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3d3d3d3d3d1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtRms3MlBvWVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZhOWQ3OWNlZTE2NDA0MTUzNzFlNjAwNjdhYjM5YmMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjg4YzcyZmQwYmQ5YzFhZjg0N2MwZGE5MWRlMjI1ZjUzODIxYWIzMWFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlNTUyODZiY2I3OTNiNzFmZTQ1NTEyNjM4NmVjMGZhMWZlMzliY2E4MzAyNWIxMWY1ZGUxOGY1ZWVkNTBmYjllXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk2MzY1OTA5M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3Mzg0MTI1NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDYxNCktOTI1LTk5MDFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg5MSktODkzLTE5MzVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyOTctODUtMjAzOVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmE3NDBlNjU2NjQyMGFmMlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbHlzc2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJhcm5lc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjk3NyB3aGl0ZSBvYWsgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvcyBhbmdlbGVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW93YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MjI3M1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWx5c3NhLmJhcm5lczc5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja2R1Y2s3MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic3ByaW50ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVXk0Q0lpNEhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIzODJhOGU4Zjg0YTIyYTBlOWU4ZDU5OTFiYWJjYThkM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhMjRjZDI0NzFjZTBkOTFlOTkwYThiOGQ4ZjhjNjc3NGI4ZDNkZmI4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDI3ZjllYTQyZmQzYjFhOWE2NjA0ZThhMWQ5OTM1ODEwMDFmZDg4Y2I4NzIyY2YzOWFhZTU1MjJmYWMyM2JmN1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzg1MjgxOTI4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjY4NDE4NzA3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODcwKS01MjUtOTEzNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzU5KS0xNjAtNTQwOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk4MS0yMy01NzkwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMmU1MzQyODg1M2MxYWM1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZGVuaXNlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtYXJ0aW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE4MjEgcm9iaW5zb24gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInV0aWNhXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzA2NzJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRlbmlzZS5tYXJ0aW40MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkYmVhcjE1N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibW9udHkxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImpXWlVueGFTXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjYwMjQ4MjgyNzQ2NmVkODc4ZDU3ZGM0ZTcxMDJmMDlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiN2VlNjMzMTc2Yzc4MTFhYTU4NWY5MjIzMDI0NjM2N2QyZDc5ODFlZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjBkYmRhNjMwY2FiZmJjZGViYzI1NWM1NGJiYzk4ZGQ0MTg5YjY0MTY3OTllYjg4Mzg3YjYzNTFiOWFhYjNkZDRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI4Njc2MzM2M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ5Mzg5NjU3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzQ5KS01NTktNzcxOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDEzKS0zNzAtOTAxOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjEyMi02MS05MDU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmMjA5M2VlOTZkMmE5N2NlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvc3NcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcnJpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTI1NCBsb3ZlcnMgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1cmVrYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndlc3QgdmlyZ2luaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTMyMzVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvc3MubW9ycmlzMzVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpbnl0aWdlcjU0OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidGhhbmF0b3NcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieXE0TXhCdFFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyZGY0YzhlOGYxZWQ4MTlkMjAwZmJmOTRiY2MyNDFiYlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0ZmE4MGVlNTQ1NDg2ZGQ4NjkzNjA0NmVmNWRkMDY0N2U3MDAxZWVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjY4MmYxZmY3ZWJjYzcyYTg0NjkzYmU2NmMxN2ZkYTU4YzRiMTI5NzViNjk3NjE2ODkwZTUxY2YwN2IyZmVmY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjQwOTM0ODE2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI4MTcxMzExXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzI3KS05MTgtOTc5MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjA4KS05NTUtMzc0NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ3OC05OC00Mjg3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlNTBmOGQ5MzQ1YWM3MWQ5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJoZXJtaW5pYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZm93bGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1ODk0IHcgY2FtcGJlbGwgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkdW1hc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZpcmdpbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg4MTQ1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoZXJtaW5pYS5mb3dsZXI1N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiY3JhenlsaW9uNTE0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzbW9rZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiWEJzRHByZ3VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMTQ5NjMyYjQzYjJhYThhMDAwMjJmYjViNGE4ODAzN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZmQ2ODc1NWY1MWNmMjMwN2Y4Nzc3NmQ1ZTVlYzYyMDk4YjM5ZWQ5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjc2YzgwNDJjYzQ1MDA4MDNmMjEzMjY5ZTM0MWVlNjkzODM0ZWE5YTRkN2EwYzI1YmMyZGVjOWYyNjc5ZjAwZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU4ODc2MTA1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzcxNTY0ODI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDE0KS02NjQtNzg2NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzk0KS05OTItMzQzMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMzMS04MS01ODc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjMzM1NWIwYzY0MzIwOGU5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWVsaXNzYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZmxldGNoZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU2NDYgcGFkZG9jayB3YXlcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1Z2VuZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImlkYWhvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjIwNTA1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtZWxpc3NhLmZsZXRjaGVyOTNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWJlYXI1NzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInN3ZWV0aWVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiNnZBa2VhN3ZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5OGM0OWY1MzI3ZjEyMjllYmI5YWU5OGE5OGU5ZDRhY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmYmE5MjdiNTRmYTRkYzZhMzQxZjE0MmMxNWZiZTRiMjI1OTcyMmRmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjhmNjI2NjgwZWIyYTMwYzE3OWY4NjBmNGY1NTM0NWMzZmY4OWI3MDE5MTQ2ZDU3ZGI4MmM4MzJhYmE3NGFiY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NzEzMzE0MzlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NzQ5MTY4OTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MDcpLTkzMi02NjM5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzEpLTc0Ny0zNzkyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTU4LTEwLTY4OTlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzcxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi83MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi83MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjAxOGQ4YjdkYWVlYWJiNDFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY3J5c3RhbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYWxsZW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE3NDggY2VudHJhbCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmV3IGhhdmVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2tsYWhvbWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTg1NzdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNyeXN0YWwuYWxsZW4yNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWR1Y2sxOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYW5ndXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiN2lkVUY1bkJcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3YmJhMGI5MWJkNDY3ZTg0MWExMjBmNGU2MzFjZWFmY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2YzZkMTdkZDAyMTZhNGIxYjI2NDlmMTBlNGJlZGFhMjY2NTMyMGUyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzMzMDI2N2RmMDE3YmZkOWIxMDAwZjdhZjMyZTJmNWYwMmQ2ZmE4YmQ2NDRmNDU3NmE3MTM1ODQ4Mjg0NzMxM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NjI2MjczMzVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjYzMjM4MjFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyMDUpLTI5Mi03MDUyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyODgpLTg0My00NDQ1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDk0LTc0LTgxODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImExOWVhYWZmMTRhNjdjZmRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIndlbmR5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmcmVlbWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MTAxIGxvdmVycyBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2hlbGJ5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY2FsaWZvcm5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NTcxNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwid2VuZHkuZnJlZW1hbjQwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWdnb3JpbGxhOTg5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxMjMzMjFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiYzVtTGtLMEJcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5NjY5ZTBlYjZlN2UxMTY4ZTNmZGE2YzE0MTlmNTViZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MDBjYzY5N2YyZjFmZDk0ZGQ2Mzk2NjQ1MTBkZDhmNTYxNjc2YzY4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDgyMDhlNzU5YjE0MDczYjE2ODdlNmQ2MDFhNGMxYjI3YzFjNWRmMmM5MjE2NTU3OWVlZGYzOTNlNjg2Y2IwOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5OTQxODkxNDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTI1NzMzMDlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MjIpLTE0NC01MTk2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMjMpLTg2Mi0zODUzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjU1LTY2LTg3ODVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImM3ZTJjODA3MDc4ODgzMzFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZWR1YXJkb1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWFyc2hhbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc1OTUgZSBub3J0aCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVsZW5hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidGVubmVzc2VlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgyMzMzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJlZHVhcmRvLm1hcnNoYWxsNTBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZXNuYWtlNTQwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhcmNoYW5nZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJZGp0Q011Z1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImIwOTM2Y2FlMzM5M2UxMTQxOGUxNmYyNTRiOTU0Mzc4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjViOGZjMzI5ZTUyYTEzM2JjYmViNzcwMzA5ZmRjZTY5ODZiMjE5ZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4NTUyMTg0M2YyYzljNThmMmQ4MzlkYmQxMDE3NDgwNGU1YTI5ZDQ5OGMzMmU4NmFiNWYzZmIxYzNlMDgwNjUwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyODE0ODU3NzRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMDM5NDMxNDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NzApLTY0NS0yNjgwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NTkpLTYyNC03NTU4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzI5LTg2LTI5ODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjljNjM5ZTljNzJhZjcwNWFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqdWxpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JhbnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI0ODAgbGFrZXZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInN0YW5sZXlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpbmRpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ0Mjc1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqdWxpZS5ncmFudDQ4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbmdvb3NlMzgzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJpZGlvdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSSVBQOTdSTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjMwMmY0ZWU2ZWI1ZDYwMjgxNTRkZmVhM2ZhZjRlYTk1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIyODBhMjQ0ZmRlNTVlODhhMDNiNWEwZDU4NTg2M2FlMzA0MmIzZmVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5ZGIwYWQ5MGQ0NzdjMjYwN2Q1YTFlMjMzN2I4ZjBjNWQ0YWQ4MDRmM2UxYjY3ZTEzOGM4ZjljN2UyNDg0MTAxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMTkyMDUxNDJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNzgyMzYzNjRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MTQpLTg1Ny0zNzk3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5ODUpLTczMi05MzgzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDgzLTc2LTc4OTRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjI2YTllNTYxMDdiMzc4MjhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZG91Z2xhc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGF2aXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk2ODggZSBsaXR0bGUgeW9yayByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicHJvdmlkZW5jZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgxMDY1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkb3VnbGFzLmRhdmlzMzlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZWdvb3NlMTc4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtaWFtaVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJrdWZlc3M2R1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjYzNmUxZTNiNTY2ZmU5OGMzOWZlY2ZhMTljOTg4ZTZiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjU5NzU3ZWRlOTFiNGNhNTc2ZGUwZjNiN2RhODk0YTNkZDM3MDMxMjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4ZmVjMmJmMjRkYjdjMDQ5ZDZkZmU4MWM0OGFhMzViZjllMjZjYzA4MzYzOTM1NzhlY2FmYmU4OTk0NzE3ZjhiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNTY2Mzg4MjBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Njk2MDQxMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg1MSktNjQ4LTc2NTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE5MyktOTA5LTQ4NTVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MTAtMzYtOTY5M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzY4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOTZkMzcyMTk2NWRmZWYwMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhbmRpY2VcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcnJpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODc3OSB0YXlsb3Igc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvbmcgYmVhY2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXZhZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTI4MDZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhbmRpY2UubW9ycmlzMjNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnNuYWtlOTQ5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ5YW5rZWVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS3RwS0lBelhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjZTVkZDhkMTcyZDJlYTlmOTViMTlkMDA0ZWM5ODkyMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0MmMzMGM2NTdjNTY3NGEyNzNmMzllYzY0MDNkMjAzM2Y3ODVkODZkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOTU4ZGJiYTFkM2E4ODI5MDY2ODU4NDhmOTJlZDMxOTExYzg5NzlhYzkzN2M3NDViMmUxNDFiNzM4NDE3NTc4MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTQzNzQ5MDQ4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDgyMjE5NjgzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjEwKS00OTctODkyNVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODYzKS03NTEtOTIwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkzOC0xOC0yMTE3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4M2UyOGRlMDMxOGM5NzllXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImphY2tcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0ZXZlbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk0MDMgc3Vuc2V0IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzYWNyYW1lbnRvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjA4ODdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphY2suc3RldmVuczgzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJidXR0ZXJmbHk1MDBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhbGxpbmdcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibTI2d3dKeW5cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1OGYzNDIxYTRhODkwYTcxYTU5ZjczN2Q0NDA0OTU2ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhZGNmODcyYzAxNzExZDYwYmQ0ZWViMWI1OWMzYTFjNmI5MTg1ZWZhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNTY1YzNmYzhlYTkwNGVkOTQzYjU4NzA2MTNlNWZhY2E0OTlhOGQzMTViZTk1MzkzMzYxMzQ2NjdkMTA4OTI3MFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzUyNTAyODAzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTg5MDEyMzUwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTU0KS02MjktMzQ4OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzg1KS02NTEtMjg3NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjExOS0xMS02MzA4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NWMyMTcyMWMwM2I5ZDk3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJhcnJ5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3aWxsaWFtc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzMzMzIGthcmVuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzYW4gam9zZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndpc2NvbnNpblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MDQ3MVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYmFycnkud2lsbGlhbXNvbjQyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGZpc2gzNThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjEwNjZcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiakNzQ1cwbzRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxMTM3YzllMGExM2ZmYTYyYmY2MzY2N2ExZjU1YzM2ZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MGVhMDE4ODI2ODE0NTMyZmM5NjUyMDNlOGVkM2ViNzgwMjlhYzNkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmEwYzk4ZTAxYjcwZjViNmY1MDRjZDc0ZjdiNTU0NDViOGU4YTNmMDg3NTdkMTFiYjZiMzYxNjg1OWZmYWQyOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzgzMDI3NjQ5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjkyMjUwNzYwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjkxKS00MjEtNTAxOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjM3KS00MjEtNzU4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMxNC02MC02NDg4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ODRlZWZjYzA2MzQ4OWRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2hyaXN0aW5hXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGV2ZW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3MDMyIGdyZWVuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZWxlbmFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0OTM0MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2hyaXN0aW5hLnN0ZXZlbnMyMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlZmlzaDgyOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicG9saWNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkVvUWp1MFJBXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDMxOTVmNDE0NjM5ZWRkMmYyYTFjZDRlYmU0Njk2MzNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNjA0N2E3ZGY1MDFmYTZhMTkxZmJjYzM5Mjk2ZTZiN2U3MmIyNTc0ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQyZGI3NzliMGZlYTRjYjk0YjAyZmUxMjg3ZTA1NmFiYmNkN2MzOGIxMDYxZDA5OWI1YTE3MWI1NDliZjJlOGJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1ODg5NjQ5N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyOTk1MDYwM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU1NiktOTYyLTIxNjFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc0NyktNDY2LTk2ODBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxOTQtMzAtNDI0MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTlmMjVhOWVkYzQ1MmVkMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiaGF6ZWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBvd2VsbFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTY0MCBwb2NrcnVzIHBhZ2UgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvbmcgYmVhY2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2ZXJtb250XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjk1NDM4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoYXplbC5wb3dlbGwxOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eXNuYWtlNzIyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3aWxsb3dcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieEVqTFN3bGhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5YTJlNzk3MDI4NmNjNTE5YmFiZjU3YjAzYjU1Yzk4YlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxY2RlZTJhY2VjNWExOTQ2MWUxMzZjZWZmY2YyN2EwNmIyZjA0ZDJiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMGZjYTMwNTdhMDQyMTVmY2M5Y2MxNWM5MjFlZmIzNjZlZTYyMzZlMjdjMmU5N2RmYjk4OTViYWI5OTRjNDVmYlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzk1OTI5NTgyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTgzNzU4ODM1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTkyKS0zNTktNzQ4M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDk5KS05MTItODU4NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE5My0yNC0yODcyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI1NmVmNDE2ZWYwOGUyZjA0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxldmlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImh1bnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjkxNjQgaG9nYW4gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNlYWdvdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJub3J0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjkzMzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImxldmkuaHVudDQxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGJ1dHRlcmZseTE1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmlnZm9vdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5cjB5ZnUwZVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjQwNDNhYmUzNWQ1MGJjZTk3ZGMyNDFmYWVhZTU5MWUxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQ1MmM3NjZjMzRjZDg2MGQwYzFjOTRlZDlmMzAyMTBkYjMzMjI3MzhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIzZGRlY2NiZDVmNmQ2ZmJkNDE4YzgzZDM3MGQxMWVkZjI5NTQwYmFiMGJhYzJhNWZmNDlkY2Q4MWMzNWQwNzYzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzODQxMjU4MzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI2MjQ5MjkwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTM3KS04MDAtMTkxOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTE3KS04NDEtMTk1NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1OS04MC0xODkxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhODVhNDQ5MDkyNGNiMzhhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInd5YXR0XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkYXZpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjYxOSBlZHdhcmRzIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwcmluY2V0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc1MzM3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ3eWF0dC5kYXZpczIyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja2xlb3BhcmQ0NTdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInRodW1ibmlsc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJGbDgxNlN0eVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NTY1ZjhlZWEzMzIxYTZkYjUwNWZlMmY1ODAzMDhkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjMyOTc0MWNhMjI3YWUwMDk3M2I2ZGQxODI4N2Q0MjRhYzQwYjlhYjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3NGE2NjVlZDY1NjNmM2NiNmIwY2Y1NzZmZTg1M2YyODNlMjQwNmZiZDM4NTcxOWFhNWIyNWJmNjc5NzdhNGIyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkxNzM4NzY2MlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxMjQzNDg3M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgwNSktMzkyLTQwMTBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk5NyktNjIwLTY5OTZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NDQtODktODI4NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzE4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZjlmOTZlYjEwMTM4ZTUzZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJzZXRoXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJnYXJkbmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NDM3IGxha2VzaG9yZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmFzaHZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IGhhbXBzaGlyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MjgwOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwic2V0aC5nYXJkbmVyOThAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRla29hbGE1NTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjQ0NDQ0NFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIzRHl2Qm9vT1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjFjMWE1NjI5YWU0OGNkYWEyY2YxMjdlNThlNTQxOWU0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImQxYzlkOWIyNzJjMjRkYTU4Y2RkZTkzZTIwMjJlOTA4YTRjZmRlM2FcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiODQzNzgxMTEzYmNmZGJlMDRjZmMxNmViZDViZGIyNTdmYjk4MDVkZjc0MDBhMjY1NDU2MDE1ZTg2ZDNhMzNlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzOTc4NjgyNDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjgyOTczNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk5NiktMTcyLTYzNDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU0NyktNDgzLTIzMDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NDMtMzItODQ3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzczLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzczLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiY2U5ODkzYjlmNzFhODM5N1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXJ2aW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcmdhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTExMyBtYXJzaCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicGl0dHNidXJnaFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyB5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM2MjYyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJ2aW4ubW9yZ2FuNDZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnNuYWtlNTkyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzaXN0ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiQ0QxMFNlTmRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlZmQxNDZmYjM2ODhhMDJiYWQ2YzhiMGU2MTM4YjJhNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4YjQwY2Y1NTg3MzM5NGNhNDAwMjU5YTNhMGE0NjRiNzFiNTg0OGE0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDk3NTRkNmQ3ODcxZDlhNWFmZGIzMWZmMjdlNjAxMjZmN2I0ZDM2ODRiMGI0ZWMyMzUzZGMyYjVjNmJjMjNkZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzQyOTk3ODg1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTYxMzY0ODk4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTg5KS0xMzItNzc0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDkzKS03NTItMTI3NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMwNC05NC04NDYwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI1NzU5MzQ1OTBiZDdiODI0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxvdWlzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJob2ZmbWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MTIyIGZpbmNoZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pc3Npc3NpcHBpXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjExODgxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsb3Vpcy5ob2ZmbWFuNDlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmdvb3NlNTE5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJyYXZlbjFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiN1NKcGpnQzZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlNmU5YzEyMjliZWE3ZGM2N2NjMTFkZWE3MTU3M2E4N1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJiYjJhMTU0NTczOWMxYmE2NDMzNGUyOGQ2YjBiYTUzZTgyNWUyYjNiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYzgzMzE5OGM5OWFjYmY0MjYzYzI0YzRmNDgzZTVmMzgzNjkxNzJiMGQ2MjZmNGFmNWRlODkzMWI3M2Y4YzcwZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NDg5MjMyMjdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTg0NjQ0NDdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MTQpLTU4OC02NDk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxODUpLTc3NS05ODYzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzEwLTU3LTE3MThcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzUzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjNhYzAyODk2MWIwYTZmYjNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidmVybm9uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJteWVyc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODk2MiB0aG9ybnJpZGdlIGNpclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYXJsaW5ndG9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDg1NTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInZlcm5vbi5teWVyczg5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmdhbmljcmFiYml0NTMzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzZXJ2ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiOVFVcHdxU1VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5ZTBjOGUzMTZlZWVhMGI4NjZlZGIzMjdhZjJiNTA0OVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhNDkwNWFjNDRjMmE4MmU5YjVlZTQ2YzEwZGMwM2ZkNzhkOGI1MTFlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMWY1ZjRiYzM0MWUzOThlMjQxNmE3ZmVjYmE0MTkzMTM4MDA4ODA2N2ZhNzVmOTRhNWUwYWQwNjVhNTA2M2EyMlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDExMTA0OTA4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTIwMDY5NjQ1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODc3KS02MDctNzM5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDYzKS01MjctNzE3NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI4OC0zOS03MTIyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8zOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2MDEzMjQzNTY2MTFjNzZlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1pY2hhZWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0YW5sZXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM1OTEgbm9ydGhhdmVuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzcG9rYW5lXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggY2Fyb2xpbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjU1MzZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1pY2hhZWwuc3RhbmxleTgwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJnb2xkZW5nb3JpbGxhOTQxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJrYXJlblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJZeHpxcEZTSVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQzYWFjMTMzMTQ2N2QwOWE5ODQ2MTIwY2I3NThhYTI3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjEzOWM0NzgxNWFiN2E1ODUyMjA2NGRlOTAxZjY5OTQ5M2MwN2U2NWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNjIxMTY2Y2E5YzZhZjYyM2U3NGQ1MTc0MjQ1MTlkNTU0YjRhMTc3MDEwNjE4Yzg1OTU5YThjY2FlMWJhOGNjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzM5MDM0MzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMDUxNzU3MVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc0OSktNjQ1LTE3ODFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEwNyktNzk1LTM3MDdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NjEtNDAtMjQ5MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzU0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzU0LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmMxMTY0NmMwYTYzMjRhY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjbGlmdG9uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ4ODYgbm93bGluIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwaXR0c2J1cmdoXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlzc2lzc2lwcGlcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTEyNTdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNsaWZ0b24ubWF5MjdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlsYWR5YnVnODk3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmbGFzaGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkM0aHZqZ3BvXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzQxODE1YzljZTMwOWRiMDcxNDgzNWI2ZTMyOWU5YTJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYzQ2MDIwZDU1NzU0OTZjYjNmMWYzMzY1NzMzZjM5ODQ5NjZhZTVjZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImU4YzJmNTdkODFlMjgxMDM4MmE3ZmRkZDhjYWY2MDFiYjhkMTk3YzI2MGM1NjcwNmM2MjZmM2RlNzFiM2E3YTlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE2NDg1NDQ2N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjEzNzMyNTg5NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDYxNSktODgyLTM5MjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkxMCktODk3LTI3OTdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3ODctODktMjcxNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmIyZjUyM2NiYTllMTE5NVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiam9hbm5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTE0OCBkYW5lIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFudHMgcGFzc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pbm5lc290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NDcyMlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiam9hbm4ub2xpdmVyODVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVtb3VzZTMxNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmFja2JvbmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS3NDNk5STlVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMWM4YjI0ODNlMWU1NTQwZmYyZDFjYjQ2ZDg0MzNiY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyNGEwOWY2ZmQ2YmFiNzU5YmZlMjUwMzE2ODk2Y2ZkM2U0ODZhZDNjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiM2Y5NTQwMjMwYmViM2U4MDhmNDcxNGU0ZjE2NjIwNzMwOTQyNDA5YTc3OGM5ODRhYjAyZjlhZjBlZDNiY2M3Y1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTA2MzQ4MjE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzE5NzE5MDQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzQyKS0xNjgtNjc3NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjI2KS0xNTEtMTIxMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjczOC0zMi00ODEzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwNjA5NTI3ODgwMzRhZTFkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInNlYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJ1cnRvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjg5NCBzcHJpbmcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZGVsYXdhcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODAyODVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInNlYW4uYnVydG9uNTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImhlYXZ5bGFkeWJ1ZzIyNVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY29sb3JcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMmdlR20wTDRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1NDRiYmQzZWY3YTIxZWEzZDBiZjdlMjJjNjQ1NjY4M1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJkMzU5ZmNlM2E0Mzk3NzBkOGY5NGU3YTgzMGU4NWY2OTViZTU2MTcxXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjA5M2YyMGU2MTk4NWE4YjVmMDZhMzY5NTVmMDU5YTg5OTUxMDc5MTczMTgwNGY0NjFiYjQxNDEyZjU4NDBhZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDkwOTg3Nzk5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNjM0NDI2MzJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3ODcpLTI1MC00MzA0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1ODMpLTgxNi0xNzk4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTkxLTc3LTMyNDdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzEwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQzM2FmMTM1ZTM0MWQwMGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXJvbGVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJhcnJldHRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjczNDEgZSBzYW5keSBsYWtlIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzdG9ja3RvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndpc2NvbnNpblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1ODcwNFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2Fyb2xlLmJhcnJldHQyMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxnb3JpbGxhOTE4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJraXR0eWNhdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJwazZ1Tm83WFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjVkYTA5ZmU0OWNiNjUxYTFmYjQ0NTgyMGZjZGM5NTEwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjExMjdmYTFhN2M4OGM0N2FkMjM1ZTgyNDU2NzFlYmI5M2QzN2Y3M2FcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmYjhhMzU2OWRmZjVmNGZkZjI0YjI1MTg3NDY5YTI3ZTIxNzA1YWZjMWUzYTUwYjk5YzI4ZmNmMzg3OTRhYjlkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMzU2ODQxNzZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDUzMjA5NTVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNzQpLTk4NS01NTc5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NDQpLTY2Mi00NzIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTY4LTU2LTM2NTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdkMWQxZDBhYTVkYWVjMjRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYnJhZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FyclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjE5NCBwb3BsYXIgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZmxvcmlkYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzMzcwMlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYnJhZC5jYXJyMzZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZ29yaWxsYTczN1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibG9ib1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLd3RLRmUxSVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE1NGU5MWY4ZDZmYTc4OTU2MDZmZjc5MThhMTg2YzhkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjI0MDc5OTE2MmVjMGI2ZDZhMGMxN2Y4NTBjY2JlMmU3MWU1ZDE3NmVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhNzBlYmUxNGQ4MTJhNGIwYWEwMTMxNjk2YTU3MGMyMDJlOWU5MjJkNGFmZWVjOGViMGY0NmU2N2RlODQzNWJhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyOTk1MjE3NDRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxOTA5ODAzOTRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NjApLTk2Ny04NjM4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzcpLTYzMS0yMjI0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTQzLTUwLTQwNTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzcwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83MC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjJjZmYwZTE5ZjVkOTNmMmVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiam9oblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JhbnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ1OTkgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRlc290b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1haW5lXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM5NTkzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqb2huLmdyYW50NzFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenliZWFyOTgxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXZhbGllclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJlWDFMY3BsTlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZlZjgzYzIxZTc5ZDUyZjk0YjY0MWE4OTNjMmQwOGZmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImU4ZDc5NDAwZDRmMmI0YmQ2NjVjYTI4ZGNkYzIyZmY2MWI4YmY3YzFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlYmVhZDRjZTkwNDE1NzZkODAxMWFiOGQ3Y2MzNjI3MjQzZTc5NzdkNTYyNzc1OTA3Y2RkNWQxNTg3YjE1OGI1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzkwNDgxMzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTQ1MDU1ODVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MDgpLTY2NC01MTczXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NDApLTY4NC03MTQ1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTAxLTYwLTg1NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzI3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8yNy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjY3N2RjZDFlNmY2YWVlZjlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia2F5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJnZW9yZ2VcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY5MzkgcHJvc3BlY3QgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImN1cGVydGlub1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9yZWdvblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MTY0NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia2F5Lmdlb3JnZTc0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbnNuYWtlOTQ3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjcnVpc2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiR2FzVUZoRU1cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyNmYwN2UwYjc1ODRjNjVjMjUzMmQ0ZjlhMGNhMThmOVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2ODYzMGU2ZDA1ZjI1ZTY3ZjM1MzE3ZTI5ZTlmOThmMTA1OTlhYzM3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDNhOGViZDBlZDFhYzFiNjI3MDFhNTgwNWEyZmMyYWU1N2M3ZWIxMjJiMDc2OGFiZjIzMmZmMjBjZThlYzhiZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTIwMTUwMzE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTgzNTE2MjA4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDUyKS05MDMtOTYzN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTIxKS05NDEtMjcxOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU2Ni05NC02NDc1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi81Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNTcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNTcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhYjY0Nzc4ODIyNDUxMjA0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm93ZW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhcmxzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE2MzkgbG9jdXN0IHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb3MgbHVuYXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaWNoaWdhblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0MzcyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwib3dlbi5jYXJsc29uNDZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWdvcmlsbGE1MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2xheVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIwMWVGWnc2VVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NWRlNGE2NGQ5MmUzZDcxMmE2MTU1MTg0OWI2MTVjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjI4ZDgyNTIzNzMzY2NiNjkyNGZiMjNkNjlmMzA0NjAyZDhjZjNhYWFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjOTc2ZTgxY2E1OGYxNGRkNzBhMDUzODg5ZjVlNjA4MTU3YTI1MjczY2Q5NWI1YWE1ZTM3YWM5MDE3YTY4MDdlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzE4NDczNzVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MjQ2MDMzODhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3ODkpLTYwMy04MzAwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzgpLTUyNy03MDA1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODU5LTI5LTg1NzZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImE0MDEyNTgyOWU0NmUxZDhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvc2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImVkd2FyZHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQzMjUgaGlja29yeSBjcmVlayBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2VhZ292aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDg1NDhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvc2EuZWR3YXJkczc3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaGxhZHlidWc5MjZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhvdGdpcmxzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImVLcGNmVUJzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzNkZjBiYzI3OTMzOGFjZWUxZjVkYmJmMTc2MzJjOTlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjJlN2E3ZjA5MmJmZDdhZTZjMDYxMTdjMzM3YTU3OWI3YWQ1N2U0ZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjExZjIxNmU3NTJhMDE1MDI5MDRkN2JjMGM0YmM4MGYzMzBkNWVmYjU1YjAyYmI1ODI2NGZiYWYyMDYwZTU3YTNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI5ODk5MjkwMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE0Mzg5MTE3OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMzOSktMzAwLTcyODlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIxOCktODcwLTIwMjhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMzUtNzAtMzE5MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi85LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOGY1Yzk1YWVjMDdjY2VlOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJiaWxsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJicmFkbGV5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyMjY4IGNhbWRlbiBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxhcyB2ZWdhc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkzODk5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJiaWxsLmJyYWRsZXkxM0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWxpb241MjBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNpcnJ1c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJFeTJmVFh3RVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRkNjNiNzA4Njk5MDAyYmZiMmI5Mzg3MGYzMjExZmZjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjUzNjRmMzQ4NGZkYjlmOWEzZDk0ZGY1N2Y5YTZhOGY1MzAwZmUzMWRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNzhhYTRlYzE1NjcxMmNiNmIyZmYzMjk2ZmI3MWJkODU0Yzk5NmJmZTRiNDgwMWU3YzRlOTVkZTRiYjYwZTlmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzk2MTkwMjJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNzY2MDIyNzJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNDYpLTMwMS0yMjk4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxNTcpLTQ5NC0xMTE3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzA4LTQzLTUzNzJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81Mi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzUyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81Mi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc2YWNmNDQ4M2IzZDc5MjFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0cmFjZXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1pbGxlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzM5NSBtY2dvd2VuIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ0YWNvbWFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ1dGFoXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYyNjMyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0cmFjZXkubWlsbGVyMTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGJpcmQyNDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZhdGltYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJUcFRQNGgwalwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjkwMTlmMzcwYjIzYmE3NjRjYjJjNzI4Nzc5OGIyZTMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQ2YjRiMzU1Y2ZiMTRmYzZkYzZkNzk4OGExOGU3MjRlZmU0MTQwNDZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YzdmNzhkYmNhMjkxZWQ0N2I1ZjljYTU1NmJkMDY2Mzg4ZGQ2NGUyM2I3Y2I0NTEzZTVkZWIzMjE4ZGJlNGQwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk4ODIyMDM3NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5NDYyNDQyNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MiktOTkwLTE1NTJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDI2NCktOTk1LTgxOTRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMTQtODgtOTUzNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmNhN2E2ZDFiMzIyN2JlM1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJiZWxsYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwia2VubmVkeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODQwOCBwcm9zcGVjdCByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29sdW1idXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2ZXJtb250XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc5MDUwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJiZWxsYS5rZW5uZWR5OTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVua29hbGE1NTVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNtYWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInJCOXNua3lYXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDc1Zjk1YzYwZWMwNTdiYWUwMTJkMjgzY2Y5NWMxZjdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDU2ZmRkMTVlOWYzMDVhOGFjNjYzYjMxNDE0NzY3ZWI3MWUyZjVjNVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImExOWU0YWNhYjcxOGZkYjdiODk0OWMxOGU1NTg0OTU0MmQ3MjZmZTk5MDBjMjg1N2M4OGNmOWE1MDJhYjI4N2JcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA2NjY4NDQwNFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3MDUwNTQ0OVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkzMSktMjI0LTY3OTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5NCktNzA3LTE1MDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMDMtNDAtMTgwNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzEzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjgzZjc3NzExNDVlNzYyY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFuZXRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJpY2VcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU4MjYgb2FrIHJpZGdlIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmb3VudGFpbiB2YWxsZXlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NDY0OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFuZXQucmljZTY2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJwYW5kYTQ1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmdXp6eVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5MWF2NFpaTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjRjMTkwMTc3YjU2ODgxODk2YTkzMjZjZGM0NTkxZjQ1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjliNjEzOTk3NDliZGVlMzUyM2Q0NGM5MTAwNmU5YWEwMGNhZTIyZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjMzY0YjVmMzljNTU5ZTQ3YTA3ZjQwYTIxOWEwNzVjZThmZjkwYzc3NjUyOTEzYTEyMTI1ODMyY2EwYTk5MTY4XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNjk0MzkzNjVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Nzc0MTcxNzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NTMpLTg0MC0yMzc4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxOTEpLTI2NC03Mzc3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDA2LTE5LTUzMjZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzgxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjIxZDg4YTM5YzU4ZDNkOWRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJoaWxkYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FtcGJlbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE1ODAgcGx1bSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWtyb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJmbG9yaWRhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI1ODQyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoaWxkYS5jYW1wYmVsbDg3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZXBhbmRhMjQzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmZXN0aXZhbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJVT2ZoRjBsMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE2Y2VmM2ZkMzc5NjU2ZjJkMTEyYzg4N2FmYjRiMTRlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImUwMTFmNTZkNmViM2I2NmY1OTc5NzQ3NDQ1ZDljMDFiODk2OTYxYTBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyZmY0NzYwNWI3ZGNkZjRkZDJiMjQ1ZWY2YTVkNzQwNDgxZDlmYzQzMWRjNTA4ZWU4NzMzZWVmMWM2ODBjZjM1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkzODIxNzM2NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ0NjE0ODYzNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDczOSktMTE4LTUzNjVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU4NCktODg5LTQ3NTlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4NjQtMTktMzI2NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMWIyNDQwOTY2NGRhNTMzMFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb25uaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1jZG9uYWxpZFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTcwNSB3YWxudXQgaGlsbCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVuY2FudmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhcml6b25hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjMxOTkxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb25uaWUubWNkb25hbGlkNjFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImNyYXp5cGFuZGEzNjJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNoZWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInBSbkhxWEV4XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDU2YzE1ZTRiYzkzM2I1NjJmNGY1Yzg1NGRjMGQzZDlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjE2MTBiMzVhZDAzOTg1ZGI3ZGE5YTAwMzdiY2M4ZDYzZDY5ZWVmNVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ0MjE3NDJmZmE0NjkzNDkzM2ZjYzczNWI3ZjQ4ZDgxZjliZWIxMTU5OWEwNTM5YmRkODM4MzgzN2IwMzcwOWFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTM5MzM1MzM5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTY1ODc4NjI2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDM5KS0yNTAtNDM0MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDg4KS0xMjMtMjI2MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkxOC04Ny02Nzk3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI0YmQyNWRmYzU3YWVmMzg1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvbGFuZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGFsZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzEwMyB3b29kbGFuZCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibWVzcXVpdGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4OTcyN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9sYW5kLmhhbGU1N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZXdvbGY2ODZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNvdWdhcnNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSkhaaEt4RmVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwOTVkNjZjMTJkZjNkZmNlZDBlZWJmYTdiMWQzODViMlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhODc2M2EzN2FmZjk0NDI5ZWY5Mjg0M2FkMTFjMzQzNGFhNTc5YTUyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjRjMTBkZDZkYTBlYTc1MGY5Y2NkMjU1YWQwZWY2NDViZjU0YWYwYzI0YmRkMGRlNWY5ZWZhZTFiNzMxMmIxM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MzgzNjUzMTZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODEyMTMzMjlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NjIpLTg1My04Njc3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMzUpLTg3Mi02MjIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDY0LTY5LTU1MDlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8zOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8zOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjJkNGRkYzljMDM3NDIyOWFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqdW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXNoaW5ndG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTExIHRpbWJlciB3b2xmIHRyYWlsXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb3MgYW5nZWxlc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pbm5lc290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2Njc5NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwianVuZS53YXNoaW5ndG9uMjNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ2VsZXBoYW50MTJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNvbmRvbVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtUzV2bHFFdFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQ0YzMwNTc0NTQzMTIyMjBjZTc3NmMyMzAzZWE5ZDNlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA2NzEzYzNiNjgzYjNhMjlhYTY2ODZmOWJjYzcxNWJhN2ZkYTU2MTJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlYzcwZTBmYjNmMTkxOTJlMjUyY2JiNjgxMGEwNDg4NWJhNmRmMzk5MWM3YWQ4Y2EyNjM3NTA1NTEzZDczNWFlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMTEwOTczNTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDAzNDY1ODdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NjYpLTg0MC01MjkxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2NDgpLTYyMS05NDE5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjMyLTEwLTQ0MjVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImMxZGZlOTQ0MjQyMzQ4NTVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFtaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhbGR3ZWxsXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyMDcxIGJydWNlIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldmFuc3ZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IG1leGljb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MzQ4NFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFtaWUuY2FsZHdlbGwyNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW5idXR0ZXJmbHkzMjlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZldHRpc2hcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUkJVRmdjNHlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYzQ3YWUxMGJhNWMxMzQ4NTYxMzUyNzBlYTMyM2M5OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmOTlmZmI3YzY2ZWQwNWU5MjkxM2QwNzBhZjU2Yjg3OGFkOGI0ZTQ5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2I4Y2RlMTJiNmNhM2ExMDZiMGY4NDBkNzllMmRhMjk0MDVhNjIyNmEyODUwNzc3NmJlMzY1NmVmN2QzN2E1M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc1OTg3NjY0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc0MzgxOTk3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTAxKS02NjYtMTU4NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTI1KS02MDMtMjI3MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgwOS0xMi02OTQxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80NC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3MTBjZTAyNjY0MmRkNmNmXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZ2xlbmRhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmZXJndXNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjgwNSBjb3VudHJ5IGNsdWIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJvemVtYW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUwMTQwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJnbGVuZGEuZmVyZ3Vzb242OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlbGFkeWJ1ZzQ1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamF5aGF3a1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSZFVEUVpLTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE3ZDE3ZDUxNzU0YjRlMGZjZTE4YmJmNGRmYjZmMmYwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE5NGQ3ZjZjNGQ0ZjIxNmM4ZmZlNTVmMWQ4YjhlM2IzYTEzNzQxNjBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YWFjMjAzZjVlMzAwZDIwYjY5Y2FhZmYxZTc5OThhMTQwOTVkNjVhOGQzNTRmMTBjOGUyMTdkZTA0OGM1NzkyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMjA2NjA5ODBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjYzMzQ4MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk1MSktNjI5LTI4MzRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyOSktNTQxLTgzNDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NzktNDMtOTY4OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTU3ZGVlYjA1MDQwMzQzYVwiXG4gICAgfVxuXSIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpO1xuXG5mdW5jdGlvbiB3YXRjaEZpbHRlcihvYmplY3QsIGZpbHRlciwgaGFuZGxlciwgbW9kZWwpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0nb2JqZWN0Jykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoIW1vZGVsKXtcbiAgICAgICAgbW9kZWwgPSBuZXcgRW50aShvYmplY3QpO1xuICAgIH1cblxuICAgIHZhciBkb3RJbmRleCA9IGZpbHRlci5pbmRleE9mKCcuJyksXG4gICAgICAgIGlzTGFzdCA9ICF+ZG90SW5kZXgsXG4gICAgICAgIHRhcmdldCA9IGlzTGFzdCA/IGZpbHRlciA6IGZpbHRlci5zbGljZSgwLCBkb3RJbmRleCksXG4gICAgICAgIGlzRG91YmxlU3RhciA9IHRhcmdldCA9PT0gJyoqJyxcbiAgICAgICAgaXNWYWx1ZVN0YXIgPSB0YXJnZXQgPT09ICcqJCcsXG4gICAgICAgIHJlc3QgPSBpc0xhc3QgPyBudWxsIDogZmlsdGVyLnNsaWNlKGRvdEluZGV4KzEpLFxuICAgICAgICByZWFsS2V5ID0gdGFyZ2V0LmNoYXJBdCgwKSAhPT0gJyonLFxuICAgICAgICBjaGlsZFdhdGNoZXMgPSBbXTtcblxuICAgIGZ1bmN0aW9uIHVud2F0Y2goKXtcbiAgICAgICAgbW9kZWwuZGV0YWNoKCk7XG4gICAgICAgIG1vZGVsLl9ldmVudHMgPSB7fTtcbiAgICAgICAgd2hpbGUoY2hpbGRXYXRjaGVzLmxlbmd0aCl7XG4gICAgICAgICAgICB2YXIgcmVtb3ZlID0gY2hpbGRXYXRjaGVzLnBvcCgpO1xuICAgICAgICAgICAgcmVtb3ZlICYmIHJlbW92ZSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlT24oa2V5KXtcbiAgICAgICAgbW9kZWwub24oa2V5LCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgdW53YXRjaCgpO1xuICAgICAgICAgICAgbW9kZWwuYXR0YWNoKG9iamVjdCk7XG4gICAgICAgICAgICB3YXRjaEZpbHRlcihvYmplY3QsIGZpbHRlciwgaGFuZGxlciwgbW9kZWwpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB1cGRhdGVPbignKicpO1xuXG4gICAgaWYocmVhbEtleSl7XG4gICAgICAgIGlmKHJlc3Qpe1xuICAgICAgICAgICAgY2hpbGRXYXRjaGVzLnB1c2god2F0Y2hGaWx0ZXIob2JqZWN0W3RhcmdldF0sIHJlc3QsIGhhbmRsZXIpKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBtb2RlbC5vbih0YXJnZXQsIGhhbmRsZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlT24odGFyZ2V0KTtcbiAgICB9ZWxzZSBpZih0YXJnZXQuY2hhckF0KDApID09PSAnKicpe1xuICAgICAgICBpZighcmVzdCl7XG4gICAgICAgICAgICBtb2RlbC5vbignKicsIGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBmb3IodmFyIGtleSBpbiBvYmplY3Qpe1xuICAgICAgICAgICAgdXBkYXRlT24oa2V5KTtcbiAgICAgICAgICAgIGlmKHJlc3Qpe1xuICAgICAgICAgICAgICAgIGNoaWxkV2F0Y2hlcy5wdXNoKHdhdGNoRmlsdGVyKG9iamVjdFtrZXldLCByZXN0LCBoYW5kbGVyKSk7XG4gICAgICAgICAgICAgICAgaWYoaXNEb3VibGVTdGFyKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRXYXRjaGVzLnB1c2god2F0Y2hGaWx0ZXIob2JqZWN0W2tleV0sICcqKi4nICsgcmVzdCwgaGFuZGxlcikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGlmKGlzVmFsdWVTdGFyIHx8IGlzRG91YmxlU3Rhcil7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLm9uKGtleSwgaGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKGlzRG91YmxlU3Rhcil7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkV2F0Y2hlcy5wdXNoKHdhdGNoRmlsdGVyKG9iamVjdFtrZXldLCAnKionLCBoYW5kbGVyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVud2F0Y2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gd2F0Y2goYmluZGluZywgZmlsdGVyKXtcbiAgICBpZighZmlsdGVyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBcbiAgICB2YXIgcmVtb3ZlLFxuICAgICAgICBsYXN0VGFyZ2V0ID0gYmluZGluZygpO1xuXG4gICAgZnVuY3Rpb24gaGFuZGxlcih0YXJnZXQpe1xuICAgICAgICBiaW5kaW5nLl9jaGFuZ2UoYmluZGluZygpLCB0YXJnZXQpO1xuICAgIH1cblxuICAgIGJpbmRpbmcub24oJ2NoYW5nZScsIGZ1bmN0aW9uKG5ld1RhcmdldCl7XG4gICAgICAgIGlmKGxhc3RUYXJnZXQgIT09IG5ld1RhcmdldCl7XG4gICAgICAgICAgICBsYXN0VGFyZ2V0ID0gbmV3VGFyZ2V0O1xuICAgICAgICAgICAgcmVtb3ZlICYmIHJlbW92ZSgpO1xuICAgICAgICAgICAgcmVtb3ZlID0gd2F0Y2hGaWx0ZXIobmV3VGFyZ2V0LCBmaWx0ZXIsIGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBiaW5kaW5nLm9uKCdkZXRhY2gnLCBmdW5jdGlvbihuZXdUYXJnZXQpe1xuICAgICAgICByZW1vdmUgJiYgcmVtb3ZlKCk7XG4gICAgfSk7XG5cbiAgICByZW1vdmUgPSB3YXRjaEZpbHRlcihsYXN0VGFyZ2V0LCBmaWx0ZXIsIGhhbmRsZXIpO1xufTsiLCJ2YXIgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKSxcbiAgICBjb250YWluZXJDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbnRhaW5lckNvbXBvbmVudCcpO1xuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0eShmYXN0biwgZ2VuZXJpYywga2V5LCBzZXR0aW5ncyl7XG4gICAgdmFyIHNldHRpbmcgPSBzZXR0aW5nc1trZXldLFxuICAgICAgICBiaW5kaW5nID0gZmFzdG4uaXNCaW5kaW5nKHNldHRpbmcpICYmIHNldHRpbmcsXG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4uaXNQcm9wZXJ0eShzZXR0aW5nKSAmJiBzZXR0aW5nLFxuICAgICAgICB2YWx1ZSA9ICFiaW5kaW5nICYmICFwcm9wZXJ0eSAmJiBzZXR0aW5nIHx8IG51bGw7XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpe1xuICAgICAgICByZXR1cm47XG4gICAgfSBcblxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4ucHJvcGVydHkodmFsdWUpO1xuICAgIH1lbHNle1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoYmluZGluZyl7XG4gICAgICAgIHByb3BlcnR5LmJpbmRpbmcoYmluZGluZyk7XG4gICAgfVxuXG4gICAgZ2VuZXJpYy5vbigndXBkYXRlJywgcHJvcGVydHkudXBkYXRlKTtcbiAgICBnZW5lcmljLm9uKCdhdHRhY2gnLCBwcm9wZXJ0eS5hdHRhY2gpO1xuICAgIHByb3BlcnR5Lm9uKCd1cGRhdGUnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGlmKCFnZW5lcmljLmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGVsZW1lbnQgPSBnZW5lcmljLmVsZW1lbnQsXG4gICAgICAgICAgICBpc1Byb3BlcnR5ID0ga2V5IGluIGVsZW1lbnQsXG4gICAgICAgICAgICBwcmV2aW91cyA9IGlzUHJvcGVydHkgPyBlbGVtZW50W2tleV0gOiBlbGVtZW50LmdldEF0dHJpYnV0ZShrZXkpO1xuXG4gICAgICAgIGlmKHZhbHVlID09IG51bGwpe1xuICAgICAgICAgICAgdmFsdWUgPSAnJztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHZhbHVlICE9PSBwcmV2aW91cyl7XG4gICAgICAgICAgICBpZihpc1Byb3BlcnR5KXtcbiAgICAgICAgICAgICAgICBlbGVtZW50W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1lbHNlIGlmKHR5cGVvZiB2YWx1ZSAhPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgZ2VuZXJpY1trZXldID0gcHJvcGVydHk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnRpZXMoZmFzdG4sIGdlbmVyaWMsIHNldHRpbmdzKXtcbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIGNyZWF0ZVByb3BlcnR5KGZhc3RuLCBnZW5lcmljLCBrZXksIHNldHRpbmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGFkZFVwZGF0ZUhhbmRsZXIoZ2VuZXJpYywgZXZlbnROYW1lLCBzZXR0aW5ncyl7XG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGdlbmVyaWMuZW1pdChldmVudE5hbWUsIGV2ZW50LCBnZW5lcmljLnNjb3BlKCkpO1xuICAgIH07XG5cbiAgICBnZW5lcmljLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuXG4gICAgZ2VuZXJpYy5vbignZGVzdHJveScsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGdlbmVyaWMuZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZEF1dG9IYW5kbGVyKGdlbmVyaWMsIGtleSwgc2V0dGluZ3Mpe1xuICAgIHZhciBhdXRvRXZlbnQgPSBzZXR0aW5nc1trZXldLnNwbGl0KCc6JyksXG4gICAgICAgIGV2ZW50TmFtZSA9IGtleS5zbGljZSgyKTtcbiAgICAgICAgXG4gICAgZGVsZXRlIHNldHRpbmdzW2tleV07XG5cbiAgICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgICAgICAgZ2VuZXJpY1thdXRvRXZlbnRbMF1dKGdlbmVyaWMuZWxlbWVudFthdXRvRXZlbnRbMV1dKTtcbiAgICB9O1xuXG4gICAgZ2VuZXJpYy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcblxuICAgIGdlbmVyaWMub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuICAgIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuICAgIGlmKGNoaWxkcmVuLmxlbmd0aCA9PT0gMSAmJiAhZmFzdG4uaXNDb21wb25lbnQoY2hpbGRyZW5bMF0pKXtcbiAgICAgICAgc2V0dGluZ3MudGV4dENvbnRlbnQgPSBjaGlsZHJlbi5wb3AoKTtcbiAgICB9XG5cbiAgICB2YXIgZ2VuZXJpYyA9IGNvbnRhaW5lckNvbXBvbmVudCh0eXBlLCBmYXN0bik7XG5cbiAgICBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBnZW5lcmljLCBzZXR0aW5ncyk7XG5cbiAgICBnZW5lcmljLnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIGdlbmVyaWMuZWxlbWVudCA9IGNyZWwodHlwZSk7XG5cbiAgICAgICAgZ2VuZXJpYy5lbWl0KCdyZW5kZXInKTtcblxuICAgICAgICByZXR1cm4gZ2VuZXJpYztcbiAgICB9O1xuXG4gICAgZ2VuZXJpYy5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcblxuICAgICAgICAvL1xuICAgICAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgICAgICBpZihrZXkuc2xpY2UoMCwyKSA9PT0gJ29uJyAmJiBrZXkgaW4gZ2VuZXJpYy5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRBdXRvSGFuZGxlcihnZW5lcmljLCBrZXksIHNldHRpbmdzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZvcih2YXIga2V5IGluIGdlbmVyaWMuX2V2ZW50cyl7XG4gICAgICAgICAgICBpZignb24nICsga2V5LnRvTG93ZXJDYXNlKCkgaW4gZ2VuZXJpYy5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGdlbmVyaWM7XG59OyIsInZhciBtZXJnZSA9IHJlcXVpcmUoJ2ZsYXQtbWVyZ2UnKSxcbiAgICBjcmVhdGVDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbXBvbmVudCcpLFxuICAgIGNyZWF0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9wcm9wZXJ0eScpLFxuICAgIGNyZWF0ZUJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihjb21wb25lbnRzLCBkZWJ1Zyl7XG5cbiAgICBmdW5jdGlvbiBmYXN0bih0eXBlKXtcbiAgICAgICAgdmFyIGFyZ3MgPSBbXTtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHNldHRpbmdzID0gYXJnc1sxXSxcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXggPSAyO1xuXG4gICAgICAgIGlmKGlzLmNvbXBvbmVudChhcmdzWzFdKSB8fCB0eXBlb2YgYXJnc1sxXSAhPT0gJ29iamVjdCcgfHwgIWFyZ3NbMV0pe1xuICAgICAgICAgICAgY2hpbGRyZW5JbmRleC0tO1xuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZUNvbXBvbmVudCh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGFyZ3Muc2xpY2UoY2hpbGRyZW5JbmRleCksIGNvbXBvbmVudHMpO1xuICAgIH1cblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG5cbiAgICBmYXN0bi5wcm9wZXJ0eSA9IGNyZWF0ZVByb3BlcnR5O1xuXG4gICAgZmFzdG4uYmluZGluZyA9IGNyZWF0ZUJpbmRpbmc7XG5cbiAgICBmYXN0bi5pc0NvbXBvbmVudCA9IGlzLmNvbXBvbmVudDtcbiAgICBmYXN0bi5pc0JpbmRpbmcgPSBpcy5iaW5kaW5nO1xuICAgIGZhc3RuLmlzRGVmYXVsdEJpbmRpbmcgPSBpcy5kZWZhdWx0QmluZGluZztcbiAgICBmYXN0bi5pc0JpbmRpbmdPYmplY3QgPSBpcy5iaW5kaW5nT2JqZWN0O1xuICAgIGZhc3RuLmlzUHJvcGVydHkgPSBpcy5wcm9wZXJ0eTtcblxuICAgIHJldHVybiBmYXN0bjtcbn07IiwiXG5mdW5jdGlvbiBpc0NvbXBvbmVudCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9jb21wb25lbnQnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmdPYmplY3QodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc1Byb3BlcnR5KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fcHJvcGVydHknIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0RlZmF1bHRCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmcgJiYgJ19kZWZhdWx0X2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb21wb25lbnQ6IGlzQ29tcG9uZW50LFxuICAgIGJpbmRpbmdPYmplY3Q6IGlzQmluZGluZ09iamVjdCxcbiAgICBiaW5kaW5nOiBpc0JpbmRpbmcsXG4gICAgZGVmYXVsdEJpbmRpbmc6IGlzRGVmYXVsdEJpbmRpbmcsXG4gICAgcHJvcGVydHk6IGlzUHJvcGVydHlcbn07IiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBnZW5lcmljQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9nZW5lcmljQ29tcG9uZW50Jyk7XG5cbmZ1bmN0aW9uIGVhY2godmFsdWUsIGZuKXtcbiAgICBpZighdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkodmFsdWUpO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gdmFsdWUpe1xuICAgICAgICBpZihpc0FycmF5ICYmIGlzTmFOKGtleSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBmbih2YWx1ZVtrZXldLCBrZXkpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24ga2V5Rm9yKG9iamVjdCwgdmFsdWUpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgaWYob2JqZWN0W2tleV0gPT09IHZhbHVlKXtcbiAgICAgICAgICAgIHJldHVybiBrZXk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHZhbHVlcyhvYmplY3Qpe1xuICAgIGlmKEFycmF5LmlzQXJyYXkob2JqZWN0KSl7XG4gICAgICAgIHJldHVybiBvYmplY3Quc2xpY2UoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gW107XG5cbiAgICBmb3IodmFyIGtleSBpbiBvYmplY3Qpe1xuICAgICAgICByZXN1bHQucHVzaChvYmplY3Rba2V5XSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgbGlzdCA9IGdlbmVyaWNDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbiksXG4gICAgICAgIGxhc3RJdGVtcyA9IFtdLFxuICAgICAgICBsYXN0Q29tcG9uZW50cyA9IFtdO1xuXG4gICAgZnVuY3Rpb24gdXBkYXRlSXRlbXModmFsdWUpe1xuICAgICAgICB2YXIgdGVtcGxhdGUgPSBsaXN0Ll9zZXR0aW5ncy50ZW1wbGF0ZTtcbiAgICAgICAgaWYoIXRlbXBsYXRlKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjdXJyZW50SXRlbXMgPSB2YWx1ZXModmFsdWUpO1xuXG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBsYXN0SXRlbXMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBsYXN0SXRlbXNbaV0sXG4gICAgICAgICAgICAgICAgY29tcG9uZW50ID0gbGFzdENvbXBvbmVudHNbaV0sXG4gICAgICAgICAgICAgICAgY3VycmVudEluZGV4ID0gY3VycmVudEl0ZW1zLmluZGV4T2YoaXRlbSk7XG5cbiAgICAgICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgICAgIGN1cnJlbnRJdGVtcy5zcGxpY2UoY3VycmVudEluZGV4LDEpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgbGFzdEl0ZW1zLnNwbGljZShpLCAxKTtcbiAgICAgICAgICAgICAgICBsYXN0Q29tcG9uZW50cy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgaS0tO1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgICAgICAgICAgICAgbGlzdC5yZW1vdmUoY29tcG9uZW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpbmRleCA9IDAsXG4gICAgICAgICAgICBuZXdJdGVtcyA9IFtdLFxuICAgICAgICAgICAgbmV3Q29tcG9uZW50cyA9IFtdO1xuXG4gICAgICAgIGVhY2godmFsdWUsIGZ1bmN0aW9uKGl0ZW0sIGtleSl7XG4gICAgICAgICAgICB2YXIgY2hpbGQsXG4gICAgICAgICAgICAgICAgbGFzdEtleSA9IGtleUZvcihsYXN0SXRlbXMsIGl0ZW0pLFxuICAgICAgICAgICAgICAgIG1vZGVsID0gbmV3IEVudGkoe1xuICAgICAgICAgICAgICAgICAgICBpdGVtOiBpdGVtLFxuICAgICAgICAgICAgICAgICAgICBrZXk6IGtleVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZihsYXN0S2V5ID09PSBmYWxzZSl7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSB0ZW1wbGF0ZShtb2RlbCwgbGlzdC5zY29wZSgpKTtcbiAgICAgICAgICAgICAgICBjaGlsZC5fdGVtcGxhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIG5ld0l0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgbmV3Q29tcG9uZW50cy5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIG5ld0l0ZW1zLnB1c2gobGFzdEl0ZW1zW2xhc3RLZXldKTtcbiAgICAgICAgICAgICAgICBsYXN0SXRlbXMuc3BsaWNlKGxhc3RLZXksMSlcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbGFzdENvbXBvbmVudHNbbGFzdEtleV07XG4gICAgICAgICAgICAgICAgbGFzdENvbXBvbmVudHMuc3BsaWNlKGxhc3RLZXksMSk7XG4gICAgICAgICAgICAgICAgbmV3Q29tcG9uZW50cy5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY2hpbGQpKXtcbiAgICAgICAgICAgICAgICBpZihmYXN0bi5pc0RlZmF1bHRCaW5kaW5nKGNoaWxkLmJpbmRpbmcoKSkpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC5iaW5kaW5nKCdpdGVtJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNoaWxkLmF0dGFjaChtb2RlbCwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkLCBpbmRleCk7XG5cbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxhc3RJdGVtcyA9IG5ld0l0ZW1zO1xuICAgICAgICBsYXN0Q29tcG9uZW50cyA9IG5ld0NvbXBvbmVudHM7XG4gICAgfVxuXG4gICAgbGlzdC5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICB0aGlzLmVsZW1lbnQgPSBjcmVsKCdkaXYnKTtcbiAgICAgICAgdGhpcy5pdGVtcy5vbigndXBkYXRlJywgdXBkYXRlSXRlbXMpO1xuICAgICAgICB1cGRhdGVJdGVtcyh0aGlzLml0ZW1zKCkpO1xuICAgICAgICB0aGlzLmVtaXQoJ3JlbmRlcicpO1xuICAgIH07XG5cbiAgICBsaXN0Lml0ZW1zID0gZmFzdG4ucHJvcGVydHkoW10sIHVwZGF0ZUl0ZW1zKS5iaW5kaW5nKHNldHRpbmdzLml0ZW1zKTtcbiAgICBsaXN0Lm9uKCdhdHRhY2gnLCBsaXN0Lml0ZW1zLmF0dGFjaCk7XG5cbiAgICByZXR1cm4gbGlzdDtcbn07IiwiLy9Db3B5cmlnaHQgKEMpIDIwMTIgS29yeSBOdW5uXHJcblxyXG4vL1Blcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XHJcblxyXG4vL1RoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxyXG5cclxuLy9USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cclxuXHJcbi8qXHJcblxyXG4gICAgVGhpcyBjb2RlIGlzIG5vdCBmb3JtYXR0ZWQgZm9yIHJlYWRhYmlsaXR5LCBidXQgcmF0aGVyIHJ1bi1zcGVlZCBhbmQgdG8gYXNzaXN0IGNvbXBpbGVycy5cclxuXHJcbiAgICBIb3dldmVyLCB0aGUgY29kZSdzIGludGVudGlvbiBzaG91bGQgYmUgdHJhbnNwYXJlbnQuXHJcblxyXG4gICAgKioqIElFIFNVUFBPUlQgKioqXHJcblxyXG4gICAgSWYgeW91IHJlcXVpcmUgdGhpcyBsaWJyYXJ5IHRvIHdvcmsgaW4gSUU3LCBhZGQgdGhlIGZvbGxvd2luZyBhZnRlciBkZWNsYXJpbmcgY3JlbC5cclxuXHJcbiAgICB2YXIgdGVzdERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG4gICAgICAgIHRlc3RMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xhYmVsJyk7XHJcblxyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgJ2EnKTtcclxuICAgIHRlc3REaXZbJ2NsYXNzTmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2NsYXNzJ10gPSAnY2xhc3NOYW1lJzp1bmRlZmluZWQ7XHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnbmFtZScsJ2EnKTtcclxuICAgIHRlc3REaXZbJ25hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWyduYW1lJ10gPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XHJcbiAgICAgICAgZWxlbWVudC5pZCA9IHZhbHVlO1xyXG4gICAgfTp1bmRlZmluZWQ7XHJcblxyXG5cclxuICAgIHRlc3RMYWJlbC5zZXRBdHRyaWJ1dGUoJ2ZvcicsICdhJyk7XHJcbiAgICB0ZXN0TGFiZWxbJ2h0bWxGb3InXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydmb3InXSA9ICdodG1sRm9yJzp1bmRlZmluZWQ7XHJcblxyXG5cclxuXHJcbiovXHJcblxyXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmNyZWwgPSBmYWN0b3J5KCk7XHJcbiAgICB9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG4gICAgdmFyIGZuID0gJ2Z1bmN0aW9uJyxcclxuICAgICAgICBvYmogPSAnb2JqZWN0JyxcclxuICAgICAgICBpc1R5cGUgPSBmdW5jdGlvbihhLCB0eXBlKXtcclxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhID09PSB0eXBlO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNOb2RlID0gdHlwZW9mIE5vZGUgPT09IGZuID8gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgTm9kZTtcclxuICAgICAgICB9IDpcclxuICAgICAgICAvLyBpbiBJRSA8PSA4IE5vZGUgaXMgYW4gb2JqZWN0LCBvYnZpb3VzbHkuLlxyXG4gICAgICAgIGZ1bmN0aW9uKG9iamVjdCl7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3QsIG9iaikgJiZcclxuICAgICAgICAgICAgICAgICgnbm9kZVR5cGUnIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbC5pc05vZGUob2JqZWN0KSAmJiBvYmplY3Qubm9kZVR5cGUgPT09IDE7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0FycmF5ID0gZnVuY3Rpb24oYSl7XHJcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcHBlbmRDaGlsZCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGNoaWxkKSB7XHJcbiAgICAgICAgICBpZighaXNOb2RlKGNoaWxkKSl7XHJcbiAgICAgICAgICAgICAgY2hpbGQgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShjaGlsZCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBlbGVtZW50LmFwcGVuZENoaWxkKGNoaWxkKTtcclxuICAgICAgICB9O1xyXG5cclxuXHJcbiAgICBmdW5jdGlvbiBjcmVsKCl7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHMsIC8vTm90ZTogYXNzaWduZWQgdG8gYSB2YXJpYWJsZSB0byBhc3Npc3QgY29tcGlsZXJzLiBTYXZlcyBhYm91dCA0MCBieXRlcyBpbiBjbG9zdXJlIGNvbXBpbGVyLiBIYXMgbmVnbGlnYWJsZSBlZmZlY3Qgb24gcGVyZm9ybWFuY2UuXHJcbiAgICAgICAgICAgIGVsZW1lbnQgPSBhcmdzWzBdLFxyXG4gICAgICAgICAgICBjaGlsZCxcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBhcmdzWzFdLFxyXG4gICAgICAgICAgICBjaGlsZEluZGV4ID0gMixcclxuICAgICAgICAgICAgYXJndW1lbnRzTGVuZ3RoID0gYXJncy5sZW5ndGgsXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZU1hcCA9IGNyZWwuYXR0ck1hcDtcclxuXHJcbiAgICAgICAgZWxlbWVudCA9IGNyZWwuaXNFbGVtZW50KGVsZW1lbnQpID8gZWxlbWVudCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoZWxlbWVudCk7XHJcbiAgICAgICAgLy8gc2hvcnRjdXRcclxuICAgICAgICBpZihhcmd1bWVudHNMZW5ndGggPT09IDEpe1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCFpc1R5cGUoc2V0dGluZ3Msb2JqKSB8fCBjcmVsLmlzTm9kZShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudC50ZXh0Q29udGVudCAhPT0gdW5kZWZpbmVkKXtcclxuICAgICAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGZvcig7IGNoaWxkSW5kZXggPCBhcmd1bWVudHNMZW5ndGg7ICsrY2hpbGRJbmRleCl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYoY2hpbGQgPT0gbnVsbCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGNoaWxkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGRbaV0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcclxuICAgICAgICAgICAgaWYoIWF0dHJpYnV0ZU1hcFtrZXldKXtcclxuICAgICAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBjcmVsLmF0dHJNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHIsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVc2VkIGZvciBtYXBwaW5nIG9uZSBraW5kIG9mIGF0dHJpYnV0ZSB0byB0aGUgc3VwcG9ydGVkIHZlcnNpb24gb2YgdGhhdCBpbiBiYWQgYnJvd3NlcnMuXHJcbiAgICAvLyBTdHJpbmcgcmVmZXJlbmNlZCBzbyB0aGF0IGNvbXBpbGVycyBtYWludGFpbiB0aGUgcHJvcGVydHkgbmFtZS5cclxuICAgIGNyZWxbJ2F0dHJNYXAnXSA9IHt9O1xyXG5cclxuICAgIC8vIFN0cmluZyByZWZlcmVuY2VkIHNvIHRoYXQgY29tcGlsZXJzIG1haW50YWluIHRoZSBwcm9wZXJ0eSBuYW1lLlxyXG4gICAgY3JlbFtcImlzRWxlbWVudFwiXSA9IGlzRWxlbWVudDtcclxuICAgIGNyZWxbXCJpc05vZGVcIl0gPSBpc05vZGU7XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwiZnVuY3Rpb24gZmxhdE1lcmdlKGEsYil7XG4gICAgaWYoIWIgfHwgdHlwZW9mIGIgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYiA9IHt9O1xuICAgIH1cblxuICAgIGlmKCFhIHx8IHR5cGVvZiBhICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGEgPSBuZXcgYi5jb25zdHJ1Y3RvcigpO1xuICAgIH1cblxuICAgIHZhciByZXN1bHQgPSBuZXcgYS5jb25zdHJ1Y3RvcigpLFxuICAgICAgICBhS2V5cyA9IE9iamVjdC5rZXlzKGEpLFxuICAgICAgICBiS2V5cyA9IE9iamVjdC5rZXlzKGIpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGFLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2FLZXlzW2ldXSA9IGFbYUtleXNbaV1dO1xuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBiS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFtiS2V5c1tpXV0gPSBiW2JLZXlzW2ldXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZsYXRNZXJnZTsiLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCdjbG9uZScpLFxuICAgIGRlZXBFcXVhbCA9IHJlcXVpcmUoJ2RlZXAtZXF1YWwnKTtcblxuZnVuY3Rpb24ga2V5c0FyZURpZmZlcmVudChrZXlzMSwga2V5czIpe1xuICAgIGlmKGtleXMxID09PSBrZXlzMil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYoIWtleXMxIHx8ICFrZXlzMiB8fCBrZXlzMS5sZW5ndGggIT09IGtleXMyLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5czEubGVuZ3RoOyBpKyspe1xuICAgICAgICBpZighfmtleXMyLmluZGV4T2Yoa2V5czFbaV0pKXtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRLZXlzKHZhbHVlKXtcbiAgICBpZighdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmtleXModmFsdWUpO1xufVxuXG5mdW5jdGlvbiBXaGF0Q2hhbmdlZCh2YWx1ZSwgY2hhbmdlc1RvVHJhY2spe1xuICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrID0ge307XG5cbiAgICBpZihjaGFuZ2VzVG9UcmFjayA9PSBudWxsKXtcbiAgICAgICAgY2hhbmdlc1RvVHJhY2sgPSAndmFsdWUgdHlwZSBrZXlzIHN0cnVjdHVyZSByZWZlcmVuY2UnO1xuICAgIH1cblxuICAgIGlmKHR5cGVvZiBjaGFuZ2VzVG9UcmFjayAhPT0gJ3N0cmluZycpe1xuICAgICAgICB0aHJvdyAnY2hhbmdlc1RvVHJhY2sgbXVzdCBiZSBvZiB0eXBlIHN0cmluZyc7XG4gICAgfVxuXG4gICAgY2hhbmdlc1RvVHJhY2sgPSBjaGFuZ2VzVG9UcmFjay5zcGxpdCgnICcpO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGFuZ2VzVG9UcmFjay5sZW5ndGg7IGkrKykge1xuICAgICAgICB0aGlzLl9jaGFuZ2VzVG9UcmFja1tjaGFuZ2VzVG9UcmFja1tpXV0gPSB0cnVlO1xuICAgIH07XG5cbiAgICB0aGlzLnVwZGF0ZSh2YWx1ZSk7XG59XG5XaGF0Q2hhbmdlZC5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24odmFsdWUpe1xuICAgIHZhciByZXN1bHQgPSB7fSxcbiAgICAgICAgY2hhbmdlc1RvVHJhY2sgPSB0aGlzLl9jaGFuZ2VzVG9UcmFjayxcbiAgICAgICAgbmV3S2V5cyA9IGdldEtleXModmFsdWUpO1xuXG4gICAgaWYoJ3ZhbHVlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB2YWx1ZSsnJyAhPT0gdGhpcy5fbGFzdFJlZmVyZW5jZSsnJyl7XG4gICAgICAgIHJlc3VsdC52YWx1ZSA9IHRydWU7XG4gICAgfVxuICAgIGlmKCd0eXBlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB0eXBlb2YgdmFsdWUgIT09IHR5cGVvZiB0aGlzLl9sYXN0VmFsdWUpe1xuICAgICAgICByZXN1bHQudHlwZSA9IHRydWU7XG4gICAgfVxuICAgIGlmKCdrZXlzJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiBrZXlzQXJlRGlmZmVyZW50KHRoaXMuX2xhc3RLZXlzLCBnZXRLZXlzKHZhbHVlKSkpe1xuICAgICAgICByZXN1bHQua2V5cyA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYodmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jyl7XG4gICAgICAgIGlmKCdzdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrICYmICFkZWVwRXF1YWwodmFsdWUsIHRoaXMuX2xhc3RWYWx1ZSkpe1xuICAgICAgICAgICAgcmVzdWx0LnN0cnVjdHVyZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYoJ3JlZmVyZW5jZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgdmFsdWUgIT09IHRoaXMuX2xhc3RSZWZlcmVuY2Upe1xuICAgICAgICAgICAgcmVzdWx0LnJlZmVyZW5jZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9sYXN0VmFsdWUgPSAnc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayA/IGNsb25lKHZhbHVlKSA6IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RSZWZlcmVuY2UgPSB2YWx1ZTtcbiAgICB0aGlzLl9sYXN0S2V5cyA9IG5ld0tleXM7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaGF0Q2hhbmdlZDsiLCIoZnVuY3Rpb24gKEJ1ZmZlcil7XG4ndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIG9iamVjdFRvU3RyaW5nKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn1cblxuLy8gc2hpbSBmb3IgTm9kZSdzICd1dGlsJyBwYWNrYWdlXG4vLyBETyBOT1QgUkVNT1ZFIFRISVMhIEl0IGlzIHJlcXVpcmVkIGZvciBjb21wYXRpYmlsaXR5IHdpdGggRW5kZXJKUyAoaHR0cDovL2VuZGVyanMuY29tLykuXG52YXIgdXRpbCA9IHtcbiAgaXNBcnJheTogZnVuY3Rpb24gKGFyKSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoYXIpIHx8ICh0eXBlb2YgYXIgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKGFyKSA9PT0gJ1tvYmplY3QgQXJyYXldJyk7XG4gIH0sXG4gIGlzRGF0ZTogZnVuY3Rpb24gKGQpIHtcbiAgICByZXR1cm4gdHlwZW9mIGQgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKGQpID09PSAnW29iamVjdCBEYXRlXSc7XG4gIH0sXG4gIGlzUmVnRXhwOiBmdW5jdGlvbiAocmUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHJlID09PSAnb2JqZWN0JyAmJiBvYmplY3RUb1N0cmluZyhyZSkgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xuICB9LFxuICBnZXRSZWdFeHBGbGFnczogZnVuY3Rpb24gKHJlKSB7XG4gICAgdmFyIGZsYWdzID0gJyc7XG4gICAgcmUuZ2xvYmFsICYmIChmbGFncyArPSAnZycpO1xuICAgIHJlLmlnbm9yZUNhc2UgJiYgKGZsYWdzICs9ICdpJyk7XG4gICAgcmUubXVsdGlsaW5lICYmIChmbGFncyArPSAnbScpO1xuICAgIHJldHVybiBmbGFncztcbiAgfVxufTtcblxuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpXG4gIG1vZHVsZS5leHBvcnRzID0gY2xvbmU7XG5cbi8qKlxuICogQ2xvbmVzIChjb3BpZXMpIGFuIE9iamVjdCB1c2luZyBkZWVwIGNvcHlpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBzdXBwb3J0cyBjaXJjdWxhciByZWZlcmVuY2VzIGJ5IGRlZmF1bHQsIGJ1dCBpZiB5b3UgYXJlIGNlcnRhaW5cbiAqIHRoZXJlIGFyZSBubyBjaXJjdWxhciByZWZlcmVuY2VzIGluIHlvdXIgb2JqZWN0LCB5b3UgY2FuIHNhdmUgc29tZSBDUFUgdGltZVxuICogYnkgY2FsbGluZyBjbG9uZShvYmosIGZhbHNlKS5cbiAqXG4gKiBDYXV0aW9uOiBpZiBgY2lyY3VsYXJgIGlzIGZhbHNlIGFuZCBgcGFyZW50YCBjb250YWlucyBjaXJjdWxhciByZWZlcmVuY2VzLFxuICogeW91ciBwcm9ncmFtIG1heSBlbnRlciBhbiBpbmZpbml0ZSBsb29wIGFuZCBjcmFzaC5cbiAqXG4gKiBAcGFyYW0gYHBhcmVudGAgLSB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZFxuICogQHBhcmFtIGBjaXJjdWxhcmAgLSBzZXQgdG8gdHJ1ZSBpZiB0aGUgb2JqZWN0IHRvIGJlIGNsb25lZCBtYXkgY29udGFpblxuICogICAgY2lyY3VsYXIgcmVmZXJlbmNlcy4gKG9wdGlvbmFsIC0gdHJ1ZSBieSBkZWZhdWx0KVxuICogQHBhcmFtIGBkZXB0aGAgLSBzZXQgdG8gYSBudW1iZXIgaWYgdGhlIG9iamVjdCBpcyBvbmx5IHRvIGJlIGNsb25lZCB0b1xuICogICAgYSBwYXJ0aWN1bGFyIGRlcHRoLiAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBJbmZpbml0eSlcbiAqIEBwYXJhbSBgcHJvdG90eXBlYCAtIHNldHMgdGhlIHByb3RvdHlwZSB0byBiZSB1c2VkIHdoZW4gY2xvbmluZyBhbiBvYmplY3QuXG4gKiAgICAob3B0aW9uYWwgLSBkZWZhdWx0cyB0byBwYXJlbnQgcHJvdG90eXBlKS5cbiovXG5cbmZ1bmN0aW9uIGNsb25lKHBhcmVudCwgY2lyY3VsYXIsIGRlcHRoLCBwcm90b3R5cGUpIHtcbiAgLy8gbWFpbnRhaW4gdHdvIGFycmF5cyBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlcywgd2hlcmUgY29ycmVzcG9uZGluZyBwYXJlbnRzXG4gIC8vIGFuZCBjaGlsZHJlbiBoYXZlIHRoZSBzYW1lIGluZGV4XG4gIHZhciBhbGxQYXJlbnRzID0gW107XG4gIHZhciBhbGxDaGlsZHJlbiA9IFtdO1xuXG4gIHZhciB1c2VCdWZmZXIgPSB0eXBlb2YgQnVmZmVyICE9ICd1bmRlZmluZWQnO1xuXG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT0gJ3VuZGVmaW5lZCcpXG4gICAgY2lyY3VsYXIgPSB0cnVlO1xuXG4gIGlmICh0eXBlb2YgZGVwdGggPT0gJ3VuZGVmaW5lZCcpXG4gICAgZGVwdGggPSBJbmZpbml0eTtcblxuICAvLyByZWN1cnNlIHRoaXMgZnVuY3Rpb24gc28gd2UgZG9uJ3QgcmVzZXQgYWxsUGFyZW50cyBhbmQgYWxsQ2hpbGRyZW5cbiAgZnVuY3Rpb24gX2Nsb25lKHBhcmVudCwgZGVwdGgpIHtcbiAgICAvLyBjbG9uaW5nIG51bGwgYWx3YXlzIHJldHVybnMgbnVsbFxuICAgIGlmIChwYXJlbnQgPT09IG51bGwpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGlmIChkZXB0aCA9PSAwKVxuICAgICAgcmV0dXJuIHBhcmVudDtcblxuICAgIHZhciBjaGlsZDtcbiAgICB2YXIgcHJvdG87XG4gICAgaWYgKHR5cGVvZiBwYXJlbnQgIT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBwYXJlbnQ7XG4gICAgfVxuXG4gICAgaWYgKHV0aWwuaXNBcnJheShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IFtdO1xuICAgIH0gZWxzZSBpZiAodXRpbC5pc1JlZ0V4cChwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBSZWdFeHAocGFyZW50LnNvdXJjZSwgdXRpbC5nZXRSZWdFeHBGbGFncyhwYXJlbnQpKTtcbiAgICAgIGlmIChwYXJlbnQubGFzdEluZGV4KSBjaGlsZC5sYXN0SW5kZXggPSBwYXJlbnQubGFzdEluZGV4O1xuICAgIH0gZWxzZSBpZiAodXRpbC5pc0RhdGUocGFyZW50KSkge1xuICAgICAgY2hpbGQgPSBuZXcgRGF0ZShwYXJlbnQuZ2V0VGltZSgpKTtcbiAgICB9IGVsc2UgaWYgKHVzZUJ1ZmZlciAmJiBCdWZmZXIuaXNCdWZmZXIocGFyZW50KSkge1xuICAgICAgY2hpbGQgPSBuZXcgQnVmZmVyKHBhcmVudC5sZW5ndGgpO1xuICAgICAgcGFyZW50LmNvcHkoY2hpbGQpO1xuICAgICAgcmV0dXJuIGNoaWxkO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodHlwZW9mIHByb3RvdHlwZSA9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBwcm90byA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwYXJlbnQpO1xuICAgICAgICBjaGlsZCA9IE9iamVjdC5jcmVhdGUocHJvdG8pO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90b3R5cGUpO1xuICAgICAgICBwcm90byA9IHByb3RvdHlwZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2lyY3VsYXIpIHtcbiAgICAgIHZhciBpbmRleCA9IGFsbFBhcmVudHMuaW5kZXhPZihwYXJlbnQpO1xuXG4gICAgICBpZiAoaW5kZXggIT0gLTEpIHtcbiAgICAgICAgcmV0dXJuIGFsbENoaWxkcmVuW2luZGV4XTtcbiAgICAgIH1cbiAgICAgIGFsbFBhcmVudHMucHVzaChwYXJlbnQpO1xuICAgICAgYWxsQ2hpbGRyZW4ucHVzaChjaGlsZCk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSBpbiBwYXJlbnQpIHtcbiAgICAgIHZhciBhdHRycztcbiAgICAgIGlmIChwcm90bykge1xuICAgICAgICBhdHRycyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG8sIGkpO1xuICAgICAgfVxuICAgICAgXG4gICAgICBpZiAoYXR0cnMgJiYgYXR0cnMuc2V0ID09IG51bGwpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjaGlsZFtpXSA9IF9jbG9uZShwYXJlbnRbaV0sIGRlcHRoIC0gMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoaWxkO1xuICB9XG5cbiAgcmV0dXJuIF9jbG9uZShwYXJlbnQsIGRlcHRoKTtcbn1cblxuLyoqXG4gKiBTaW1wbGUgZmxhdCBjbG9uZSB1c2luZyBwcm90b3R5cGUsIGFjY2VwdHMgb25seSBvYmplY3RzLCB1c2VmdWxsIGZvciBwcm9wZXJ0eVxuICogb3ZlcnJpZGUgb24gRkxBVCBjb25maWd1cmF0aW9uIG9iamVjdCAobm8gbmVzdGVkIHByb3BzKS5cbiAqXG4gKiBVU0UgV0lUSCBDQVVUSU9OISBUaGlzIG1heSBub3QgYmVoYXZlIGFzIHlvdSB3aXNoIGlmIHlvdSBkbyBub3Qga25vdyBob3cgdGhpc1xuICogd29ya3MuXG4gKi9cbmNsb25lLmNsb25lUHJvdG90eXBlID0gZnVuY3Rpb24ocGFyZW50KSB7XG4gIGlmIChwYXJlbnQgPT09IG51bGwpXG4gICAgcmV0dXJuIG51bGw7XG5cbiAgdmFyIGMgPSBmdW5jdGlvbiAoKSB7fTtcbiAgYy5wcm90b3R5cGUgPSBwYXJlbnQ7XG4gIHJldHVybiBuZXcgYygpO1xufTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyKSIsInZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgb2JqZWN0S2V5cyA9IHJlcXVpcmUoJy4vbGliL2tleXMuanMnKTtcbnZhciBpc0FyZ3VtZW50cyA9IHJlcXVpcmUoJy4vbGliL2lzX2FyZ3VtZW50cy5qcycpO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgb3B0cykge1xuICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9wdHMuc3RyaWN0ID8gYWN0dWFsID09PSBleHBlY3RlZCA6IGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCwgb3B0cyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyICh4KSB7XG4gIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHgubGVuZ3RoICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHguY29weSAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgeC5zbGljZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoeC5sZW5ndGggPiAwICYmIHR5cGVvZiB4WzBdICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYiwgb3B0cykge1xuICB2YXIgaSwga2V5O1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG9wdHMpO1xuICB9XG4gIGlmIChpc0J1ZmZlcihhKSkge1xuICAgIGlmICghaXNCdWZmZXIoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYVtpXSAhPT0gYltpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0cnkge1xuICAgIHZhciBrYSA9IG9iamVjdEtleXMoYSksXG4gICAgICAgIGtiID0gb2JqZWN0S2V5cyhiKTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBvcHRzKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuIiwidmFyIHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPSAoZnVuY3Rpb24oKXtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChhcmd1bWVudHMpXG59KSgpID09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzdXBwb3J0c0FyZ3VtZW50c0NsYXNzID8gc3VwcG9ydGVkIDogdW5zdXBwb3J0ZWQ7XG5cbmV4cG9ydHMuc3VwcG9ydGVkID0gc3VwcG9ydGVkO1xuZnVuY3Rpb24gc3VwcG9ydGVkKG9iamVjdCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG59O1xuXG5leHBvcnRzLnVuc3VwcG9ydGVkID0gdW5zdXBwb3J0ZWQ7XG5mdW5jdGlvbiB1bnN1cHBvcnRlZChvYmplY3Qpe1xuICByZXR1cm4gb2JqZWN0ICYmXG4gICAgdHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0JyAmJlxuICAgIHR5cGVvZiBvYmplY3QubGVuZ3RoID09ICdudW1iZXInICYmXG4gICAgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpICYmXG4gICAgIU9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmplY3QsICdjYWxsZWUnKSB8fFxuICAgIGZhbHNlO1xufTtcbiIsImV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHR5cGVvZiBPYmplY3Qua2V5cyA9PT0gJ2Z1bmN0aW9uJ1xuICA/IE9iamVjdC5rZXlzIDogc2hpbTtcblxuZXhwb3J0cy5zaGltID0gc2hpbTtcbmZ1bmN0aW9uIHNoaW0gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgcmV0dXJuIGtleXM7XG59XG4iLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgV2hhdENoYW5nZWQgPSByZXF1aXJlKCd3aGF0LWNoYW5nZWQnKSxcbiAgICBpcyA9IHJlcXVpcmUoJy4vaXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjcmVhdGVQcm9wZXJ0eShjdXJyZW50VmFsdWUpe1xuICAgIHZhciBiaW5kaW5nLFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgcHJldmlvdXMgPSBuZXcgV2hhdENoYW5nZWQoY3VycmVudFZhbHVlLCAndmFsdWUgdHlwZSByZWZlcmVuY2Uga2V5cycpO1xuXG4gICAgZnVuY3Rpb24gcHJvcGVydHkodmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZyAmJiBiaW5kaW5nKCkgfHwgY3VycmVudFZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIU9iamVjdC5rZXlzKHByZXZpb3VzLnVwZGF0ZSh2YWx1ZSkpLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgICAgIH1cblxuICAgICAgICBjdXJyZW50VmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgYmluZGluZyAmJiBiaW5kaW5nKHZhbHVlKTtcbiAgICAgICAgcHJvcGVydHkuZW1pdCgnY2hhbmdlJywgdmFsdWUpO1xuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcblxuICAgICAgICByZXR1cm4gcHJvcGVydHk7XG4gICAgfVxuXG4gICAgZm9yKHZhciBlbWl0dGVyS2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgICAgICBwcm9wZXJ0eVtlbWl0dGVyS2V5XSA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGVbZW1pdHRlcktleV07XG4gICAgfVxuXG4gICAgcHJvcGVydHkuYmluZGluZyA9IGZ1bmN0aW9uKG5ld0JpbmRpbmcpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG5ld0JpbmRpbmcgPT09IGJpbmRpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG4gICAgICAgIGlmKG1vZGVsKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmF0dGFjaChtb2RlbCwgIXByb3BlcnR5Ll9maXJtKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIHByb3BlcnR5Ll9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3BlcnR5Ll9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgbW9kZWwgPSBvYmplY3Q7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIHRydWUpO1xuICAgICAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICAgICAgcHJvcGVydHkoYmluZGluZygpKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgICAgICBiaW5kaW5nLmRldGFjaCh0cnVlKTtcbiAgICAgICAgICAgIG1vZGVsID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkudXBkYXRlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcHJvcGVydHkuZW1pdCgndXBkYXRlJywgY3VycmVudFZhbHVlKTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59OyIsInZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgV00gPSByZXF1aXJlKCcuL3dlYWttYXAnKTtcblxudmFyIGF0dGFjaGVkRW50aWVzID0gbmV3IFdNKCk7XG5cbmZ1bmN0aW9uIGVtaXQobW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIHZhciByZWZlcmVuY2VzID0gYXR0YWNoZWRFbnRpZXMuZ2V0KG1vZGVsKTtcblxuICAgIGlmKCFyZWZlcmVuY2VzIHx8ICFyZWZlcmVuY2VzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdG9FbWl0ID0gcmVmZXJlbmNlcy5zbGljZSgpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IHRvRW1pdC5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKH5yZWZlcmVuY2VzLmluZGV4T2YodG9FbWl0W2ldKSl7XG4gICAgICAgICAgICB0b0VtaXRbaV0uZW1pdChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gRW50aShtb2RlbCl7XG4gICAgaWYoIW1vZGVsIHx8ICh0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2RlbCAhPT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBtb2RlbCA9IHt9O1xuICAgIH1cbiAgICAgICAgXG4gICAgdGhpcy5hdHRhY2gobW9kZWwpO1xufVxuRW50aS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEV2ZW50RW1pdHRlci5wcm90b3R5cGUpO1xuRW50aS5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBFbnRpO1xudmFyIGF0dGFjaGVkID0gMDtcbkVudGkucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKG1vZGVsKXtcblxuICAgIC8vIGF0dGFjaGVkKys7IFxuICAgIC8vIGNvbnNvbGUubG9nKGF0dGFjaGVkKTtcbiAgICBcbiAgICB0aGlzLmRldGFjaCgpO1xuXG4gICAgdmFyIHJlZmVyZW5jZXMgPSBhdHRhY2hlZEVudGllcy5nZXQobW9kZWwpO1xuXG5cbiAgICBpZighcmVmZXJlbmNlcyl7XG4gICAgICAgIHJlZmVyZW5jZXMgPSBbXTtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuc2V0KG1vZGVsLCByZWZlcmVuY2VzKTtcbiAgICB9XG5cblxuICAgIHJlZmVyZW5jZXMucHVzaCh0aGlzKTtcblxuICAgIHRoaXMuX21vZGVsID0gbW9kZWw7XG59O1xuRW50aS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKXtcbiAgICBpZighdGhpcy5fbW9kZWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gYXR0YWNoZWQtLTtcbiAgICAvLyBjb25zb2xlLmxvZyhhdHRhY2hlZCk7XG5cbiAgICB2YXIgcmVmZXJlbmNlcyA9IGF0dGFjaGVkRW50aWVzLmdldCh0aGlzLl9tb2RlbCk7XG5cbiAgICBpZighcmVmZXJlbmNlcyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZWZlcmVuY2VzLnNwbGljZShyZWZlcmVuY2VzLmluZGV4T2YodGhpcyksMSk7XG5cbiAgICBpZighcmVmZXJlbmNlcy5sZW5ndGgpe1xuICAgICAgICBhdHRhY2hlZEVudGllcy5kZWxldGUodGhpcy5fbW9kZWwpO1xuICAgIH1cblxuICAgIHRoaXMuX21vZGVsID0ge307XG59O1xuRW50aS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICBpZihrZXkgPT09ICcuJyl7XG4gICAgICAgIHJldHVybiB0aGlzLl9tb2RlbDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX21vZGVsW2tleV07XG59O1xuXG5FbnRpLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YXIgb3JpZ2luYWwgPSB0aGlzLl9tb2RlbFtrZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXNDaGFuZ2VkID0gIShrZXkgaW4gdGhpcy5fbW9kZWwpO1xuXG4gICAgdGhpcy5fbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgZW1pdCh0aGlzLl9tb2RlbCwga2V5LCB2YWx1ZSk7XG5cbiAgICBpZihrZXlzQ2hhbmdlZCl7XG4gICAgICAgIGVtaXQodGhpcy5fbW9kZWwsICcqJywgdGhpcy5fbW9kZWwpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX21vZGVsKSl7XG4gICAgICAgICAgICBlbWl0KHRoaXMuX21vZGVsLCAnbGVuZ3RoJywgdGhpcy5fbW9kZWwubGVuZ3RoKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbkVudGkucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YXIgdGFyZ2V0O1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPCAyKXtcbiAgICAgICAgdmFsdWUgPSBrZXk7XG4gICAgICAgIGtleSA9ICcuJztcbiAgICAgICAgdGFyZ2V0ID0gdGhpcy5fbW9kZWw7XG4gICAgfWVsc2V7XG4gICAgICAgIHRhcmdldCA9IHRoaXMuX21vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcblxuICAgIGVtaXQodGFyZ2V0LCB0YXJnZXQubGVuZ3RoLTEsIHZhbHVlKTtcblxuICAgIGVtaXQodGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aCk7XG5cbiAgICBlbWl0KHRhcmdldCwgJyonLCB0YXJnZXQpO1xufTtcblxuRW50aS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oa2V5LCBzdWJLZXkpe1xuXG4gICAgLy8gUmVtb3ZlIGEga2V5IG9mZiBvZiBhbiBvYmplY3QgYXQgJ2tleSdcbiAgICBpZihzdWJLZXkgIT0gbnVsbCl7XG4gICAgICAgIG5ldyBFbnRpKHRoaXMuX21vZGVsW2tleV0pLnJlbW92ZShzdWJLZXkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICB0aHJvdyAnLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZSc7XG4gICAgfVxuXG4gICAgaWYoQXJyYXkuaXNBcnJheSh0aGlzLl9tb2RlbCkpe1xuICAgICAgICB0aGlzLl9tb2RlbC5zcGxpY2Uoa2V5LCAxKTtcbiAgICAgICAgZW1pdCh0aGlzLl9tb2RlbCwgJ2xlbmd0aCcsIHRoaXMuX21vZGVsLmxlbmd0aCk7XG4gICAgfWVsc2V7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9tb2RlbFtrZXldO1xuICAgIH1cblxuICAgIGVtaXQodGhpcy5fbW9kZWwsICcqJywgdGhpcy5fbW9kZWwpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBFbnRpO1xuIiwiZnVuY3Rpb24gdmFsaWRhdGVLZXkoa2V5KXtcbiAgICBpZigha2V5IHx8ICEodHlwZW9mIGtleSA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIGtleSA9PT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICB0aHJvdyBrZXkgKyBcIiBpcyBub3QgYSB2YWxpZCBXZWFrTWFwIGtleS5cIjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIExlYWtNYXAoKXtcbiAgICB0aGlzLmNsZWFyKCk7XG59XG5MZWFrTWFwLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCl7XG4gICAgdGhpcy5fa2V5cyA9IFtdO1xuICAgIHRoaXMuX3ZhbHVlcyA9IFtdO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFsaWRhdGVLZXkoa2V5KTtcbiAgICB2YXIga2V5SW5kZXggPSB0aGlzLl9rZXlzLmluZGV4T2Yoa2V5KTtcbiAgICBpZihrZXlJbmRleD49MCl7XG4gICAgICAgIHRoaXMuX2tleXMuc3BsaWNlKGtleUluZGV4LCAxKTtcbiAgICAgICAgdGhpcy5fdmFsdWVzLnNwbGljZShrZXlJbmRleCwgMSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xuICAgIHZhbGlkYXRlS2V5KGtleSk7XG4gICAgcmV0dXJuIHRoaXMuX3ZhbHVlc1t0aGlzLl9rZXlzLmluZGV4T2Yoa2V5KV07XG59O1xuTGVha01hcC5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuICAgIHJldHVybiAhIX50aGlzLl9rZXlzLmluZGV4T2Yoa2V5KTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuXG4gICAgLy8gRmF2b3JpdGUgcGllY2Ugb2Yga29lZCBldm9yLlxuICAgIC8vIElFIGRldnMgd291bGQgYmUgcHJvd2RlXG4gICAgdmFyIGtleUluZGV4ID0gKH50aGlzLl9rZXlzLmluZGV4T2Yoa2V5KSB8fCAodGhpcy5fa2V5cy5wdXNoKGtleSksIHRoaXMuX2tleXMubGVuZ3RoKSkgLSAxO1xuXG4gICAgdGhpcy5fdmFsdWVzW2tleUluZGV4XSA9IHZhbHVlO1xuICAgIHJldHVybiB0aGlzO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gJ1tvYmplY3QgV2Vha01hcF0nO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBMZWFrTWFwOyIsIi8vIENvcHlyaWdodCAoQykgMjAxMSBHb29nbGUgSW5jLlxuLy9cbi8vIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4vLyB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4vLyBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbi8vXG4vLyBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbi8vXG4vLyBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4vLyBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4vLyBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbi8vIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbi8vIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuXG4vKipcbiAqIEBmaWxlb3ZlcnZpZXcgSW5zdGFsbCBhIGxlYWt5IFdlYWtNYXAgZW11bGF0aW9uIG9uIHBsYXRmb3JtcyB0aGF0XG4gKiBkb24ndCBwcm92aWRlIGEgYnVpbHQtaW4gb25lLlxuICpcbiAqIDxwPkFzc3VtZXMgdGhhdCBhbiBFUzUgcGxhdGZvcm0gd2hlcmUsIGlmIHtAY29kZSBXZWFrTWFwfSBpc1xuICogYWxyZWFkeSBwcmVzZW50LCB0aGVuIGl0IGNvbmZvcm1zIHRvIHRoZSBhbnRpY2lwYXRlZCBFUzZcbiAqIHNwZWNpZmljYXRpb24uIFRvIHJ1biB0aGlzIGZpbGUgb24gYW4gRVM1IG9yIGFsbW9zdCBFUzVcbiAqIGltcGxlbWVudGF0aW9uIHdoZXJlIHRoZSB7QGNvZGUgV2Vha01hcH0gc3BlY2lmaWNhdGlvbiBkb2VzIG5vdFxuICogcXVpdGUgY29uZm9ybSwgcnVuIDxjb2RlPnJlcGFpckVTNS5qczwvY29kZT4gZmlyc3QuXG4gKlxuICogPHA+RXZlbiB0aG91Z2ggV2Vha01hcE1vZHVsZSBpcyBub3QgZ2xvYmFsLCB0aGUgbGludGVyIHRoaW5rcyBpdFxuICogaXMsIHdoaWNoIGlzIHdoeSBpdCBpcyBpbiB0aGUgb3ZlcnJpZGVzIGxpc3QgYmVsb3cuXG4gKlxuICogPHA+Tk9URTogQmVmb3JlIHVzaW5nIHRoaXMgV2Vha01hcCBlbXVsYXRpb24gaW4gYSBub24tU0VTXG4gKiBlbnZpcm9ubWVudCwgc2VlIHRoZSBub3RlIGJlbG93IGFib3V0IGhpZGRlblJlY29yZC5cbiAqXG4gKiBAYXV0aG9yIE1hcmsgUy4gTWlsbGVyXG4gKiBAcmVxdWlyZXMgY3J5cHRvLCBBcnJheUJ1ZmZlciwgVWludDhBcnJheSwgbmF2aWdhdG9yLCBjb25zb2xlXG4gKiBAb3ZlcnJpZGVzIFdlYWtNYXAsIHNlcywgUHJveHlcbiAqIEBvdmVycmlkZXMgV2Vha01hcE1vZHVsZVxuICovXG5cbi8qKlxuICogVGhpcyB7QGNvZGUgV2Vha01hcH0gZW11bGF0aW9uIGlzIG9ic2VydmFibHkgZXF1aXZhbGVudCB0byB0aGVcbiAqIEVTLUhhcm1vbnkgV2Vha01hcCwgYnV0IHdpdGggbGVha2llciBnYXJiYWdlIGNvbGxlY3Rpb24gcHJvcGVydGllcy5cbiAqXG4gKiA8cD5BcyB3aXRoIHRydWUgV2Vha01hcHMsIGluIHRoaXMgZW11bGF0aW9uLCBhIGtleSBkb2VzIG5vdFxuICogcmV0YWluIG1hcHMgaW5kZXhlZCBieSB0aGF0IGtleSBhbmQgKGNydWNpYWxseSkgYSBtYXAgZG9lcyBub3RcbiAqIHJldGFpbiB0aGUga2V5cyBpdCBpbmRleGVzLiBBIG1hcCBieSBpdHNlbGYgYWxzbyBkb2VzIG5vdCByZXRhaW5cbiAqIHRoZSB2YWx1ZXMgYXNzb2NpYXRlZCB3aXRoIHRoYXQgbWFwLlxuICpcbiAqIDxwPkhvd2V2ZXIsIHRoZSB2YWx1ZXMgYXNzb2NpYXRlZCB3aXRoIGEga2V5IGluIHNvbWUgbWFwIGFyZVxuICogcmV0YWluZWQgc28gbG9uZyBhcyB0aGF0IGtleSBpcyByZXRhaW5lZCBhbmQgdGhvc2UgYXNzb2NpYXRpb25zIGFyZVxuICogbm90IG92ZXJyaWRkZW4uIEZvciBleGFtcGxlLCB3aGVuIHVzZWQgdG8gc3VwcG9ydCBtZW1icmFuZXMsIGFsbFxuICogdmFsdWVzIGV4cG9ydGVkIGZyb20gYSBnaXZlbiBtZW1icmFuZSB3aWxsIGxpdmUgZm9yIHRoZSBsaWZldGltZVxuICogdGhleSB3b3VsZCBoYXZlIGhhZCBpbiB0aGUgYWJzZW5jZSBvZiBhbiBpbnRlcnBvc2VkIG1lbWJyYW5lLiBFdmVuXG4gKiB3aGVuIHRoZSBtZW1icmFuZSBpcyByZXZva2VkLCBhbGwgb2JqZWN0cyB0aGF0IHdvdWxkIGhhdmUgYmVlblxuICogcmVhY2hhYmxlIGluIHRoZSBhYnNlbmNlIG9mIHJldm9jYXRpb24gd2lsbCBzdGlsbCBiZSByZWFjaGFibGUsIGFzXG4gKiBmYXIgYXMgdGhlIEdDIGNhbiB0ZWxsLCBldmVuIHRob3VnaCB0aGV5IHdpbGwgbm8gbG9uZ2VyIGJlIHJlbGV2YW50XG4gKiB0byBvbmdvaW5nIGNvbXB1dGF0aW9uLlxuICpcbiAqIDxwPlRoZSBBUEkgaW1wbGVtZW50ZWQgaGVyZSBpcyBhcHByb3hpbWF0ZWx5IHRoZSBBUEkgYXMgaW1wbGVtZW50ZWRcbiAqIGluIEZGNi4wYTEgYW5kIGFncmVlZCB0byBieSBNYXJrTSwgQW5kcmVhcyBHYWwsIGFuZCBEYXZlIEhlcm1hbixcbiAqIHJhdGhlciB0aGFuIHRoZSBvZmZpYWxseSBhcHByb3ZlZCBwcm9wb3NhbCBwYWdlLiBUT0RPKGVyaWdodHMpOlxuICogdXBncmFkZSB0aGUgZWNtYXNjcmlwdCBXZWFrTWFwIHByb3Bvc2FsIHBhZ2UgdG8gZXhwbGFpbiB0aGlzIEFQSVxuICogY2hhbmdlIGFuZCBwcmVzZW50IHRvIEVjbWFTY3JpcHQgY29tbWl0dGVlIGZvciB0aGVpciBhcHByb3ZhbC5cbiAqXG4gKiA8cD5UaGUgZmlyc3QgZGlmZmVyZW5jZSBiZXR3ZWVuIHRoZSBlbXVsYXRpb24gaGVyZSBhbmQgdGhhdCBpblxuICogRkY2LjBhMSBpcyB0aGUgcHJlc2VuY2Ugb2Ygbm9uIGVudW1lcmFibGUge0Bjb2RlIGdldF9fXywgaGFzX19fLFxuICogc2V0X19fLCBhbmQgZGVsZXRlX19ffSBtZXRob2RzIG9uIFdlYWtNYXAgaW5zdGFuY2VzIHRvIHJlcHJlc2VudFxuICogd2hhdCB3b3VsZCBiZSB0aGUgaGlkZGVuIGludGVybmFsIHByb3BlcnRpZXMgb2YgYSBwcmltaXRpdmVcbiAqIGltcGxlbWVudGF0aW9uLiBXaGVyZWFzIHRoZSBGRjYuMGExIFdlYWtNYXAucHJvdG90eXBlIG1ldGhvZHNcbiAqIHJlcXVpcmUgdGhlaXIge0Bjb2RlIHRoaXN9IHRvIGJlIGEgZ2VudWluZSBXZWFrTWFwIGluc3RhbmNlIChpLmUuLFxuICogYW4gb2JqZWN0IG9mIHtAY29kZSBbW0NsYXNzXV19IFwiV2Vha01hcH0pLCBzaW5jZSB0aGVyZSBpcyBub3RoaW5nXG4gKiB1bmZvcmdlYWJsZSBhYm91dCB0aGUgcHNldWRvLWludGVybmFsIG1ldGhvZCBuYW1lcyB1c2VkIGhlcmUsXG4gKiBub3RoaW5nIHByZXZlbnRzIHRoZXNlIGVtdWxhdGVkIHByb3RvdHlwZSBtZXRob2RzIGZyb20gYmVpbmdcbiAqIGFwcGxpZWQgdG8gbm9uLVdlYWtNYXBzIHdpdGggcHNldWRvLWludGVybmFsIG1ldGhvZHMgb2YgdGhlIHNhbWVcbiAqIG5hbWVzLlxuICpcbiAqIDxwPkFub3RoZXIgZGlmZmVyZW5jZSBpcyB0aGF0IG91ciBlbXVsYXRlZCB7QGNvZGVcbiAqIFdlYWtNYXAucHJvdG90eXBlfSBpcyBub3QgaXRzZWxmIGEgV2Vha01hcC4gQSBwcm9ibGVtIHdpdGggdGhlXG4gKiBjdXJyZW50IEZGNi4wYTEgQVBJIGlzIHRoYXQgV2Vha01hcC5wcm90b3R5cGUgaXMgaXRzZWxmIGEgV2Vha01hcFxuICogcHJvdmlkaW5nIGFtYmllbnQgbXV0YWJpbGl0eSBhbmQgYW4gYW1iaWVudCBjb21tdW5pY2F0aW9uc1xuICogY2hhbm5lbC4gVGh1cywgaWYgYSBXZWFrTWFwIGlzIGFscmVhZHkgcHJlc2VudCBhbmQgaGFzIHRoaXNcbiAqIHByb2JsZW0sIHJlcGFpckVTNS5qcyB3cmFwcyBpdCBpbiBhIHNhZmUgd3JhcHBwZXIgaW4gb3JkZXIgdG9cbiAqIHByZXZlbnQgYWNjZXNzIHRvIHRoaXMgY2hhbm5lbC4gKFNlZVxuICogUEFUQ0hfTVVUQUJMRV9GUk9aRU5fV0VBS01BUF9QUk9UTyBpbiByZXBhaXJFUzUuanMpLlxuICovXG5cbi8qKlxuICogSWYgdGhpcyBpcyBhIGZ1bGwgPGEgaHJlZj1cbiAqIFwiaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL2VzLWxhYi93aWtpL1NlY3VyZWFibGVFUzVcIlxuICogPnNlY3VyZWFibGUgRVM1PC9hPiBwbGF0Zm9ybSBhbmQgdGhlIEVTLUhhcm1vbnkge0Bjb2RlIFdlYWtNYXB9IGlzXG4gKiBhYnNlbnQsIGluc3RhbGwgYW4gYXBwcm94aW1hdGUgZW11bGF0aW9uLlxuICpcbiAqIDxwPklmIFdlYWtNYXAgaXMgcHJlc2VudCBidXQgY2Fubm90IHN0b3JlIHNvbWUgb2JqZWN0cywgdXNlIG91ciBhcHByb3hpbWF0ZVxuICogZW11bGF0aW9uIGFzIGEgd3JhcHBlci5cbiAqXG4gKiA8cD5JZiB0aGlzIGlzIGFsbW9zdCBhIHNlY3VyZWFibGUgRVM1IHBsYXRmb3JtLCB0aGVuIFdlYWtNYXAuanNcbiAqIHNob3VsZCBiZSBydW4gYWZ0ZXIgcmVwYWlyRVM1LmpzLlxuICpcbiAqIDxwPlNlZSB7QGNvZGUgV2Vha01hcH0gZm9yIGRvY3VtZW50YXRpb24gb2YgdGhlIGdhcmJhZ2UgY29sbGVjdGlvblxuICogcHJvcGVydGllcyBvZiB0aGlzIFdlYWtNYXAgZW11bGF0aW9uLlxuICovXG4oZnVuY3Rpb24gV2Vha01hcE1vZHVsZSgpIHtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgaWYgKHR5cGVvZiBzZXMgIT09ICd1bmRlZmluZWQnICYmIHNlcy5vayAmJiAhc2VzLm9rKCkpIHtcbiAgICAvLyBhbHJlYWR5IHRvbyBicm9rZW4sIHNvIGdpdmUgdXBcbiAgICByZXR1cm47XG4gIH1cblxuICAvKipcbiAgICogSW4gc29tZSBjYXNlcyAoY3VycmVudCBGaXJlZm94KSwgd2UgbXVzdCBtYWtlIGEgY2hvaWNlIGJldHdlZWVuIGFcbiAgICogV2Vha01hcCB3aGljaCBpcyBjYXBhYmxlIG9mIHVzaW5nIGFsbCB2YXJpZXRpZXMgb2YgaG9zdCBvYmplY3RzIGFzXG4gICAqIGtleXMgYW5kIG9uZSB3aGljaCBpcyBjYXBhYmxlIG9mIHNhZmVseSB1c2luZyBwcm94aWVzIGFzIGtleXMuIFNlZVxuICAgKiBjb21tZW50cyBiZWxvdyBhYm91dCBIb3N0V2Vha01hcCBhbmQgRG91YmxlV2Vha01hcCBmb3IgZGV0YWlscy5cbiAgICpcbiAgICogVGhpcyBmdW5jdGlvbiAod2hpY2ggaXMgYSBnbG9iYWwsIG5vdCBleHBvc2VkIHRvIGd1ZXN0cykgbWFya3MgYVxuICAgKiBXZWFrTWFwIGFzIHBlcm1pdHRlZCB0byBkbyB3aGF0IGlzIG5lY2Vzc2FyeSB0byBpbmRleCBhbGwgaG9zdFxuICAgKiBvYmplY3RzLCBhdCB0aGUgY29zdCBvZiBtYWtpbmcgaXQgdW5zYWZlIGZvciBwcm94aWVzLlxuICAgKlxuICAgKiBEbyBub3QgYXBwbHkgdGhpcyBmdW5jdGlvbiB0byBhbnl0aGluZyB3aGljaCBpcyBub3QgYSBnZW51aW5lXG4gICAqIGZyZXNoIFdlYWtNYXAuXG4gICAqL1xuICBmdW5jdGlvbiB3ZWFrTWFwUGVybWl0SG9zdE9iamVjdHMobWFwKSB7XG4gICAgLy8gaWRlbnRpdHkgb2YgZnVuY3Rpb24gdXNlZCBhcyBhIHNlY3JldCAtLSBnb29kIGVub3VnaCBhbmQgY2hlYXBcbiAgICBpZiAobWFwLnBlcm1pdEhvc3RPYmplY3RzX19fKSB7XG4gICAgICBtYXAucGVybWl0SG9zdE9iamVjdHNfX18od2Vha01hcFBlcm1pdEhvc3RPYmplY3RzKTtcbiAgICB9XG4gIH1cbiAgaWYgKHR5cGVvZiBzZXMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgc2VzLndlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cyA9IHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cztcbiAgfVxuXG4gIC8vIElFIDExIGhhcyBubyBQcm94eSBidXQgaGFzIGEgYnJva2VuIFdlYWtNYXAgc3VjaCB0aGF0IHdlIG5lZWQgdG8gcGF0Y2hcbiAgLy8gaXQgdXNpbmcgRG91YmxlV2Vha01hcDsgdGhpcyBmbGFnIHRlbGxzIERvdWJsZVdlYWtNYXAgc28uXG4gIHZhciBkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlID0gZmFsc2U7XG5cbiAgLy8gQ2hlY2sgaWYgdGhlcmUgaXMgYWxyZWFkeSBhIGdvb2QtZW5vdWdoIFdlYWtNYXAgaW1wbGVtZW50YXRpb24sIGFuZCBpZiBzb1xuICAvLyBleGl0IHdpdGhvdXQgcmVwbGFjaW5nIGl0LlxuICBpZiAodHlwZW9mIFdlYWtNYXAgPT09ICdmdW5jdGlvbicpIHtcbiAgICB2YXIgSG9zdFdlYWtNYXAgPSBXZWFrTWFwO1xuICAgIC8vIFRoZXJlIGlzIGEgV2Vha01hcCAtLSBpcyBpdCBnb29kIGVub3VnaD9cbiAgICBpZiAodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgL0ZpcmVmb3gvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkpIHtcbiAgICAgIC8vIFdlJ3JlIG5vdyAqYXNzdW1pbmcgbm90KiwgYmVjYXVzZSBhcyBvZiB0aGlzIHdyaXRpbmcgKDIwMTMtMDUtMDYpXG4gICAgICAvLyBGaXJlZm94J3MgV2Vha01hcHMgaGF2ZSBhIG1pc2NlbGxhbnkgb2Ygb2JqZWN0cyB0aGV5IHdvbid0IGFjY2VwdCwgYW5kXG4gICAgICAvLyB3ZSBkb24ndCB3YW50IHRvIG1ha2UgYW4gZXhoYXVzdGl2ZSBsaXN0LCBhbmQgdGVzdGluZyBmb3IganVzdCBvbmVcbiAgICAgIC8vIHdpbGwgYmUgYSBwcm9ibGVtIGlmIHRoYXQgb25lIGlzIGZpeGVkIGFsb25lIChhcyB0aGV5IGRpZCBmb3IgRXZlbnQpLlxuXG4gICAgICAvLyBJZiB0aGVyZSBpcyBhIHBsYXRmb3JtIHRoYXQgd2UgKmNhbiogcmVsaWFibHkgdGVzdCBvbiwgaGVyZSdzIGhvdyB0b1xuICAgICAgLy8gZG8gaXQ6XG4gICAgICAvLyAgdmFyIHByb2JsZW1hdGljID0gLi4uIDtcbiAgICAgIC8vICB2YXIgdGVzdEhvc3RNYXAgPSBuZXcgSG9zdFdlYWtNYXAoKTtcbiAgICAgIC8vICB0cnkge1xuICAgICAgLy8gICAgdGVzdEhvc3RNYXAuc2V0KHByb2JsZW1hdGljLCAxKTsgIC8vIEZpcmVmb3ggMjAgd2lsbCB0aHJvdyBoZXJlXG4gICAgICAvLyAgICBpZiAodGVzdEhvc3RNYXAuZ2V0KHByb2JsZW1hdGljKSA9PT0gMSkge1xuICAgICAgLy8gICAgICByZXR1cm47XG4gICAgICAvLyAgICB9XG4gICAgICAvLyAgfSBjYXRjaCAoZSkge31cblxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJRSAxMSBidWc6IFdlYWtNYXBzIHNpbGVudGx5IGZhaWwgdG8gc3RvcmUgZnJvemVuIG9iamVjdHMuXG4gICAgICB2YXIgdGVzdE1hcCA9IG5ldyBIb3N0V2Vha01hcCgpO1xuICAgICAgdmFyIHRlc3RPYmplY3QgPSBPYmplY3QuZnJlZXplKHt9KTtcbiAgICAgIHRlc3RNYXAuc2V0KHRlc3RPYmplY3QsIDEpO1xuICAgICAgaWYgKHRlc3RNYXAuZ2V0KHRlc3RPYmplY3QpICE9PSAxKSB7XG4gICAgICAgIGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgPSB0cnVlO1xuICAgICAgICAvLyBGYWxsIHRocm91Z2ggdG8gaW5zdGFsbGluZyBvdXIgV2Vha01hcC5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gV2Vha01hcDtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHZhciBob3AgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuICB2YXIgZ29wbiA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzO1xuICB2YXIgZGVmUHJvcCA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eTtcbiAgdmFyIGlzRXh0ZW5zaWJsZSA9IE9iamVjdC5pc0V4dGVuc2libGU7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGRlcGVuZHMgb24gSElEREVOX05BTUUgYmVpbmcgYm90aCA8aT51bmd1ZXNzYWJsZTwvaT4gYW5kXG4gICAqIDxpPnVuZGlzY292ZXJhYmxlPC9pPiBieSB1bnRydXN0ZWQgY29kZS5cbiAgICpcbiAgICogPHA+R2l2ZW4gdGhlIGtub3duIHdlYWtuZXNzZXMgb2YgTWF0aC5yYW5kb20oKSBvbiBleGlzdGluZ1xuICAgKiBicm93c2VycywgaXQgZG9lcyBub3QgZ2VuZXJhdGUgdW5ndWVzc2FiaWxpdHkgd2UgY2FuIGJlIGNvbmZpZGVudFxuICAgKiBvZi5cbiAgICpcbiAgICogPHA+SXQgaXMgdGhlIG1vbmtleSBwYXRjaGluZyBsb2dpYyBpbiB0aGlzIGZpbGUgdGhhdCBpcyBpbnRlbmRlZFxuICAgKiB0byBlbnN1cmUgdW5kaXNjb3ZlcmFiaWxpdHkuIFRoZSBiYXNpYyBpZGVhIGlzIHRoYXQgdGhlcmUgYXJlXG4gICAqIHRocmVlIGZ1bmRhbWVudGFsIG1lYW5zIG9mIGRpc2NvdmVyaW5nIHByb3BlcnRpZXMgb2YgYW4gb2JqZWN0OlxuICAgKiBUaGUgZm9yL2luIGxvb3AsIE9iamVjdC5rZXlzKCksIGFuZCBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcygpLFxuICAgKiBhcyB3ZWxsIGFzIHNvbWUgcHJvcG9zZWQgRVM2IGV4dGVuc2lvbnMgdGhhdCBhcHBlYXIgb24gb3VyXG4gICAqIHdoaXRlbGlzdC4gVGhlIGZpcnN0IHR3byBvbmx5IGRpc2NvdmVyIGVudW1lcmFibGUgcHJvcGVydGllcywgYW5kXG4gICAqIHdlIG9ubHkgdXNlIEhJRERFTl9OQU1FIHRvIG5hbWUgYSBub24tZW51bWVyYWJsZSBwcm9wZXJ0eSwgc28gdGhlXG4gICAqIG9ubHkgcmVtYWluaW5nIHRocmVhdCBzaG91bGQgYmUgZ2V0T3duUHJvcGVydHlOYW1lcyBhbmQgc29tZVxuICAgKiBwcm9wb3NlZCBFUzYgZXh0ZW5zaW9ucyB0aGF0IGFwcGVhciBvbiBvdXIgd2hpdGVsaXN0LiBXZSBtb25rZXlcbiAgICogcGF0Y2ggdGhlbSB0byByZW1vdmUgSElEREVOX05BTUUgZnJvbSB0aGUgbGlzdCBvZiBwcm9wZXJ0aWVzIHRoZXlcbiAgICogcmV0dXJucy5cbiAgICpcbiAgICogPHA+VE9ETyhlcmlnaHRzKTogT24gYSBwbGF0Zm9ybSB3aXRoIGJ1aWx0LWluIFByb3hpZXMsIHByb3hpZXNcbiAgICogY291bGQgYmUgdXNlZCB0byB0cmFwIGFuZCB0aGVyZWJ5IGRpc2NvdmVyIHRoZSBISURERU5fTkFNRSwgc28gd2VcbiAgICogbmVlZCB0byBtb25rZXkgcGF0Y2ggUHJveHkuY3JlYXRlLCBQcm94eS5jcmVhdGVGdW5jdGlvbiwgZXRjLCBpblxuICAgKiBvcmRlciB0byB3cmFwIHRoZSBwcm92aWRlZCBoYW5kbGVyIHdpdGggdGhlIHJlYWwgaGFuZGxlciB3aGljaFxuICAgKiBmaWx0ZXJzIG91dCBhbGwgdHJhcHMgdXNpbmcgSElEREVOX05BTUUuXG4gICAqXG4gICAqIDxwPlRPRE8oZXJpZ2h0cyk6IFJldmlzaXQgTWlrZSBTdGF5J3Mgc3VnZ2VzdGlvbiB0aGF0IHdlIHVzZSBhblxuICAgKiBlbmNhcHN1bGF0ZWQgZnVuY3Rpb24gYXQgYSBub3QtbmVjZXNzYXJpbHktc2VjcmV0IG5hbWUsIHdoaWNoXG4gICAqIHVzZXMgdGhlIFN0aWVnbGVyIHNoYXJlZC1zdGF0ZSByaWdodHMgYW1wbGlmaWNhdGlvbiBwYXR0ZXJuIHRvXG4gICAqIHJldmVhbCB0aGUgYXNzb2NpYXRlZCB2YWx1ZSBvbmx5IHRvIHRoZSBXZWFrTWFwIGluIHdoaWNoIHRoaXMga2V5XG4gICAqIGlzIGFzc29jaWF0ZWQgd2l0aCB0aGF0IHZhbHVlLiBTaW5jZSBvbmx5IHRoZSBrZXkgcmV0YWlucyB0aGVcbiAgICogZnVuY3Rpb24sIHRoZSBmdW5jdGlvbiBjYW4gYWxzbyByZW1lbWJlciB0aGUga2V5IHdpdGhvdXQgY2F1c2luZ1xuICAgKiBsZWFrYWdlIG9mIHRoZSBrZXksIHNvIHRoaXMgZG9lc24ndCB2aW9sYXRlIG91ciBnZW5lcmFsIGdjXG4gICAqIGdvYWxzLiBJbiBhZGRpdGlvbiwgYmVjYXVzZSB0aGUgbmFtZSBuZWVkIG5vdCBiZSBhIGd1YXJkZWRcbiAgICogc2VjcmV0LCB3ZSBjb3VsZCBlZmZpY2llbnRseSBoYW5kbGUgY3Jvc3MtZnJhbWUgZnJvemVuIGtleXMuXG4gICAqL1xuICB2YXIgSElEREVOX05BTUVfUFJFRklYID0gJ3dlYWttYXA6JztcbiAgdmFyIEhJRERFTl9OQU1FID0gSElEREVOX05BTUVfUFJFRklYICsgJ2lkZW50OicgKyBNYXRoLnJhbmRvbSgpICsgJ19fXyc7XG5cbiAgaWYgKHR5cGVvZiBjcnlwdG8gIT09ICd1bmRlZmluZWQnICYmXG4gICAgICB0eXBlb2YgY3J5cHRvLmdldFJhbmRvbVZhbHVlcyA9PT0gJ2Z1bmN0aW9uJyAmJlxuICAgICAgdHlwZW9mIEFycmF5QnVmZmVyID09PSAnZnVuY3Rpb24nICYmXG4gICAgICB0eXBlb2YgVWludDhBcnJheSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHZhciBhYiA9IG5ldyBBcnJheUJ1ZmZlcigyNSk7XG4gICAgdmFyIHU4cyA9IG5ldyBVaW50OEFycmF5KGFiKTtcbiAgICBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKHU4cyk7XG4gICAgSElEREVOX05BTUUgPSBISURERU5fTkFNRV9QUkVGSVggKyAncmFuZDonICtcbiAgICAgIEFycmF5LnByb3RvdHlwZS5tYXAuY2FsbCh1OHMsIGZ1bmN0aW9uKHU4KSB7XG4gICAgICAgIHJldHVybiAodTggJSAzNikudG9TdHJpbmcoMzYpO1xuICAgICAgfSkuam9pbignJykgKyAnX19fJztcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzTm90SGlkZGVuTmFtZShuYW1lKSB7XG4gICAgcmV0dXJuICEoXG4gICAgICAgIG5hbWUuc3Vic3RyKDAsIEhJRERFTl9OQU1FX1BSRUZJWC5sZW5ndGgpID09IEhJRERFTl9OQU1FX1BSRUZJWCAmJlxuICAgICAgICBuYW1lLnN1YnN0cihuYW1lLmxlbmd0aCAtIDMpID09PSAnX19fJyk7XG4gIH1cblxuICAvKipcbiAgICogTW9ua2V5IHBhdGNoIGdldE93blByb3BlcnR5TmFtZXMgdG8gYXZvaWQgcmV2ZWFsaW5nIHRoZVxuICAgKiBISURERU5fTkFNRS5cbiAgICpcbiAgICogPHA+VGhlIEVTNS4xIHNwZWMgcmVxdWlyZXMgZWFjaCBuYW1lIHRvIGFwcGVhciBvbmx5IG9uY2UsIGJ1dCBhc1xuICAgKiBvZiB0aGlzIHdyaXRpbmcsIHRoaXMgcmVxdWlyZW1lbnQgaXMgY29udHJvdmVyc2lhbCBmb3IgRVM2LCBzbyB3ZVxuICAgKiBtYWRlIHRoaXMgY29kZSByb2J1c3QgYWdhaW5zdCB0aGlzIGNhc2UuIElmIHRoZSByZXN1bHRpbmcgZXh0cmFcbiAgICogc2VhcmNoIHR1cm5zIG91dCB0byBiZSBleHBlbnNpdmUsIHdlIGNhbiBwcm9iYWJseSByZWxheCB0aGlzIG9uY2VcbiAgICogRVM2IGlzIGFkZXF1YXRlbHkgc3VwcG9ydGVkIG9uIGFsbCBtYWpvciBicm93c2VycywgaWZmIG5vIGJyb3dzZXJcbiAgICogdmVyc2lvbnMgd2Ugc3VwcG9ydCBhdCB0aGF0IHRpbWUgaGF2ZSByZWxheGVkIHRoaXMgY29uc3RyYWludFxuICAgKiB3aXRob3V0IHByb3ZpZGluZyBidWlsdC1pbiBFUzYgV2Vha01hcHMuXG4gICAqL1xuICBkZWZQcm9wKE9iamVjdCwgJ2dldE93blByb3BlcnR5TmFtZXMnLCB7XG4gICAgdmFsdWU6IGZ1bmN0aW9uIGZha2VHZXRPd25Qcm9wZXJ0eU5hbWVzKG9iaikge1xuICAgICAgcmV0dXJuIGdvcG4ob2JqKS5maWx0ZXIoaXNOb3RIaWRkZW5OYW1lKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBnZXRQcm9wZXJ0eU5hbWVzIGlzIG5vdCBpbiBFUzUgYnV0IGl0IGlzIHByb3Bvc2VkIGZvciBFUzYgYW5kXG4gICAqIGRvZXMgYXBwZWFyIGluIG91ciB3aGl0ZWxpc3QsIHNvIHdlIG5lZWQgdG8gY2xlYW4gaXQgdG9vLlxuICAgKi9cbiAgaWYgKCdnZXRQcm9wZXJ0eU5hbWVzJyBpbiBPYmplY3QpIHtcbiAgICB2YXIgb3JpZ2luYWxHZXRQcm9wZXJ0eU5hbWVzID0gT2JqZWN0LmdldFByb3BlcnR5TmFtZXM7XG4gICAgZGVmUHJvcChPYmplY3QsICdnZXRQcm9wZXJ0eU5hbWVzJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGZha2VHZXRQcm9wZXJ0eU5hbWVzKG9iaikge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxHZXRQcm9wZXJ0eU5hbWVzKG9iaikuZmlsdGVyKGlzTm90SGlkZGVuTmFtZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogPHA+VG8gdHJlYXQgb2JqZWN0cyBhcyBpZGVudGl0eS1rZXlzIHdpdGggcmVhc29uYWJsZSBlZmZpY2llbmN5XG4gICAqIG9uIEVTNSBieSBpdHNlbGYgKGkuZS4sIHdpdGhvdXQgYW55IG9iamVjdC1rZXllZCBjb2xsZWN0aW9ucyksIHdlXG4gICAqIG5lZWQgdG8gYWRkIGEgaGlkZGVuIHByb3BlcnR5IHRvIHN1Y2gga2V5IG9iamVjdHMgd2hlbiB3ZVxuICAgKiBjYW4uIFRoaXMgcmFpc2VzIHNldmVyYWwgaXNzdWVzOlxuICAgKiA8dWw+XG4gICAqIDxsaT5BcnJhbmdpbmcgdG8gYWRkIHRoaXMgcHJvcGVydHkgdG8gb2JqZWN0cyBiZWZvcmUgd2UgbG9zZSB0aGVcbiAgICogICAgIGNoYW5jZSwgYW5kXG4gICAqIDxsaT5IaWRpbmcgdGhlIGV4aXN0ZW5jZSBvZiB0aGlzIG5ldyBwcm9wZXJ0eSBmcm9tIG1vc3RcbiAgICogICAgIEphdmFTY3JpcHQgY29kZS5cbiAgICogPGxpPlByZXZlbnRpbmcgPGk+Y2VydGlmaWNhdGlvbiB0aGVmdDwvaT4sIHdoZXJlIG9uZSBvYmplY3QgaXNcbiAgICogICAgIGNyZWF0ZWQgZmFsc2VseSBjbGFpbWluZyB0byBiZSB0aGUga2V5IG9mIGFuIGFzc29jaWF0aW9uXG4gICAqICAgICBhY3R1YWxseSBrZXllZCBieSBhbm90aGVyIG9iamVjdC5cbiAgICogPGxpPlByZXZlbnRpbmcgPGk+dmFsdWUgdGhlZnQ8L2k+LCB3aGVyZSB1bnRydXN0ZWQgY29kZSB3aXRoXG4gICAqICAgICBhY2Nlc3MgdG8gYSBrZXkgb2JqZWN0IGJ1dCBub3QgYSB3ZWFrIG1hcCBuZXZlcnRoZWxlc3NcbiAgICogICAgIG9idGFpbnMgYWNjZXNzIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhhdCBrZXkgaW4gdGhhdFxuICAgKiAgICAgd2VhayBtYXAuXG4gICAqIDwvdWw+XG4gICAqIFdlIGRvIHNvIGJ5XG4gICAqIDx1bD5cbiAgICogPGxpPk1ha2luZyB0aGUgbmFtZSBvZiB0aGUgaGlkZGVuIHByb3BlcnR5IHVuZ3Vlc3NhYmxlLCBzbyBcIltdXCJcbiAgICogICAgIGluZGV4aW5nLCB3aGljaCB3ZSBjYW5ub3QgaW50ZXJjZXB0LCBjYW5ub3QgYmUgdXNlZCB0byBhY2Nlc3NcbiAgICogICAgIGEgcHJvcGVydHkgd2l0aG91dCBrbm93aW5nIHRoZSBuYW1lLlxuICAgKiA8bGk+TWFraW5nIHRoZSBoaWRkZW4gcHJvcGVydHkgbm9uLWVudW1lcmFibGUsIHNvIHdlIG5lZWQgbm90XG4gICAqICAgICB3b3JyeSBhYm91dCBmb3ItaW4gbG9vcHMgb3Ige0Bjb2RlIE9iamVjdC5rZXlzfSxcbiAgICogPGxpPm1vbmtleSBwYXRjaGluZyB0aG9zZSByZWZsZWN0aXZlIG1ldGhvZHMgdGhhdCB3b3VsZFxuICAgKiAgICAgcHJldmVudCBleHRlbnNpb25zLCB0byBhZGQgdGhpcyBoaWRkZW4gcHJvcGVydHkgZmlyc3QsXG4gICAqIDxsaT5tb25rZXkgcGF0Y2hpbmcgdGhvc2UgbWV0aG9kcyB0aGF0IHdvdWxkIHJldmVhbCB0aGlzXG4gICAqICAgICBoaWRkZW4gcHJvcGVydHkuXG4gICAqIDwvdWw+XG4gICAqIFVuZm9ydHVuYXRlbHksIGJlY2F1c2Ugb2Ygc2FtZS1vcmlnaW4gaWZyYW1lcywgd2UgY2Fubm90IHJlbGlhYmx5XG4gICAqIGFkZCB0aGlzIGhpZGRlbiBwcm9wZXJ0eSBiZWZvcmUgYW4gb2JqZWN0IGJlY29tZXNcbiAgICogbm9uLWV4dGVuc2libGUuIEluc3RlYWQsIGlmIHdlIGVuY291bnRlciBhIG5vbi1leHRlbnNpYmxlIG9iamVjdFxuICAgKiB3aXRob3V0IGEgaGlkZGVuIHJlY29yZCB0aGF0IHdlIGNhbiBkZXRlY3QgKHdoZXRoZXIgb3Igbm90IGl0IGhhc1xuICAgKiBhIGhpZGRlbiByZWNvcmQgc3RvcmVkIHVuZGVyIGEgbmFtZSBzZWNyZXQgdG8gdXMpLCB0aGVuIHdlIGp1c3RcbiAgICogdXNlIHRoZSBrZXkgb2JqZWN0IGl0c2VsZiB0byByZXByZXNlbnQgaXRzIGlkZW50aXR5IGluIGEgYnJ1dGVcbiAgICogZm9yY2UgbGVha3kgbWFwIHN0b3JlZCBpbiB0aGUgd2VhayBtYXAsIGxvc2luZyBhbGwgdGhlIGFkdmFudGFnZXNcbiAgICogb2Ygd2Vha25lc3MgZm9yIHRoZXNlLlxuICAgKi9cbiAgZnVuY3Rpb24gZ2V0SGlkZGVuUmVjb3JkKGtleSkge1xuICAgIGlmIChrZXkgIT09IE9iamVjdChrZXkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdOb3QgYW4gb2JqZWN0OiAnICsga2V5KTtcbiAgICB9XG4gICAgdmFyIGhpZGRlblJlY29yZCA9IGtleVtISURERU5fTkFNRV07XG4gICAgaWYgKGhpZGRlblJlY29yZCAmJiBoaWRkZW5SZWNvcmQua2V5ID09PSBrZXkpIHsgcmV0dXJuIGhpZGRlblJlY29yZDsgfVxuICAgIGlmICghaXNFeHRlbnNpYmxlKGtleSkpIHtcbiAgICAgIC8vIFdlYWsgbWFwIG11c3QgYnJ1dGUgZm9yY2UsIGFzIGV4cGxhaW5lZCBpbiBkb2MtY29tbWVudCBhYm92ZS5cbiAgICAgIHJldHVybiB2b2lkIDA7XG4gICAgfVxuXG4gICAgLy8gVGhlIGhpZGRlblJlY29yZCBhbmQgdGhlIGtleSBwb2ludCBkaXJlY3RseSBhdCBlYWNoIG90aGVyLCB2aWFcbiAgICAvLyB0aGUgXCJrZXlcIiBhbmQgSElEREVOX05BTUUgcHJvcGVydGllcyByZXNwZWN0aXZlbHkuIFRoZSBrZXlcbiAgICAvLyBmaWVsZCBpcyBmb3IgcXVpY2tseSB2ZXJpZnlpbmcgdGhhdCB0aGlzIGhpZGRlbiByZWNvcmQgaXMgYW5cbiAgICAvLyBvd24gcHJvcGVydHksIG5vdCBhIGhpZGRlbiByZWNvcmQgZnJvbSB1cCB0aGUgcHJvdG90eXBlIGNoYWluLlxuICAgIC8vXG4gICAgLy8gTk9URTogQmVjYXVzZSB0aGlzIFdlYWtNYXAgZW11bGF0aW9uIGlzIG1lYW50IG9ubHkgZm9yIHN5c3RlbXMgbGlrZVxuICAgIC8vIFNFUyB3aGVyZSBPYmplY3QucHJvdG90eXBlIGlzIGZyb3plbiB3aXRob3V0IGFueSBudW1lcmljXG4gICAgLy8gcHJvcGVydGllcywgaXQgaXMgb2sgdG8gdXNlIGFuIG9iamVjdCBsaXRlcmFsIGZvciB0aGUgaGlkZGVuUmVjb3JkLlxuICAgIC8vIFRoaXMgaGFzIHR3byBhZHZhbnRhZ2VzOlxuICAgIC8vICogSXQgaXMgbXVjaCBmYXN0ZXIgaW4gYSBwZXJmb3JtYW5jZSBjcml0aWNhbCBwbGFjZVxuICAgIC8vICogSXQgYXZvaWRzIHJlbHlpbmcgb24gT2JqZWN0LmNyZWF0ZShudWxsKSwgd2hpY2ggaGFkIGJlZW5cbiAgICAvLyAgIHByb2JsZW1hdGljIG9uIENocm9tZSAyOC4wLjE0ODAuMC4gU2VlXG4gICAgLy8gICBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2dvb2dsZS1jYWphL2lzc3Vlcy9kZXRhaWw/aWQ9MTY4N1xuICAgIGhpZGRlblJlY29yZCA9IHsga2V5OiBrZXkgfTtcblxuICAgIC8vIFdoZW4gdXNpbmcgdGhpcyBXZWFrTWFwIGVtdWxhdGlvbiBvbiBwbGF0Zm9ybXMgd2hlcmVcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIG1pZ2h0IG5vdCBiZSBmcm96ZW4gYW5kIE9iamVjdC5jcmVhdGUobnVsbCkgaXNcbiAgICAvLyByZWxpYWJsZSwgdXNlIHRoZSBmb2xsb3dpbmcgdHdvIGNvbW1lbnRlZCBvdXQgbGluZXMgaW5zdGVhZC5cbiAgICAvLyBoaWRkZW5SZWNvcmQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIC8vIGhpZGRlblJlY29yZC5rZXkgPSBrZXk7XG5cbiAgICAvLyBQbGVhc2UgY29udGFjdCB1cyBpZiB5b3UgbmVlZCB0aGlzIHRvIHdvcmsgb24gcGxhdGZvcm1zIHdoZXJlXG4gICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtaWdodCBub3QgYmUgZnJvemVuIGFuZFxuICAgIC8vIE9iamVjdC5jcmVhdGUobnVsbCkgbWlnaHQgbm90IGJlIHJlbGlhYmxlLlxuXG4gICAgdHJ5IHtcbiAgICAgIGRlZlByb3Aoa2V5LCBISURERU5fTkFNRSwge1xuICAgICAgICB2YWx1ZTogaGlkZGVuUmVjb3JkLFxuICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICB9KTtcbiAgICAgIHJldHVybiBoaWRkZW5SZWNvcmQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFVuZGVyIHNvbWUgY2lyY3Vtc3RhbmNlcywgaXNFeHRlbnNpYmxlIHNlZW1zIHRvIG1pc3JlcG9ydCB3aGV0aGVyXG4gICAgICAvLyB0aGUgSElEREVOX05BTUUgY2FuIGJlIGRlZmluZWQuXG4gICAgICAvLyBUaGUgY2lyY3Vtc3RhbmNlcyBoYXZlIG5vdCBiZWVuIGlzb2xhdGVkLCBidXQgYXQgbGVhc3QgYWZmZWN0XG4gICAgICAvLyBOb2RlLmpzIHYwLjEwLjI2IG9uIFRyYXZpc0NJIC8gTGludXgsIGJ1dCBub3QgdGhlIHNhbWUgdmVyc2lvbiBvZlxuICAgICAgLy8gTm9kZS5qcyBvbiBPUyBYLlxuICAgICAgcmV0dXJuIHZvaWQgMDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTW9ua2V5IHBhdGNoIG9wZXJhdGlvbnMgdGhhdCB3b3VsZCBtYWtlIHRoZWlyIGFyZ3VtZW50XG4gICAqIG5vbi1leHRlbnNpYmxlLlxuICAgKlxuICAgKiA8cD5UaGUgbW9ua2V5IHBhdGNoZWQgdmVyc2lvbnMgdGhyb3cgYSBUeXBlRXJyb3IgaWYgdGhlaXJcbiAgICogYXJndW1lbnQgaXMgbm90IGFuIG9iamVjdCwgc28gaXQgc2hvdWxkIG9ubHkgYmUgZG9uZSB0byBmdW5jdGlvbnNcbiAgICogdGhhdCBzaG91bGQgdGhyb3cgYSBUeXBlRXJyb3IgYW55d2F5IGlmIHRoZWlyIGFyZ3VtZW50IGlzIG5vdCBhblxuICAgKiBvYmplY3QuXG4gICAqL1xuICAoZnVuY3Rpb24oKXtcbiAgICB2YXIgb2xkRnJlZXplID0gT2JqZWN0LmZyZWV6ZTtcbiAgICBkZWZQcm9wKE9iamVjdCwgJ2ZyZWV6ZScsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBpZGVudGlmeWluZ0ZyZWV6ZShvYmopIHtcbiAgICAgICAgZ2V0SGlkZGVuUmVjb3JkKG9iaik7XG4gICAgICAgIHJldHVybiBvbGRGcmVlemUob2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB2YXIgb2xkU2VhbCA9IE9iamVjdC5zZWFsO1xuICAgIGRlZlByb3AoT2JqZWN0LCAnc2VhbCcsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBpZGVudGlmeWluZ1NlYWwob2JqKSB7XG4gICAgICAgIGdldEhpZGRlblJlY29yZChvYmopO1xuICAgICAgICByZXR1cm4gb2xkU2VhbChvYmopO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHZhciBvbGRQcmV2ZW50RXh0ZW5zaW9ucyA9IE9iamVjdC5wcmV2ZW50RXh0ZW5zaW9ucztcbiAgICBkZWZQcm9wKE9iamVjdCwgJ3ByZXZlbnRFeHRlbnNpb25zJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGlkZW50aWZ5aW5nUHJldmVudEV4dGVuc2lvbnMob2JqKSB7XG4gICAgICAgIGdldEhpZGRlblJlY29yZChvYmopO1xuICAgICAgICByZXR1cm4gb2xkUHJldmVudEV4dGVuc2lvbnMob2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSkoKTtcblxuICBmdW5jdGlvbiBjb25zdEZ1bmMoZnVuYykge1xuICAgIGZ1bmMucHJvdG90eXBlID0gbnVsbDtcbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZShmdW5jKTtcbiAgfVxuXG4gIHZhciBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgPSBmYWxzZTtcbiAgZnVuY3Rpb24gY2FsbGVkQXNGdW5jdGlvbldhcm5pbmcoKSB7XG4gICAgLy8gRnV0dXJlIEVTNiBXZWFrTWFwIGlzIGN1cnJlbnRseSAoMjAxMy0wOS0xMCkgZXhwZWN0ZWQgdG8gcmVqZWN0IFdlYWtNYXAoKVxuICAgIC8vIGJ1dCB3ZSB1c2VkIHRvIHBlcm1pdCBpdCBhbmQgZG8gaXQgb3Vyc2VsdmVzLCBzbyB3YXJuIG9ubHkuXG4gICAgaWYgKCFjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgJiYgdHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgPSB0cnVlO1xuICAgICAgY29uc29sZS53YXJuKCdXZWFrTWFwIHNob3VsZCBiZSBpbnZva2VkIGFzIG5ldyBXZWFrTWFwKCksIG5vdCAnICtcbiAgICAgICAgICAnV2Vha01hcCgpLiBUaGlzIHdpbGwgYmUgYW4gZXJyb3IgaW4gdGhlIGZ1dHVyZS4nKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbmV4dElkID0gMDtcblxuICB2YXIgT3VyV2Vha01hcCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBPdXJXZWFrTWFwKSkgeyAgLy8gYXBwcm94aW1hdGUgdGVzdCBmb3IgbmV3IC4uLigpXG4gICAgICBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZygpO1xuICAgIH1cblxuICAgIC8vIFdlIGFyZSBjdXJyZW50bHkgKDEyLzI1LzIwMTIpIG5ldmVyIGVuY291bnRlcmluZyBhbnkgcHJlbWF0dXJlbHlcbiAgICAvLyBub24tZXh0ZW5zaWJsZSBrZXlzLlxuICAgIHZhciBrZXlzID0gW107IC8vIGJydXRlIGZvcmNlIGZvciBwcmVtYXR1cmVseSBub24tZXh0ZW5zaWJsZSBrZXlzLlxuICAgIHZhciB2YWx1ZXMgPSBbXTsgLy8gYnJ1dGUgZm9yY2UgZm9yIGNvcnJlc3BvbmRpbmcgdmFsdWVzLlxuICAgIHZhciBpZCA9IG5leHRJZCsrO1xuXG4gICAgZnVuY3Rpb24gZ2V0X19fKGtleSwgb3B0X2RlZmF1bHQpIHtcbiAgICAgIHZhciBpbmRleDtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuIGlkIGluIGhpZGRlblJlY29yZCA/IGhpZGRlblJlY29yZFtpZF0gOiBvcHRfZGVmYXVsdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluZGV4ID0ga2V5cy5pbmRleE9mKGtleSk7XG4gICAgICAgIHJldHVybiBpbmRleCA+PSAwID8gdmFsdWVzW2luZGV4XSA6IG9wdF9kZWZhdWx0O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhhc19fXyhrZXkpIHtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuIGlkIGluIGhpZGRlblJlY29yZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBrZXlzLmluZGV4T2Yoa2V5KSA+PSAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldF9fXyhrZXksIHZhbHVlKSB7XG4gICAgICB2YXIgaW5kZXg7XG4gICAgICB2YXIgaGlkZGVuUmVjb3JkID0gZ2V0SGlkZGVuUmVjb3JkKGtleSk7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIGhpZGRlblJlY29yZFtpZF0gPSB2YWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluZGV4ID0ga2V5cy5pbmRleE9mKGtleSk7XG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgdmFsdWVzW2luZGV4XSA9IHZhbHVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFNpbmNlIHNvbWUgYnJvd3NlcnMgcHJlZW1wdGl2ZWx5IHRlcm1pbmF0ZSBzbG93IHR1cm5zIGJ1dFxuICAgICAgICAgIC8vIHRoZW4gY29udGludWUgY29tcHV0aW5nIHdpdGggcHJlc3VtYWJseSBjb3JydXB0ZWQgaGVhcFxuICAgICAgICAgIC8vIHN0YXRlLCB3ZSBoZXJlIGRlZmVuc2l2ZWx5IGdldCBrZXlzLmxlbmd0aCBmaXJzdCBhbmQgdGhlblxuICAgICAgICAgIC8vIHVzZSBpdCB0byB1cGRhdGUgYm90aCB0aGUgdmFsdWVzIGFuZCBrZXlzIGFycmF5cywga2VlcGluZ1xuICAgICAgICAgIC8vIHRoZW0gaW4gc3luYy5cbiAgICAgICAgICBpbmRleCA9IGtleXMubGVuZ3RoO1xuICAgICAgICAgIHZhbHVlc1tpbmRleF0gPSB2YWx1ZTtcbiAgICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCB2YWx1ZXMgd2lsbCBiZSBvbmUgbG9uZ2VyIHRoYW4ga2V5cy5cbiAgICAgICAgICBrZXlzW2luZGV4XSA9IGtleTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsZXRlX19fKGtleSkge1xuICAgICAgdmFyIGhpZGRlblJlY29yZCA9IGdldEhpZGRlblJlY29yZChrZXkpO1xuICAgICAgdmFyIGluZGV4LCBsYXN0SW5kZXg7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIHJldHVybiBpZCBpbiBoaWRkZW5SZWNvcmQgJiYgZGVsZXRlIGhpZGRlblJlY29yZFtpZF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbmRleCA9IGtleXMuaW5kZXhPZihrZXkpO1xuICAgICAgICBpZiAoaW5kZXggPCAwKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNpbmNlIHNvbWUgYnJvd3NlcnMgcHJlZW1wdGl2ZWx5IHRlcm1pbmF0ZSBzbG93IHR1cm5zIGJ1dFxuICAgICAgICAvLyB0aGVuIGNvbnRpbnVlIGNvbXB1dGluZyB3aXRoIHBvdGVudGlhbGx5IGNvcnJ1cHRlZCBoZWFwXG4gICAgICAgIC8vIHN0YXRlLCB3ZSBoZXJlIGRlZmVuc2l2ZWx5IGdldCBrZXlzLmxlbmd0aCBmaXJzdCBhbmQgdGhlbiB1c2VcbiAgICAgICAgLy8gaXQgdG8gdXBkYXRlIGJvdGggdGhlIGtleXMgYW5kIHRoZSB2YWx1ZXMgYXJyYXksIGtlZXBpbmdcbiAgICAgICAgLy8gdGhlbSBpbiBzeW5jLiBXZSB1cGRhdGUgdGhlIHR3byB3aXRoIGFuIG9yZGVyIG9mIGFzc2lnbm1lbnRzLFxuICAgICAgICAvLyBzdWNoIHRoYXQgYW55IHByZWZpeCBvZiB0aGVzZSBhc3NpZ25tZW50cyB3aWxsIHByZXNlcnZlIHRoZVxuICAgICAgICAvLyBrZXkvdmFsdWUgY29ycmVzcG9uZGVuY2UsIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlIGRlbGV0ZS5cbiAgICAgICAgLy8gTm90ZSB0aGF0IHRoaXMgbmVlZHMgdG8gd29yayBjb3JyZWN0bHkgd2hlbiBpbmRleCA9PT0gbGFzdEluZGV4LlxuICAgICAgICBsYXN0SW5kZXggPSBrZXlzLmxlbmd0aCAtIDE7XG4gICAgICAgIGtleXNbaW5kZXhdID0gdm9pZCAwO1xuICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCB0aGVyZSdzIGEgdm9pZCAwIGluIHRoZSBrZXlzIGFycmF5LCBidXRcbiAgICAgICAgLy8gbm8gb3BlcmF0aW9uIHdpbGwgY2F1c2UgYSBcImtleXMuaW5kZXhPZih2b2lkIDApXCIsIHNpbmNlXG4gICAgICAgIC8vIGdldEhpZGRlblJlY29yZCh2b2lkIDApIHdpbGwgYWx3YXlzIHRocm93IGFuIGVycm9yIGZpcnN0LlxuICAgICAgICB2YWx1ZXNbaW5kZXhdID0gdmFsdWVzW2xhc3RJbmRleF07XG4gICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIHZhbHVlc1tpbmRleF0gY2Fubm90IGJlIGZvdW5kIGhlcmUsXG4gICAgICAgIC8vIGJlY2F1c2Uga2V5c1tpbmRleF0gaXMgdm9pZCAwLlxuICAgICAgICBrZXlzW2luZGV4XSA9IGtleXNbbGFzdEluZGV4XTtcbiAgICAgICAgLy8gSWYgaW5kZXggPT09IGxhc3RJbmRleCBhbmQgd2UgY3Jhc2ggaGVyZSwgdGhlbiBrZXlzW2luZGV4XVxuICAgICAgICAvLyBpcyBzdGlsbCB2b2lkIDAsIHNpbmNlIHRoZSBhbGlhc2luZyBraWxsZWQgdGhlIHByZXZpb3VzIGtleS5cbiAgICAgICAga2V5cy5sZW5ndGggPSBsYXN0SW5kZXg7XG4gICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIGtleXMgd2lsbCBiZSBvbmUgc2hvcnRlciB0aGFuIHZhbHVlcy5cbiAgICAgICAgdmFsdWVzLmxlbmd0aCA9IGxhc3RJbmRleDtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5jcmVhdGUoT3VyV2Vha01hcC5wcm90b3R5cGUsIHtcbiAgICAgIGdldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGdldF9fXykgfSxcbiAgICAgIGhhc19fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGhhc19fXykgfSxcbiAgICAgIHNldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKHNldF9fXykgfSxcbiAgICAgIGRlbGV0ZV9fXzogeyB2YWx1ZTogY29uc3RGdW5jKGRlbGV0ZV9fXykgfVxuICAgIH0pO1xuICB9O1xuXG4gIE91cldlYWtNYXAucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShPYmplY3QucHJvdG90eXBlLCB7XG4gICAgZ2V0OiB7XG4gICAgICAvKipcbiAgICAgICAqIFJldHVybiB0aGUgdmFsdWUgbW9zdCByZWNlbnRseSBhc3NvY2lhdGVkIHdpdGgga2V5LCBvclxuICAgICAgICogb3B0X2RlZmF1bHQgaWYgbm9uZS5cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGdldChrZXksIG9wdF9kZWZhdWx0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldF9fXyhrZXksIG9wdF9kZWZhdWx0KTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0sXG5cbiAgICBoYXM6IHtcbiAgICAgIC8qKlxuICAgICAgICogSXMgdGhlcmUgYSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGgga2V5IGluIHRoaXMgV2Vha01hcD9cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGhhcyhrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFzX19fKGtleSk7XG4gICAgICB9LFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICB9LFxuXG4gICAgc2V0OiB7XG4gICAgICAvKipcbiAgICAgICAqIEFzc29jaWF0ZSB2YWx1ZSB3aXRoIGtleSBpbiB0aGlzIFdlYWtNYXAsIG92ZXJ3cml0aW5nIGFueVxuICAgICAgICogcHJldmlvdXMgYXNzb2NpYXRpb24gaWYgcHJlc2VudC5cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIHNldChrZXksIHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldF9fXyhrZXksIHZhbHVlKTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0sXG5cbiAgICAnZGVsZXRlJzoge1xuICAgICAgLyoqXG4gICAgICAgKiBSZW1vdmUgYW55IGFzc29jaWF0aW9uIGZvciBrZXkgaW4gdGhpcyBXZWFrTWFwLCByZXR1cm5pbmdcbiAgICAgICAqIHdoZXRoZXIgdGhlcmUgd2FzIG9uZS5cbiAgICAgICAqXG4gICAgICAgKiA8cD5Ob3RlIHRoYXQgdGhlIGJvb2xlYW4gcmV0dXJuIGhlcmUgZG9lcyBub3Qgd29yayBsaWtlIHRoZVxuICAgICAgICoge0Bjb2RlIGRlbGV0ZX0gb3BlcmF0b3IuIFRoZSB7QGNvZGUgZGVsZXRlfSBvcGVyYXRvciByZXR1cm5zXG4gICAgICAgKiB3aGV0aGVyIHRoZSBkZWxldGlvbiBzdWNjZWVkcyBhdCBicmluZ2luZyBhYm91dCBhIHN0YXRlIGluXG4gICAgICAgKiB3aGljaCB0aGUgZGVsZXRlZCBwcm9wZXJ0eSBpcyBhYnNlbnQuIFRoZSB7QGNvZGUgZGVsZXRlfVxuICAgICAgICogb3BlcmF0b3IgdGhlcmVmb3JlIHJldHVybnMgdHJ1ZSBpZiB0aGUgcHJvcGVydHkgd2FzIGFscmVhZHlcbiAgICAgICAqIGFic2VudCwgd2hlcmVhcyB0aGlzIHtAY29kZSBkZWxldGV9IG1ldGhvZCByZXR1cm5zIGZhbHNlIGlmXG4gICAgICAgKiB0aGUgYXNzb2NpYXRpb24gd2FzIGFscmVhZHkgYWJzZW50LlxuICAgICAgICovXG4gICAgICB2YWx1ZTogZnVuY3Rpb24gcmVtb3ZlKGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWxldGVfX18oa2V5KTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH1cbiAgfSk7XG5cbiAgaWYgKHR5cGVvZiBIb3N0V2Vha01hcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIChmdW5jdGlvbigpIHtcbiAgICAgIC8vIElmIHdlIGdvdCBoZXJlLCB0aGVuIHRoZSBwbGF0Zm9ybSBoYXMgYSBXZWFrTWFwIGJ1dCB3ZSBhcmUgY29uY2VybmVkXG4gICAgICAvLyB0aGF0IGl0IG1heSByZWZ1c2UgdG8gc3RvcmUgc29tZSBrZXkgdHlwZXMuIFRoZXJlZm9yZSwgbWFrZSBhIG1hcFxuICAgICAgLy8gaW1wbGVtZW50YXRpb24gd2hpY2ggbWFrZXMgdXNlIG9mIGJvdGggYXMgcG9zc2libGUuXG5cbiAgICAgIC8vIEluIHRoaXMgbW9kZSB3ZSBhcmUgYWx3YXlzIHVzaW5nIGRvdWJsZSBtYXBzLCBzbyB3ZSBhcmUgbm90IHByb3h5LXNhZmUuXG4gICAgICAvLyBUaGlzIGNvbWJpbmF0aW9uIGRvZXMgbm90IG9jY3VyIGluIGFueSBrbm93biBicm93c2VyLCBidXQgd2UgaGFkIGJlc3RcbiAgICAgIC8vIGJlIHNhZmUuXG4gICAgICBpZiAoZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSAmJiB0eXBlb2YgUHJveHkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIFByb3h5ID0gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBEb3VibGVXZWFrTWFwKCkge1xuICAgICAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgT3VyV2Vha01hcCkpIHsgIC8vIGFwcHJveGltYXRlIHRlc3QgZm9yIG5ldyAuLi4oKVxuICAgICAgICAgIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcmVmZXJhYmxlLCB0cnVseSB3ZWFrIG1hcC5cbiAgICAgICAgdmFyIGhtYXAgPSBuZXcgSG9zdFdlYWtNYXAoKTtcblxuICAgICAgICAvLyBPdXIgaGlkZGVuLXByb3BlcnR5LWJhc2VkIHBzZXVkby13ZWFrLW1hcC4gTGF6aWx5IGluaXRpYWxpemVkIGluIHRoZVxuICAgICAgICAvLyAnc2V0JyBpbXBsZW1lbnRhdGlvbjsgdGh1cyB3ZSBjYW4gYXZvaWQgcGVyZm9ybWluZyBleHRyYSBsb29rdXBzIGlmXG4gICAgICAgIC8vIHdlIGtub3cgYWxsIGVudHJpZXMgYWN0dWFsbHkgc3RvcmVkIGFyZSBlbnRlcmVkIGluICdobWFwJy5cbiAgICAgICAgdmFyIG9tYXAgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gSGlkZGVuLXByb3BlcnR5IG1hcHMgYXJlIG5vdCBjb21wYXRpYmxlIHdpdGggcHJveGllcyBiZWNhdXNlIHByb3hpZXNcbiAgICAgICAgLy8gY2FuIG9ic2VydmUgdGhlIGhpZGRlbiBuYW1lIGFuZCBlaXRoZXIgYWNjaWRlbnRhbGx5IGV4cG9zZSBpdCBvciBmYWlsXG4gICAgICAgIC8vIHRvIGFsbG93IHRoZSBoaWRkZW4gcHJvcGVydHkgdG8gYmUgc2V0LiBUaGVyZWZvcmUsIHdlIGRvIG5vdCBhbGxvd1xuICAgICAgICAvLyBhcmJpdHJhcnkgV2Vha01hcHMgdG8gc3dpdGNoIHRvIHVzaW5nIGhpZGRlbiBwcm9wZXJ0aWVzLCBidXQgb25seVxuICAgICAgICAvLyB0aG9zZSB3aGljaCBuZWVkIHRoZSBhYmlsaXR5LCBhbmQgdW5wcml2aWxlZ2VkIGNvZGUgaXMgbm90IGFsbG93ZWRcbiAgICAgICAgLy8gdG8gc2V0IHRoZSBmbGFnLlxuICAgICAgICAvL1xuICAgICAgICAvLyAoRXhjZXB0IGluIGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgbW9kZSBpbiB3aGljaCBjYXNlIHdlXG4gICAgICAgIC8vIGRpc2FibGUgcHJveGllcy4pXG4gICAgICAgIHZhciBlbmFibGVTd2l0Y2hpbmcgPSBmYWxzZTtcblxuICAgICAgICBmdW5jdGlvbiBkZ2V0KGtleSwgb3B0X2RlZmF1bHQpIHtcbiAgICAgICAgICBpZiAob21hcCkge1xuICAgICAgICAgICAgcmV0dXJuIGhtYXAuaGFzKGtleSkgPyBobWFwLmdldChrZXkpXG4gICAgICAgICAgICAgICAgOiBvbWFwLmdldF9fXyhrZXksIG9wdF9kZWZhdWx0KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGhtYXAuZ2V0KGtleSwgb3B0X2RlZmF1bHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGRoYXMoa2V5KSB7XG4gICAgICAgICAgcmV0dXJuIGhtYXAuaGFzKGtleSkgfHwgKG9tYXAgPyBvbWFwLmhhc19fXyhrZXkpIDogZmFsc2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGRzZXQ7XG4gICAgICAgIGlmIChkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlKSB7XG4gICAgICAgICAgZHNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGhtYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgaWYgKCFobWFwLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICAgIGlmICghb21hcCkgeyBvbWFwID0gbmV3IE91cldlYWtNYXAoKTsgfVxuICAgICAgICAgICAgICBvbWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZHNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChlbmFibGVTd2l0Y2hpbmcpIHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBobWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGlmICghb21hcCkgeyBvbWFwID0gbmV3IE91cldlYWtNYXAoKTsgfVxuICAgICAgICAgICAgICAgIG9tYXAuc2V0X19fKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBobWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBkZGVsZXRlKGtleSkge1xuICAgICAgICAgIHZhciByZXN1bHQgPSAhIWhtYXBbJ2RlbGV0ZSddKGtleSk7XG4gICAgICAgICAgaWYgKG9tYXApIHsgcmV0dXJuIG9tYXAuZGVsZXRlX19fKGtleSkgfHwgcmVzdWx0OyB9XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBPYmplY3QuY3JlYXRlKE91cldlYWtNYXAucHJvdG90eXBlLCB7XG4gICAgICAgICAgZ2V0X19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoZGdldCkgfSxcbiAgICAgICAgICBoYXNfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhkaGFzKSB9LFxuICAgICAgICAgIHNldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGRzZXQpIH0sXG4gICAgICAgICAgZGVsZXRlX19fOiB7IHZhbHVlOiBjb25zdEZ1bmMoZGRlbGV0ZSkgfSxcbiAgICAgICAgICBwZXJtaXRIb3N0T2JqZWN0c19fXzogeyB2YWx1ZTogY29uc3RGdW5jKGZ1bmN0aW9uKHRva2VuKSB7XG4gICAgICAgICAgICBpZiAodG9rZW4gPT09IHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cykge1xuICAgICAgICAgICAgICBlbmFibGVTd2l0Y2hpbmcgPSB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdib2d1cyBjYWxsIHRvIHBlcm1pdEhvc3RPYmplY3RzX19fJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSl9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgRG91YmxlV2Vha01hcC5wcm90b3R5cGUgPSBPdXJXZWFrTWFwLnByb3RvdHlwZTtcbiAgICAgIG1vZHVsZS5leHBvcnRzID0gRG91YmxlV2Vha01hcDtcblxuICAgICAgLy8gZGVmaW5lIC5jb25zdHJ1Y3RvciB0byBoaWRlIE91cldlYWtNYXAgY3RvclxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFdlYWtNYXAucHJvdG90eXBlLCAnY29uc3RydWN0b3InLCB7XG4gICAgICAgIHZhbHVlOiBXZWFrTWFwLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSwgIC8vIGFzIGRlZmF1bHQgLmNvbnN0cnVjdG9yIGlzXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWVcbiAgICAgIH0pO1xuICAgIH0pKCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gVGhlcmUgaXMgbm8gaG9zdCBXZWFrTWFwLCBzbyB3ZSBtdXN0IHVzZSB0aGUgZW11bGF0aW9uLlxuXG4gICAgLy8gRW11bGF0ZWQgV2Vha01hcHMgYXJlIGluY29tcGF0aWJsZSB3aXRoIG5hdGl2ZSBwcm94aWVzIChiZWNhdXNlIHByb3hpZXNcbiAgICAvLyBjYW4gb2JzZXJ2ZSB0aGUgaGlkZGVuIG5hbWUpLCBzbyB3ZSBtdXN0IGRpc2FibGUgUHJveHkgdXNhZ2UgKGluXG4gICAgLy8gQXJyYXlMaWtlIGFuZCBEb21hZG8sIGN1cnJlbnRseSkuXG4gICAgaWYgKHR5cGVvZiBQcm94eSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIFByb3h5ID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIG1vZHVsZS5leHBvcnRzID0gT3VyV2Vha01hcDtcbiAgfVxufSkoKTtcbiIsInZhciBXTTtcblxuaWYodHlwZW9mIFdlYWtNYXAgIT09ICd1bmRlZmluZWQnKXtcbiAgICBXTSA9IFdlYWtNYXA7XG59ZWxzZSBpZih0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyl7XG4gICAgaWYgKG5hdmlnYXRvci5hcHBOYW1lID09ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInKXtcbiAgICAgICAgdmFyIG1hdGNoID0gbmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvTVNJRSAoWzAtOV17MSx9W1xcLjAtOV17MCx9KS8pO1xuICAgICAgICBpZiAobWF0Y2ggJiYgbWF0Y2hbMV0gPD0gOSl7XG4gICAgICAgICAgICAvLyBNRU1PUlkgTEVBS1MgRk9SIEVWRVJZT05FISEhXG4gICAgICAgICAgICBXTSA9IHJlcXVpcmUoJ2xlYWstbWFwJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbldNIHx8IChXTSA9IHJlcXVpcmUoJ3dlYWstbWFwJykpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdNOyIsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciBrTWF4TGVuZ3RoID0gMHgzZmZmZmZmZlxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqIC0gSW1wbGVtZW50YXRpb24gbXVzdCBzdXBwb3J0IGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLlxuICogICBGaXJlZm94IDQtMjkgbGFja2VkIHN1cHBvcnQsIGZpeGVkIGluIEZpcmVmb3ggMzArLlxuICogICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuICpcbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5IHdpbGxcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IHdpbGwgd29yayBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gKGZ1bmN0aW9uICgpIHtcbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIHJldHVybiA0MiA9PT0gYXJyLmZvbygpICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIG5ldyBVaW50OEFycmF5KDEpLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59KSgpXG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybylcblxuICB2YXIgdHlwZSA9IHR5cGVvZiBzdWJqZWN0XG5cbiAgLy8gRmluZCB0aGUgbGVuZ3RoXG4gIHZhciBsZW5ndGhcbiAgaWYgKHR5cGUgPT09ICdudW1iZXInKVxuICAgIGxlbmd0aCA9IHN1YmplY3QgPiAwID8gc3ViamVjdCA+Pj4gMCA6IDBcbiAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAoZW5jb2RpbmcgPT09ICdiYXNlNjQnKVxuICAgICAgc3ViamVjdCA9IGJhc2U2NGNsZWFuKHN1YmplY3QpXG4gICAgbGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ29iamVjdCcgJiYgc3ViamVjdCAhPT0gbnVsbCkgeyAvLyBhc3N1bWUgb2JqZWN0IGlzIGFycmF5LWxpa2VcbiAgICBpZiAoc3ViamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KHN1YmplY3QuZGF0YSkpXG4gICAgICBzdWJqZWN0ID0gc3ViamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gK3N1YmplY3QubGVuZ3RoID4gMCA/IE1hdGguZmxvb3IoK3N1YmplY3QubGVuZ3RoKSA6IDBcbiAgfSBlbHNlXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuXG4gIGlmICh0aGlzLmxlbmd0aCA+IGtNYXhMZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aC50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcblxuICB2YXIgYnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFByZWZlcnJlZDogUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBidWYgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIFRISVMgaW5zdGFuY2Ugb2YgQnVmZmVyIChjcmVhdGVkIGJ5IGBuZXdgKVxuICAgIGJ1ZiA9IHRoaXNcbiAgICBidWYubGVuZ3RoID0gbGVuZ3RoXG4gICAgYnVmLl9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiB0eXBlb2Ygc3ViamVjdC5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIC8vIFNwZWVkIG9wdGltaXphdGlvbiAtLSB1c2Ugc2V0IGlmIHdlJ3JlIGNvcHlpbmcgZnJvbSBhIHR5cGVkIGFycmF5XG4gICAgYnVmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgICAgIGJ1ZltpXSA9ICgoc3ViamVjdFtpXSAlIDI1NikgKyAyNTYpICUgMjU2XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgYnVmLndyaXRlKHN1YmplY3QsIDAsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBNYXRoLm1pbih4LCB5KTsgaSA8IGxlbiAmJiBhW2ldID09PSBiW2ldOyBpKyspIHt9XG4gIGlmIChpICE9PSBsZW4pIHtcbiAgICB4ID0gYVtpXVxuICAgIHkgPSBiW2ldXG4gIH1cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIChsaXN0LCB0b3RhbExlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1VzYWdlOiBCdWZmZXIuY29uY2F0KGxpc3RbLCBsZW5ndGhdKScpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAodG90YWxMZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIHRvdGFsTGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0b3RhbExlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHRvdGFsTGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gZnVuY3Rpb24gKHN0ciwgZW5jb2RpbmcpIHtcbiAgdmFyIHJldFxuICBzdHIgPSBzdHIgKyAnJ1xuICBzd2l0Y2ggKGVuY29kaW5nIHx8ICd1dGY4Jykge1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCA+Pj4gMVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSB1dGY4VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICB9XG4gIHJldHVybiByZXRcbn1cblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4vLyB0b1N0cmluZyhlbmNvZGluZywgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCA+Pj4gMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgPj4+IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpXG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIChiKSB7XG4gIGlmKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KVxuICAgICAgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYnl0ZSA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4oYnl0ZSkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBieXRlXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBTdXBwb3J0IGJvdGggKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKVxuICAvLyBhbmQgdGhlIGxlZ2FjeSAoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpXG4gIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgaWYgKCFpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICB9IGVsc2UgeyAgLy8gbGVnYWN5XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKClcblxuICB2YXIgcmV0XG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldCA9IGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gdXRmMTZsZVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICByZXR1cm4gYXNjaWlTbGljZShidWYsIHN0YXJ0LCBlbmQpXG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlbjtcbiAgICBpZiAoc3RhcnQgPCAwKVxuICAgICAgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApXG4gICAgICBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpXG4gICAgZW5kID0gc3RhcnRcblxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICByZXR1cm4gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICB2YXIgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkLCB0cnVlKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICAgIHJldHVybiBuZXdCdWZcbiAgfVxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKVxuICAgIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gKHRhcmdldCwgdGFyZ2V0X3N0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIHZhciBzb3VyY2UgPSB0aGlzXG5cbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKCF0YXJnZXRfc3RhcnQpIHRhcmdldF9zdGFydCA9IDBcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCBzb3VyY2UubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlRW5kIDwgc291cmNlU3RhcnQnKVxuICBpZiAodGFyZ2V0X3N0YXJ0IDwgMCB8fCB0YXJnZXRfc3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aClcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSBzb3VyY2UubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gc291cmNlLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aClcbiAgICBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCA8IGVuZCAtIHN0YXJ0KVxuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgKyBzdGFydFxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRfc3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0X3N0YXJ0KVxuICB9XG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgVHlwZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gKGFycikge1xuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgZ2V0L3NldCBtZXRob2RzIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX2dldCA9IGFyci5nZXRcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZCwgd2lsbCBiZSByZW1vdmVkIGluIG5vZGUgMC4xMytcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtel0vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGIgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGlmIChiIDw9IDB4N0YpIHtcbiAgICAgIGJ5dGVBcnJheS5wdXNoKGIpXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBzdGFydCA9IGlcbiAgICAgIGlmIChiID49IDB4RDgwMCAmJiBiIDw9IDB4REZGRikgaSsrXG4gICAgICB2YXIgaCA9IGVuY29kZVVSSUNvbXBvbmVudChzdHIuc2xpY2Uoc3RhcnQsIGkrMSkpLnN1YnN0cigxKS5zcGxpdCgnJScpXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgYnl0ZUFycmF5LnB1c2gocGFyc2VJbnQoaFtqXSwgMTYpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShzdHIpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbihidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIG5CaXRzID0gLTcsXG4gICAgICBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDAsXG4gICAgICBkID0gaXNMRSA/IC0xIDogMSxcbiAgICAgIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV07XG5cbiAgaSArPSBkO1xuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBzID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gZUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIGUgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBtTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXM7XG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KTtcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pO1xuICAgIGUgPSBlIC0gZUJpYXM7XG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbik7XG59O1xuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24oYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGMsXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApLFxuICAgICAgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpLFxuICAgICAgZCA9IGlzTEUgPyAxIDogLTEsXG4gICAgICBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwO1xuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwO1xuICAgIGUgPSBlTWF4O1xuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKTtcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS07XG4gICAgICBjICo9IDI7XG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcyk7XG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrO1xuICAgICAgYyAvPSAyO1xuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDA7XG4gICAgICBlID0gZU1heDtcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gZSArIGVCaWFzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gMDtcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KTtcblxuICBlID0gKGUgPDwgbUxlbikgfCBtO1xuICBlTGVuICs9IG1MZW47XG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCk7XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4O1xufTtcbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH1cbiAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIl19
