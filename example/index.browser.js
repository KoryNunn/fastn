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
            bindings[0](updateTransform(value));
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
        return drill(key.slice(0, dotIndex), key.slice(dotIndex+1));
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

    for(var key in settings){
        if(is.property(component[key])){
            if(is.binding(settings[key])){
                component[key].binding(settings[key]);
            }else{
                component[key](settings[key]);
            }
        }
    }

    component.attach = function(object, loose){
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

    component.clone = function(){
        return createComponent(component._type, fastn, component._settings, component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return child.clone();
        }), components);
    };

    component.on('attach', emitUpdate);
    component.on('render', emitUpdate);

    if(fastn.debug){
        component.on('render', function(){
            if(component.element && typeof component.element === 'object'){
                component.element._component = component;
            }
        });
    }

    return component;
}

},{"./is":"/home/kory/dev/fastn/is.js","enti":"/usr/lib/node_modules/enti/index.js"}],"/home/kory/dev/fastn/containerComponent.js":[function(require,module,exports){
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
module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=[
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

function watchFilter(object, filter, handler){
    if(!object || typeof object !=='object') {
        return;
    }

    var dotIndex = filter.indexOf('.'),
        isLast = !~dotIndex,
        target = isLast ? filter : filter.slice(0, dotIndex),
        isDoubleStar = target === '**',
        isValueStar = target === '*$',
        rest = isLast ? null : filter.slice(dotIndex+1),
        realKey = target.charAt(0) !== '*',
        model = new Enti(object),
        childWatches = {};

    function unwatch(){
        model.detach();
        model._events = {};
        for(var key in childWatches){
            childWatches[key] && childWatches[key]();
            delete childWatches[key];
        }
    }

    function updateOn(key){
        model.on(key, function(){
            unwatch();
            watchFilter(object, filter, handler);
        });
    }

    updateOn('*');

    if(realKey){
        if(rest){
            childWatches[target] = watchFilter(object[target], rest, handler);
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
                childWatches[key] = watchFilter(object[key], rest, handler);
                if(isDoubleStar){
                    childWatches[key + '.**.' + rest] = watchFilter(object[key], '**.' + rest, handler);
                }
            }else{
                if(isValueStar || isDoubleStar){
                    model.on(key, handler);
                }
                if(isDoubleStar){
                    childWatches[key + '.**'] = watchFilter(object[key], '**', handler);
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

    if(!property){
        property = fastn.property(value);
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

module.exports = {
    component: isComponent,
    bindingObject: isBindingObject,
    binding: isBinding,
    property: isProperty
};
},{}],"/home/kory/dev/fastn/listComponent.js":[function(require,module,exports){
var crel = require('crel'),
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
                lastKey = keyFor(lastItems, item);

            if(lastKey === false){
                child = template(item, key, list.scope());
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
                if(item && typeof item === 'object'){
                    child.attach(item, true);
                }else{
                    child.attach({
                        item: item,
                        key: key
                    }, true);
                }
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
},{"./genericComponent":"/home/kory/dev/fastn/genericComponent.js","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js"}],"/home/kory/dev/fastn/node_modules/crel/crel.js":[function(require,module,exports){
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

module.exports = function property(currentValue){
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
Enti.prototype.attach = function(model){
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
    var references = attachedEnties.get(this._model);

    if(!references){
        return;
    }

    references.splice(references.indexOf(this),1);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vYmluZGluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvaGVhZGVyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZXhhbXBsZS9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlckxpc3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3VzZXJzLmpzb24iLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9maWx0ZXIuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9nZW5lcmljQ29tcG9uZW50LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9pcy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2xpc3RDb21wb25lbnQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3JlbC9jcmVsLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2ZsYXQtbWVyZ2UvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvY2xvbmUvY2xvbmUuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvd2hhdC1jaGFuZ2VkL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIvaXNfYXJndW1lbnRzLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIva2V5cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL3Byb3BlcnR5LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL2VudGkvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvbGVhay1tYXAvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvd2Vhay1tYXAvd2Vhay1tYXAuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS93ZWFrbWFwLmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3cUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgd2F0Y2hGaWx0ZXIgPSByZXF1aXJlKCcuL2ZpbHRlcicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBiaW5kaWZ5KGJpbmRpbmcsIGtleSl7XG4gICAgZm9yKHZhciBlbWl0dGVyS2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgICAgICBiaW5kaW5nW2VtaXR0ZXJLZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtlbWl0dGVyS2V5XTtcbiAgICB9XG4gICAgYmluZGluZy5zZXRNYXhMaXN0ZW5lcnMoMTAwMCk7XG4gICAgYmluZGluZy5tb2RlbCA9IG5ldyBFbnRpKCksXG4gICAgYmluZGluZy5fZmFzdG5fYmluZGluZyA9IGtleTtcbiAgICBiaW5kaW5nLl9maXJtID0gZmFsc2U7XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxuZnVuY3Rpb24gZnVzZUJpbmRpbmcoKXtcbiAgICB2YXIgYmluZGluZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZygncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIGlmKHR5cGVvZiBiaW5kaW5nc1tiaW5kaW5ncy5sZW5ndGgtMV0gPT09ICdmdW5jdGlvbicgJiYgIWlzLmJpbmRpbmcoYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdKSl7XG4gICAgICAgIHVwZGF0ZVRyYW5zZm9ybSA9IHRyYW5zZm9ybTtcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCk7XG4gICAgfVxuXG4gICAgcmVzdWx0QmluZGluZy5tb2RlbC5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICBiaW5kaW5nc1swXSh1cGRhdGVUcmFuc2Zvcm0odmFsdWUpKTtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuZW1pdChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjaGFuZ2UoKXtcbiAgICAgICAgaWYoc2VsZkNoYW5naW5nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRCaW5kaW5nKHRyYW5zZm9ybS5hcHBseShudWxsLCBiaW5kaW5ncy5tYXAoZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZygpO1xuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZywgaW5kZXgpe1xuICAgICAgICBpZih0eXBlb2YgYmluZGluZyA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoYmluZGluZyk7XG4gICAgICAgICAgICBiaW5kaW5ncy5zcGxpY2UoaW5kZXgsMSxiaW5kaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBiaW5kaW5nLmRldGFjaCk7XG4gICAgfSk7XG5cbiAgICByZXN1bHRCaW5kaW5nLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihvYmplY3Qpe1xuICAgICAgICBzZWxmQ2hhbmdpbmcgPSB0cnVlO1xuICAgICAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCB0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICBjaGFuZ2UoKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBkcmlsbChzb3VyY2VLZXksIHRhcmdldEtleSl7XG4gICAgdmFyIGJpbmRpbmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSxcbiAgICAgICAgc291cmNlQmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoc291cmNlS2V5KSxcbiAgICAgICAgcmVzdWx0QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoJ3Jlc3VsdCcpLFxuICAgICAgICB0YXJnZXRCaW5kaW5nID0gY3JlYXRlQmluZGluZyh0YXJnZXRLZXkpO1xuXG4gICAgdmFyIHJlbW92ZSxcbiAgICAgICAgbGFzdFRhcmdldCA9IHJlc3VsdEJpbmRpbmcoKTtcblxuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIHNvdXJjZUJpbmRpbmcuYXR0YWNoKTtcblxuICAgIHNvdXJjZUJpbmRpbmcub24oJ2NoYW5nZScsIGZ1bmN0aW9uKG5ld1RhcmdldCl7XG4gICAgICAgIGlmKGxhc3RUYXJnZXQgIT09IG5ld1RhcmdldCl7XG4gICAgICAgICAgICBsYXN0VGFyZ2V0ID0gbmV3VGFyZ2V0O1xuICAgICAgICAgICAgdGFyZ2V0QmluZGluZy5hdHRhY2gobmV3VGFyZ2V0KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzdWx0QmluZGluZy5tb2RlbC5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgdGhpcy5lbWl0KGtleSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICB0YXJnZXRCaW5kaW5nLm9uKCdjaGFuZ2UnLCByZXN1bHRCaW5kaW5nKTtcbiAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBzb3VyY2VCaW5kaW5nLmRldGFjaCk7XG4gICAgc291cmNlQmluZGluZy5vbignZGV0YWNoJywgdGFyZ2V0QmluZGluZy5kZXRhY2gpO1xuXG4gICAgcmV0dXJuIHJlc3VsdEJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJpbmRpbmcoa2V5QW5kRmlsdGVyKXtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBpZihhcmdzLmxlbmd0aCA+IDEpe1xuICAgICAgICByZXR1cm4gZnVzZUJpbmRpbmcuYXBwbHkobnVsbCwgYXJncyk7XG4gICAgfVxuXG4gICAgdmFyIGtleUFuZEZpbHRlclBhcnRzID0ga2V5QW5kRmlsdGVyLnNwbGl0KCd8JyksXG4gICAgICAgIGZpbHRlciA9IGtleUFuZEZpbHRlclBhcnRzWzFdLFxuICAgICAgICBrZXkgPSBrZXlBbmRGaWx0ZXJQYXJ0c1swXTtcblxuICAgIHZhciBkb3RJbmRleCA9IGtleS5pbmRleE9mKCcuJyk7XG5cbiAgICBpZihrZXkubGVuZ3RoID4gMSAmJiB+ZG90SW5kZXgpe1xuICAgICAgICByZXR1cm4gZHJpbGwoa2V5LnNsaWNlKDAsIGRvdEluZGV4KSwga2V5LnNsaWNlKGRvdEluZGV4KzEpKTtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUsXG4gICAgICAgIGJpbmRpbmcgPSBmdW5jdGlvbiBiaW5kaW5nKG5ld1ZhbHVlKXtcbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5zZXQoa2V5LCBuZXdWYWx1ZSk7XG4gICAgfTtcbiAgICBiaW5kaWZ5KGJpbmRpbmcsIGtleSk7XG4gICAgYmluZGluZy5tb2RlbC5fZXZlbnRzID0ge307XG4gICAgYmluZGluZy5tb2RlbC5fZXZlbnRzW2tleV0gPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGJpbmRpbmcuX2NoYW5nZSh2YWx1ZSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICBiaW5kaW5nLmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgbG9vc2Upe1xuXG4gICAgICAgIC8vIElmIHRoZSBiaW5kaW5nIGlzIGJlaW5nIGFza2VkIHRvIGF0dGFjaCBsb29zbHkgdG8gYW4gb2JqZWN0LFxuICAgICAgICAvLyBidXQgaXQgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkIGFzIGJlaW5nIGZpcm1seSBhdHRhY2hlZCwgZG8gbm90IGF0dGFjaC5cbiAgICAgICAgaWYobG9vc2UgJiYgYmluZGluZy5fZmlybSl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcuX2Zpcm0gPSAhbG9vc2U7XG5cbiAgICAgICAgaWYob2JqZWN0IGluc3RhbmNlb2YgRW50aSl7XG4gICAgICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIShvYmplY3QgaW5zdGFuY2VvZiBPYmplY3QpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5hdHRhY2gob2JqZWN0KTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKGJpbmRpbmcubW9kZWwuZ2V0KGtleSkpO1xuICAgICAgICBiaW5kaW5nLl9zY29wZSA9IG9iamVjdDtcbiAgICAgICAgYmluZGluZy5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIHRydWUpO1xuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9O1xuICAgIGJpbmRpbmcuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBiaW5kaW5nLl9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgYmluZGluZy5tb2RlbC5kZXRhY2goKTtcbiAgICAgICAgYmluZGluZy5fY2hhbmdlKHVuZGVmaW5lZCk7XG4gICAgICAgIGJpbmRpbmcuX3Njb3BlID0gbnVsbDtcbiAgICAgICAgYmluZGluZy5lbWl0KCdkZXRhY2gnLCB0cnVlKTtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfTtcbiAgICBiaW5kaW5nLmRyaWxsID0gZnVuY3Rpb24oZHJpbGxLZXkpe1xuICAgICAgICByZXR1cm4gZHJpbGwoa2V5LCBkcmlsbEtleSk7XG4gICAgfTtcbiAgICBiaW5kaW5nLl9jaGFuZ2UgPSBmdW5jdGlvbihuZXdWYWx1ZSwgY2hhbmdlVGFyZ2V0KXtcbiAgICAgICAgdmFsdWUgPSBuZXdWYWx1ZTtcbiAgICAgICAgYmluZGluZy5lbWl0KCdjaGFuZ2UnLCB2YWx1ZSwgY2hhbmdlVGFyZ2V0KTtcbiAgICB9O1xuICAgIGJpbmRpbmcuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQmluZGluZy5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9O1xuXG4gICAgZmlsdGVyICYmIHdhdGNoRmlsdGVyKGJpbmRpbmcsIGZpbHRlcik7XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVCaW5kaW5nOyIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhzZXR0aW5ncyk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICByZXN1bHRba2V5XSA9IHNldHRpbmdzW2tleV07XG4gICAgICAgIGlmKGlzLmJpbmRpbmdPYmplY3QocmVzdWx0W2tleV0pKXtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZmFzdG4uYmluZGluZyhcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZmFzdG5fYmluZGluZyxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZGVmYXVsdFZhbHVlLFxuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldLnRyYW5zZm9ybVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW4oaXRlbSl7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoaXRlbSkgPyBpdGVtLnJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGVsZW1lbnQpe1xuICAgICAgICByZXR1cm4gcmVzdWx0LmNvbmNhdChmbGF0dGVuKGVsZW1lbnQpKTtcbiAgICB9LFtdKSA6IGl0ZW07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4sIGNvbXBvbmVudHMpe1xuICAgIHZhciBjb21wb25lbnQsXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoe30pO1xuXG4gICAgc2V0dGluZ3MgPSBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzIHx8IHt9KTtcbiAgICBjaGlsZHJlbiA9IGZsYXR0ZW4oY2hpbGRyZW4pO1xuXG4gICAgaWYoISh0eXBlIGluIGNvbXBvbmVudHMpKXtcbiAgICAgICAgaWYoISgnX2dlbmVyaWMnIGluIGNvbXBvbmVudHMpKXtcbiAgICAgICAgICAgIHRocm93ICdObyBjb21wb25lbnQgb2YgdHlwZSBcIicgKyB0eXBlICsgJ1wiIGlzIGxvYWRlZCc7XG4gICAgICAgIH1cbiAgICAgICAgY29tcG9uZW50ID0gY29tcG9uZW50cy5fZ2VuZXJpYyh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgY29tcG9uZW50ID0gY29tcG9uZW50c1t0eXBlXSh0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKTtcbiAgICB9XG5cbiAgICBjb21wb25lbnQuX3R5cGUgPSB0eXBlO1xuICAgIGNvbXBvbmVudC5fc2V0dGluZ3MgPSBzZXR0aW5ncztcbiAgICBjb21wb25lbnQuX2Zhc3RuX2NvbXBvbmVudCA9IHRydWU7XG4gICAgY29tcG9uZW50Ll9jaGlsZHJlbiA9IGNoaWxkcmVuO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICBpZihpcy5wcm9wZXJ0eShjb21wb25lbnRba2V5XSkpe1xuICAgICAgICAgICAgaWYoaXMuYmluZGluZyhzZXR0aW5nc1trZXldKSl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50W2tleV0uYmluZGluZyhzZXR0aW5nc1trZXldKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudFtrZXldKHNldHRpbmdzW2tleV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29tcG9uZW50LmF0dGFjaCA9IGZ1bmN0aW9uKG9iamVjdCwgbG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbXBvbmVudC5fZmlybSA9ICFsb29zZTtcblxuICAgICAgICBpZihvYmplY3QgaW5zdGFuY2VvZiBFbnRpKXtcbiAgICAgICAgICAgIG9iamVjdCA9IG9iamVjdC5fbW9kZWw7XG4gICAgICAgIH1cblxuICAgICAgICBpZighKG9iamVjdCBpbnN0YW5jZW9mIE9iamVjdCkpe1xuICAgICAgICAgICAgb2JqZWN0ID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBtb2RlbC5hdHRhY2gob2JqZWN0IGluc3RhbmNlb2YgRW50aSA/IG9iamVjdC5fbW9kZWwgOiBvYmplY3QpO1xuICAgICAgICBjb21wb25lbnQuZW1pdCgnYXR0YWNoJywgb2JqZWN0LCB0cnVlKTtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmRldGFjaCA9IGZ1bmN0aW9uKGxvb3NlKXtcbiAgICAgICAgaWYobG9vc2UgJiYgY29tcG9uZW50Ll9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgICAgIH1cblxuICAgICAgICBtb2RlbC5kZXRhY2goKTtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2RldGFjaCcsIHRydWUpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuc2NvcGUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gbW9kZWw7XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGVtaXRVcGRhdGUoKXtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ3VwZGF0ZScpO1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5kZXN0cm95ID0gZnVuY3Rpb24oKXtcbiAgICAgICAgY29tcG9uZW50LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgbW9kZWwuZGV0YWNoKCk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5jbG9uZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBjcmVhdGVDb21wb25lbnQoY29tcG9uZW50Ll90eXBlLCBmYXN0biwgY29tcG9uZW50Ll9zZXR0aW5ncywgY29tcG9uZW50Ll9jaGlsZHJlbi5maWx0ZXIoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuICFjaGlsZC5fdGVtcGxhdGVkO1xuICAgICAgICB9KS5tYXAoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuIGNoaWxkLmNsb25lKCk7XG4gICAgICAgIH0pLCBjb21wb25lbnRzKTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBlbWl0VXBkYXRlKTtcbiAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGVtaXRVcGRhdGUpO1xuXG4gICAgaWYoZmFzdG4uZGVidWcpe1xuICAgICAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCAmJiB0eXBlb2YgY29tcG9uZW50LmVsZW1lbnQgPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuZWxlbWVudC5fY29tcG9uZW50ID0gY29tcG9uZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuIiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHR5cGUsIGZhc3RuKXtcbiAgICB2YXIgY29udGFpbmVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG4gICAgY29udGFpbmVyLmluc2VydCA9IGZ1bmN0aW9uKGNvbXBvbmVudCwgaW5kZXgpe1xuICAgICAgICBpZihjcmVsLmlzTm9kZShjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHZhciBlbGVtZW50ID0gY29tcG9uZW50O1xuICAgICAgICAgICAgY29tcG9uZW50ID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuICAgICAgICAgICAgY29tcG9uZW50LmVsZW1lbnQgPSBlbGVtZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoaXNOYU4oaW5kZXgpKXtcbiAgICAgICAgICAgIGluZGV4ID0gdGhpcy5fY2hpbGRyZW4ubGVuZ3RoO1xuICAgICAgICB9XG4gICAgICAgIHZhciBjdXJyZW50SW5kZXggPSB0aGlzLl9jaGlsZHJlbi5pbmRleE9mKGNvbXBvbmVudCk7XG4gICAgICAgIGlmKH5jdXJyZW50SW5kZXgpe1xuICAgICAgICAgICAgdGhpcy5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY2hpbGRyZW4uc3BsaWNlKGluZGV4LCAwLCBjb21wb25lbnQpO1xuXG4gICAgICAgIGlmKHRoaXMuZWxlbWVudCAmJiAhY29tcG9uZW50LmVsZW1lbnQpe1xuICAgICAgICAgICAgY29tcG9uZW50LnJlbmRlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2luc2VydChjb21wb25lbnQuZWxlbWVudCwgaW5kZXgpO1xuICAgIH07XG5cbiAgICBjb250YWluZXIuX2luc2VydCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGluZGV4KXtcbiAgICAgICAgdGhpcy5lbGVtZW50Lmluc2VydEJlZm9yZShlbGVtZW50LCB0aGlzLmVsZW1lbnQuY2hpbGROb2Rlc1tpbmRleF0pO1xuICAgIH07XG5cbiAgICBjb250YWluZXIucmVtb3ZlID0gZnVuY3Rpb24oY29tcG9uZW50KXtcbiAgICAgICAgdmFyIGluZGV4ID0gY29udGFpbmVyLl9jaGlsZHJlbi5pbmRleE9mKGNvbXBvbmVudCk7XG4gICAgICAgIGlmKH5pbmRleCl7XG4gICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShpbmRleCwxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fcmVtb3ZlKGNvbXBvbmVudC5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBjb250YWluZXIuX3JlbW92ZSA9IGZ1bmN0aW9uKGVsZW1lbnQpe1xuICAgICAgICBpZighZWxlbWVudCB8fCAhY29udGFpbmVyLmVsZW1lbnQgfHwgZWxlbWVudC5wYXJlbnROb2RlICE9PSBjb250YWluZXIuZWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29udGFpbmVyLmVsZW1lbnQucmVtb3ZlQ2hpbGQoZWxlbWVudCk7XG4gICAgfVxuXG4gICAgY29udGFpbmVyLm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSAmJiAhY29udGFpbmVyLl9jaGlsZHJlbltpXS5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuW2ldLnJlbmRlcigpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb250YWluZXIuX2luc2VydChjb250YWluZXIuX2NoaWxkcmVuW2ldLmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb250YWluZXIub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKGRhdGEsIGxvb3NlKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkpe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW5baV0uYXR0YWNoKGRhdGEsIGxvb3NlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oZGF0YSwgbG9vc2Upe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGFpbmVyLl9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb250YWluZXIuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb250YWluZXI7XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4pe1xuICAgIHJldHVybiBmYXN0bignaGVhZGVyJywgeydjbGFzcyc6J21haW5IZWFkZXInfSxcbiAgICAgICAgZmFzdG4oJ2gxJywgZmFzdG4uYmluZGluZygndXNlcnN8Ki5kZWxldGVkJywgZnVuY3Rpb24odXNlcnMpe1xuICAgICAgICAgICAgaWYoIXVzZXJzKXtcbiAgICAgICAgICAgICAgICB1c2VycyA9IFtdO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gJ1VzZXJzICgnICsgdXNlcnMuZmlsdGVyKGZ1bmN0aW9uKHVzZXIpe1xuICAgICAgICAgICAgICAgIHJldHVybiAhdXNlci5kZWxldGVkO1xuICAgICAgICAgICAgfSkubGVuZ3RoICsgJyknO1xuICAgICAgICB9KSlcbiAgICApO1xufTsiLCJ2YXIgY29tcG9uZW50cyA9IHtcbiAgICBfZ2VuZXJpYzogcmVxdWlyZSgnLi4vZ2VuZXJpY0NvbXBvbmVudCcpLFxuICAgIGxpc3Q6IHJlcXVpcmUoJy4uL2xpc3RDb21wb25lbnQnKVxufTtcblxudmFyIGZhc3RuID0gcmVxdWlyZSgnLi4vJykoY29tcG9uZW50cyksXG4gICAgRW50aSA9IHJlcXVpcmUoJ2VudGknKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpO1xuXG52YXIgbW9kZWwgPSB7XG4gICAgICAgIHVpU3RhdGU6IHtcbiAgICAgICAgICAgIGZvbzogJ2JhcidcbiAgICAgICAgfVxuICAgIH0sXG4gICAgZW50aSA9IG5ldyBFbnRpKG1vZGVsKTtcblxudmFyIHVzZXJzID0gcmVxdWlyZSgnLi91c2Vycy5qc29uJyk7XG5cbnVzZXJzID0gdXNlcnMubWFwKGZ1bmN0aW9uKHVzZXIpe1xuICAgIHZhciB1c2VyID0gdXNlci51c2VyO1xuICAgIC8vIHVzZXIuZGVsZXRlZCA9IGZhbHNlO1xuICAgIHJldHVybiB1c2VyO1xufSk7XG5cbndpbmRvdy5lbnRpID0gZW50aTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG4gICAgdmFyIHVzZXJTZWFyY2ggPSBmYXN0bi5iaW5kaW5nKCd1c2VyU2VhcmNoJykuYXR0YWNoKHtcbiAgICAgICAgdXNlclNlYXJjaDogJydcbiAgICB9KTtcblxuICAgIHZhciBhcHAgPSBmYXN0bignZGl2JyxcbiAgICAgICAgcmVxdWlyZSgnLi9oZWFkZXInKShmYXN0biksXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHt2YWx1ZTogdXNlclNlYXJjaH0pXG4gICAgICAgICAgICAub24oJ2tleXVwJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbHVlKHRoaXMuZWxlbWVudC52YWx1ZSk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgcmVxdWlyZSgnLi91c2VyTGlzdCcpKGZhc3RuLCB1c2VyU2VhcmNoKVxuICAgICk7XG5cbiAgICBhcHAuYXR0YWNoKG1vZGVsKTtcbiAgICBhcHAucmVuZGVyKCk7XG5cbiAgICB3aW5kb3cuYXBwID0gYXBwO1xuICAgIHdpbmRvdy5lbnRpID0gZW50aTtcblxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgZW50aS5zZXQoJ3VzZXJzJywgdXNlcnMpO1xuICAgIH0pO1xuXG4gICAgY3JlbChkb2N1bWVudC5ib2R5LCBhcHAuZWxlbWVudCk7XG59OyIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpe1xuXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLCB7XG4gICAgICAgICAgICAnY2xhc3MnOiBmYXN0bi5iaW5kaW5nKCcuJywgJ25hbWUnLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsICdkZWxldGVkJywgZnVuY3Rpb24odXNlciwgbmFtZSwgc2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZWQpe1xuICAgICAgICAgICAgICAgIHZhciBjbGFzc2VzID0gWyd1c2VyJ107XG5cbiAgICAgICAgICAgICAgICBpZighbmFtZSB8fCAhKG5hbWUuZmlyc3QgJiYgfm5hbWUuZmlyc3QuaW5kZXhPZihzZWFyY2gpKSAmJiAhKG5hbWUubGFzdCAmJiB+bmFtZS5sYXN0LmluZGV4T2Yoc2VhcmNoKSkpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2hpZGRlbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih1c2VyID09PSBzZWxlY3RlZFVzZXIpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ3NlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKGRlbGV0ZWQpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2RlbGV0ZWQnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcblxuICAgICAgICBmYXN0bignaW1nJywge3NyYzogZmFzdG4uYmluZGluZygncGljdHVyZScsIGZ1bmN0aW9uKHBpY3R1cmUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBwaWN0dXJlICYmIHBpY3R1cmUubWVkaXVtO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSksXG5cbiAgICAgICAgZmFzdG4oJ2xhYmVsJywge1xuICAgICAgICAgICAgJ2NsYXNzJzogJ25hbWUnLFxuICAgICAgICAgICAgdGV4dENvbnRlbnQ6IGZhc3RuLmJpbmRpbmcoJ25hbWUuZmlyc3QnLCAnbmFtZS5sYXN0JywgZnVuY3Rpb24oZmlyc3ROYW1lLCBzdXJuYW1lKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmlyc3ROYW1lICsgJyAnICsgc3VybmFtZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLFxuXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHtcbiAgICAgICAgICAgIHZhbHVlOiBmYXN0bi5iaW5kaW5nKCduYW1lLmZpcnN0JylcbiAgICAgICAgfSkub24oJ2tleXVwJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHRoaXMudmFsdWUodGhpcy5lbGVtZW50LnZhbHVlKTtcbiAgICAgICAgfSksXG5cbiAgICAgICAgZmFzdG4oJ2RpdicsIHsnY2xhc3MnOiAnZGV0YWlscyd9LFxuXG4gICAgICAgICAgICBmYXN0bigncCcsIHsnY2xhc3MnOidleHRyYSd9LFxuICAgICAgICAgICAgICAgIGZhc3RuKCdhJywge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0Q29udGVudDogZmFzdG4uYmluZGluZygnZW1haWwnKSxcbiAgICAgICAgICAgICAgICAgICAgaHJlZjogZmFzdG4uYmluZGluZygnZW1haWwnLCBmdW5jdGlvbihlbWFpbCl7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ21haWx0bzonICsgZW1haWw7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3AnLCB7XG4gICAgICAgICAgICAgICAgICAgIHRleHRDb250ZW50OiBmYXN0bi5iaW5kaW5nKCdjZWxsJywgZnVuY3Rpb24oY2VsbCl7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ01vYmlsZTogJyArIGNlbGw7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIClcblxuICAgICAgICApLFxuXG4gICAgICAgIGZhc3RuKCdidXR0b24nLCB7dGV4dENvbnRlbnQ6ICdYJywgJ2NsYXNzJzogJ3JlbW92ZSd9KVxuICAgICAgICAub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgICAgIHNjb3BlLnNldCgnZGVsZXRlZCcsIHRydWUpO1xuICAgICAgICAgICAgZGVsZXRlVXNlcigpO1xuICAgICAgICB9KVxuXG4gICAgKS5vbignY2xpY2snLCBmdW5jdGlvbihldmVudCwgc2NvcGUpe1xuICAgICAgICBzZWxlY3RlZFVzZXIoc2NvcGUuX21vZGVsKTtcbiAgICB9KTtcbn07IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmYXN0biwgdXNlclNlYXJjaCl7XG4gICAgdmFyIHNlbGVjdGVkVXNlciA9IGZhc3RuLmJpbmRpbmcoJ3NlbGVjdGVkVXNlcicpLmF0dGFjaCh7fSk7XG5cbiAgICByZXR1cm4gZmFzdG4oJ2xpc3QnLCB7aXRlbXM6IGZhc3RuLmJpbmRpbmcoJ3VzZXJzJyksIHRlbXBsYXRlOiBmdW5jdGlvbihpdGVtLCBrZXksIHNjb3BlKXtcblxuICAgICAgICBmdW5jdGlvbiBkZWxldGVVc2VyKCl7XG4gICAgICAgICAgICB2YXIgZGVsZXRlZFVzZXJzID0gc2NvcGUuZ2V0KCdkZWxldGVkVXNlcnMnKSB8fFtdO1xuICAgICAgICAgICAgZGVsZXRlZFVzZXJzLnB1c2goaXRlbSk7XG4gICAgICAgICAgICBzY29wZS5zZXQoJ2RlbGV0ZWRVc2VycycsIGRlbGV0ZWRVc2Vycyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVxdWlyZSgnLi91c2VyLmpzJykoZmFzdG4sIHVzZXJTZWFyY2gsIHNlbGVjdGVkVXNlciwgZGVsZXRlVXNlcik7XG4gICAgfX0pO1xufTsiLCJtb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1bXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInNjYXJsZXR0XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkZWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNjcxIGNvdW50cnkgY2x1YiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZm9ydCBjb2xsaW5zXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZGVsYXdhcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTY3MjRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInNjYXJsZXR0LmRlYW40MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkYmlyZDYxOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2lyY2xlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlRPeXVDT2RIXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMmQzZTBkYzAyMGE4MjY4OTgxMDJjNmVjZjhiYjYwZTJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDFiYThlY2JmM2ExMzc5NDFmNGU4YjY2NTBmYjRiOWM2YWJjYTdmOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImQ1NmExY2ZkYmNhZjNhMjhlMTdlMTBiOGNiMTFjZTAxOGI0YmE3MzBiYzViYmU3MjBmNjE3NDUxZjM2YThlY2VcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI1NTI0OTkxM1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMzMzI0NTA0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTAyKS0yMTAtOTM1N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDU3KS03NjktNzY4OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY3Ni03My05NzY2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3MmRiZjcyZmNjZTM1YmRmXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1hcmdpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2FyZFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjU0NCB3IGRhbGxhcyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibGFuc2luZ1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1vbnRhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjE4NThcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1hcmdpZS53YXJkMjhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnRpZ2VyNDMzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJoaWhpaGlcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiOENkNnl5cVRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjZDNmMjkzMjhjZjQzN2MxMTFjMTk3YmFiMTYyNzcyOVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4YWZlMjY1OTZlMmEzODlkNGVhMGZmYjM2NjE5MTBjMTRiYTgwZDI4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGNjOGY5Nzc1ZTZkMWZkN2FkMzhhZjk1NTk5MTJlYWEzMjY3ZDgyMmExOTI0ZDA1MmNhMGJiNGQ0N2RhMGZjZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MjUzMDg2ODZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMDUwNDc4OTRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNjcpLTUyNS0zOTM3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MjkpLTQ1Ny05MjUyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDA5LTQyLTc2ODRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzg3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84Ny5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjBkN2FjZmY2OGRjNTczNThcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhcm9saW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtaWxsc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDc2MyBob2dhbiBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbmQgcmFwaWRzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzUwMTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhcm9saW5lLm1pbGxzMTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxscmFiYml0OTQ2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ2ZW5pY2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZGI1VjJ0dWtcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkZjhjOWVmMDY3ZDEzNWMxN2I0NWMyZDUwOGE5NzcwY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4ODUyNmVkNDU3OTNhYWI5YWI3ZjMyMmE5YWYxMWE3YThmN2Q2MDFmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2E5N2JhN2U0ZTZhMjVkMGZlYjMxMmQ0MDc5ZTg3ZmY3YTU2ZmU5YjAyYmZkMmIzZDQ0MzI2MDQ4ZmI3MmY2ZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjgxNjUyMjA0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNjM3MjM4NThcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyMzcpLTUxMi02NTUxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1NTYpLTg2Ni00ODk4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTQwLTMzLTY1NjlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImU5YTU0MTcwY2MxZjNjYWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrYXRoeVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGVycnlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQyMjIgcGVjYW4gYWNyZXMgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImN1cGVydGlub1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInBlbm5zeWx2YW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5NDQ1MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia2F0aHkucGVycnk5NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93a29hbGEzNjBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZyZWV6ZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJHZGZwMDMxc1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjRhOTMwMDU2NGQzYzQ3YzQwNDYzOWQzYTJiNTk4M2UxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjBiNTFmODFiMTZhMTZhNmM4ZTc2YTc5YWEwMDdkYzIyYWQ3ODcyODdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmZDRiNzcyNGIzOWRjZWU3NDRhMjYwMjU2NTc3MTBkNjczMjVjN2M0Nzk3YzRjMGE5ODE3ZmFlN2M5NjMzYjczXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjE0MTE0OTk0NzNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTgxMzkzMjBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MjIpLTMxMS05MzY4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MzkpLTMxMC00OTYwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDg0LTUyLTYxNTVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zNS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjA3NmZlMjg0N2ViM2M3OGRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWFyaW9cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm5ld21hblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDMwNCBwbHVtIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJuZXcgaGF2ZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJyaG9kZSBpc2xhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODA0ODZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1hcmlvLm5ld21hbjc2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiZWF1dGlmdWxmaXNoNDgxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhaWtpZG9cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiT1E4d3RscWdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5MzNmNjk1YTI3ZTBhZWNjNDBmYzM1M2ZkYmJjYjM2YlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmMmU2ZTE5NGRjMGQ0MWQ0MGYzMDFjYzc1OWQ4NjdhZDJkZTVhNWZjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiODE1NTJiMThlNjcyYjJhZDA3ZGEwOTFkOTJkZDIxZjM3OTRiZGUxZDY4ZTgyNDI0N2U4ZjBjZDM2M2E4MGRmOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTQ2MDcwMzM1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTYzODc4NDgzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTI2KS0yNDQtMjQyN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTEyKS0yOTYtNzI2NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjYwMy05Ni04NzAyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxYzkzZGQwZjU2MDQ5MTFlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm5lbHNvblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwia2VsbGV5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NTM0IGUgbm9ydGggc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyZWVsZXlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjY3OTJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm5lbHNvbi5rZWxsZXk0M0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWxhZHlidWc3MjVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhcm9saW5hXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlBnVVMyaklRXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMjY3MmVjZTAxODA3OTQ2OTc3Mzc2MzMyODU4NmM4YTdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMGUwZGY0YTYwYmZlYmZiM2E0ZmE4NzE3NDliNzYxYzlhNjM5ODg5YlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjVhNTkxZDhkYWE3YmM0OGU1ODRjZTVkOTBiYmRkZTJkYmNmMDc1NWYzZjc5MzljNzExNWEzNWRlN2FhMGEzOTZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTMxNjU5NzkwNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3NDQ0NDQ0MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkyNCktNzk4LTY5NDhcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDY5MiktMTE2LTgzMTFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3NzMtODgtNjk3M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2RlOTgxOWY0NjU0MzhiZFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJicmFuZGllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJsdWNhc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjMwNiBzaGFkeSBsbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGV0cm9pdFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndhc2hpbmd0b25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTU0MDhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImJyYW5kaWUubHVjYXM1NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkc3dhbjc4NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiam9hbm5lXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImtJNkpUR3JZXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2Q0NWQxZDQyYmRlYjc0ZGNkODJjYTc2YWIwZDcxMzJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNWZmYmExMTNjYjMzNGE2YmFmMWNhOWVhNmUyZWRkN2RjNmFlNDYzNlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImFlMmJkNTc2ZTcyYzJiZTBhODVhMDZkM2VlNTlhMDYzZmQ5N2ZlYWY4MzA2OGQ1MWQzMzg3YzkzM2MwZDcyYWFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIwMTk4MDA5MFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxMzk2MDE0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTg1KS05NjgtMTc3MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODMyKS00NDUtNzk0MVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU2MC0xMS0yNDc0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3ZjI0OWU0OGQ5ZmU1M2I5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm5pY2hvbGFzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3ZWxsc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTE1OCBlZHdhcmRzIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjYWxkd2VsbFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImluZGlhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTg2MzlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm5pY2hvbGFzLndlbGxzODZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2Zpc2g0MTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJpZ29uZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJoUUZFRjhRRFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjYwOTg1OGM3NTc0ZGIxNDE5ZGQ1YWY4NzdmYWNhY2RhXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjc3OTZmMjlkMjI2NTE2N2UyYTJlMDkwYThiNjUzMTFmM2IyYTVkY2JcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0OWVlZWFiMGI2MWUwYWMzN2MzZjAzYjdhM2JkYWI0OGI5YzExOGNmMDM4ODVhY2Y1NTc2YzNiMDE1M2MzY2Q1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwODE3NjAyODRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NjQ0ODEzNzlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3OTQpLTU2My01Mzg2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2MTIpLTQ4Mi04MDMzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjE3LTI1LTI5NTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi80MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdiNmNmNGI1NDdjMmRlMmFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0YW55YVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGF5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NjE0IG1jY2xlbGxhbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiam9saWV0XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY2FsaWZvcm5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0NzYzMVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidGFueWEuZGF5MTZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZXBlYWNvY2s1MzhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhc2hcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUEtjYVZvTzBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjYzBmZTMzMGVlZDQxMWFjMTQ3ZGUyMjZkN2Q1YTVhM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3N2FlYTg0YTYzYTg2YmM5MzIyNDhjYjBkMTgxYjQzZTZmMGZiMzkyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMzI0YWZmMzhiYTUyZTg3MDBlOTcxYjI0NDFkZWM3ODExMzJhZWJjMTE3ZmQyNmJjNWQzYmYwMmY4MWEzNTEyMlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjM1NzcyMDYzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiOTI1OTAzMjlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MjApLTkyMS02MTk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNDMpLTczMy05NTExXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODI2LTQyLTIwMzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzg1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQ5OTQzMDE3NjJiZGYwMTJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWF4XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJnYXJyZXR0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NTM3IGxha2V2aWV3IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJtZXNxdWl0ZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY4MjE0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXguZ2FycmV0dDM5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWNhdDk5MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwib3JneVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIwRkNtcGVBZVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImFkZmNlMDAxOWE5MDA0YzM2OWI2ZDVkOWY0MzM0Y2IwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjlmYTE4NTIzYTkyMzU1YTRiZjE4YjVlZGE2YjczNTc4MTAxMmU0MTZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkOTRmN2IyZmRiODYzN2ZkNWMyZDE5ZjI0YWQ4ZDhkZjY0NmQ2M2ExOWZkZjgxMTY4MGJhNTZkYjZjNmNlMDg5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzY1MzAzNTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNzkyNjM5NzRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NzUpLTI0My01NDM5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMjcpLTkzOC05MjQzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDkwLTk0LTg2NjFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzU5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81OS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjczMGM4MjgyNmQyZDhhMTBcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamVyZW1pYWhcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImFsdmFyZXpcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE3MDMgZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmVkIGJsdWZmXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibG91aXNpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjcyNjQ4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqZXJlbWlhaC5hbHZhcmV6NzhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZXdvbGY2NjRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJvYjEyM1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJmZXVFS0tUWlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRjNjY0MmI5OTFlMDRhYzgwMmRjZTM4OGU0OTI5Y2E0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjVlOGVmMDY5M2I4MTRkODBjMjE1YzdjMGFjMGVkMDA4OGE3MWY2NGZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1MGZhYmQ3NTJiYjJhNThiM2E2Y2I4NGE3ZDU3ZGY4OTQyYmVkYWRjNDdjMTcxNzYyODM1NWE5Y2E3MDRlMGE1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMTA4MDE1MDBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDMxOTg1NzhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMjUpLTU4OS05NzYwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NjEpLTgwNS0xMTU1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzQwLTU1LTc3NzdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8yOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImY3NzUyMWVmM2M4N2FjYzJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY29yeVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGF2aXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY5ODEgbWlsbGVyIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYmFrZXJzZmllbGRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvaGlvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUzMzQ2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjb3J5LmRhdmlzNTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVud29sZjkzNVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMTg0MzY1NzJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwick9mamxqaGdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJmYzE1ZDllYWY3ZWM4YmI1ZDJmMzMyZjZlN2YzNTgwN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhMDExMGUzZGJiMjI0M2QzODE1MTE3OGJjMjI5NGI1ZWJkNGZhNjNiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGNhMjczNmY2NDgyMDc2MTM0NmJkZTI4ODNmNTljMGRkY2Y4ZjdlY2RiNDA5ZTMyZDk3NGFkMzk0ZjMyMWQ3MVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjYzNTE2NjI5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM0OTg0MTMzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTQ1KS0zMzgtOTk3MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDQ4KS02MzItNTA5NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMyMC0zMi0yODMwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vODkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi84OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vODkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlM2I0MzhkNGQwYWY4YWY0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYWJpZ2FpbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JheVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjgyNCBwYWRkb2NrIHdheVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibWVkZm9yZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1haW5lXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE0NTQyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhYmlnYWlsLmdyYXk2N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnd29sZjcyMVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwid2VzdG9uXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkFGVUtHVnpFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMGYzNzk5YjA1ZDA4ZmU3Yjk5YTQ0YTk1ZjljY2ZjYThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNjRjOGE0OTNiZjA5MDU1NTBjN2JkMGM4MWE0Yjk2MmUwMmEzNzI0YlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjY2NGExZjcxY2JkN2NmNjk4ZWZjNTAxNmM1ZTVmYzQ4YTEzNTYwNTc0MWNlYWU1MmNhYTJlOTY4NjNkMDQxMDdcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3Mjk5NzY5MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3MTY1MDIwNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc2OCktNjQ1LTIzNDBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkyOSktNDQ1LTU1MjJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MzQtODctOTU4MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzA1NWJjODI3ZjBiYTA3N1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqZWZmcmV5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJydWl6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MzAzIG1hcnNoIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjbGV2ZWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJzb3V0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjI5NjdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImplZmZyZXkucnVpejMwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVjYXQzMjhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIndvbWJsZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtYzRXQnliWlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjdlYTUxYzcwZjBkZGU4MWJhNjU5MjFmZGJmMDcwNzg0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImQyNDBhNDZjZTUwNGY4ODgxMWQ3NDQ2MTAwNmY4ZjhmOGQwMTZhODhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjZmY3ZjM4NWUxZGJkOGRmZTBmN2ExNWNjY2YxYmYzYmJiNGNmMDM0NDVlMGQ2MjQ1ODM0YzgzYzNmNWM3NzA0XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzOTMwMjUyMDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MzQwODM0NDlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MTkpLTUxNC01OTczXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MDUpLTczOC01MTc5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjI3LTgyLTE5NTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjAyMmRhNWU2MTQ0NTk0YTZcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqYW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyb2dlcnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU0NzggdGltYmVyIHdvbGYgdHJhaWxcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2FzaGluZ3RvblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MzA3OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFuZS5yb2dlcnM2MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmVhdXRpZnVsbGlvbjQ0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJoaWdoaGVlbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ0S1l6QmJpRlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjc3ZWUyNjYyNDU5ZGY4ZTdjNWM3MTM4ZjNmYjdkMDZkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjZjNjEzMjI4YTA1ZDcwMjg3ZmNmNjY4N2FlMTQ0MTk5NmEwYzMzYzRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0NjUzZTk1ZGMzMTU4YjgzNTQ1MzZiY2VjNjg0MzU2MDg0MTA3MWY0NGQ4ZTNkNDI4M2EyMzIzMzI3YWU1OTcxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk0NzE2MTQ1N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjc1NzAzNzgzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzEzKS03NjctNTY2NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzIzKS00MTEtMTQzM1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU4Mi0xNS01Mjc4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4NjRlY2ZmOTkzYjFjNGJjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYXJpYW5uYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWlsZXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM2NDEgc3Vuc2V0IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFuZCBwcmFpcmllXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibG91aXNpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY5NTI4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhcmlhbm5hLm1pbGVzNTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImNyYXp5ZHVjazg3OVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmlnZm9vdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIyTWs3TnJ4UFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNhZDA2MTc2ZmZmOGU2ZGVjMzQ4YzJmMWUwNDAzOTllXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjdiN2IxMTAwYTRiNjg0OTk5M2EwY2E1NGZlNWY0OThmNjAwODYwZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwMzZhMmEyYzBlYjFjM2I3YmRlZDZjYWY2YjY1MGUwMmUyMDBlYmIzMDQ0NWFmOGE2YTczMWUxNjI0Y2I5ZTgzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwOTIxNDIyODRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NTk5NjM1OTdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjkpLTc0MC0yNzU1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxNTApLTQ5OS02NDcwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzk1LTcyLTYzMjFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yNy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjg3ZmZkZDUxZDYyMTE0MmFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidmlja2llXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjYXJwZW50ZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM4Mjkgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJvYW5va2VcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3eW9taW5nXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYzODIwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ2aWNraWUuY2FycGVudGVyMTBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd3BlYWNvY2syNDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImxhbmNpYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJuZExVbUlQSFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjVlNDkzZjM4YmEyNjc0MTgwMWUwZGY4OGM2YTJhZjE0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjBlNmJmYzhjMDcwMThiOTlmZGQ5ODIwOTczYmRhOTRkNDE1YzUyOWVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2YWM0MGQ3ZjMwZTU1NjU4NGE3NGIwMTg5YmZmOTQzZGZjZjI1ZTYzNDMyNTQxZTA1Njk2Mzg1YzBjMTEyOTc2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNzQwNjEwNzRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyODczMjY2MTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzNDYpLTM5NS03ODc2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMDYpLTY0NS0yNzA4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjgwLTI0LTIyMjVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi82NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjBjN2NiMTRmMWY4ODc4NzdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYWxsaXNvblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwib2xpdmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NTg2IHBsdW0gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW50cyBwYXNzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IHlvcmtcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODkwMDhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFsbGlzb24ub2xpdmVyNTBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVwZWFjb2NrMTE5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtYW5nXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInlLZmk2TXRTXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZGU4ZjQ0ZWU0NTlmOWM1MWQ4OTQ5YWFmMWViZjAyMzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjIzYjIwMWZiMDZkYTBlM2Y2Njg5YzU3NzY1MTY3Y2FjNThhYjgyNVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImZmY2QxZjlkNjRjYjhmMDA3NTczM2JlNjkxMmViYTVlMGRkZGJhMjVjNTI3MWViZDM0NDc1Njc3MTRjYzU3NzlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE2NzE3Nzc5N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQyMTQyNjMwMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgxNyktMjczLTk3OTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDI0NyktMjg5LTk3NjVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MDQtNzEtNjk2OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODM4NDYwMDBlMTNmMmY0YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRlYW5uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJiYXRlc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzQxNCB3IDZ0aCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXZhbnN2aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTUwNDZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRlYW5uLmJhdGVzOTZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZWtvYWxhNjg1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJnaW9yZ2lvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInNoS0NEQ1cwXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZmNmYjNiOTNhZmEwZmYzMjE2MGIxOTNjMGNiM2YwMzhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDQ2YTZkYzMwNDBlNWRmYTk3ZjZmZTIxZDgzYjcwZjVhZmJjYTJlOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImQzMzE1ZDY2MDAxNzNhM2YyYmE1ZmYwMjBjOTljNWIwNDBiODg5ZDM0OWJmODMwODM1MmZiNjgyZjM3YjZmN2ZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1MTExMjY0N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI1OTQ4OTA0MVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU5MiktMzU2LTMyNTFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDY2NCktMjM1LTQxMjRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NDMtNDMtOTczNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOTNmODg5ZTUzZDE0MDYzNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWlsZHJlZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZnJhemllclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzAyNiByYWlscm9hZCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYXJ5bGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MzU3N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWlsZHJlZC5mcmF6aWVyMThAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRlYnV0dGVyZmx5NTcxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJob290ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMGVGcEZXV2hcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0NTIyNTExODEyYTFlMjBiZWVhMDNhMjU1ZGRjNjkzNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMzI4NjJmZWUwNGVlMDYxM2NiN2I2ZDhhNmQwODYwNzJmOTdhOGNlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjMzMmUyNzhiMzQ4NmRmMDRlY2U0MWFiNzYxYzRkZmViY2I4NzNiNjI4OGU3OWMxNmRlYTYxZjg3ZTk4YTVmZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjM0OTc4MDAxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjk1NzI4ODc2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDMzKS0yNTQtODA2NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDAxKS0yNDAtMTU1M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU1NC0yOS04MDE2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiMzExNDU5MjE0NGM2MWVjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibGVvbmFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdyYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjUyNTMgbWlsbGVyIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXZlcmV0dFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM2MjI4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsZW9uYS5ncmF5NjNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsYWNrb3N0cmljaDc5NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2xpcHBlcnNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZlFqV2tpT3lcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiNTczNDBlNzM1ZjdiMDk4NzQ4MWVmYjM4ZjQyMGM5OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1Mjc0YjA4NDljMGVhZDhkZWVmZjBiZWE3OWJjZGFjOGE3NmM0YzFhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMGNiOGUxNWQxMzE3OTcyZGEwOTZjMzFiMTk4YTE2ZDYzOTBkZThkN2YyNGNlNmIzNGVmOTczNjVhY2NlZjM4NFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjM5ODcyMzg4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTUzMTYwMzEzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDgwKS03MzgtMjQxNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzMzKS00MDctMzM4OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcwOS0yNi05MjQyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjOTNlZjIyNmMyZjA4ZWE2XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImtlbGx5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtb250Z29tZXJ5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NzYyIHBhZGRvY2sgd2F5XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzdG9ja3RvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImthbnNhc1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MTkyMVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia2VsbHkubW9udGdvbWVyeTI5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJicm93bmxhZHlidWc1MTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInBvc3N1bVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIwRFByU28ya1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE4ZDgzOTkxMTJkNjU2OTIwMTNkNGE3OTM1MzZiZjc0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImVkNTAzZmVkOWMzMzA0YmVjZWQxYWM4Y2JjNmM3MjkyOGZlMjgxODNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIzMjM1NmQzNzE3MTJmODYzNGY2MWRhZjc5MDZlNWFjYjZiOWJlZmVkYjIzMzQ3MTJjZTQ0MDU3NTlmYmZhYTcxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExODA4NDk2MTVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNzYzMjUzMDhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NDQpLTYxOS05NjYzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3ODUpLTc4Ny05ODEyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjM4LTk2LTcwNzNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjYxYjQ1YzExOTQ3YjQ5MThcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9nZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImtpbVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjU1NSBsYWtldmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZnJlbW9udFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1vbnRhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODg5MTVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvZ2VyLmtpbTU5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJsaW9uNDQzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqaWxsaWFuXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIll0eUZOS0lUXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTQ2NzA5M2RlZWEzOWEyMzcyZmYwNjIxZTNjNGE3MzFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiM2NiZmMxMmE3MmU5YTQ2NTI3ZTZhN2RiNzAyYjhmYzBhMmYxYzRiOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIxOWRlMGFkY2RiY2ZhNjAyODgzYTI0Yzg1ZjUzNjdlZmU0MDJkODNjZWUwOTA1YzAyYjBmMWFmNjZlY2NjNGFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTMyNTYzNDk3NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI0MDg2Njc1NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDczNCktNzYyLTYyODdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU0NSktODA4LTQ2NzdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2NDQtODEtMTExM1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTU1YTZmOTZlZmJmMjE4OFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbWFuZGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZsZW1pbmdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM2MzYgdyBkYWxsYXMgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbmRlcnNvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInNvdXRoIGNhcm9saW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM1NjMzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbWFuZGEuZmxlbWluZzcwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiZWF1dGlmdWxvc3RyaWNoNTkzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzbWl0aGVyc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJNTXN1ZWU2TVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjA4NWY5YzQwZGJiNjM3MzdiMDc5Njg5NjcxOWI2ODJjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjFjOTM2OWYyNTkyNmUxMDZlNjFlZGY3MzZiMDFjMjU1NmUzNDE1ZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YzEwZDI4ODdiYTFjOGM5Y2E0Y2MyMzU4ZmU4YjM1YzMwYTA2NGRkZjY2ZDRmYTdmMTgxZjQ3MjE2YTY3MTRlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNzk2ODcwNTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MzQ1MDQxMTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MjYpLTU4Mi03MzM2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMjQpLTU1NS0zMTk4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTQ3LTk2LTY5MjVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwYzU1OGZjYTY0YjkwNmFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZGVhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY3VydGlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxMTc5IHN0ZXZlbnMgY3JlZWsgYmx2ZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXVyZWthXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibm9ydGggY2Fyb2xpbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjU1MjlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRlYW4uY3VydGlzODNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsbGVvcGFyZDU0N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZGVtb1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI2a1g5RVdRaFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNhODE3OTlmY2JlY2ZmM2JlYzc3ZjUxZjgyMzM2NzEzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIzMGJhZjExYWU0MGRlMTQ3OTA5ZThkY2E1ZDQ4YTc1YmI2ZjFmOGRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwNWU3MTAxZjUwYjBhNTY1MTQ4NDI2NjJhN2Q1YjNiM2MyNDhkMzY1YmNlNWViODc2ZDZmYjEyNDMzNTg0M2RmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjE0MTg0NTA0MTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNDk5MTgyODdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyMjUpLTQ5Mi02NjIzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMzIpLTQ3Ni0yNDQ4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODI0LTI0LTI3NjBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzU2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjZkNzdkNTY5ZmYyOWZkOThcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ2YWxlcmllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJiZWNrXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNDMxIGNvbGxlZ2Ugc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInlvcmtcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrZW50dWNreVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMjM2NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidmFsZXJpZS5iZWNrMTlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVsZW9wYXJkMTA3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqYW1taW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUlkwemVLVjhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxNzIzMDY5NTBlZmY0ZGZlZmUzNGQxZmVkZDJkMWMwM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3OGQ2ZTY4Y2JjZWIzYzg1ZjU1MzdiZDc5ZTUwNjkzMjc5MWViNjcwXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjBmMWFhNDI3ZGMzOGUxODhkNzU5NDBhYTQ2ZjljOTE3YjJkZTI5ZGQxYTM2NjYxZGI0MWIxMjFkNmNkNWEzOFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzcxMzM3NjM4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNzI5MjAzMTFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyNDMpLTc2OS00NzM3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NjcpLTIxMC03MTg3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzEzLTcwLTk4NzZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzkxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi85MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc1ZTIyNWE3MTMxZjhlYjRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZGFyeWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInNoYXdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM1NDYga2FyZW4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsYnVxdWVycXVlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid3lvbWluZ1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzODUwMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZGFyeWwuc2hhdzE1QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlZnJvZzU2NVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZmxhbWluZ29cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSXREMHIxV0ZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0OGM1MTI2MzMzMzI4ZDhlNWEzMzQ5MGZhNDM1MjAxN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxOWE2NGRkZWIyOWI3YWRiNjU0MDNhZjRjODNkNjk3ZDczMzQ5ZThlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOTRmZjJkMjE3OWEyMjdkNTk4YTVkYTQ0ODY4MThkYjlkNTQ0NTFkZmZlMDEyNjExNDZiZDAxOWNjZDc5NTJiMlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NDA0NTU4MTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxMTM5NTI1ODRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NDMpLTE3NC01NTQ1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNDIpLTEwMy0yMDI4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODQ1LTQ3LTI0NjhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImNiNTBlMTQ5MzVhMDI0ZjFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJwZWdneVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwib2xpdmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0ODI4IG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZsb3dlcm1vdW5kXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IG1leGljb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NzU0NFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicGVnZ3kub2xpdmVyNTBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsbGVvcGFyZDI0M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic3RyYXdiZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZkZpb2RmanVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2ZDgwYWJkMDJmMDAxZWFhNzVhN2M3MWZjMDI2NDU5NlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmODgzZDFiMmZjMzQ2NjYxZjVhYjgyNzRjZTMxNzZkNTZlMDgyYmExXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMmEyOWJiYjY0M2U4NmIwZjUyOWM3Zjg2MzZkMzNlNzViMjNmYzhiOTE3YzQ5M2RmMWVhNmFjNGUwM2E2NjliM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDQ2Mzc0Mzc2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDc0NTc1NTc1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzM0KS02ODctMTAyMlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzAyKS04NDItNTg0N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjUyNy01Mi0yNDc4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxN2RmMTlkYzhkMTM2MDYxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFsbGFuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyZXlub2xkc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTU5OCB3aGVlbGVyIHJpZGdlIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiZWxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImFsYXNrYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NDQ2NFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWxsYW4ucmV5bm9sZHM0N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwidGlueWZyb2czMDdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInZpcGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIktjQmF5UUdVXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTQxOWE4NDMyZjkxNGFkODkzMGZmOTllY2E1NWMwNThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZWFhZTI2YTc5N2JmNjhiODYzNjA0ZGNlMzJjMjBkYTRjNWI2M2UwN1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjczZWY2YzJjMWViNDhkNDUzMWMwNmU4Yjg3NDQxMjkzNmY2YjRlOTU3MDQyZjJjM2I1NjM3NWU2NTRiNTQwNzdcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE5MDIyNjA5MFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIwMDY4Nzc4NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDUzMSktOTEyLTIzNjdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg4MSktNDkzLTk4OTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNTEtODgtMTQ3OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmJhMWE4MmUxMjEzNGE0OVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInpvZXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhhcnJpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTgwOCBrYXJlbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2FjcmFtZW50b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndpc2NvbnNpblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MTcxN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiem9leS5oYXJyaXM4OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxmcm9nMjk0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ0aXR0c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJMY3JCcEN6T1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE5OGY0MzhkMmI0OWM2YmQzNWM3ZWJiOTRjNGFjYzhlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImU1NjA0MGNkNzc5ODFjNGIyZDAyNjYzZjVmYTRmOTFmYTIxODEyOGZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwOGI1NDQ4OTYzZGIyMGMwYmQ4NGU1ZjE5Y2RlYWViYTYxYTcwNGY0OWEwMjhmNjY5NmJiMGU2MjBlNDc1ODkyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjE0MDcwOTcxMzNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNDQ0NTY2NzRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjgpLTc4OS0yNjIzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMzUpLTgwNy02NTA2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTU0LTgyLTU1MzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzk1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi85NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi85NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQ3ZDVmMWFlOGNjMzE0NGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2hlc3RlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibHVjYXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI4MDMgdyBiZWx0IGxpbmUgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJlZCBibHVmZlwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImlkYWhvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU1NjU2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjaGVzdGVyLmx1Y2FzMjBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVkb2c1NjNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInBpY3RlcmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwia29manVCdmdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYTQ3NzlkN2NjZDdhMzFmNzg5NjJmMzc2YWMyYWU3Y1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhN2FlM2E2MjU2ZDY3NjUxNzhkYTkxMzIwYWY5ZTFjZGQ4NWQxM2JjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYTNlNmI2ZWJjNmNlMTAwNzMwNjlmYTAxNmU2ZGRjYTI2MWZiMDQ4OTE3NjVjZmRkMTEzNmE4YjhlNmEzZjAxZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NTAyODIzOTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNTIyODc5NjNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1ODUpLTExNS0xMTE4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NjcpLTMzMC0xNjg3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODczLTgwLTIzNTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi80Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzQ3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi80Ny5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjExZWFiMWZkZjFjMGFkNGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2hlcmx5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdXR0b25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjYxMTMgb2FrIGxhd24gYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb3BwZWxsXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzg0NzFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNoZXJseS5zdXR0b241N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiaGVhdnltZWVyY2F0OTUwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCI3MjcyNzJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVko0YnoxWEVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwOTVkYzVhNzkyNGY4NTBmODdiZjZjYjMzYzI5ZjgzMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJjZTYwMTFjYzgzNzRjMmIxMDlmYzIyMDVmNTYyOWRlNGIwYmQwNjBiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNmJmMzVhN2U1Y2MwMDI2ODY5ZDNiMmE5ZTA5ZThiYTM1NDFiMmIzZTA1NTE1Y2YxMWYzMmFjOTBlMmY2ZDY0NlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTA2MzM2OTcxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzI2NzU0NDIzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzE2KS0yNjctNTAyM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDkwKS02NTQtNTY5M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0MC05OC0yMjY0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzMGVhZmVmMDVjYjI4MmFjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImpvcmRhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGFtaWx0b25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg2NzAgcGFya2VyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJpb3dhIHBhcmtcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJwZW5uc3lsdmFuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTA1NTBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImpvcmRhbi5oYW1pbHRvbjk3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJicm93bmZyb2c3NjhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInBvdW5kZWRcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibG1SZjc5OXdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1M2M4OWQzM2VlM2FlNjM3ZDMyNzJjZmRkMDMxNzBjNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0ODE3ZThjODc1MjBkNmFmODE5YjM4OWYxMjYxMjc5MGE3Y2NlMzJmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiODg5YWRlZGVkNmJmZTEwYzg0YjMzMDM5ZWI2NjU1MGRlY2MzZmE5MGMzMzUzYjVlNzlmNTMxMjk1Y2IyOGI3ZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTYxNzMyNTExXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDI3ODAwNzYyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDgzKS04NjAtODA2NFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDg2KS03NzMtMzcwNlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU1OS0yMC00ODk5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI5YmY1YTViNWYwNDExMmQwXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZ2VuZXNpc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZmxldGNoZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU5MjIgZGVwYXVsIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldmFkYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMTE2NFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZ2VuZXNpcy5mbGV0Y2hlcjU0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJyZWRjYXQ5NzJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImxpbmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwic2Z0RGlsWFBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiZGExOTU1NDA3Y2M4YTk0YmY0MmE4OGNiNjFlMDAzMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3ZmM0OGRjMDZiZjU1ZWI2NWU0NjYzNTAzNWZiM2YwNThmYjM5MTQ4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZGZlMTBiM2Q1NWQ2N2FkZjgzNWQzY2M0MDhkYWRjMTk1OWM1MTg5YzkyNGQzYjU1NDAzOTYyMGEyOGRhMGE5NFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDcxMTQ0ODE2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNzM1MDM1MzRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MzYpLTc2OS00ODYxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MzApLTkyNS00MzY5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjUyLTQ1LTg2MzJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQxMWU5MDk3NjdjZTVkMzJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidG9kZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic2ltcHNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODczOCB3IGJlbHQgbGluZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZm9ydCBjb2xsaW5zXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29sb3JhZG9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjQyNDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRvZGQuc2ltcHNvbjM0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGNhdDMwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJkcmVhbVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJsSmtWUmFTd1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImFiZWU4YjMxZjE4MTEwYzk3OGMwOWY5ZThkNmQzMDA2XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjRkNzAxMWFiZGY0ZDNkMzBhODA4ODY2Y2NmODY1ZDQ2NGFlYmM2NjVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3MmY2YWNlNTkyNzdkNzUwZDE1YTc0ZDhhODQ3OGJhZjcyOTAwOGJiMWU2ODBlMGE1OWFmZDNjMmM5MWNiOGRhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk2MjY2ODEwOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMwMzA5NDY3MVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ1NiktODY5LTYzMDBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc4NSktMjkzLTUwMTJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NjQtNzktNTg4N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDMwOWEzY2NmNTAyOTNkYlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJsdWtlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtb29yZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzIzMiBjb2xsZWdlIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkdW5jYW52aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9yZWdvblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxODQwM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibHVrZS5tb29yZTc4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlZnJvZzU0NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaGFubmFoMVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJTMTl6OHhBV1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQ4Nzg1NTNhZWNlZDMyMDg2ODNmZTAzZDdjN2M5NzZjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjMzYzE1YjBjYjg5MGRlZjQzMzc3OGUwZDhmYTMyZWU0ZmU5NzQxZjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIxYjM2ODZmNmM2YzJkZjM3NDAxNGQwM2E0MGUxMjJjZDJlNjY4ZjQ5ZjZiNjI0NDJlNWE0NWJlOGUzZGJjMDA2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzQ3MzMyNzRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMjUyNjg1MDRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NDkpLTcyOC02ODExXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3NzApLTM2MS04NzcxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzI4LTIyLTc1MDJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xMy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjEyNTI1YTU4ZGFlNTkxOWJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibG91ZWxsYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYWRhbXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjgyOTYgZGVwYXVsIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyZWQgb2FrXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibm9ydGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjIyNTM5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsb3VlbGxhLmFkYW1zOTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImNyYXp5cGFuZGEzNTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNwYWNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInFaWVJNTlQzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiM2YxYzA2OTczMDAwYTgyNGE3NzBkZDhhODdkNjExMTBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMzEwMjRmMWE5NmFhNDgzYTE1YWM1NzZmNDgwNzk3YTMzOWRkMzNiNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjZhMjQ5YjYxZDQyNDM4NmVlMDJiN2Y0ODE3Njc4ODA2NmY1ZDgxOTVlNDYzYzMzNWE4OTFiNmQxOGRkOWVmZWRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM1OTgwNzM4OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQzNjY1MzEyNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg5OSktMzU3LTk3MjBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQxMCktMjIwLTU1NjJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzNDMtMjUtNzE2MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzc2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzU4MjRmNzE5ZmFlMWVkOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZXJpa2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJleW5vbGRzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3OTgwIGRlcGF1bCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29sdW1idXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ0ZW5uZXNzZWVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzIzMzVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImVyaWthLnJleW5vbGRzODlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpY2tsaXNoZG9nMjFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImtlbm5ldGhcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUmV5cXd5NkNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJmYjdlZTcwMTIyZmJmYzcyYjgwZGVhNmU4NDk2MGE1NlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJiYTNmYWI2N2Q5NzRhODljMmI0MGJiNWUyNGY0MGI2N2M0NDRjZWJhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjBhNGI4ZTAzOTAwZWEzZTBmYzIyNDgxZmUzMDFjZTIwM2I1YmU3YTY3OGU4N2FhMGIzMzNjNTE3NzgyZDY4ZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzYyNTY5NDYwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNTM5NjUwMzlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MTEpLTcwMy01NDE5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzOTIpLTQ4Mi0xNzE5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTc2LTI5LTgwMTVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzEyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjZkZGE5YTlmNTYxNDUwM2JcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZXVnZW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJvbGl2ZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY0NjAgYXNoIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkZXNvdG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJwZW5uc3lsdmFuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzczMDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImV1Z2VuZS5vbGl2ZXI1MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93ZWxlcGhhbnQ5MTJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjAxMjM0NTY3XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjdUZlBsUEpNXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMTU1MTVhMmMxMmY4MjkxYmY3ZWIyMzMwNjgwODVjZmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTc2MDliNzdmNjFlNTQ5MjAxZDU4OTdlYTJmMmJhZDQzY2RmMDJmOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNmOWY3NmZjOTA5NjhmY2ZlZmU0YzllYjc3ZmY4YWZkNTZjMzU2ZmYwMWNkYTJjYjlkMWQ3OTM0MjM4MmU1MTVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA3NTM1OTI0MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjk1MzUyMDAzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTAwKS01MjItNDY5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTk4KS00ODktMzY0OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE3Ni05MS0xNzIyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMjYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2YzJhMDU0N2RjODk3Y2ExXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImtyaXN0aW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhhbnNlblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDYwNyBmaW5jaGVyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJtb2Rlc3RvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibm9ydGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg0Nzc5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJrcmlzdGluLmhhbnNlbjkyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dnb3JpbGxhNjE2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIyNzI3XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlFMbUtGdWxqXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDEzMTVjY2JmYmY2NGI3OTQ3MjMyMGJkMGYzZTA2M2ZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZTIxOTFiZjZkMGZlMzdiMTBiNWQ5NjU3YzFmYmZmNWEyNzFkMGZlOVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ2NzgzNmU4YjFhNDgyMzdiZTRiOTc3OTlkY2Q5YjFkYmExMDJmMzYzNmM2MjNjZTg4MGY3OThkZTA0NjU0M2RcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI1NzU5ODM5OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjU5MzAzMjEwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTg4KS02NDgtMTE2M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTkxKS00OTUtNjU1OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjUxOC0xNC04ODYwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkNDgwZTZkNzFlOWNhZGY5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFybm9sZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiamltZW5lelwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjczNiBtaWxsZXIgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGJhbnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhcmthbnNhc1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NTMyOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYXJub2xkLmppbWVuZXoyMUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyZ29yaWxsYTQ3MlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic2t5ZGl2ZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLSlBLVU96QVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjRmODExZGFmNmM3YTQyMzEyYThkMTlmNDY4ZDM5MGY4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjc4NTg5YTEwNWM4MGFhNTBiYTc0YjEyZDBlZjFjNjUxZGMzNjVmYjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiZGNiNDUxMGI0OGU2OTMwODBkMWUyZDY1NzllZTA3MmZjYmIyMWMyMTJiYzliMmEwY2FhMjM2OWRjNzc0MzgzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTc2MTk5NTZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNjAzNTc0NzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2NjYpLTc3NS0yMjUwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2MzUpLTk4OS00NTQxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTg3LTgwLTM2NTNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImM2MDQyOTRmYmM4ZTUzZjdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW1lbGlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyb2RyaWd1ZXpcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI3Nzkgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNoZWxieVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pbm5lc290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3NDg1M1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW1lbGlhLnJvZHJpZ3VlejM4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWtvYWxhODU2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzbm93YmFsbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJTU9nOFpkb1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjdiYzcxNWI3ODY5ZWFmMmZiODdjMDU2YmQ3MDM4OWY1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjkwMWVjYmUwYmEzOTZjOGMyMDQ4NmNhODU3Njg1OGNmZDVlOTQ0YzZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5ZGFkZGFkMDAxZWVkYTNhZjc4YjA1M2ZlOGQ2MTE5OTMwZDJlMjUyYmMwZThmODBjYzYxMjlhNjNjMTY0ZDM1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwODYzNTAxNTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTkyNDM5NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ1OCktNDA5LTM3NzRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk1NCktNzgwLTgwMDRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MzAtMjQtMTI1MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vODcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzg3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzg3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmUxMmQ1MWU5ODA2MDg4NFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXhcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhlbnJ5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNDk2IHBhcmtlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVtYXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrZW50dWNreVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MjM4NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWF4LmhlbnJ5NTFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlrb2FsYTQzMVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibGl2ZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIzRU9LaVBkYVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjkzOTY0MzM4OGVkZWZiZTQzNjVmOWEyMGM5YjlhNmJmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjk0NTA2MjZiOWJkYjEyODhhMDZlZmU2ODA1NGI5MGE5YTE2MWFhMjBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjYWUwMmYxMjliMWZjMjgyMmQyZGNmMGIzNzIwNjI0NTdlOTFlZjI1OTUwMWFiMmZmODMwNTQ2ZWE1N2VhYTMzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNDU3NzAyMTFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODYyODE0NDlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3OTApLTgyMi02ODQyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNTEpLTc3Ny01MzExXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTExLTQ3LTI5NzNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdkZGZkN2U1MGMxNzkwYWZcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwid2lsbGllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwYWxtZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjYzMDIgYm9sbGluZ2VyIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkZXRyb2l0XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2hpb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NjMxM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwid2lsbGllLnBhbG1lcjU5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmdhbmljZ29yaWxsYTUzOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYnJ1dHVzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkpJNlp5S1ZTXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMGQzNTYwZWU1MTJhZDE2ZWVlODNiMTBjYzNkY2VlZGVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDcxNzI4ODFjODljMzFiZDZhYTczZTY4MDc0YmY0NGNhMTMzNDRiNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjY2MGZlNWFjNDQ0OGFlYjJmMDczZTQ1ZDJiNzc3ODAyMWRjM2M3YjU3ZTUwZjI1NjAzNmUyOGQ1MTU3YmNmMzFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA0NjE4OTEzN1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjM2NzY3NDIzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzE0KS03MDEtNzkxM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDQyKS01MTAtMTc3NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc1Mi01Ni01NzM2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiN2UyMzUzMGY1MTExM2FhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInR5bGVyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjb2xsaW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3NDc0IGZhaXJ2aWV3IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ0aGUgY29sb255XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFyeWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjgxMTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInR5bGVyLmNvbGxpbnM4MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlY2F0NjA5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwYXJyb3RcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibzVIcE1MRHNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjMDIxOWY2NGVlOGI3NTdjODhiYmZhNmE2NDA1OWE3MFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhMjA2YzA3ZjQ4ZWY0MmUwOGUxZDAwYjc1ZmUxNjIxN2VkZGM2NjJmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGQ4NDljZmZhNjRmZWFiMWExNjIxOTU2Zjk1M2ZhOTRkZmI4NGJjNzM4MjU2MDUyZGNhNmU0ZTJjZTg1YTkyZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzQ5MjMzODQ5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTc0MTEwMDMyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODk3KS0xMzItODIzNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjE5KS0xNzMtOTQwMFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU2NC01My00MjEyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiMDBiZTA2MzRkOTMzZDkxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImZyYW5jaXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImFuZHJld3NcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI3OTggZmluY2hlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVsZW5hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ4Nzk5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJmcmFuY2lzLmFuZHJld3MyNEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWJlYXI3MzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjE5NjlcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSWs2ZHh5cjVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2ZjVmMmRhY2I2MzJjYzc0OTkyYTgxOTZkYjQwZmZjNlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJjYzNhZTVhMjUwMzA3NGZjNWMzOGI1MmY0NzQ0Y2I4NWE1ZjM0YzYzXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjkzNWUwOTdkMGIyNWYxZDRlODE2NmVhOWQ5MTZiYTdlZDBlMGZiMGJmNTg0OTRjNTY1ODczNTA0ZDc3NzNkYlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTQ4MTI0MzY5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTY5MjU1MzQ4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTY1KS03NjctODAxNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTM1KS00ODQtNDQwOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkxMy04OS01OTMwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI1ZjMwMDJjZjkyODg5Y2E4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWF4aW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoZW5kZXJzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI2NzUgZGFuZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2luY2lubmF0aVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1haW5lXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY5OTc4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXhpbmUuaGVuZGVyc29uMjZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd29zdHJpY2g5MTNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1hdHJpeDFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwialZQNGNGNUVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjMTk2MzMzYjA0YzlkMDc2MWNhNTE3MjUyMzQyM2E4N1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmOWZiNDVlYTAyMTMwMWEyNDg4NWI4YThiOTI2YmNhMTY5YWM4NzE0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGQ5N2ExOTdiYjIyNDBiMTZhODAxOTc3ZjJkMTFiNDAyZTZmYjRmNTI4MjEwNmE5MDRjOGYwM2NjNzMyMzA4N1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzMzNzE5NDMxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTE2MjI2MzQ0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTQzKS04ODAtNDkyNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDYzKS02ODYtMTkwNlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjYzMy0xMC0xMDAxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzZTI4NzhmYWJkOTE2M2E1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRyYWN5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJob3BraW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3MTY2IGh1bnRlcnMgY3JlZWsgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhhbXNidXJnXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidmlyZ2luaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDUwOTdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRyYWN5LmhvcGtpbnM2OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlbGFkeWJ1Zzk0OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSVE3bDN4N05cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYTc5YTJkMTVmN2VmZWFhMzYyMzZlMDcyMmNiYjVmYlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5YWNmZDVhMTNmMTNhZTY2MDk4OWUwMDU0YzE4NDBjOGJhMDY0M2RhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOGY3OTY2YjI1OTMyZGYxNjBjMzQ2ZjEzZDkxOWViNmJiZmNkNjU0ZTk2OTVjNmNmZWEzNzZmZjI5NzI3ZTAyMFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjAxMTcyODcxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDY5NDczMjMwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODI2KS01MjctMjkwNVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTg2KS01MjMtNjE0NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI3My0yNC02MzI4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhMTkwYTRiNDk2MTRhMDRiXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbWVsaWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm5pY2hvbHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU1NDYgYXNoIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyB5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY2MDIwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbWVsaWEubmljaG9sczY5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWxhZHlidWc5NTNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm9iaXdhblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJGRDJjWEhWaVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImU5MjY0YTc5YzNjZDI4YmRhOGM0NjQwZGQyZWQwYjBmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQxOTQyMjI1NWEzZWFjZGQyNzdmZDA1NTUwYmY4MWY0YzE3OTM1YjdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5YzRlNTdiMDRjZGE5MzRjN2VhODQ0YzBkN2FhNTQ1OTBmNTFkNmFjZDUxMmQ1YzcwMWI2NTE2YzE0ZWVmOTA2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNjg1MDMwNDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxMTAzODc4OTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2OTkpLTI5OS01Mzk4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3ODcpLTIzOC01NDAxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjE4LTIwLTg0MzBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzkxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi85MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjg0ZWQwZTRmZDg0ZThjMGNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYXVicmVlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwZXRlcnNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODU4NiBlZHdhcmRzIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjYXBlIGZlYXJcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgbWV4aWNvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUzMjEwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhdWJyZWUucGV0ZXJzb24zMUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnZHVjazkxMVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2FyYm9uXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImEyZDU2YXZRXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNzZhZGUwZDA2ZDEwYTA1YWFiZjQyMTJkMTM4N2M4NThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiODRiZGI4MGI3ZTQ4YTZhOTE2NGFmOGUwMjdmMGNmOTQyMGE0ZDljMlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjJiZDA5MDE4ZTQ3YjViODc2Zjk4NjcwODg3YzAzZDE2ZTgyYjkxMzVlZDhlNjgxNWU3MWJjYzA4Y2M4ZWMxYjNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTEyNDM5NTI3N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIzMDc0OTE3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTI2KS01NDgtMTEwNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDA0KS0zNTYtMTI1MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgwNC0zNS03MzkxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI0NDZmNGIyYzIyMGM4YTVlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqZWFuXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJwZXRlcnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQxODEgd2FzaGluZ3RvbiBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJlcm5hbGlsbG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpbmRpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc3MTI4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqZWFuLnBldGVyczk4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJlbGVwaGFudDMwM1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibWVhdGJhbGxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwid1c1OWYwUnlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiNzc5YWZkMzc5OWY3YzlhYzlkYzVlMWZjOTcwYWYyZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhZjVkMmY4MjBkNTAzNDRmMDE4OGEwNGE4ZmNlYzM2ZDZjNDEwMWNhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZDM5MGJiMDBjNjZhMGMxNDEwM2EyODA3ZjYzMjE0NzVhYjIyZGQ0NWY4YjIwMTY5ZTNmOTIwNjU1YzUwYjBhNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDAxOTcxNjUzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjcyMTk5NDI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzczKS00MTktMjc5NFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTk5KS0xOTYtMTI0OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyNi0yMy00NzY4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmZDA3NTUwZWQ0NzBlMjM0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2FtaWxhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGFubGV5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NzY5IGh1bnRlcnMgY3JlZWsgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJpbGxpbmdzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2tsYWhvbWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjQyNTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhbWlsYS5zdGFubGV5ODZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdvbGRlbm1lZXJjYXQ1MDVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImp1bGVzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjVnNjBtN1BCXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNWI4ZWMzZGY2ZTJjZDBhNDQ1YjVlMjRlZmQxOWI2MGNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZTU0ODFkZjY3Mjk1ODU1MWFmYmQwYjRlODAxY2E4YzVhMjIwMmVhY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjYwYWIyYzkzMTlmOGVkZDBmYzJiZmZlZmJjNzQyNjBmOTAyZjQ0OWNjYTM4NmI2YzE3NzMxZDY0Yzg4NGEzZGFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM0MjYzNjY5NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE1MzYxMDc1M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkyMCktMzMzLTUyNjlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDM1MCktNjUyLTQxODJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MTQtNzUtNzI4M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzExLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzA2Mzg1ZTQ3ZWZlZDBjZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidG9ueWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImpvcmRhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzU3OSB3aGVlbGVyIHJpZGdlIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmbG93ZXJtb3VuZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9rbGFob21hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU2NTEwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0b255YS5qb3JkYW4zM0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWZyb2c5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwcmVjaW91c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJXZE1Zc1lEZVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjAyZmQ1ZjczMzA4MjZhZjMyZTJhNDEzODQwNzdlZGY4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjFiNmU1NDkwMTYxYWIzZDcxMmQ5NDYxNDEzZDQ0NDRlZWU0OWMxYzhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiM2E3YWE0MjU0OGRiNWI2NWRiOWZkNGY4ZWQzNTJmZDJkMDEwMjU4ODFhMWFlZjA3OGY1NDBjZWIyY2M4MDg1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMzE4Njg4MDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyOTI1OTY5NTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxMTIpLTg4OS00ODc1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MDkpLTU1Mi01NTg2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTYwLTQ1LTY3ODJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjY2YTdiMTM2OTZiZTAyZGNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9nZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0ZXBoZW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4OTQ0IGdyZWVuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyb2NoZXN0ZXJcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJyaG9kZSBpc2xhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODk5NzBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvZ2VyLnN0ZXBoZW5zNzFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpY2tsaXNocmFiYml0NjM2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJicnlhbjFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiYUJYNGs1dldcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyMDZjOTBkZjY5MzdiOTczMjY0NmRlYjAwN2NlN2E1MVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0MTc2MmUzNzZkOTJkZmIzNGZmMjkwNGQ0YTcxZDQ4NzU2NjFkNTAxXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMWE2ZGVhODAwNmIzMGFkMWYxZmY3ZTljY2Y3MDIyZjc1M2RkY2NlZmFjN2FjYjY4ZWU3ZWQwMTRiNDYzYzhiMVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzYwMzI0NjA5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDEyNTYyODA4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDE3KS05NDUtMzc0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzEyKS04NzYtOTk1NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjUzNi05Mi0xMTg1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzNTkxY2U0NjZhMzc4ZTE1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImdlbmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhbGxhY2VcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjExMjggYWRhbXMgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiYWxhc2thXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjExMTA3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJnZW5lLndhbGxhY2U5MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWxpb24yNzZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImVtaWxpYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJWa2hLdGV1M1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE4ZjZiYTAyMzFhZTIzNmZiNzVjZmU2MzQ4Y2RjYThkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImVmMjhjNWRlMmE4MzUzYzU0NmU3YTA5YmJmMjBkNWZjMjViN2FjMWJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhYTg5YmVkNGYwNDc3ZWNmZTQxMTgxZTE1MmQ5NjIzYmM4ZDE1MjFhYTgxZDI1ZTJhODVjYjZhMDVjZjRkZTQyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNDQ0MTYxNTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNDE0NDEyNDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2NzMpLTM5My03OTMxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMzIpLTc3OS0yOTk4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjY5LTg1LTM2NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi85LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc1NThkNWJjNmU5NTIxZjVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJreWxpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGV0ZXJzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ1OTUgcG9wbGFyIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGJhbnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjYWxpZm9ybmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE3NjY4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJreWxpZS5wZXRlcnNvbjM4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja2dvcmlsbGEyMzBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInV0b3BpYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJuUTNUb3ZJRFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImIzNTg5NmEzYzY1ZTk1NTdmYWI2ZTBmMjJhMjA1NDBkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjAyYzJkNGZkMGMyOWVhMDA3MDAzZWY2MzhiZjVkMzg3ZTg5ZjZkZjdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0OTZmZjBkMzNiMmFjYjE2MmIxNGMyOWIzNmI1NTdiZjExOTc3MmRlZWViMGQ2N2UwZDY4ZDJlYzBlMzllNWIxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTc3ODE0NTJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNDc2ODUxNTJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzMzcpLTY2NS05Njc3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1MzEpLTEyNy04NDg2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzcxLTY4LTg0NDVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjJmZWE5OGFmNzIyZDFmYjVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXNzYW5kcmFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhcmRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjYwOTcgZm9yZXN0IGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyaW8gcmFuY2hvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2Fuc2FzXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ0NzI4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYXNzYW5kcmEud2FyZDQ4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWdvc3RyaWNoMzY2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCI1NWJnYXRlc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJWeDQybnJmMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjY3ZDUyYTZlMjI2NGExYTAyMWM4NDI2MTQyMDQ0MzM1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjJiYTg5NjVjM2ViNmJhMWM2NDA0MTY2MTBhYzZkMGVmMGNkMmNkMjdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwMTY0MTRmNTIzNWIyZTJiYjk5NjcyZjU0ZjlkM2I2MzdhNGFkN2NlNGVkODJlZDVkODlmZTAyNTMxMjM2MzljXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNjUyMzE0NzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyODkxOTg5OTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MDkpLTU5Ny05ODQzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NjApLTM4OS02OTAxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzIwLTI5LTg4NTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zNC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjAyNTg4NTE1NDc0MDg0YzRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFteVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2F0c29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNjI2IGNoZXJyeSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWRkaXNvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImxvdWlzaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NDgwMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW15LndhdHNvbjcwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2Vmcm9nOTIwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhbmdlbDFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiQmhZSHdMUDBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI4ZjBlMmM0YTA2NTAwZmNiZjUzNjU3MzM2MmIwMDM3OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwMTcwOTQyMmUyMzQxZjFhYTUyM2EwYzg4YWRjZjFlYWFjYmY3YzE4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMjFkNjBkNDY3YWM1YjBiNGFlZDA3NDIyNTlmOTliYzNkMTZlZGMwN2JmMTQyYjA5Yzg1NmQ4NjhmZGFkOWUzY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5OTU4MjY0ODhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyOTg2MDU1NzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyNDQpLTI5NC04NDI2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1NzgpLTIxOS05MTk2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTkwLTQ5LTcxNTJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImY5YmY2Nzk1NDczNzFlNjNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2FydGVyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkdW5jYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY2NjEgYXNoIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFuZCBwcmFpcmllXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IGhhbXBzaGlyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyMjY1OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2FydGVyLmR1bmNhbjY3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJoZWF2eWJlYXIyNTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInd3d3d3d3d3XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm1GazcyUG9ZXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmE5ZDc5Y2VlMTY0MDQxNTM3MWU2MDA2N2FiMzliYzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiODhjNzJmZDBiZDljMWFmODQ3YzBkYTkxZGUyMjVmNTM4MjFhYjMxYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImU1NTI4NmJjYjc5M2I3MWZlNDU1MTI2Mzg2ZWMwZmExZmUzOWJjYTgzMDI1YjExZjVkZTE4ZjVlZWQ1MGZiOWVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTYzNjU5MDkzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjczODQxMjU1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjE0KS05MjUtOTkwMVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODkxKS04OTMtMTkzNVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI5Ny04NS0yMDM5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMjYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2YTc0MGU2NTY2NDIwYWYyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFseXNzYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmFybmVzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTc3IHdoaXRlIG9hayBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibG9zIGFuZ2VsZXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpb3dhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkyMjczXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbHlzc2EuYmFybmVzNzlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsYWNrZHVjazcxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzcHJpbnRlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJVeTRDSWk0SFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjM4MmE4ZThmODRhMjJhMGU5ZThkNTk5MWJhYmNhOGQzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImEyNGNkMjQ3MWNlMGQ5MWU5OTBhOGI4ZDhmOGM2Nzc0YjhkM2RmYjhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwMjdmOWVhNDJmZDNiMWE5YTY2MDRlOGExZDk5MzU4MTAwMWZkODhjYjg3MjJjZjM5YWFlNTUyMmZhYzIzYmY3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzODUyODE5MjhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNjg0MTg3MDdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NzApLTUyNS05MTM0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNTkpLTE2MC01NDA5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTgxLTIzLTU3OTBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzY1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi82NS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjEyZTUzNDI4ODUzYzFhYzVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkZW5pc2VcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1hcnRpblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTgyMSByb2JpbnNvbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwidXRpY2FcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MDY3MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZGVuaXNlLm1hcnRpbjQxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJyZWRiZWFyMTU3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtb250eTFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwialdaVW54YVNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiNjAyNDgyODI3NDY2ZWQ4NzhkNTdkYzRlNzEwMmYwOVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3ZWU2MzMxNzZjNzgxMWFhNTg1ZjkyMjMwMjQ2MzY3ZDJkNzk4MWVmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMGRiZGE2MzBjYWJmYmNkZWJjMjU1YzU0YmJjOThkZDQxODliNjQxNjc5OWViODgzODdiNjM1MWI5YWFiM2RkNFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjg2NzYzMzYzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDkzODk2NTdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3NDkpLTU1OS03NzE5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0MTMpLTM3MC05MDE5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTIyLTYxLTkwNTZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImYyMDkzZWU5NmQyYTk3Y2VcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9zc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9ycmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MjU0IGxvdmVycyBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXVyZWthXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2VzdCB2aXJnaW5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MzIzNVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9zcy5tb3JyaXMzNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwidGlueXRpZ2VyNTQ4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ0aGFuYXRvc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5cTRNeEJ0UVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjJkZjRjOGU4ZjFlZDgxOWQyMDBmYmY5NGJjYzI0MWJiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjRmYTgwZWU1NDU0ODZkZDg2OTM2MDQ2ZWY1ZGQwNjQ3ZTcwMDFlZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNjgyZjFmZjdlYmNjNzJhODQ2OTNiZTY2YzE3ZmRhNThjNGIxMjk3NWI2OTc2MTY4OTBlNTFjZjA3YjJmZWZjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNDA5MzQ4MTZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjgxNzEzMTFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MjcpLTkxOC05NzkyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2MDgpLTk1NS0zNzQ0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDc4LTk4LTQyODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzczLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImU1MGY4ZDkzNDVhYzcxZDlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImhlcm1pbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmb3dsZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU4OTQgdyBjYW1wYmVsbCBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImR1bWFzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidmlyZ2luaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODgxNDVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImhlcm1pbmlhLmZvd2xlcjU3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eWxpb241MTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNtb2tlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJYQnNEcHJndVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjAxNDk2MzJiNDNiMmFhOGEwMDAyMmZiNWI0YTg4MDM3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImVmZDY4NzU1ZjUxY2YyMzA3Zjg3Nzc2ZDVlNWVjNjIwOThiMzllZDlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNzZjODA0MmNjNDUwMDgwM2YyMTMyNjllMzQxZWU2OTM4MzRlYTlhNGQ3YTBjMjViYzJkZWM5ZjI2NzlmMDBmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTg4NzYxMDVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNzE1NjQ4MjlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MTQpLTY2NC03ODY2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3OTQpLTk5Mi0zNDMyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzMxLTgxLTU4NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImMzMzU1YjBjNjQzMjA4ZTlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtZWxpc3NhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmbGV0Y2hlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTY0NiBwYWRkb2NrIHdheVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZXVnZW5lXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaWRhaG9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjA1MDVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1lbGlzc2EuZmxldGNoZXI5M0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlYmVhcjU3MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic3dlZXRpZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI2dkFrZWE3dlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjk4YzQ5ZjUzMjdmMTIyOWViYjlhZTk4YTk4ZTlkNGFjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImZiYTkyN2I1NGZhNGRjNmEzNDFmMTQyYzE1ZmJlNGIyMjU5NzIyZGZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2OGY2MjY2ODBlYjJhMzBjMTc5Zjg2MGY0ZjU1MzQ1YzNmZjg5YjcwMTkxNDZkNTdkYjgyYzgzMmFiYTc0YWJjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk3MTMzMTQzOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ3NDkxNjg5NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcwNyktOTMyLTY2MzlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDczMSktNzQ3LTM3OTJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNTgtMTAtNjg5OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzcxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzcxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMDE4ZDhiN2RhZWVhYmI0MVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjcnlzdGFsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhbGxlblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTc0OCBjZW50cmFsIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJuZXcgaGF2ZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxODU3N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY3J5c3RhbC5hbGxlbjI1QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlZHVjazE4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhbmd1c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI3aWRVRjVuQlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjdiYmEwYjkxYmQ0NjdlODQxYTEyMGY0ZTYzMWNlYWZjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjZjNmQxN2RkMDIxNmE0YjFiMjY0OWYxMGU0YmVkYWEyNjY1MzIwZTJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3MzMwMjY3ZGYwMTdiZmQ5YjEwMDBmN2FmMzJlMmY1ZjAyZDZmYThiZDY0NGY0NTc2YTcxMzU4NDgyODQ3MzEzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk2MjYyNzMzNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyNjMyMzgyMVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDIwNSktMjkyLTcwNTJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDI4OCktODQzLTQ0NDVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0OTQtNzQtODE4N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzE4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTE5ZWFhZmYxNGE2N2NmZFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwid2VuZHlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZyZWVtYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjUxMDEgbG92ZXJzIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzaGVsYnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjYWxpZm9ybmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg1NzE2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ3ZW5keS5mcmVlbWFuNDBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ2dvcmlsbGE5ODlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjEyMzMyMVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJjNW1Ma0swQlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjk2NjllMGViNmU3ZTExNjhlM2ZkYTZjMTQxOWY1NWJkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjkwMGNjNjk3ZjJmMWZkOTRkZDYzOTY2NDUxMGRkOGY1NjE2NzZjNjhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0ODIwOGU3NTliMTQwNzNiMTY4N2U2ZDYwMWE0YzFiMjdjMWM1ZGYyYzkyMTY1NTc5ZWVkZjM5M2U2ODZjYjA5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk5NDE4OTE0N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxMjU3MzMwOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDUyMiktMTQ0LTUxOTZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyMyktODYyLTM4NTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNTUtNjYtODc4NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzdlMmM4MDcwNzg4ODMzMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJlZHVhcmRvXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtYXJzaGFsbFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzU5NSBlIG5vcnRoIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZWxlbmFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ0ZW5uZXNzZWVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODIzMzNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImVkdWFyZG8ubWFyc2hhbGw1MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlc25ha2U1NDBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFyY2hhbmdlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklkanRDTXVnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjA5MzZjYWUzMzkzZTExNDE4ZTE2ZjI1NGI5NTQzNzhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNWI4ZmMzMjllNTJhMTMzYmNiZWI3NzAzMDlmZGNlNjk4NmIyMTllY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjg1NTIxODQzZjJjOWM1OGYyZDgzOWRiZDEwMTc0ODA0ZTVhMjlkNDk4YzMyZTg2YWI1ZjNmYjFjM2UwODA2NTBcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI4MTQ4NTc3NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIwMzk0MzE0MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ3MCktNjQ1LTI2ODBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk1OSktNjI0LTc1NThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MjktODYtMjk4N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOWM2MzllOWM3MmFmNzA1YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImp1bGllXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJncmFudFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjQ4MCBsYWtldmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic3RhbmxleVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImluZGlhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDQyNzVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImp1bGllLmdyYW50NDhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVuZ29vc2UzODNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImlkaW90XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJJUFA5N1JMXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMzAyZjRlZTZlYjVkNjAyODE1NGRmZWEzZmFmNGVhOTVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjI4MGEyNDRmZGU1NWU4OGEwM2I1YTBkNTg1ODYzYWUzMDQyYjNmZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjlkYjBhZDkwZDQ3N2MyNjA3ZDVhMWUyMzM3YjhmMGM1ZDRhZDgwNGYzZTFiNjdlMTM4YzhmOWM3ZTI0ODQxMDFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAxOTIwNTE0MlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE3ODIzNjM2NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkxNCktODU3LTM3OTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk4NSktNzMyLTkzODNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0ODMtNzYtNzg5NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzExLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMjZhOWU1NjEwN2IzNzgyOFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkb3VnbGFzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkYXZpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTY4OCBlIGxpdHRsZSB5b3JrIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwcm92aWRlbmNlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFyeWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODEwNjVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRvdWdsYXMuZGF2aXMzOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlZ29vc2UxNzhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1pYW1pXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImt1ZmVzczZHXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNjM2ZTFlM2I1NjZmZTk4YzM5ZmVjZmExOWM5ODhlNmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNTk3NTdlZGU5MWI0Y2E1NzZkZTBmM2I3ZGE4OTRhM2RkMzcwMzEyNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhmZWMyYmYyNGRiN2MwNDlkNmRmZTgxYzQ4YWEzNWJmOWUyNmNjMDgzNjM5MzU3OGVjYWZiZTg5OTQ3MTdmOGJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM1NjYzODgyMFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ2OTYwNDEwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODUxKS02NDgtNzY1N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTkzKS05MDktNDg1NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcxMC0zNi05NjkzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI5NmQzNzIxOTY1ZGZlZjAxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2FuZGljZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9ycmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4Nzc5IHRheWxvciBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibG9uZyBiZWFjaFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldmFkYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MjgwNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2FuZGljZS5tb3JyaXMyM0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyc25ha2U5NDlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInlhbmtlZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLdHBLSUF6WFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNlNWRkOGQxNzJkMmVhOWY5NWIxOWQwMDRlYzk4OTIxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQyYzMwYzY1N2M1Njc0YTI3M2YzOWVjNjQwM2QyMDMzZjc4NWQ4NmRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5NThkYmJhMWQzYTg4MjkwNjY4NTg0OGY5MmVkMzE5MTFjODk3OWFjOTM3Yzc0NWIyZTE0MWI3Mzg0MTc1NzgyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNDM3NDkwNDhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0ODIyMTk2ODNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2MTApLTQ5Ny04OTI1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NjMpLTc1MS05MjAxXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTM4LTE4LTIxMTdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzE0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xNC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjgzZTI4ZGUwMzE4Yzk3OWVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFja1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RldmVuc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTQwMyBzdW5zZXQgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNhY3JhbWVudG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrZW50dWNreVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyMDg4N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFjay5zdGV2ZW5zODNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmJ1dHRlcmZseTUwMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2FsbGluZ1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtMjZ3d0p5blwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjU4ZjM0MjFhNGE4OTBhNzFhNTlmNzM3ZDQ0MDQ5NTZlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImFkY2Y4NzJjMDE3MTFkNjBiZDRlZWIxYjU5YzNhMWM2YjkxODVlZmFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1NjVjM2ZjOGVhOTA0ZWQ5NDNiNTg3MDYxM2U1ZmFjYTQ5OWE4ZDMxNWJlOTUzOTMzNjEzNDY2N2QxMDg5MjcwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNTI1MDI4MDNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODkwMTIzNTBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NTQpLTYyOS0zNDg5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzODUpLTY1MS0yODc2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTE5LTExLTYzMDhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzE2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc1YzIxNzIxYzAzYjlkOTdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYmFycnlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndpbGxpYW1zb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjMzMzMga2FyZW4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNhbiBqb3NlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2lzY29uc2luXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYwNDcxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJiYXJyeS53aWxsaWFtc29uNDJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZmlzaDM1OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMTA2NlwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJqQ3NDVzBvNFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjExMzdjOWUwYTEzZmZhNjJiZjYzNjY3YTFmNTVjMzZmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjkwZWEwMTg4MjY4MTQ1MzJmYzk2NTIwM2U4ZWQzZWI3ODAyOWFjM2RcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmYTBjOThlMDFiNzBmNWI2ZjUwNGNkNzRmN2I1NTQ0NWI4ZThhM2YwODc1N2QxMWJiNmIzNjE2ODU5ZmZhZDI5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzODMwMjc2NDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyOTIyNTA3NjBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig2OTEpLTQyMS01MDE4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2MzcpLTQyMS03NTg2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzE0LTYwLTY0ODhcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82MC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjY4NGVlZmNjMDYzNDg5ZGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjaHJpc3RpbmFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0ZXZlbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjcwMzIgZ3JlZW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9rbGFob21hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ5MzQwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjaHJpc3RpbmEuc3RldmVuczIyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2VmaXNoODI4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwb2xpY2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiRW9RanUwUkFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkMzE5NWY0MTQ2MzllZGQyZjJhMWNkNGViZTQ2OTYzM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2MDQ3YTdkZjUwMWZhNmExOTFmYmNjMzkyOTZlNmI3ZTcyYjI1NzRlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDJkYjc3OWIwZmVhNGNiOTRiMDJmZTEyODdlMDU2YWJiY2Q3YzM4YjEwNjFkMDk5YjVhMTcxYjU0OWJmMmU4YlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU4ODk2NDk3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI5OTUwNjAzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTU2KS05NjItMjE2MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzQ3KS00NjYtOTY4MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE5NC0zMC00MjQwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxOWYyNWE5ZWRjNDUyZWQxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJoYXplbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicG93ZWxsXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNjQwIHBvY2tydXMgcGFnZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibG9uZyBiZWFjaFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZlcm1vbnRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTU0MzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImhhemVsLnBvd2VsbDE5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5c25ha2U3MjJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIndpbGxvd1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ4RWpMU3dsaFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjlhMmU3OTcwMjg2Y2M1MTliYWJmNTdiMDNiNTVjOThiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjFjZGVlMmFjZWM1YTE5NDYxZTEzNmNlZmZjZjI3YTA2YjJmMDRkMmJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwZmNhMzA1N2EwNDIxNWZjYzljYzE1YzkyMWVmYjM2NmVlNjIzNmUyN2MyZTk3ZGZiOTg5NWJhYjk5NGM0NWZiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzOTU5Mjk1ODJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODM3NTg4MzVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxOTIpLTM1OS03NDgzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0OTkpLTkxMi04NTg0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTkzLTI0LTI4NzJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjU2ZWY0MTZlZjA4ZTJmMDRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibGV2aVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaHVudFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTE2NCBob2dhbiBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2VhZ292aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyOTMzOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibGV2aS5odW50NDFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsYnV0dGVyZmx5MTU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJiaWdmb290XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInlyMHlmdTBlXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNDA0M2FiZTM1ZDUwYmNlOTdkYzI0MWZhZWFlNTkxZTFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDUyYzc2NmMzNGNkODYwZDBjMWM5NGVkOWYzMDIxMGRiMzMyMjczOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjNkZGVjY2JkNWY2ZDZmYmQ0MThjODNkMzcwZDExZWRmMjk1NDBiYWIwYmFjMmE1ZmY0OWRjZDgxYzM1ZDA3NjNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM4NDEyNTgzMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjYyNDkyOTBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxMzcpLTgwMC0xOTE4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMTcpLTg0MS0xOTU2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjU5LTgwLTE4OTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83OS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImE4NWE0NDkwOTI0Y2IzOGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwid3lhdHRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRhdmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NjE5IGVkd2FyZHMgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInByaW5jZXRvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBoYW1wc2hpcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzUzMzdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInd5YXR0LmRhdmlzMjJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsYWNrbGVvcGFyZDQ1N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidGh1bWJuaWxzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkZsODE2U3R5XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTQ1NjVmOGVlYTMzMjFhNmRiNTA1ZmUyZjU4MDMwOGRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMzI5NzQxY2EyMjdhZTAwOTczYjZkZDE4Mjg3ZDQyNGFjNDBiOWFiNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjc0YTY2NWVkNjU2M2YzY2I2YjBjZjU3NmZlODUzZjI4M2UyNDA2ZmJkMzg1NzE5YWE1YjI1YmY2Nzk3N2E0YjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTE3Mzg3NjYyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzEyNDM0ODczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODA1KS0zOTItNDAxMFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTk3KS02MjAtNjk5NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk0NC04OS04Mjg1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmOWY5NmViMTAxMzhlNTNlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInNldGhcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdhcmRuZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU0MzcgbGFrZXNob3JlIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJuYXNodmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjcyODA5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJzZXRoLmdhcmRuZXI5OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVrb2FsYTU1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiNDQ0NDQ0XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjNEeXZCb29PXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMWMxYTU2MjlhZTQ4Y2RhYTJjZjEyN2U1OGU1NDE5ZTRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZDFjOWQ5YjI3MmMyNGRhNThjZGRlOTNlMjAyMmU5MDhhNGNmZGUzYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImI4NDM3ODExMTNiY2ZkYmUwNGNmYzE2ZWJkNWJkYjI1N2ZiOTgwNWRmNzQwMGEyNjU0NTYwMTVlODZkM2EzM2VcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM5Nzg2ODI0N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyODI5NzM2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTk2KS0xNzItNjM0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTQ3KS00ODMtMjMwNlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU0My0zMi04NDc4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjZTk4OTNiOWY3MWE4Mzk3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1hcnZpblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9yZ2FuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI5MTEzIG1hcnNoIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwaXR0c2J1cmdoXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IHlvcmtcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzYyNjJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1hcnZpbi5tb3JnYW40NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyc25ha2U1OTJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNpc3RlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJDRDEwU2VOZFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImVmZDE0NmZiMzY4OGEwMmJhZDZjOGIwZTYxMzhiMmE0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjhiNDBjZjU1ODczMzk0Y2E0MDAyNTlhM2EwYTQ2NGI3MWI1ODQ4YTRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0OTc1NGQ2ZDc4NzFkOWE1YWZkYjMxZmYyN2U2MDEyNmY3YjRkMzY4NGIwYjRlYzIzNTNkYzJiNWM2YmMyM2RlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNDI5OTc4ODVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNjEzNjQ4OThcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5ODkpLTEzMi03NzQzXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0OTMpLTc1Mi0xMjc2XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzA0LTk0LTg0NjBcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjU3NTkzNDU5MGJkN2I4MjRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibG91aXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhvZmZtYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjUxMjIgZmluY2hlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVsZW5hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlzc2lzc2lwcGlcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTE4ODFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImxvdWlzLmhvZmZtYW40OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyZ29vc2U1MTlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInJhdmVuMVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI3U0pwamdDNlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImU2ZTljMTIyOWJlYTdkYzY3Y2MxMWRlYTcxNTczYTg3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImJiMmExNTQ1NzM5YzFiYTY0MzM0ZTI4ZDZiMGJhNTNlODI1ZTJiM2JcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjODMzMTk4Yzk5YWNiZjQyNjNjMjRjNGY0ODNlNWYzODM2OTE3MmIwZDYyNmY0YWY1ZGU4OTMxYjczZjhjNzBkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk0ODkyMzIyN1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxODQ2NDQ0N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcxNCktNTg4LTY0OTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE4NSktNzc1LTk4NjNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MTAtNTctMTcxOFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzUzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzUzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiM2FjMDI4OTYxYjBhNmZiM1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ2ZXJub25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm15ZXJzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4OTYyIHRob3JucmlkZ2UgY2lyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhcmxpbmd0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrZW50dWNreVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0ODU1NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidmVybm9uLm15ZXJzODlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yZ2FuaWNyYWJiaXQ1MzNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNlcnZlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI5UVVwd3FTVVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjllMGM4ZTMxNmVlZWEwYjg2NmVkYjMyN2FmMmI1MDQ5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE0OTA1YWM0NGMyYTgyZTliNWVlNDZjMTBkYzAzZmQ3OGQ4YjUxMWVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIxZjVmNGJjMzQxZTM5OGUyNDE2YTdmZWNiYTQxOTMxMzgwMDg4MDY3ZmE3NWY5NGE1ZTBhZDA2NWE1MDYzYTIyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMTExMDQ5MDhcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxMjAwNjk2NDVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NzcpLTYwNy03Mzk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0NjMpLTUyNy03MTc0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjg4LTM5LTcxMjJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8zOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzM5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8zOS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjYwMTMyNDM1NjYxMWM3NmVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWljaGFlbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RhbmxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzU5MSBub3J0aGF2ZW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNwb2thbmVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJzb3V0aCBjYXJvbGluYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NTUzNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWljaGFlbC5zdGFubGV5ODBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdvbGRlbmdvcmlsbGE5NDFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImthcmVuXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIll4enFwRlNJXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDNhYWMxMzMxNDY3ZDA5YTk4NDYxMjBjYjc1OGFhMjdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMTM5YzQ3ODE1YWI3YTU4NTIyMDY0ZGU5MDFmNjk5NDkzYzA3ZTY1Y1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImY2MjExNjZjYTljNmFmNjIzZTc0ZDUxNzQyNDUxOWQ1NTRiNGExNzcwMTA2MThjODU5NTlhOGNjYWUxYmE4Y2NcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA3MzkwMzQzN1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMwNTE3NTcxXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzQ5KS02NDUtMTc4MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTA3KS03OTUtMzcwN1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ2MS00MC0yNDkxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81NC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2YzExNjQ2YzBhNjMyNGFjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNsaWZ0b25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1heVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDg4NiBub3dsaW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInBpdHRzYnVyZ2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaXNzaXNzaXBwaVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMTI1N1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2xpZnRvbi5tYXkyN0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWxhZHlidWc4OTdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZsYXNoZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiQzRodmpncG9cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjNDE4MTVjOWNlMzA5ZGIwNzE0ODM1YjZlMzI5ZTlhMlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJjNDYwMjBkNTU3NTQ5NmNiM2YxZjMzNjU3MzNmMzk4NDk2NmFlNWNmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZThjMmY1N2Q4MWUyODEwMzgyYTdmZGRkOGNhZjYwMWJiOGQxOTdjMjYwYzU2NzA2YzYyNmYzZGU3MWIzYTdhOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTY0ODU0NDY3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTM3MzI1ODk2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjE1KS04ODItMzkyNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTEwKS04OTctMjc5N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc4Ny04OS0yNzE2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiYjJmNTIzY2JhOWUxMTk1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqb2FublwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwib2xpdmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxMTQ4IGRhbmUgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW50cyBwYXNzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlubmVzb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU0NzIyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqb2Fubi5vbGl2ZXI4NUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZW1vdXNlMzE2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJiYWNrYm9uZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLc0M2TlJOVVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjAxYzhiMjQ4M2UxZTU1NDBmZjJkMWNiNDZkODQzM2JjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjI0YTA5ZjZmZDZiYWI3NTliZmUyNTAzMTY4OTZjZmQzZTQ4NmFkM2NcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIzZjk1NDAyMzBiZWIzZTgwOGY0NzE0ZTRmMTY2MjA3MzA5NDI0MDlhNzc4Yzk4NGFiMDJmOWFmMGVkM2JjYzdjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExMDYzNDgyMTVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTk3MTkwNDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigzNDIpLTE2OC02Nzc2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMjYpLTE1MS0xMjEyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzM4LTMyLTQ4MTNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzI4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjA2MDk1Mjc4ODAzNGFlMWRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwic2VhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYnVydG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2ODk0IHNwcmluZyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJkZWxhd2FyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4MDI4NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwic2Vhbi5idXJ0b241MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiaGVhdnlsYWR5YnVnMjI1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjb2xvclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIyZ2VHbTBMNFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjU0NGJiZDNlZjdhMjFlYTNkMGJmN2UyMmM2NDU2NjgzXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImQzNTlmY2UzYTQzOTc3MGQ4Zjk0ZTdhODMwZTg1ZjY5NWJlNTYxNzFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiMDkzZjIwZTYxOTg1YThiNWYwNmEzNjk1NWYwNTlhODk5NTEwNzkxNzMxODA0ZjQ2MWJiNDE0MTJmNTg0MGFlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwOTA5ODc3OTlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI2MzQ0MjYzMlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc4NyktMjUwLTQzMDRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU4MyktODE2LTE3OThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1OTEtNzctMzI0N1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzEwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzEwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDMzYWYxMzVlMzQxZDAwYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhcm9sZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmFycmV0dFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzM0MSBlIHNhbmR5IGxha2UgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInN0b2NrdG9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid2lzY29uc2luXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU4NzA0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYXJvbGUuYmFycmV0dDIyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGdvcmlsbGE5MThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImtpdHR5Y2F0XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInBrNnVObzdYXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNWRhMDlmZTQ5Y2I2NTFhMWZiNDQ1ODIwZmNkYzk1MTBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMTEyN2ZhMWE3Yzg4YzQ3YWQyMzVlODI0NTY3MWViYjkzZDM3ZjczYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImZiOGEzNTY5ZGZmNWY0ZmRmMjRiMjUxODc0NjlhMjdlMjE3MDVhZmMxZTNhNTBiOTljMjhmY2YzODc5NGFiOWRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAzNTY4NDE3NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ0NTMyMDk1NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE3NCktOTg1LTU1NzlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg0NCktNjYyLTQ3MjJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NjgtNTYtMzY1MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2QxZDFkMGFhNWRhZWMyNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJicmFkXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjYXJyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyMTk0IHBvcGxhciBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29sdW1idXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJmbG9yaWRhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjMzNzAyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJicmFkLmNhcnIzNkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxnb3JpbGxhNzM3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsb2JvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkt3dEtGZTFJXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMTU0ZTkxZjhkNmZhNzg5NTYwNmZmNzkxOGExODZjOGRcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjQwNzk5MTYyZWMwYjZkNmEwYzE3Zjg1MGNjYmUyZTcxZTVkMTc2ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImE3MGViZTE0ZDgxMmE0YjBhYTAxMzE2OTZhNTcwYzIwMmU5ZTkyMmQ0YWZlZWM4ZWIwZjQ2ZTY3ZGU4NDM1YmFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI5OTUyMTc0NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE5MDk4MDM5NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk2MCktOTY3LTg2MzhcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDczNyktNjMxLTIyMjRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNDMtNTAtNDA1MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzcwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzcwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMmNmZjBlMTlmNWQ5M2YyZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqb2huXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJncmFudFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDU5OSBzaGFkeSBsbiBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGVzb3RvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFpbmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzk1OTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImpvaG4uZ3JhbnQ3MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWJlYXI5ODFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhdmFsaWVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImVYMUxjcGxOXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmVmODNjMjFlNzlkNTJmOTRiNjQxYTg5M2MyZDA4ZmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZThkNzk0MDBkNGYyYjRiZDY2NWNhMjhkY2RjMjJmZjYxYjhiZjdjMVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImViZWFkNGNlOTA0MTU3NmQ4MDExYWI4ZDdjYzM2MjcyNDNlNzk3N2Q1NjI3NzU5MDdjZGQ1ZDE1ODdiMTU4YjVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA3OTA0ODEzMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI1NDUwNTU4NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcwOCktNjY0LTUxNzNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg0MCktNjg0LTcxNDVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxMDEtNjAtODU3OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI3LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjc3ZGNkMWU2ZjZhZWVmOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrYXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdlb3JnZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjkzOSBwcm9zcGVjdCByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY3VwZXJ0aW5vXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib3JlZ29uXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUxNjQ1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJrYXkuZ2VvcmdlNzRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVuc25ha2U5NDdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNydWlzZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJHYXNVRmhFTVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjI2ZjA3ZTBiNzU4NGM2NWMyNTMyZDRmOWEwY2ExOGY5XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjY4NjMwZTZkMDVmMjVlNjdmMzUzMTdlMjllOWY5OGYxMDU5OWFjMzdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIwM2E4ZWJkMGVkMWFjMWI2MjcwMWE1ODA1YTJmYzJhZTU3YzdlYjEyMmIwNzY4YWJmMjMyZmYyMGNlOGVjOGJkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExMjAxNTAzMTVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODM1MTYyMDhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NTIpLTkwMy05NjM3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxMjEpLTk0MS0yNzE4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTY2LTk0LTY0NzVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzU3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi81Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi81Ny5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImFiNjQ3Nzg4MjI0NTEyMDRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwib3dlblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FybHNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTYzOSBsb2N1c3QgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvcyBsdW5hc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pY2hpZ2FuXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQzNzI4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJvd2VuLmNhcmxzb240NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlZ29yaWxsYTUwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjbGF5XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjAxZUZadzZVXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTQ1ZGU0YTY0ZDkyZTNkNzEyYTYxNTUxODQ5YjYxNWNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjhkODI1MjM3MzNjY2I2OTI0ZmIyM2Q2OWYzMDQ2MDJkOGNmM2FhYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImM5NzZlODFjYTU4ZjE0ZGQ3MGEwNTM4ODlmNWU2MDgxNTdhMjUyNzNjZDk1YjVhYTVlMzdhYzkwMTdhNjgwN2VcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3MTg0NzM3NVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQyNDYwMzM4OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc4OSktNjAzLTgzMDBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDczOCktNTI3LTcwMDVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4NTktMjktODU3NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTQwMTI1ODI5ZTQ2ZTFkOFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9zYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZWR3YXJkc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDMyNSBoaWNrb3J5IGNyZWVrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzZWFnb3ZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2hpb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0ODU0OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9zYS5lZHdhcmRzNzdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpY2tsaXNobGFkeWJ1ZzkyNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaG90Z2lybHNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZUtwY2ZVQnNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjM2RmMGJjMjc5MzM4YWNlZTFmNWRiYmYxNzYzMmM5OVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMmU3YTdmMDkyYmZkN2FlNmMwNjExN2MzMzdhNTc5YjdhZDU3ZTRmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMTFmMjE2ZTc1MmEwMTUwMjkwNGQ3YmMwYzRiYzgwZjMzMGQ1ZWZiNTViMDJiYjU4MjY0ZmJhZjIwNjBlNTdhM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjk4OTkyOTAxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTQzODkxMTc4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzM5KS0zMDAtNzI4OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjE4KS04NzAtMjAyOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMzNS03MC0zMTkwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi85LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4ZjVjOTVhZWMwN2NjZWU5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJpbGxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJyYWRsZXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjIyNjggY2FtZGVuIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibGFzIHZlZ2FzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTM4OTlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImJpbGwuYnJhZGxleTEzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5bGlvbjUyMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2lycnVzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkV5MmZUWHdFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZGQ2M2I3MDg2OTkwMDJiZmIyYjkzODcwZjMyMTFmZmNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNTM2NGYzNDg0ZmRiOWY5YTNkOTRkZjU3ZjlhNmE4ZjUzMDBmZTMxZFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImY3OGFhNGVjMTU2NzEyY2I2YjJmZjMyOTZmYjcxYmQ4NTRjOTk2YmZlNGI0ODAxZTdjNGU5NWRlNGJiNjBlOWZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE3OTYxOTAyMlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE3NjYwMjI3MlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE0NiktMzAxLTIyOThcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE1NyktNDk0LTExMTdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMDgtNDMtNTM3MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzUyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzUyLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzZhY2Y0NDgzYjNkNzkyMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRyYWNleVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWlsbGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzMzk1IG1jZ293ZW4gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInRhY29tYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInV0YWhcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjI2MzJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRyYWNleS5taWxsZXIxMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkYmlyZDI0OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZmF0aW1hXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlRwVFA0aDBqXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOTAxOWYzNzBiMjNiYTc2NGNiMmM3Mjg3Nzk4YjJlMzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDZiNGIzNTVjZmIxNGZjNmRjNmQ3OTg4YTE4ZTcyNGVmZTQxNDA0NlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjVjN2Y3OGRiY2EyOTFlZDQ3YjVmOWNhNTU2YmQwNjYzODhkZDY0ZTIzYjdjYjQ1MTNlNWRlYjMyMThkYmU0ZDBcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTg4MjIwMzc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjk0NjI0NDI2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDgyKS05OTAtMTU1MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjY0KS05OTUtODE5NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIxNC04OC05NTM1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJiY2E3YTZkMWIzMjI3YmUzXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJlbGxhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJrZW5uZWR5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NDA4IHByb3NwZWN0IHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb2x1bWJ1c1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZlcm1vbnRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzkwNTBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImJlbGxhLmtlbm5lZHk5MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW5rb2FsYTU1NVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic21hbGxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwickI5c25reVhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwNzVmOTVjNjBlYzA1N2JhZTAxMmQyODNjZjk1YzFmN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwNTZmZGQxNWU5ZjMwNWE4YWM2NjNiMzE0MTQ3NjdlYjcxZTJmNWM1XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYTE5ZTRhY2FiNzE4ZmRiN2I4OTQ5YzE4ZTU1ODQ5NTQyZDcyNmZlOTkwMGMyODU3Yzg4Y2Y5YTUwMmFiMjg3YlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDY2Njg0NDA0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjcwNTA1NDQ5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTMxKS0yMjQtNjc5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTk0KS03MDctMTUwOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMwMy00MC0xODA1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ODNmNzc3MTE0NWU3NjJjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqYW5ldFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicmljZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTgyNiBvYWsgcmlkZ2UgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZvdW50YWluIHZhbGxleVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1haW5lXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY0NjQ5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqYW5ldC5yaWNlNjZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnBhbmRhNDVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZ1enp5XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInkxYXY0WlpMXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNGMxOTAxNzdiNTY4ODE4OTZhOTMyNmNkYzQ1OTFmNDVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOWI2MTM5OTc0OWJkZWUzNTIzZDQ0YzkxMDA2ZTlhYTAwY2FlMjJlY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImMzNjRiNWYzOWM1NTllNDdhMDdmNDBhMjE5YTA3NWNlOGZmOTBjNzc2NTI5MTNhMTIxMjU4MzJjYTBhOTkxNjhcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2OTQzOTM2NVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ3NzQxNzE3M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg1MyktODQwLTIzNzhcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE5MSktMjY0LTczNzdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0MDYtMTktNTMyNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vODEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzgxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzgxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMjFkODhhMzljNThkM2Q5ZFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImhpbGRhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJjYW1wYmVsbFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTU4MCBwbHVtIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJha3JvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImZsb3JpZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjU4NDJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImhpbGRhLmNhbXBiZWxsODdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRlcGFuZGEyNDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZlc3RpdmFsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlVPZmhGMGwwXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTZjZWYzZmQzNzk2NTZmMmQxMTJjODg3YWZiNGIxNGVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZTAxMWY1NmQ2ZWIzYjY2ZjU5Nzk3NDc0NDVkOWMwMWI4OTY5NjFhMFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjJmZjQ3NjA1YjdkY2RmNGRkMmIyNDVlZjZhNWQ3NDA0ODFkOWZjNDMxZGM1MDhlZTg3MzNlZWYxYzY4MGNmMzVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTM4MjE3MzY2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDQ2MTQ4NjM2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzM5KS0xMTgtNTM2NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTg0KS04ODktNDc1OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg2NC0xOS0zMjY0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxYjI0NDA5NjY0ZGE1MzMwXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvbm5pZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWNkb25hbGlkXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NzA1IHdhbG51dCBoaWxsIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkdW5jYW52aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImFyaXpvbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzE5OTFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvbm5pZS5tY2RvbmFsaWQ2MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiY3JhenlwYW5kYTM2MlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic2hlbGxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwicFJuSHFYRXhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkNTZjMTVlNGJjOTMzYjU2MmY0ZjVjODU0ZGMwZDNkOVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmMTYxMGIzNWFkMDM5ODVkYjdkYTlhMDAzN2JjYzhkNjNkNjllZWY1XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDQyMTc0MmZmYTQ2OTM0OTMzZmNjNzM1YjdmNDhkODFmOWJlYjExNTk5YTA1MzliZGQ4MzgzODM3YjAzNzA5YVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MzkzMzUzMzlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNjU4Nzg2MjZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0MzkpLTI1MC00MzQyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0ODgpLTEyMy0yMjYwXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTE4LTg3LTY3OTdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzcwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83MC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjRiZDI1ZGZjNTdhZWYzODVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicm9sYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYWxlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzMTAzIHdvb2RsYW5kIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJtZXNxdWl0ZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg5NzI3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb2xhbmQuaGFsZTU3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVld29sZjY4NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY291Z2Fyc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJKSFpoS3hGZVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjA5NWQ2NmMxMmRmM2RmY2VkMGVlYmZhN2IxZDM4NWIyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE4NzYzYTM3YWZmOTQ0MjllZjkyODQzYWQxMWMzNDM0YWE1NzlhNTJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiNGMxMGRkNmRhMGVhNzUwZjljY2QyNTVhZDBlZjY0NWJmNTRhZjBjMjRiZGQwZGU1ZjllZmFlMWI3MzEyYjEzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkzODM2NTMxNlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE4MTIxMzMyOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU2MiktODUzLTg2NzdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIzNSktODcyLTYyMjJcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NjQtNjktNTUwOVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzM4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMmQ0ZGRjOWMwMzc0MjI5YVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImp1bmVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhc2hpbmd0b25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY5MTEgdGltYmVyIHdvbGYgdHJhaWxcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvcyBhbmdlbGVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlubmVzb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY2Nzk1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqdW5lLndhc2hpbmd0b24yM0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnZWxlcGhhbnQxMlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY29uZG9tXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm1TNXZscUV0XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDRjMzA1NzQ1NDMxMjIyMGNlNzc2YzIzMDNlYTlkM2VcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDY3MTNjM2I2ODNiM2EyOWFhNjY4NmY5YmNjNzE1YmE3ZmRhNTYxMlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImVjNzBlMGZiM2YxOTE5MmUyNTJjYmI2ODEwYTA0ODg1YmE2ZGYzOTkxYzdhZDhjYTI2Mzc1MDU1MTNkNzM1YWVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIxMTA5NzM1NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ0MDM0NjU4N1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk2NiktODQwLTUyOTFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDY0OCktNjIxLTk0MTlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMzItMTAtNDQyNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzFkZmU5NDQyNDIzNDg1NVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqYW1pZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FsZHdlbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjIwNzEgYnJ1Y2Ugc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV2YW5zdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgbWV4aWNvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYzNDg0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqYW1pZS5jYWxkd2VsbDI1QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbmJ1dHRlcmZseTMyOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZmV0dGlzaFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSQlVGZ2M0eVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImFjNDdhZTEwYmE1YzEzNDg1NjEzNTI3MGVhMzIzYzk4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImY5OWZmYjdjNjZlZDA1ZTkyOTEzZDA3MGFmNTZiODc4YWQ4YjRlNDlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjYjhjZGUxMmI2Y2EzYTEwNmIwZjg0MGQ3OWUyZGEyOTQwNWE2MjI2YTI4NTA3Nzc2YmUzNjU2ZWY3ZDM3YTUzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzU5ODc2NjRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNzQzODE5OTdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MDEpLTY2Ni0xNTg1XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MjUpLTYwMy0yMjcyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODA5LTEyLTY5NDFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80NC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80NC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjcxMGNlMDI2NjQyZGQ2Y2ZcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJnbGVuZGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZlcmd1c29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2ODA1IGNvdW50cnkgY2x1YiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYm96ZW1hblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBoYW1wc2hpcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTAxNDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImdsZW5kYS5mZXJndXNvbjY4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGVsYWR5YnVnNDU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqYXloYXdrXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJkVURRWktMXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYTdkMTdkNTE3NTRiNGUwZmNlMThiYmY0ZGZiNmYyZjBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTk0ZDdmNmM0ZDRmMjE2YzhmZmU1NWYxZDhiOGUzYjNhMTM3NDE2MFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjVhYWMyMDNmNWUzMDBkMjBiNjljYWFmZjFlNzk5OGExNDA5NWQ2NWE4ZDM1NGYxMGM4ZTIxN2RlMDQ4YzU3OTJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAyMDY2MDk4MFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyNjMzNDgwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTUxKS02MjktMjgzNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzI5KS01NDEtODM0OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk3OS00My05Njg4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8yLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlNTdkZWViMDUwNDAzNDNhXCJcbiAgICB9XG5dIiwidmFyIEVudGkgPSByZXF1aXJlKCdlbnRpJyk7XG5cbmZ1bmN0aW9uIHdhdGNoRmlsdGVyKG9iamVjdCwgZmlsdGVyLCBoYW5kbGVyKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09J29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBkb3RJbmRleCA9IGZpbHRlci5pbmRleE9mKCcuJyksXG4gICAgICAgIGlzTGFzdCA9ICF+ZG90SW5kZXgsXG4gICAgICAgIHRhcmdldCA9IGlzTGFzdCA/IGZpbHRlciA6IGZpbHRlci5zbGljZSgwLCBkb3RJbmRleCksXG4gICAgICAgIGlzRG91YmxlU3RhciA9IHRhcmdldCA9PT0gJyoqJyxcbiAgICAgICAgaXNWYWx1ZVN0YXIgPSB0YXJnZXQgPT09ICcqJCcsXG4gICAgICAgIHJlc3QgPSBpc0xhc3QgPyBudWxsIDogZmlsdGVyLnNsaWNlKGRvdEluZGV4KzEpLFxuICAgICAgICByZWFsS2V5ID0gdGFyZ2V0LmNoYXJBdCgwKSAhPT0gJyonLFxuICAgICAgICBtb2RlbCA9IG5ldyBFbnRpKG9iamVjdCksXG4gICAgICAgIGNoaWxkV2F0Y2hlcyA9IHt9O1xuXG4gICAgZnVuY3Rpb24gdW53YXRjaCgpe1xuICAgICAgICBtb2RlbC5kZXRhY2goKTtcbiAgICAgICAgbW9kZWwuX2V2ZW50cyA9IHt9O1xuICAgICAgICBmb3IodmFyIGtleSBpbiBjaGlsZFdhdGNoZXMpe1xuICAgICAgICAgICAgY2hpbGRXYXRjaGVzW2tleV0gJiYgY2hpbGRXYXRjaGVzW2tleV0oKTtcbiAgICAgICAgICAgIGRlbGV0ZSBjaGlsZFdhdGNoZXNba2V5XTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZU9uKGtleSl7XG4gICAgICAgIG1vZGVsLm9uKGtleSwgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHVud2F0Y2goKTtcbiAgICAgICAgICAgIHdhdGNoRmlsdGVyKG9iamVjdCwgZmlsdGVyLCBoYW5kbGVyKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdXBkYXRlT24oJyonKTtcblxuICAgIGlmKHJlYWxLZXkpe1xuICAgICAgICBpZihyZXN0KXtcbiAgICAgICAgICAgIGNoaWxkV2F0Y2hlc1t0YXJnZXRdID0gd2F0Y2hGaWx0ZXIob2JqZWN0W3RhcmdldF0sIHJlc3QsIGhhbmRsZXIpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIG1vZGVsLm9uKHRhcmdldCwgaGFuZGxlcik7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGVPbih0YXJnZXQpO1xuICAgIH1lbHNlIGlmKHRhcmdldC5jaGFyQXQoMCkgPT09ICcqJyl7XG4gICAgICAgIGlmKCFyZXN0KXtcbiAgICAgICAgICAgIG1vZGVsLm9uKCcqJywgaGFuZGxlcik7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgICAgICB1cGRhdGVPbihrZXkpO1xuICAgICAgICAgICAgaWYocmVzdCl7XG4gICAgICAgICAgICAgICAgY2hpbGRXYXRjaGVzW2tleV0gPSB3YXRjaEZpbHRlcihvYmplY3Rba2V5XSwgcmVzdCwgaGFuZGxlcik7XG4gICAgICAgICAgICAgICAgaWYoaXNEb3VibGVTdGFyKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRXYXRjaGVzW2tleSArICcuKiouJyArIHJlc3RdID0gd2F0Y2hGaWx0ZXIob2JqZWN0W2tleV0sICcqKi4nICsgcmVzdCwgaGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgaWYoaXNWYWx1ZVN0YXIgfHwgaXNEb3VibGVTdGFyKXtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwub24oa2V5LCBoYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYoaXNEb3VibGVTdGFyKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRXYXRjaGVzW2tleSArICcuKionXSA9IHdhdGNoRmlsdGVyKG9iamVjdFtrZXldLCAnKionLCBoYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW53YXRjaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiB3YXRjaChiaW5kaW5nLCBmaWx0ZXIpe1xuICAgIGlmKCFmaWx0ZXIpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIHZhciByZW1vdmUsXG4gICAgICAgIGxhc3RUYXJnZXQgPSBiaW5kaW5nKCk7XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVyKHRhcmdldCl7XG4gICAgICAgIGJpbmRpbmcuX2NoYW5nZShiaW5kaW5nKCksIHRhcmdldCk7XG4gICAgfVxuXG4gICAgYmluZGluZy5vbignY2hhbmdlJywgZnVuY3Rpb24obmV3VGFyZ2V0KXtcbiAgICAgICAgaWYobGFzdFRhcmdldCAhPT0gbmV3VGFyZ2V0KXtcbiAgICAgICAgICAgIGxhc3RUYXJnZXQgPSBuZXdUYXJnZXQ7XG4gICAgICAgICAgICByZW1vdmUgJiYgcmVtb3ZlKCk7XG4gICAgICAgICAgICByZW1vdmUgPSB3YXRjaEZpbHRlcihuZXdUYXJnZXQsIGZpbHRlciwgaGFuZGxlcik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGJpbmRpbmcub24oJ2RldGFjaCcsIGZ1bmN0aW9uKG5ld1RhcmdldCl7XG4gICAgICAgIHJlbW92ZSAmJiByZW1vdmUoKTtcbiAgICB9KTtcblxuICAgIHJlbW92ZSA9IHdhdGNoRmlsdGVyKGxhc3RUYXJnZXQsIGZpbHRlciwgaGFuZGxlcik7XG59OyIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIGNvbnRhaW5lckNvbXBvbmVudCA9IHJlcXVpcmUoJy4vY29udGFpbmVyQ29tcG9uZW50Jyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnR5KGZhc3RuLCBnZW5lcmljLCBrZXksIHNldHRpbmdzKXtcbiAgICB2YXIgc2V0dGluZyA9IHNldHRpbmdzW2tleV0sXG4gICAgICAgIGJpbmRpbmcgPSBmYXN0bi5pc0JpbmRpbmcoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgcHJvcGVydHkgPSBmYXN0bi5pc1Byb3BlcnR5KHNldHRpbmcpICYmIHNldHRpbmcsXG4gICAgICAgIHZhbHVlID0gIWJpbmRpbmcgJiYgIXByb3BlcnR5ICYmIHNldHRpbmcgfHwgbnVsbDtcblxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4ucHJvcGVydHkodmFsdWUpO1xuICAgIH1cblxuICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICBwcm9wZXJ0eS5iaW5kaW5nKGJpbmRpbmcpO1xuICAgIH1cblxuICAgIGdlbmVyaWMub24oJ3VwZGF0ZScsIHByb3BlcnR5LnVwZGF0ZSk7XG4gICAgZ2VuZXJpYy5vbignYXR0YWNoJywgcHJvcGVydHkuYXR0YWNoKTtcbiAgICBwcm9wZXJ0eS5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpZighZ2VuZXJpYy5lbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5lbGVtZW50LFxuICAgICAgICAgICAgaXNQcm9wZXJ0eSA9IGtleSBpbiBlbGVtZW50LFxuICAgICAgICAgICAgcHJldmlvdXMgPSBpc1Byb3BlcnR5ID8gZWxlbWVudFtrZXldIDogZWxlbWVudC5nZXRBdHRyaWJ1dGUoa2V5KTtcblxuICAgICAgICBpZih2YWx1ZSA9PSBudWxsKXtcbiAgICAgICAgICAgIHZhbHVlID0gJyc7XG4gICAgICAgIH1cblxuICAgICAgICBpZih2YWx1ZSAhPT0gcHJldmlvdXMpe1xuICAgICAgICAgICAgaWYoaXNQcm9wZXJ0eSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB9ZWxzZSBpZih0eXBlb2YgdmFsdWUgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGdlbmVyaWNba2V5XSA9IHByb3BlcnR5O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBnZW5lcmljLCBzZXR0aW5ncyl7XG4gICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICBjcmVhdGVQcm9wZXJ0eShmYXN0biwgZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGV2ZW50TmFtZSwgc2V0dGluZ3Mpe1xuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBnZW5lcmljLmVtaXQoZXZlbnROYW1lLCBldmVudCwgZ2VuZXJpYy5zY29wZSgpKTtcbiAgICB9O1xuXG4gICAgZ2VuZXJpYy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcblxuICAgIGdlbmVyaWMub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRBdXRvSGFuZGxlcihnZW5lcmljLCBrZXksIHNldHRpbmdzKXtcbiAgICB2YXIgYXV0b0V2ZW50ID0gc2V0dGluZ3Nba2V5XS5zcGxpdCgnOicpLFxuICAgICAgICBldmVudE5hbWUgPSBrZXkuc2xpY2UoMik7XG4gICAgICAgIFxuICAgIGRlbGV0ZSBzZXR0aW5nc1trZXldO1xuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihldmVudCl7XG4gICAgICAgIGdlbmVyaWNbYXV0b0V2ZW50WzBdXShnZW5lcmljLmVsZW1lbnRbYXV0b0V2ZW50WzFdXSk7XG4gICAgfTtcblxuICAgIGdlbmVyaWMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG5cbiAgICBnZW5lcmljLm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZ2VuZXJpYy5lbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBpZihjaGlsZHJlbi5sZW5ndGggPT09IDEgJiYgIWZhc3RuLmlzQ29tcG9uZW50KGNoaWxkcmVuWzBdKSl7XG4gICAgICAgIHNldHRpbmdzLnRleHRDb250ZW50ID0gY2hpbGRyZW4ucG9wKCk7XG4gICAgfVxuXG4gICAgdmFyIGdlbmVyaWMgPSBjb250YWluZXJDb21wb25lbnQodHlwZSwgZmFzdG4pO1xuXG4gICAgY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3MpO1xuXG4gICAgZ2VuZXJpYy5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQgPSBjcmVsKHR5cGUpO1xuXG4gICAgICAgIGdlbmVyaWMuZW1pdCgncmVuZGVyJyk7XG5cbiAgICAgICAgcmV0dXJuIGdlbmVyaWM7XG4gICAgfTtcblxuICAgIGdlbmVyaWMub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG5cbiAgICAgICAgLy9cbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICAgICAgaWYoa2V5LnNsaWNlKDAsMikgPT09ICdvbicgJiYga2V5IGluIGdlbmVyaWMuZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkQXV0b0hhbmRsZXIoZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmb3IodmFyIGtleSBpbiBnZW5lcmljLl9ldmVudHMpe1xuICAgICAgICAgICAgaWYoJ29uJyArIGtleS50b0xvd2VyQ2FzZSgpIGluIGdlbmVyaWMuZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgYWRkVXBkYXRlSGFuZGxlcihnZW5lcmljLCBrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICB9KTtcblxuICAgIHJldHVybiBnZW5lcmljO1xufTsiLCJ2YXIgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyksXG4gICAgY3JlYXRlQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9jb21wb25lbnQnKSxcbiAgICBjcmVhdGVQcm9wZXJ0eSA9IHJlcXVpcmUoJy4vcHJvcGVydHknKSxcbiAgICBjcmVhdGVCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMjtcblxuICAgICAgICBpZihpcy5jb21wb25lbnQoYXJnc1sxXSkgfHwgdHlwZW9mIGFyZ3NbMV0gIT09ICdvYmplY3QnIHx8ICFhcmdzWzFdKXtcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXgtLTtcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjcmVhdGVDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzLCBhcmdzLnNsaWNlKGNoaWxkcmVuSW5kZXgpLCBjb21wb25lbnRzKTtcbiAgICB9XG5cbiAgICBmYXN0bi5kZWJ1ZyA9IGRlYnVnO1xuXG4gICAgZmFzdG4ucHJvcGVydHkgPSBjcmVhdGVQcm9wZXJ0eTtcblxuICAgIGZhc3RuLmJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nO1xuXG4gICAgZmFzdG4uaXNDb21wb25lbnQgPSBpcy5jb21wb25lbnQ7XG4gICAgZmFzdG4uaXNCaW5kaW5nID0gaXMuYmluZGluZztcbiAgICBmYXN0bi5pc0JpbmRpbmdPYmplY3QgPSBpcy5iaW5kaW5nT2JqZWN0O1xuICAgIGZhc3RuLmlzUHJvcGVydHkgPSBpcy5wcm9wZXJ0eTtcblxuICAgIHJldHVybiBmYXN0bjtcbn07IiwiXG5mdW5jdGlvbiBpc0NvbXBvbmVudCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9jb21wb25lbnQnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmdPYmplY3QodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc1Byb3BlcnR5KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fcHJvcGVydHknIGluIHRoaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb21wb25lbnQ6IGlzQ29tcG9uZW50LFxuICAgIGJpbmRpbmdPYmplY3Q6IGlzQmluZGluZ09iamVjdCxcbiAgICBiaW5kaW5nOiBpc0JpbmRpbmcsXG4gICAgcHJvcGVydHk6IGlzUHJvcGVydHlcbn07IiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgZ2VuZXJpY0NvbXBvbmVudCA9IHJlcXVpcmUoJy4vZ2VuZXJpY0NvbXBvbmVudCcpO1xuXG5mdW5jdGlvbiBlYWNoKHZhbHVlLCBmbil7XG4gICAgaWYoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KHZhbHVlKTtcblxuICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgaWYoaXNBcnJheSAmJiBpc05hTihrZXkpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgZm4odmFsdWVba2V5XSwga2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGtleUZvcihvYmplY3QsIHZhbHVlKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgIGlmKG9iamVjdFtrZXldID09PSB2YWx1ZSl7XG4gICAgICAgICAgICByZXR1cm4ga2V5O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiB2YWx1ZXMob2JqZWN0KXtcbiAgICBpZihBcnJheS5pc0FycmF5KG9iamVjdCkpe1xuICAgICAgICByZXR1cm4gb2JqZWN0LnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgcmVzdWx0LnB1c2gob2JqZWN0W2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGxpc3QgPSBnZW5lcmljQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pLFxuICAgICAgICBsYXN0SXRlbXMgPSBbXSxcbiAgICAgICAgbGFzdENvbXBvbmVudHMgPSBbXTtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZUl0ZW1zKHZhbHVlKXtcbiAgICAgICAgdmFyIHRlbXBsYXRlID0gbGlzdC5fc2V0dGluZ3MudGVtcGxhdGU7XG4gICAgICAgIGlmKCF0ZW1wbGF0ZSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY3VycmVudEl0ZW1zID0gdmFsdWVzKHZhbHVlKTtcblxuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGFzdEl0ZW1zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBpdGVtID0gbGFzdEl0ZW1zW2ldLFxuICAgICAgICAgICAgICAgIGNvbXBvbmVudCA9IGxhc3RDb21wb25lbnRzW2ldLFxuICAgICAgICAgICAgICAgIGN1cnJlbnRJbmRleCA9IGN1cnJlbnRJdGVtcy5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXMuc3BsaWNlKGN1cnJlbnRJbmRleCwxKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGxhc3RJdGVtcy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgbGFzdENvbXBvbmVudHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICAgIGktLTtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuZGVzdHJveSgpO1xuICAgICAgICAgICAgICAgIGxpc3QucmVtb3ZlKGNvbXBvbmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICAgICAgbmV3SXRlbXMgPSBbXSxcbiAgICAgICAgICAgIG5ld0NvbXBvbmVudHMgPSBbXTtcblxuICAgICAgICBlYWNoKHZhbHVlLCBmdW5jdGlvbihpdGVtLCBrZXkpe1xuICAgICAgICAgICAgdmFyIGNoaWxkLFxuICAgICAgICAgICAgICAgIGxhc3RLZXkgPSBrZXlGb3IobGFzdEl0ZW1zLCBpdGVtKTtcblxuICAgICAgICAgICAgaWYobGFzdEtleSA9PT0gZmFsc2Upe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gdGVtcGxhdGUoaXRlbSwga2V5LCBsaXN0LnNjb3BlKCkpO1xuICAgICAgICAgICAgICAgIGNoaWxkLl90ZW1wbGF0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgbmV3SXRlbXMucHVzaChpdGVtKTtcbiAgICAgICAgICAgICAgICBuZXdDb21wb25lbnRzLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgbmV3SXRlbXMucHVzaChsYXN0SXRlbXNbbGFzdEtleV0pO1xuICAgICAgICAgICAgICAgIGxhc3RJdGVtcy5zcGxpY2UobGFzdEtleSwxKVxuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBsYXN0Q29tcG9uZW50c1tsYXN0S2V5XTtcbiAgICAgICAgICAgICAgICBsYXN0Q29tcG9uZW50cy5zcGxpY2UobGFzdEtleSwxKTtcbiAgICAgICAgICAgICAgICBuZXdDb21wb25lbnRzLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjaGlsZCkpe1xuICAgICAgICAgICAgICAgIGlmKGl0ZW0gJiYgdHlwZW9mIGl0ZW0gPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQuYXR0YWNoKGl0ZW0sIHRydWUpO1xuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC5hdHRhY2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaXRlbTogaXRlbSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleToga2V5XG4gICAgICAgICAgICAgICAgICAgIH0sIHRydWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGlzdC5pbnNlcnQoY2hpbGQsIGluZGV4KTtcblxuICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGFzdEl0ZW1zID0gbmV3SXRlbXM7XG4gICAgICAgIGxhc3RDb21wb25lbnRzID0gbmV3Q29tcG9uZW50cztcbiAgICB9XG5cbiAgICBsaXN0LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHRoaXMuZWxlbWVudCA9IGNyZWwoJ2RpdicpO1xuICAgICAgICB0aGlzLml0ZW1zLm9uKCd1cGRhdGUnLCB1cGRhdGVJdGVtcyk7XG4gICAgICAgIHVwZGF0ZUl0ZW1zKHRoaXMuaXRlbXMoKSk7XG4gICAgICAgIHRoaXMuZW1pdCgncmVuZGVyJyk7XG4gICAgfTtcblxuICAgIGxpc3QuaXRlbXMgPSBmYXN0bi5wcm9wZXJ0eShbXSwgdXBkYXRlSXRlbXMpLmJpbmRpbmcoc2V0dGluZ3MuaXRlbXMpO1xuICAgIGxpc3Qub24oJ2F0dGFjaCcsIGxpc3QuaXRlbXMuYXR0YWNoKTtcblxuICAgIHJldHVybiBsaXN0O1xufTsiLCIvL0NvcHlyaWdodCAoQykgMjAxMiBLb3J5IE51bm5cclxuXHJcbi8vUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcclxuXHJcbi8vVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXHJcblxyXG4vL1RIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxyXG5cclxuLypcclxuXHJcbiAgICBUaGlzIGNvZGUgaXMgbm90IGZvcm1hdHRlZCBmb3IgcmVhZGFiaWxpdHksIGJ1dCByYXRoZXIgcnVuLXNwZWVkIGFuZCB0byBhc3Npc3QgY29tcGlsZXJzLlxyXG5cclxuICAgIEhvd2V2ZXIsIHRoZSBjb2RlJ3MgaW50ZW50aW9uIHNob3VsZCBiZSB0cmFuc3BhcmVudC5cclxuXHJcbiAgICAqKiogSUUgU1VQUE9SVCAqKipcclxuXHJcbiAgICBJZiB5b3UgcmVxdWlyZSB0aGlzIGxpYnJhcnkgdG8gd29yayBpbiBJRTcsIGFkZCB0aGUgZm9sbG93aW5nIGFmdGVyIGRlY2xhcmluZyBjcmVsLlxyXG5cclxuICAgIHZhciB0ZXN0RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcbiAgICAgICAgdGVzdExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGFiZWwnKTtcclxuXHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnYScpO1xyXG4gICAgdGVzdERpdlsnY2xhc3NOYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnY2xhc3MnXSA9ICdjbGFzc05hbWUnOnVuZGVmaW5lZDtcclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCduYW1lJywnYScpO1xyXG4gICAgdGVzdERpdlsnbmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ25hbWUnXSA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcclxuICAgICAgICBlbGVtZW50LmlkID0gdmFsdWU7XHJcbiAgICB9OnVuZGVmaW5lZDtcclxuXHJcblxyXG4gICAgdGVzdExhYmVsLnNldEF0dHJpYnV0ZSgnZm9yJywgJ2EnKTtcclxuICAgIHRlc3RMYWJlbFsnaHRtbEZvciddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2ZvciddID0gJ2h0bWxGb3InOnVuZGVmaW5lZDtcclxuXHJcblxyXG5cclxuKi9cclxuXHJcbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xyXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcclxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJvb3QuY3JlbCA9IGZhY3RvcnkoKTtcclxuICAgIH1cclxufSh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICB2YXIgZm4gPSAnZnVuY3Rpb24nLFxyXG4gICAgICAgIG9iaiA9ICdvYmplY3QnLFxyXG4gICAgICAgIGlzVHlwZSA9IGZ1bmN0aW9uKGEsIHR5cGUpe1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc05vZGUgPSB0eXBlb2YgTm9kZSA9PT0gZm4gPyBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBOb2RlO1xyXG4gICAgICAgIH0gOlxyXG4gICAgICAgIC8vIGluIElFIDw9IDggTm9kZSBpcyBhbiBvYmplY3QsIG9idmlvdXNseS4uXHJcbiAgICAgICAgZnVuY3Rpb24ob2JqZWN0KXtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdCwgb2JqKSAmJlxyXG4gICAgICAgICAgICAgICAgKCdub2RlVHlwZScgaW4gb2JqZWN0KSAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdC5vd25lckRvY3VtZW50LG9iaik7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0VsZW1lbnQgPSBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBjcmVsLmlzTm9kZShvYmplY3QpICYmIG9iamVjdC5ub2RlVHlwZSA9PT0gMTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzQXJyYXkgPSBmdW5jdGlvbihhKXtcclxuICAgICAgICAgICAgcmV0dXJuIGEgaW5zdGFuY2VvZiBBcnJheTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGFwcGVuZENoaWxkID0gZnVuY3Rpb24oZWxlbWVudCwgY2hpbGQpIHtcclxuICAgICAgICAgIGlmKCFpc05vZGUoY2hpbGQpKXtcclxuICAgICAgICAgICAgICBjaGlsZCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGNoaWxkKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGVsZW1lbnQuYXBwZW5kQ2hpbGQoY2hpbGQpO1xyXG4gICAgICAgIH07XHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGNyZWwoKXtcclxuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cywgLy9Ob3RlOiBhc3NpZ25lZCB0byBhIHZhcmlhYmxlIHRvIGFzc2lzdCBjb21waWxlcnMuIFNhdmVzIGFib3V0IDQwIGJ5dGVzIGluIGNsb3N1cmUgY29tcGlsZXIuIEhhcyBuZWdsaWdhYmxlIGVmZmVjdCBvbiBwZXJmb3JtYW5jZS5cclxuICAgICAgICAgICAgZWxlbWVudCA9IGFyZ3NbMF0sXHJcbiAgICAgICAgICAgIGNoaWxkLFxyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IGFyZ3NbMV0sXHJcbiAgICAgICAgICAgIGNoaWxkSW5kZXggPSAyLFxyXG4gICAgICAgICAgICBhcmd1bWVudHNMZW5ndGggPSBhcmdzLmxlbmd0aCxcclxuICAgICAgICAgICAgYXR0cmlidXRlTWFwID0gY3JlbC5hdHRyTWFwO1xyXG5cclxuICAgICAgICBlbGVtZW50ID0gY3JlbC5pc0VsZW1lbnQoZWxlbWVudCkgPyBlbGVtZW50IDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudChlbGVtZW50KTtcclxuICAgICAgICAvLyBzaG9ydGN1dFxyXG4gICAgICAgIGlmKGFyZ3VtZW50c0xlbmd0aCA9PT0gMSl7XHJcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYoIWlzVHlwZShzZXR0aW5ncyxvYmopIHx8IGNyZWwuaXNOb2RlKHNldHRpbmdzKSB8fCBpc0FycmF5KHNldHRpbmdzKSkge1xyXG4gICAgICAgICAgICAtLWNoaWxkSW5kZXg7XHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHNob3J0Y3V0IGlmIHRoZXJlIGlzIG9ubHkgb25lIGNoaWxkIHRoYXQgaXMgYSBzdHJpbmdcclxuICAgICAgICBpZigoYXJndW1lbnRzTGVuZ3RoIC0gY2hpbGRJbmRleCkgPT09IDEgJiYgaXNUeXBlKGFyZ3NbY2hpbGRJbmRleF0sICdzdHJpbmcnKSAmJiBlbGVtZW50LnRleHRDb250ZW50ICE9PSB1bmRlZmluZWQpe1xyXG4gICAgICAgICAgICBlbGVtZW50LnRleHRDb250ZW50ID0gYXJnc1tjaGlsZEluZGV4XTtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgZm9yKDsgY2hpbGRJbmRleCA8IGFyZ3VtZW50c0xlbmd0aDsgKytjaGlsZEluZGV4KXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gYXJnc1tjaGlsZEluZGV4XTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZihjaGlsZCA9PSBudWxsKXtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgY2hpbGQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xyXG4gICAgICAgICAgICBpZighYXR0cmlidXRlTWFwW2tleV0pe1xyXG4gICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoa2V5LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICB2YXIgYXR0ciA9IGNyZWwuYXR0ck1hcFtrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYodHlwZW9mIGF0dHIgPT09IGZuKXtcclxuICAgICAgICAgICAgICAgICAgICBhdHRyKGVsZW1lbnQsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ciwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZWQgZm9yIG1hcHBpbmcgb25lIGtpbmQgb2YgYXR0cmlidXRlIHRvIHRoZSBzdXBwb3J0ZWQgdmVyc2lvbiBvZiB0aGF0IGluIGJhZCBicm93c2Vycy5cclxuICAgIC8vIFN0cmluZyByZWZlcmVuY2VkIHNvIHRoYXQgY29tcGlsZXJzIG1haW50YWluIHRoZSBwcm9wZXJ0eSBuYW1lLlxyXG4gICAgY3JlbFsnYXR0ck1hcCddID0ge307XHJcblxyXG4gICAgLy8gU3RyaW5nIHJlZmVyZW5jZWQgc28gdGhhdCBjb21waWxlcnMgbWFpbnRhaW4gdGhlIHByb3BlcnR5IG5hbWUuXHJcbiAgICBjcmVsW1wiaXNFbGVtZW50XCJdID0gaXNFbGVtZW50O1xyXG4gICAgY3JlbFtcImlzTm9kZVwiXSA9IGlzTm9kZTtcclxuXHJcbiAgICByZXR1cm4gY3JlbDtcclxufSkpO1xyXG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG5mdW5jdGlvbiBrZXlzQXJlRGlmZmVyZW50KGtleXMxLCBrZXlzMil7XG4gICAgaWYoa2V5czEgPT09IGtleXMyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZigha2V5czEgfHwgIWtleXMyIHx8IGtleXMxLmxlbmd0aCAhPT0ga2V5czIubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzMS5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKCF+a2V5czIuaW5kZXhPZihrZXlzMVtpXSkpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSl7XG4gICAgICAgIHJlc3VsdC50eXBlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ2tleXMnIGluIGNoYW5nZXNUb1RyYWNrICYmIGtleXNBcmVEaWZmZXJlbnQodGhpcy5fbGFzdEtleXMsIGdldEtleXModmFsdWUpKSl7XG4gICAgICAgIHJlc3VsdC5rZXlzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKXtcbiAgICAgICAgaWYoJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgIWRlZXBFcXVhbCh2YWx1ZSwgdGhpcy5fbGFzdFZhbHVlKSl7XG4gICAgICAgICAgICByZXN1bHQuc3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZigncmVmZXJlbmNlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB2YWx1ZSAhPT0gdGhpcy5fbGFzdFJlZmVyZW5jZSl7XG4gICAgICAgICAgICByZXN1bHQucmVmZXJlbmNlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2xhc3RWYWx1ZSA9ICdzdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrID8gY2xvbmUodmFsdWUpIDogdmFsdWU7XG4gICAgdGhpcy5fbGFzdFJlZmVyZW5jZSA9IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RLZXlzID0gbmV3S2V5cztcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdoYXRDaGFuZ2VkOyIsIihmdW5jdGlvbiAoQnVmZmVyKXtcbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gb2JqZWN0VG9TdHJpbmcobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufVxuXG4vLyBzaGltIGZvciBOb2RlJ3MgJ3V0aWwnIHBhY2thZ2Vcbi8vIERPIE5PVCBSRU1PVkUgVEhJUyEgSXQgaXMgcmVxdWlyZWQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBFbmRlckpTIChodHRwOi8vZW5kZXJqcy5jb20vKS5cbnZhciB1dGlsID0ge1xuICBpc0FycmF5OiBmdW5jdGlvbiAoYXIpIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShhcikgfHwgKHR5cGVvZiBhciA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoYXIpID09PSAnW29iamVjdCBBcnJheV0nKTtcbiAgfSxcbiAgaXNEYXRlOiBmdW5jdGlvbiAoZCkge1xuICAgIHJldHVybiB0eXBlb2YgZCA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZCkgPT09ICdbb2JqZWN0IERhdGVdJztcbiAgfSxcbiAgaXNSZWdFeHA6IGZ1bmN0aW9uIChyZSkge1xuICAgIHJldHVybiB0eXBlb2YgcmUgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKHJlKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7XG4gIH0sXG4gIGdldFJlZ0V4cEZsYWdzOiBmdW5jdGlvbiAocmUpIHtcbiAgICB2YXIgZmxhZ3MgPSAnJztcbiAgICByZS5nbG9iYWwgJiYgKGZsYWdzICs9ICdnJyk7XG4gICAgcmUuaWdub3JlQ2FzZSAmJiAoZmxhZ3MgKz0gJ2knKTtcbiAgICByZS5tdWx0aWxpbmUgJiYgKGZsYWdzICs9ICdtJyk7XG4gICAgcmV0dXJuIGZsYWdzO1xuICB9XG59O1xuXG5cbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JylcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcblxuLyoqXG4gKiBDbG9uZXMgKGNvcGllcykgYW4gT2JqZWN0IHVzaW5nIGRlZXAgY29weWluZy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHN1cHBvcnRzIGNpcmN1bGFyIHJlZmVyZW5jZXMgYnkgZGVmYXVsdCwgYnV0IGlmIHlvdSBhcmUgY2VydGFpblxuICogdGhlcmUgYXJlIG5vIGNpcmN1bGFyIHJlZmVyZW5jZXMgaW4geW91ciBvYmplY3QsIHlvdSBjYW4gc2F2ZSBzb21lIENQVSB0aW1lXG4gKiBieSBjYWxsaW5nIGNsb25lKG9iaiwgZmFsc2UpLlxuICpcbiAqIENhdXRpb246IGlmIGBjaXJjdWxhcmAgaXMgZmFsc2UgYW5kIGBwYXJlbnRgIGNvbnRhaW5zIGNpcmN1bGFyIHJlZmVyZW5jZXMsXG4gKiB5b3VyIHByb2dyYW0gbWF5IGVudGVyIGFuIGluZmluaXRlIGxvb3AgYW5kIGNyYXNoLlxuICpcbiAqIEBwYXJhbSBgcGFyZW50YCAtIHRoZSBvYmplY3QgdG8gYmUgY2xvbmVkXG4gKiBAcGFyYW0gYGNpcmN1bGFyYCAtIHNldCB0byB0cnVlIGlmIHRoZSBvYmplY3QgdG8gYmUgY2xvbmVkIG1heSBjb250YWluXG4gKiAgICBjaXJjdWxhciByZWZlcmVuY2VzLiAob3B0aW9uYWwgLSB0cnVlIGJ5IGRlZmF1bHQpXG4gKiBAcGFyYW0gYGRlcHRoYCAtIHNldCB0byBhIG51bWJlciBpZiB0aGUgb2JqZWN0IGlzIG9ubHkgdG8gYmUgY2xvbmVkIHRvXG4gKiAgICBhIHBhcnRpY3VsYXIgZGVwdGguIChvcHRpb25hbCAtIGRlZmF1bHRzIHRvIEluZmluaXR5KVxuICogQHBhcmFtIGBwcm90b3R5cGVgIC0gc2V0cyB0aGUgcHJvdG90eXBlIHRvIGJlIHVzZWQgd2hlbiBjbG9uaW5nIGFuIG9iamVjdC5cbiAqICAgIChvcHRpb25hbCAtIGRlZmF1bHRzIHRvIHBhcmVudCBwcm90b3R5cGUpLlxuKi9cblxuZnVuY3Rpb24gY2xvbmUocGFyZW50LCBjaXJjdWxhciwgZGVwdGgsIHByb3RvdHlwZSkge1xuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAodXRpbC5pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmICh1dGlsLmlzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCB1dGlsLmdldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmICh1dGlsLmlzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbihwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIpIiwidmFyIHBTbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbnZhciBvYmplY3RLZXlzID0gcmVxdWlyZSgnLi9saWIva2V5cy5qcycpO1xudmFyIGlzQXJndW1lbnRzID0gcmVxdWlyZSgnLi9saWIvaXNfYXJndW1lbnRzLmpzJyk7XG5cbnZhciBkZWVwRXF1YWwgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhY3R1YWwsIGV4cGVjdGVkLCBvcHRzKSB7XG4gIGlmICghb3B0cykgb3B0cyA9IHt9O1xuICAvLyA3LjEuIEFsbCBpZGVudGljYWwgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBhcyBkZXRlcm1pbmVkIGJ5ID09PS5cbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2UgaWYgKGFjdHVhbCBpbnN0YW5jZW9mIERhdGUgJiYgZXhwZWN0ZWQgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgcmV0dXJuIGFjdHVhbC5nZXRUaW1lKCkgPT09IGV4cGVjdGVkLmdldFRpbWUoKTtcblxuICAvLyA3LjMuIE90aGVyIHBhaXJzIHRoYXQgZG8gbm90IGJvdGggcGFzcyB0eXBlb2YgdmFsdWUgPT0gJ29iamVjdCcsXG4gIC8vIGVxdWl2YWxlbmNlIGlzIGRldGVybWluZWQgYnkgPT0uXG4gIH0gZWxzZSBpZiAodHlwZW9mIGFjdHVhbCAhPSAnb2JqZWN0JyAmJiB0eXBlb2YgZXhwZWN0ZWQgIT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gb3B0cy5zdHJpY3QgPyBhY3R1YWwgPT09IGV4cGVjdGVkIDogYWN0dWFsID09IGV4cGVjdGVkO1xuXG4gIC8vIDcuNC4gRm9yIGFsbCBvdGhlciBPYmplY3QgcGFpcnMsIGluY2x1ZGluZyBBcnJheSBvYmplY3RzLCBlcXVpdmFsZW5jZSBpc1xuICAvLyBkZXRlcm1pbmVkIGJ5IGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoYXMgdmVyaWZpZWRcbiAgLy8gd2l0aCBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwpLCB0aGUgc2FtZSBzZXQgb2Yga2V5c1xuICAvLyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSwgZXF1aXZhbGVudCB2YWx1ZXMgZm9yIGV2ZXJ5XG4gIC8vIGNvcnJlc3BvbmRpbmcga2V5LCBhbmQgYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LiBOb3RlOiB0aGlzXG4gIC8vIGFjY291bnRzIGZvciBib3RoIG5hbWVkIGFuZCBpbmRleGVkIHByb3BlcnRpZXMgb24gQXJyYXlzLlxuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmpFcXVpdihhY3R1YWwsIGV4cGVjdGVkLCBvcHRzKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZE9yTnVsbCh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNCdWZmZXIgKHgpIHtcbiAgaWYgKCF4IHx8IHR5cGVvZiB4ICE9PSAnb2JqZWN0JyB8fCB0eXBlb2YgeC5sZW5ndGggIT09ICdudW1iZXInKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgeC5jb3B5ICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiB4LnNsaWNlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICh4Lmxlbmd0aCA+IDAgJiYgdHlwZW9mIHhbMF0gIT09ICdudW1iZXInKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBvYmpFcXVpdihhLCBiLCBvcHRzKSB7XG4gIHZhciBpLCBrZXk7XG4gIGlmIChpc1VuZGVmaW5lZE9yTnVsbChhKSB8fCBpc1VuZGVmaW5lZE9yTnVsbChiKSlcbiAgICByZXR1cm4gZmFsc2U7XG4gIC8vIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS5cbiAgaWYgKGEucHJvdG90eXBlICE9PSBiLnByb3RvdHlwZSkgcmV0dXJuIGZhbHNlO1xuICAvL35+fkkndmUgbWFuYWdlZCB0byBicmVhayBPYmplY3Qua2V5cyB0aHJvdWdoIHNjcmV3eSBhcmd1bWVudHMgcGFzc2luZy5cbiAgLy8gICBDb252ZXJ0aW5nIHRvIGFycmF5IHNvbHZlcyB0aGUgcHJvYmxlbS5cbiAgaWYgKGlzQXJndW1lbnRzKGEpKSB7XG4gICAgaWYgKCFpc0FyZ3VtZW50cyhiKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBhID0gcFNsaWNlLmNhbGwoYSk7XG4gICAgYiA9IHBTbGljZS5jYWxsKGIpO1xuICAgIHJldHVybiBkZWVwRXF1YWwoYSwgYiwgb3B0cyk7XG4gIH1cbiAgaWYgKGlzQnVmZmVyKGEpKSB7XG4gICAgaWYgKCFpc0J1ZmZlcihiKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgZm9yIChpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhW2ldICE9PSBiW2ldKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRyeSB7XG4gICAgdmFyIGthID0gb2JqZWN0S2V5cyhhKSxcbiAgICAgICAga2IgPSBvYmplY3RLZXlzKGIpO1xuICB9IGNhdGNoIChlKSB7Ly9oYXBwZW5zIHdoZW4gb25lIGlzIGEgc3RyaW5nIGxpdGVyYWwgYW5kIHRoZSBvdGhlciBpc24ndFxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvLyBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGtleXMgaW5jb3Jwb3JhdGVzXG4gIC8vIGhhc093blByb3BlcnR5KVxuICBpZiAoa2EubGVuZ3RoICE9IGtiLmxlbmd0aClcbiAgICByZXR1cm4gZmFsc2U7XG4gIC8vdGhlIHNhbWUgc2V0IG9mIGtleXMgKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksXG4gIGthLnNvcnQoKTtcbiAga2Iuc29ydCgpO1xuICAvL35+fmNoZWFwIGtleSB0ZXN0XG4gIGZvciAoaSA9IGthLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKGthW2ldICE9IGtiW2ldKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8vZXF1aXZhbGVudCB2YWx1ZXMgZm9yIGV2ZXJ5IGNvcnJlc3BvbmRpbmcga2V5LCBhbmRcbiAgLy9+fn5wb3NzaWJseSBleHBlbnNpdmUgZGVlcCB0ZXN0XG4gIGZvciAoaSA9IGthLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAga2V5ID0ga2FbaV07XG4gICAgaWYgKCFkZWVwRXF1YWwoYVtrZXldLCBiW2tleV0sIG9wdHMpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCJ2YXIgc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA9IChmdW5jdGlvbigpe1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZ3VtZW50cylcbn0pKCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPyBzdXBwb3J0ZWQgOiB1bnN1cHBvcnRlZDtcblxuZXhwb3J0cy5zdXBwb3J0ZWQgPSBzdXBwb3J0ZWQ7XG5mdW5jdGlvbiBzdXBwb3J0ZWQob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn07XG5cbmV4cG9ydHMudW5zdXBwb3J0ZWQgPSB1bnN1cHBvcnRlZDtcbmZ1bmN0aW9uIHVuc3VwcG9ydGVkKG9iamVjdCl7XG4gIHJldHVybiBvYmplY3QgJiZcbiAgICB0eXBlb2Ygb2JqZWN0ID09ICdvYmplY3QnICYmXG4gICAgdHlwZW9mIG9iamVjdC5sZW5ndGggPT0gJ251bWJlcicgJiZcbiAgICBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2FsbGVlJykgJiZcbiAgICAhT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpIHx8XG4gICAgZmFsc2U7XG59O1xuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gID8gT2JqZWN0LmtleXMgOiBzaGltO1xuXG5leHBvcnRzLnNoaW0gPSBzaGltO1xuZnVuY3Rpb24gc2hpbSAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIGtleXMucHVzaChrZXkpO1xuICByZXR1cm4ga2V5cztcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBXaGF0Q2hhbmdlZCA9IHJlcXVpcmUoJ3doYXQtY2hhbmdlZCcpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHByb3BlcnR5KGN1cnJlbnRWYWx1ZSl7XG4gICAgdmFyIGJpbmRpbmcsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBwcmV2aW91cyA9IG5ldyBXaGF0Q2hhbmdlZChjdXJyZW50VmFsdWUsICd2YWx1ZSB0eXBlIHJlZmVyZW5jZSBrZXlzJyk7XG5cbiAgICBmdW5jdGlvbiBwcm9wZXJ0eSh2YWx1ZSl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nICYmIGJpbmRpbmcoKSB8fCBjdXJyZW50VmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZighT2JqZWN0LmtleXMocHJldmlvdXMudXBkYXRlKHZhbHVlKSkubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN1cnJlbnRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICBiaW5kaW5nICYmIGJpbmRpbmcodmFsdWUpO1xuICAgICAgICBwcm9wZXJ0eS5lbWl0KCdjaGFuZ2UnLCB2YWx1ZSk7XG4gICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuXG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGVtaXR0ZXJLZXkgaW4gRXZlbnRFbWl0dGVyLnByb3RvdHlwZSl7XG4gICAgICAgIHByb3BlcnR5W2VtaXR0ZXJLZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtlbWl0dGVyS2V5XTtcbiAgICB9XG5cbiAgICBwcm9wZXJ0eS5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG4gICAgICAgIGlmKG1vZGVsKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmF0dGFjaChtb2RlbCwgIXByb3BlcnR5Ll9maXJtKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIHByb3BlcnR5Ll9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3BlcnR5Ll9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgbW9kZWwgPSBvYmplY3Q7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIHRydWUpO1xuICAgICAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICAgICAgcHJvcGVydHkoYmluZGluZygpKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgICAgICBiaW5kaW5nLmRldGFjaCh0cnVlKTtcbiAgICAgICAgICAgIG1vZGVsID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkudXBkYXRlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcHJvcGVydHkuZW1pdCgndXBkYXRlJywgY3VycmVudFZhbHVlKTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59OyIsInZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgV00gPSByZXF1aXJlKCcuL3dlYWttYXAnKTtcblxudmFyIGF0dGFjaGVkRW50aWVzID0gbmV3IFdNKCk7XG5cbmZ1bmN0aW9uIGVtaXQobW9kZWwsIGtleSwgdmFsdWUpe1xuICAgIHZhciByZWZlcmVuY2VzID0gYXR0YWNoZWRFbnRpZXMuZ2V0KG1vZGVsKTtcblxuICAgIGlmKCFyZWZlcmVuY2VzIHx8ICFyZWZlcmVuY2VzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdG9FbWl0ID0gcmVmZXJlbmNlcy5zbGljZSgpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IHRvRW1pdC5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKH5yZWZlcmVuY2VzLmluZGV4T2YodG9FbWl0W2ldKSl7XG4gICAgICAgICAgICB0b0VtaXRbaV0uZW1pdChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gRW50aShtb2RlbCl7XG4gICAgaWYoIW1vZGVsIHx8ICh0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2RlbCAhPT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBtb2RlbCA9IHt9O1xuICAgIH1cbiAgICAgICAgXG4gICAgdGhpcy5hdHRhY2gobW9kZWwpO1xufVxuRW50aS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEV2ZW50RW1pdHRlci5wcm90b3R5cGUpO1xuRW50aS5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBFbnRpO1xuRW50aS5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24obW9kZWwpe1xuICAgIHRoaXMuZGV0YWNoKCk7XG5cbiAgICB2YXIgcmVmZXJlbmNlcyA9IGF0dGFjaGVkRW50aWVzLmdldChtb2RlbCk7XG5cbiAgICBpZighcmVmZXJlbmNlcyl7XG4gICAgICAgIHJlZmVyZW5jZXMgPSBbXTtcbiAgICAgICAgYXR0YWNoZWRFbnRpZXMuc2V0KG1vZGVsLCByZWZlcmVuY2VzKTtcbiAgICB9XG5cbiAgICByZWZlcmVuY2VzLnB1c2godGhpcyk7XG5cbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsO1xufTtcbkVudGkucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCl7XG4gICAgaWYoIXRoaXMuX21vZGVsKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgcmVmZXJlbmNlcyA9IGF0dGFjaGVkRW50aWVzLmdldCh0aGlzLl9tb2RlbCk7XG5cbiAgICBpZighcmVmZXJlbmNlcyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZWZlcmVuY2VzLnNwbGljZShyZWZlcmVuY2VzLmluZGV4T2YodGhpcyksMSk7XG59O1xuRW50aS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICBpZihrZXkgPT09ICcuJyl7XG4gICAgICAgIHJldHVybiB0aGlzLl9tb2RlbDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX21vZGVsW2tleV07XG59O1xuXG5FbnRpLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YXIgb3JpZ2luYWwgPSB0aGlzLl9tb2RlbFtrZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXNDaGFuZ2VkID0gIShrZXkgaW4gdGhpcy5fbW9kZWwpO1xuXG4gICAgdGhpcy5fbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgZW1pdCh0aGlzLl9tb2RlbCwga2V5LCB2YWx1ZSk7XG5cbiAgICBpZihrZXlzQ2hhbmdlZCl7XG4gICAgICAgIGVtaXQodGhpcy5fbW9kZWwsICcqJywgdGhpcy5fbW9kZWwpO1xuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX21vZGVsKSl7XG4gICAgICAgICAgICBlbWl0KHRoaXMuX21vZGVsLCAnbGVuZ3RoJywgdGhpcy5fbW9kZWwubGVuZ3RoKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbkVudGkucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YXIgdGFyZ2V0O1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPCAyKXtcbiAgICAgICAgdmFsdWUgPSBrZXk7XG4gICAgICAgIGtleSA9ICcuJztcbiAgICAgICAgdGFyZ2V0ID0gdGhpcy5fbW9kZWw7XG4gICAgfWVsc2V7XG4gICAgICAgIHRhcmdldCA9IHRoaXMuX21vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93ICdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nO1xuICAgIH1cblxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcblxuICAgIGVtaXQodGFyZ2V0LCB0YXJnZXQubGVuZ3RoLTEsIHZhbHVlKTtcblxuICAgIGVtaXQodGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aCk7XG5cbiAgICBlbWl0KHRhcmdldCwgJyonLCB0YXJnZXQpO1xufTtcblxuRW50aS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oa2V5LCBzdWJLZXkpe1xuXG4gICAgLy8gUmVtb3ZlIGEga2V5IG9mZiBvZiBhbiBvYmplY3QgYXQgJ2tleSdcbiAgICBpZihzdWJLZXkgIT0gbnVsbCl7XG4gICAgICAgIG5ldyBFbnRpKHRoaXMuX21vZGVsW2tleV0pLnJlbW92ZShzdWJLZXkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoa2V5ID09PSAnLicpe1xuICAgICAgICB0aHJvdyAnLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZSc7XG4gICAgfVxuXG4gICAgaWYoQXJyYXkuaXNBcnJheSh0aGlzLl9tb2RlbCkpe1xuICAgICAgICB0aGlzLl9tb2RlbC5zcGxpY2Uoa2V5LCAxKTtcbiAgICAgICAgZW1pdCh0aGlzLl9tb2RlbCwgJ2xlbmd0aCcsIHRoaXMuX21vZGVsLmxlbmd0aCk7XG4gICAgfWVsc2V7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9tb2RlbFtrZXldO1xuICAgIH1cblxuICAgIGVtaXQodGhpcy5fbW9kZWwsICcqJywgdGhpcy5fbW9kZWwpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBFbnRpO1xuIiwiZnVuY3Rpb24gdmFsaWRhdGVLZXkoa2V5KXtcbiAgICBpZigha2V5IHx8ICEodHlwZW9mIGtleSA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIGtleSA9PT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICB0aHJvdyBrZXkgKyBcIiBpcyBub3QgYSB2YWxpZCBXZWFrTWFwIGtleS5cIjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIExlYWtNYXAoKXtcbiAgICB0aGlzLmNsZWFyKCk7XG59XG5MZWFrTWFwLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCl7XG4gICAgdGhpcy5fa2V5cyA9IFtdO1xuICAgIHRoaXMuX3ZhbHVlcyA9IFtdO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFsaWRhdGVLZXkoa2V5KTtcbiAgICB2YXIga2V5SW5kZXggPSB0aGlzLl9rZXlzLmluZGV4T2Yoa2V5KTtcbiAgICBpZihrZXlJbmRleD49MCl7XG4gICAgICAgIHRoaXMuX2tleXMuc3BsaWNlKGtleUluZGV4LCAxKTtcbiAgICAgICAgdGhpcy5fdmFsdWVzLnNwbGljZShrZXlJbmRleCwgMSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xuICAgIHZhbGlkYXRlS2V5KGtleSk7XG4gICAgcmV0dXJuIHRoaXMuX3ZhbHVlc1t0aGlzLl9rZXlzLmluZGV4T2Yoa2V5KV07XG59O1xuTGVha01hcC5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuICAgIHJldHVybiAhIX50aGlzLl9rZXlzLmluZGV4T2Yoa2V5KTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuXG4gICAgLy8gRmF2b3JpdGUgcGllY2Ugb2Yga29lZCBldm9yLlxuICAgIC8vIElFIGRldnMgd291bGQgYmUgcHJvd2RlXG4gICAgdmFyIGtleUluZGV4ID0gKH50aGlzLl9rZXlzLmluZGV4T2Yoa2V5KSB8fCAodGhpcy5fa2V5cy5wdXNoKGtleSksIHRoaXMuX2tleXMubGVuZ3RoKSkgLSAxO1xuXG4gICAgdGhpcy5fdmFsdWVzW2tleUluZGV4XSA9IHZhbHVlO1xuICAgIHJldHVybiB0aGlzO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gJ1tvYmplY3QgV2Vha01hcF0nO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBMZWFrTWFwOyIsIi8vIENvcHlyaWdodCAoQykgMjAxMSBHb29nbGUgSW5jLlxuLy9cbi8vIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4vLyB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4vLyBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbi8vXG4vLyBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbi8vXG4vLyBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4vLyBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4vLyBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbi8vIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbi8vIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuXG4vKipcbiAqIEBmaWxlb3ZlcnZpZXcgSW5zdGFsbCBhIGxlYWt5IFdlYWtNYXAgZW11bGF0aW9uIG9uIHBsYXRmb3JtcyB0aGF0XG4gKiBkb24ndCBwcm92aWRlIGEgYnVpbHQtaW4gb25lLlxuICpcbiAqIDxwPkFzc3VtZXMgdGhhdCBhbiBFUzUgcGxhdGZvcm0gd2hlcmUsIGlmIHtAY29kZSBXZWFrTWFwfSBpc1xuICogYWxyZWFkeSBwcmVzZW50LCB0aGVuIGl0IGNvbmZvcm1zIHRvIHRoZSBhbnRpY2lwYXRlZCBFUzZcbiAqIHNwZWNpZmljYXRpb24uIFRvIHJ1biB0aGlzIGZpbGUgb24gYW4gRVM1IG9yIGFsbW9zdCBFUzVcbiAqIGltcGxlbWVudGF0aW9uIHdoZXJlIHRoZSB7QGNvZGUgV2Vha01hcH0gc3BlY2lmaWNhdGlvbiBkb2VzIG5vdFxuICogcXVpdGUgY29uZm9ybSwgcnVuIDxjb2RlPnJlcGFpckVTNS5qczwvY29kZT4gZmlyc3QuXG4gKlxuICogPHA+RXZlbiB0aG91Z2ggV2Vha01hcE1vZHVsZSBpcyBub3QgZ2xvYmFsLCB0aGUgbGludGVyIHRoaW5rcyBpdFxuICogaXMsIHdoaWNoIGlzIHdoeSBpdCBpcyBpbiB0aGUgb3ZlcnJpZGVzIGxpc3QgYmVsb3cuXG4gKlxuICogPHA+Tk9URTogQmVmb3JlIHVzaW5nIHRoaXMgV2Vha01hcCBlbXVsYXRpb24gaW4gYSBub24tU0VTXG4gKiBlbnZpcm9ubWVudCwgc2VlIHRoZSBub3RlIGJlbG93IGFib3V0IGhpZGRlblJlY29yZC5cbiAqXG4gKiBAYXV0aG9yIE1hcmsgUy4gTWlsbGVyXG4gKiBAcmVxdWlyZXMgY3J5cHRvLCBBcnJheUJ1ZmZlciwgVWludDhBcnJheSwgbmF2aWdhdG9yLCBjb25zb2xlXG4gKiBAb3ZlcnJpZGVzIFdlYWtNYXAsIHNlcywgUHJveHlcbiAqIEBvdmVycmlkZXMgV2Vha01hcE1vZHVsZVxuICovXG5cbi8qKlxuICogVGhpcyB7QGNvZGUgV2Vha01hcH0gZW11bGF0aW9uIGlzIG9ic2VydmFibHkgZXF1aXZhbGVudCB0byB0aGVcbiAqIEVTLUhhcm1vbnkgV2Vha01hcCwgYnV0IHdpdGggbGVha2llciBnYXJiYWdlIGNvbGxlY3Rpb24gcHJvcGVydGllcy5cbiAqXG4gKiA8cD5BcyB3aXRoIHRydWUgV2Vha01hcHMsIGluIHRoaXMgZW11bGF0aW9uLCBhIGtleSBkb2VzIG5vdFxuICogcmV0YWluIG1hcHMgaW5kZXhlZCBieSB0aGF0IGtleSBhbmQgKGNydWNpYWxseSkgYSBtYXAgZG9lcyBub3RcbiAqIHJldGFpbiB0aGUga2V5cyBpdCBpbmRleGVzLiBBIG1hcCBieSBpdHNlbGYgYWxzbyBkb2VzIG5vdCByZXRhaW5cbiAqIHRoZSB2YWx1ZXMgYXNzb2NpYXRlZCB3aXRoIHRoYXQgbWFwLlxuICpcbiAqIDxwPkhvd2V2ZXIsIHRoZSB2YWx1ZXMgYXNzb2NpYXRlZCB3aXRoIGEga2V5IGluIHNvbWUgbWFwIGFyZVxuICogcmV0YWluZWQgc28gbG9uZyBhcyB0aGF0IGtleSBpcyByZXRhaW5lZCBhbmQgdGhvc2UgYXNzb2NpYXRpb25zIGFyZVxuICogbm90IG92ZXJyaWRkZW4uIEZvciBleGFtcGxlLCB3aGVuIHVzZWQgdG8gc3VwcG9ydCBtZW1icmFuZXMsIGFsbFxuICogdmFsdWVzIGV4cG9ydGVkIGZyb20gYSBnaXZlbiBtZW1icmFuZSB3aWxsIGxpdmUgZm9yIHRoZSBsaWZldGltZVxuICogdGhleSB3b3VsZCBoYXZlIGhhZCBpbiB0aGUgYWJzZW5jZSBvZiBhbiBpbnRlcnBvc2VkIG1lbWJyYW5lLiBFdmVuXG4gKiB3aGVuIHRoZSBtZW1icmFuZSBpcyByZXZva2VkLCBhbGwgb2JqZWN0cyB0aGF0IHdvdWxkIGhhdmUgYmVlblxuICogcmVhY2hhYmxlIGluIHRoZSBhYnNlbmNlIG9mIHJldm9jYXRpb24gd2lsbCBzdGlsbCBiZSByZWFjaGFibGUsIGFzXG4gKiBmYXIgYXMgdGhlIEdDIGNhbiB0ZWxsLCBldmVuIHRob3VnaCB0aGV5IHdpbGwgbm8gbG9uZ2VyIGJlIHJlbGV2YW50XG4gKiB0byBvbmdvaW5nIGNvbXB1dGF0aW9uLlxuICpcbiAqIDxwPlRoZSBBUEkgaW1wbGVtZW50ZWQgaGVyZSBpcyBhcHByb3hpbWF0ZWx5IHRoZSBBUEkgYXMgaW1wbGVtZW50ZWRcbiAqIGluIEZGNi4wYTEgYW5kIGFncmVlZCB0byBieSBNYXJrTSwgQW5kcmVhcyBHYWwsIGFuZCBEYXZlIEhlcm1hbixcbiAqIHJhdGhlciB0aGFuIHRoZSBvZmZpYWxseSBhcHByb3ZlZCBwcm9wb3NhbCBwYWdlLiBUT0RPKGVyaWdodHMpOlxuICogdXBncmFkZSB0aGUgZWNtYXNjcmlwdCBXZWFrTWFwIHByb3Bvc2FsIHBhZ2UgdG8gZXhwbGFpbiB0aGlzIEFQSVxuICogY2hhbmdlIGFuZCBwcmVzZW50IHRvIEVjbWFTY3JpcHQgY29tbWl0dGVlIGZvciB0aGVpciBhcHByb3ZhbC5cbiAqXG4gKiA8cD5UaGUgZmlyc3QgZGlmZmVyZW5jZSBiZXR3ZWVuIHRoZSBlbXVsYXRpb24gaGVyZSBhbmQgdGhhdCBpblxuICogRkY2LjBhMSBpcyB0aGUgcHJlc2VuY2Ugb2Ygbm9uIGVudW1lcmFibGUge0Bjb2RlIGdldF9fXywgaGFzX19fLFxuICogc2V0X19fLCBhbmQgZGVsZXRlX19ffSBtZXRob2RzIG9uIFdlYWtNYXAgaW5zdGFuY2VzIHRvIHJlcHJlc2VudFxuICogd2hhdCB3b3VsZCBiZSB0aGUgaGlkZGVuIGludGVybmFsIHByb3BlcnRpZXMgb2YgYSBwcmltaXRpdmVcbiAqIGltcGxlbWVudGF0aW9uLiBXaGVyZWFzIHRoZSBGRjYuMGExIFdlYWtNYXAucHJvdG90eXBlIG1ldGhvZHNcbiAqIHJlcXVpcmUgdGhlaXIge0Bjb2RlIHRoaXN9IHRvIGJlIGEgZ2VudWluZSBXZWFrTWFwIGluc3RhbmNlIChpLmUuLFxuICogYW4gb2JqZWN0IG9mIHtAY29kZSBbW0NsYXNzXV19IFwiV2Vha01hcH0pLCBzaW5jZSB0aGVyZSBpcyBub3RoaW5nXG4gKiB1bmZvcmdlYWJsZSBhYm91dCB0aGUgcHNldWRvLWludGVybmFsIG1ldGhvZCBuYW1lcyB1c2VkIGhlcmUsXG4gKiBub3RoaW5nIHByZXZlbnRzIHRoZXNlIGVtdWxhdGVkIHByb3RvdHlwZSBtZXRob2RzIGZyb20gYmVpbmdcbiAqIGFwcGxpZWQgdG8gbm9uLVdlYWtNYXBzIHdpdGggcHNldWRvLWludGVybmFsIG1ldGhvZHMgb2YgdGhlIHNhbWVcbiAqIG5hbWVzLlxuICpcbiAqIDxwPkFub3RoZXIgZGlmZmVyZW5jZSBpcyB0aGF0IG91ciBlbXVsYXRlZCB7QGNvZGVcbiAqIFdlYWtNYXAucHJvdG90eXBlfSBpcyBub3QgaXRzZWxmIGEgV2Vha01hcC4gQSBwcm9ibGVtIHdpdGggdGhlXG4gKiBjdXJyZW50IEZGNi4wYTEgQVBJIGlzIHRoYXQgV2Vha01hcC5wcm90b3R5cGUgaXMgaXRzZWxmIGEgV2Vha01hcFxuICogcHJvdmlkaW5nIGFtYmllbnQgbXV0YWJpbGl0eSBhbmQgYW4gYW1iaWVudCBjb21tdW5pY2F0aW9uc1xuICogY2hhbm5lbC4gVGh1cywgaWYgYSBXZWFrTWFwIGlzIGFscmVhZHkgcHJlc2VudCBhbmQgaGFzIHRoaXNcbiAqIHByb2JsZW0sIHJlcGFpckVTNS5qcyB3cmFwcyBpdCBpbiBhIHNhZmUgd3JhcHBwZXIgaW4gb3JkZXIgdG9cbiAqIHByZXZlbnQgYWNjZXNzIHRvIHRoaXMgY2hhbm5lbC4gKFNlZVxuICogUEFUQ0hfTVVUQUJMRV9GUk9aRU5fV0VBS01BUF9QUk9UTyBpbiByZXBhaXJFUzUuanMpLlxuICovXG5cbi8qKlxuICogSWYgdGhpcyBpcyBhIGZ1bGwgPGEgaHJlZj1cbiAqIFwiaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL2VzLWxhYi93aWtpL1NlY3VyZWFibGVFUzVcIlxuICogPnNlY3VyZWFibGUgRVM1PC9hPiBwbGF0Zm9ybSBhbmQgdGhlIEVTLUhhcm1vbnkge0Bjb2RlIFdlYWtNYXB9IGlzXG4gKiBhYnNlbnQsIGluc3RhbGwgYW4gYXBwcm94aW1hdGUgZW11bGF0aW9uLlxuICpcbiAqIDxwPklmIFdlYWtNYXAgaXMgcHJlc2VudCBidXQgY2Fubm90IHN0b3JlIHNvbWUgb2JqZWN0cywgdXNlIG91ciBhcHByb3hpbWF0ZVxuICogZW11bGF0aW9uIGFzIGEgd3JhcHBlci5cbiAqXG4gKiA8cD5JZiB0aGlzIGlzIGFsbW9zdCBhIHNlY3VyZWFibGUgRVM1IHBsYXRmb3JtLCB0aGVuIFdlYWtNYXAuanNcbiAqIHNob3VsZCBiZSBydW4gYWZ0ZXIgcmVwYWlyRVM1LmpzLlxuICpcbiAqIDxwPlNlZSB7QGNvZGUgV2Vha01hcH0gZm9yIGRvY3VtZW50YXRpb24gb2YgdGhlIGdhcmJhZ2UgY29sbGVjdGlvblxuICogcHJvcGVydGllcyBvZiB0aGlzIFdlYWtNYXAgZW11bGF0aW9uLlxuICovXG4oZnVuY3Rpb24gV2Vha01hcE1vZHVsZSgpIHtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgaWYgKHR5cGVvZiBzZXMgIT09ICd1bmRlZmluZWQnICYmIHNlcy5vayAmJiAhc2VzLm9rKCkpIHtcbiAgICAvLyBhbHJlYWR5IHRvbyBicm9rZW4sIHNvIGdpdmUgdXBcbiAgICByZXR1cm47XG4gIH1cblxuICAvKipcbiAgICogSW4gc29tZSBjYXNlcyAoY3VycmVudCBGaXJlZm94KSwgd2UgbXVzdCBtYWtlIGEgY2hvaWNlIGJldHdlZWVuIGFcbiAgICogV2Vha01hcCB3aGljaCBpcyBjYXBhYmxlIG9mIHVzaW5nIGFsbCB2YXJpZXRpZXMgb2YgaG9zdCBvYmplY3RzIGFzXG4gICAqIGtleXMgYW5kIG9uZSB3aGljaCBpcyBjYXBhYmxlIG9mIHNhZmVseSB1c2luZyBwcm94aWVzIGFzIGtleXMuIFNlZVxuICAgKiBjb21tZW50cyBiZWxvdyBhYm91dCBIb3N0V2Vha01hcCBhbmQgRG91YmxlV2Vha01hcCBmb3IgZGV0YWlscy5cbiAgICpcbiAgICogVGhpcyBmdW5jdGlvbiAod2hpY2ggaXMgYSBnbG9iYWwsIG5vdCBleHBvc2VkIHRvIGd1ZXN0cykgbWFya3MgYVxuICAgKiBXZWFrTWFwIGFzIHBlcm1pdHRlZCB0byBkbyB3aGF0IGlzIG5lY2Vzc2FyeSB0byBpbmRleCBhbGwgaG9zdFxuICAgKiBvYmplY3RzLCBhdCB0aGUgY29zdCBvZiBtYWtpbmcgaXQgdW5zYWZlIGZvciBwcm94aWVzLlxuICAgKlxuICAgKiBEbyBub3QgYXBwbHkgdGhpcyBmdW5jdGlvbiB0byBhbnl0aGluZyB3aGljaCBpcyBub3QgYSBnZW51aW5lXG4gICAqIGZyZXNoIFdlYWtNYXAuXG4gICAqL1xuICBmdW5jdGlvbiB3ZWFrTWFwUGVybWl0SG9zdE9iamVjdHMobWFwKSB7XG4gICAgLy8gaWRlbnRpdHkgb2YgZnVuY3Rpb24gdXNlZCBhcyBhIHNlY3JldCAtLSBnb29kIGVub3VnaCBhbmQgY2hlYXBcbiAgICBpZiAobWFwLnBlcm1pdEhvc3RPYmplY3RzX19fKSB7XG4gICAgICBtYXAucGVybWl0SG9zdE9iamVjdHNfX18od2Vha01hcFBlcm1pdEhvc3RPYmplY3RzKTtcbiAgICB9XG4gIH1cbiAgaWYgKHR5cGVvZiBzZXMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgc2VzLndlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cyA9IHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cztcbiAgfVxuXG4gIC8vIElFIDExIGhhcyBubyBQcm94eSBidXQgaGFzIGEgYnJva2VuIFdlYWtNYXAgc3VjaCB0aGF0IHdlIG5lZWQgdG8gcGF0Y2hcbiAgLy8gaXQgdXNpbmcgRG91YmxlV2Vha01hcDsgdGhpcyBmbGFnIHRlbGxzIERvdWJsZVdlYWtNYXAgc28uXG4gIHZhciBkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlID0gZmFsc2U7XG5cbiAgLy8gQ2hlY2sgaWYgdGhlcmUgaXMgYWxyZWFkeSBhIGdvb2QtZW5vdWdoIFdlYWtNYXAgaW1wbGVtZW50YXRpb24sIGFuZCBpZiBzb1xuICAvLyBleGl0IHdpdGhvdXQgcmVwbGFjaW5nIGl0LlxuICBpZiAodHlwZW9mIFdlYWtNYXAgPT09ICdmdW5jdGlvbicpIHtcbiAgICB2YXIgSG9zdFdlYWtNYXAgPSBXZWFrTWFwO1xuICAgIC8vIFRoZXJlIGlzIGEgV2Vha01hcCAtLSBpcyBpdCBnb29kIGVub3VnaD9cbiAgICBpZiAodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgL0ZpcmVmb3gvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkpIHtcbiAgICAgIC8vIFdlJ3JlIG5vdyAqYXNzdW1pbmcgbm90KiwgYmVjYXVzZSBhcyBvZiB0aGlzIHdyaXRpbmcgKDIwMTMtMDUtMDYpXG4gICAgICAvLyBGaXJlZm94J3MgV2Vha01hcHMgaGF2ZSBhIG1pc2NlbGxhbnkgb2Ygb2JqZWN0cyB0aGV5IHdvbid0IGFjY2VwdCwgYW5kXG4gICAgICAvLyB3ZSBkb24ndCB3YW50IHRvIG1ha2UgYW4gZXhoYXVzdGl2ZSBsaXN0LCBhbmQgdGVzdGluZyBmb3IganVzdCBvbmVcbiAgICAgIC8vIHdpbGwgYmUgYSBwcm9ibGVtIGlmIHRoYXQgb25lIGlzIGZpeGVkIGFsb25lIChhcyB0aGV5IGRpZCBmb3IgRXZlbnQpLlxuXG4gICAgICAvLyBJZiB0aGVyZSBpcyBhIHBsYXRmb3JtIHRoYXQgd2UgKmNhbiogcmVsaWFibHkgdGVzdCBvbiwgaGVyZSdzIGhvdyB0b1xuICAgICAgLy8gZG8gaXQ6XG4gICAgICAvLyAgdmFyIHByb2JsZW1hdGljID0gLi4uIDtcbiAgICAgIC8vICB2YXIgdGVzdEhvc3RNYXAgPSBuZXcgSG9zdFdlYWtNYXAoKTtcbiAgICAgIC8vICB0cnkge1xuICAgICAgLy8gICAgdGVzdEhvc3RNYXAuc2V0KHByb2JsZW1hdGljLCAxKTsgIC8vIEZpcmVmb3ggMjAgd2lsbCB0aHJvdyBoZXJlXG4gICAgICAvLyAgICBpZiAodGVzdEhvc3RNYXAuZ2V0KHByb2JsZW1hdGljKSA9PT0gMSkge1xuICAgICAgLy8gICAgICByZXR1cm47XG4gICAgICAvLyAgICB9XG4gICAgICAvLyAgfSBjYXRjaCAoZSkge31cblxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJRSAxMSBidWc6IFdlYWtNYXBzIHNpbGVudGx5IGZhaWwgdG8gc3RvcmUgZnJvemVuIG9iamVjdHMuXG4gICAgICB2YXIgdGVzdE1hcCA9IG5ldyBIb3N0V2Vha01hcCgpO1xuICAgICAgdmFyIHRlc3RPYmplY3QgPSBPYmplY3QuZnJlZXplKHt9KTtcbiAgICAgIHRlc3RNYXAuc2V0KHRlc3RPYmplY3QsIDEpO1xuICAgICAgaWYgKHRlc3RNYXAuZ2V0KHRlc3RPYmplY3QpICE9PSAxKSB7XG4gICAgICAgIGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgPSB0cnVlO1xuICAgICAgICAvLyBGYWxsIHRocm91Z2ggdG8gaW5zdGFsbGluZyBvdXIgV2Vha01hcC5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gV2Vha01hcDtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHZhciBob3AgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuICB2YXIgZ29wbiA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzO1xuICB2YXIgZGVmUHJvcCA9IE9iamVjdC5kZWZpbmVQcm9wZXJ0eTtcbiAgdmFyIGlzRXh0ZW5zaWJsZSA9IE9iamVjdC5pc0V4dGVuc2libGU7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGRlcGVuZHMgb24gSElEREVOX05BTUUgYmVpbmcgYm90aCA8aT51bmd1ZXNzYWJsZTwvaT4gYW5kXG4gICAqIDxpPnVuZGlzY292ZXJhYmxlPC9pPiBieSB1bnRydXN0ZWQgY29kZS5cbiAgICpcbiAgICogPHA+R2l2ZW4gdGhlIGtub3duIHdlYWtuZXNzZXMgb2YgTWF0aC5yYW5kb20oKSBvbiBleGlzdGluZ1xuICAgKiBicm93c2VycywgaXQgZG9lcyBub3QgZ2VuZXJhdGUgdW5ndWVzc2FiaWxpdHkgd2UgY2FuIGJlIGNvbmZpZGVudFxuICAgKiBvZi5cbiAgICpcbiAgICogPHA+SXQgaXMgdGhlIG1vbmtleSBwYXRjaGluZyBsb2dpYyBpbiB0aGlzIGZpbGUgdGhhdCBpcyBpbnRlbmRlZFxuICAgKiB0byBlbnN1cmUgdW5kaXNjb3ZlcmFiaWxpdHkuIFRoZSBiYXNpYyBpZGVhIGlzIHRoYXQgdGhlcmUgYXJlXG4gICAqIHRocmVlIGZ1bmRhbWVudGFsIG1lYW5zIG9mIGRpc2NvdmVyaW5nIHByb3BlcnRpZXMgb2YgYW4gb2JqZWN0OlxuICAgKiBUaGUgZm9yL2luIGxvb3AsIE9iamVjdC5rZXlzKCksIGFuZCBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcygpLFxuICAgKiBhcyB3ZWxsIGFzIHNvbWUgcHJvcG9zZWQgRVM2IGV4dGVuc2lvbnMgdGhhdCBhcHBlYXIgb24gb3VyXG4gICAqIHdoaXRlbGlzdC4gVGhlIGZpcnN0IHR3byBvbmx5IGRpc2NvdmVyIGVudW1lcmFibGUgcHJvcGVydGllcywgYW5kXG4gICAqIHdlIG9ubHkgdXNlIEhJRERFTl9OQU1FIHRvIG5hbWUgYSBub24tZW51bWVyYWJsZSBwcm9wZXJ0eSwgc28gdGhlXG4gICAqIG9ubHkgcmVtYWluaW5nIHRocmVhdCBzaG91bGQgYmUgZ2V0T3duUHJvcGVydHlOYW1lcyBhbmQgc29tZVxuICAgKiBwcm9wb3NlZCBFUzYgZXh0ZW5zaW9ucyB0aGF0IGFwcGVhciBvbiBvdXIgd2hpdGVsaXN0LiBXZSBtb25rZXlcbiAgICogcGF0Y2ggdGhlbSB0byByZW1vdmUgSElEREVOX05BTUUgZnJvbSB0aGUgbGlzdCBvZiBwcm9wZXJ0aWVzIHRoZXlcbiAgICogcmV0dXJucy5cbiAgICpcbiAgICogPHA+VE9ETyhlcmlnaHRzKTogT24gYSBwbGF0Zm9ybSB3aXRoIGJ1aWx0LWluIFByb3hpZXMsIHByb3hpZXNcbiAgICogY291bGQgYmUgdXNlZCB0byB0cmFwIGFuZCB0aGVyZWJ5IGRpc2NvdmVyIHRoZSBISURERU5fTkFNRSwgc28gd2VcbiAgICogbmVlZCB0byBtb25rZXkgcGF0Y2ggUHJveHkuY3JlYXRlLCBQcm94eS5jcmVhdGVGdW5jdGlvbiwgZXRjLCBpblxuICAgKiBvcmRlciB0byB3cmFwIHRoZSBwcm92aWRlZCBoYW5kbGVyIHdpdGggdGhlIHJlYWwgaGFuZGxlciB3aGljaFxuICAgKiBmaWx0ZXJzIG91dCBhbGwgdHJhcHMgdXNpbmcgSElEREVOX05BTUUuXG4gICAqXG4gICAqIDxwPlRPRE8oZXJpZ2h0cyk6IFJldmlzaXQgTWlrZSBTdGF5J3Mgc3VnZ2VzdGlvbiB0aGF0IHdlIHVzZSBhblxuICAgKiBlbmNhcHN1bGF0ZWQgZnVuY3Rpb24gYXQgYSBub3QtbmVjZXNzYXJpbHktc2VjcmV0IG5hbWUsIHdoaWNoXG4gICAqIHVzZXMgdGhlIFN0aWVnbGVyIHNoYXJlZC1zdGF0ZSByaWdodHMgYW1wbGlmaWNhdGlvbiBwYXR0ZXJuIHRvXG4gICAqIHJldmVhbCB0aGUgYXNzb2NpYXRlZCB2YWx1ZSBvbmx5IHRvIHRoZSBXZWFrTWFwIGluIHdoaWNoIHRoaXMga2V5XG4gICAqIGlzIGFzc29jaWF0ZWQgd2l0aCB0aGF0IHZhbHVlLiBTaW5jZSBvbmx5IHRoZSBrZXkgcmV0YWlucyB0aGVcbiAgICogZnVuY3Rpb24sIHRoZSBmdW5jdGlvbiBjYW4gYWxzbyByZW1lbWJlciB0aGUga2V5IHdpdGhvdXQgY2F1c2luZ1xuICAgKiBsZWFrYWdlIG9mIHRoZSBrZXksIHNvIHRoaXMgZG9lc24ndCB2aW9sYXRlIG91ciBnZW5lcmFsIGdjXG4gICAqIGdvYWxzLiBJbiBhZGRpdGlvbiwgYmVjYXVzZSB0aGUgbmFtZSBuZWVkIG5vdCBiZSBhIGd1YXJkZWRcbiAgICogc2VjcmV0LCB3ZSBjb3VsZCBlZmZpY2llbnRseSBoYW5kbGUgY3Jvc3MtZnJhbWUgZnJvemVuIGtleXMuXG4gICAqL1xuICB2YXIgSElEREVOX05BTUVfUFJFRklYID0gJ3dlYWttYXA6JztcbiAgdmFyIEhJRERFTl9OQU1FID0gSElEREVOX05BTUVfUFJFRklYICsgJ2lkZW50OicgKyBNYXRoLnJhbmRvbSgpICsgJ19fXyc7XG5cbiAgaWYgKHR5cGVvZiBjcnlwdG8gIT09ICd1bmRlZmluZWQnICYmXG4gICAgICB0eXBlb2YgY3J5cHRvLmdldFJhbmRvbVZhbHVlcyA9PT0gJ2Z1bmN0aW9uJyAmJlxuICAgICAgdHlwZW9mIEFycmF5QnVmZmVyID09PSAnZnVuY3Rpb24nICYmXG4gICAgICB0eXBlb2YgVWludDhBcnJheSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHZhciBhYiA9IG5ldyBBcnJheUJ1ZmZlcigyNSk7XG4gICAgdmFyIHU4cyA9IG5ldyBVaW50OEFycmF5KGFiKTtcbiAgICBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKHU4cyk7XG4gICAgSElEREVOX05BTUUgPSBISURERU5fTkFNRV9QUkVGSVggKyAncmFuZDonICtcbiAgICAgIEFycmF5LnByb3RvdHlwZS5tYXAuY2FsbCh1OHMsIGZ1bmN0aW9uKHU4KSB7XG4gICAgICAgIHJldHVybiAodTggJSAzNikudG9TdHJpbmcoMzYpO1xuICAgICAgfSkuam9pbignJykgKyAnX19fJztcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzTm90SGlkZGVuTmFtZShuYW1lKSB7XG4gICAgcmV0dXJuICEoXG4gICAgICAgIG5hbWUuc3Vic3RyKDAsIEhJRERFTl9OQU1FX1BSRUZJWC5sZW5ndGgpID09IEhJRERFTl9OQU1FX1BSRUZJWCAmJlxuICAgICAgICBuYW1lLnN1YnN0cihuYW1lLmxlbmd0aCAtIDMpID09PSAnX19fJyk7XG4gIH1cblxuICAvKipcbiAgICogTW9ua2V5IHBhdGNoIGdldE93blByb3BlcnR5TmFtZXMgdG8gYXZvaWQgcmV2ZWFsaW5nIHRoZVxuICAgKiBISURERU5fTkFNRS5cbiAgICpcbiAgICogPHA+VGhlIEVTNS4xIHNwZWMgcmVxdWlyZXMgZWFjaCBuYW1lIHRvIGFwcGVhciBvbmx5IG9uY2UsIGJ1dCBhc1xuICAgKiBvZiB0aGlzIHdyaXRpbmcsIHRoaXMgcmVxdWlyZW1lbnQgaXMgY29udHJvdmVyc2lhbCBmb3IgRVM2LCBzbyB3ZVxuICAgKiBtYWRlIHRoaXMgY29kZSByb2J1c3QgYWdhaW5zdCB0aGlzIGNhc2UuIElmIHRoZSByZXN1bHRpbmcgZXh0cmFcbiAgICogc2VhcmNoIHR1cm5zIG91dCB0byBiZSBleHBlbnNpdmUsIHdlIGNhbiBwcm9iYWJseSByZWxheCB0aGlzIG9uY2VcbiAgICogRVM2IGlzIGFkZXF1YXRlbHkgc3VwcG9ydGVkIG9uIGFsbCBtYWpvciBicm93c2VycywgaWZmIG5vIGJyb3dzZXJcbiAgICogdmVyc2lvbnMgd2Ugc3VwcG9ydCBhdCB0aGF0IHRpbWUgaGF2ZSByZWxheGVkIHRoaXMgY29uc3RyYWludFxuICAgKiB3aXRob3V0IHByb3ZpZGluZyBidWlsdC1pbiBFUzYgV2Vha01hcHMuXG4gICAqL1xuICBkZWZQcm9wKE9iamVjdCwgJ2dldE93blByb3BlcnR5TmFtZXMnLCB7XG4gICAgdmFsdWU6IGZ1bmN0aW9uIGZha2VHZXRPd25Qcm9wZXJ0eU5hbWVzKG9iaikge1xuICAgICAgcmV0dXJuIGdvcG4ob2JqKS5maWx0ZXIoaXNOb3RIaWRkZW5OYW1lKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBnZXRQcm9wZXJ0eU5hbWVzIGlzIG5vdCBpbiBFUzUgYnV0IGl0IGlzIHByb3Bvc2VkIGZvciBFUzYgYW5kXG4gICAqIGRvZXMgYXBwZWFyIGluIG91ciB3aGl0ZWxpc3QsIHNvIHdlIG5lZWQgdG8gY2xlYW4gaXQgdG9vLlxuICAgKi9cbiAgaWYgKCdnZXRQcm9wZXJ0eU5hbWVzJyBpbiBPYmplY3QpIHtcbiAgICB2YXIgb3JpZ2luYWxHZXRQcm9wZXJ0eU5hbWVzID0gT2JqZWN0LmdldFByb3BlcnR5TmFtZXM7XG4gICAgZGVmUHJvcChPYmplY3QsICdnZXRQcm9wZXJ0eU5hbWVzJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGZha2VHZXRQcm9wZXJ0eU5hbWVzKG9iaikge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxHZXRQcm9wZXJ0eU5hbWVzKG9iaikuZmlsdGVyKGlzTm90SGlkZGVuTmFtZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogPHA+VG8gdHJlYXQgb2JqZWN0cyBhcyBpZGVudGl0eS1rZXlzIHdpdGggcmVhc29uYWJsZSBlZmZpY2llbmN5XG4gICAqIG9uIEVTNSBieSBpdHNlbGYgKGkuZS4sIHdpdGhvdXQgYW55IG9iamVjdC1rZXllZCBjb2xsZWN0aW9ucyksIHdlXG4gICAqIG5lZWQgdG8gYWRkIGEgaGlkZGVuIHByb3BlcnR5IHRvIHN1Y2gga2V5IG9iamVjdHMgd2hlbiB3ZVxuICAgKiBjYW4uIFRoaXMgcmFpc2VzIHNldmVyYWwgaXNzdWVzOlxuICAgKiA8dWw+XG4gICAqIDxsaT5BcnJhbmdpbmcgdG8gYWRkIHRoaXMgcHJvcGVydHkgdG8gb2JqZWN0cyBiZWZvcmUgd2UgbG9zZSB0aGVcbiAgICogICAgIGNoYW5jZSwgYW5kXG4gICAqIDxsaT5IaWRpbmcgdGhlIGV4aXN0ZW5jZSBvZiB0aGlzIG5ldyBwcm9wZXJ0eSBmcm9tIG1vc3RcbiAgICogICAgIEphdmFTY3JpcHQgY29kZS5cbiAgICogPGxpPlByZXZlbnRpbmcgPGk+Y2VydGlmaWNhdGlvbiB0aGVmdDwvaT4sIHdoZXJlIG9uZSBvYmplY3QgaXNcbiAgICogICAgIGNyZWF0ZWQgZmFsc2VseSBjbGFpbWluZyB0byBiZSB0aGUga2V5IG9mIGFuIGFzc29jaWF0aW9uXG4gICAqICAgICBhY3R1YWxseSBrZXllZCBieSBhbm90aGVyIG9iamVjdC5cbiAgICogPGxpPlByZXZlbnRpbmcgPGk+dmFsdWUgdGhlZnQ8L2k+LCB3aGVyZSB1bnRydXN0ZWQgY29kZSB3aXRoXG4gICAqICAgICBhY2Nlc3MgdG8gYSBrZXkgb2JqZWN0IGJ1dCBub3QgYSB3ZWFrIG1hcCBuZXZlcnRoZWxlc3NcbiAgICogICAgIG9idGFpbnMgYWNjZXNzIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhhdCBrZXkgaW4gdGhhdFxuICAgKiAgICAgd2VhayBtYXAuXG4gICAqIDwvdWw+XG4gICAqIFdlIGRvIHNvIGJ5XG4gICAqIDx1bD5cbiAgICogPGxpPk1ha2luZyB0aGUgbmFtZSBvZiB0aGUgaGlkZGVuIHByb3BlcnR5IHVuZ3Vlc3NhYmxlLCBzbyBcIltdXCJcbiAgICogICAgIGluZGV4aW5nLCB3aGljaCB3ZSBjYW5ub3QgaW50ZXJjZXB0LCBjYW5ub3QgYmUgdXNlZCB0byBhY2Nlc3NcbiAgICogICAgIGEgcHJvcGVydHkgd2l0aG91dCBrbm93aW5nIHRoZSBuYW1lLlxuICAgKiA8bGk+TWFraW5nIHRoZSBoaWRkZW4gcHJvcGVydHkgbm9uLWVudW1lcmFibGUsIHNvIHdlIG5lZWQgbm90XG4gICAqICAgICB3b3JyeSBhYm91dCBmb3ItaW4gbG9vcHMgb3Ige0Bjb2RlIE9iamVjdC5rZXlzfSxcbiAgICogPGxpPm1vbmtleSBwYXRjaGluZyB0aG9zZSByZWZsZWN0aXZlIG1ldGhvZHMgdGhhdCB3b3VsZFxuICAgKiAgICAgcHJldmVudCBleHRlbnNpb25zLCB0byBhZGQgdGhpcyBoaWRkZW4gcHJvcGVydHkgZmlyc3QsXG4gICAqIDxsaT5tb25rZXkgcGF0Y2hpbmcgdGhvc2UgbWV0aG9kcyB0aGF0IHdvdWxkIHJldmVhbCB0aGlzXG4gICAqICAgICBoaWRkZW4gcHJvcGVydHkuXG4gICAqIDwvdWw+XG4gICAqIFVuZm9ydHVuYXRlbHksIGJlY2F1c2Ugb2Ygc2FtZS1vcmlnaW4gaWZyYW1lcywgd2UgY2Fubm90IHJlbGlhYmx5XG4gICAqIGFkZCB0aGlzIGhpZGRlbiBwcm9wZXJ0eSBiZWZvcmUgYW4gb2JqZWN0IGJlY29tZXNcbiAgICogbm9uLWV4dGVuc2libGUuIEluc3RlYWQsIGlmIHdlIGVuY291bnRlciBhIG5vbi1leHRlbnNpYmxlIG9iamVjdFxuICAgKiB3aXRob3V0IGEgaGlkZGVuIHJlY29yZCB0aGF0IHdlIGNhbiBkZXRlY3QgKHdoZXRoZXIgb3Igbm90IGl0IGhhc1xuICAgKiBhIGhpZGRlbiByZWNvcmQgc3RvcmVkIHVuZGVyIGEgbmFtZSBzZWNyZXQgdG8gdXMpLCB0aGVuIHdlIGp1c3RcbiAgICogdXNlIHRoZSBrZXkgb2JqZWN0IGl0c2VsZiB0byByZXByZXNlbnQgaXRzIGlkZW50aXR5IGluIGEgYnJ1dGVcbiAgICogZm9yY2UgbGVha3kgbWFwIHN0b3JlZCBpbiB0aGUgd2VhayBtYXAsIGxvc2luZyBhbGwgdGhlIGFkdmFudGFnZXNcbiAgICogb2Ygd2Vha25lc3MgZm9yIHRoZXNlLlxuICAgKi9cbiAgZnVuY3Rpb24gZ2V0SGlkZGVuUmVjb3JkKGtleSkge1xuICAgIGlmIChrZXkgIT09IE9iamVjdChrZXkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdOb3QgYW4gb2JqZWN0OiAnICsga2V5KTtcbiAgICB9XG4gICAgdmFyIGhpZGRlblJlY29yZCA9IGtleVtISURERU5fTkFNRV07XG4gICAgaWYgKGhpZGRlblJlY29yZCAmJiBoaWRkZW5SZWNvcmQua2V5ID09PSBrZXkpIHsgcmV0dXJuIGhpZGRlblJlY29yZDsgfVxuICAgIGlmICghaXNFeHRlbnNpYmxlKGtleSkpIHtcbiAgICAgIC8vIFdlYWsgbWFwIG11c3QgYnJ1dGUgZm9yY2UsIGFzIGV4cGxhaW5lZCBpbiBkb2MtY29tbWVudCBhYm92ZS5cbiAgICAgIHJldHVybiB2b2lkIDA7XG4gICAgfVxuXG4gICAgLy8gVGhlIGhpZGRlblJlY29yZCBhbmQgdGhlIGtleSBwb2ludCBkaXJlY3RseSBhdCBlYWNoIG90aGVyLCB2aWFcbiAgICAvLyB0aGUgXCJrZXlcIiBhbmQgSElEREVOX05BTUUgcHJvcGVydGllcyByZXNwZWN0aXZlbHkuIFRoZSBrZXlcbiAgICAvLyBmaWVsZCBpcyBmb3IgcXVpY2tseSB2ZXJpZnlpbmcgdGhhdCB0aGlzIGhpZGRlbiByZWNvcmQgaXMgYW5cbiAgICAvLyBvd24gcHJvcGVydHksIG5vdCBhIGhpZGRlbiByZWNvcmQgZnJvbSB1cCB0aGUgcHJvdG90eXBlIGNoYWluLlxuICAgIC8vXG4gICAgLy8gTk9URTogQmVjYXVzZSB0aGlzIFdlYWtNYXAgZW11bGF0aW9uIGlzIG1lYW50IG9ubHkgZm9yIHN5c3RlbXMgbGlrZVxuICAgIC8vIFNFUyB3aGVyZSBPYmplY3QucHJvdG90eXBlIGlzIGZyb3plbiB3aXRob3V0IGFueSBudW1lcmljXG4gICAgLy8gcHJvcGVydGllcywgaXQgaXMgb2sgdG8gdXNlIGFuIG9iamVjdCBsaXRlcmFsIGZvciB0aGUgaGlkZGVuUmVjb3JkLlxuICAgIC8vIFRoaXMgaGFzIHR3byBhZHZhbnRhZ2VzOlxuICAgIC8vICogSXQgaXMgbXVjaCBmYXN0ZXIgaW4gYSBwZXJmb3JtYW5jZSBjcml0aWNhbCBwbGFjZVxuICAgIC8vICogSXQgYXZvaWRzIHJlbHlpbmcgb24gT2JqZWN0LmNyZWF0ZShudWxsKSwgd2hpY2ggaGFkIGJlZW5cbiAgICAvLyAgIHByb2JsZW1hdGljIG9uIENocm9tZSAyOC4wLjE0ODAuMC4gU2VlXG4gICAgLy8gICBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2dvb2dsZS1jYWphL2lzc3Vlcy9kZXRhaWw/aWQ9MTY4N1xuICAgIGhpZGRlblJlY29yZCA9IHsga2V5OiBrZXkgfTtcblxuICAgIC8vIFdoZW4gdXNpbmcgdGhpcyBXZWFrTWFwIGVtdWxhdGlvbiBvbiBwbGF0Zm9ybXMgd2hlcmVcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIG1pZ2h0IG5vdCBiZSBmcm96ZW4gYW5kIE9iamVjdC5jcmVhdGUobnVsbCkgaXNcbiAgICAvLyByZWxpYWJsZSwgdXNlIHRoZSBmb2xsb3dpbmcgdHdvIGNvbW1lbnRlZCBvdXQgbGluZXMgaW5zdGVhZC5cbiAgICAvLyBoaWRkZW5SZWNvcmQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIC8vIGhpZGRlblJlY29yZC5rZXkgPSBrZXk7XG5cbiAgICAvLyBQbGVhc2UgY29udGFjdCB1cyBpZiB5b3UgbmVlZCB0aGlzIHRvIHdvcmsgb24gcGxhdGZvcm1zIHdoZXJlXG4gICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtaWdodCBub3QgYmUgZnJvemVuIGFuZFxuICAgIC8vIE9iamVjdC5jcmVhdGUobnVsbCkgbWlnaHQgbm90IGJlIHJlbGlhYmxlLlxuXG4gICAgdHJ5IHtcbiAgICAgIGRlZlByb3Aoa2V5LCBISURERU5fTkFNRSwge1xuICAgICAgICB2YWx1ZTogaGlkZGVuUmVjb3JkLFxuICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICB9KTtcbiAgICAgIHJldHVybiBoaWRkZW5SZWNvcmQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFVuZGVyIHNvbWUgY2lyY3Vtc3RhbmNlcywgaXNFeHRlbnNpYmxlIHNlZW1zIHRvIG1pc3JlcG9ydCB3aGV0aGVyXG4gICAgICAvLyB0aGUgSElEREVOX05BTUUgY2FuIGJlIGRlZmluZWQuXG4gICAgICAvLyBUaGUgY2lyY3Vtc3RhbmNlcyBoYXZlIG5vdCBiZWVuIGlzb2xhdGVkLCBidXQgYXQgbGVhc3QgYWZmZWN0XG4gICAgICAvLyBOb2RlLmpzIHYwLjEwLjI2IG9uIFRyYXZpc0NJIC8gTGludXgsIGJ1dCBub3QgdGhlIHNhbWUgdmVyc2lvbiBvZlxuICAgICAgLy8gTm9kZS5qcyBvbiBPUyBYLlxuICAgICAgcmV0dXJuIHZvaWQgMDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTW9ua2V5IHBhdGNoIG9wZXJhdGlvbnMgdGhhdCB3b3VsZCBtYWtlIHRoZWlyIGFyZ3VtZW50XG4gICAqIG5vbi1leHRlbnNpYmxlLlxuICAgKlxuICAgKiA8cD5UaGUgbW9ua2V5IHBhdGNoZWQgdmVyc2lvbnMgdGhyb3cgYSBUeXBlRXJyb3IgaWYgdGhlaXJcbiAgICogYXJndW1lbnQgaXMgbm90IGFuIG9iamVjdCwgc28gaXQgc2hvdWxkIG9ubHkgYmUgZG9uZSB0byBmdW5jdGlvbnNcbiAgICogdGhhdCBzaG91bGQgdGhyb3cgYSBUeXBlRXJyb3IgYW55d2F5IGlmIHRoZWlyIGFyZ3VtZW50IGlzIG5vdCBhblxuICAgKiBvYmplY3QuXG4gICAqL1xuICAoZnVuY3Rpb24oKXtcbiAgICB2YXIgb2xkRnJlZXplID0gT2JqZWN0LmZyZWV6ZTtcbiAgICBkZWZQcm9wKE9iamVjdCwgJ2ZyZWV6ZScsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBpZGVudGlmeWluZ0ZyZWV6ZShvYmopIHtcbiAgICAgICAgZ2V0SGlkZGVuUmVjb3JkKG9iaik7XG4gICAgICAgIHJldHVybiBvbGRGcmVlemUob2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB2YXIgb2xkU2VhbCA9IE9iamVjdC5zZWFsO1xuICAgIGRlZlByb3AoT2JqZWN0LCAnc2VhbCcsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBpZGVudGlmeWluZ1NlYWwob2JqKSB7XG4gICAgICAgIGdldEhpZGRlblJlY29yZChvYmopO1xuICAgICAgICByZXR1cm4gb2xkU2VhbChvYmopO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHZhciBvbGRQcmV2ZW50RXh0ZW5zaW9ucyA9IE9iamVjdC5wcmV2ZW50RXh0ZW5zaW9ucztcbiAgICBkZWZQcm9wKE9iamVjdCwgJ3ByZXZlbnRFeHRlbnNpb25zJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGlkZW50aWZ5aW5nUHJldmVudEV4dGVuc2lvbnMob2JqKSB7XG4gICAgICAgIGdldEhpZGRlblJlY29yZChvYmopO1xuICAgICAgICByZXR1cm4gb2xkUHJldmVudEV4dGVuc2lvbnMob2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSkoKTtcblxuICBmdW5jdGlvbiBjb25zdEZ1bmMoZnVuYykge1xuICAgIGZ1bmMucHJvdG90eXBlID0gbnVsbDtcbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZShmdW5jKTtcbiAgfVxuXG4gIHZhciBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgPSBmYWxzZTtcbiAgZnVuY3Rpb24gY2FsbGVkQXNGdW5jdGlvbldhcm5pbmcoKSB7XG4gICAgLy8gRnV0dXJlIEVTNiBXZWFrTWFwIGlzIGN1cnJlbnRseSAoMjAxMy0wOS0xMCkgZXhwZWN0ZWQgdG8gcmVqZWN0IFdlYWtNYXAoKVxuICAgIC8vIGJ1dCB3ZSB1c2VkIHRvIHBlcm1pdCBpdCBhbmQgZG8gaXQgb3Vyc2VsdmVzLCBzbyB3YXJuIG9ubHkuXG4gICAgaWYgKCFjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgJiYgdHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZ0RvbmUgPSB0cnVlO1xuICAgICAgY29uc29sZS53YXJuKCdXZWFrTWFwIHNob3VsZCBiZSBpbnZva2VkIGFzIG5ldyBXZWFrTWFwKCksIG5vdCAnICtcbiAgICAgICAgICAnV2Vha01hcCgpLiBUaGlzIHdpbGwgYmUgYW4gZXJyb3IgaW4gdGhlIGZ1dHVyZS4nKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbmV4dElkID0gMDtcblxuICB2YXIgT3VyV2Vha01hcCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBPdXJXZWFrTWFwKSkgeyAgLy8gYXBwcm94aW1hdGUgdGVzdCBmb3IgbmV3IC4uLigpXG4gICAgICBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZygpO1xuICAgIH1cblxuICAgIC8vIFdlIGFyZSBjdXJyZW50bHkgKDEyLzI1LzIwMTIpIG5ldmVyIGVuY291bnRlcmluZyBhbnkgcHJlbWF0dXJlbHlcbiAgICAvLyBub24tZXh0ZW5zaWJsZSBrZXlzLlxuICAgIHZhciBrZXlzID0gW107IC8vIGJydXRlIGZvcmNlIGZvciBwcmVtYXR1cmVseSBub24tZXh0ZW5zaWJsZSBrZXlzLlxuICAgIHZhciB2YWx1ZXMgPSBbXTsgLy8gYnJ1dGUgZm9yY2UgZm9yIGNvcnJlc3BvbmRpbmcgdmFsdWVzLlxuICAgIHZhciBpZCA9IG5leHRJZCsrO1xuXG4gICAgZnVuY3Rpb24gZ2V0X19fKGtleSwgb3B0X2RlZmF1bHQpIHtcbiAgICAgIHZhciBpbmRleDtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuIGlkIGluIGhpZGRlblJlY29yZCA/IGhpZGRlblJlY29yZFtpZF0gOiBvcHRfZGVmYXVsdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluZGV4ID0ga2V5cy5pbmRleE9mKGtleSk7XG4gICAgICAgIHJldHVybiBpbmRleCA+PSAwID8gdmFsdWVzW2luZGV4XSA6IG9wdF9kZWZhdWx0O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhhc19fXyhrZXkpIHtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuIGlkIGluIGhpZGRlblJlY29yZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBrZXlzLmluZGV4T2Yoa2V5KSA+PSAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldF9fXyhrZXksIHZhbHVlKSB7XG4gICAgICB2YXIgaW5kZXg7XG4gICAgICB2YXIgaGlkZGVuUmVjb3JkID0gZ2V0SGlkZGVuUmVjb3JkKGtleSk7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIGhpZGRlblJlY29yZFtpZF0gPSB2YWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluZGV4ID0ga2V5cy5pbmRleE9mKGtleSk7XG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgdmFsdWVzW2luZGV4XSA9IHZhbHVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFNpbmNlIHNvbWUgYnJvd3NlcnMgcHJlZW1wdGl2ZWx5IHRlcm1pbmF0ZSBzbG93IHR1cm5zIGJ1dFxuICAgICAgICAgIC8vIHRoZW4gY29udGludWUgY29tcHV0aW5nIHdpdGggcHJlc3VtYWJseSBjb3JydXB0ZWQgaGVhcFxuICAgICAgICAgIC8vIHN0YXRlLCB3ZSBoZXJlIGRlZmVuc2l2ZWx5IGdldCBrZXlzLmxlbmd0aCBmaXJzdCBhbmQgdGhlblxuICAgICAgICAgIC8vIHVzZSBpdCB0byB1cGRhdGUgYm90aCB0aGUgdmFsdWVzIGFuZCBrZXlzIGFycmF5cywga2VlcGluZ1xuICAgICAgICAgIC8vIHRoZW0gaW4gc3luYy5cbiAgICAgICAgICBpbmRleCA9IGtleXMubGVuZ3RoO1xuICAgICAgICAgIHZhbHVlc1tpbmRleF0gPSB2YWx1ZTtcbiAgICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCB2YWx1ZXMgd2lsbCBiZSBvbmUgbG9uZ2VyIHRoYW4ga2V5cy5cbiAgICAgICAgICBrZXlzW2luZGV4XSA9IGtleTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsZXRlX19fKGtleSkge1xuICAgICAgdmFyIGhpZGRlblJlY29yZCA9IGdldEhpZGRlblJlY29yZChrZXkpO1xuICAgICAgdmFyIGluZGV4LCBsYXN0SW5kZXg7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIHJldHVybiBpZCBpbiBoaWRkZW5SZWNvcmQgJiYgZGVsZXRlIGhpZGRlblJlY29yZFtpZF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbmRleCA9IGtleXMuaW5kZXhPZihrZXkpO1xuICAgICAgICBpZiAoaW5kZXggPCAwKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNpbmNlIHNvbWUgYnJvd3NlcnMgcHJlZW1wdGl2ZWx5IHRlcm1pbmF0ZSBzbG93IHR1cm5zIGJ1dFxuICAgICAgICAvLyB0aGVuIGNvbnRpbnVlIGNvbXB1dGluZyB3aXRoIHBvdGVudGlhbGx5IGNvcnJ1cHRlZCBoZWFwXG4gICAgICAgIC8vIHN0YXRlLCB3ZSBoZXJlIGRlZmVuc2l2ZWx5IGdldCBrZXlzLmxlbmd0aCBmaXJzdCBhbmQgdGhlbiB1c2VcbiAgICAgICAgLy8gaXQgdG8gdXBkYXRlIGJvdGggdGhlIGtleXMgYW5kIHRoZSB2YWx1ZXMgYXJyYXksIGtlZXBpbmdcbiAgICAgICAgLy8gdGhlbSBpbiBzeW5jLiBXZSB1cGRhdGUgdGhlIHR3byB3aXRoIGFuIG9yZGVyIG9mIGFzc2lnbm1lbnRzLFxuICAgICAgICAvLyBzdWNoIHRoYXQgYW55IHByZWZpeCBvZiB0aGVzZSBhc3NpZ25tZW50cyB3aWxsIHByZXNlcnZlIHRoZVxuICAgICAgICAvLyBrZXkvdmFsdWUgY29ycmVzcG9uZGVuY2UsIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlIGRlbGV0ZS5cbiAgICAgICAgLy8gTm90ZSB0aGF0IHRoaXMgbmVlZHMgdG8gd29yayBjb3JyZWN0bHkgd2hlbiBpbmRleCA9PT0gbGFzdEluZGV4LlxuICAgICAgICBsYXN0SW5kZXggPSBrZXlzLmxlbmd0aCAtIDE7XG4gICAgICAgIGtleXNbaW5kZXhdID0gdm9pZCAwO1xuICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCB0aGVyZSdzIGEgdm9pZCAwIGluIHRoZSBrZXlzIGFycmF5LCBidXRcbiAgICAgICAgLy8gbm8gb3BlcmF0aW9uIHdpbGwgY2F1c2UgYSBcImtleXMuaW5kZXhPZih2b2lkIDApXCIsIHNpbmNlXG4gICAgICAgIC8vIGdldEhpZGRlblJlY29yZCh2b2lkIDApIHdpbGwgYWx3YXlzIHRocm93IGFuIGVycm9yIGZpcnN0LlxuICAgICAgICB2YWx1ZXNbaW5kZXhdID0gdmFsdWVzW2xhc3RJbmRleF07XG4gICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIHZhbHVlc1tpbmRleF0gY2Fubm90IGJlIGZvdW5kIGhlcmUsXG4gICAgICAgIC8vIGJlY2F1c2Uga2V5c1tpbmRleF0gaXMgdm9pZCAwLlxuICAgICAgICBrZXlzW2luZGV4XSA9IGtleXNbbGFzdEluZGV4XTtcbiAgICAgICAgLy8gSWYgaW5kZXggPT09IGxhc3RJbmRleCBhbmQgd2UgY3Jhc2ggaGVyZSwgdGhlbiBrZXlzW2luZGV4XVxuICAgICAgICAvLyBpcyBzdGlsbCB2b2lkIDAsIHNpbmNlIHRoZSBhbGlhc2luZyBraWxsZWQgdGhlIHByZXZpb3VzIGtleS5cbiAgICAgICAga2V5cy5sZW5ndGggPSBsYXN0SW5kZXg7XG4gICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIGtleXMgd2lsbCBiZSBvbmUgc2hvcnRlciB0aGFuIHZhbHVlcy5cbiAgICAgICAgdmFsdWVzLmxlbmd0aCA9IGxhc3RJbmRleDtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5jcmVhdGUoT3VyV2Vha01hcC5wcm90b3R5cGUsIHtcbiAgICAgIGdldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGdldF9fXykgfSxcbiAgICAgIGhhc19fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGhhc19fXykgfSxcbiAgICAgIHNldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKHNldF9fXykgfSxcbiAgICAgIGRlbGV0ZV9fXzogeyB2YWx1ZTogY29uc3RGdW5jKGRlbGV0ZV9fXykgfVxuICAgIH0pO1xuICB9O1xuXG4gIE91cldlYWtNYXAucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShPYmplY3QucHJvdG90eXBlLCB7XG4gICAgZ2V0OiB7XG4gICAgICAvKipcbiAgICAgICAqIFJldHVybiB0aGUgdmFsdWUgbW9zdCByZWNlbnRseSBhc3NvY2lhdGVkIHdpdGgga2V5LCBvclxuICAgICAgICogb3B0X2RlZmF1bHQgaWYgbm9uZS5cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGdldChrZXksIG9wdF9kZWZhdWx0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldF9fXyhrZXksIG9wdF9kZWZhdWx0KTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0sXG5cbiAgICBoYXM6IHtcbiAgICAgIC8qKlxuICAgICAgICogSXMgdGhlcmUgYSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGgga2V5IGluIHRoaXMgV2Vha01hcD9cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGhhcyhrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFzX19fKGtleSk7XG4gICAgICB9LFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICB9LFxuXG4gICAgc2V0OiB7XG4gICAgICAvKipcbiAgICAgICAqIEFzc29jaWF0ZSB2YWx1ZSB3aXRoIGtleSBpbiB0aGlzIFdlYWtNYXAsIG92ZXJ3cml0aW5nIGFueVxuICAgICAgICogcHJldmlvdXMgYXNzb2NpYXRpb24gaWYgcHJlc2VudC5cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIHNldChrZXksIHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldF9fXyhrZXksIHZhbHVlKTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0sXG5cbiAgICAnZGVsZXRlJzoge1xuICAgICAgLyoqXG4gICAgICAgKiBSZW1vdmUgYW55IGFzc29jaWF0aW9uIGZvciBrZXkgaW4gdGhpcyBXZWFrTWFwLCByZXR1cm5pbmdcbiAgICAgICAqIHdoZXRoZXIgdGhlcmUgd2FzIG9uZS5cbiAgICAgICAqXG4gICAgICAgKiA8cD5Ob3RlIHRoYXQgdGhlIGJvb2xlYW4gcmV0dXJuIGhlcmUgZG9lcyBub3Qgd29yayBsaWtlIHRoZVxuICAgICAgICoge0Bjb2RlIGRlbGV0ZX0gb3BlcmF0b3IuIFRoZSB7QGNvZGUgZGVsZXRlfSBvcGVyYXRvciByZXR1cm5zXG4gICAgICAgKiB3aGV0aGVyIHRoZSBkZWxldGlvbiBzdWNjZWVkcyBhdCBicmluZ2luZyBhYm91dCBhIHN0YXRlIGluXG4gICAgICAgKiB3aGljaCB0aGUgZGVsZXRlZCBwcm9wZXJ0eSBpcyBhYnNlbnQuIFRoZSB7QGNvZGUgZGVsZXRlfVxuICAgICAgICogb3BlcmF0b3IgdGhlcmVmb3JlIHJldHVybnMgdHJ1ZSBpZiB0aGUgcHJvcGVydHkgd2FzIGFscmVhZHlcbiAgICAgICAqIGFic2VudCwgd2hlcmVhcyB0aGlzIHtAY29kZSBkZWxldGV9IG1ldGhvZCByZXR1cm5zIGZhbHNlIGlmXG4gICAgICAgKiB0aGUgYXNzb2NpYXRpb24gd2FzIGFscmVhZHkgYWJzZW50LlxuICAgICAgICovXG4gICAgICB2YWx1ZTogZnVuY3Rpb24gcmVtb3ZlKGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWxldGVfX18oa2V5KTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH1cbiAgfSk7XG5cbiAgaWYgKHR5cGVvZiBIb3N0V2Vha01hcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIChmdW5jdGlvbigpIHtcbiAgICAgIC8vIElmIHdlIGdvdCBoZXJlLCB0aGVuIHRoZSBwbGF0Zm9ybSBoYXMgYSBXZWFrTWFwIGJ1dCB3ZSBhcmUgY29uY2VybmVkXG4gICAgICAvLyB0aGF0IGl0IG1heSByZWZ1c2UgdG8gc3RvcmUgc29tZSBrZXkgdHlwZXMuIFRoZXJlZm9yZSwgbWFrZSBhIG1hcFxuICAgICAgLy8gaW1wbGVtZW50YXRpb24gd2hpY2ggbWFrZXMgdXNlIG9mIGJvdGggYXMgcG9zc2libGUuXG5cbiAgICAgIC8vIEluIHRoaXMgbW9kZSB3ZSBhcmUgYWx3YXlzIHVzaW5nIGRvdWJsZSBtYXBzLCBzbyB3ZSBhcmUgbm90IHByb3h5LXNhZmUuXG4gICAgICAvLyBUaGlzIGNvbWJpbmF0aW9uIGRvZXMgbm90IG9jY3VyIGluIGFueSBrbm93biBicm93c2VyLCBidXQgd2UgaGFkIGJlc3RcbiAgICAgIC8vIGJlIHNhZmUuXG4gICAgICBpZiAoZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSAmJiB0eXBlb2YgUHJveHkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIFByb3h5ID0gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBEb3VibGVXZWFrTWFwKCkge1xuICAgICAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgT3VyV2Vha01hcCkpIHsgIC8vIGFwcHJveGltYXRlIHRlc3QgZm9yIG5ldyAuLi4oKVxuICAgICAgICAgIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcmVmZXJhYmxlLCB0cnVseSB3ZWFrIG1hcC5cbiAgICAgICAgdmFyIGhtYXAgPSBuZXcgSG9zdFdlYWtNYXAoKTtcblxuICAgICAgICAvLyBPdXIgaGlkZGVuLXByb3BlcnR5LWJhc2VkIHBzZXVkby13ZWFrLW1hcC4gTGF6aWx5IGluaXRpYWxpemVkIGluIHRoZVxuICAgICAgICAvLyAnc2V0JyBpbXBsZW1lbnRhdGlvbjsgdGh1cyB3ZSBjYW4gYXZvaWQgcGVyZm9ybWluZyBleHRyYSBsb29rdXBzIGlmXG4gICAgICAgIC8vIHdlIGtub3cgYWxsIGVudHJpZXMgYWN0dWFsbHkgc3RvcmVkIGFyZSBlbnRlcmVkIGluICdobWFwJy5cbiAgICAgICAgdmFyIG9tYXAgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gSGlkZGVuLXByb3BlcnR5IG1hcHMgYXJlIG5vdCBjb21wYXRpYmxlIHdpdGggcHJveGllcyBiZWNhdXNlIHByb3hpZXNcbiAgICAgICAgLy8gY2FuIG9ic2VydmUgdGhlIGhpZGRlbiBuYW1lIGFuZCBlaXRoZXIgYWNjaWRlbnRhbGx5IGV4cG9zZSBpdCBvciBmYWlsXG4gICAgICAgIC8vIHRvIGFsbG93IHRoZSBoaWRkZW4gcHJvcGVydHkgdG8gYmUgc2V0LiBUaGVyZWZvcmUsIHdlIGRvIG5vdCBhbGxvd1xuICAgICAgICAvLyBhcmJpdHJhcnkgV2Vha01hcHMgdG8gc3dpdGNoIHRvIHVzaW5nIGhpZGRlbiBwcm9wZXJ0aWVzLCBidXQgb25seVxuICAgICAgICAvLyB0aG9zZSB3aGljaCBuZWVkIHRoZSBhYmlsaXR5LCBhbmQgdW5wcml2aWxlZ2VkIGNvZGUgaXMgbm90IGFsbG93ZWRcbiAgICAgICAgLy8gdG8gc2V0IHRoZSBmbGFnLlxuICAgICAgICAvL1xuICAgICAgICAvLyAoRXhjZXB0IGluIGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgbW9kZSBpbiB3aGljaCBjYXNlIHdlXG4gICAgICAgIC8vIGRpc2FibGUgcHJveGllcy4pXG4gICAgICAgIHZhciBlbmFibGVTd2l0Y2hpbmcgPSBmYWxzZTtcblxuICAgICAgICBmdW5jdGlvbiBkZ2V0KGtleSwgb3B0X2RlZmF1bHQpIHtcbiAgICAgICAgICBpZiAob21hcCkge1xuICAgICAgICAgICAgcmV0dXJuIGhtYXAuaGFzKGtleSkgPyBobWFwLmdldChrZXkpXG4gICAgICAgICAgICAgICAgOiBvbWFwLmdldF9fXyhrZXksIG9wdF9kZWZhdWx0KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGhtYXAuZ2V0KGtleSwgb3B0X2RlZmF1bHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGRoYXMoa2V5KSB7XG4gICAgICAgICAgcmV0dXJuIGhtYXAuaGFzKGtleSkgfHwgKG9tYXAgPyBvbWFwLmhhc19fXyhrZXkpIDogZmFsc2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGRzZXQ7XG4gICAgICAgIGlmIChkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlKSB7XG4gICAgICAgICAgZHNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGhtYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgaWYgKCFobWFwLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICAgIGlmICghb21hcCkgeyBvbWFwID0gbmV3IE91cldlYWtNYXAoKTsgfVxuICAgICAgICAgICAgICBvbWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZHNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChlbmFibGVTd2l0Y2hpbmcpIHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBobWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGlmICghb21hcCkgeyBvbWFwID0gbmV3IE91cldlYWtNYXAoKTsgfVxuICAgICAgICAgICAgICAgIG9tYXAuc2V0X19fKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBobWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBkZGVsZXRlKGtleSkge1xuICAgICAgICAgIHZhciByZXN1bHQgPSAhIWhtYXBbJ2RlbGV0ZSddKGtleSk7XG4gICAgICAgICAgaWYgKG9tYXApIHsgcmV0dXJuIG9tYXAuZGVsZXRlX19fKGtleSkgfHwgcmVzdWx0OyB9XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBPYmplY3QuY3JlYXRlKE91cldlYWtNYXAucHJvdG90eXBlLCB7XG4gICAgICAgICAgZ2V0X19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoZGdldCkgfSxcbiAgICAgICAgICBoYXNfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhkaGFzKSB9LFxuICAgICAgICAgIHNldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGRzZXQpIH0sXG4gICAgICAgICAgZGVsZXRlX19fOiB7IHZhbHVlOiBjb25zdEZ1bmMoZGRlbGV0ZSkgfSxcbiAgICAgICAgICBwZXJtaXRIb3N0T2JqZWN0c19fXzogeyB2YWx1ZTogY29uc3RGdW5jKGZ1bmN0aW9uKHRva2VuKSB7XG4gICAgICAgICAgICBpZiAodG9rZW4gPT09IHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cykge1xuICAgICAgICAgICAgICBlbmFibGVTd2l0Y2hpbmcgPSB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdib2d1cyBjYWxsIHRvIHBlcm1pdEhvc3RPYmplY3RzX19fJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSl9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgRG91YmxlV2Vha01hcC5wcm90b3R5cGUgPSBPdXJXZWFrTWFwLnByb3RvdHlwZTtcbiAgICAgIG1vZHVsZS5leHBvcnRzID0gRG91YmxlV2Vha01hcDtcblxuICAgICAgLy8gZGVmaW5lIC5jb25zdHJ1Y3RvciB0byBoaWRlIE91cldlYWtNYXAgY3RvclxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFdlYWtNYXAucHJvdG90eXBlLCAnY29uc3RydWN0b3InLCB7XG4gICAgICAgIHZhbHVlOiBXZWFrTWFwLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSwgIC8vIGFzIGRlZmF1bHQgLmNvbnN0cnVjdG9yIGlzXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWVcbiAgICAgIH0pO1xuICAgIH0pKCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gVGhlcmUgaXMgbm8gaG9zdCBXZWFrTWFwLCBzbyB3ZSBtdXN0IHVzZSB0aGUgZW11bGF0aW9uLlxuXG4gICAgLy8gRW11bGF0ZWQgV2Vha01hcHMgYXJlIGluY29tcGF0aWJsZSB3aXRoIG5hdGl2ZSBwcm94aWVzIChiZWNhdXNlIHByb3hpZXNcbiAgICAvLyBjYW4gb2JzZXJ2ZSB0aGUgaGlkZGVuIG5hbWUpLCBzbyB3ZSBtdXN0IGRpc2FibGUgUHJveHkgdXNhZ2UgKGluXG4gICAgLy8gQXJyYXlMaWtlIGFuZCBEb21hZG8sIGN1cnJlbnRseSkuXG4gICAgaWYgKHR5cGVvZiBQcm94eSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIFByb3h5ID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIG1vZHVsZS5leHBvcnRzID0gT3VyV2Vha01hcDtcbiAgfVxufSkoKTtcbiIsInZhciBXTTtcblxuaWYodHlwZW9mIFdlYWtNYXAgIT09ICd1bmRlZmluZWQnKXtcbiAgICBXTSA9IFdlYWtNYXA7XG59ZWxzZSBpZih0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyl7XG4gICAgaWYgKG5hdmlnYXRvci5hcHBOYW1lID09ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInKXtcbiAgICAgICAgdmFyIG1hdGNoID0gbmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvTVNJRSAoWzAtOV17MSx9W1xcLjAtOV17MCx9KS8pO1xuICAgICAgICBpZiAobWF0Y2ggJiYgbWF0Y2hbMV0gPD0gOSl7XG4gICAgICAgICAgICAvLyBNRU1PUlkgTEVBS1MgRk9SIEVWRVJZT05FISEhXG4gICAgICAgICAgICBXTSA9IHJlcXVpcmUoJ2xlYWstbWFwJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbldNIHx8IChXTSA9IHJlcXVpcmUoJ3dlYWstbWFwJykpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdNOyIsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciBrTWF4TGVuZ3RoID0gMHgzZmZmZmZmZlxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqIC0gSW1wbGVtZW50YXRpb24gbXVzdCBzdXBwb3J0IGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLlxuICogICBGaXJlZm94IDQtMjkgbGFja2VkIHN1cHBvcnQsIGZpeGVkIGluIEZpcmVmb3ggMzArLlxuICogICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuICpcbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5IHdpbGxcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IHdpbGwgd29yayBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gKGZ1bmN0aW9uICgpIHtcbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIHJldHVybiA0MiA9PT0gYXJyLmZvbygpICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIG5ldyBVaW50OEFycmF5KDEpLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59KSgpXG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybylcblxuICB2YXIgdHlwZSA9IHR5cGVvZiBzdWJqZWN0XG5cbiAgLy8gRmluZCB0aGUgbGVuZ3RoXG4gIHZhciBsZW5ndGhcbiAgaWYgKHR5cGUgPT09ICdudW1iZXInKVxuICAgIGxlbmd0aCA9IHN1YmplY3QgPiAwID8gc3ViamVjdCA+Pj4gMCA6IDBcbiAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAoZW5jb2RpbmcgPT09ICdiYXNlNjQnKVxuICAgICAgc3ViamVjdCA9IGJhc2U2NGNsZWFuKHN1YmplY3QpXG4gICAgbGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ29iamVjdCcgJiYgc3ViamVjdCAhPT0gbnVsbCkgeyAvLyBhc3N1bWUgb2JqZWN0IGlzIGFycmF5LWxpa2VcbiAgICBpZiAoc3ViamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KHN1YmplY3QuZGF0YSkpXG4gICAgICBzdWJqZWN0ID0gc3ViamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gK3N1YmplY3QubGVuZ3RoID4gMCA/IE1hdGguZmxvb3IoK3N1YmplY3QubGVuZ3RoKSA6IDBcbiAgfSBlbHNlXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuXG4gIGlmICh0aGlzLmxlbmd0aCA+IGtNYXhMZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aC50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcblxuICB2YXIgYnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFByZWZlcnJlZDogUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBidWYgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIFRISVMgaW5zdGFuY2Ugb2YgQnVmZmVyIChjcmVhdGVkIGJ5IGBuZXdgKVxuICAgIGJ1ZiA9IHRoaXNcbiAgICBidWYubGVuZ3RoID0gbGVuZ3RoXG4gICAgYnVmLl9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiB0eXBlb2Ygc3ViamVjdC5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIC8vIFNwZWVkIG9wdGltaXphdGlvbiAtLSB1c2Ugc2V0IGlmIHdlJ3JlIGNvcHlpbmcgZnJvbSBhIHR5cGVkIGFycmF5XG4gICAgYnVmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgICAgIGJ1ZltpXSA9ICgoc3ViamVjdFtpXSAlIDI1NikgKyAyNTYpICUgMjU2XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgYnVmLndyaXRlKHN1YmplY3QsIDAsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBNYXRoLm1pbih4LCB5KTsgaSA8IGxlbiAmJiBhW2ldID09PSBiW2ldOyBpKyspIHt9XG4gIGlmIChpICE9PSBsZW4pIHtcbiAgICB4ID0gYVtpXVxuICAgIHkgPSBiW2ldXG4gIH1cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIChsaXN0LCB0b3RhbExlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1VzYWdlOiBCdWZmZXIuY29uY2F0KGxpc3RbLCBsZW5ndGhdKScpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAodG90YWxMZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIHRvdGFsTGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0b3RhbExlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHRvdGFsTGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gZnVuY3Rpb24gKHN0ciwgZW5jb2RpbmcpIHtcbiAgdmFyIHJldFxuICBzdHIgPSBzdHIgKyAnJ1xuICBzd2l0Y2ggKGVuY29kaW5nIHx8ICd1dGY4Jykge1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCA+Pj4gMVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSB1dGY4VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICB9XG4gIHJldHVybiByZXRcbn1cblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4vLyB0b1N0cmluZyhlbmNvZGluZywgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCA+Pj4gMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgPj4+IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpXG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIChiKSB7XG4gIGlmKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KVxuICAgICAgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYnl0ZSA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4oYnl0ZSkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBieXRlXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBTdXBwb3J0IGJvdGggKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKVxuICAvLyBhbmQgdGhlIGxlZ2FjeSAoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpXG4gIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgaWYgKCFpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICB9IGVsc2UgeyAgLy8gbGVnYWN5XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKClcblxuICB2YXIgcmV0XG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldCA9IGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gdXRmMTZsZVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICByZXR1cm4gYXNjaWlTbGljZShidWYsIHN0YXJ0LCBlbmQpXG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlbjtcbiAgICBpZiAoc3RhcnQgPCAwKVxuICAgICAgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApXG4gICAgICBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpXG4gICAgZW5kID0gc3RhcnRcblxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICByZXR1cm4gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICB2YXIgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkLCB0cnVlKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICAgIHJldHVybiBuZXdCdWZcbiAgfVxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKVxuICAgIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gKHRhcmdldCwgdGFyZ2V0X3N0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIHZhciBzb3VyY2UgPSB0aGlzXG5cbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKCF0YXJnZXRfc3RhcnQpIHRhcmdldF9zdGFydCA9IDBcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCBzb3VyY2UubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlRW5kIDwgc291cmNlU3RhcnQnKVxuICBpZiAodGFyZ2V0X3N0YXJ0IDwgMCB8fCB0YXJnZXRfc3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aClcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSBzb3VyY2UubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gc291cmNlLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aClcbiAgICBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCA8IGVuZCAtIHN0YXJ0KVxuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgKyBzdGFydFxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRfc3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0X3N0YXJ0KVxuICB9XG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgVHlwZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gKGFycikge1xuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgZ2V0L3NldCBtZXRob2RzIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX2dldCA9IGFyci5nZXRcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZCwgd2lsbCBiZSByZW1vdmVkIGluIG5vZGUgMC4xMytcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtel0vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGIgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGlmIChiIDw9IDB4N0YpIHtcbiAgICAgIGJ5dGVBcnJheS5wdXNoKGIpXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBzdGFydCA9IGlcbiAgICAgIGlmIChiID49IDB4RDgwMCAmJiBiIDw9IDB4REZGRikgaSsrXG4gICAgICB2YXIgaCA9IGVuY29kZVVSSUNvbXBvbmVudChzdHIuc2xpY2Uoc3RhcnQsIGkrMSkpLnN1YnN0cigxKS5zcGxpdCgnJScpXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgYnl0ZUFycmF5LnB1c2gocGFyc2VJbnQoaFtqXSwgMTYpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShzdHIpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbihidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIG5CaXRzID0gLTcsXG4gICAgICBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDAsXG4gICAgICBkID0gaXNMRSA/IC0xIDogMSxcbiAgICAgIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV07XG5cbiAgaSArPSBkO1xuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBzID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gZUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIGUgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBtTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXM7XG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KTtcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pO1xuICAgIGUgPSBlIC0gZUJpYXM7XG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbik7XG59O1xuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24oYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGMsXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApLFxuICAgICAgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpLFxuICAgICAgZCA9IGlzTEUgPyAxIDogLTEsXG4gICAgICBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwO1xuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwO1xuICAgIGUgPSBlTWF4O1xuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKTtcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS07XG4gICAgICBjICo9IDI7XG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcyk7XG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrO1xuICAgICAgYyAvPSAyO1xuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDA7XG4gICAgICBlID0gZU1heDtcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gZSArIGVCaWFzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gMDtcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KTtcblxuICBlID0gKGUgPDwgbUxlbikgfCBtO1xuICBlTGVuICs9IG1MZW47XG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCk7XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4O1xufTtcbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH1cbiAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIl19
