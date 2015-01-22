(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/home/kory/dev/fastn/binding.js":[function(require,module,exports){
var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter;

function bindify(binding, key){
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }
    binding.setMaxListeners(1000);
    binding.model = new Enti(
        ),
    binding._fastn_binding = key;
    binding._firm = false;

    return binding;
}

function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        resultBinding = createBinding('result'),
        attaching;

    resultBinding.model.set = function(key, value){
        this.emit(key, value);
    };

    function change(){
        if(attaching){
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
        attaching = true;
        bindings.forEach(function(binding){
            binding.attach(object, true);
        });
        attaching = false;
        change();
    });

    return resultBinding;
}

function drill(sourceKey, targetKey){
    var drilledBinding = createBinding(targetKey),
        resultBinding = bindify(function(value, self){
            return drilledBinding.apply(null, arguments);
        }, sourceKey + '.' + targetKey);

    resultBinding.attach = function(object, loose){
        if(loose && resultBinding._firm){
            return resultBinding;
        }

        resultBinding._firm = !loose;

        resultBinding.emit('attach', object);
        return resultBinding;
    };
    resultBinding.detach = resultBinding.emit.bind(null, 'attach');

    var internalChange;
    resultBinding.on('change', function(value){
        if(internalChange){
            internalChange = false;
            return;
        }
        drilledBinding.attach(value);
    });
    drilledBinding.on('change', function(value){
        internalChange = true;
        resultBinding.emit('change', value);
    });
    
    resultBinding.on('attach', function(object){
        drilledBinding.attach(object && object[sourceKey], true);
    });
    resultBinding.on('detach', drilledBinding.detach);

    return resultBinding;
}

function createBinding(key){
    if(arguments.length > 1){
        return fuseBinding.apply(null, arguments);
    }

    var value;

    var dotIndex = key.indexOf('.');
    if(key.length > 1 && ~dotIndex){
        return drill(key.slice(0, dotIndex), key.slice(dotIndex+1));
    }

    var binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        binding.model.set(key, newValue);
    };
    bindify(binding, key);

    var handler = function(newValue){
        value = newValue;
        binding.emit('change', value);
    };
    binding.model._events = {};
    binding.model._events[key] = handler

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
        handler(binding.model.get(key));
        binding._scope = object;
        binding.emit('attach', object, true);
        return binding;
    };
    binding.detach = function(loose){
        if(loose && binding._firm){
            return binding;
        }

        binding.model.detach(true);
        handler(undefined);
        binding._scope = null;
        binding.emit('detach');
        return binding;
    };
    binding.drill = function(drillKey){
        return drill(key, drillKey);
    };

    return binding;
}

module.exports = createBinding;
},{"enti":"/home/kory/dev/fastn/node_modules/enti/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/component.js":[function(require,module,exports){
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

module.exports = function createComponent(type, fastn, settings, children, components){
    var component,
        model = new Enti({});

    settings = dereferenceSettings(settings || {});
    children = children.slice();

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
    EventEmitter = require('events').EventEmitter;

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

    return container;
};
},{"crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js"}],"/home/kory/dev/fastn/example/header.js":[function(require,module,exports){
module.exports = function(fastn){

    return fastn('header', {'class':'mainHeader'},
        fastn('h1', fastn.binding('users', 'deletedUsers', function(users, deleted){
            if(!users){
                users = [];
            }
            if(!deleted){
                deleted = [];
            }

            return 'Users (' + users.filter(function(user){
                return !~deleted.indexOf(user);
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
    return user.user;
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
},{"../":"/home/kory/dev/fastn/index.js","../genericComponent":"/home/kory/dev/fastn/genericComponent.js","../listComponent":"/home/kory/dev/fastn/listComponent.js","./header":"/home/kory/dev/fastn/example/header.js","./userList":"/home/kory/dev/fastn/example/userList.js","./users.json":"/home/kory/dev/fastn/example/users.json","crel":"/home/kory/dev/fastn/node_modules/crel/crel.js","enti":"/home/kory/dev/fastn/node_modules/enti/index.js"}],"/home/kory/dev/fastn/example/user.js":[function(require,module,exports){
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
},{"enti":"/home/kory/dev/fastn/node_modules/enti/index.js"}],"/home/kory/dev/fastn/example/userList.js":[function(require,module,exports){
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
module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=module.exports=[
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
},{}],"/home/kory/dev/fastn/genericComponent.js":[function(require,module,exports){
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
    generic.element.addEventListener(eventName, function(event){
        generic.emit(eventName, event, generic.scope());
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
        for(var key in this._events){
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

                newItems.push(item);
                newComponents.push(child);
            }else{
                newItems.push(lastItems[lastKey]);
                lastItems.splice(lastKey,1)

                child = lastComponents[lastKey];
                lastComponents.splice(lastKey,1);
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

},{}],"/home/kory/dev/fastn/node_modules/enti/index.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    flatMerge = require('flat-merge'),
    deepEqual = require('deep-equal'),
    WM = require('./weakmap'),
    arrayProto = [],
    rootKey = '$';

var attachedEnties = new WM();

function emit(model, key, value, original){
    var references = attachedEnties.get(model);

    if(!references || !references.length){
        return;
    }

    for(var i = 0; i < references.length; i++){
        references[i].emit(key, value, original);
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

    references.splice(references.indexOf(this._model),1);
};
Enti.prototype.get = function(key){
    if(key === '.'){
        return this._model;
    }
    return this._model[key];
};

Enti.prototype.set = function(key, value){
    var original = this._model[key];

    if(value && typeof value !== 'object' && value === original){
        return;
    }

    this._model[key] = value;

    emit(this._model, key, value, original);
    emit(this._model, '.', this._model);
};

Enti.prototype.push = function(key, value){
    var target;
    if(arguments.length < 2){
        value = key;
        target = this._model;
    }else{
        target = this._model[key];
    }

    if(!Array.isArray(target)){
        throw "The target is not an array.";
    }

    target.push(value);

    emit(target, target.length-1, value);
    emit(target, '.', target);
};

module.exports = Enti;

},{"./weakmap":"/home/kory/dev/fastn/node_modules/enti/weakmap.js","deep-equal":"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js","flat-merge":"/home/kory/dev/fastn/node_modules/enti/node_modules/flat-merge/index.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/index.js":[function(require,module,exports){
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

},{"./lib/is_arguments.js":"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/lib/is_arguments.js","./lib/keys.js":"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/lib/keys.js"}],"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/lib/is_arguments.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/deep-equal/lib/keys.js":[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/flat-merge/index.js":[function(require,module,exports){
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
},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/leak-map/index.js":[function(require,module,exports){
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
},{}],"/home/kory/dev/fastn/node_modules/enti/node_modules/weak-map/weak-map.js":[function(require,module,exports){
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

},{}],"/home/kory/dev/fastn/node_modules/enti/weakmap.js":[function(require,module,exports){
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
},{"leak-map":"/home/kory/dev/fastn/node_modules/enti/node_modules/leak-map/index.js","weak-map":"/home/kory/dev/fastn/node_modules/enti/node_modules/weak-map/weak-map.js"}],"/home/kory/dev/fastn/node_modules/flat-merge/index.js":[function(require,module,exports){
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

module.exports = function property(currentValue, updater){
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
},{"./is":"/home/kory/dev/fastn/is.js","enti":"/home/kory/dev/fastn/node_modules/enti/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js","what-changed":"/home/kory/dev/fastn/node_modules/what-changed/index.js"}],"/usr/lib/node_modules/enti/index.js":[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    flatMerge = require('flat-merge'),
    deepEqual = require('deep-equal'),
    WM = require('./weakmap'),
    arrayProto = [],
    rootKey = '$';

var attachedEnties = new WM();

function emit(model, key, value, original){
    var references = attachedEnties.get(model);

    if(!references || !references.length){
        return;
    }

    for(var i = 0; i < references.length; i++){
        references[i].emit(key, value, original);
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

    references.splice(references.indexOf(this._model),1);
};
Enti.prototype.get = function(key){
    if(key === '.'){
        return this._model;
    }
    return this._model[key];
};

Enti.prototype.set = function(key, value){
    var original = this._model[key];

    if(value && typeof value !== 'object' && value === original){
        return;
    }

    this._model[key] = value;

    emit(this._model, key, value, original);
    emit(this._model, '.', this._model);
};

Enti.prototype.push = function(key, value){
    var target;
    if(arguments.length < 2){
        value = key;
        target = this._model;
    }else{
        target = this._model[key];
    }

    if(!Array.isArray(target)){
        throw "The target is not an array.";
    }

    target.push(value);

    emit(target, target.length-1, value);
    emit(target, '.', target);
};

module.exports = Enti;

},{"./weakmap":"/usr/lib/node_modules/enti/weakmap.js","deep-equal":"/usr/lib/node_modules/enti/node_modules/deep-equal/index.js","events":"/usr/lib/node_modules/watchify/node_modules/browserify/node_modules/events/events.js","flat-merge":"/usr/lib/node_modules/enti/node_modules/flat-merge/index.js"}],"/usr/lib/node_modules/enti/node_modules/deep-equal/index.js":[function(require,module,exports){
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

},{"./lib/is_arguments.js":"/usr/lib/node_modules/enti/node_modules/deep-equal/lib/is_arguments.js","./lib/keys.js":"/usr/lib/node_modules/enti/node_modules/deep-equal/lib/keys.js"}],"/usr/lib/node_modules/enti/node_modules/deep-equal/lib/is_arguments.js":[function(require,module,exports){
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

},{}],"/usr/lib/node_modules/enti/node_modules/deep-equal/lib/keys.js":[function(require,module,exports){
exports = module.exports = typeof Object.keys === 'function'
  ? Object.keys : shim;

exports.shim = shim;
function shim (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}

},{}],"/usr/lib/node_modules/enti/node_modules/flat-merge/index.js":[function(require,module,exports){
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
},{}],"/usr/lib/node_modules/enti/node_modules/leak-map/index.js":[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vYmluZGluZy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2NvbnRhaW5lckNvbXBvbmVudC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvaGVhZGVyLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vZXhhbXBsZS9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlci5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2V4YW1wbGUvdXNlckxpc3QuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9leGFtcGxlL3VzZXJzLmpzb24iLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9nZW5lcmljQ29tcG9uZW50LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9pcy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL2xpc3RDb21wb25lbnQuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvY3JlbC9jcmVsLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvaW5kZXguanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9kZWVwLWVxdWFsL2xpYi9pc19hcmd1bWVudHMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIva2V5cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2xlYWstbWFwL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL3dlYWstbWFwL3dlYWstbWFwLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL2VudGkvd2Vha21hcC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2Nsb25lL2Nsb25lLmpzIiwiL2hvbWUva29yeS9kZXYvZmFzdG4vbm9kZV9tb2R1bGVzL3doYXQtY2hhbmdlZC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2lzX2FyZ3VtZW50cy5qcyIsIi9ob21lL2tvcnkvZGV2L2Zhc3RuL25vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2tleXMuanMiLCIvaG9tZS9rb3J5L2Rldi9mYXN0bi9wcm9wZXJ0eS5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy9lbnRpL2luZGV4LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvaW5kZXguanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9saWIvaXNfYXJndW1lbnRzLmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL2VudGkvbm9kZV9tb2R1bGVzL2RlZXAtZXF1YWwvbGliL2tleXMuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvZW50aS9ub2RlX21vZHVsZXMvZmxhdC1tZXJnZS9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy9sZWFrLW1hcC9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy9lbnRpL25vZGVfbW9kdWxlcy93ZWFrLW1hcC93ZWFrLW1hcC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy9lbnRpL3dlYWttYXAuanMiLCIvdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qcyIsIi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN3FCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN3FCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxaENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG5mdW5jdGlvbiBiaW5kaWZ5KGJpbmRpbmcsIGtleSl7XG4gICAgZm9yKHZhciBlbWl0dGVyS2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgICAgICBiaW5kaW5nW2VtaXR0ZXJLZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtlbWl0dGVyS2V5XTtcbiAgICB9XG4gICAgYmluZGluZy5zZXRNYXhMaXN0ZW5lcnMoMTAwMCk7XG4gICAgYmluZGluZy5tb2RlbCA9IG5ldyBFbnRpKFxuICAgICAgICApLFxuICAgIGJpbmRpbmcuX2Zhc3RuX2JpbmRpbmcgPSBrZXk7XG4gICAgYmluZGluZy5fZmlybSA9IGZhbHNlO1xuXG4gICAgcmV0dXJuIGJpbmRpbmc7XG59XG5cbmZ1bmN0aW9uIGZ1c2VCaW5kaW5nKCl7XG4gICAgdmFyIGJpbmRpbmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSxcbiAgICAgICAgdHJhbnNmb3JtID0gYmluZGluZ3MucG9wKCksXG4gICAgICAgIHJlc3VsdEJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKCdyZXN1bHQnKSxcbiAgICAgICAgYXR0YWNoaW5nO1xuXG4gICAgcmVzdWx0QmluZGluZy5tb2RlbC5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgdGhpcy5lbWl0KGtleSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjaGFuZ2UoKXtcbiAgICAgICAgaWYoYXR0YWNoaW5nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRCaW5kaW5nKHRyYW5zZm9ybS5hcHBseShudWxsLCBiaW5kaW5ncy5tYXAoZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICByZXR1cm4gYmluZGluZygpO1xuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZywgaW5kZXgpe1xuICAgICAgICBpZih0eXBlb2YgYmluZGluZyA9PT0gJ3N0cmluZycpe1xuICAgICAgICAgICAgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoYmluZGluZyk7XG4gICAgICAgICAgICBiaW5kaW5ncy5zcGxpY2UoaW5kZXgsMSxiaW5kaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBiaW5kaW5nLm9uKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBiaW5kaW5nLmRldGFjaCk7XG4gICAgfSk7XG5cbiAgICByZXN1bHRCaW5kaW5nLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihvYmplY3Qpe1xuICAgICAgICBhdHRhY2hpbmcgPSB0cnVlO1xuICAgICAgICBiaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgYmluZGluZy5hdHRhY2gob2JqZWN0LCB0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGF0dGFjaGluZyA9IGZhbHNlO1xuICAgICAgICBjaGFuZ2UoKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBkcmlsbChzb3VyY2VLZXksIHRhcmdldEtleSl7XG4gICAgdmFyIGRyaWxsZWRCaW5kaW5nID0gY3JlYXRlQmluZGluZyh0YXJnZXRLZXkpLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gYmluZGlmeShmdW5jdGlvbih2YWx1ZSwgc2VsZil7XG4gICAgICAgICAgICByZXR1cm4gZHJpbGxlZEJpbmRpbmcuYXBwbHkobnVsbCwgYXJndW1lbnRzKTtcbiAgICAgICAgfSwgc291cmNlS2V5ICsgJy4nICsgdGFyZ2V0S2V5KTtcblxuICAgIHJlc3VsdEJpbmRpbmcuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIHJlc3VsdEJpbmRpbmcuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdEJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHRCaW5kaW5nLl9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIHJlc3VsdEJpbmRpbmcuZW1pdCgnYXR0YWNoJywgb2JqZWN0KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdEJpbmRpbmc7XG4gICAgfTtcbiAgICByZXN1bHRCaW5kaW5nLmRldGFjaCA9IHJlc3VsdEJpbmRpbmcuZW1pdC5iaW5kKG51bGwsICdhdHRhY2gnKTtcblxuICAgIHZhciBpbnRlcm5hbENoYW5nZTtcbiAgICByZXN1bHRCaW5kaW5nLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgIGlmKGludGVybmFsQ2hhbmdlKXtcbiAgICAgICAgICAgIGludGVybmFsQ2hhbmdlID0gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgZHJpbGxlZEJpbmRpbmcuYXR0YWNoKHZhbHVlKTtcbiAgICB9KTtcbiAgICBkcmlsbGVkQmluZGluZy5vbignY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpbnRlcm5hbENoYW5nZSA9IHRydWU7XG4gICAgICAgIHJlc3VsdEJpbmRpbmcuZW1pdCgnY2hhbmdlJywgdmFsdWUpO1xuICAgIH0pO1xuICAgIFxuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKG9iamVjdCl7XG4gICAgICAgIGRyaWxsZWRCaW5kaW5nLmF0dGFjaChvYmplY3QgJiYgb2JqZWN0W3NvdXJjZUtleV0sIHRydWUpO1xuICAgIH0pO1xuICAgIHJlc3VsdEJpbmRpbmcub24oJ2RldGFjaCcsIGRyaWxsZWRCaW5kaW5nLmRldGFjaCk7XG5cbiAgICByZXR1cm4gcmVzdWx0QmluZGluZztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhrZXkpe1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPiAxKXtcbiAgICAgICAgcmV0dXJuIGZ1c2VCaW5kaW5nLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgdmFyIHZhbHVlO1xuXG4gICAgdmFyIGRvdEluZGV4ID0ga2V5LmluZGV4T2YoJy4nKTtcbiAgICBpZihrZXkubGVuZ3RoID4gMSAmJiB+ZG90SW5kZXgpe1xuICAgICAgICByZXR1cm4gZHJpbGwoa2V5LnNsaWNlKDAsIGRvdEluZGV4KSwga2V5LnNsaWNlKGRvdEluZGV4KzEpKTtcbiAgICB9XG5cbiAgICB2YXIgYmluZGluZyA9IGZ1bmN0aW9uIGJpbmRpbmcobmV3VmFsdWUpe1xuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLm1vZGVsLnNldChrZXksIG5ld1ZhbHVlKTtcbiAgICB9O1xuICAgIGJpbmRpZnkoYmluZGluZywga2V5KTtcblxuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24obmV3VmFsdWUpe1xuICAgICAgICB2YWx1ZSA9IG5ld1ZhbHVlO1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2NoYW5nZScsIHZhbHVlKTtcbiAgICB9O1xuICAgIGJpbmRpbmcubW9kZWwuX2V2ZW50cyA9IHt9O1xuICAgIGJpbmRpbmcubW9kZWwuX2V2ZW50c1trZXldID0gaGFuZGxlclxuXG4gICAgYmluZGluZy5hdHRhY2ggPSBmdW5jdGlvbihvYmplY3QsIGxvb3NlKXtcblxuICAgICAgICAvLyBJZiB0aGUgYmluZGluZyBpcyBiZWluZyBhc2tlZCB0byBhdHRhY2ggbG9vc2x5IHRvIGFuIG9iamVjdCxcbiAgICAgICAgLy8gYnV0IGl0IGhhcyBhbHJlYWR5IGJlZW4gZGVmaW5lZCBhcyBiZWluZyBmaXJtbHkgYXR0YWNoZWQsIGRvIG5vdCBhdHRhY2guXG4gICAgICAgIGlmKGxvb3NlICYmIGJpbmRpbmcuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLl9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGJpbmRpbmcubW9kZWwuYXR0YWNoKG9iamVjdCk7XG4gICAgICAgIGhhbmRsZXIoYmluZGluZy5tb2RlbC5nZXQoa2V5KSk7XG4gICAgICAgIGJpbmRpbmcuX3Njb3BlID0gb2JqZWN0O1xuICAgICAgICBiaW5kaW5nLmVtaXQoJ2F0dGFjaCcsIG9iamVjdCwgdHJ1ZSk7XG4gICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgIH07XG4gICAgYmluZGluZy5kZXRhY2ggPSBmdW5jdGlvbihsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIGJpbmRpbmcuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBiaW5kaW5nLm1vZGVsLmRldGFjaCh0cnVlKTtcbiAgICAgICAgaGFuZGxlcih1bmRlZmluZWQpO1xuICAgICAgICBiaW5kaW5nLl9zY29wZSA9IG51bGw7XG4gICAgICAgIGJpbmRpbmcuZW1pdCgnZGV0YWNoJyk7XG4gICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgIH07XG4gICAgYmluZGluZy5kcmlsbCA9IGZ1bmN0aW9uKGRyaWxsS2V5KXtcbiAgICAgICAgcmV0dXJuIGRyaWxsKGtleSwgZHJpbGxLZXkpO1xuICAgIH07XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVCaW5kaW5nOyIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzKXtcbiAgICB2YXIgcmVzdWx0ID0ge30sXG4gICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhzZXR0aW5ncyk7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICByZXN1bHRba2V5XSA9IHNldHRpbmdzW2tleV07XG4gICAgICAgIGlmKGlzLmJpbmRpbmdPYmplY3QocmVzdWx0W2tleV0pKXtcbiAgICAgICAgICAgIHJlc3VsdFtrZXldID0gZmFzdG4uYmluZGluZyhcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZmFzdG5fYmluZGluZyxcbiAgICAgICAgICAgICAgICByZXN1bHRba2V5XS5fZGVmYXVsdFZhbHVlLFxuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldLnRyYW5zZm9ybVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4sIGNvbXBvbmVudHMpe1xuICAgIHZhciBjb21wb25lbnQsXG4gICAgICAgIG1vZGVsID0gbmV3IEVudGkoe30pO1xuXG4gICAgc2V0dGluZ3MgPSBkZXJlZmVyZW5jZVNldHRpbmdzKHNldHRpbmdzIHx8IHt9KTtcbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLnNsaWNlKCk7XG5cbiAgICBpZighKHR5cGUgaW4gY29tcG9uZW50cykpe1xuICAgICAgICBpZighKCdfZ2VuZXJpYycgaW4gY29tcG9uZW50cykpe1xuICAgICAgICAgICAgdGhyb3cgJ05vIGNvbXBvbmVudCBvZiB0eXBlIFwiJyArIHR5cGUgKyAnXCIgaXMgbG9hZGVkJztcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzLl9nZW5lcmljKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1lbHNle1xuICAgICAgICBjb21wb25lbnQgPSBjb21wb25lbnRzW3R5cGVdKHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5fdHlwZSA9IHR5cGU7XG4gICAgY29tcG9uZW50Ll9zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgIGNvbXBvbmVudC5fZmFzdG5fY29tcG9uZW50ID0gdHJ1ZTtcbiAgICBjb21wb25lbnQuX2NoaWxkcmVuID0gY2hpbGRyZW47XG5cbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIGlmKGlzLnByb3BlcnR5KGNvbXBvbmVudFtrZXldKSl7XG4gICAgICAgICAgICBpZihpcy5iaW5kaW5nKHNldHRpbmdzW2tleV0pKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnRba2V5XS5iaW5kaW5nKHNldHRpbmdzW2tleV0pO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50W2tleV0oc2V0dGluZ3Nba2V5XSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb21wb25lbnQuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIGNvbXBvbmVudC5fZmlybSl7XG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50Ll9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZGVsLmF0dGFjaChvYmplY3QgaW5zdGFuY2VvZiBFbnRpID8gb2JqZWN0Ll9tb2RlbCA6IG9iamVjdCk7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIHRydWUpO1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZGVsLmRldGFjaCgpO1xuICAgICAgICBjb21wb25lbnQuZW1pdCgnZGV0YWNoJywgdHJ1ZSk7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5zY29wZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBtb2RlbDtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gZW1pdFVwZGF0ZSgpe1xuICAgICAgICBjb21wb25lbnQuZW1pdCgndXBkYXRlJyk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50LmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xuICAgICAgICBjb21wb25lbnQuZW1pdCgnZGVzdHJveScpO1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuY2xvbmUgPSBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQ29tcG9uZW50KGNvbXBvbmVudC5fdHlwZSwgZmFzdG4sIGNvbXBvbmVudC5fc2V0dGluZ3MsIGNvbXBvbmVudC5fY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiAhY2hpbGQuX3RlbXBsYXRlZDtcbiAgICAgICAgfSkubWFwKGZ1bmN0aW9uKGNoaWxkKXtcbiAgICAgICAgICAgIHJldHVybiBjaGlsZC5jbG9uZSgpO1xuICAgICAgICB9KSwgY29tcG9uZW50cyk7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5vbignYXR0YWNoJywgZW1pdFVwZGF0ZSk7XG4gICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBlbWl0VXBkYXRlKTtcblxuICAgIGlmKGZhc3RuLmRlYnVnKXtcbiAgICAgICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBmdW5jdGlvbigpe1xuICAgICAgICAgICAgaWYoY29tcG9uZW50LmVsZW1lbnQgJiYgdHlwZW9mIGNvbXBvbmVudC5lbGVtZW50ID09PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50LmVsZW1lbnQuX2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn1cbiIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0bil7XG4gICAgdmFyIGNvbnRhaW5lciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIGNvbnRhaW5lci5pbnNlcnQgPSBmdW5jdGlvbihjb21wb25lbnQsIGluZGV4KXtcbiAgICAgICAgaWYoY3JlbC5pc05vZGUoY29tcG9uZW50KSl7XG4gICAgICAgICAgICB2YXIgZWxlbWVudCA9IGNvbXBvbmVudDtcbiAgICAgICAgICAgIGNvbXBvbmVudCA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gZWxlbWVudDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGlzTmFOKGluZGV4KSl7XG4gICAgICAgICAgICBpbmRleCA9IHRoaXMuX2NoaWxkcmVuLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgY3VycmVudEluZGV4ID0gdGhpcy5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgIHRoaXMuX2NoaWxkcmVuLnNwbGljZShjdXJyZW50SW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2NoaWxkcmVuLnNwbGljZShpbmRleCwgMCwgY29tcG9uZW50KTtcblxuICAgICAgICBpZih0aGlzLmVsZW1lbnQgJiYgIWNvbXBvbmVudC5lbGVtZW50KXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9pbnNlcnQoY29tcG9uZW50LmVsZW1lbnQsIGluZGV4KTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIHRoaXMuZWxlbWVudC5pbnNlcnRCZWZvcmUoZWxlbWVudCwgdGhpcy5lbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgY29udGFpbmVyLnJlbW92ZSA9IGZ1bmN0aW9uKGNvbXBvbmVudCl7XG4gICAgICAgIHZhciBpbmRleCA9IGNvbnRhaW5lci5fY2hpbGRyZW4uaW5kZXhPZihjb21wb25lbnQpO1xuICAgICAgICBpZih+aW5kZXgpe1xuICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICBjb250YWluZXIuX3JlbW92ZShjb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgY29udGFpbmVyLl9yZW1vdmUgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgaWYoIWVsZW1lbnQgfHwgIWNvbnRhaW5lci5lbGVtZW50IHx8IGVsZW1lbnQucGFyZW50Tm9kZSAhPT0gY29udGFpbmVyLmVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRhaW5lci5lbGVtZW50LnJlbW92ZUNoaWxkKGVsZW1lbnQpO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5vbigncmVuZGVyJywgZnVuY3Rpb24oKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRhaW5lci5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29udGFpbmVyLl9jaGlsZHJlbltpXSkgJiYgIWNvbnRhaW5lci5fY2hpbGRyZW5baV0uZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbltpXS5yZW5kZXIoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29udGFpbmVyLl9pbnNlcnQoY29udGFpbmVyLl9jaGlsZHJlbltpXS5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLm9uKCdhdHRhY2gnLCBmdW5jdGlvbihkYXRhLCBsb29zZSl7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNvbnRhaW5lci5fY2hpbGRyZW5baV0pKXtcbiAgICAgICAgICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuW2ldLmF0dGFjaChkYXRhLCBsb29zZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb250YWluZXI7XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4pe1xuXG4gICAgcmV0dXJuIGZhc3RuKCdoZWFkZXInLCB7J2NsYXNzJzonbWFpbkhlYWRlcid9LFxuICAgICAgICBmYXN0bignaDEnLCBmYXN0bi5iaW5kaW5nKCd1c2VycycsICdkZWxldGVkVXNlcnMnLCBmdW5jdGlvbih1c2VycywgZGVsZXRlZCl7XG4gICAgICAgICAgICBpZighdXNlcnMpe1xuICAgICAgICAgICAgICAgIHVzZXJzID0gW107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZighZGVsZXRlZCl7XG4gICAgICAgICAgICAgICAgZGVsZXRlZCA9IFtdO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gJ1VzZXJzICgnICsgdXNlcnMuZmlsdGVyKGZ1bmN0aW9uKHVzZXIpe1xuICAgICAgICAgICAgICAgIHJldHVybiAhfmRlbGV0ZWQuaW5kZXhPZih1c2VyKTtcbiAgICAgICAgICAgIH0pLmxlbmd0aCArICcpJztcbiAgICAgICAgfSkpXG4gICAgKTtcbn07IiwidmFyIGNvbXBvbmVudHMgPSB7XG4gICAgX2dlbmVyaWM6IHJlcXVpcmUoJy4uL2dlbmVyaWNDb21wb25lbnQnKSxcbiAgICBsaXN0OiByZXF1aXJlKCcuLi9saXN0Q29tcG9uZW50Jylcbn07XG5cbnZhciBmYXN0biA9IHJlcXVpcmUoJy4uLycpKGNvbXBvbmVudHMpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKTtcblxudmFyIG1vZGVsID0ge1xuICAgICAgICB1aVN0YXRlOiB7XG4gICAgICAgICAgICBmb286ICdiYXInXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGVudGkgPSBuZXcgRW50aShtb2RlbCk7XG5cbnZhciB1c2VycyA9IHJlcXVpcmUoJy4vdXNlcnMuanNvbicpO1xuXG51c2VycyA9IHVzZXJzLm1hcChmdW5jdGlvbih1c2VyKXtcbiAgICByZXR1cm4gdXNlci51c2VyO1xufSk7XG5cbndpbmRvdy5lbnRpID0gZW50aTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG4gICAgdmFyIHVzZXJTZWFyY2ggPSBmYXN0bi5iaW5kaW5nKCd1c2VyU2VhcmNoJykuYXR0YWNoKHtcbiAgICAgICAgdXNlclNlYXJjaDogJydcbiAgICB9KTtcblxuICAgIHZhciBhcHAgPSBmYXN0bignZGl2JyxcbiAgICAgICAgcmVxdWlyZSgnLi9oZWFkZXInKShmYXN0biksXG4gICAgICAgIGZhc3RuKCdpbnB1dCcsIHt2YWx1ZTogdXNlclNlYXJjaH0pXG4gICAgICAgICAgICAub24oJ2tleXVwJywgZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbHVlKHRoaXMuZWxlbWVudC52YWx1ZSk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgcmVxdWlyZSgnLi91c2VyTGlzdCcpKGZhc3RuLCB1c2VyU2VhcmNoKVxuICAgICk7XG5cbiAgICBhcHAuYXR0YWNoKG1vZGVsKTtcbiAgICBhcHAucmVuZGVyKCk7XG5cbiAgICB3aW5kb3cuYXBwID0gYXBwO1xuICAgIHdpbmRvdy5lbnRpID0gZW50aTtcblxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgZW50aS5zZXQoJ3VzZXJzJywgdXNlcnMpO1xuICAgIH0pO1xuXG4gICAgY3JlbChkb2N1bWVudC5ib2R5LCBhcHAuZWxlbWVudCk7XG59OyIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpe1xuXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLCB7XG4gICAgICAgICAgICAnY2xhc3MnOiBmYXN0bi5iaW5kaW5nKCcuJywgJ25hbWUnLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsICdkZWxldGVkJywgZnVuY3Rpb24odXNlciwgbmFtZSwgc2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZWQpe1xuICAgICAgICAgICAgICAgIHZhciBjbGFzc2VzID0gWyd1c2VyJ107XG5cbiAgICAgICAgICAgICAgICBpZighbmFtZSB8fCAhKG5hbWUuZmlyc3QgJiYgfm5hbWUuZmlyc3QuaW5kZXhPZihzZWFyY2gpKSAmJiAhKG5hbWUubGFzdCAmJiB+bmFtZS5sYXN0LmluZGV4T2Yoc2VhcmNoKSkpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2hpZGRlbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZih1c2VyID09PSBzZWxlY3RlZFVzZXIpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ3NlbGVjdGVkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmKGRlbGV0ZWQpe1xuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2RlbGV0ZWQnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcblxuICAgICAgICBmYXN0bignaW1nJywge3NyYzogZmFzdG4uYmluZGluZygncGljdHVyZScsIGZ1bmN0aW9uKHBpY3R1cmUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBwaWN0dXJlICYmIHBpY3R1cmUubWVkaXVtO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSksXG5cbiAgICAgICAgZmFzdG4oJ2xhYmVsJywge1xuICAgICAgICAgICAgJ2NsYXNzJzogJ25hbWUnLFxuICAgICAgICAgICAgdGV4dENvbnRlbnQ6IGZhc3RuLmJpbmRpbmcoJ25hbWUuZmlyc3QnLCAnbmFtZS5sYXN0JywgZnVuY3Rpb24oZmlyc3ROYW1lLCBzdXJuYW1lKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmlyc3ROYW1lICsgJyAnICsgc3VybmFtZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLFxuXG4gICAgICAgIGZhc3RuKCdkaXYnLCB7J2NsYXNzJzogJ2RldGFpbHMnfSxcblxuICAgICAgICAgICAgZmFzdG4oJ3AnLCB7J2NsYXNzJzonZXh0cmEnfSxcbiAgICAgICAgICAgICAgICBmYXN0bignYScsIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dENvbnRlbnQ6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJyksXG4gICAgICAgICAgICAgICAgICAgIGhyZWY6IGZhc3RuLmJpbmRpbmcoJ2VtYWlsJywgZnVuY3Rpb24oZW1haWwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdtYWlsdG86JyArIGVtYWlsO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIGZhc3RuKCdwJywge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0Q29udGVudDogZmFzdG4uYmluZGluZygnY2VsbCcsIGZ1bmN0aW9uKGNlbGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdNb2JpbGU6ICcgKyBjZWxsO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApXG5cbiAgICAgICAgKSxcblxuICAgICAgICBmYXN0bignYnV0dG9uJywge3RleHRDb250ZW50OiAnWCcsICdjbGFzcyc6ICdyZW1vdmUnfSlcbiAgICAgICAgLm9uKCdjbGljaycsIGZ1bmN0aW9uKGV2ZW50LCBzY29wZSl7XG4gICAgICAgICAgICBzY29wZS5zZXQoJ2RlbGV0ZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIGRlbGV0ZVVzZXIoKTtcbiAgICAgICAgfSlcblxuICAgICkub24oJ2NsaWNrJywgZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcbiAgICAgICAgc2VsZWN0ZWRVc2VyKHNjb3BlLl9tb2RlbCk7XG4gICAgfSk7XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIHVzZXJTZWFyY2gpe1xuICAgIHZhciBzZWxlY3RlZFVzZXIgPSBmYXN0bi5iaW5kaW5nKCdzZWxlY3RlZFVzZXInKS5hdHRhY2goe30pO1xuXG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0Jywge2l0ZW1zOiBmYXN0bi5iaW5kaW5nKCd1c2VycycpLCB0ZW1wbGF0ZTogZnVuY3Rpb24oaXRlbSwga2V5LCBzY29wZSl7XG5cbiAgICAgICAgZnVuY3Rpb24gZGVsZXRlVXNlcigpe1xuICAgICAgICAgICAgdmFyIGRlbGV0ZWRVc2VycyA9IHNjb3BlLmdldCgnZGVsZXRlZFVzZXJzJykgfHxbXTtcbiAgICAgICAgICAgIGRlbGV0ZWRVc2Vycy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgc2NvcGUuc2V0KCdkZWxldGVkVXNlcnMnLCBkZWxldGVkVXNlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcXVpcmUoJy4vdXNlci5qcycpKGZhc3RuLCB1c2VyU2VhcmNoLCBzZWxlY3RlZFVzZXIsIGRlbGV0ZVVzZXIpO1xuICAgIH19KTtcbn07IiwibW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9W1xuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJzY2FybGV0dFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGVhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjY3MSBjb3VudHJ5IGNsdWIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZvcnQgY29sbGluc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImRlbGF3YXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU2NzI0XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJzY2FybGV0dC5kZWFuNDBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGJpcmQ2MThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNpcmNsZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJUT3l1Q09kSFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjJkM2UwZGMwMjBhODI2ODk4MTAyYzZlY2Y4YmI2MGUyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjAxYmE4ZWNiZjNhMTM3OTQxZjRlOGI2NjUwZmI0YjljNmFiY2E3ZjhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkNTZhMWNmZGJjYWYzYTI4ZTE3ZTEwYjhjYjExY2UwMThiNGJhNzMwYmM1YmJlNzIwZjYxNzQ1MWYzNmE4ZWNlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNTUyNDk5MTNcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMzMyNDUwNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEwMiktMjEwLTkzNTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ1NyktNzY5LTc2ODhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2NzYtNzMtOTc2NlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNzJkYmY3MmZjY2UzNWJkZlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXJnaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhcmRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY1NDQgdyBkYWxsYXMgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxhbnNpbmdcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtb250YW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYxODU4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJnaWUud2FyZDI4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJ0aWdlcjQzM1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaGloaWhpXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjhDZDZ5eXFUXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2QzZjI5MzI4Y2Y0MzdjMTExYzE5N2JhYjE2Mjc3MjlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOGFmZTI2NTk2ZTJhMzg5ZDRlYTBmZmIzNjYxOTEwYzE0YmE4MGQyOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhjYzhmOTc3NWU2ZDFmZDdhZDM4YWY5NTU5OTEyZWFhMzI2N2Q4MjJhMTkyNGQwNTJjYTBiYjRkNDdkYTBmY2RcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTI1MzA4Njg2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzA1MDQ3ODk0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTY3KS01MjUtMzkzN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTI5KS00NTctOTI1MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQwOS00Mi03Njg0XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwZDdhY2ZmNjhkYzU3MzU4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXJvbGluZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWlsbHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ3NjMgaG9nYW4gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImdyYW5kIHJhcGlkc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc1MDEzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYXJvbGluZS5taWxsczE0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbHJhYmJpdDk0NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidmVuaWNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImRiNVYydHVrXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZGY4YzllZjA2N2QxMzVjMTdiNDVjMmQ1MDhhOTc3MGNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiODg1MjZlZDQ1NzkzYWFiOWFiN2YzMjJhOWFmMTFhN2E4ZjdkNjAxZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImNhOTdiYTdlNGU2YTI1ZDBmZWIzMTJkNDA3OWU4N2ZmN2E1NmZlOWIwMmJmZDJiM2Q0NDMyNjA0OGZiNzJmNmRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI4MTY1MjIwNFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjYzNzIzODU4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjM3KS01MTItNjU1MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTU2KS04NjYtNDg5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0MC0zMy02NTY5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlOWE1NDE3MGNjMWYzY2FlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia2F0aHlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBlcnJ5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MjIyIHBlY2FuIGFjcmVzIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjdXBlcnRpbm9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJwZW5uc3lsdmFuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTQ0NTJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImthdGh5LnBlcnJ5OTRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2tvYWxhMzYwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmcmVlemVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiR2RmcDAzMXNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0YTkzMDA1NjRkM2M0N2M0MDQ2MzlkM2EyYjU5ODNlMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwYjUxZjgxYjE2YTE2YTZjOGU3NmE3OWFhMDA3ZGMyMmFkNzg3Mjg3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmQ0Yjc3MjRiMzlkY2VlNzQ0YTI2MDI1NjU3NzEwZDY3MzI1YzdjNDc5N2M0YzBhOTgxN2ZhZTdjOTYzM2I3M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDExNDk5NDczXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU4MTM5MzIwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODIyKS0zMTEtOTM2OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTM5KS0zMTAtNDk2MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ4NC01Mi02MTU1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwNzZmZTI4NDdlYjNjNzhkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1hcmlvXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJuZXdtYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQzMDQgcGx1bSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmV3IGhhdmVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicmhvZGUgaXNsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgwNDg2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJpby5uZXdtYW43NkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmVhdXRpZnVsZmlzaDQ4MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYWlraWRvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIk9ROHd0bHFnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOTMzZjY5NWEyN2UwYWVjYzQwZmMzNTNmZGJiY2IzNmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjJlNmUxOTRkYzBkNDFkNDBmMzAxY2M3NTlkODY3YWQyZGU1YTVmY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjgxNTUyYjE4ZTY3MmIyYWQwN2RhMDkxZDkyZGQyMWYzNzk0YmRlMWQ2OGU4MjQyNDdlOGYwY2QzNjNhODBkZjlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE0NjA3MDMzNVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2Mzg3ODQ4M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDUyNiktMjQ0LTI0MjdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkxMiktMjk2LTcyNjZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MDMtOTYtODcwMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8wLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMWM5M2RkMGY1NjA0OTExZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJuZWxzb25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImtlbGxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODUzNCBlIG5vcnRoIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmVlbGV5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2Fuc2FzXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY2NzkyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJuZWxzb24ua2VsbGV5NDNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlsYWR5YnVnNzI1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXJvbGluYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJQZ1VTMmpJUVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjI2NzJlY2UwMTgwNzk0Njk3NzM3NjMzMjg1ODZjOGE3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjBlMGRmNGE2MGJmZWJmYjNhNGZhODcxNzQ5Yjc2MWM5YTYzOTg4OWJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YTU5MWQ4ZGFhN2JjNDhlNTg0Y2U1ZDkwYmJkZGUyZGJjZjA3NTVmM2Y3OTM5YzcxMTVhMzVkZTdhYTBhMzk2XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMTY1OTc5MDVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzQ0NDQ0NDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjQpLTc5OC02OTQ4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2OTIpLTExNi04MzExXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzczLTg4LTY5NzNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdkZTk4MTlmNDY1NDM4YmRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYnJhbmRpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibHVjYXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjYzMDYgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRldHJvaXRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3YXNoaW5ndG9uXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjE1NDA4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJicmFuZGllLmx1Y2FzNTZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZHN3YW43ODRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImpvYW5uZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJrSTZKVEdyWVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImNkNDVkMWQ0MmJkZWI3NGRjZDgyY2E3NmFiMGQ3MTMyXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjVmZmJhMTEzY2IzMzRhNmJhZjFjYTllYTZlMmVkZDdkYzZhZTQ2MzZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhZTJiZDU3NmU3MmMyYmUwYTg1YTA2ZDNlZTU5YTA2M2ZkOTdmZWFmODMwNjhkNTFkMzM4N2M5MzNjMGQ3MmFhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMDE5ODAwOTBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTM5NjAxNFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU4NSktOTY4LTE3NzJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDgzMiktNDQ1LTc5NDFcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NjAtMTEtMjQ3NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiN2YyNDllNDhkOWZlNTNiOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJuaWNob2xhc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwid2VsbHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjExNTggZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2FsZHdlbGxcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpbmRpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjU4NjM5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJuaWNob2xhcy53ZWxsczg2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dmaXNoNDEwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJiaWdvbmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiaFFGRUY4UURcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2MDk4NThjNzU3NGRiMTQxOWRkNWFmODc3ZmFjYWNkYVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3Nzk2ZjI5ZDIyNjUxNjdlMmEyZTA5MGE4YjY1MzExZjNiMmE1ZGNiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDllZWVhYjBiNjFlMGFjMzdjM2YwM2I3YTNiZGFiNDhiOWMxMThjZjAzODg1YWNmNTU3NmMzYjAxNTNjM2NkNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDgxNzYwMjg0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDY0NDgxMzc5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzk0KS01NjMtNTM4NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjEyKS00ODItODAzM1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIxNy0yNS0yOTU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3YjZjZjRiNTQ3YzJkZTJhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidGFueWFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRheVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTYxNCBtY2NsZWxsYW4gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImpvbGlldFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNhbGlmb3JuaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDc2MzFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInRhbnlhLmRheTE2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2VwZWFjb2NrNTM4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXNoXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlBLY2FWb08wXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiY2MwZmUzMzBlZWQ0MTFhYzE0N2RlMjI2ZDdkNWE1YTNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzdhZWE4NGE2M2E4NmJjOTMyMjQ4Y2IwZDE4MWI0M2U2ZjBmYjM5MlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjMyNGFmZjM4YmE1MmU4NzAwZTk3MWIyNDQxZGVjNzgxMTMyYWViYzExN2ZkMjZiYzVkM2JmMDJmODFhMzUxMjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzNTc3MjA2M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjkyNTkwMzI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODIwKS05MjEtNjE5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzQzKS03MzMtOTUxMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgyNi00Mi0yMDM5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi84NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vODUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vODUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkOTk0MzAxNzYyYmRmMDEyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1heFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ2FycmV0dFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDUzNyBsYWtldmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibWVzcXVpdGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYXJ5bGFuZFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2ODIxNFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWF4LmdhcnJldHQzOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVjYXQ5OTBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm9yZ3lcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMEZDbXBlQWVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhZGZjZTAwMTlhOTAwNGMzNjliNmQ1ZDlmNDMzNGNiMFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5ZmExODUyM2E5MjM1NWE0YmYxOGI1ZWRhNmI3MzU3ODEwMTJlNDE2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZDk0ZjdiMmZkYjg2MzdmZDVjMmQxOWYyNGFkOGQ4ZGY2NDZkNjNhMTlmZGY4MTE2ODBiYTU2ZGI2YzZjZTA4OVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc2NTMwMzU0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc5MjYzOTc0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTc1KS0yNDMtNTQzOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzI3KS05MzgtOTI0M1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ5MC05NC04NjYxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3MzBjODI4MjZkMmQ4YTEwXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImplcmVtaWFoXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhbHZhcmV6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxNzAzIGVkd2FyZHMgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInJlZCBibHVmZlwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImxvdWlzaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MjY0OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamVyZW1pYWguYWx2YXJlejc4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJwdXJwbGV3b2xmNjY0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJib2IxMjNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiZmV1RUtLVFpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkYzY2NDJiOTkxZTA0YWM4MDJkY2UzODhlNDkyOWNhNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI1ZThlZjA2OTNiODE0ZDgwYzIxNWM3YzBhYzBlZDAwODhhNzFmNjRmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNTBmYWJkNzUyYmIyYTU4YjNhNmNiODRhN2Q1N2RmODk0MmJlZGFkYzQ3YzE3MTc2MjgzNTVhOWNhNzA0ZTBhNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjEwODAxNTAwXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDQzMTk4NTc4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzI1KS01ODktOTc2MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTYxKS04MDUtMTE1NVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjM0MC01NS03Nzc3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmNzc1MjFlZjNjODdhY2MyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNvcnlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImRhdmlzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTgxIG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJha2Vyc2ZpZWxkXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2hpb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MzM0NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY29yeS5kYXZpczUyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbndvbGY5MzVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjE4NDM2NTcyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInJPZmpsamhnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZmMxNWQ5ZWFmN2VjOGJiNWQyZjMzMmY2ZTdmMzU4MDdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTAxMTBlM2RiYjIyNDNkMzgxNTExNzhiYzIyOTRiNWViZDRmYTYzYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhjYTI3MzZmNjQ4MjA3NjEzNDZiZGUyODgzZjU5YzBkZGNmOGY3ZWNkYjQwOWUzMmQ5NzRhZDM5NGYzMjFkNzFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI2MzUxNjYyOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQzNDk4NDEzM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk0NSktMzM4LTk5NzJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ0OCktNjMyLTUwOTRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMjAtMzItMjgzMFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzg5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vODkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzg5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTNiNDM4ZDRkMGFmOGFmNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFiaWdhaWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImdyYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI4MjQgcGFkZG9jayB3YXlcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcIm1lZGZvcmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxNDU0MlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWJpZ2FpbC5ncmF5NjdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ3dvbGY3MjFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIndlc3RvblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJBRlVLR1Z6RVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjBmMzc5OWIwNWQwOGZlN2I5OWE0NGE5NWY5Y2NmY2E4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjY0YzhhNDkzYmYwOTA1NTUwYzdiZDBjODFhNGI5NjJlMDJhMzcyNGJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2NjRhMWY3MWNiZDdjZjY5OGVmYzUwMTZjNWU1ZmM0OGExMzU2MDU3NDFjZWFlNTJjYWEyZTk2ODYzZDA0MTA3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzI5OTc2OTFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNzE2NTAyMDRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3NjgpLTY0NS0yMzQwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5MjkpLTQ0NS01NTIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTM0LTg3LTk1ODJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwNTViYzgyN2YwYmEwNzdcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamVmZnJleVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicnVpelwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDMwMyBtYXJzaCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2xldmVsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggZGFrb3RhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYyOTY3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqZWZmcmV5LnJ1aXozMEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlY2F0MzI4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3b21ibGVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibWM0V0J5YlpcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3ZWE1MWM3MGYwZGRlODFiYTY1OTIxZmRiZjA3MDc4NFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJkMjQwYTQ2Y2U1MDRmODg4MTFkNzQ0NjEwMDZmOGY4ZjhkMDE2YTg4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2ZmN2YzODVlMWRiZDhkZmUwZjdhMTVjY2NmMWJmM2JiYjRjZjAzNDQ1ZTBkNjI0NTgzNGM4M2MzZjVjNzcwNFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzkzMDI1MjA5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM0MDgzNDQ5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzE5KS01MTQtNTk3M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTA1KS03MzgtNTE3OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIyNy04Mi0xOTUxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwMjJkYTVlNjE0NDU5NGE2XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicm9nZXJzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NDc4IHRpbWJlciB3b2xmIHRyYWlsXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJjb2x1bWJ1c1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndhc2hpbmd0b25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTMwNzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphbmUucm9nZXJzNjBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJlYXV0aWZ1bGxpb240NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaGlnaGhlZWxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwidEtZekJiaUZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3N2VlMjY2MjQ1OWRmOGU3YzVjNzEzOGYzZmI3ZDA2ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2YzYxMzIyOGEwNWQ3MDI4N2ZjZjY2ODdhZTE0NDE5OTZhMGMzM2M0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDY1M2U5NWRjMzE1OGI4MzU0NTM2YmNlYzY4NDM1NjA4NDEwNzFmNDRkOGUzZDQyODNhMjMyMzMyN2FlNTk3MVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NDcxNjE0NTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI3NTcwMzc4M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMxMyktNzY3LTU2NjVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyMyktNDExLTE0MzNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1ODItMTUtNTI3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiODY0ZWNmZjk5M2IxYzRiY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFyaWFubmFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1pbGVzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNjQxIHN1bnNldCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbmQgcHJhaXJpZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImxvdWlzaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2OTUyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYXJpYW5uYS5taWxlczU0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eWR1Y2s4NzlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJpZ2Zvb3RcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMk1rN05yeFBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjYWQwNjE3NmZmZjhlNmRlYzM0OGMyZjFlMDQwMzk5ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3YjdiMTEwMGE0YjY4NDk5OTNhMGNhNTRmZTVmNDk4ZjYwMDg2MGVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDM2YTJhMmMwZWIxYzNiN2JkZWQ2Y2FmNmI2NTBlMDJlMjAwZWJiMzA0NDVhZjhhNmE3MzFlMTYyNGNiOWU4M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDkyMTQyMjg0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDU5OTYzNTk3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTI5KS03NDAtMjc1NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTUwKS00OTktNjQ3MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc5NS03Mi02MzIxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4N2ZmZGQ1MWQ2MjExNDJhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInZpY2tpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FycGVudGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzODI5IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyb2Fub2tlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwid3lvbWluZ1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MzgyMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidmlja2llLmNhcnBlbnRlcjEwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dwZWFjb2NrMjQ4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsYW5jaWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibmRMVW1JUEhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1ZTQ5M2YzOGJhMjY3NDE4MDFlMGRmODhjNmEyYWYxNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwZTZiZmM4YzA3MDE4Yjk5ZmRkOTgyMDk3M2JkYTk0ZDQxNWM1MjllXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNmFjNDBkN2YzMGU1NTY1ODRhNzRiMDE4OWJmZjk0M2RmY2YyNWU2MzQzMjU0MWUwNTY5NjM4NWMwYzExMjk3NlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzc0MDYxMDc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjg3MzI2NjE2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzQ2KS0zOTUtNzg3NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjA2KS02NDUtMjcwOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY4MC0yNC0yMjI1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwYzdjYjE0ZjFmODg3ODc3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFsbGlzb25cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjU4NiBwbHVtIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFudHMgcGFzc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyB5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg5MDA4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJhbGxpc29uLm9saXZlcjUwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlcGVhY29jazExOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibWFuZ1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5S2ZpNk10U1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRlOGY0NGVlNDU5ZjljNTFkODk0OWFhZjFlYmYwMjM1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIyM2IyMDFmYjA2ZGEwZTNmNjY4OWM1Nzc2NTE2N2NhYzU4YWI4MjVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmZmNkMWY5ZDY0Y2I4ZjAwNzU3MzNiZTY5MTJlYmE1ZTBkZGRiYTI1YzUyNzFlYmQzNDQ3NTY3NzE0Y2M1Nzc5XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNjcxNzc3OTdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MjE0MjYzMDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4MTcpLTI3My05Nzk3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyNDcpLTI4OS05NzY1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzA0LTcxLTY5NjlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzMzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zMy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjgzODQ2MDAwZTEzZjJmNGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJkZWFublwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmF0ZXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc0MTQgdyA2dGggc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV2YW5zdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvaGlvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjk1MDQ2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkZWFubi5iYXRlczk2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmFuZ2Vrb2FsYTY4NVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZ2lvcmdpb1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJzaEtDRENXMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImZjZmIzYjkzYWZhMGZmMzIxNjBiMTkzYzBjYjNmMDM4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA0NmE2ZGMzMDQwZTVkZmE5N2Y2ZmUyMWQ4M2I3MGY1YWZiY2EyZTlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJkMzMxNWQ2NjAwMTczYTNmMmJhNWZmMDIwYzk5YzViMDQwYjg4OWQzNDliZjgzMDgzNTJmYjY4MmYzN2I2ZjdmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNTExMTI2NDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTk0ODkwNDFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1OTIpLTM1Ni0zMjUxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2NjQpLTIzNS00MTI0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDQzLTQzLTk3MzVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80OS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjkzZjg4OWU1M2QxNDA2MzRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1pbGRyZWRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZyYXppZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjMwMjYgcmFpbHJvYWQgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWFyeWxhbmRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODM1NzdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1pbGRyZWQuZnJhemllcjE4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZWJ1dHRlcmZseTU3MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiaG9vdGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIjBlRnBGV1doXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNDUyMjUxMTgxMmExZTIwYmVlYTAzYTI1NWRkYzY5MzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjMyODYyZmVlMDRlZTA2MTNjYjdiNmQ4YTZkMDg2MDcyZjk3YThjZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIzMzJlMjc4YjM0ODZkZjA0ZWNlNDFhYjc2MWM0ZGZlYmNiODczYjYyODhlNzljMTZkZWE2MWY4N2U5OGE1ZmRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzNDk3ODAwMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5NTcyODg3NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQzMyktMjU0LTgwNjZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQwMSktMjQwLTE1NTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NTQtMjktODAxNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjMxMTQ1OTIxNDRjNjFlY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxlb25hXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJncmF5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MjUzIG1pbGxlciBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV2ZXJldHRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNjIyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibGVvbmEuZ3JheTYzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja29zdHJpY2g3OTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNsaXBwZXJzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImZRaldraU95XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjU3MzQwZTczNWY3YjA5ODc0ODFlZmIzOGY0MjBjOThcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNTI3NGIwODQ5YzBlYWQ4ZGVlZmYwYmVhNzliY2RhYzhhNzZjNGMxYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjBjYjhlMTVkMTMxNzk3MmRhMDk2YzMxYjE5OGExNmQ2MzkwZGU4ZDdmMjRjZTZiMzRlZjk3MzY1YWNjZWYzODRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIzOTg3MjM4OFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE1MzE2MDMxM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MCktNzM4LTI0MTZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDczMyktNDA3LTMzODhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MDktMjYtOTI0MlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzE4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYzkzZWYyMjZjMmYwOGVhNlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrZWxseVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9udGdvbWVyeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODc2MiBwYWRkb2NrIHdheVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic3RvY2t0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTE5MjFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImtlbGx5Lm1vbnRnb21lcnkyOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYnJvd25sYWR5YnVnNTEwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwb3NzdW1cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMERQclNvMmtcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxOGQ4Mzk5MTEyZDY1NjkyMDEzZDRhNzkzNTM2YmY3NFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZDUwM2ZlZDljMzMwNGJlY2VkMWFjOGNiYzZjNzI5MjhmZTI4MTgzXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMzIzNTZkMzcxNzEyZjg2MzRmNjFkYWY3OTA2ZTVhY2I2YjliZWZlZGIyMzM0NzEyY2U0NDA1NzU5ZmJmYWE3MVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTgwODQ5NjE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc2MzI1MzA4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODQ0KS02MTktOTY2M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzg1KS03ODctOTgxMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjIzOC05Ni03MDczXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2MWI0NWMxMTk0N2I0OTE4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvZ2VyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJraW1cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI1NTUgbGFrZXZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZyZW1vbnRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtb250YW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg4OTE1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb2dlci5raW01OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVybGlvbjQ0M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamlsbGlhblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJZdHlGTktJVFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NjcwOTNkZWVhMzlhMjM3MmZmMDYyMWUzYzRhNzMxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjNjYmZjMTJhNzJlOWE0NjUyN2U2YTdkYjcwMmI4ZmMwYTJmMWM0YjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiMTlkZTBhZGNkYmNmYTYwMjg4M2EyNGM4NWY1MzY3ZWZlNDAyZDgzY2VlMDkwNWMwMmIwZjFhZjY2ZWNjYzRhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzMjU2MzQ5NzZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNDA4NjY3NTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MzQpLTc2Mi02Mjg3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1NDUpLTgwOC00Njc3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjQ0LTgxLTExMTNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImE1NWE2Zjk2ZWZiZjIxODhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW1hbmRhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmbGVtaW5nXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNjM2IHcgZGFsbGFzIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZW5kZXJzb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJzb3V0aCBjYXJvbGluYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzNTYzM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW1hbmRhLmZsZW1pbmc3MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmVhdXRpZnVsb3N0cmljaDU5M1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic21pdGhlcnNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiTU1zdWVlNk1cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwODVmOWM0MGRiYjYzNzM3YjA3OTY4OTY3MTliNjgyY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxYzkzNjlmMjU5MjZlMTA2ZTYxZWRmNzM2YjAxYzI1NTZlMzQxNWVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNWMxMGQyODg3YmExYzhjOWNhNGNjMjM1OGZlOGIzNWMzMGEwNjRkZGY2NmQ0ZmE3ZjE4MWY0NzIxNmE2NzE0ZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzc5Njg3MDUzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDM0NTA0MTEzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzI2KS01ODItNzMzNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTI0KS01NTUtMzE5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE0Ny05Ni02OTI1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIzMGM1NThmY2E2NGI5MDZhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRlYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImN1cnRpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTE3OSBzdGV2ZW5zIGNyZWVrIGJsdmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1cmVrYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGNhcm9saW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI1NTI5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkZWFuLmN1cnRpczgzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGxlb3BhcmQ1NDdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImRlbW9cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiNmtYOUVXUWhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjYTgxNzk5ZmNiZWNmZjNiZWM3N2Y1MWY4MjMzNjcxM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyMzBiYWYxMWFlNDBkZTE0NzkwOWU4ZGNhNWQ0OGE3NWJiNmYxZjhkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDVlNzEwMWY1MGIwYTU2NTE0ODQyNjYyYTdkNWIzYjNjMjQ4ZDM2NWJjZTVlYjg3NmQ2ZmIxMjQzMzU4NDNkZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDE4NDUwNDE0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTQ5OTE4Mjg3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjI1KS00OTItNjYyM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjMyKS00NzYtMjQ0OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgyNC0yNC0yNzYwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNTYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ZDc3ZDU2OWZmMjlmZDk4XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidmFsZXJpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYmVja1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTQzMSBjb2xsZWdlIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTIzNjVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInZhbGVyaWUuYmVjazE5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlbGVvcGFyZDEwN1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamFtbWluXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJZMHplS1Y4XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMTcyMzA2OTUwZWZmNGRmZWZlMzRkMWZlZGQyZDFjMDNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNzhkNmU2OGNiY2ViM2M4NWY1NTM3YmQ3OWU1MDY5MzI3OTFlYjY3MFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImIwZjFhYTQyN2RjMzhlMTg4ZDc1OTQwYWE0NmY5YzkxN2IyZGUyOWRkMWEzNjY2MWRiNDFiMTIxZDZjZDVhMzhcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM3MTMzNzYzOFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjcyOTIwMzExXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjQzKS03NjktNDczN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODY3KS0yMTAtNzE4N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcxMy03MC05ODc2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NWUyMjVhNzEzMWY4ZWI0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImRhcnlsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzaGF3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzNTQ2IGthcmVuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGJ1cXVlcnF1ZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInd5b21pbmdcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMzg1MDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRhcnlsLnNoYXcxNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWZyb2c1NjVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZsYW1pbmdvXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkl0RDByMVdGXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNDhjNTEyNjMzMzMyOGQ4ZTVhMzM0OTBmYTQzNTIwMTdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMTlhNjRkZGViMjliN2FkYjY1NDAzYWY0YzgzZDY5N2Q3MzM0OWU4ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjk0ZmYyZDIxNzlhMjI3ZDU5OGE1ZGE0NDg2ODE4ZGI5ZDU0NDUxZGZmZTAxMjYxMTQ2YmQwMTljY2Q3OTUyYjJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTQwNDU1ODEzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTEzOTUyNTg0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTQzKS0xNzQtNTU0NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzQyKS0xMDMtMjAyOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg0NS00Ny0yNDY4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjYjUwZTE0OTM1YTAyNGYxXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwicGVnZ3lcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDgyOCBtaWxsZXIgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmbG93ZXJtb3VuZFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBtZXhpY29cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODc1NDRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInBlZ2d5Lm9saXZlcjUwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGxlb3BhcmQyNDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInN0cmF3YmVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImZGaW9kZmp1XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmQ4MGFiZDAyZjAwMWVhYTc1YTdjNzFmYzAyNjQ1OTZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjg4M2QxYjJmYzM0NjY2MWY1YWI4Mjc0Y2UzMTc2ZDU2ZTA4MmJhMVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjJhMjliYmI2NDNlODZiMGY1MjljN2Y4NjM2ZDMzZTc1YjIzZmM4YjkxN2M0OTNkZjFlYTZhYzRlMDNhNjY5YjNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA0NjM3NDM3NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ3NDU3NTU3NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMzNCktNjg3LTEwMjJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMwMiktODQyLTU4NDdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MjctNTItMjQ3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTdkZjE5ZGM4ZDEzNjA2MVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbGxhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicmV5bm9sZHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk1OTggd2hlZWxlciByaWRnZSBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYmVsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhbGFza2FcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjQ0NjRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFsbGFuLnJleW5vbGRzNDdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpbnlmcm9nMzA3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ2aXBlclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLY0JheVFHVVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0MTlhODQzMmY5MTRhZDg5MzBmZjk5ZWNhNTVjMDU4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImVhYWUyNmE3OTdiZjY4Yjg2MzYwNGRjZTMyYzIwZGE0YzViNjNlMDdcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3M2VmNmMyYzFlYjQ4ZDQ1MzFjMDZlOGI4NzQ0MTI5MzZmNmI0ZTk1NzA0MmYyYzNiNTYzNzVlNjU0YjU0MDc3XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExOTAyMjYwOTBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMDA2ODc3ODZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MzEpLTkxMi0yMzY3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4ODEpLTQ5My05ODkzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjUxLTg4LTE0NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzc4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJiYTFhODJlMTIxMzRhNDlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ6b2V5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYXJyaXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk4MDgga2FyZW4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNhY3JhbWVudG9cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ3aXNjb25zaW5cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiOTE3MTdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInpvZXkuaGFycmlzODlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZnJvZzI5NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidGl0dHNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiTGNyQnBDek9cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhOThmNDM4ZDJiNDljNmJkMzVjN2ViYjk0YzRhY2M4ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlNTYwNDBjZDc3OTgxYzRiMmQwMjY2M2Y1ZmE0ZjkxZmEyMTgxMjhmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDhiNTQ0ODk2M2RiMjBjMGJkODRlNWYxOWNkZWFlYmE2MWE3MDRmNDlhMDI4ZjY2OTZiYjBlNjIwZTQ3NTg5MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxNDA3MDk3MTMzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzQ0NDU2Njc0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTI4KS03ODktMjYyM1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTM1KS04MDctNjUwNlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE1NC04Mi01NTM5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkN2Q1ZjFhZThjYzMxNDRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNoZXN0ZXJcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImx1Y2FzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyODAzIHcgYmVsdCBsaW5lIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJyZWQgYmx1ZmZcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpZGFob1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NTY1NlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2hlc3Rlci5sdWNhczIwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibHVlZG9nNTYzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwaWN0ZXJlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImtvZmp1QnZnXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWE0Nzc5ZDdjY2Q3YTMxZjc4OTYyZjM3NmFjMmFlN2NcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTdhZTNhNjI1NmQ2NzY1MTc4ZGE5MTMyMGFmOWUxY2RkODVkMTNiY1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImEzZTZiNmViYzZjZTEwMDczMDY5ZmEwMTZlNmRkY2EyNjFmYjA0ODkxNzY1Y2ZkZDExMzZhOGI4ZTZhM2YwMWZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTUwMjgyMzkzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzUyMjg3OTYzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTg1KS0xMTUtMTExOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTY3KS0zMzAtMTY4N1wiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjg3My04MC0yMzU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNDcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi80Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNDcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMWVhYjFmZGYxYzBhZDRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNoZXJseVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3V0dG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MTEzIG9hayBsYXduIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29wcGVsbFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImtlbnR1Y2t5XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc4NDcxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjaGVybHkuc3V0dG9uNTdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImhlYXZ5bWVlcmNhdDk1MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiNzI3MjcyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlZKNGJ6MVhFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDk1ZGM1YTc5MjRmODUwZjg3YmY2Y2IzM2MyOWY4MzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiY2U2MDExY2M4Mzc0YzJiMTA5ZmMyMjA1ZjU2MjlkZTRiMGJkMDYwYlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjZiZjM1YTdlNWNjMDAyNjg2OWQzYjJhOWUwOWU4YmEzNTQxYjJiM2UwNTUxNWNmMTFmMzJhYzkwZTJmNmQ2NDZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTEwNjMzNjk3MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMyNjc1NDQyM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMxNiktMjY3LTUwMjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ5MCktNjU0LTU2OTNcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNDAtOTgtMjI2NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzIyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzIyLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzBlYWZlZjA1Y2IyODJhY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqb3JkYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImhhbWlsdG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4NjcwIHBhcmtlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaW93YSBwYXJrXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicGVubnN5bHZhbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkwNTUwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqb3JkYW4uaGFtaWx0b245N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYnJvd25mcm9nNzY4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJwb3VuZGVkXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImxtUmY3OTl3XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNTNjODlkMzNlZTNhZTYzN2QzMjcyY2ZkZDAzMTcwYzVcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDgxN2U4Yzg3NTIwZDZhZjgxOWIzODlmMTI2MTI3OTBhN2NjZTMyZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjg4OWFkZWRlZDZiZmUxMGM4NGIzMzAzOWViNjY1NTBkZWNjM2ZhOTBjMzM1M2I1ZTc5ZjUzMTI5NWNiMjhiN2RcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE2MTczMjUxMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQyNzgwMDc2MlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MyktODYwLTgwNjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ4NiktNzczLTM3MDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NTktMjAtNDg5OVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOWJmNWE1YjVmMDQxMTJkMFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImdlbmVzaXNcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImZsZXRjaGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1OTIyIGRlcGF1bCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXZhZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTExNjRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImdlbmVzaXMuZmxldGNoZXI1NEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkY2F0OTcyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJsaW5lXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInNmdERpbFhQXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYmRhMTk1NTQwN2NjOGE5NGJmNDJhODhjYjYxZTAwMzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiN2ZjNDhkYzA2YmY1NWViNjVlNDY2MzUwMzVmYjNmMDU4ZmIzOTE0OFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImRmZTEwYjNkNTVkNjdhZGY4MzVkM2NjNDA4ZGFkYzE5NTljNTE4OWM5MjRkM2I1NTQwMzk2MjBhMjhkYTBhOTRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA3MTE0NDgxNlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjczNTAzNTM0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDM2KS03NjktNDg2MVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTMwKS05MjUtNDM2OVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1Mi00NS04NjMyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJkMTFlOTA5NzY3Y2U1ZDMyXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRvZGRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInNpbXBzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg3MzggdyBiZWx0IGxpbmUgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImZvcnQgY29sbGluc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbG9yYWRvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY0MjQwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0b2RkLnNpbXBzb24zNEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxjYXQzMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiZHJlYW1cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibEprVlJhU3dcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYmVlOGIzMWYxODExMGM5NzhjMDlmOWU4ZDZkMzAwNlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0ZDcwMTFhYmRmNGQzZDMwYTgwODg2NmNjZjg2NWQ0NjRhZWJjNjY1XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzJmNmFjZTU5Mjc3ZDc1MGQxNWE3NGQ4YTg0NzhiYWY3MjkwMDhiYjFlNjgwZTBhNTlhZmQzYzJjOTFjYjhkYVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NjI2NjgxMDlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMDMwOTQ2NzFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NTYpLTg2OS02MzAwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3ODUpLTI5My01MDEyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDY0LTc5LTU4ODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQzMDlhM2NjZjUwMjkzZGJcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibHVrZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibW9vcmVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjcyMzIgY29sbGVnZSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVuY2FudmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJvcmVnb25cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTg0MDNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImx1a2UubW9vcmU3OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWZyb2c1NDRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhhbm5haDFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUzE5ejh4QVdcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJkODc4NTUzYWVjZWQzMjA4NjgzZmUwM2Q3YzdjOTc2Y1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIzM2MxNWIwY2I4OTBkZWY0MzM3NzhlMGQ4ZmEzMmVlNGZlOTc0MWY5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMWIzNjg2ZjZjNmMyZGYzNzQwMTRkMDNhNDBlMTIyY2QyZTY2OGY0OWY2YjYyNDQyZTVhNDViZThlM2RiYzAwNlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc0NzMzMjc0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzI1MjY4NTA0XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTQ5KS03MjgtNjgxMVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzcwKS0zNjEtODc3MVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyOC0yMi03NTAyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xMy5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMjUyNWE1OGRhZTU5MTliXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxvdWVsbGFcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImFkYW1zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI4Mjk2IGRlcGF1bCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmVkIG9ha1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIyMjUzOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibG91ZWxsYS5hZGFtczk0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJjcmF6eXBhbmRhMzU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzcGFjZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJxWllSTU5UM1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjNmMWMwNjk3MzAwMGE4MjRhNzcwZGQ4YTg3ZDYxMTEwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjMxMDI0ZjFhOTZhYTQ4M2ExNWFjNTc2ZjQ4MDc5N2EzMzlkZDMzYjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2YTI0OWI2MWQ0MjQzODZlZTAyYjdmNDgxNzY3ODgwNjZmNWQ4MTk1ZTQ2M2MzMzVhODkxYjZkMThkZDllZmVkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNTk4MDczODlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MzY2NTMxMjRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4OTkpLTM1Ny05NzIwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig0MTApLTIyMC01NTYyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzQzLTI1LTcxNjFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi83Ni5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi83Ni5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc1ODI0ZjcxOWZhZTFlZDlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImVyaWthXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJyZXlub2xkc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzk4MCBkZXBhdWwgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidGVubmVzc2VlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjcyMzM1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJlcmlrYS5yZXlub2xkczg5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaGRvZzIxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJrZW5uZXRoXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIlJleXF3eTZDXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZmI3ZWU3MDEyMmZiZmM3MmI4MGRlYTZlODQ5NjBhNTZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYmEzZmFiNjdkOTc0YTg5YzJiNDBiYjVlMjRmNDBiNjdjNDQ0Y2ViYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImYwYTRiOGUwMzkwMGVhM2UwZmMyMjQ4MWZlMzAxY2UyMDNiNWJlN2E2NzhlODdhYTBiMzMzYzUxNzc4MmQ2OGRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2MjU2OTQ2MFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjUzOTY1MDM5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDExKS03MDMtNTQxOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzkyKS00ODItMTcxOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE3Ni0yOS04MDE1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ZGRhOWE5ZjU2MTQ1MDNiXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImV1Z2VuZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwib2xpdmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NDYwIGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGVzb3RvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicGVubnN5bHZhbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM3MzAwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJldWdlbmUub2xpdmVyNTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInllbGxvd2VsZXBoYW50OTEyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIwMTIzNDU2N1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI3VGZQbFBKTVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE1NTE1YTJjMTJmODI5MWJmN2ViMjMzMDY4MDg1Y2ZmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE3NjA5Yjc3ZjYxZTU0OTIwMWQ1ODk3ZWEyZjJiYWQ0M2NkZjAyZjlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjZjlmNzZmYzkwOTY4ZmNmZWZlNGM5ZWI3N2ZmOGFmZDU2YzM1NmZmMDFjZGEyY2I5ZDFkNzkzNDIzODJlNTE1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzUzNTkyNDFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI5NTM1MjAwM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEwMCktNTIyLTQ2OTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5OCktNDg5LTM2NDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxNzYtOTEtMTcyMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmMyYTA1NDdkYzg5N2NhMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJrcmlzdGluXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoYW5zZW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ2MDcgZmluY2hlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibW9kZXN0b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5vcnRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NDc3OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia3Jpc3Rpbi5oYW5zZW45MkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwieWVsbG93Z29yaWxsYTYxNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiMjcyN1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJRTG1LRnVsalwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQxMzE1Y2NiZmJmNjRiNzk0NzIzMjBiZDBmM2UwNjNmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImUyMTkxYmY2ZDBmZTM3YjEwYjVkOTY1N2MxZmJmZjVhMjcxZDBmZTlcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI0Njc4MzZlOGIxYTQ4MjM3YmU0Yjk3Nzk5ZGNkOWIxZGJhMTAyZjM2MzZjNjIzY2U4ODBmNzk4ZGUwNDY1NDNkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyNTc1OTgzOTlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI1OTMwMzIxMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU4OCktNjQ4LTExNjNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk5MSktNDk1LTY1NThcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MTgtMTQtODg2MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzY4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZDQ4MGU2ZDcxZTljYWRmOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhcm5vbGRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImppbWVuZXpcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI3MzYgbWlsbGVyIGF2ZVwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxiYW55XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiYXJrYW5zYXNcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjUzMjlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFybm9sZC5qaW1lbmV6MjFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmdvcmlsbGE0NzJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNreWRpdmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS0pQS1VPekFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI0ZjgxMWRhZjZjN2E0MjMxMmE4ZDE5ZjQ2OGQzOTBmOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI3ODU4OWExMDVjODBhYTUwYmE3NGIxMmQwZWYxYzY1MWRjMzY1ZmI5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYmRjYjQ1MTBiNDhlNjkzMDgwZDFlMmQ2NTc5ZWUwNzJmY2JiMjFjMjEyYmM5YjJhMGNhYTIzNjlkYzc3NDM4M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU3NjE5OTU2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTYwMzU3NDczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjY2KS03NzUtMjI1MFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjM1KS05ODktNDU0MVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU4Ny04MC0zNjUzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjNjA0Mjk0ZmJjOGU1M2Y3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImFtZWxpYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicm9kcmlndWV6XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNzc5IHNoYWR5IGxuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzaGVsYnlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaW5uZXNvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzQ4NTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFtZWxpYS5yb2RyaWd1ZXozOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVrb2FsYTg1NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic25vd2JhbGxcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSU1PZzhaZG9cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3YmM3MTViNzg2OWVhZjJmYjg3YzA1NmJkNzAzODlmNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MDFlY2JlMGJhMzk2YzhjMjA0ODZjYTg1NzY4NThjZmQ1ZTk0NGM2XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOWRhZGRhZDAwMWVlZGEzYWY3OGIwNTNmZThkNjExOTkzMGQyZTI1MmJjMGU4ZjgwY2M2MTI5YTYzYzE2NGQzNVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDg2MzUwMTU3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjU5MjQzOTVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NTgpLTQwOS0zNzc0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NTQpLTc4MC04MDA0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTMwLTI0LTEyNTJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzg3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84Ny5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImJlMTJkNTFlOTgwNjA4ODRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWF4XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJoZW5yeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTQ5NiBwYXJrZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImR1bWFzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODIzODZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1heC5oZW5yeTUxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJsYXp5a29hbGE0MzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImxpdmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiM0VPS2lQZGFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5Mzk2NDMzODhlZGVmYmU0MzY1ZjlhMjBjOWI5YTZiZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5NDUwNjI2YjliZGIxMjg4YTA2ZWZlNjgwNTRiOTBhOWExNjFhYTIwXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2FlMDJmMTI5YjFmYzI4MjJkMmRjZjBiMzcyMDYyNDU3ZTkxZWYyNTk1MDFhYjJmZjgzMDU0NmVhNTdlYWEzM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjQ1NzcwMjExXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTg2MjgxNDQ5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzkwKS04MjItNjg0MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzUxKS03NzctNTMxMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkxMS00Ny0yOTczXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3ZGRmZDdlNTBjMTc5MGFmXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIndpbGxpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGFsbWVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MzAyIGJvbGxpbmdlciByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZGV0cm9pdFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODYzMTNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIndpbGxpZS5wYWxtZXI1OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JnYW5pY2dvcmlsbGE1MzlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImJydXR1c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJKSTZaeUtWU1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjBkMzU2MGVlNTEyYWQxNmVlZTgzYjEwY2MzZGNlZWRlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA3MTcyODgxYzg5YzMxYmQ2YWE3M2U2ODA3NGJmNDRjYTEzMzQ0YjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2NjBmZTVhYzQ0NDhhZWIyZjA3M2U0NWQyYjc3NzgwMjFkYzNjN2I1N2U1MGYyNTYwMzZlMjhkNTE1N2JjZjMxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNDYxODkxMzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzNjc2NzQyM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDcxNCktNzAxLTc5MTNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ0MiktNTEwLTE3NzZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3NTItNTYtNTczNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjdlMjM1MzBmNTExMTNhYVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0eWxlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY29sbGluc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzQ3NCBmYWlydmlldyBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwidGhlIGNvbG9ueVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjY4MTE2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0eWxlci5jb2xsaW5zODBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWNhdDYwOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicGFycm90XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIm81SHBNTERzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzAyMTlmNjRlZThiNzU3Yzg4YmJmYTZhNjQwNTlhNzBcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYTIwNmMwN2Y0OGVmNDJlMDhlMWQwMGI3NWZlMTYyMTdlZGRjNjYyZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhkODQ5Y2ZmYTY0ZmVhYjFhMTYyMTk1NmY5NTNmYTk0ZGZiODRiYzczODI1NjA1MmRjYTZlNGUyY2U4NWE5MmZcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM0OTIzMzg0OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE3NDExMDAzMlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg5NyktMTMyLTgyMzZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDYxOSktMTczLTk0MDBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NjQtNTMtNDIxMlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYjAwYmUwNjM0ZDkzM2Q5MVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJmcmFuY2lzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJhbmRyZXdzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNzk4IGZpbmNoZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInNvdXRoIGRha290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0ODc5OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZnJhbmNpcy5hbmRyZXdzMjRAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWViZWFyNzMxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxOTY5XCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklrNmR4eXI1XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiNmY1ZjJkYWNiNjMyY2M3NDk5MmE4MTk2ZGI0MGZmYzZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiY2MzYWU1YTI1MDMwNzRmYzVjMzhiNTJmNDc0NGNiODVhNWYzNGM2M1wiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjY5MzVlMDk3ZDBiMjVmMWQ0ZTgxNjZlYTlkOTE2YmE3ZWQwZTBmYjBiZjU4NDk0YzU2NTg3MzUwNGQ3NzczZGJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE0ODEyNDM2OVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE2OTI1NTM0OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDE2NSktNzY3LTgwMTZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkzNSktNDg0LTQ0MDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5MTMtODktNTkzMFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzc2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzc2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNWYzMDAyY2Y5Mjg4OWNhOFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1heGluZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGVuZGVyc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyNjc1IGRhbmUgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNpbmNpbm5hdGlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2OTk3OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwibWF4aW5lLmhlbmRlcnNvbjI2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ5ZWxsb3dvc3RyaWNoOTEzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtYXRyaXgxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImpWUDRjRjVFXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzE5NjMzM2IwNGM5ZDA3NjFjYTUxNzI1MjM0MjNhODdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjlmYjQ1ZWEwMjEzMDFhMjQ4ODViOGE4YjkyNmJjYTE2OWFjODcxNFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhkOTdhMTk3YmIyMjQwYjE2YTgwMTk3N2YyZDExYjQwMmU2ZmI0ZjUyODIxMDZhOTA0YzhmMDNjYzczMjMwODdcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTMzMzcxOTQzMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjExNjIyNjM0NFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk0MyktODgwLTQ5MjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQ2MyktNjg2LTE5MDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI2MzMtMTAtMTAwMVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMjkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzI5LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzI5LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiM2UyODc4ZmFiZDkxNjNhNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0cmFjeVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaG9wa2luc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNzE2NiBodW50ZXJzIGNyZWVrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoYW1zYnVyZ1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZpcmdpbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ1MDk3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0cmFjeS5ob3BraW5zNjhAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWxhZHlidWc5NDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIklRN2wzeDdOXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYWE3OWEyZDE1ZjdlZmVhYTM2MjM2ZTA3MjJjYmI1ZmJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiOWFjZmQ1YTEzZjEzYWU2NjA5ODllMDA1NGMxODQwYzhiYTA2NDNkYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjhmNzk2NmIyNTkzMmRmMTYwYzM0NmYxM2Q5MTllYjZiYmZjZDY1NGU5Njk1YzZjZmVhMzc2ZmYyOTcyN2UwMjBcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTIwMTE3Mjg3MVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ2OTQ3MzIzMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgyNiktNTI3LTI5MDVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk4NiktNTIzLTYxNDRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyNzMtMjQtNjMyOFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzEzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYTE5MGE0YjQ5NjE0YTA0YlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYW1lbGlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJuaWNob2xzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NTQ2IGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxsZW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgeW9ya1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NjAyMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYW1lbGlhLm5pY2hvbHM2OUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwid2hpdGVsYWR5YnVnOTUzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJvYml3YW5cIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiRkQyY1hIVmlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlOTI2NGE3OWMzY2QyOGJkYThjNDY0MGRkMmVkMGIwZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0MTk0MjIyNTVhM2VhY2RkMjc3ZmQwNTU1MGJmODFmNGMxNzkzNWI3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOWM0ZTU3YjA0Y2RhOTM0YzdlYTg0NGMwZDdhYTU0NTkwZjUxZDZhY2Q1MTJkNWM3MDFiNjUxNmMxNGVlZjkwNlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDY4NTAzMDQ3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTEwMzg3ODkzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjk5KS0yOTktNTM5OFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzg3KS0yMzgtNTQwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjYxOC0yMC04NDMwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi85MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOTEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vOTEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4NGVkMGU0ZmQ4NGU4YzBjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImF1YnJlZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGV0ZXJzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjg1ODYgZWR3YXJkcyByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY2FwZSBmZWFyXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IG1leGljb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MzIxMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYXVicmVlLnBldGVyc29uMzFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ2R1Y2s5MTFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhcmJvblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJhMmQ1NmF2UVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjc2YWRlMGQwNmQxMGEwNWFhYmY0MjEyZDEzODdjODU4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjg0YmRiODBiN2U0OGE2YTkxNjRhZjhlMDI3ZjBjZjk0MjBhNGQ5YzJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyYmQwOTAxOGU0N2I1Yjg3NmY5ODY3MDg4N2MwM2QxNmU4MmI5MTM1ZWQ4ZTY4MTVlNzFiY2MwOGNjOGVjMWIzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExMjQzOTUyNzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMzA3NDkxN1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDEyNiktNTQ4LTExMDZcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDQwNCktMzU2LTEyNTBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4MDQtMzUtNzM5MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNDQ2ZjRiMmMyMjBjOGE1ZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamVhblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwicGV0ZXJzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0MTgxIHdhc2hpbmd0b24gYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiZXJuYWxpbGxvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW5kaWFuYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3NzEyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamVhbi5wZXRlcnM5OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic2lsdmVyZWxlcGhhbnQzMDNcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIm1lYXRiYWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIndXNTlmMFJ5XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjc3OWFmZDM3OTlmN2M5YWM5ZGM1ZTFmYzk3MGFmMmZcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYWY1ZDJmODIwZDUwMzQ0ZjAxODhhMDRhOGZjZWMzNmQ2YzQxMDFjYVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImQzOTBiYjAwYzY2YTBjMTQxMDNhMjgwN2Y2MzIxNDc1YWIyMmRkNDVmOGIyMDE2OWUzZjkyMDY1NWM1MGIwYTVcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTAwMTk3MTY1M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3MjE5OTQyOVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDM3MyktNDE5LTI3OTRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5OSktMTk2LTEyNDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MjYtMjMtNDc2OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZmQwNzU1MGVkNDcwZTIzNFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhbWlsYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwic3RhbmxleVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNDc2OSBodW50ZXJzIGNyZWVrIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJiaWxsaW5nc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9rbGFob21hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI0MjU2XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJjYW1pbGEuc3RhbmxleTg2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJnb2xkZW5tZWVyY2F0NTA1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJqdWxlc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCI1ZzYwbTdQQlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjViOGVjM2RmNmUyY2QwYTQ0NWI1ZTI0ZWZkMTliNjBjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImU1NDgxZGY2NzI5NTg1NTFhZmJkMGI0ZTgwMWNhOGM1YTIyMDJlYWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI2MGFiMmM5MzE5ZjhlZGQwZmMyYmZmZWZiYzc0MjYwZjkwMmY0NDljY2EzODZiNmMxNzczMWQ2NGM4ODRhM2RhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNDI2MzY2OTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNTM2MTA3NTNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MjApLTMzMy01MjY5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzNTApLTY1Mi00MTgyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNjE0LTc1LTcyODNcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjMwNjM4NWU0N2VmZWQwY2VcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInRvbnlhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJqb3JkYW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM1Nzkgd2hlZWxlciByaWRnZSBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZmxvd2VybW91bmRcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NjUxMFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwidG9ueWEuam9yZGFuMzNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlmcm9nOVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicHJlY2lvdXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiV2RNWXNZRGVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMmZkNWY3MzMwODI2YWYzMmUyYTQxMzg0MDc3ZWRmOFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxYjZlNTQ5MDE2MWFiM2Q3MTJkOTQ2MTQxM2Q0NDQ0ZWVlNDljMWM4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjNhN2FhNDI1NDhkYjViNjVkYjlmZDRmOGVkMzUyZmQyZDAxMDI1ODgxYTFhZWYwNzhmNTQwY2ViMmNjODA4NVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzMxODY4ODA3XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjkyNTk2OTU2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTEyKS04ODktNDg3NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTA5KS01NTItNTU4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk2MC00NS02NzgyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjIuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjIuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2NmE3YjEzNjk2YmUwMmRjXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvZ2VyXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGVwaGVuc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODk0NCBncmVlbiByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicm9jaGVzdGVyXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwicmhvZGUgaXNsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg5OTcwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb2dlci5zdGVwaGVuczcxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaHJhYmJpdDYzNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYnJ5YW4xXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImFCWDRrNXZXXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMjA2YzkwZGY2OTM3Yjk3MzI2NDZkZWIwMDdjZTdhNTFcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNDE3NjJlMzc2ZDkyZGZiMzRmZjI5MDRkNGE3MWQ0ODc1NjYxZDUwMVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjFhNmRlYTgwMDZiMzBhZDFmMWZmN2U5Y2NmNzAyMmY3NTNkZGNjZWZhYzdhY2I2OGVlN2VkMDE0YjQ2M2M4YjFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTM2MDMyNDYwOVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQxMjU2MjgwOFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQxNyktOTQ1LTM3NDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMxMiktODc2LTk5NTVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1MzYtOTItMTE4NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzYzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMzU5MWNlNDY2YTM3OGUxNVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJnZW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YWxsYWNlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIxMTI4IGFkYW1zIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJhbGxlblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImFsYXNrYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxMTEwN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiZ2VuZS53YWxsYWNlOTFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVsaW9uMjc2XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJlbWlsaWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVmtoS3RldTNcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxOGY2YmEwMjMxYWUyMzZmYjc1Y2ZlNjM0OGNkY2E4ZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZjI4YzVkZTJhODM1M2M1NDZlN2EwOWJiZjIwZDVmYzI1YjdhYzFiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYWE4OWJlZDRmMDQ3N2VjZmU0MTE4MWUxNTJkOTYyM2JjOGQxNTIxYWE4MWQyNWUyYTg1Y2I2YTA1Y2Y0ZGU0MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDQ0NDE2MTU0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTQxNDQxMjQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjczKS0zOTMtNzkzMVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTMyKS03NzktMjk5OFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjY2OS04NS0zNjc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NTU4ZDViYzZlOTUyMWY1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia3lsaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBldGVyc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI0NTk1IHBvcGxhciBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWxiYW55XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY2FsaWZvcm5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIxNzY2OFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia3lsaWUucGV0ZXJzb24zOEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmxhY2tnb3JpbGxhMjMwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ1dG9waWFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiblEzVG92SURcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJiMzU4OTZhM2M2NWU5NTU3ZmFiNmUwZjIyYTIwNTQwZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIwMmMyZDRmZDBjMjllYTAwNzAwM2VmNjM4YmY1ZDM4N2U4OWY2ZGY3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDk2ZmYwZDMzYjJhY2IxNjJiMTRjMjliMzZiNTU3YmYxMTk3NzJkZWVlYjBkNjdlMGQ2OGQyZWMwZTM5ZTViMVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU3NzgxNDUyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjQ3Njg1MTUyXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzM3KS02NjUtOTY3N1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTMxKS0xMjctODQ4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjc3MS02OC04NDQ1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8wLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIyZmVhOThhZjcyMmQxZmI1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2Fzc2FuZHJhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXJkXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2MDk3IGZvcmVzdCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicmlvIHJhbmNob1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImthbnNhc1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0NDcyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2Fzc2FuZHJhLndhcmQ0OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmlnb3N0cmljaDM2NlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiNTViZ2F0ZXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVng0Mm5yZjBcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI2N2Q1MmE2ZTIyNjRhMWEwMjFjODQyNjE0MjA0NDMzNVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyYmE4OTY1YzNlYjZiYTFjNjQwNDE2NjEwYWM2ZDBlZjBjZDJjZDI3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDE2NDE0ZjUyMzViMmUyYmI5OTY3MmY1NGY5ZDNiNjM3YTRhZDdjZTRlZDgyZWQ1ZDg5ZmUwMjUzMTIzNjM5Y1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzY1MjMxNDcxXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjg5MTk4OTkzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODA5KS01OTctOTg0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDYwKS0zODktNjkwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjcyMC0yOS04ODU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8zNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMzQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMzQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwMjU4ODUxNTQ3NDA4NGM0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIndhdHNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjYyNiBjaGVycnkgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFkZGlzb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJsb3Vpc2lhbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTQ4MDBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImFteS53YXRzb243MEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlZnJvZzkyMFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYW5nZWwxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkJoWUh3TFAwXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiOGYwZTJjNGEwNjUwMGZjYmY1MzY1NzMzNjJiMDAzNzhcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDE3MDk0MjJlMjM0MWYxYWE1MjNhMGM4OGFkY2YxZWFhY2JmN2MxOFwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjIxZDYwZDQ2N2FjNWIwYjRhZWQwNzQyMjU5Zjk5YmMzZDE2ZWRjMDdiZjE0MmIwOWM4NTZkODY4ZmRhZDllM2NcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTk1ODI2NDg4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjk4NjA1NTczXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMjQ0KS0yOTQtODQyNlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNTc4KS0yMTktOTE5NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk5MC00OS03MTUyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmOWJmNjc5NTQ3MzcxZTYzXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhcnRlclwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZHVuY2FuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2NjYxIGFzaCBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZ3JhbmQgcHJhaXJpZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyBoYW1wc2hpcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjI2NTlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhcnRlci5kdW5jYW42N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiaGVhdnliZWFyMjU0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3d3d3d3d3d1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtRms3MlBvWVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZhOWQ3OWNlZTE2NDA0MTUzNzFlNjAwNjdhYjM5YmMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjg4YzcyZmQwYmQ5YzFhZjg0N2MwZGE5MWRlMjI1ZjUzODIxYWIzMWFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlNTUyODZiY2I3OTNiNzFmZTQ1NTEyNjM4NmVjMGZhMWZlMzliY2E4MzAyNWIxMWY1ZGUxOGY1ZWVkNTBmYjllXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk2MzY1OTA5M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3Mzg0MTI1NVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDYxNCktOTI1LTk5MDFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDg5MSktODkzLTE5MzVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyOTctODUtMjAzOVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzI2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMjYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzI2LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmE3NDBlNjU2NjQyMGFmMlwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJhbHlzc2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJhcm5lc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjk3NyB3aGl0ZSBvYWsgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvcyBhbmdlbGVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiaW93YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI5MjI3M1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYWx5c3NhLmJhcm5lczc5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja2R1Y2s3MVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwic3ByaW50ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiVXk0Q0lpNEhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIzODJhOGU4Zjg0YTIyYTBlOWU4ZDU5OTFiYWJjYThkM1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhMjRjZDI0NzFjZTBkOTFlOTkwYThiOGQ4ZjhjNjc3NGI4ZDNkZmI4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDI3ZjllYTQyZmQzYjFhOWE2NjA0ZThhMWQ5OTM1ODEwMDFmZDg4Y2I4NzIyY2YzOWFhZTU1MjJmYWMyM2JmN1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzg1MjgxOTI4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjY4NDE4NzA3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODcwKS01MjUtOTEzNFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzU5KS0xNjAtNTQwOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjk4MS0yMy01NzkwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi82NS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNjUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNjUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIxMmU1MzQyODg1M2MxYWM1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZGVuaXNlXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtYXJ0aW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE4MjEgcm9iaW5zb24gcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInV0aWNhXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY29ubmVjdGljdXRcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNzA2NzJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImRlbmlzZS5tYXJ0aW40MUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicmVkYmVhcjE1N1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibW9udHkxXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImpXWlVueGFTXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYjYwMjQ4MjgyNzQ2NmVkODc4ZDU3ZGM0ZTcxMDJmMDlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiN2VlNjMzMTc2Yzc4MTFhYTU4NWY5MjIzMDI0NjM2N2QyZDc5ODFlZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjBkYmRhNjMwY2FiZmJjZGViYzI1NWM1NGJiYzk4ZGQ0MTg5YjY0MTY3OTllYjg4Mzg3YjYzNTFiOWFhYjNkZDRcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI4Njc2MzM2M1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ5Mzg5NjU3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzQ5KS01NTktNzcxOVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDEzKS0zNzAtOTAxOVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjEyMi02MS05MDU2XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJmMjA5M2VlOTZkMmE5N2NlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvc3NcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcnJpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTI1NCBsb3ZlcnMgbG5cIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1cmVrYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndlc3QgdmlyZ2luaWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTMyMzVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvc3MubW9ycmlzMzVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInRpbnl0aWdlcjU0OFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwidGhhbmF0b3NcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieXE0TXhCdFFcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyZGY0YzhlOGYxZWQ4MTlkMjAwZmJmOTRiY2MyNDFiYlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0ZmE4MGVlNTQ1NDg2ZGQ4NjkzNjA0NmVmNWRkMDY0N2U3MDAxZWVjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjY4MmYxZmY3ZWJjYzcyYTg0NjkzYmU2NmMxN2ZkYTU4YzRiMTI5NzViNjk3NjE2ODkwZTUxY2YwN2IyZmVmY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMjQwOTM0ODE2XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjI4MTcxMzExXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNzI3KS05MTgtOTc5MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjA4KS05NTUtMzc0NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjQ3OC05OC00Mjg3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzMuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJlNTBmOGQ5MzQ1YWM3MWQ5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1pc3NcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJoZXJtaW5pYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZm93bGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1ODk0IHcgY2FtcGJlbGwgYXZlXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJkdW1hc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcInZpcmdpbmlhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjg4MTQ1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoZXJtaW5pYS5mb3dsZXI1N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiY3JhenlsaW9uNTE0XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzbW9rZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiWEJzRHByZ3VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMTQ5NjMyYjQzYjJhYThhMDAwMjJmYjViNGE4ODAzN1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJlZmQ2ODc1NWY1MWNmMjMwN2Y4Nzc3NmQ1ZTVlYzYyMDk4YjM5ZWQ5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZjc2YzgwNDJjYzQ1MDA4MDNmMjEzMjY5ZTM0MWVlNjkzODM0ZWE5YTRkN2EwYzI1YmMyZGVjOWYyNjc5ZjAwZlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDU4ODc2MTA1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzcxNTY0ODI5XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDE0KS02NjQtNzg2NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNzk0KS05OTItMzQzMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMzMS04MS01ODc5XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi81LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzUuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJjMzM1NWIwYzY0MzIwOGU5XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwibWVsaXNzYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZmxldGNoZXJcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU2NDYgcGFkZG9jayB3YXlcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImV1Z2VuZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImlkYWhvXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjIwNTA1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtZWxpc3NhLmZsZXRjaGVyOTNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWJlYXI1NzFcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInN3ZWV0aWVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiNnZBa2VhN3ZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5OGM0OWY1MzI3ZjEyMjllYmI5YWU5OGE5OGU5ZDRhY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmYmE5MjdiNTRmYTRkYzZhMzQxZjE0MmMxNWZiZTRiMjI1OTcyMmRmXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNjhmNjI2NjgwZWIyYTMwYzE3OWY4NjBmNGY1NTM0NWMzZmY4OWI3MDE5MTQ2ZDU3ZGI4MmM4MzJhYmE3NGFiY1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NzEzMzE0MzlcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NzQ5MTY4OTZcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MDcpLTkzMi02NjM5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzEpLTc0Ny0zNzkyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTU4LTEwLTY4OTlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzcxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi83MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi83MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjAxOGQ4YjdkYWVlYWJiNDFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY3J5c3RhbFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiYWxsZW5cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE3NDggY2VudHJhbCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmV3IGhhdmVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwib2tsYWhvbWFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTg1NzdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNyeXN0YWwuYWxsZW4yNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZWR1Y2sxOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYW5ndXNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiN2lkVUY1bkJcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI3YmJhMGI5MWJkNDY3ZTg0MWExMjBmNGU2MzFjZWFmY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2YzZkMTdkZDAyMTZhNGIxYjI2NDlmMTBlNGJlZGFhMjY2NTMyMGUyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNzMzMDI2N2RmMDE3YmZkOWIxMDAwZjdhZjMyZTJmNWYwMmQ2ZmE4YmQ2NDRmNDU3NmE3MTM1ODQ4Mjg0NzMxM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NjI2MjczMzVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjYzMjM4MjFcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigyMDUpLTI5Mi03MDUyXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyODgpLTg0My00NDQ1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDk0LTc0LTgxODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImExOWVhYWZmMTRhNjdjZmRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIndlbmR5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmcmVlbWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MTAxIGxvdmVycyBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2hlbGJ5XCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiY2FsaWZvcm5pYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4NTcxNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwid2VuZHkuZnJlZW1hbjQwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJiaWdnb3JpbGxhOTg5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCIxMjMzMjFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiYzVtTGtLMEJcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5NjY5ZTBlYjZlN2UxMTY4ZTNmZGE2YzE0MTlmNTViZFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MDBjYzY5N2YyZjFmZDk0ZGQ2Mzk2NjQ1MTBkZDhmNTYxNjc2YzY4XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDgyMDhlNzU5YjE0MDczYjE2ODdlNmQ2MDFhNGMxYjI3YzFjNWRmMmM5MjE2NTU3OWVlZGYzOTNlNjg2Y2IwOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5OTQxODkxNDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTI1NzMzMDlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1MjIpLTE0NC01MTk2XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigzMjMpLTg2Mi0zODUzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjU1LTY2LTg3ODVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzM2LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8zNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8zNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImM3ZTJjODA3MDc4ODgzMzFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZWR1YXJkb1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwibWFyc2hhbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjc1OTUgZSBub3J0aCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiaGVsZW5hXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwidGVubmVzc2VlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgyMzMzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJlZHVhcmRvLm1hcnNoYWxsNTBAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZXNuYWtlNTQwXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJhcmNoYW5nZVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJJZGp0Q011Z1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImIwOTM2Y2FlMzM5M2UxMTQxOGUxNmYyNTRiOTU0Mzc4XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjViOGZjMzI5ZTUyYTEzM2JjYmViNzcwMzA5ZmRjZTY5ODZiMjE5ZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4NTUyMTg0M2YyYzljNThmMmQ4MzlkYmQxMDE3NDgwNGU1YTI5ZDQ5OGMzMmU4NmFiNWYzZmIxYzNlMDgwNjUwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyODE0ODU3NzRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMDM5NDMxNDBcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig0NzApLTY0NS0yNjgwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5NTkpLTYyNC03NTU4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzI5LTg2LTI5ODdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzYzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi82My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjljNjM5ZTljNzJhZjcwNWFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqdWxpZVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JhbnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjI0ODAgbGFrZXZpZXcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInN0YW5sZXlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJpbmRpYW5hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjQ0Mjc1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqdWxpZS5ncmFudDQ4QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbmdvb3NlMzgzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJpZGlvdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSSVBQOTdSTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjMwMmY0ZWU2ZWI1ZDYwMjgxNTRkZmVhM2ZhZjRlYTk1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjIyODBhMjQ0ZmRlNTVlODhhMDNiNWEwZDU4NTg2M2FlMzA0MmIzZmVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI5ZGIwYWQ5MGQ0NzdjMjYwN2Q1YTFlMjMzN2I4ZjBjNWQ0YWQ4MDRmM2UxYjY3ZTEzOGM4ZjljN2UyNDg0MTAxXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMTkyMDUxNDJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNzgyMzYzNjRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5MTQpLTg1Ny0zNzk3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig5ODUpLTczMi05MzgzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDgzLTc2LTc4OTRcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzExLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi8xMS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8xMS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjI2YTllNTYxMDdiMzc4MjhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZG91Z2xhc1wiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZGF2aXNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk2ODggZSBsaXR0bGUgeW9yayByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicHJvdmlkZW5jZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1hcnlsYW5kXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjgxMDY1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJkb3VnbGFzLmRhdmlzMzlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIm9yYW5nZWdvb3NlMTc4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJtaWFtaVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJrdWZlc3M2R1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjYzNmUxZTNiNTY2ZmU5OGMzOWZlY2ZhMTljOTg4ZTZiXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjU5NzU3ZWRlOTFiNGNhNTc2ZGUwZjNiN2RhODk0YTNkZDM3MDMxMjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI4ZmVjMmJmMjRkYjdjMDQ5ZDZkZmU4MWM0OGFhMzViZjllMjZjYzA4MzYzOTM1NzhlY2FmYmU4OTk0NzE3ZjhiXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNTY2Mzg4MjBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Njk2MDQxMFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDg1MSktNjQ4LTc2NTdcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDE5MyktOTA5LTQ4NTVcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3MTAtMzYtOTY5M1wiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzY4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzY4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOTZkMzcyMTk2NWRmZWYwMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImNhbmRpY2VcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcnJpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODc3OSB0YXlsb3Igc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvbmcgYmVhY2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXZhZGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNTI4MDZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNhbmRpY2UubW9ycmlzMjNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnNuYWtlOTQ5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ5YW5rZWVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS3RwS0lBelhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJjZTVkZDhkMTcyZDJlYTlmOTViMTlkMDA0ZWM5ODkyMVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI0MmMzMGM2NTdjNTY3NGEyNzNmMzllYzY0MDNkMjAzM2Y3ODVkODZkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiOTU4ZGJiYTFkM2E4ODI5MDY2ODU4NDhmOTJlZDMxOTExYzg5NzlhYzkzN2M3NDViMmUxNDFiNzM4NDE3NTc4MlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTQzNzQ5MDQ4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNDgyMjE5NjgzXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjEwKS00OTctODkyNVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoODYzKS03NTEtOTIwMVwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkzOC0xOC0yMTE3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8xNC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMTQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI4M2UyOGRlMDMxOGM5NzllXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImphY2tcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0ZXZlbnNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjk0MDMgc3Vuc2V0IHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzYWNyYW1lbnRvXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjA4ODdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImphY2suc3RldmVuczgzQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJidXR0ZXJmbHk1MDBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNhbGxpbmdcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwibTI2d3dKeW5cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1OGYzNDIxYTRhODkwYTcxYTU5ZjczN2Q0NDA0OTU2ZVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhZGNmODcyYzAxNzExZDYwYmQ0ZWViMWI1OWMzYTFjNmI5MTg1ZWZhXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNTY1YzNmYzhlYTkwNGVkOTQzYjU4NzA2MTNlNWZhY2E0OTlhOGQzMTViZTk1MzkzMzYxMzQ2NjdkMTA4OTI3MFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzUyNTAyODAzXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTg5MDEyMzUwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTU0KS02MjktMzQ4OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMzg1KS02NTEtMjg3NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjExOS0xMS02MzA4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMTYuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8xNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMTYuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3NWMyMTcyMWMwM2I5ZDk3XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImJhcnJ5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3aWxsaWFtc29uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIzMzMzIGthcmVuIGRyXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzYW4gam9zZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndpc2NvbnNpblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MDQ3MVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYmFycnkud2lsbGlhbXNvbjQyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGZpc2gzNThcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjEwNjZcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiakNzQ1cwbzRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIxMTM3YzllMGExM2ZmYTYyYmY2MzY2N2ExZjU1YzM2ZlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI5MGVhMDE4ODI2ODE0NTMyZmM5NjUyMDNlOGVkM2ViNzgwMjlhYzNkXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiZmEwYzk4ZTAxYjcwZjViNmY1MDRjZDc0ZjdiNTU0NDViOGU4YTNmMDg3NTdkMTFiYjZiMzYxNjg1OWZmYWQyOVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzgzMDI3NjQ5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMjkyMjUwNzYwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNjkxKS00MjEtNTAxOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNjM3KS00MjEtNzU4NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMxNC02MC02NDg4XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNjAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi82MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNjAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2ODRlZWZjYzA2MzQ4OWRhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiY2hyaXN0aW5hXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJzdGV2ZW5zXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI3MDMyIGdyZWVuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJoZWxlbmFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJva2xhaG9tYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0OTM0MFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2hyaXN0aW5hLnN0ZXZlbnMyMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwib3JhbmdlZmlzaDgyOFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwicG9saWNlXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkVvUWp1MFJBXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDMxOTVmNDE0NjM5ZWRkMmYyYTFjZDRlYmU0Njk2MzNcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiNjA0N2E3ZGY1MDFmYTZhMTkxZmJjYzM5Mjk2ZTZiN2U3MmIyNTc0ZVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQyZGI3NzliMGZlYTRjYjk0YjAyZmUxMjg3ZTA1NmFiYmNkN2MzOGIxMDYxZDA5OWI1YTE3MWI1NDliZjJlOGJcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA1ODg5NjQ5N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjIyOTk1MDYwM1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDU1NiktOTYyLTIxNjFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDc0NyktNDY2LTk2ODBcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIxOTQtMzAtNDI0MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzUuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzM1LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzM1LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMTlmMjVhOWVkYzQ1MmVkMVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiaGF6ZWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInBvd2VsbFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTY0MCBwb2NrcnVzIHBhZ2UgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxvbmcgYmVhY2hcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2ZXJtb250XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjk1NDM4XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoYXplbC5wb3dlbGwxOUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eXNuYWtlNzIyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJ3aWxsb3dcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwieEVqTFN3bGhcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5YTJlNzk3MDI4NmNjNTE5YmFiZjU3YjAzYjU1Yzk4YlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIxY2RlZTJhY2VjNWExOTQ2MWUxMzZjZWZmY2YyN2EwNmIyZjA0ZDJiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMGZjYTMwNTdhMDQyMTVmY2M5Y2MxNWM5MjFlZmIzNjZlZTYyMzZlMjdjMmU5N2RmYjk4OTViYWI5OTRjNDVmYlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzk1OTI5NTgyXCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTgzNzU4ODM1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTkyKS0zNTktNzQ4M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDk5KS05MTItODU4NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjE5My0yNC0yODcyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDEuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI1NmVmNDE2ZWYwOGUyZjA0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxldmlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImh1bnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjkxNjQgaG9nYW4gc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcInNlYWdvdmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJub3J0aCBkYWtvdGFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMjkzMzhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImxldmkuaHVudDQxQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzbWFsbGJ1dHRlcmZseTE1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmlnZm9vdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5cjB5ZnUwZVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjQwNDNhYmUzNWQ1MGJjZTk3ZGMyNDFmYWVhZTU5MWUxXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQ1MmM3NjZjMzRjZDg2MGQwYzFjOTRlZDlmMzAyMTBkYjMzMjI3MzhcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIzZGRlY2NiZDVmNmQ2ZmJkNDE4YzgzZDM3MGQxMWVkZjI5NTQwYmFiMGJhYzJhNWZmNDlkY2Q4MWMzNWQwNzYzXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzODQxMjU4MzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI2MjQ5MjkwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMTM3KS04MDAtMTkxOFwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTE3KS04NDEtMTk1NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI1OS04MC0xODkxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83OS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhODVhNDQ5MDkyNGNiMzhhXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInd5YXR0XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJkYXZpc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjYxOSBlZHdhcmRzIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwcmluY2V0b25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc1MzM3XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ3eWF0dC5kYXZpczIyQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJibGFja2xlb3BhcmQ0NTdcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInRodW1ibmlsc1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJGbDgxNlN0eVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NTY1ZjhlZWEzMzIxYTZkYjUwNWZlMmY1ODAzMDhkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjMyOTc0MWNhMjI3YWUwMDk3M2I2ZGQxODI4N2Q0MjRhYzQwYjlhYjRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI3NGE2NjVlZDY1NjNmM2NiNmIwY2Y1NzZmZTg1M2YyODNlMjQwNmZiZDM4NTcxOWFhNWIyNWJmNjc5NzdhNGIyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkxNzM4NzY2MlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjMxMjQzNDg3M1wiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDgwNSktMzkyLTQwMTBcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDk5NyktNjIwLTY5OTZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NDQtODktODI4NVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzE4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vMTguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzE4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZjlmOTZlYjEwMTM4ZTUzZVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJzZXRoXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJnYXJkbmVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1NDM3IGxha2VzaG9yZSByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibmFzaHZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IGhhbXBzaGlyZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI3MjgwOVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwic2V0aC5nYXJkbmVyOThAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcIndoaXRla29hbGE1NTRcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcIjQ0NDQ0NFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIzRHl2Qm9vT1wiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjFjMWE1NjI5YWU0OGNkYWEyY2YxMjdlNThlNTQxOWU0XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImQxYzlkOWIyNzJjMjRkYTU4Y2RkZTkzZTIwMjJlOTA4YTRjZmRlM2FcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJiODQzNzgxMTEzYmNmZGJlMDRjZmMxNmViZDViZGIyNTdmYjk4MDVkZjc0MDBhMjY1NDU2MDE1ZTg2ZDNhMzNlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzOTc4NjgyNDdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjgyOTczNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk5NiktMTcyLTYzNDNcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU0NyktNDgzLTIzMDZcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI1NDMtMzItODQ3OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzczLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNzMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzczLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiY2U5ODkzYjlmNzFhODM5N1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJtYXJ2aW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1vcmdhblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiOTExMyBtYXJzaCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwicGl0dHNidXJnaFwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm5ldyB5b3JrXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM2MjYyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJtYXJ2aW4ubW9yZ2FuNDZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcnNuYWtlNTkyXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzaXN0ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiQ0QxMFNlTmRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlZmQxNDZmYjM2ODhhMDJiYWQ2YzhiMGU2MTM4YjJhNFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI4YjQwY2Y1NTg3MzM5NGNhNDAwMjU5YTNhMGE0NjRiNzFiNTg0OGE0XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiNDk3NTRkNmQ3ODcxZDlhNWFmZGIzMWZmMjdlNjAxMjZmN2I0ZDM2ODRiMGI0ZWMyMzUzZGMyYjVjNmJjMjNkZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMzQyOTk3ODg1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTYxMzY0ODk4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoOTg5KS0xMzItNzc0M1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDkzKS03NTItMTI3NlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjMwNC05NC04NDYwXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI1NzU5MzQ1OTBiZDdiODI0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcImxvdWlzXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJob2ZmbWFuXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI1MTIyIGZpbmNoZXIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImhlbGVuYVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pc3Npc3NpcHBpXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjExODgxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJsb3Vpcy5ob2ZmbWFuNDlAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNpbHZlcmdvb3NlNTE5XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJyYXZlbjFcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiN1NKcGpnQzZcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJlNmU5YzEyMjliZWE3ZGM2N2NjMTFkZWE3MTU3M2E4N1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJiYjJhMTU0NTczOWMxYmE2NDMzNGUyOGQ2YjBiYTUzZTgyNWUyYjNiXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYzgzMzE5OGM5OWFjYmY0MjYzYzI0YzRmNDgzZTVmMzgzNjkxNzJiMGQ2MjZmNGFmNWRlODkzMWI3M2Y4YzcwZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5NDg5MjMyMjdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMTg0NjQ0NDdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MTQpLTU4OC02NDk5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxODUpLTc3NS05ODYzXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNzEwLTU3LTE3MThcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81My5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzUzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjNhYzAyODk2MWIwYTZmYjNcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwidmVybm9uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJteWVyc1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODk2MiB0aG9ybnJpZGdlIGNpclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYXJsaW5ndG9uXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwia2VudHVja3lcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDg1NTZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInZlcm5vbi5teWVyczg5QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJvcmdhbmljcmFiYml0NTMzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJzZXJ2ZXJcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiOVFVcHdxU1VcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI5ZTBjOGUzMTZlZWVhMGI4NjZlZGIzMjdhZjJiNTA0OVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhNDkwNWFjNDRjMmE4MmU5YjVlZTQ2YzEwZGMwM2ZkNzhkOGI1MTFlXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMWY1ZjRiYzM0MWUzOThlMjQxNmE3ZmVjYmE0MTkzMTM4MDA4ODA2N2ZhNzVmOTRhNWUwYWQwNjVhNTA2M2EyMlwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDExMTA0OTA4XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTIwMDY5NjQ1XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoODc3KS02MDctNzM5OVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDYzKS01MjctNzE3NFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjI4OC0zOS03MTIyXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vMzkuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi8zOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vMzkuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI2MDEzMjQzNTY2MTFjNzZlXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm1pY2hhZWxcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInN0YW5sZXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjM1OTEgbm9ydGhhdmVuIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzcG9rYW5lXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwic291dGggY2Fyb2xpbmFcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNjU1MzZcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcIm1pY2hhZWwuc3RhbmxleTgwQGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJnb2xkZW5nb3JpbGxhOTQxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJrYXJlblwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJZeHpxcEZTSVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQzYWFjMTMzMTQ2N2QwOWE5ODQ2MTIwY2I3NThhYTI3XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjEzOWM0NzgxNWFiN2E1ODUyMjA2NGRlOTAxZjY5OTQ5M2MwN2U2NWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNjIxMTY2Y2E5YzZhZjYyM2U3NGQ1MTc0MjQ1MTlkNTU0YjRhMTc3MDEwNjE4Yzg1OTU5YThjY2FlMWJhOGNjXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzM5MDM0MzdcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIzMDUxNzU3MVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDc0OSktNjQ1LTE3ODFcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDEwNyktNzk1LTM3MDdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI0NjEtNDAtMjQ5MVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzU0LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNTQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzU0LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNmMxMTY0NmMwYTYzMjRhY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjbGlmdG9uXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJtYXlcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ4ODYgbm93bGluIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJwaXR0c2J1cmdoXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibWlzc2lzc2lwcGlcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiMTEyNTdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcImNsaWZ0b24ubWF5MjdAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenlsYWR5YnVnODk3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmbGFzaGVyXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcIkM0aHZqZ3BvXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzQxODE1YzljZTMwOWRiMDcxNDgzNWI2ZTMyOWU5YTJcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiYzQ2MDIwZDU1NzU0OTZjYjNmMWYzMzY1NzMzZjM5ODQ5NjZhZTVjZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImU4YzJmNTdkODFlMjgxMDM4MmE3ZmRkZDhjYWY2MDFiYjhkMTk3YzI2MGM1NjcwNmM2MjZmM2RlNzFiM2E3YTlcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTE2NDg1NDQ2N1wiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjEzNzMyNTg5NlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDYxNSktODgyLTM5MjRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDkxMCktODk3LTI3OTdcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI3ODctODktMjcxNlwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVuLzQxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNDEuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvbWVuLzQxLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmIyZjUyM2NiYTllMTE5NVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiam9hbm5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm9saXZlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMTE0OCBkYW5lIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJncmFudHMgcGFzc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pbm5lc290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1NDcyMlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiam9hbm4ub2xpdmVyODVAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJsdWVtb3VzZTMxNlwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiYmFja2JvbmVcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiS3NDNk5STlVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwMWM4YjI0ODNlMWU1NTQwZmYyZDFjYjQ2ZDg0MzNiY1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCIyNGEwOWY2ZmQ2YmFiNzU5YmZlMjUwMzE2ODk2Y2ZkM2U0ODZhZDNjXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiM2Y5NTQwMjMwYmViM2U4MDhmNDcxNGU0ZjE2NjIwNzMwOTQyNDA5YTc3OGM5ODRhYjAyZjlhZjBlZDNiY2M3Y1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTA2MzQ4MjE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzE5NzE5MDQwXCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoMzQyKS0xNjgtNjc3NlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMjI2KS0xNTEtMTIxMlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjczOC0zMi00ODEzXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi8yOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMjguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vMjguanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCIwNjA5NTI3ODgwMzRhZTFkXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInNlYW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJ1cnRvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjg5NCBzcHJpbmcgc3RcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImFsbGVuXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZGVsYXdhcmVcIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiODAyODVcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInNlYW4uYnVydG9uNTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImhlYXZ5bGFkeWJ1ZzIyNVwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY29sb3JcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiMmdlR20wTDRcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCI1NDRiYmQzZWY3YTIxZWEzZDBiZjdlMjJjNjQ1NjY4M1wiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJkMzU5ZmNlM2E0Mzk3NzBkOGY5NGU3YTgzMGU4NWY2OTViZTU2MTcxXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjA5M2YyMGU2MTk4NWE4YjVmMDZhMzY5NTVmMDU5YTg5OTUxMDc5MTczMTgwNGY0NjFiYjQxNDEyZjU4NDBhZVwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMDkwOTg3Nzk5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiNjM0NDI2MzJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3ODcpLTI1MC00MzA0XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig1ODMpLTgxNi0xNzk4XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNTkxLTc3LTMyNDdcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8xMC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzEwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8xMC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImQzM2FmMTM1ZTM0MWQwMGFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJjYXJvbGVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImJhcnJldHRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjczNDEgZSBzYW5keSBsYWtlIHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJzdG9ja3RvblwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIndpc2NvbnNpblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1ODcwNFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiY2Fyb2xlLmJhcnJldHQyMkBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwic21hbGxnb3JpbGxhOTE4XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJraXR0eWNhdFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJwazZ1Tm83WFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjVkYTA5ZmU0OWNiNjUxYTFmYjQ0NTgyMGZjZGM5NTEwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjExMjdmYTFhN2M4OGM0N2FkMjM1ZTgyNDU2NzFlYmI5M2QzN2Y3M2FcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmYjhhMzU2OWRmZjVmNGZkZjI0YjI1MTg3NDY5YTI3ZTIxNzA1YWZjMWUzYTUwYjk5YzI4ZmNmMzg3OTRhYjlkXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMzU2ODQxNzZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDUzMjA5NTVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNzQpLTk4NS01NTc5XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NDQpLTY2Mi00NzIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiOTY4LTU2LTM2NTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80My5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80My5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjdkMWQxZDBhYTVkYWVjMjRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiYnJhZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FyclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMjE5NCBwb3BsYXIgZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImNvbHVtYnVzXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwiZmxvcmlkYVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCIzMzcwMlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiYnJhZC5jYXJyMzZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInNtYWxsZ29yaWxsYTczN1wiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwibG9ib1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJLd3RLRmUxSVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjE1NGU5MWY4ZDZmYTc4OTU2MDZmZjc5MThhMTg2YzhkXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjI0MDc5OTE2MmVjMGI2ZDZhMGMxN2Y4NTBjY2JlMmU3MWU1ZDE3NmVcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJhNzBlYmUxNGQ4MTJhNGIwYWEwMTMxNjk2YTU3MGMyMDJlOWU5MjJkNGFmZWVjOGViMGY0NmU2N2RlODQzNWJhXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyOTk1MjE3NDRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxOTA5ODAzOTRcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NjApLTk2Ny04NjM4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzcpLTYzMS0yMjI0XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTQzLTUwLTQwNTFcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzcwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi83MC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjJjZmYwZTE5ZjVkOTNmMmVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwibWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1yXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiam9oblwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiZ3JhbnRcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQ1OTkgc2hhZHkgbG4gZHJcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImRlc290b1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1haW5lXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjM5NTkzXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJqb2huLmdyYW50NzFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImxhenliZWFyOTgxXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjYXZhbGllclwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJlWDFMY3BsTlwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjZlZjgzYzIxZTc5ZDUyZjk0YjY0MWE4OTNjMmQwOGZmXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImU4ZDc5NDAwZDRmMmI0YmQ2NjVjYTI4ZGNkYzIyZmY2MWI4YmY3YzFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlYmVhZDRjZTkwNDE1NzZkODAxMWFiOGQ3Y2MzNjI3MjQzZTc5NzdkNTYyNzc1OTA3Y2RkNWQxNTg3YjE1OGI1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwNzkwNDgxMzFcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyNTQ1MDU1ODVcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3MDgpLTY2NC01MTczXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig4NDApLTY4NC03MTQ1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMTAxLTYwLTg1NzlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8yNy5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzI3LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8yNy5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjY3N2RjZDFlNmY2YWVlZjlcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwia2F5XCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJnZW9yZ2VcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjY5MzkgcHJvc3BlY3QgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImN1cGVydGlub1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9yZWdvblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI1MTY0NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwia2F5Lmdlb3JnZTc0QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJncmVlbnNuYWtlOTQ3XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJjcnVpc2VcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiR2FzVUZoRU1cIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIyNmYwN2UwYjc1ODRjNjVjMjUzMmQ0ZjlhMGNhMThmOVwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCI2ODYzMGU2ZDA1ZjI1ZTY3ZjM1MzE3ZTI5ZTlmOThmMTA1OTlhYzM3XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiMDNhOGViZDBlZDFhYzFiNjI3MDFhNTgwNWEyZmMyYWU1N2M3ZWIxMjJiMDc2OGFiZjIzMmZmMjBjZThlYzhiZFwiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTIwMTUwMzE1XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTgzNTE2MjA4XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDUyKS05MDMtOTYzN1wiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoMTIxKS05NDEtMjcxOFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjU2Ni05NC02NDc1XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi81Ny5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNTcuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNTcuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCJhYjY0Nzc4ODIyNDUxMjA0XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcIm93ZW5cIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhcmxzb25cIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE2MzkgbG9jdXN0IHJkXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb3MgbHVuYXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtaWNoaWdhblwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI0MzcyOFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwib3dlbi5jYXJsc29uNDZAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInB1cnBsZWdvcmlsbGE1MFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiY2xheVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCIwMWVGWnc2VVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE0NWRlNGE2NGQ5MmUzZDcxMmE2MTU1MTg0OWI2MTVjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjI4ZDgyNTIzNzMzY2NiNjkyNGZiMjNkNjlmMzA0NjAyZDhjZjNhYWFcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjOTc2ZTgxY2E1OGYxNGRkNzBhMDUzODg5ZjVlNjA4MTU3YTI1MjczY2Q5NWI1YWE1ZTM3YWM5MDE3YTY4MDdlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzE4NDczNzVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0MjQ2MDMzODhcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig3ODkpLTYwMy04MzAwXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig3MzgpLTUyNy03MDA1XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiODU5LTI5LTg1NzZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi82LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC9tZW4vNi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImE0MDEyNTgyOWU0NmUxZDhcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibWlzc1wiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvc2FcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImVkd2FyZHNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjQzMjUgaGlja29yeSBjcmVlayBkclwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwic2VhZ292aWxsZVwiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm9oaW9cIixcbiAgICAgICAgICAgICAgICBcInppcFwiOlwiNDg1NDhcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiZW1haWxcIjpcInJvc2EuZWR3YXJkczc3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ0aWNrbGlzaGxhZHlidWc5MjZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImhvdGdpcmxzXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcImVLcGNmVUJzXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiYzNkZjBiYzI3OTMzOGFjZWUxZjVkYmJmMTc2MzJjOTlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMjJlN2E3ZjA5MmJmZDdhZTZjMDYxMTdjMzM3YTU3OWI3YWQ1N2U0ZlwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjExZjIxNmU3NTJhMDE1MDI5MDRkN2JjMGM0YmM4MGYzMzBkNWVmYjU1YjAyYmI1ODI2NGZiYWYyMDYwZTU3YTNcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTI5ODk5MjkwMVwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjE0Mzg5MTE3OFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDMzOSktMzAwLTcyODlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDIxOCktODcwLTIwMjhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMzUtNzAtMzE5MFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vOS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi85LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiOGY1Yzk1YWVjMDdjY2VlOVwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJiaWxsXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJicmFkbGV5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyMjY4IGNhbWRlbiBhdmVcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImxhcyB2ZWdhc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcImNvbm5lY3RpY3V0XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjkzODk5XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJiaWxsLmJyYWRsZXkxM0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwibGF6eWxpb241MjBcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNpcnJ1c1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJFeTJmVFh3RVwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImRkNjNiNzA4Njk5MDAyYmZiMmI5Mzg3MGYzMjExZmZjXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjUzNjRmMzQ4NGZkYjlmOWEzZDk0ZGY1N2Y5YTZhOGY1MzAwZmUzMWRcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJmNzhhYTRlYzE1NjcxMmNiNmIyZmYzMjk2ZmI3MWJkODU0Yzk5NmJmZTRiNDgwMWU3YzRlOTVkZTRiYjYwZTlmXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjExNzk2MTkwMjJcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxNzY2MDIyNzJcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIigxNDYpLTMwMS0yMjk4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxNTcpLTQ5NC0xMTE3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMzA4LTQzLTUzNzJcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi81Mi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzUyLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi81Mi5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjc2YWNmNDQ4M2IzZDc5MjFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJ0cmFjZXlcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1pbGxlclwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzM5NSBtY2dvd2VuIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJ0YWNvbWFcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ1dGFoXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjYyNjMyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJ0cmFjZXkubWlsbGVyMTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcInJlZGJpcmQyNDhcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZhdGltYVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJUcFRQNGgwalwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjkwMTlmMzcwYjIzYmE3NjRjYjJjNzI4Nzc5OGIyZTMwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjQ2YjRiMzU1Y2ZiMTRmYzZkYzZkNzk4OGExOGU3MjRlZmU0MTQwNDZcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YzdmNzhkYmNhMjkxZWQ0N2I1ZjljYTU1NmJkMDY2Mzg4ZGQ2NGUyM2I3Y2I0NTEzZTVkZWIzMjE4ZGJlNGQwXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjk4ODIyMDM3NFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI5NDYyNDQyNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDQ4MiktOTkwLTE1NTJcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDI2NCktOTk1LTgxOTRcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIyMTQtODgtOTUzNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzMwLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzMwLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiYmNhN2E2ZDFiMzIyN2JlM1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtcnNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJiZWxsYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwia2VubmVkeVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiODQwOCBwcm9zcGVjdCByZFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiY29sdW1idXNcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJ2ZXJtb250XCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjc5MDUwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJiZWxsYS5rZW5uZWR5OTJAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImdyZWVua29hbGE1NTVcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNtYWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInJCOXNua3lYXCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiMDc1Zjk1YzYwZWMwNTdiYWUwMTJkMjgzY2Y5NWMxZjdcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiMDU2ZmRkMTVlOWYzMDVhOGFjNjYzYjMxNDE0NzY3ZWI3MWUyZjVjNVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcImExOWU0YWNhYjcxOGZkYjdiODk0OWMxOGU1NTg0OTU0MmQ3MjZmZTk5MDBjMjg1N2M4OGNmOWE1MDJhYjI4N2JcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiMTA2NjY4NDQwNFwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjI3MDUwNTQ0OVwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDkzMSktMjI0LTY3OTlcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU5NCktNzA3LTE1MDlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCIzMDMtNDAtMTgwNVwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMTMuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzEzLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzEzLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiNjgzZjc3NzExNDVlNzYyY1wiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJmZW1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtaXNzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFuZXRcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcInJpY2VcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjU4MjYgb2FrIHJpZGdlIGxuXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJmb3VudGFpbiB2YWxsZXlcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJtYWluZVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2NDY0OVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFuZXQucmljZTY2QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJzaWx2ZXJwYW5kYTQ1XCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmdXp6eVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJ5MWF2NFpaTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcIjRjMTkwMTc3YjU2ODgxODk2YTkzMjZjZGM0NTkxZjQ1XCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjliNjEzOTk3NDliZGVlMzUyM2Q0NGM5MTAwNmU5YWEwMGNhZTIyZWNcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJjMzY0YjVmMzljNTU5ZTQ3YTA3ZjQwYTIxOWEwNzVjZThmZjkwYzc3NjUyOTEzYTEyMTI1ODMyY2EwYTk5MTY4XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEzNjk0MzkzNjVcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0Nzc0MTcxNzNcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig4NTMpLTg0MC0yMzc4XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigxOTEpLTI2NC03Mzc3XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDA2LTE5LTUzMjZcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzgxLmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi84MS5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi84MS5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjIxZDg4YTM5YzU4ZDNkOWRcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJoaWxkYVwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiY2FtcGJlbGxcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwibG9jYXRpb25cIjp7XG4gICAgICAgICAgICAgICAgXCJzdHJlZXRcIjpcIjE1ODAgcGx1bSBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiYWtyb25cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJmbG9yaWRhXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjI1ODQyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJoaWxkYS5jYW1wYmVsbDg3QGV4YW1wbGUuY29tXCIsXG4gICAgICAgICAgICBcInVzZXJuYW1lXCI6XCJ3aGl0ZXBhbmRhMjQzXCIsXG4gICAgICAgICAgICBcInBhc3N3b3JkXCI6XCJmZXN0aXZhbFwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJVT2ZoRjBsMFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE2Y2VmM2ZkMzc5NjU2ZjJkMTEyYzg4N2FmYjRiMTRlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImUwMTFmNTZkNmViM2I2NmY1OTc5NzQ3NDQ1ZDljMDFiODk2OTYxYTBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCIyZmY0NzYwNWI3ZGNkZjRkZDJiMjQ1ZWY2YTVkNzQwNDgxZDlmYzQzMWRjNTA4ZWU4NzMzZWVmMWM2ODBjZjM1XCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjkzODIxNzM2NlwiLFxuICAgICAgICAgICAgXCJkb2JcIjpcIjQ0NjE0ODYzNlwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDczOSktMTE4LTUzNjVcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDU4NCktODg5LTQ3NTlcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI4NjQtMTktMzI2NFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vNDguanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL3dvbWVuLzQ4LmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiMWIyNDQwOTY2NGRhNTMzMFwiXG4gICAgfSxcbiAgICB7XG4gICAgICAgIFwidXNlclwiOntcbiAgICAgICAgICAgIFwiZ2VuZGVyXCI6XCJtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJyb25uaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcIm1jZG9uYWxpZFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNTcwNSB3YWxudXQgaGlsbCBsblwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwiZHVuY2FudmlsbGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJhcml6b25hXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjMxOTkxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJyb25uaWUubWNkb25hbGlkNjFAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImNyYXp5cGFuZGEzNjJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcInNoZWxsXCIsXG4gICAgICAgICAgICBcInNhbHRcIjpcInBSbkhxWEV4XCIsXG4gICAgICAgICAgICBcIm1kNVwiOlwiZDU2YzE1ZTRiYzkzM2I1NjJmNGY1Yzg1NGRjMGQzZDlcIixcbiAgICAgICAgICAgIFwic2hhMVwiOlwiZjE2MTBiMzVhZDAzOTg1ZGI3ZGE5YTAwMzdiY2M4ZDYzZDY5ZWVmNVwiLFxuICAgICAgICAgICAgXCJzaGEyNTZcIjpcIjQ0MjE3NDJmZmE0NjkzNDkzM2ZjYzczNWI3ZjQ4ZDgxZjliZWIxMTU5OWEwNTM5YmRkODM4MzgzN2IwMzcwOWFcIixcbiAgICAgICAgICAgIFwicmVnaXN0ZXJlZFwiOlwiOTM5MzM1MzM5XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMTY1ODc4NjI2XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNDM5KS0yNTAtNDM0MlwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoNDg4KS0xMjMtMjI2MFwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjkxOC04Ny02Nzk3XCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZW4vNzAuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJtZWRpdW1cIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvbWVkL21lbi83MC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi9tZW4vNzAuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI0YmQyNWRmYzU3YWVmMzg1XCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcIm1hbGVcIixcbiAgICAgICAgICAgIFwibmFtZVwiOntcbiAgICAgICAgICAgICAgICBcInRpdGxlXCI6XCJtclwiLFxuICAgICAgICAgICAgICAgIFwiZmlyc3RcIjpcInJvbGFuZFwiLFxuICAgICAgICAgICAgICAgIFwibGFzdFwiOlwiaGFsZVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiMzEwMyB3b29kbGFuZCBzdFwiLFxuICAgICAgICAgICAgICAgIFwiY2l0eVwiOlwibWVzcXVpdGVcIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJjb25uZWN0aWN1dFwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI4OTcyN1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwicm9sYW5kLmhhbGU1N0BleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiYmx1ZXdvbGY2ODZcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNvdWdhcnNcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiSkhaaEt4RmVcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCIwOTVkNjZjMTJkZjNkZmNlZDBlZWJmYTdiMWQzODViMlwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJhODc2M2EzN2FmZjk0NDI5ZWY5Mjg0M2FkMTFjMzQzNGFhNTc5YTUyXCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiYjRjMTBkZDZkYTBlYTc1MGY5Y2NkMjU1YWQwZWY2NDViZjU0YWYwYzI0YmRkMGRlNWY5ZWZhZTFiNzMxMmIxM1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCI5MzgzNjUzMTZcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIxODEyMTMzMjlcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig1NjIpLTg1My04Njc3XCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIigyMzUpLTg3Mi02MjIyXCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiNDY0LTY5LTU1MDlcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lbi8zOC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvbWVuLzM4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwidGh1bWJuYWlsXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3RodW1iL21lbi8zOC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcIjJkNGRkYzljMDM3NDIyOWFcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXNcIixcbiAgICAgICAgICAgICAgICBcImZpcnN0XCI6XCJqdW5lXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJ3YXNoaW5ndG9uXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCI2OTExIHRpbWJlciB3b2xmIHRyYWlsXCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJsb3MgYW5nZWxlc1wiLFxuICAgICAgICAgICAgICAgIFwic3RhdGVcIjpcIm1pbm5lc290YVwiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2Njc5NVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwianVuZS53YXNoaW5ndG9uMjNAZXhhbXBsZS5jb21cIixcbiAgICAgICAgICAgIFwidXNlcm5hbWVcIjpcImJpZ2VsZXBoYW50MTJcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImNvbmRvbVwiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJtUzV2bHFFdFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImQ0YzMwNTc0NTQzMTIyMjBjZTc3NmMyMzAzZWE5ZDNlXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcIjA2NzEzYzNiNjgzYjNhMjlhYTY2ODZmOWJjYzcxNWJhN2ZkYTU2MTJcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCJlYzcwZTBmYjNmMTkxOTJlMjUyY2JiNjgxMGEwNDg4NWJhNmRmMzk5MWM3YWQ4Y2EyNjM3NTA1NTEzZDczNWFlXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEyMTEwOTczNTRcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCI0NDAzNDY1ODdcIixcbiAgICAgICAgICAgIFwicGhvbmVcIjpcIig5NjYpLTg0MC01MjkxXCIsXG4gICAgICAgICAgICBcImNlbGxcIjpcIig2NDgpLTYyMS05NDE5XCIsXG4gICAgICAgICAgICBcIlNTTlwiOlwiMjMyLTEwLTQ0MjVcIixcbiAgICAgICAgICAgIFwicGljdHVyZVwiOntcbiAgICAgICAgICAgICAgICBcImxhcmdlXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL3dvbWVuLzQ4LmpwZ1wiLFxuICAgICAgICAgICAgICAgIFwibWVkaXVtXCI6XCJodHRwOi8vYXBpLnJhbmRvbXVzZXIubWUvcG9ydHJhaXRzL21lZC93b21lbi80OC5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi80OC5qcGdcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwidmVyc2lvblwiOlwiMC40LjFcIlxuICAgICAgICB9LFxuICAgICAgICBcInNlZWRcIjpcImMxZGZlOTQ0MjQyMzQ4NTVcIlxuICAgIH0sXG4gICAge1xuICAgICAgICBcInVzZXJcIjp7XG4gICAgICAgICAgICBcImdlbmRlclwiOlwiZmVtYWxlXCIsXG4gICAgICAgICAgICBcIm5hbWVcIjp7XG4gICAgICAgICAgICAgICAgXCJ0aXRsZVwiOlwibXJzXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiamFtaWVcIixcbiAgICAgICAgICAgICAgICBcImxhc3RcIjpcImNhbGR3ZWxsXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImxvY2F0aW9uXCI6e1xuICAgICAgICAgICAgICAgIFwic3RyZWV0XCI6XCIyMDcxIGJydWNlIHN0XCIsXG4gICAgICAgICAgICAgICAgXCJjaXR5XCI6XCJldmFuc3ZpbGxlXCIsXG4gICAgICAgICAgICAgICAgXCJzdGF0ZVwiOlwibmV3IG1leGljb1wiLFxuICAgICAgICAgICAgICAgIFwiemlwXCI6XCI2MzQ4NFwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJlbWFpbFwiOlwiamFtaWUuY2FsZHdlbGwyNUBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwiZ3JlZW5idXR0ZXJmbHkzMjlcIixcbiAgICAgICAgICAgIFwicGFzc3dvcmRcIjpcImZldHRpc2hcIixcbiAgICAgICAgICAgIFwic2FsdFwiOlwiUkJVRmdjNHlcIixcbiAgICAgICAgICAgIFwibWQ1XCI6XCJhYzQ3YWUxMGJhNWMxMzQ4NTYxMzUyNzBlYTMyM2M5OFwiLFxuICAgICAgICAgICAgXCJzaGExXCI6XCJmOTlmZmI3YzY2ZWQwNWU5MjkxM2QwNzBhZjU2Yjg3OGFkOGI0ZTQ5XCIsXG4gICAgICAgICAgICBcInNoYTI1NlwiOlwiY2I4Y2RlMTJiNmNhM2ExMDZiMGY4NDBkNzllMmRhMjk0MDVhNjIyNmEyODUwNzc3NmJlMzY1NmVmN2QzN2E1M1wiLFxuICAgICAgICAgICAgXCJyZWdpc3RlcmVkXCI6XCIxMTc1OTg3NjY0XCIsXG4gICAgICAgICAgICBcImRvYlwiOlwiMzc0MzgxOTk3XCIsXG4gICAgICAgICAgICBcInBob25lXCI6XCIoNTAxKS02NjYtMTU4NVwiLFxuICAgICAgICAgICAgXCJjZWxsXCI6XCIoOTI1KS02MDMtMjI3MlwiLFxuICAgICAgICAgICAgXCJTU05cIjpcIjgwOS0xMi02OTQxXCIsXG4gICAgICAgICAgICBcInBpY3R1cmVcIjp7XG4gICAgICAgICAgICAgICAgXCJsYXJnZVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy93b21lbi80NC5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vNDQuanBnXCIsXG4gICAgICAgICAgICAgICAgXCJ0aHVtYm5haWxcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvdGh1bWIvd29tZW4vNDQuanBnXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInZlcnNpb25cIjpcIjAuNC4xXCJcbiAgICAgICAgfSxcbiAgICAgICAgXCJzZWVkXCI6XCI3MTBjZTAyNjY0MmRkNmNmXCJcbiAgICB9LFxuICAgIHtcbiAgICAgICAgXCJ1c2VyXCI6e1xuICAgICAgICAgICAgXCJnZW5kZXJcIjpcImZlbWFsZVwiLFxuICAgICAgICAgICAgXCJuYW1lXCI6e1xuICAgICAgICAgICAgICAgIFwidGl0bGVcIjpcIm1zXCIsXG4gICAgICAgICAgICAgICAgXCJmaXJzdFwiOlwiZ2xlbmRhXCIsXG4gICAgICAgICAgICAgICAgXCJsYXN0XCI6XCJmZXJndXNvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJsb2NhdGlvblwiOntcbiAgICAgICAgICAgICAgICBcInN0cmVldFwiOlwiNjgwNSBjb3VudHJ5IGNsdWIgcmRcIixcbiAgICAgICAgICAgICAgICBcImNpdHlcIjpcImJvemVtYW5cIixcbiAgICAgICAgICAgICAgICBcInN0YXRlXCI6XCJuZXcgaGFtcHNoaXJlXCIsXG4gICAgICAgICAgICAgICAgXCJ6aXBcIjpcIjUwMTQwXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVtYWlsXCI6XCJnbGVuZGEuZmVyZ3Vzb242OEBleGFtcGxlLmNvbVwiLFxuICAgICAgICAgICAgXCJ1c2VybmFtZVwiOlwicHVycGxlbGFkeWJ1ZzQ1NFwiLFxuICAgICAgICAgICAgXCJwYXNzd29yZFwiOlwiamF5aGF3a1wiLFxuICAgICAgICAgICAgXCJzYWx0XCI6XCJSZFVEUVpLTFwiLFxuICAgICAgICAgICAgXCJtZDVcIjpcImE3ZDE3ZDUxNzU0YjRlMGZjZTE4YmJmNGRmYjZmMmYwXCIsXG4gICAgICAgICAgICBcInNoYTFcIjpcImE5NGQ3ZjZjNGQ0ZjIxNmM4ZmZlNTVmMWQ4YjhlM2IzYTEzNzQxNjBcIixcbiAgICAgICAgICAgIFwic2hhMjU2XCI6XCI1YWFjMjAzZjVlMzAwZDIwYjY5Y2FhZmYxZTc5OThhMTQwOTVkNjVhOGQzNTRmMTBjOGUyMTdkZTA0OGM1NzkyXCIsXG4gICAgICAgICAgICBcInJlZ2lzdGVyZWRcIjpcIjEwMjA2NjA5ODBcIixcbiAgICAgICAgICAgIFwiZG9iXCI6XCIyMjYzMzQ4MFwiLFxuICAgICAgICAgICAgXCJwaG9uZVwiOlwiKDk1MSktNjI5LTI4MzRcIixcbiAgICAgICAgICAgIFwiY2VsbFwiOlwiKDMyOSktNTQxLTgzNDhcIixcbiAgICAgICAgICAgIFwiU1NOXCI6XCI5NzktNDMtOTY4OFwiLFxuICAgICAgICAgICAgXCJwaWN0dXJlXCI6e1xuICAgICAgICAgICAgICAgIFwibGFyZ2VcIjpcImh0dHA6Ly9hcGkucmFuZG9tdXNlci5tZS9wb3J0cmFpdHMvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcIm1lZGl1bVwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy9tZWQvd29tZW4vMi5qcGdcIixcbiAgICAgICAgICAgICAgICBcInRodW1ibmFpbFwiOlwiaHR0cDovL2FwaS5yYW5kb211c2VyLm1lL3BvcnRyYWl0cy90aHVtYi93b21lbi8yLmpwZ1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJ2ZXJzaW9uXCI6XCIwLjQuMVwiXG4gICAgICAgIH0sXG4gICAgICAgIFwic2VlZFwiOlwiZTU3ZGVlYjA1MDQwMzQzYVwiXG4gICAgfVxuXSIsInZhciBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIGNvbnRhaW5lckNvbXBvbmVudCA9IHJlcXVpcmUoJy4vY29udGFpbmVyQ29tcG9uZW50Jyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnR5KGZhc3RuLCBnZW5lcmljLCBrZXksIHNldHRpbmdzKXtcbiAgICB2YXIgc2V0dGluZyA9IHNldHRpbmdzW2tleV0sXG4gICAgICAgIGJpbmRpbmcgPSBmYXN0bi5pc0JpbmRpbmcoc2V0dGluZykgJiYgc2V0dGluZyxcbiAgICAgICAgcHJvcGVydHkgPSBmYXN0bi5pc1Byb3BlcnR5KHNldHRpbmcpICYmIHNldHRpbmcsXG4gICAgICAgIHZhbHVlID0gIWJpbmRpbmcgJiYgIXByb3BlcnR5ICYmIHNldHRpbmcgfHwgbnVsbDtcblxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gZmFzdG4ucHJvcGVydHkodmFsdWUpO1xuICAgIH1cblxuICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICBwcm9wZXJ0eS5iaW5kaW5nKGJpbmRpbmcpO1xuICAgIH1cblxuICAgIGdlbmVyaWMub24oJ3VwZGF0ZScsIHByb3BlcnR5LnVwZGF0ZSk7XG4gICAgZ2VuZXJpYy5vbignYXR0YWNoJywgcHJvcGVydHkuYXR0YWNoKTtcbiAgICBwcm9wZXJ0eS5vbigndXBkYXRlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBpZighZ2VuZXJpYy5lbGVtZW50KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBlbGVtZW50ID0gZ2VuZXJpYy5lbGVtZW50LFxuICAgICAgICAgICAgaXNQcm9wZXJ0eSA9IGtleSBpbiBlbGVtZW50LFxuICAgICAgICAgICAgcHJldmlvdXMgPSBpc1Byb3BlcnR5ID8gZWxlbWVudFtrZXldIDogZWxlbWVudC5nZXRBdHRyaWJ1dGUoa2V5KTtcblxuICAgICAgICBpZih2YWx1ZSA9PSBudWxsKXtcbiAgICAgICAgICAgIHZhbHVlID0gJyc7XG4gICAgICAgIH1cblxuICAgICAgICBpZih2YWx1ZSAhPT0gcHJldmlvdXMpe1xuICAgICAgICAgICAgaWYoaXNQcm9wZXJ0eSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB9ZWxzZSBpZih0eXBlb2YgdmFsdWUgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGdlbmVyaWNba2V5XSA9IHByb3BlcnR5O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBnZW5lcmljLCBzZXR0aW5ncyl7XG4gICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xuICAgICAgICBjcmVhdGVQcm9wZXJ0eShmYXN0biwgZ2VuZXJpYywga2V5LCBzZXR0aW5ncyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGV2ZW50TmFtZSwgc2V0dGluZ3Mpe1xuICAgIGdlbmVyaWMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICBnZW5lcmljLmVtaXQoZXZlbnROYW1lLCBldmVudCwgZ2VuZXJpYy5zY29wZSgpKTtcbiAgICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih0eXBlLCBmYXN0biwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBpZihjaGlsZHJlbi5sZW5ndGggPT09IDEgJiYgIWZhc3RuLmlzQ29tcG9uZW50KGNoaWxkcmVuWzBdKSl7XG4gICAgICAgIHNldHRpbmdzLnRleHRDb250ZW50ID0gY2hpbGRyZW4ucG9wKCk7XG4gICAgfVxuXG4gICAgdmFyIGdlbmVyaWMgPSBjb250YWluZXJDb21wb25lbnQodHlwZSwgZmFzdG4pO1xuXG4gICAgY3JlYXRlUHJvcGVydGllcyhmYXN0biwgZ2VuZXJpYywgc2V0dGluZ3MpO1xuXG4gICAgZ2VuZXJpYy5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICBnZW5lcmljLmVsZW1lbnQgPSBjcmVsKHR5cGUpO1xuXG4gICAgICAgIGdlbmVyaWMuZW1pdCgncmVuZGVyJyk7XG5cbiAgICAgICAgcmV0dXJuIGdlbmVyaWM7XG4gICAgfTtcblxuICAgIGdlbmVyaWMub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgIGZvcih2YXIga2V5IGluIHRoaXMuX2V2ZW50cyl7XG4gICAgICAgICAgICBpZignb24nICsga2V5LnRvTG93ZXJDYXNlKCkgaW4gZ2VuZXJpYy5lbGVtZW50KXtcbiAgICAgICAgICAgICAgICBhZGRVcGRhdGVIYW5kbGVyKGdlbmVyaWMsIGtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBnZW5lcmljO1xufTsiLCJ2YXIgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyksXG4gICAgY3JlYXRlQ29tcG9uZW50ID0gcmVxdWlyZSgnLi9jb21wb25lbnQnKSxcbiAgICBjcmVhdGVQcm9wZXJ0eSA9IHJlcXVpcmUoJy4vcHJvcGVydHknKSxcbiAgICBjcmVhdGVCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyksXG4gICAgaXMgPSByZXF1aXJlKCcuL2lzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG4gICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZXR0aW5ncyA9IGFyZ3NbMV0sXG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4ID0gMjtcblxuICAgICAgICBpZihpcy5jb21wb25lbnQoYXJnc1sxXSkgfHwgdHlwZW9mIGFyZ3NbMV0gIT09ICdvYmplY3QnIHx8ICFhcmdzWzFdKXtcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXgtLTtcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjcmVhdGVDb21wb25lbnQodHlwZSwgZmFzdG4sIHNldHRpbmdzLCBhcmdzLnNsaWNlKGNoaWxkcmVuSW5kZXgpLCBjb21wb25lbnRzKTtcbiAgICB9XG5cbiAgICBmYXN0bi5kZWJ1ZyA9IGRlYnVnO1xuXG4gICAgZmFzdG4ucHJvcGVydHkgPSBjcmVhdGVQcm9wZXJ0eTtcblxuICAgIGZhc3RuLmJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nO1xuXG4gICAgZmFzdG4uaXNDb21wb25lbnQgPSBpcy5jb21wb25lbnQ7XG4gICAgZmFzdG4uaXNCaW5kaW5nID0gaXMuYmluZGluZztcbiAgICBmYXN0bi5pc0JpbmRpbmdPYmplY3QgPSBpcy5iaW5kaW5nT2JqZWN0O1xuICAgIGZhc3RuLmlzUHJvcGVydHkgPSBpcy5wcm9wZXJ0eTtcblxuICAgIHJldHVybiBmYXN0bjtcbn07IiwiXG5mdW5jdGlvbiBpc0NvbXBvbmVudCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ29iamVjdCcgJiYgJ19mYXN0bl9jb21wb25lbnQnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRpbmdPYmplY3QodGhpbmcpe1xuICAgIHJldHVybiB0aGluZyAmJiB0eXBlb2YgdGhpbmcgPT09ICdvYmplY3QnICYmICdfZmFzdG5fYmluZGluZycgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZyh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJyAmJiAnX2Zhc3RuX2JpbmRpbmcnIGluIHRoaW5nO1xufVxuXG5mdW5jdGlvbiBpc1Byb3BlcnR5KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nICYmICdfZmFzdG5fcHJvcGVydHknIGluIHRoaW5nO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb21wb25lbnQ6IGlzQ29tcG9uZW50LFxuICAgIGJpbmRpbmdPYmplY3Q6IGlzQmluZGluZ09iamVjdCxcbiAgICBiaW5kaW5nOiBpc0JpbmRpbmcsXG4gICAgcHJvcGVydHk6IGlzUHJvcGVydHlcbn07IiwidmFyIGNyZWwgPSByZXF1aXJlKCdjcmVsJyksXG4gICAgZ2VuZXJpY0NvbXBvbmVudCA9IHJlcXVpcmUoJy4vZ2VuZXJpY0NvbXBvbmVudCcpO1xuXG5mdW5jdGlvbiBlYWNoKHZhbHVlLCBmbil7XG4gICAgaWYoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KHZhbHVlKTtcblxuICAgIGZvcih2YXIga2V5IGluIHZhbHVlKXtcbiAgICAgICAgaWYoaXNBcnJheSAmJiBpc05hTihrZXkpKXtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgZm4odmFsdWVba2V5XSwga2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGtleUZvcihvYmplY3QsIHZhbHVlKXtcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZvcih2YXIga2V5IGluIG9iamVjdCl7XG4gICAgICAgIGlmKG9iamVjdFtrZXldID09PSB2YWx1ZSl7XG4gICAgICAgICAgICByZXR1cm4ga2V5O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiB2YWx1ZXMob2JqZWN0KXtcbiAgICBpZihBcnJheS5pc0FycmF5KG9iamVjdCkpe1xuICAgICAgICByZXR1cm4gb2JqZWN0LnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gb2JqZWN0KXtcbiAgICAgICAgcmVzdWx0LnB1c2gob2JqZWN0W2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odHlwZSwgZmFzdG4sIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGxpc3QgPSBnZW5lcmljQ29tcG9uZW50KHR5cGUsIGZhc3RuLCBzZXR0aW5ncywgY2hpbGRyZW4pLFxuICAgICAgICBsYXN0SXRlbXMgPSBbXSxcbiAgICAgICAgbGFzdENvbXBvbmVudHMgPSBbXTtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZUl0ZW1zKHZhbHVlKXtcbiAgICAgICAgdmFyIHRlbXBsYXRlID0gbGlzdC5fc2V0dGluZ3MudGVtcGxhdGU7XG4gICAgICAgIGlmKCF0ZW1wbGF0ZSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY3VycmVudEl0ZW1zID0gdmFsdWVzKHZhbHVlKTtcblxuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGFzdEl0ZW1zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBpdGVtID0gbGFzdEl0ZW1zW2ldLFxuICAgICAgICAgICAgICAgIGNvbXBvbmVudCA9IGxhc3RDb21wb25lbnRzW2ldLFxuICAgICAgICAgICAgICAgIGN1cnJlbnRJbmRleCA9IGN1cnJlbnRJdGVtcy5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgICAgICBjdXJyZW50SXRlbXMuc3BsaWNlKGN1cnJlbnRJbmRleCwxKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGxhc3RJdGVtcy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgbGFzdENvbXBvbmVudHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICAgIGktLTtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuZGVzdHJveSgpO1xuICAgICAgICAgICAgICAgIGxpc3QucmVtb3ZlKGNvbXBvbmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICAgICAgbmV3SXRlbXMgPSBbXSxcbiAgICAgICAgICAgIG5ld0NvbXBvbmVudHMgPSBbXTtcblxuICAgICAgICBlYWNoKHZhbHVlLCBmdW5jdGlvbihpdGVtLCBrZXkpe1xuICAgICAgICAgICAgdmFyIGNoaWxkLFxuICAgICAgICAgICAgICAgIGxhc3RLZXkgPSBrZXlGb3IobGFzdEl0ZW1zLCBpdGVtKTtcblxuICAgICAgICAgICAgaWYobGFzdEtleSA9PT0gZmFsc2Upe1xuICAgICAgICAgICAgICAgIGNoaWxkID0gdGVtcGxhdGUoaXRlbSwga2V5LCBsaXN0LnNjb3BlKCkpO1xuICAgICAgICAgICAgICAgIGNoaWxkLl90ZW1wbGF0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY2hpbGQpKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoaXRlbSAmJiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcpe1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGQuYXR0YWNoKGl0ZW0sIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkLmF0dGFjaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbTogaXRlbSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXk6IGtleVxuICAgICAgICAgICAgICAgICAgICAgICAgfSwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBuZXdJdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIG5ld0NvbXBvbmVudHMucHVzaChjaGlsZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBuZXdJdGVtcy5wdXNoKGxhc3RJdGVtc1tsYXN0S2V5XSk7XG4gICAgICAgICAgICAgICAgbGFzdEl0ZW1zLnNwbGljZShsYXN0S2V5LDEpXG5cbiAgICAgICAgICAgICAgICBjaGlsZCA9IGxhc3RDb21wb25lbnRzW2xhc3RLZXldO1xuICAgICAgICAgICAgICAgIGxhc3RDb21wb25lbnRzLnNwbGljZShsYXN0S2V5LDEpO1xuICAgICAgICAgICAgICAgIG5ld0NvbXBvbmVudHMucHVzaChjaGlsZCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxpc3QuaW5zZXJ0KGNoaWxkLCBpbmRleCk7XG5cbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxhc3RJdGVtcyA9IG5ld0l0ZW1zO1xuICAgICAgICBsYXN0Q29tcG9uZW50cyA9IG5ld0NvbXBvbmVudHM7XG4gICAgfVxuXG4gICAgbGlzdC5yZW5kZXIgPSBmdW5jdGlvbigpe1xuICAgICAgICB0aGlzLmVsZW1lbnQgPSBjcmVsKCdkaXYnKTtcbiAgICAgICAgdGhpcy5pdGVtcy5vbigndXBkYXRlJywgdXBkYXRlSXRlbXMpO1xuICAgICAgICB1cGRhdGVJdGVtcyh0aGlzLml0ZW1zKCkpO1xuICAgICAgICB0aGlzLmVtaXQoJ3JlbmRlcicpO1xuICAgIH07XG5cbiAgICBsaXN0Lml0ZW1zID0gZmFzdG4ucHJvcGVydHkoW10sIHVwZGF0ZUl0ZW1zKS5iaW5kaW5nKHNldHRpbmdzLml0ZW1zKTtcbiAgICBsaXN0Lm9uKCdhdHRhY2gnLCBsaXN0Lml0ZW1zLmF0dGFjaCk7XG5cbiAgICByZXR1cm4gbGlzdDtcbn07IiwiLy9Db3B5cmlnaHQgKEMpIDIwMTIgS29yeSBOdW5uXHJcblxyXG4vL1Blcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XHJcblxyXG4vL1RoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxyXG5cclxuLy9USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cclxuXHJcbi8qXHJcblxyXG4gICAgVGhpcyBjb2RlIGlzIG5vdCBmb3JtYXR0ZWQgZm9yIHJlYWRhYmlsaXR5LCBidXQgcmF0aGVyIHJ1bi1zcGVlZCBhbmQgdG8gYXNzaXN0IGNvbXBpbGVycy5cclxuXHJcbiAgICBIb3dldmVyLCB0aGUgY29kZSdzIGludGVudGlvbiBzaG91bGQgYmUgdHJhbnNwYXJlbnQuXHJcblxyXG4gICAgKioqIElFIFNVUFBPUlQgKioqXHJcblxyXG4gICAgSWYgeW91IHJlcXVpcmUgdGhpcyBsaWJyYXJ5IHRvIHdvcmsgaW4gSUU3LCBhZGQgdGhlIGZvbGxvd2luZyBhZnRlciBkZWNsYXJpbmcgY3JlbC5cclxuXHJcbiAgICB2YXIgdGVzdERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG4gICAgICAgIHRlc3RMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xhYmVsJyk7XHJcblxyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgJ2EnKTtcclxuICAgIHRlc3REaXZbJ2NsYXNzTmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2NsYXNzJ10gPSAnY2xhc3NOYW1lJzp1bmRlZmluZWQ7XHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnbmFtZScsJ2EnKTtcclxuICAgIHRlc3REaXZbJ25hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWyduYW1lJ10gPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XHJcbiAgICAgICAgZWxlbWVudC5pZCA9IHZhbHVlO1xyXG4gICAgfTp1bmRlZmluZWQ7XHJcblxyXG5cclxuICAgIHRlc3RMYWJlbC5zZXRBdHRyaWJ1dGUoJ2ZvcicsICdhJyk7XHJcbiAgICB0ZXN0TGFiZWxbJ2h0bWxGb3InXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydmb3InXSA9ICdodG1sRm9yJzp1bmRlZmluZWQ7XHJcblxyXG5cclxuXHJcbiovXHJcblxyXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmNyZWwgPSBmYWN0b3J5KCk7XHJcbiAgICB9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG4gICAgdmFyIGZuID0gJ2Z1bmN0aW9uJyxcclxuICAgICAgICBvYmogPSAnb2JqZWN0JyxcclxuICAgICAgICBpc1R5cGUgPSBmdW5jdGlvbihhLCB0eXBlKXtcclxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhID09PSB0eXBlO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNOb2RlID0gdHlwZW9mIE5vZGUgPT09IGZuID8gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgTm9kZTtcclxuICAgICAgICB9IDpcclxuICAgICAgICAvLyBpbiBJRSA8PSA4IE5vZGUgaXMgYW4gb2JqZWN0LCBvYnZpb3VzbHkuLlxyXG4gICAgICAgIGZ1bmN0aW9uKG9iamVjdCl7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3QsIG9iaikgJiZcclxuICAgICAgICAgICAgICAgICgnbm9kZVR5cGUnIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbC5pc05vZGUob2JqZWN0KSAmJiBvYmplY3Qubm9kZVR5cGUgPT09IDE7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0FycmF5ID0gZnVuY3Rpb24oYSl7XHJcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcHBlbmRDaGlsZCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGNoaWxkKSB7XHJcbiAgICAgICAgICBpZighaXNOb2RlKGNoaWxkKSl7XHJcbiAgICAgICAgICAgICAgY2hpbGQgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShjaGlsZCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBlbGVtZW50LmFwcGVuZENoaWxkKGNoaWxkKTtcclxuICAgICAgICB9O1xyXG5cclxuXHJcbiAgICBmdW5jdGlvbiBjcmVsKCl7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHMsIC8vTm90ZTogYXNzaWduZWQgdG8gYSB2YXJpYWJsZSB0byBhc3Npc3QgY29tcGlsZXJzLiBTYXZlcyBhYm91dCA0MCBieXRlcyBpbiBjbG9zdXJlIGNvbXBpbGVyLiBIYXMgbmVnbGlnYWJsZSBlZmZlY3Qgb24gcGVyZm9ybWFuY2UuXHJcbiAgICAgICAgICAgIGVsZW1lbnQgPSBhcmdzWzBdLFxyXG4gICAgICAgICAgICBjaGlsZCxcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBhcmdzWzFdLFxyXG4gICAgICAgICAgICBjaGlsZEluZGV4ID0gMixcclxuICAgICAgICAgICAgYXJndW1lbnRzTGVuZ3RoID0gYXJncy5sZW5ndGgsXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZU1hcCA9IGNyZWwuYXR0ck1hcDtcclxuXHJcbiAgICAgICAgZWxlbWVudCA9IGNyZWwuaXNFbGVtZW50KGVsZW1lbnQpID8gZWxlbWVudCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoZWxlbWVudCk7XHJcbiAgICAgICAgLy8gc2hvcnRjdXRcclxuICAgICAgICBpZihhcmd1bWVudHNMZW5ndGggPT09IDEpe1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCFpc1R5cGUoc2V0dGluZ3Msb2JqKSB8fCBjcmVsLmlzTm9kZShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudC50ZXh0Q29udGVudCAhPT0gdW5kZWZpbmVkKXtcclxuICAgICAgICAgICAgZWxlbWVudC50ZXh0Q29udGVudCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGZvcig7IGNoaWxkSW5kZXggPCBhcmd1bWVudHNMZW5ndGg7ICsrY2hpbGRJbmRleCl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYoY2hpbGQgPT0gbnVsbCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGNoaWxkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGRbaV0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcclxuICAgICAgICAgICAgaWYoIWF0dHJpYnV0ZU1hcFtrZXldKXtcclxuICAgICAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBjcmVsLmF0dHJNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHIsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVc2VkIGZvciBtYXBwaW5nIG9uZSBraW5kIG9mIGF0dHJpYnV0ZSB0byB0aGUgc3VwcG9ydGVkIHZlcnNpb24gb2YgdGhhdCBpbiBiYWQgYnJvd3NlcnMuXHJcbiAgICAvLyBTdHJpbmcgcmVmZXJlbmNlZCBzbyB0aGF0IGNvbXBpbGVycyBtYWludGFpbiB0aGUgcHJvcGVydHkgbmFtZS5cclxuICAgIGNyZWxbJ2F0dHJNYXAnXSA9IHt9O1xyXG5cclxuICAgIC8vIFN0cmluZyByZWZlcmVuY2VkIHNvIHRoYXQgY29tcGlsZXJzIG1haW50YWluIHRoZSBwcm9wZXJ0eSBuYW1lLlxyXG4gICAgY3JlbFtcImlzRWxlbWVudFwiXSA9IGlzRWxlbWVudDtcclxuICAgIGNyZWxbXCJpc05vZGVcIl0gPSBpc05vZGU7XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBmbGF0TWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpLFxuICAgIFdNID0gcmVxdWlyZSgnLi93ZWFrbWFwJyksXG4gICAgYXJyYXlQcm90byA9IFtdLFxuICAgIHJvb3RLZXkgPSAnJCc7XG5cbnZhciBhdHRhY2hlZEVudGllcyA9IG5ldyBXTSgpO1xuXG5mdW5jdGlvbiBlbWl0KG1vZGVsLCBrZXksIHZhbHVlLCBvcmlnaW5hbCl7XG4gICAgdmFyIHJlZmVyZW5jZXMgPSBhdHRhY2hlZEVudGllcy5nZXQobW9kZWwpO1xuXG4gICAgaWYoIXJlZmVyZW5jZXMgfHwgIXJlZmVyZW5jZXMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCByZWZlcmVuY2VzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVmZXJlbmNlc1tpXS5lbWl0KGtleSwgdmFsdWUsIG9yaWdpbmFsKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIEVudGkobW9kZWwpe1xuICAgIGlmKCFtb2RlbCB8fCAodHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kZWwgIT09ICdmdW5jdGlvbicpKXtcbiAgICAgICAgbW9kZWwgPSB7fTtcbiAgICB9XG4gICAgICAgIFxuICAgIHRoaXMuYXR0YWNoKG1vZGVsKTtcbn1cbkVudGkucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShFdmVudEVtaXR0ZXIucHJvdG90eXBlKTtcbkVudGkucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gRW50aTtcbkVudGkucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKG1vZGVsKXtcbiAgICB0aGlzLmRldGFjaCgpO1xuXG4gICAgdmFyIHJlZmVyZW5jZXMgPSBhdHRhY2hlZEVudGllcy5nZXQobW9kZWwpO1xuXG4gICAgaWYoIXJlZmVyZW5jZXMpe1xuICAgICAgICByZWZlcmVuY2VzID0gW107XG4gICAgICAgIGF0dGFjaGVkRW50aWVzLnNldChtb2RlbCwgcmVmZXJlbmNlcyk7XG4gICAgfVxuXG4gICAgcmVmZXJlbmNlcy5wdXNoKHRoaXMpO1xuXG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbDtcbn07XG5FbnRpLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpe1xuICAgIGlmKCF0aGlzLl9tb2RlbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHJlZmVyZW5jZXMgPSBhdHRhY2hlZEVudGllcy5nZXQodGhpcy5fbW9kZWwpO1xuXG4gICAgaWYoIXJlZmVyZW5jZXMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmVmZXJlbmNlcy5zcGxpY2UocmVmZXJlbmNlcy5pbmRleE9mKHRoaXMuX21vZGVsKSwxKTtcbn07XG5FbnRpLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xuICAgIGlmKGtleSA9PT0gJy4nKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuX21vZGVsO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fbW9kZWxba2V5XTtcbn07XG5cbkVudGkucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHZhciBvcmlnaW5hbCA9IHRoaXMuX21vZGVsW2tleV07XG5cbiAgICBpZih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnICYmIHZhbHVlID09PSBvcmlnaW5hbCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLl9tb2RlbFtrZXldID0gdmFsdWU7XG5cbiAgICBlbWl0KHRoaXMuX21vZGVsLCBrZXksIHZhbHVlLCBvcmlnaW5hbCk7XG4gICAgZW1pdCh0aGlzLl9tb2RlbCwgJy4nLCB0aGlzLl9tb2RlbCk7XG59O1xuXG5FbnRpLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgdmFyIHRhcmdldDtcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgMil7XG4gICAgICAgIHZhbHVlID0ga2V5O1xuICAgICAgICB0YXJnZXQgPSB0aGlzLl9tb2RlbDtcbiAgICB9ZWxzZXtcbiAgICAgICAgdGFyZ2V0ID0gdGhpcy5fbW9kZWxba2V5XTtcbiAgICB9XG5cbiAgICBpZighQXJyYXkuaXNBcnJheSh0YXJnZXQpKXtcbiAgICAgICAgdGhyb3cgXCJUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS5cIjtcbiAgICB9XG5cbiAgICB0YXJnZXQucHVzaCh2YWx1ZSk7XG5cbiAgICBlbWl0KHRhcmdldCwgdGFyZ2V0Lmxlbmd0aC0xLCB2YWx1ZSk7XG4gICAgZW1pdCh0YXJnZXQsICcuJywgdGFyZ2V0KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRW50aTtcbiIsInZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgb2JqZWN0S2V5cyA9IHJlcXVpcmUoJy4vbGliL2tleXMuanMnKTtcbnZhciBpc0FyZ3VtZW50cyA9IHJlcXVpcmUoJy4vbGliL2lzX2FyZ3VtZW50cy5qcycpO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgb3B0cykge1xuICBpZiAoIW9wdHMpIG9wdHMgPSB7fTtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9wdHMuc3RyaWN0ID8gYWN0dWFsID09PSBleHBlY3RlZCA6IGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCwgb3B0cyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyICh4KSB7XG4gIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHgubGVuZ3RoICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHguY29weSAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2YgeC5zbGljZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoeC5sZW5ndGggPiAwICYmIHR5cGVvZiB4WzBdICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYiwgb3B0cykge1xuICB2YXIgaSwga2V5O1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG9wdHMpO1xuICB9XG4gIGlmIChpc0J1ZmZlcihhKSkge1xuICAgIGlmICghaXNCdWZmZXIoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYVtpXSAhPT0gYltpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0cnkge1xuICAgIHZhciBrYSA9IG9iamVjdEtleXMoYSksXG4gICAgICAgIGtiID0gb2JqZWN0S2V5cyhiKTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBvcHRzKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuIiwidmFyIHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPSAoZnVuY3Rpb24oKXtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChhcmd1bWVudHMpXG59KSgpID09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzdXBwb3J0c0FyZ3VtZW50c0NsYXNzID8gc3VwcG9ydGVkIDogdW5zdXBwb3J0ZWQ7XG5cbmV4cG9ydHMuc3VwcG9ydGVkID0gc3VwcG9ydGVkO1xuZnVuY3Rpb24gc3VwcG9ydGVkKG9iamVjdCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG59O1xuXG5leHBvcnRzLnVuc3VwcG9ydGVkID0gdW5zdXBwb3J0ZWQ7XG5mdW5jdGlvbiB1bnN1cHBvcnRlZChvYmplY3Qpe1xuICByZXR1cm4gb2JqZWN0ICYmXG4gICAgdHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0JyAmJlxuICAgIHR5cGVvZiBvYmplY3QubGVuZ3RoID09ICdudW1iZXInICYmXG4gICAgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpICYmXG4gICAgIU9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChvYmplY3QsICdjYWxsZWUnKSB8fFxuICAgIGZhbHNlO1xufTtcbiIsImV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHR5cGVvZiBPYmplY3Qua2V5cyA9PT0gJ2Z1bmN0aW9uJ1xuICA/IE9iamVjdC5rZXlzIDogc2hpbTtcblxuZXhwb3J0cy5zaGltID0gc2hpbTtcbmZ1bmN0aW9uIHNoaW0gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgcmV0dXJuIGtleXM7XG59XG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsImZ1bmN0aW9uIHZhbGlkYXRlS2V5KGtleSl7XG4gICAgaWYoIWtleSB8fCAhKHR5cGVvZiBrZXkgPT09ICdvYmplY3QnIHx8IHR5cGVvZiBrZXkgPT09ICdmdW5jdGlvbicpKXtcbiAgICAgICAgdGhyb3cga2V5ICsgXCIgaXMgbm90IGEgdmFsaWQgV2Vha01hcCBrZXkuXCI7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBMZWFrTWFwKCl7XG4gICAgdGhpcy5jbGVhcigpO1xufVxuTGVha01hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpe1xuICAgIHRoaXMuX2tleXMgPSBbXTtcbiAgICB0aGlzLl92YWx1ZXMgPSBbXTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbihrZXkpe1xuICAgIHZhbGlkYXRlS2V5KGtleSk7XG4gICAgdmFyIGtleUluZGV4ID0gdGhpcy5fa2V5cy5pbmRleE9mKGtleSk7XG4gICAgaWYoa2V5SW5kZXg+PTApe1xuICAgICAgICB0aGlzLl9rZXlzLnNwbGljZShrZXlJbmRleCwgMSk7XG4gICAgICAgIHRoaXMuX3ZhbHVlcy5zcGxpY2Uoa2V5SW5kZXgsIDEpO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59O1xuTGVha01hcC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuICAgIHJldHVybiB0aGlzLl92YWx1ZXNbdGhpcy5fa2V5cy5pbmRleE9mKGtleSldO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLmhhcyA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFsaWRhdGVLZXkoa2V5KTtcbiAgICByZXR1cm4gISF+dGhpcy5fa2V5cy5pbmRleE9mKGtleSk7XG59O1xuTGVha01hcC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgdmFsaWRhdGVLZXkoa2V5KTtcblxuICAgIC8vIEZhdm9yaXRlIHBpZWNlIG9mIGtvZWQgZXZvci5cbiAgICAvLyBJRSBkZXZzIHdvdWxkIGJlIHByb3dkZVxuICAgIHZhciBrZXlJbmRleCA9ICh+dGhpcy5fa2V5cy5pbmRleE9mKGtleSkgfHwgKHRoaXMuX2tleXMucHVzaChrZXkpLCB0aGlzLl9rZXlzLmxlbmd0aCkpIC0gMTtcblxuICAgIHRoaXMuX3ZhbHVlc1trZXlJbmRleF0gPSB2YWx1ZTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5MZWFrTWFwLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuICdbb2JqZWN0IFdlYWtNYXBdJztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTGVha01hcDsiLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTEgR29vZ2xlIEluYy5cbi8vXG4vLyBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuLy8geW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuLy8gWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4vL1xuLy8gaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4vL1xuLy8gVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuLy8gZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuLy8gV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4vLyBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4vLyBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cblxuLyoqXG4gKiBAZmlsZW92ZXJ2aWV3IEluc3RhbGwgYSBsZWFreSBXZWFrTWFwIGVtdWxhdGlvbiBvbiBwbGF0Zm9ybXMgdGhhdFxuICogZG9uJ3QgcHJvdmlkZSBhIGJ1aWx0LWluIG9uZS5cbiAqXG4gKiA8cD5Bc3N1bWVzIHRoYXQgYW4gRVM1IHBsYXRmb3JtIHdoZXJlLCBpZiB7QGNvZGUgV2Vha01hcH0gaXNcbiAqIGFscmVhZHkgcHJlc2VudCwgdGhlbiBpdCBjb25mb3JtcyB0byB0aGUgYW50aWNpcGF0ZWQgRVM2XG4gKiBzcGVjaWZpY2F0aW9uLiBUbyBydW4gdGhpcyBmaWxlIG9uIGFuIEVTNSBvciBhbG1vc3QgRVM1XG4gKiBpbXBsZW1lbnRhdGlvbiB3aGVyZSB0aGUge0Bjb2RlIFdlYWtNYXB9IHNwZWNpZmljYXRpb24gZG9lcyBub3RcbiAqIHF1aXRlIGNvbmZvcm0sIHJ1biA8Y29kZT5yZXBhaXJFUzUuanM8L2NvZGU+IGZpcnN0LlxuICpcbiAqIDxwPkV2ZW4gdGhvdWdoIFdlYWtNYXBNb2R1bGUgaXMgbm90IGdsb2JhbCwgdGhlIGxpbnRlciB0aGlua3MgaXRcbiAqIGlzLCB3aGljaCBpcyB3aHkgaXQgaXMgaW4gdGhlIG92ZXJyaWRlcyBsaXN0IGJlbG93LlxuICpcbiAqIDxwPk5PVEU6IEJlZm9yZSB1c2luZyB0aGlzIFdlYWtNYXAgZW11bGF0aW9uIGluIGEgbm9uLVNFU1xuICogZW52aXJvbm1lbnQsIHNlZSB0aGUgbm90ZSBiZWxvdyBhYm91dCBoaWRkZW5SZWNvcmQuXG4gKlxuICogQGF1dGhvciBNYXJrIFMuIE1pbGxlclxuICogQHJlcXVpcmVzIGNyeXB0bywgQXJyYXlCdWZmZXIsIFVpbnQ4QXJyYXksIG5hdmlnYXRvciwgY29uc29sZVxuICogQG92ZXJyaWRlcyBXZWFrTWFwLCBzZXMsIFByb3h5XG4gKiBAb3ZlcnJpZGVzIFdlYWtNYXBNb2R1bGVcbiAqL1xuXG4vKipcbiAqIFRoaXMge0Bjb2RlIFdlYWtNYXB9IGVtdWxhdGlvbiBpcyBvYnNlcnZhYmx5IGVxdWl2YWxlbnQgdG8gdGhlXG4gKiBFUy1IYXJtb255IFdlYWtNYXAsIGJ1dCB3aXRoIGxlYWtpZXIgZ2FyYmFnZSBjb2xsZWN0aW9uIHByb3BlcnRpZXMuXG4gKlxuICogPHA+QXMgd2l0aCB0cnVlIFdlYWtNYXBzLCBpbiB0aGlzIGVtdWxhdGlvbiwgYSBrZXkgZG9lcyBub3RcbiAqIHJldGFpbiBtYXBzIGluZGV4ZWQgYnkgdGhhdCBrZXkgYW5kIChjcnVjaWFsbHkpIGEgbWFwIGRvZXMgbm90XG4gKiByZXRhaW4gdGhlIGtleXMgaXQgaW5kZXhlcy4gQSBtYXAgYnkgaXRzZWxmIGFsc28gZG9lcyBub3QgcmV0YWluXG4gKiB0aGUgdmFsdWVzIGFzc29jaWF0ZWQgd2l0aCB0aGF0IG1hcC5cbiAqXG4gKiA8cD5Ib3dldmVyLCB0aGUgdmFsdWVzIGFzc29jaWF0ZWQgd2l0aCBhIGtleSBpbiBzb21lIG1hcCBhcmVcbiAqIHJldGFpbmVkIHNvIGxvbmcgYXMgdGhhdCBrZXkgaXMgcmV0YWluZWQgYW5kIHRob3NlIGFzc29jaWF0aW9ucyBhcmVcbiAqIG5vdCBvdmVycmlkZGVuLiBGb3IgZXhhbXBsZSwgd2hlbiB1c2VkIHRvIHN1cHBvcnQgbWVtYnJhbmVzLCBhbGxcbiAqIHZhbHVlcyBleHBvcnRlZCBmcm9tIGEgZ2l2ZW4gbWVtYnJhbmUgd2lsbCBsaXZlIGZvciB0aGUgbGlmZXRpbWVcbiAqIHRoZXkgd291bGQgaGF2ZSBoYWQgaW4gdGhlIGFic2VuY2Ugb2YgYW4gaW50ZXJwb3NlZCBtZW1icmFuZS4gRXZlblxuICogd2hlbiB0aGUgbWVtYnJhbmUgaXMgcmV2b2tlZCwgYWxsIG9iamVjdHMgdGhhdCB3b3VsZCBoYXZlIGJlZW5cbiAqIHJlYWNoYWJsZSBpbiB0aGUgYWJzZW5jZSBvZiByZXZvY2F0aW9uIHdpbGwgc3RpbGwgYmUgcmVhY2hhYmxlLCBhc1xuICogZmFyIGFzIHRoZSBHQyBjYW4gdGVsbCwgZXZlbiB0aG91Z2ggdGhleSB3aWxsIG5vIGxvbmdlciBiZSByZWxldmFudFxuICogdG8gb25nb2luZyBjb21wdXRhdGlvbi5cbiAqXG4gKiA8cD5UaGUgQVBJIGltcGxlbWVudGVkIGhlcmUgaXMgYXBwcm94aW1hdGVseSB0aGUgQVBJIGFzIGltcGxlbWVudGVkXG4gKiBpbiBGRjYuMGExIGFuZCBhZ3JlZWQgdG8gYnkgTWFya00sIEFuZHJlYXMgR2FsLCBhbmQgRGF2ZSBIZXJtYW4sXG4gKiByYXRoZXIgdGhhbiB0aGUgb2ZmaWFsbHkgYXBwcm92ZWQgcHJvcG9zYWwgcGFnZS4gVE9ETyhlcmlnaHRzKTpcbiAqIHVwZ3JhZGUgdGhlIGVjbWFzY3JpcHQgV2Vha01hcCBwcm9wb3NhbCBwYWdlIHRvIGV4cGxhaW4gdGhpcyBBUElcbiAqIGNoYW5nZSBhbmQgcHJlc2VudCB0byBFY21hU2NyaXB0IGNvbW1pdHRlZSBmb3IgdGhlaXIgYXBwcm92YWwuXG4gKlxuICogPHA+VGhlIGZpcnN0IGRpZmZlcmVuY2UgYmV0d2VlbiB0aGUgZW11bGF0aW9uIGhlcmUgYW5kIHRoYXQgaW5cbiAqIEZGNi4wYTEgaXMgdGhlIHByZXNlbmNlIG9mIG5vbiBlbnVtZXJhYmxlIHtAY29kZSBnZXRfX18sIGhhc19fXyxcbiAqIHNldF9fXywgYW5kIGRlbGV0ZV9fX30gbWV0aG9kcyBvbiBXZWFrTWFwIGluc3RhbmNlcyB0byByZXByZXNlbnRcbiAqIHdoYXQgd291bGQgYmUgdGhlIGhpZGRlbiBpbnRlcm5hbCBwcm9wZXJ0aWVzIG9mIGEgcHJpbWl0aXZlXG4gKiBpbXBsZW1lbnRhdGlvbi4gV2hlcmVhcyB0aGUgRkY2LjBhMSBXZWFrTWFwLnByb3RvdHlwZSBtZXRob2RzXG4gKiByZXF1aXJlIHRoZWlyIHtAY29kZSB0aGlzfSB0byBiZSBhIGdlbnVpbmUgV2Vha01hcCBpbnN0YW5jZSAoaS5lLixcbiAqIGFuIG9iamVjdCBvZiB7QGNvZGUgW1tDbGFzc11dfSBcIldlYWtNYXB9KSwgc2luY2UgdGhlcmUgaXMgbm90aGluZ1xuICogdW5mb3JnZWFibGUgYWJvdXQgdGhlIHBzZXVkby1pbnRlcm5hbCBtZXRob2QgbmFtZXMgdXNlZCBoZXJlLFxuICogbm90aGluZyBwcmV2ZW50cyB0aGVzZSBlbXVsYXRlZCBwcm90b3R5cGUgbWV0aG9kcyBmcm9tIGJlaW5nXG4gKiBhcHBsaWVkIHRvIG5vbi1XZWFrTWFwcyB3aXRoIHBzZXVkby1pbnRlcm5hbCBtZXRob2RzIG9mIHRoZSBzYW1lXG4gKiBuYW1lcy5cbiAqXG4gKiA8cD5Bbm90aGVyIGRpZmZlcmVuY2UgaXMgdGhhdCBvdXIgZW11bGF0ZWQge0Bjb2RlXG4gKiBXZWFrTWFwLnByb3RvdHlwZX0gaXMgbm90IGl0c2VsZiBhIFdlYWtNYXAuIEEgcHJvYmxlbSB3aXRoIHRoZVxuICogY3VycmVudCBGRjYuMGExIEFQSSBpcyB0aGF0IFdlYWtNYXAucHJvdG90eXBlIGlzIGl0c2VsZiBhIFdlYWtNYXBcbiAqIHByb3ZpZGluZyBhbWJpZW50IG11dGFiaWxpdHkgYW5kIGFuIGFtYmllbnQgY29tbXVuaWNhdGlvbnNcbiAqIGNoYW5uZWwuIFRodXMsIGlmIGEgV2Vha01hcCBpcyBhbHJlYWR5IHByZXNlbnQgYW5kIGhhcyB0aGlzXG4gKiBwcm9ibGVtLCByZXBhaXJFUzUuanMgd3JhcHMgaXQgaW4gYSBzYWZlIHdyYXBwcGVyIGluIG9yZGVyIHRvXG4gKiBwcmV2ZW50IGFjY2VzcyB0byB0aGlzIGNoYW5uZWwuIChTZWVcbiAqIFBBVENIX01VVEFCTEVfRlJPWkVOX1dFQUtNQVBfUFJPVE8gaW4gcmVwYWlyRVM1LmpzKS5cbiAqL1xuXG4vKipcbiAqIElmIHRoaXMgaXMgYSBmdWxsIDxhIGhyZWY9XG4gKiBcImh0dHA6Ly9jb2RlLmdvb2dsZS5jb20vcC9lcy1sYWIvd2lraS9TZWN1cmVhYmxlRVM1XCJcbiAqID5zZWN1cmVhYmxlIEVTNTwvYT4gcGxhdGZvcm0gYW5kIHRoZSBFUy1IYXJtb255IHtAY29kZSBXZWFrTWFwfSBpc1xuICogYWJzZW50LCBpbnN0YWxsIGFuIGFwcHJveGltYXRlIGVtdWxhdGlvbi5cbiAqXG4gKiA8cD5JZiBXZWFrTWFwIGlzIHByZXNlbnQgYnV0IGNhbm5vdCBzdG9yZSBzb21lIG9iamVjdHMsIHVzZSBvdXIgYXBwcm94aW1hdGVcbiAqIGVtdWxhdGlvbiBhcyBhIHdyYXBwZXIuXG4gKlxuICogPHA+SWYgdGhpcyBpcyBhbG1vc3QgYSBzZWN1cmVhYmxlIEVTNSBwbGF0Zm9ybSwgdGhlbiBXZWFrTWFwLmpzXG4gKiBzaG91bGQgYmUgcnVuIGFmdGVyIHJlcGFpckVTNS5qcy5cbiAqXG4gKiA8cD5TZWUge0Bjb2RlIFdlYWtNYXB9IGZvciBkb2N1bWVudGF0aW9uIG9mIHRoZSBnYXJiYWdlIGNvbGxlY3Rpb25cbiAqIHByb3BlcnRpZXMgb2YgdGhpcyBXZWFrTWFwIGVtdWxhdGlvbi5cbiAqL1xuKGZ1bmN0aW9uIFdlYWtNYXBNb2R1bGUoKSB7XG4gIFwidXNlIHN0cmljdFwiO1xuXG4gIGlmICh0eXBlb2Ygc2VzICE9PSAndW5kZWZpbmVkJyAmJiBzZXMub2sgJiYgIXNlcy5vaygpKSB7XG4gICAgLy8gYWxyZWFkeSB0b28gYnJva2VuLCBzbyBnaXZlIHVwXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLyoqXG4gICAqIEluIHNvbWUgY2FzZXMgKGN1cnJlbnQgRmlyZWZveCksIHdlIG11c3QgbWFrZSBhIGNob2ljZSBiZXR3ZWVlbiBhXG4gICAqIFdlYWtNYXAgd2hpY2ggaXMgY2FwYWJsZSBvZiB1c2luZyBhbGwgdmFyaWV0aWVzIG9mIGhvc3Qgb2JqZWN0cyBhc1xuICAgKiBrZXlzIGFuZCBvbmUgd2hpY2ggaXMgY2FwYWJsZSBvZiBzYWZlbHkgdXNpbmcgcHJveGllcyBhcyBrZXlzLiBTZWVcbiAgICogY29tbWVudHMgYmVsb3cgYWJvdXQgSG9zdFdlYWtNYXAgYW5kIERvdWJsZVdlYWtNYXAgZm9yIGRldGFpbHMuXG4gICAqXG4gICAqIFRoaXMgZnVuY3Rpb24gKHdoaWNoIGlzIGEgZ2xvYmFsLCBub3QgZXhwb3NlZCB0byBndWVzdHMpIG1hcmtzIGFcbiAgICogV2Vha01hcCBhcyBwZXJtaXR0ZWQgdG8gZG8gd2hhdCBpcyBuZWNlc3NhcnkgdG8gaW5kZXggYWxsIGhvc3RcbiAgICogb2JqZWN0cywgYXQgdGhlIGNvc3Qgb2YgbWFraW5nIGl0IHVuc2FmZSBmb3IgcHJveGllcy5cbiAgICpcbiAgICogRG8gbm90IGFwcGx5IHRoaXMgZnVuY3Rpb24gdG8gYW55dGhpbmcgd2hpY2ggaXMgbm90IGEgZ2VudWluZVxuICAgKiBmcmVzaCBXZWFrTWFwLlxuICAgKi9cbiAgZnVuY3Rpb24gd2Vha01hcFBlcm1pdEhvc3RPYmplY3RzKG1hcCkge1xuICAgIC8vIGlkZW50aXR5IG9mIGZ1bmN0aW9uIHVzZWQgYXMgYSBzZWNyZXQgLS0gZ29vZCBlbm91Z2ggYW5kIGNoZWFwXG4gICAgaWYgKG1hcC5wZXJtaXRIb3N0T2JqZWN0c19fXykge1xuICAgICAgbWFwLnBlcm1pdEhvc3RPYmplY3RzX19fKHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cyk7XG4gICAgfVxuICB9XG4gIGlmICh0eXBlb2Ygc2VzICE9PSAndW5kZWZpbmVkJykge1xuICAgIHNlcy53ZWFrTWFwUGVybWl0SG9zdE9iamVjdHMgPSB3ZWFrTWFwUGVybWl0SG9zdE9iamVjdHM7XG4gIH1cblxuICAvLyBJRSAxMSBoYXMgbm8gUHJveHkgYnV0IGhhcyBhIGJyb2tlbiBXZWFrTWFwIHN1Y2ggdGhhdCB3ZSBuZWVkIHRvIHBhdGNoXG4gIC8vIGl0IHVzaW5nIERvdWJsZVdlYWtNYXA7IHRoaXMgZmxhZyB0ZWxscyBEb3VibGVXZWFrTWFwIHNvLlxuICB2YXIgZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSA9IGZhbHNlO1xuXG4gIC8vIENoZWNrIGlmIHRoZXJlIGlzIGFscmVhZHkgYSBnb29kLWVub3VnaCBXZWFrTWFwIGltcGxlbWVudGF0aW9uLCBhbmQgaWYgc29cbiAgLy8gZXhpdCB3aXRob3V0IHJlcGxhY2luZyBpdC5cbiAgaWYgKHR5cGVvZiBXZWFrTWFwID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdmFyIEhvc3RXZWFrTWFwID0gV2Vha01hcDtcbiAgICAvLyBUaGVyZSBpcyBhIFdlYWtNYXAgLS0gaXMgaXQgZ29vZCBlbm91Z2g/XG4gICAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmXG4gICAgICAgIC9GaXJlZm94Ly50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpKSB7XG4gICAgICAvLyBXZSdyZSBub3cgKmFzc3VtaW5nIG5vdCosIGJlY2F1c2UgYXMgb2YgdGhpcyB3cml0aW5nICgyMDEzLTA1LTA2KVxuICAgICAgLy8gRmlyZWZveCdzIFdlYWtNYXBzIGhhdmUgYSBtaXNjZWxsYW55IG9mIG9iamVjdHMgdGhleSB3b24ndCBhY2NlcHQsIGFuZFxuICAgICAgLy8gd2UgZG9uJ3Qgd2FudCB0byBtYWtlIGFuIGV4aGF1c3RpdmUgbGlzdCwgYW5kIHRlc3RpbmcgZm9yIGp1c3Qgb25lXG4gICAgICAvLyB3aWxsIGJlIGEgcHJvYmxlbSBpZiB0aGF0IG9uZSBpcyBmaXhlZCBhbG9uZSAoYXMgdGhleSBkaWQgZm9yIEV2ZW50KS5cblxuICAgICAgLy8gSWYgdGhlcmUgaXMgYSBwbGF0Zm9ybSB0aGF0IHdlICpjYW4qIHJlbGlhYmx5IHRlc3Qgb24sIGhlcmUncyBob3cgdG9cbiAgICAgIC8vIGRvIGl0OlxuICAgICAgLy8gIHZhciBwcm9ibGVtYXRpYyA9IC4uLiA7XG4gICAgICAvLyAgdmFyIHRlc3RIb3N0TWFwID0gbmV3IEhvc3RXZWFrTWFwKCk7XG4gICAgICAvLyAgdHJ5IHtcbiAgICAgIC8vICAgIHRlc3RIb3N0TWFwLnNldChwcm9ibGVtYXRpYywgMSk7ICAvLyBGaXJlZm94IDIwIHdpbGwgdGhyb3cgaGVyZVxuICAgICAgLy8gICAgaWYgKHRlc3RIb3N0TWFwLmdldChwcm9ibGVtYXRpYykgPT09IDEpIHtcbiAgICAgIC8vICAgICAgcmV0dXJuO1xuICAgICAgLy8gICAgfVxuICAgICAgLy8gIH0gY2F0Y2ggKGUpIHt9XG5cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSUUgMTEgYnVnOiBXZWFrTWFwcyBzaWxlbnRseSBmYWlsIHRvIHN0b3JlIGZyb3plbiBvYmplY3RzLlxuICAgICAgdmFyIHRlc3RNYXAgPSBuZXcgSG9zdFdlYWtNYXAoKTtcbiAgICAgIHZhciB0ZXN0T2JqZWN0ID0gT2JqZWN0LmZyZWV6ZSh7fSk7XG4gICAgICB0ZXN0TWFwLnNldCh0ZXN0T2JqZWN0LCAxKTtcbiAgICAgIGlmICh0ZXN0TWFwLmdldCh0ZXN0T2JqZWN0KSAhPT0gMSkge1xuICAgICAgICBkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlID0gdHJ1ZTtcbiAgICAgICAgLy8gRmFsbCB0aHJvdWdoIHRvIGluc3RhbGxpbmcgb3VyIFdlYWtNYXAuXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IFdlYWtNYXA7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB2YXIgaG9wID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbiAgdmFyIGdvcG4gPSBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcztcbiAgdmFyIGRlZlByb3AgPSBPYmplY3QuZGVmaW5lUHJvcGVydHk7XG4gIHZhciBpc0V4dGVuc2libGUgPSBPYmplY3QuaXNFeHRlbnNpYmxlO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBkZXBlbmRzIG9uIEhJRERFTl9OQU1FIGJlaW5nIGJvdGggPGk+dW5ndWVzc2FibGU8L2k+IGFuZFxuICAgKiA8aT51bmRpc2NvdmVyYWJsZTwvaT4gYnkgdW50cnVzdGVkIGNvZGUuXG4gICAqXG4gICAqIDxwPkdpdmVuIHRoZSBrbm93biB3ZWFrbmVzc2VzIG9mIE1hdGgucmFuZG9tKCkgb24gZXhpc3RpbmdcbiAgICogYnJvd3NlcnMsIGl0IGRvZXMgbm90IGdlbmVyYXRlIHVuZ3Vlc3NhYmlsaXR5IHdlIGNhbiBiZSBjb25maWRlbnRcbiAgICogb2YuXG4gICAqXG4gICAqIDxwPkl0IGlzIHRoZSBtb25rZXkgcGF0Y2hpbmcgbG9naWMgaW4gdGhpcyBmaWxlIHRoYXQgaXMgaW50ZW5kZWRcbiAgICogdG8gZW5zdXJlIHVuZGlzY292ZXJhYmlsaXR5LiBUaGUgYmFzaWMgaWRlYSBpcyB0aGF0IHRoZXJlIGFyZVxuICAgKiB0aHJlZSBmdW5kYW1lbnRhbCBtZWFucyBvZiBkaXNjb3ZlcmluZyBwcm9wZXJ0aWVzIG9mIGFuIG9iamVjdDpcbiAgICogVGhlIGZvci9pbiBsb29wLCBPYmplY3Qua2V5cygpLCBhbmQgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoKSxcbiAgICogYXMgd2VsbCBhcyBzb21lIHByb3Bvc2VkIEVTNiBleHRlbnNpb25zIHRoYXQgYXBwZWFyIG9uIG91clxuICAgKiB3aGl0ZWxpc3QuIFRoZSBmaXJzdCB0d28gb25seSBkaXNjb3ZlciBlbnVtZXJhYmxlIHByb3BlcnRpZXMsIGFuZFxuICAgKiB3ZSBvbmx5IHVzZSBISURERU5fTkFNRSB0byBuYW1lIGEgbm9uLWVudW1lcmFibGUgcHJvcGVydHksIHNvIHRoZVxuICAgKiBvbmx5IHJlbWFpbmluZyB0aHJlYXQgc2hvdWxkIGJlIGdldE93blByb3BlcnR5TmFtZXMgYW5kIHNvbWVcbiAgICogcHJvcG9zZWQgRVM2IGV4dGVuc2lvbnMgdGhhdCBhcHBlYXIgb24gb3VyIHdoaXRlbGlzdC4gV2UgbW9ua2V5XG4gICAqIHBhdGNoIHRoZW0gdG8gcmVtb3ZlIEhJRERFTl9OQU1FIGZyb20gdGhlIGxpc3Qgb2YgcHJvcGVydGllcyB0aGV5XG4gICAqIHJldHVybnMuXG4gICAqXG4gICAqIDxwPlRPRE8oZXJpZ2h0cyk6IE9uIGEgcGxhdGZvcm0gd2l0aCBidWlsdC1pbiBQcm94aWVzLCBwcm94aWVzXG4gICAqIGNvdWxkIGJlIHVzZWQgdG8gdHJhcCBhbmQgdGhlcmVieSBkaXNjb3ZlciB0aGUgSElEREVOX05BTUUsIHNvIHdlXG4gICAqIG5lZWQgdG8gbW9ua2V5IHBhdGNoIFByb3h5LmNyZWF0ZSwgUHJveHkuY3JlYXRlRnVuY3Rpb24sIGV0YywgaW5cbiAgICogb3JkZXIgdG8gd3JhcCB0aGUgcHJvdmlkZWQgaGFuZGxlciB3aXRoIHRoZSByZWFsIGhhbmRsZXIgd2hpY2hcbiAgICogZmlsdGVycyBvdXQgYWxsIHRyYXBzIHVzaW5nIEhJRERFTl9OQU1FLlxuICAgKlxuICAgKiA8cD5UT0RPKGVyaWdodHMpOiBSZXZpc2l0IE1pa2UgU3RheSdzIHN1Z2dlc3Rpb24gdGhhdCB3ZSB1c2UgYW5cbiAgICogZW5jYXBzdWxhdGVkIGZ1bmN0aW9uIGF0IGEgbm90LW5lY2Vzc2FyaWx5LXNlY3JldCBuYW1lLCB3aGljaFxuICAgKiB1c2VzIHRoZSBTdGllZ2xlciBzaGFyZWQtc3RhdGUgcmlnaHRzIGFtcGxpZmljYXRpb24gcGF0dGVybiB0b1xuICAgKiByZXZlYWwgdGhlIGFzc29jaWF0ZWQgdmFsdWUgb25seSB0byB0aGUgV2Vha01hcCBpbiB3aGljaCB0aGlzIGtleVxuICAgKiBpcyBhc3NvY2lhdGVkIHdpdGggdGhhdCB2YWx1ZS4gU2luY2Ugb25seSB0aGUga2V5IHJldGFpbnMgdGhlXG4gICAqIGZ1bmN0aW9uLCB0aGUgZnVuY3Rpb24gY2FuIGFsc28gcmVtZW1iZXIgdGhlIGtleSB3aXRob3V0IGNhdXNpbmdcbiAgICogbGVha2FnZSBvZiB0aGUga2V5LCBzbyB0aGlzIGRvZXNuJ3QgdmlvbGF0ZSBvdXIgZ2VuZXJhbCBnY1xuICAgKiBnb2Fscy4gSW4gYWRkaXRpb24sIGJlY2F1c2UgdGhlIG5hbWUgbmVlZCBub3QgYmUgYSBndWFyZGVkXG4gICAqIHNlY3JldCwgd2UgY291bGQgZWZmaWNpZW50bHkgaGFuZGxlIGNyb3NzLWZyYW1lIGZyb3plbiBrZXlzLlxuICAgKi9cbiAgdmFyIEhJRERFTl9OQU1FX1BSRUZJWCA9ICd3ZWFrbWFwOic7XG4gIHZhciBISURERU5fTkFNRSA9IEhJRERFTl9OQU1FX1BSRUZJWCArICdpZGVudDonICsgTWF0aC5yYW5kb20oKSArICdfX18nO1xuXG4gIGlmICh0eXBlb2YgY3J5cHRvICE9PSAndW5kZWZpbmVkJyAmJlxuICAgICAgdHlwZW9mIGNyeXB0by5nZXRSYW5kb21WYWx1ZXMgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIHR5cGVvZiBBcnJheUJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJyAmJlxuICAgICAgdHlwZW9mIFVpbnQ4QXJyYXkgPT09ICdmdW5jdGlvbicpIHtcbiAgICB2YXIgYWIgPSBuZXcgQXJyYXlCdWZmZXIoMjUpO1xuICAgIHZhciB1OHMgPSBuZXcgVWludDhBcnJheShhYik7XG4gICAgY3J5cHRvLmdldFJhbmRvbVZhbHVlcyh1OHMpO1xuICAgIEhJRERFTl9OQU1FID0gSElEREVOX05BTUVfUFJFRklYICsgJ3JhbmQ6JyArXG4gICAgICBBcnJheS5wcm90b3R5cGUubWFwLmNhbGwodThzLCBmdW5jdGlvbih1OCkge1xuICAgICAgICByZXR1cm4gKHU4ICUgMzYpLnRvU3RyaW5nKDM2KTtcbiAgICAgIH0pLmpvaW4oJycpICsgJ19fXyc7XG4gIH1cblxuICBmdW5jdGlvbiBpc05vdEhpZGRlbk5hbWUobmFtZSkge1xuICAgIHJldHVybiAhKFxuICAgICAgICBuYW1lLnN1YnN0cigwLCBISURERU5fTkFNRV9QUkVGSVgubGVuZ3RoKSA9PSBISURERU5fTkFNRV9QUkVGSVggJiZcbiAgICAgICAgbmFtZS5zdWJzdHIobmFtZS5sZW5ndGggLSAzKSA9PT0gJ19fXycpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1vbmtleSBwYXRjaCBnZXRPd25Qcm9wZXJ0eU5hbWVzIHRvIGF2b2lkIHJldmVhbGluZyB0aGVcbiAgICogSElEREVOX05BTUUuXG4gICAqXG4gICAqIDxwPlRoZSBFUzUuMSBzcGVjIHJlcXVpcmVzIGVhY2ggbmFtZSB0byBhcHBlYXIgb25seSBvbmNlLCBidXQgYXNcbiAgICogb2YgdGhpcyB3cml0aW5nLCB0aGlzIHJlcXVpcmVtZW50IGlzIGNvbnRyb3ZlcnNpYWwgZm9yIEVTNiwgc28gd2VcbiAgICogbWFkZSB0aGlzIGNvZGUgcm9idXN0IGFnYWluc3QgdGhpcyBjYXNlLiBJZiB0aGUgcmVzdWx0aW5nIGV4dHJhXG4gICAqIHNlYXJjaCB0dXJucyBvdXQgdG8gYmUgZXhwZW5zaXZlLCB3ZSBjYW4gcHJvYmFibHkgcmVsYXggdGhpcyBvbmNlXG4gICAqIEVTNiBpcyBhZGVxdWF0ZWx5IHN1cHBvcnRlZCBvbiBhbGwgbWFqb3IgYnJvd3NlcnMsIGlmZiBubyBicm93c2VyXG4gICAqIHZlcnNpb25zIHdlIHN1cHBvcnQgYXQgdGhhdCB0aW1lIGhhdmUgcmVsYXhlZCB0aGlzIGNvbnN0cmFpbnRcbiAgICogd2l0aG91dCBwcm92aWRpbmcgYnVpbHQtaW4gRVM2IFdlYWtNYXBzLlxuICAgKi9cbiAgZGVmUHJvcChPYmplY3QsICdnZXRPd25Qcm9wZXJ0eU5hbWVzJywge1xuICAgIHZhbHVlOiBmdW5jdGlvbiBmYWtlR2V0T3duUHJvcGVydHlOYW1lcyhvYmopIHtcbiAgICAgIHJldHVybiBnb3BuKG9iaikuZmlsdGVyKGlzTm90SGlkZGVuTmFtZSk7XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogZ2V0UHJvcGVydHlOYW1lcyBpcyBub3QgaW4gRVM1IGJ1dCBpdCBpcyBwcm9wb3NlZCBmb3IgRVM2IGFuZFxuICAgKiBkb2VzIGFwcGVhciBpbiBvdXIgd2hpdGVsaXN0LCBzbyB3ZSBuZWVkIHRvIGNsZWFuIGl0IHRvby5cbiAgICovXG4gIGlmICgnZ2V0UHJvcGVydHlOYW1lcycgaW4gT2JqZWN0KSB7XG4gICAgdmFyIG9yaWdpbmFsR2V0UHJvcGVydHlOYW1lcyA9IE9iamVjdC5nZXRQcm9wZXJ0eU5hbWVzO1xuICAgIGRlZlByb3AoT2JqZWN0LCAnZ2V0UHJvcGVydHlOYW1lcycsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBmYWtlR2V0UHJvcGVydHlOYW1lcyhvYmopIHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsR2V0UHJvcGVydHlOYW1lcyhvYmopLmZpbHRlcihpc05vdEhpZGRlbk5hbWUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIDxwPlRvIHRyZWF0IG9iamVjdHMgYXMgaWRlbnRpdHkta2V5cyB3aXRoIHJlYXNvbmFibGUgZWZmaWNpZW5jeVxuICAgKiBvbiBFUzUgYnkgaXRzZWxmIChpLmUuLCB3aXRob3V0IGFueSBvYmplY3Qta2V5ZWQgY29sbGVjdGlvbnMpLCB3ZVxuICAgKiBuZWVkIHRvIGFkZCBhIGhpZGRlbiBwcm9wZXJ0eSB0byBzdWNoIGtleSBvYmplY3RzIHdoZW4gd2VcbiAgICogY2FuLiBUaGlzIHJhaXNlcyBzZXZlcmFsIGlzc3VlczpcbiAgICogPHVsPlxuICAgKiA8bGk+QXJyYW5naW5nIHRvIGFkZCB0aGlzIHByb3BlcnR5IHRvIG9iamVjdHMgYmVmb3JlIHdlIGxvc2UgdGhlXG4gICAqICAgICBjaGFuY2UsIGFuZFxuICAgKiA8bGk+SGlkaW5nIHRoZSBleGlzdGVuY2Ugb2YgdGhpcyBuZXcgcHJvcGVydHkgZnJvbSBtb3N0XG4gICAqICAgICBKYXZhU2NyaXB0IGNvZGUuXG4gICAqIDxsaT5QcmV2ZW50aW5nIDxpPmNlcnRpZmljYXRpb24gdGhlZnQ8L2k+LCB3aGVyZSBvbmUgb2JqZWN0IGlzXG4gICAqICAgICBjcmVhdGVkIGZhbHNlbHkgY2xhaW1pbmcgdG8gYmUgdGhlIGtleSBvZiBhbiBhc3NvY2lhdGlvblxuICAgKiAgICAgYWN0dWFsbHkga2V5ZWQgYnkgYW5vdGhlciBvYmplY3QuXG4gICAqIDxsaT5QcmV2ZW50aW5nIDxpPnZhbHVlIHRoZWZ0PC9pPiwgd2hlcmUgdW50cnVzdGVkIGNvZGUgd2l0aFxuICAgKiAgICAgYWNjZXNzIHRvIGEga2V5IG9iamVjdCBidXQgbm90IGEgd2VhayBtYXAgbmV2ZXJ0aGVsZXNzXG4gICAqICAgICBvYnRhaW5zIGFjY2VzcyB0byB0aGUgdmFsdWUgYXNzb2NpYXRlZCB3aXRoIHRoYXQga2V5IGluIHRoYXRcbiAgICogICAgIHdlYWsgbWFwLlxuICAgKiA8L3VsPlxuICAgKiBXZSBkbyBzbyBieVxuICAgKiA8dWw+XG4gICAqIDxsaT5NYWtpbmcgdGhlIG5hbWUgb2YgdGhlIGhpZGRlbiBwcm9wZXJ0eSB1bmd1ZXNzYWJsZSwgc28gXCJbXVwiXG4gICAqICAgICBpbmRleGluZywgd2hpY2ggd2UgY2Fubm90IGludGVyY2VwdCwgY2Fubm90IGJlIHVzZWQgdG8gYWNjZXNzXG4gICAqICAgICBhIHByb3BlcnR5IHdpdGhvdXQga25vd2luZyB0aGUgbmFtZS5cbiAgICogPGxpPk1ha2luZyB0aGUgaGlkZGVuIHByb3BlcnR5IG5vbi1lbnVtZXJhYmxlLCBzbyB3ZSBuZWVkIG5vdFxuICAgKiAgICAgd29ycnkgYWJvdXQgZm9yLWluIGxvb3BzIG9yIHtAY29kZSBPYmplY3Qua2V5c30sXG4gICAqIDxsaT5tb25rZXkgcGF0Y2hpbmcgdGhvc2UgcmVmbGVjdGl2ZSBtZXRob2RzIHRoYXQgd291bGRcbiAgICogICAgIHByZXZlbnQgZXh0ZW5zaW9ucywgdG8gYWRkIHRoaXMgaGlkZGVuIHByb3BlcnR5IGZpcnN0LFxuICAgKiA8bGk+bW9ua2V5IHBhdGNoaW5nIHRob3NlIG1ldGhvZHMgdGhhdCB3b3VsZCByZXZlYWwgdGhpc1xuICAgKiAgICAgaGlkZGVuIHByb3BlcnR5LlxuICAgKiA8L3VsPlxuICAgKiBVbmZvcnR1bmF0ZWx5LCBiZWNhdXNlIG9mIHNhbWUtb3JpZ2luIGlmcmFtZXMsIHdlIGNhbm5vdCByZWxpYWJseVxuICAgKiBhZGQgdGhpcyBoaWRkZW4gcHJvcGVydHkgYmVmb3JlIGFuIG9iamVjdCBiZWNvbWVzXG4gICAqIG5vbi1leHRlbnNpYmxlLiBJbnN0ZWFkLCBpZiB3ZSBlbmNvdW50ZXIgYSBub24tZXh0ZW5zaWJsZSBvYmplY3RcbiAgICogd2l0aG91dCBhIGhpZGRlbiByZWNvcmQgdGhhdCB3ZSBjYW4gZGV0ZWN0ICh3aGV0aGVyIG9yIG5vdCBpdCBoYXNcbiAgICogYSBoaWRkZW4gcmVjb3JkIHN0b3JlZCB1bmRlciBhIG5hbWUgc2VjcmV0IHRvIHVzKSwgdGhlbiB3ZSBqdXN0XG4gICAqIHVzZSB0aGUga2V5IG9iamVjdCBpdHNlbGYgdG8gcmVwcmVzZW50IGl0cyBpZGVudGl0eSBpbiBhIGJydXRlXG4gICAqIGZvcmNlIGxlYWt5IG1hcCBzdG9yZWQgaW4gdGhlIHdlYWsgbWFwLCBsb3NpbmcgYWxsIHRoZSBhZHZhbnRhZ2VzXG4gICAqIG9mIHdlYWtuZXNzIGZvciB0aGVzZS5cbiAgICovXG4gIGZ1bmN0aW9uIGdldEhpZGRlblJlY29yZChrZXkpIHtcbiAgICBpZiAoa2V5ICE9PSBPYmplY3Qoa2V5KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTm90IGFuIG9iamVjdDogJyArIGtleSk7XG4gICAgfVxuICAgIHZhciBoaWRkZW5SZWNvcmQgPSBrZXlbSElEREVOX05BTUVdO1xuICAgIGlmIChoaWRkZW5SZWNvcmQgJiYgaGlkZGVuUmVjb3JkLmtleSA9PT0ga2V5KSB7IHJldHVybiBoaWRkZW5SZWNvcmQ7IH1cbiAgICBpZiAoIWlzRXh0ZW5zaWJsZShrZXkpKSB7XG4gICAgICAvLyBXZWFrIG1hcCBtdXN0IGJydXRlIGZvcmNlLCBhcyBleHBsYWluZWQgaW4gZG9jLWNvbW1lbnQgYWJvdmUuXG4gICAgICByZXR1cm4gdm9pZCAwO1xuICAgIH1cblxuICAgIC8vIFRoZSBoaWRkZW5SZWNvcmQgYW5kIHRoZSBrZXkgcG9pbnQgZGlyZWN0bHkgYXQgZWFjaCBvdGhlciwgdmlhXG4gICAgLy8gdGhlIFwia2V5XCIgYW5kIEhJRERFTl9OQU1FIHByb3BlcnRpZXMgcmVzcGVjdGl2ZWx5LiBUaGUga2V5XG4gICAgLy8gZmllbGQgaXMgZm9yIHF1aWNrbHkgdmVyaWZ5aW5nIHRoYXQgdGhpcyBoaWRkZW4gcmVjb3JkIGlzIGFuXG4gICAgLy8gb3duIHByb3BlcnR5LCBub3QgYSBoaWRkZW4gcmVjb3JkIGZyb20gdXAgdGhlIHByb3RvdHlwZSBjaGFpbi5cbiAgICAvL1xuICAgIC8vIE5PVEU6IEJlY2F1c2UgdGhpcyBXZWFrTWFwIGVtdWxhdGlvbiBpcyBtZWFudCBvbmx5IGZvciBzeXN0ZW1zIGxpa2VcbiAgICAvLyBTRVMgd2hlcmUgT2JqZWN0LnByb3RvdHlwZSBpcyBmcm96ZW4gd2l0aG91dCBhbnkgbnVtZXJpY1xuICAgIC8vIHByb3BlcnRpZXMsIGl0IGlzIG9rIHRvIHVzZSBhbiBvYmplY3QgbGl0ZXJhbCBmb3IgdGhlIGhpZGRlblJlY29yZC5cbiAgICAvLyBUaGlzIGhhcyB0d28gYWR2YW50YWdlczpcbiAgICAvLyAqIEl0IGlzIG11Y2ggZmFzdGVyIGluIGEgcGVyZm9ybWFuY2UgY3JpdGljYWwgcGxhY2VcbiAgICAvLyAqIEl0IGF2b2lkcyByZWx5aW5nIG9uIE9iamVjdC5jcmVhdGUobnVsbCksIHdoaWNoIGhhZCBiZWVuXG4gICAgLy8gICBwcm9ibGVtYXRpYyBvbiBDaHJvbWUgMjguMC4xNDgwLjAuIFNlZVxuICAgIC8vICAgaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC9nb29nbGUtY2FqYS9pc3N1ZXMvZGV0YWlsP2lkPTE2ODdcbiAgICBoaWRkZW5SZWNvcmQgPSB7IGtleToga2V5IH07XG5cbiAgICAvLyBXaGVuIHVzaW5nIHRoaXMgV2Vha01hcCBlbXVsYXRpb24gb24gcGxhdGZvcm1zIHdoZXJlXG4gICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtaWdodCBub3QgYmUgZnJvemVuIGFuZCBPYmplY3QuY3JlYXRlKG51bGwpIGlzXG4gICAgLy8gcmVsaWFibGUsIHVzZSB0aGUgZm9sbG93aW5nIHR3byBjb21tZW50ZWQgb3V0IGxpbmVzIGluc3RlYWQuXG4gICAgLy8gaGlkZGVuUmVjb3JkID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAvLyBoaWRkZW5SZWNvcmQua2V5ID0ga2V5O1xuXG4gICAgLy8gUGxlYXNlIGNvbnRhY3QgdXMgaWYgeW91IG5lZWQgdGhpcyB0byB3b3JrIG9uIHBsYXRmb3JtcyB3aGVyZVxuICAgIC8vIE9iamVjdC5wcm90b3R5cGUgbWlnaHQgbm90IGJlIGZyb3plbiBhbmRcbiAgICAvLyBPYmplY3QuY3JlYXRlKG51bGwpIG1pZ2h0IG5vdCBiZSByZWxpYWJsZS5cblxuICAgIHRyeSB7XG4gICAgICBkZWZQcm9wKGtleSwgSElEREVOX05BTUUsIHtcbiAgICAgICAgdmFsdWU6IGhpZGRlblJlY29yZCxcbiAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gaGlkZGVuUmVjb3JkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBVbmRlciBzb21lIGNpcmN1bXN0YW5jZXMsIGlzRXh0ZW5zaWJsZSBzZWVtcyB0byBtaXNyZXBvcnQgd2hldGhlclxuICAgICAgLy8gdGhlIEhJRERFTl9OQU1FIGNhbiBiZSBkZWZpbmVkLlxuICAgICAgLy8gVGhlIGNpcmN1bXN0YW5jZXMgaGF2ZSBub3QgYmVlbiBpc29sYXRlZCwgYnV0IGF0IGxlYXN0IGFmZmVjdFxuICAgICAgLy8gTm9kZS5qcyB2MC4xMC4yNiBvbiBUcmF2aXNDSSAvIExpbnV4LCBidXQgbm90IHRoZSBzYW1lIHZlcnNpb24gb2ZcbiAgICAgIC8vIE5vZGUuanMgb24gT1MgWC5cbiAgICAgIHJldHVybiB2b2lkIDA7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1vbmtleSBwYXRjaCBvcGVyYXRpb25zIHRoYXQgd291bGQgbWFrZSB0aGVpciBhcmd1bWVudFxuICAgKiBub24tZXh0ZW5zaWJsZS5cbiAgICpcbiAgICogPHA+VGhlIG1vbmtleSBwYXRjaGVkIHZlcnNpb25zIHRocm93IGEgVHlwZUVycm9yIGlmIHRoZWlyXG4gICAqIGFyZ3VtZW50IGlzIG5vdCBhbiBvYmplY3QsIHNvIGl0IHNob3VsZCBvbmx5IGJlIGRvbmUgdG8gZnVuY3Rpb25zXG4gICAqIHRoYXQgc2hvdWxkIHRocm93IGEgVHlwZUVycm9yIGFueXdheSBpZiB0aGVpciBhcmd1bWVudCBpcyBub3QgYW5cbiAgICogb2JqZWN0LlxuICAgKi9cbiAgKGZ1bmN0aW9uKCl7XG4gICAgdmFyIG9sZEZyZWV6ZSA9IE9iamVjdC5mcmVlemU7XG4gICAgZGVmUHJvcChPYmplY3QsICdmcmVlemUnLCB7XG4gICAgICB2YWx1ZTogZnVuY3Rpb24gaWRlbnRpZnlpbmdGcmVlemUob2JqKSB7XG4gICAgICAgIGdldEhpZGRlblJlY29yZChvYmopO1xuICAgICAgICByZXR1cm4gb2xkRnJlZXplKG9iaik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdmFyIG9sZFNlYWwgPSBPYmplY3Quc2VhbDtcbiAgICBkZWZQcm9wKE9iamVjdCwgJ3NlYWwnLCB7XG4gICAgICB2YWx1ZTogZnVuY3Rpb24gaWRlbnRpZnlpbmdTZWFsKG9iaikge1xuICAgICAgICBnZXRIaWRkZW5SZWNvcmQob2JqKTtcbiAgICAgICAgcmV0dXJuIG9sZFNlYWwob2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB2YXIgb2xkUHJldmVudEV4dGVuc2lvbnMgPSBPYmplY3QucHJldmVudEV4dGVuc2lvbnM7XG4gICAgZGVmUHJvcChPYmplY3QsICdwcmV2ZW50RXh0ZW5zaW9ucycsIHtcbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBpZGVudGlmeWluZ1ByZXZlbnRFeHRlbnNpb25zKG9iaikge1xuICAgICAgICBnZXRIaWRkZW5SZWNvcmQob2JqKTtcbiAgICAgICAgcmV0dXJuIG9sZFByZXZlbnRFeHRlbnNpb25zKG9iaik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pKCk7XG5cbiAgZnVuY3Rpb24gY29uc3RGdW5jKGZ1bmMpIHtcbiAgICBmdW5jLnByb3RvdHlwZSA9IG51bGw7XG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoZnVuYyk7XG4gIH1cblxuICB2YXIgY2FsbGVkQXNGdW5jdGlvbldhcm5pbmdEb25lID0gZmFsc2U7XG4gIGZ1bmN0aW9uIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nKCkge1xuICAgIC8vIEZ1dHVyZSBFUzYgV2Vha01hcCBpcyBjdXJyZW50bHkgKDIwMTMtMDktMTApIGV4cGVjdGVkIHRvIHJlamVjdCBXZWFrTWFwKClcbiAgICAvLyBidXQgd2UgdXNlZCB0byBwZXJtaXQgaXQgYW5kIGRvIGl0IG91cnNlbHZlcywgc28gd2FybiBvbmx5LlxuICAgIGlmICghY2FsbGVkQXNGdW5jdGlvbldhcm5pbmdEb25lICYmIHR5cGVvZiBjb25zb2xlICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgY2FsbGVkQXNGdW5jdGlvbldhcm5pbmdEb25lID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUud2FybignV2Vha01hcCBzaG91bGQgYmUgaW52b2tlZCBhcyBuZXcgV2Vha01hcCgpLCBub3QgJyArXG4gICAgICAgICAgJ1dlYWtNYXAoKS4gVGhpcyB3aWxsIGJlIGFuIGVycm9yIGluIHRoZSBmdXR1cmUuJyk7XG4gICAgfVxuICB9XG5cbiAgdmFyIG5leHRJZCA9IDA7XG5cbiAgdmFyIE91cldlYWtNYXAgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgT3VyV2Vha01hcCkpIHsgIC8vIGFwcHJveGltYXRlIHRlc3QgZm9yIG5ldyAuLi4oKVxuICAgICAgY2FsbGVkQXNGdW5jdGlvbldhcm5pbmcoKTtcbiAgICB9XG5cbiAgICAvLyBXZSBhcmUgY3VycmVudGx5ICgxMi8yNS8yMDEyKSBuZXZlciBlbmNvdW50ZXJpbmcgYW55IHByZW1hdHVyZWx5XG4gICAgLy8gbm9uLWV4dGVuc2libGUga2V5cy5cbiAgICB2YXIga2V5cyA9IFtdOyAvLyBicnV0ZSBmb3JjZSBmb3IgcHJlbWF0dXJlbHkgbm9uLWV4dGVuc2libGUga2V5cy5cbiAgICB2YXIgdmFsdWVzID0gW107IC8vIGJydXRlIGZvcmNlIGZvciBjb3JyZXNwb25kaW5nIHZhbHVlcy5cbiAgICB2YXIgaWQgPSBuZXh0SWQrKztcblxuICAgIGZ1bmN0aW9uIGdldF9fXyhrZXksIG9wdF9kZWZhdWx0KSB7XG4gICAgICB2YXIgaW5kZXg7XG4gICAgICB2YXIgaGlkZGVuUmVjb3JkID0gZ2V0SGlkZGVuUmVjb3JkKGtleSk7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIHJldHVybiBpZCBpbiBoaWRkZW5SZWNvcmQgPyBoaWRkZW5SZWNvcmRbaWRdIDogb3B0X2RlZmF1bHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbmRleCA9IGtleXMuaW5kZXhPZihrZXkpO1xuICAgICAgICByZXR1cm4gaW5kZXggPj0gMCA/IHZhbHVlc1tpbmRleF0gOiBvcHRfZGVmYXVsdDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoYXNfX18oa2V5KSB7XG4gICAgICB2YXIgaGlkZGVuUmVjb3JkID0gZ2V0SGlkZGVuUmVjb3JkKGtleSk7XG4gICAgICBpZiAoaGlkZGVuUmVjb3JkKSB7XG4gICAgICAgIHJldHVybiBpZCBpbiBoaWRkZW5SZWNvcmQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4ga2V5cy5pbmRleE9mKGtleSkgPj0gMDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZXRfX18oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIGluZGV4O1xuICAgICAgdmFyIGhpZGRlblJlY29yZCA9IGdldEhpZGRlblJlY29yZChrZXkpO1xuICAgICAgaWYgKGhpZGRlblJlY29yZCkge1xuICAgICAgICBoaWRkZW5SZWNvcmRbaWRdID0gdmFsdWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbmRleCA9IGtleXMuaW5kZXhPZihrZXkpO1xuICAgICAgICBpZiAoaW5kZXggPj0gMCkge1xuICAgICAgICAgIHZhbHVlc1tpbmRleF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTaW5jZSBzb21lIGJyb3dzZXJzIHByZWVtcHRpdmVseSB0ZXJtaW5hdGUgc2xvdyB0dXJucyBidXRcbiAgICAgICAgICAvLyB0aGVuIGNvbnRpbnVlIGNvbXB1dGluZyB3aXRoIHByZXN1bWFibHkgY29ycnVwdGVkIGhlYXBcbiAgICAgICAgICAvLyBzdGF0ZSwgd2UgaGVyZSBkZWZlbnNpdmVseSBnZXQga2V5cy5sZW5ndGggZmlyc3QgYW5kIHRoZW5cbiAgICAgICAgICAvLyB1c2UgaXQgdG8gdXBkYXRlIGJvdGggdGhlIHZhbHVlcyBhbmQga2V5cyBhcnJheXMsIGtlZXBpbmdcbiAgICAgICAgICAvLyB0aGVtIGluIHN5bmMuXG4gICAgICAgICAgaW5kZXggPSBrZXlzLmxlbmd0aDtcbiAgICAgICAgICB2YWx1ZXNbaW5kZXhdID0gdmFsdWU7XG4gICAgICAgICAgLy8gSWYgd2UgY3Jhc2ggaGVyZSwgdmFsdWVzIHdpbGwgYmUgb25lIGxvbmdlciB0aGFuIGtleXMuXG4gICAgICAgICAga2V5c1tpbmRleF0gPSBrZXk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGV0ZV9fXyhrZXkpIHtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIHZhciBpbmRleCwgbGFzdEluZGV4O1xuICAgICAgaWYgKGhpZGRlblJlY29yZCkge1xuICAgICAgICByZXR1cm4gaWQgaW4gaGlkZGVuUmVjb3JkICYmIGRlbGV0ZSBoaWRkZW5SZWNvcmRbaWRdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5kZXggPSBrZXlzLmluZGV4T2Yoa2V5KTtcbiAgICAgICAgaWYgKGluZGV4IDwgMCkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBTaW5jZSBzb21lIGJyb3dzZXJzIHByZWVtcHRpdmVseSB0ZXJtaW5hdGUgc2xvdyB0dXJucyBidXRcbiAgICAgICAgLy8gdGhlbiBjb250aW51ZSBjb21wdXRpbmcgd2l0aCBwb3RlbnRpYWxseSBjb3JydXB0ZWQgaGVhcFxuICAgICAgICAvLyBzdGF0ZSwgd2UgaGVyZSBkZWZlbnNpdmVseSBnZXQga2V5cy5sZW5ndGggZmlyc3QgYW5kIHRoZW4gdXNlXG4gICAgICAgIC8vIGl0IHRvIHVwZGF0ZSBib3RoIHRoZSBrZXlzIGFuZCB0aGUgdmFsdWVzIGFycmF5LCBrZWVwaW5nXG4gICAgICAgIC8vIHRoZW0gaW4gc3luYy4gV2UgdXBkYXRlIHRoZSB0d28gd2l0aCBhbiBvcmRlciBvZiBhc3NpZ25tZW50cyxcbiAgICAgICAgLy8gc3VjaCB0aGF0IGFueSBwcmVmaXggb2YgdGhlc2UgYXNzaWdubWVudHMgd2lsbCBwcmVzZXJ2ZSB0aGVcbiAgICAgICAgLy8ga2V5L3ZhbHVlIGNvcnJlc3BvbmRlbmNlLCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSBkZWxldGUuXG4gICAgICAgIC8vIE5vdGUgdGhhdCB0aGlzIG5lZWRzIHRvIHdvcmsgY29ycmVjdGx5IHdoZW4gaW5kZXggPT09IGxhc3RJbmRleC5cbiAgICAgICAgbGFzdEluZGV4ID0ga2V5cy5sZW5ndGggLSAxO1xuICAgICAgICBrZXlzW2luZGV4XSA9IHZvaWQgMDtcbiAgICAgICAgLy8gSWYgd2UgY3Jhc2ggaGVyZSwgdGhlcmUncyBhIHZvaWQgMCBpbiB0aGUga2V5cyBhcnJheSwgYnV0XG4gICAgICAgIC8vIG5vIG9wZXJhdGlvbiB3aWxsIGNhdXNlIGEgXCJrZXlzLmluZGV4T2Yodm9pZCAwKVwiLCBzaW5jZVxuICAgICAgICAvLyBnZXRIaWRkZW5SZWNvcmQodm9pZCAwKSB3aWxsIGFsd2F5cyB0aHJvdyBhbiBlcnJvciBmaXJzdC5cbiAgICAgICAgdmFsdWVzW2luZGV4XSA9IHZhbHVlc1tsYXN0SW5kZXhdO1xuICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCB2YWx1ZXNbaW5kZXhdIGNhbm5vdCBiZSBmb3VuZCBoZXJlLFxuICAgICAgICAvLyBiZWNhdXNlIGtleXNbaW5kZXhdIGlzIHZvaWQgMC5cbiAgICAgICAga2V5c1tpbmRleF0gPSBrZXlzW2xhc3RJbmRleF07XG4gICAgICAgIC8vIElmIGluZGV4ID09PSBsYXN0SW5kZXggYW5kIHdlIGNyYXNoIGhlcmUsIHRoZW4ga2V5c1tpbmRleF1cbiAgICAgICAgLy8gaXMgc3RpbGwgdm9pZCAwLCBzaW5jZSB0aGUgYWxpYXNpbmcga2lsbGVkIHRoZSBwcmV2aW91cyBrZXkuXG4gICAgICAgIGtleXMubGVuZ3RoID0gbGFzdEluZGV4O1xuICAgICAgICAvLyBJZiB3ZSBjcmFzaCBoZXJlLCBrZXlzIHdpbGwgYmUgb25lIHNob3J0ZXIgdGhhbiB2YWx1ZXMuXG4gICAgICAgIHZhbHVlcy5sZW5ndGggPSBsYXN0SW5kZXg7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBPYmplY3QuY3JlYXRlKE91cldlYWtNYXAucHJvdG90eXBlLCB7XG4gICAgICBnZXRfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhnZXRfX18pIH0sXG4gICAgICBoYXNfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhoYXNfX18pIH0sXG4gICAgICBzZXRfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhzZXRfX18pIH0sXG4gICAgICBkZWxldGVfX186IHsgdmFsdWU6IGNvbnN0RnVuYyhkZWxldGVfX18pIH1cbiAgICB9KTtcbiAgfTtcblxuICBPdXJXZWFrTWFwLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoT2JqZWN0LnByb3RvdHlwZSwge1xuICAgIGdldDoge1xuICAgICAgLyoqXG4gICAgICAgKiBSZXR1cm4gdGhlIHZhbHVlIG1vc3QgcmVjZW50bHkgYXNzb2NpYXRlZCB3aXRoIGtleSwgb3JcbiAgICAgICAqIG9wdF9kZWZhdWx0IGlmIG5vbmUuXG4gICAgICAgKi9cbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBnZXQoa2V5LCBvcHRfZGVmYXVsdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRfX18oa2V5LCBvcHRfZGVmYXVsdCk7XG4gICAgICB9LFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICB9LFxuXG4gICAgaGFzOiB7XG4gICAgICAvKipcbiAgICAgICAqIElzIHRoZXJlIGEgdmFsdWUgYXNzb2NpYXRlZCB3aXRoIGtleSBpbiB0aGlzIFdlYWtNYXA/XG4gICAgICAgKi9cbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBoYXMoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhhc19fXyhrZXkpO1xuICAgICAgfSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSxcblxuICAgIHNldDoge1xuICAgICAgLyoqXG4gICAgICAgKiBBc3NvY2lhdGUgdmFsdWUgd2l0aCBrZXkgaW4gdGhpcyBXZWFrTWFwLCBvdmVyd3JpdGluZyBhbnlcbiAgICAgICAqIHByZXZpb3VzIGFzc29jaWF0aW9uIGlmIHByZXNlbnQuXG4gICAgICAgKi9cbiAgICAgIHZhbHVlOiBmdW5jdGlvbiBzZXQoa2V5LCB2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXRfX18oa2V5LCB2YWx1ZSk7XG4gICAgICB9LFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICB9LFxuXG4gICAgJ2RlbGV0ZSc6IHtcbiAgICAgIC8qKlxuICAgICAgICogUmVtb3ZlIGFueSBhc3NvY2lhdGlvbiBmb3Iga2V5IGluIHRoaXMgV2Vha01hcCwgcmV0dXJuaW5nXG4gICAgICAgKiB3aGV0aGVyIHRoZXJlIHdhcyBvbmUuXG4gICAgICAgKlxuICAgICAgICogPHA+Tm90ZSB0aGF0IHRoZSBib29sZWFuIHJldHVybiBoZXJlIGRvZXMgbm90IHdvcmsgbGlrZSB0aGVcbiAgICAgICAqIHtAY29kZSBkZWxldGV9IG9wZXJhdG9yLiBUaGUge0Bjb2RlIGRlbGV0ZX0gb3BlcmF0b3IgcmV0dXJuc1xuICAgICAgICogd2hldGhlciB0aGUgZGVsZXRpb24gc3VjY2VlZHMgYXQgYnJpbmdpbmcgYWJvdXQgYSBzdGF0ZSBpblxuICAgICAgICogd2hpY2ggdGhlIGRlbGV0ZWQgcHJvcGVydHkgaXMgYWJzZW50LiBUaGUge0Bjb2RlIGRlbGV0ZX1cbiAgICAgICAqIG9wZXJhdG9yIHRoZXJlZm9yZSByZXR1cm5zIHRydWUgaWYgdGhlIHByb3BlcnR5IHdhcyBhbHJlYWR5XG4gICAgICAgKiBhYnNlbnQsIHdoZXJlYXMgdGhpcyB7QGNvZGUgZGVsZXRlfSBtZXRob2QgcmV0dXJucyBmYWxzZSBpZlxuICAgICAgICogdGhlIGFzc29jaWF0aW9uIHdhcyBhbHJlYWR5IGFic2VudC5cbiAgICAgICAqL1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIHJlbW92ZShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVsZXRlX19fKGtleSk7XG4gICAgICB9LFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICB9XG4gIH0pO1xuXG4gIGlmICh0eXBlb2YgSG9zdFdlYWtNYXAgPT09ICdmdW5jdGlvbicpIHtcbiAgICAoZnVuY3Rpb24oKSB7XG4gICAgICAvLyBJZiB3ZSBnb3QgaGVyZSwgdGhlbiB0aGUgcGxhdGZvcm0gaGFzIGEgV2Vha01hcCBidXQgd2UgYXJlIGNvbmNlcm5lZFxuICAgICAgLy8gdGhhdCBpdCBtYXkgcmVmdXNlIHRvIHN0b3JlIHNvbWUga2V5IHR5cGVzLiBUaGVyZWZvcmUsIG1ha2UgYSBtYXBcbiAgICAgIC8vIGltcGxlbWVudGF0aW9uIHdoaWNoIG1ha2VzIHVzZSBvZiBib3RoIGFzIHBvc3NpYmxlLlxuXG4gICAgICAvLyBJbiB0aGlzIG1vZGUgd2UgYXJlIGFsd2F5cyB1c2luZyBkb3VibGUgbWFwcywgc28gd2UgYXJlIG5vdCBwcm94eS1zYWZlLlxuICAgICAgLy8gVGhpcyBjb21iaW5hdGlvbiBkb2VzIG5vdCBvY2N1ciBpbiBhbnkga25vd24gYnJvd3NlciwgYnV0IHdlIGhhZCBiZXN0XG4gICAgICAvLyBiZSBzYWZlLlxuICAgICAgaWYgKGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgJiYgdHlwZW9mIFByb3h5ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBQcm94eSA9IHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgZnVuY3Rpb24gRG91YmxlV2Vha01hcCgpIHtcbiAgICAgICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIE91cldlYWtNYXApKSB7ICAvLyBhcHByb3hpbWF0ZSB0ZXN0IGZvciBuZXcgLi4uKClcbiAgICAgICAgICBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZygpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUHJlZmVyYWJsZSwgdHJ1bHkgd2VhayBtYXAuXG4gICAgICAgIHZhciBobWFwID0gbmV3IEhvc3RXZWFrTWFwKCk7XG5cbiAgICAgICAgLy8gT3VyIGhpZGRlbi1wcm9wZXJ0eS1iYXNlZCBwc2V1ZG8td2Vhay1tYXAuIExhemlseSBpbml0aWFsaXplZCBpbiB0aGVcbiAgICAgICAgLy8gJ3NldCcgaW1wbGVtZW50YXRpb247IHRodXMgd2UgY2FuIGF2b2lkIHBlcmZvcm1pbmcgZXh0cmEgbG9va3VwcyBpZlxuICAgICAgICAvLyB3ZSBrbm93IGFsbCBlbnRyaWVzIGFjdHVhbGx5IHN0b3JlZCBhcmUgZW50ZXJlZCBpbiAnaG1hcCcuXG4gICAgICAgIHZhciBvbWFwID0gdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIEhpZGRlbi1wcm9wZXJ0eSBtYXBzIGFyZSBub3QgY29tcGF0aWJsZSB3aXRoIHByb3hpZXMgYmVjYXVzZSBwcm94aWVzXG4gICAgICAgIC8vIGNhbiBvYnNlcnZlIHRoZSBoaWRkZW4gbmFtZSBhbmQgZWl0aGVyIGFjY2lkZW50YWxseSBleHBvc2UgaXQgb3IgZmFpbFxuICAgICAgICAvLyB0byBhbGxvdyB0aGUgaGlkZGVuIHByb3BlcnR5IHRvIGJlIHNldC4gVGhlcmVmb3JlLCB3ZSBkbyBub3QgYWxsb3dcbiAgICAgICAgLy8gYXJiaXRyYXJ5IFdlYWtNYXBzIHRvIHN3aXRjaCB0byB1c2luZyBoaWRkZW4gcHJvcGVydGllcywgYnV0IG9ubHlcbiAgICAgICAgLy8gdGhvc2Ugd2hpY2ggbmVlZCB0aGUgYWJpbGl0eSwgYW5kIHVucHJpdmlsZWdlZCBjb2RlIGlzIG5vdCBhbGxvd2VkXG4gICAgICAgIC8vIHRvIHNldCB0aGUgZmxhZy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gKEV4Y2VwdCBpbiBkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlIG1vZGUgaW4gd2hpY2ggY2FzZSB3ZVxuICAgICAgICAvLyBkaXNhYmxlIHByb3hpZXMuKVxuICAgICAgICB2YXIgZW5hYmxlU3dpdGNoaW5nID0gZmFsc2U7XG5cbiAgICAgICAgZnVuY3Rpb24gZGdldChrZXksIG9wdF9kZWZhdWx0KSB7XG4gICAgICAgICAgaWYgKG9tYXApIHtcbiAgICAgICAgICAgIHJldHVybiBobWFwLmhhcyhrZXkpID8gaG1hcC5nZXQoa2V5KVxuICAgICAgICAgICAgICAgIDogb21hcC5nZXRfX18oa2V5LCBvcHRfZGVmYXVsdCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBobWFwLmdldChrZXksIG9wdF9kZWZhdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBkaGFzKGtleSkge1xuICAgICAgICAgIHJldHVybiBobWFwLmhhcyhrZXkpIHx8IChvbWFwID8gb21hcC5oYXNfX18oa2V5KSA6IGZhbHNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBkc2V0O1xuICAgICAgICBpZiAoZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSkge1xuICAgICAgICAgIGRzZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBobWFwLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIGlmICghaG1hcC5oYXMoa2V5KSkge1xuICAgICAgICAgICAgICBpZiAoIW9tYXApIHsgb21hcCA9IG5ldyBPdXJXZWFrTWFwKCk7IH1cbiAgICAgICAgICAgICAgb21hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRzZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoZW5hYmxlU3dpdGNoaW5nKSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaG1hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW9tYXApIHsgb21hcCA9IG5ldyBPdXJXZWFrTWFwKCk7IH1cbiAgICAgICAgICAgICAgICBvbWFwLnNldF9fXyhrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgaG1hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gZGRlbGV0ZShrZXkpIHtcbiAgICAgICAgICB2YXIgcmVzdWx0ID0gISFobWFwWydkZWxldGUnXShrZXkpO1xuICAgICAgICAgIGlmIChvbWFwKSB7IHJldHVybiBvbWFwLmRlbGV0ZV9fXyhrZXkpIHx8IHJlc3VsdDsgfVxuICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShPdXJXZWFrTWFwLnByb3RvdHlwZSwge1xuICAgICAgICAgIGdldF9fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGRnZXQpIH0sXG4gICAgICAgICAgaGFzX19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoZGhhcykgfSxcbiAgICAgICAgICBzZXRfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhkc2V0KSB9LFxuICAgICAgICAgIGRlbGV0ZV9fXzogeyB2YWx1ZTogY29uc3RGdW5jKGRkZWxldGUpIH0sXG4gICAgICAgICAgcGVybWl0SG9zdE9iamVjdHNfX186IHsgdmFsdWU6IGNvbnN0RnVuYyhmdW5jdGlvbih0b2tlbikge1xuICAgICAgICAgICAgaWYgKHRva2VuID09PSB3ZWFrTWFwUGVybWl0SG9zdE9iamVjdHMpIHtcbiAgICAgICAgICAgICAgZW5hYmxlU3dpdGNoaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignYm9ndXMgY2FsbCB0byBwZXJtaXRIb3N0T2JqZWN0c19fXycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIERvdWJsZVdlYWtNYXAucHJvdG90eXBlID0gT3VyV2Vha01hcC5wcm90b3R5cGU7XG4gICAgICBtb2R1bGUuZXhwb3J0cyA9IERvdWJsZVdlYWtNYXA7XG5cbiAgICAgIC8vIGRlZmluZSAuY29uc3RydWN0b3IgdG8gaGlkZSBPdXJXZWFrTWFwIGN0b3JcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShXZWFrTWFwLnByb3RvdHlwZSwgJ2NvbnN0cnVjdG9yJywge1xuICAgICAgICB2YWx1ZTogV2Vha01hcCxcbiAgICAgICAgZW51bWVyYWJsZTogZmFsc2UsICAvLyBhcyBkZWZhdWx0IC5jb25zdHJ1Y3RvciBpc1xuICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIHdyaXRhYmxlOiB0cnVlXG4gICAgICB9KTtcbiAgICB9KSgpO1xuICB9IGVsc2Uge1xuICAgIC8vIFRoZXJlIGlzIG5vIGhvc3QgV2Vha01hcCwgc28gd2UgbXVzdCB1c2UgdGhlIGVtdWxhdGlvbi5cblxuICAgIC8vIEVtdWxhdGVkIFdlYWtNYXBzIGFyZSBpbmNvbXBhdGlibGUgd2l0aCBuYXRpdmUgcHJveGllcyAoYmVjYXVzZSBwcm94aWVzXG4gICAgLy8gY2FuIG9ic2VydmUgdGhlIGhpZGRlbiBuYW1lKSwgc28gd2UgbXVzdCBkaXNhYmxlIFByb3h5IHVzYWdlIChpblxuICAgIC8vIEFycmF5TGlrZSBhbmQgRG9tYWRvLCBjdXJyZW50bHkpLlxuICAgIGlmICh0eXBlb2YgUHJveHkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBQcm94eSA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBtb2R1bGUuZXhwb3J0cyA9IE91cldlYWtNYXA7XG4gIH1cbn0pKCk7XG4iLCJ2YXIgV007XG5cbmlmKHR5cGVvZiBXZWFrTWFwICE9PSAndW5kZWZpbmVkJyl7XG4gICAgV00gPSBXZWFrTWFwO1xufWVsc2UgaWYodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpe1xuICAgIGlmIChuYXZpZ2F0b3IuYXBwTmFtZSA9PSAnTWljcm9zb2Z0IEludGVybmV0IEV4cGxvcmVyJyl7XG4gICAgICAgIHZhciBtYXRjaCA9IG5hdmlnYXRvci51c2VyQWdlbnQubWF0Y2goL01TSUUgKFswLTldezEsfVtcXC4wLTldezAsfSkvKTtcbiAgICAgICAgaWYgKG1hdGNoICYmIG1hdGNoWzFdIDw9IDkpe1xuICAgICAgICAgICAgLy8gTUVNT1JZIExFQUtTIEZPUiBFVkVSWU9ORSEhIVxuICAgICAgICAgICAgV00gPSByZXF1aXJlKCdsZWFrLW1hcCcpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5XTSB8fCAoV00gPSByZXF1aXJlKCd3ZWFrLW1hcCcpKTtcblxubW9kdWxlLmV4cG9ydHMgPSBXTTsiLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG5mdW5jdGlvbiBrZXlzQXJlRGlmZmVyZW50KGtleXMxLCBrZXlzMil7XG4gICAgaWYoa2V5czEgPT09IGtleXMyKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZigha2V5czEgfHwgIWtleXMyIHx8IGtleXMxLmxlbmd0aCAhPT0ga2V5czIubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBrZXlzMS5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKCF+a2V5czIuaW5kZXhPZihrZXlzMVtpXSkpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ3R5cGUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHR5cGVvZiB2YWx1ZSAhPT0gdHlwZW9mIHRoaXMuX2xhc3RWYWx1ZSl7XG4gICAgICAgIHJlc3VsdC50eXBlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYoJ2tleXMnIGluIGNoYW5nZXNUb1RyYWNrICYmIGtleXNBcmVEaWZmZXJlbnQodGhpcy5fbGFzdEtleXMsIGdldEtleXModmFsdWUpKSl7XG4gICAgICAgIHJlc3VsdC5rZXlzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKXtcbiAgICAgICAgaWYoJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgIWRlZXBFcXVhbCh2YWx1ZSwgdGhpcy5fbGFzdFZhbHVlKSl7XG4gICAgICAgICAgICByZXN1bHQuc3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZigncmVmZXJlbmNlJyBpbiBjaGFuZ2VzVG9UcmFjayAmJiB2YWx1ZSAhPT0gdGhpcy5fbGFzdFJlZmVyZW5jZSl7XG4gICAgICAgICAgICByZXN1bHQucmVmZXJlbmNlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2xhc3RWYWx1ZSA9ICdzdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrID8gY2xvbmUodmFsdWUpIDogdmFsdWU7XG4gICAgdGhpcy5fbGFzdFJlZmVyZW5jZSA9IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RLZXlzID0gbmV3S2V5cztcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdoYXRDaGFuZ2VkOyIsIihmdW5jdGlvbiAoQnVmZmVyKXtcbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gb2JqZWN0VG9TdHJpbmcobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufVxuXG4vLyBzaGltIGZvciBOb2RlJ3MgJ3V0aWwnIHBhY2thZ2Vcbi8vIERPIE5PVCBSRU1PVkUgVEhJUyEgSXQgaXMgcmVxdWlyZWQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBFbmRlckpTIChodHRwOi8vZW5kZXJqcy5jb20vKS5cbnZhciB1dGlsID0ge1xuICBpc0FycmF5OiBmdW5jdGlvbiAoYXIpIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShhcikgfHwgKHR5cGVvZiBhciA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoYXIpID09PSAnW29iamVjdCBBcnJheV0nKTtcbiAgfSxcbiAgaXNEYXRlOiBmdW5jdGlvbiAoZCkge1xuICAgIHJldHVybiB0eXBlb2YgZCA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZCkgPT09ICdbb2JqZWN0IERhdGVdJztcbiAgfSxcbiAgaXNSZWdFeHA6IGZ1bmN0aW9uIChyZSkge1xuICAgIHJldHVybiB0eXBlb2YgcmUgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKHJlKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7XG4gIH0sXG4gIGdldFJlZ0V4cEZsYWdzOiBmdW5jdGlvbiAocmUpIHtcbiAgICB2YXIgZmxhZ3MgPSAnJztcbiAgICByZS5nbG9iYWwgJiYgKGZsYWdzICs9ICdnJyk7XG4gICAgcmUuaWdub3JlQ2FzZSAmJiAoZmxhZ3MgKz0gJ2knKTtcbiAgICByZS5tdWx0aWxpbmUgJiYgKGZsYWdzICs9ICdtJyk7XG4gICAgcmV0dXJuIGZsYWdzO1xuICB9XG59O1xuXG5cbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JylcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcblxuLyoqXG4gKiBDbG9uZXMgKGNvcGllcykgYW4gT2JqZWN0IHVzaW5nIGRlZXAgY29weWluZy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHN1cHBvcnRzIGNpcmN1bGFyIHJlZmVyZW5jZXMgYnkgZGVmYXVsdCwgYnV0IGlmIHlvdSBhcmUgY2VydGFpblxuICogdGhlcmUgYXJlIG5vIGNpcmN1bGFyIHJlZmVyZW5jZXMgaW4geW91ciBvYmplY3QsIHlvdSBjYW4gc2F2ZSBzb21lIENQVSB0aW1lXG4gKiBieSBjYWxsaW5nIGNsb25lKG9iaiwgZmFsc2UpLlxuICpcbiAqIENhdXRpb246IGlmIGBjaXJjdWxhcmAgaXMgZmFsc2UgYW5kIGBwYXJlbnRgIGNvbnRhaW5zIGNpcmN1bGFyIHJlZmVyZW5jZXMsXG4gKiB5b3VyIHByb2dyYW0gbWF5IGVudGVyIGFuIGluZmluaXRlIGxvb3AgYW5kIGNyYXNoLlxuICpcbiAqIEBwYXJhbSBgcGFyZW50YCAtIHRoZSBvYmplY3QgdG8gYmUgY2xvbmVkXG4gKiBAcGFyYW0gYGNpcmN1bGFyYCAtIHNldCB0byB0cnVlIGlmIHRoZSBvYmplY3QgdG8gYmUgY2xvbmVkIG1heSBjb250YWluXG4gKiAgICBjaXJjdWxhciByZWZlcmVuY2VzLiAob3B0aW9uYWwgLSB0cnVlIGJ5IGRlZmF1bHQpXG4gKiBAcGFyYW0gYGRlcHRoYCAtIHNldCB0byBhIG51bWJlciBpZiB0aGUgb2JqZWN0IGlzIG9ubHkgdG8gYmUgY2xvbmVkIHRvXG4gKiAgICBhIHBhcnRpY3VsYXIgZGVwdGguIChvcHRpb25hbCAtIGRlZmF1bHRzIHRvIEluZmluaXR5KVxuICogQHBhcmFtIGBwcm90b3R5cGVgIC0gc2V0cyB0aGUgcHJvdG90eXBlIHRvIGJlIHVzZWQgd2hlbiBjbG9uaW5nIGFuIG9iamVjdC5cbiAqICAgIChvcHRpb25hbCAtIGRlZmF1bHRzIHRvIHBhcmVudCBwcm90b3R5cGUpLlxuKi9cblxuZnVuY3Rpb24gY2xvbmUocGFyZW50LCBjaXJjdWxhciwgZGVwdGgsIHByb3RvdHlwZSkge1xuICAvLyBtYWludGFpbiB0d28gYXJyYXlzIGZvciBjaXJjdWxhciByZWZlcmVuY2VzLCB3aGVyZSBjb3JyZXNwb25kaW5nIHBhcmVudHNcbiAgLy8gYW5kIGNoaWxkcmVuIGhhdmUgdGhlIHNhbWUgaW5kZXhcbiAgdmFyIGFsbFBhcmVudHMgPSBbXTtcbiAgdmFyIGFsbENoaWxkcmVuID0gW107XG5cbiAgdmFyIHVzZUJ1ZmZlciA9IHR5cGVvZiBCdWZmZXIgIT0gJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKHR5cGVvZiBjaXJjdWxhciA9PSAndW5kZWZpbmVkJylcbiAgICBjaXJjdWxhciA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBkZXB0aCA9PSAndW5kZWZpbmVkJylcbiAgICBkZXB0aCA9IEluZmluaXR5O1xuXG4gIC8vIHJlY3Vyc2UgdGhpcyBmdW5jdGlvbiBzbyB3ZSBkb24ndCByZXNldCBhbGxQYXJlbnRzIGFuZCBhbGxDaGlsZHJlblxuICBmdW5jdGlvbiBfY2xvbmUocGFyZW50LCBkZXB0aCkge1xuICAgIC8vIGNsb25pbmcgbnVsbCBhbHdheXMgcmV0dXJucyBudWxsXG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGRlcHRoID09IDApXG4gICAgICByZXR1cm4gcGFyZW50O1xuXG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBwcm90bztcbiAgICBpZiAodHlwZW9mIHBhcmVudCAhPSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICB9XG5cbiAgICBpZiAodXRpbC5pc0FycmF5KHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gW107XG4gICAgfSBlbHNlIGlmICh1dGlsLmlzUmVnRXhwKHBhcmVudCkpIHtcbiAgICAgIGNoaWxkID0gbmV3IFJlZ0V4cChwYXJlbnQuc291cmNlLCB1dGlsLmdldFJlZ0V4cEZsYWdzKHBhcmVudCkpO1xuICAgICAgaWYgKHBhcmVudC5sYXN0SW5kZXgpIGNoaWxkLmxhc3RJbmRleCA9IHBhcmVudC5sYXN0SW5kZXg7XG4gICAgfSBlbHNlIGlmICh1dGlsLmlzRGF0ZShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBEYXRlKHBhcmVudC5nZXRUaW1lKCkpO1xuICAgIH0gZWxzZSBpZiAodXNlQnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbihwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIpIiwidmFyIHBTbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbnZhciBvYmplY3RLZXlzID0gcmVxdWlyZSgnLi9saWIva2V5cy5qcycpO1xudmFyIGlzQXJndW1lbnRzID0gcmVxdWlyZSgnLi9saWIvaXNfYXJndW1lbnRzLmpzJyk7XG5cbnZhciBkZWVwRXF1YWwgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhY3R1YWwsIGV4cGVjdGVkLCBvcHRzKSB7XG4gIGlmICghb3B0cykgb3B0cyA9IHt9O1xuICAvLyA3LjEuIEFsbCBpZGVudGljYWwgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBhcyBkZXRlcm1pbmVkIGJ5ID09PS5cbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2UgaWYgKGFjdHVhbCBpbnN0YW5jZW9mIERhdGUgJiYgZXhwZWN0ZWQgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgcmV0dXJuIGFjdHVhbC5nZXRUaW1lKCkgPT09IGV4cGVjdGVkLmdldFRpbWUoKTtcblxuICAvLyA3LjMuIE90aGVyIHBhaXJzIHRoYXQgZG8gbm90IGJvdGggcGFzcyB0eXBlb2YgdmFsdWUgPT0gJ29iamVjdCcsXG4gIC8vIGVxdWl2YWxlbmNlIGlzIGRldGVybWluZWQgYnkgPT0uXG4gIH0gZWxzZSBpZiAodHlwZW9mIGFjdHVhbCAhPSAnb2JqZWN0JyAmJiB0eXBlb2YgZXhwZWN0ZWQgIT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gb3B0cy5zdHJpY3QgPyBhY3R1YWwgPT09IGV4cGVjdGVkIDogYWN0dWFsID09IGV4cGVjdGVkO1xuXG4gIC8vIDcuNC4gRm9yIGFsbCBvdGhlciBPYmplY3QgcGFpcnMsIGluY2x1ZGluZyBBcnJheSBvYmplY3RzLCBlcXVpdmFsZW5jZSBpc1xuICAvLyBkZXRlcm1pbmVkIGJ5IGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoYXMgdmVyaWZpZWRcbiAgLy8gd2l0aCBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwpLCB0aGUgc2FtZSBzZXQgb2Yga2V5c1xuICAvLyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSwgZXF1aXZhbGVudCB2YWx1ZXMgZm9yIGV2ZXJ5XG4gIC8vIGNvcnJlc3BvbmRpbmcga2V5LCBhbmQgYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LiBOb3RlOiB0aGlzXG4gIC8vIGFjY291bnRzIGZvciBib3RoIG5hbWVkIGFuZCBpbmRleGVkIHByb3BlcnRpZXMgb24gQXJyYXlzLlxuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmpFcXVpdihhY3R1YWwsIGV4cGVjdGVkLCBvcHRzKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZE9yTnVsbCh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNCdWZmZXIgKHgpIHtcbiAgaWYgKCF4IHx8IHR5cGVvZiB4ICE9PSAnb2JqZWN0JyB8fCB0eXBlb2YgeC5sZW5ndGggIT09ICdudW1iZXInKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgeC5jb3B5ICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiB4LnNsaWNlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICh4Lmxlbmd0aCA+IDAgJiYgdHlwZW9mIHhbMF0gIT09ICdudW1iZXInKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBvYmpFcXVpdihhLCBiLCBvcHRzKSB7XG4gIHZhciBpLCBrZXk7XG4gIGlmIChpc1VuZGVmaW5lZE9yTnVsbChhKSB8fCBpc1VuZGVmaW5lZE9yTnVsbChiKSlcbiAgICByZXR1cm4gZmFsc2U7XG4gIC8vIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS5cbiAgaWYgKGEucHJvdG90eXBlICE9PSBiLnByb3RvdHlwZSkgcmV0dXJuIGZhbHNlO1xuICAvL35+fkkndmUgbWFuYWdlZCB0byBicmVhayBPYmplY3Qua2V5cyB0aHJvdWdoIHNjcmV3eSBhcmd1bWVudHMgcGFzc2luZy5cbiAgLy8gICBDb252ZXJ0aW5nIHRvIGFycmF5IHNvbHZlcyB0aGUgcHJvYmxlbS5cbiAgaWYgKGlzQXJndW1lbnRzKGEpKSB7XG4gICAgaWYgKCFpc0FyZ3VtZW50cyhiKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBhID0gcFNsaWNlLmNhbGwoYSk7XG4gICAgYiA9IHBTbGljZS5jYWxsKGIpO1xuICAgIHJldHVybiBkZWVwRXF1YWwoYSwgYiwgb3B0cyk7XG4gIH1cbiAgaWYgKGlzQnVmZmVyKGEpKSB7XG4gICAgaWYgKCFpc0J1ZmZlcihiKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgZm9yIChpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhW2ldICE9PSBiW2ldKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRyeSB7XG4gICAgdmFyIGthID0gb2JqZWN0S2V5cyhhKSxcbiAgICAgICAga2IgPSBvYmplY3RLZXlzKGIpO1xuICB9IGNhdGNoIChlKSB7Ly9oYXBwZW5zIHdoZW4gb25lIGlzIGEgc3RyaW5nIGxpdGVyYWwgYW5kIHRoZSBvdGhlciBpc24ndFxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvLyBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGtleXMgaW5jb3Jwb3JhdGVzXG4gIC8vIGhhc093blByb3BlcnR5KVxuICBpZiAoa2EubGVuZ3RoICE9IGtiLmxlbmd0aClcbiAgICByZXR1cm4gZmFsc2U7XG4gIC8vdGhlIHNhbWUgc2V0IG9mIGtleXMgKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksXG4gIGthLnNvcnQoKTtcbiAga2Iuc29ydCgpO1xuICAvL35+fmNoZWFwIGtleSB0ZXN0XG4gIGZvciAoaSA9IGthLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKGthW2ldICE9IGtiW2ldKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8vZXF1aXZhbGVudCB2YWx1ZXMgZm9yIGV2ZXJ5IGNvcnJlc3BvbmRpbmcga2V5LCBhbmRcbiAgLy9+fn5wb3NzaWJseSBleHBlbnNpdmUgZGVlcCB0ZXN0XG4gIGZvciAoaSA9IGthLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAga2V5ID0ga2FbaV07XG4gICAgaWYgKCFkZWVwRXF1YWwoYVtrZXldLCBiW2tleV0sIG9wdHMpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCJ2YXIgc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA9IChmdW5jdGlvbigpe1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZ3VtZW50cylcbn0pKCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHN1cHBvcnRzQXJndW1lbnRzQ2xhc3MgPyBzdXBwb3J0ZWQgOiB1bnN1cHBvcnRlZDtcblxuZXhwb3J0cy5zdXBwb3J0ZWQgPSBzdXBwb3J0ZWQ7XG5mdW5jdGlvbiBzdXBwb3J0ZWQob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn07XG5cbmV4cG9ydHMudW5zdXBwb3J0ZWQgPSB1bnN1cHBvcnRlZDtcbmZ1bmN0aW9uIHVuc3VwcG9ydGVkKG9iamVjdCl7XG4gIHJldHVybiBvYmplY3QgJiZcbiAgICB0eXBlb2Ygb2JqZWN0ID09ICdvYmplY3QnICYmXG4gICAgdHlwZW9mIG9iamVjdC5sZW5ndGggPT0gJ251bWJlcicgJiZcbiAgICBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCAnY2FsbGVlJykgJiZcbiAgICAhT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKG9iamVjdCwgJ2NhbGxlZScpIHx8XG4gICAgZmFsc2U7XG59O1xuIiwiZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gID8gT2JqZWN0LmtleXMgOiBzaGltO1xuXG5leHBvcnRzLnNoaW0gPSBzaGltO1xuZnVuY3Rpb24gc2hpbSAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIGtleXMucHVzaChrZXkpO1xuICByZXR1cm4ga2V5cztcbn1cbiIsInZhciBFbnRpID0gcmVxdWlyZSgnZW50aScpLFxuICAgIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBXaGF0Q2hhbmdlZCA9IHJlcXVpcmUoJ3doYXQtY2hhbmdlZCcpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHByb3BlcnR5KGN1cnJlbnRWYWx1ZSwgdXBkYXRlcil7XG4gICAgdmFyIGJpbmRpbmcsXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBwcmV2aW91cyA9IG5ldyBXaGF0Q2hhbmdlZChjdXJyZW50VmFsdWUsICd2YWx1ZSB0eXBlIHJlZmVyZW5jZSBrZXlzJyk7XG5cbiAgICBmdW5jdGlvbiBwcm9wZXJ0eSh2YWx1ZSl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nICYmIGJpbmRpbmcoKSB8fCBjdXJyZW50VmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZighT2JqZWN0LmtleXMocHJldmlvdXMudXBkYXRlKHZhbHVlKSkubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN1cnJlbnRWYWx1ZSA9IHZhbHVlO1xuICAgICAgICBiaW5kaW5nICYmIGJpbmRpbmcodmFsdWUpO1xuICAgICAgICBwcm9wZXJ0eS5lbWl0KCdjaGFuZ2UnLCB2YWx1ZSk7XG4gICAgICAgIHByb3BlcnR5LnVwZGF0ZSgpO1xuXG4gICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGVtaXR0ZXJLZXkgaW4gRXZlbnRFbWl0dGVyLnByb3RvdHlwZSl7XG4gICAgICAgIHByb3BlcnR5W2VtaXR0ZXJLZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtlbWl0dGVyS2V5XTtcbiAgICB9XG5cbiAgICBwcm9wZXJ0eS5iaW5kaW5nID0gZnVuY3Rpb24obmV3QmluZGluZyl7XG4gICAgICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZyA9IG5ld0JpbmRpbmc7XG4gICAgICAgIGlmKG1vZGVsKXtcbiAgICAgICAgICAgIHByb3BlcnR5LmF0dGFjaChtb2RlbCwgIXByb3BlcnR5Ll9maXJtKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuYXR0YWNoID0gZnVuY3Rpb24ob2JqZWN0LCBsb29zZSl7XG4gICAgICAgIGlmKGxvb3NlICYmIHByb3BlcnR5Ll9maXJtKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9wZXJ0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3BlcnR5Ll9maXJtID0gIWxvb3NlO1xuXG4gICAgICAgIGlmKG9iamVjdCBpbnN0YW5jZW9mIEVudGkpe1xuICAgICAgICAgICAgb2JqZWN0ID0gb2JqZWN0Ll9tb2RlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgICAgICBvYmplY3QgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGJpbmRpbmcpe1xuICAgICAgICAgICAgbW9kZWwgPSBvYmplY3Q7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIHRydWUpO1xuICAgICAgICAgICAgYmluZGluZy5vbignY2hhbmdlJywgcHJvcGVydHkpO1xuICAgICAgICAgICAgcHJvcGVydHkoYmluZGluZygpKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkuZGV0YWNoID0gZnVuY3Rpb24obG9vc2Upe1xuICAgICAgICBpZihsb29zZSAmJiBjb21wb25lbnQuX2Zpcm0pe1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwcm9wZXJ0eSk7XG4gICAgICAgICAgICBiaW5kaW5nLmRldGFjaCh0cnVlKTtcbiAgICAgICAgICAgIG1vZGVsID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICAgICAgcmV0dXJuIHByb3BlcnR5O1xuICAgIH07XG4gICAgcHJvcGVydHkudXBkYXRlID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcHJvcGVydHkuZW1pdCgndXBkYXRlJywgY3VycmVudFZhbHVlKTtcbiAgICB9O1xuICAgIHByb3BlcnR5Ll9mYXN0bl9wcm9wZXJ0eSA9IHRydWU7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59OyIsInZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgZmxhdE1lcmdlID0gcmVxdWlyZSgnZmxhdC1tZXJnZScpLFxuICAgIGRlZXBFcXVhbCA9IHJlcXVpcmUoJ2RlZXAtZXF1YWwnKSxcbiAgICBXTSA9IHJlcXVpcmUoJy4vd2Vha21hcCcpLFxuICAgIGFycmF5UHJvdG8gPSBbXSxcbiAgICByb290S2V5ID0gJyQnO1xuXG52YXIgYXR0YWNoZWRFbnRpZXMgPSBuZXcgV00oKTtcblxuZnVuY3Rpb24gZW1pdChtb2RlbCwga2V5LCB2YWx1ZSwgb3JpZ2luYWwpe1xuICAgIHZhciByZWZlcmVuY2VzID0gYXR0YWNoZWRFbnRpZXMuZ2V0KG1vZGVsKTtcblxuICAgIGlmKCFyZWZlcmVuY2VzIHx8ICFyZWZlcmVuY2VzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgcmVmZXJlbmNlcy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlZmVyZW5jZXNbaV0uZW1pdChrZXksIHZhbHVlLCBvcmlnaW5hbCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBFbnRpKG1vZGVsKXtcbiAgICBpZighbW9kZWwgfHwgKHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZGVsICE9PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIG1vZGVsID0ge307XG4gICAgfVxuICAgICAgICBcbiAgICB0aGlzLmF0dGFjaChtb2RlbCk7XG59XG5FbnRpLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5FbnRpLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEVudGk7XG5FbnRpLnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihtb2RlbCl7XG4gICAgdGhpcy5kZXRhY2goKTtcblxuICAgIHZhciByZWZlcmVuY2VzID0gYXR0YWNoZWRFbnRpZXMuZ2V0KG1vZGVsKTtcblxuICAgIGlmKCFyZWZlcmVuY2VzKXtcbiAgICAgICAgcmVmZXJlbmNlcyA9IFtdO1xuICAgICAgICBhdHRhY2hlZEVudGllcy5zZXQobW9kZWwsIHJlZmVyZW5jZXMpO1xuICAgIH1cblxuICAgIHJlZmVyZW5jZXMucHVzaCh0aGlzKTtcblxuICAgIHRoaXMuX21vZGVsID0gbW9kZWw7XG59O1xuRW50aS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKXtcbiAgICBpZighdGhpcy5fbW9kZWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciByZWZlcmVuY2VzID0gYXR0YWNoZWRFbnRpZXMuZ2V0KHRoaXMuX21vZGVsKTtcblxuICAgIGlmKCFyZWZlcmVuY2VzKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJlZmVyZW5jZXMuc3BsaWNlKHJlZmVyZW5jZXMuaW5kZXhPZih0aGlzLl9tb2RlbCksMSk7XG59O1xuRW50aS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICBpZihrZXkgPT09ICcuJyl7XG4gICAgICAgIHJldHVybiB0aGlzLl9tb2RlbDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX21vZGVsW2tleV07XG59O1xuXG5FbnRpLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICB2YXIgb3JpZ2luYWwgPSB0aGlzLl9tb2RlbFtrZXldO1xuXG4gICAgaWYodmFsdWUgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fbW9kZWxba2V5XSA9IHZhbHVlO1xuXG4gICAgZW1pdCh0aGlzLl9tb2RlbCwga2V5LCB2YWx1ZSwgb3JpZ2luYWwpO1xuICAgIGVtaXQodGhpcy5fbW9kZWwsICcuJywgdGhpcy5fbW9kZWwpO1xufTtcblxuRW50aS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHZhciB0YXJnZXQ7XG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDIpe1xuICAgICAgICB2YWx1ZSA9IGtleTtcbiAgICAgICAgdGFyZ2V0ID0gdGhpcy5fbW9kZWw7XG4gICAgfWVsc2V7XG4gICAgICAgIHRhcmdldCA9IHRoaXMuX21vZGVsW2tleV07XG4gICAgfVxuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHRocm93IFwiVGhlIHRhcmdldCBpcyBub3QgYW4gYXJyYXkuXCI7XG4gICAgfVxuXG4gICAgdGFyZ2V0LnB1c2godmFsdWUpO1xuXG4gICAgZW1pdCh0YXJnZXQsIHRhcmdldC5sZW5ndGgtMSwgdmFsdWUpO1xuICAgIGVtaXQodGFyZ2V0LCAnLicsIHRhcmdldCk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVudGk7XG4iLCJ2YXIgcFNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xudmFyIG9iamVjdEtleXMgPSByZXF1aXJlKCcuL2xpYi9rZXlzLmpzJyk7XG52YXIgaXNBcmd1bWVudHMgPSByZXF1aXJlKCcuL2xpYi9pc19hcmd1bWVudHMuanMnKTtcblxudmFyIGRlZXBFcXVhbCA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpIHtcbiAgaWYgKCFvcHRzKSBvcHRzID0ge307XG4gIC8vIDcuMS4gQWxsIGlkZW50aWNhbCB2YWx1ZXMgYXJlIGVxdWl2YWxlbnQsIGFzIGRldGVybWluZWQgYnkgPT09LlxuICBpZiAoYWN0dWFsID09PSBleHBlY3RlZCkge1xuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSBpZiAoYWN0dWFsIGluc3RhbmNlb2YgRGF0ZSAmJiBleHBlY3RlZCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICByZXR1cm4gYWN0dWFsLmdldFRpbWUoKSA9PT0gZXhwZWN0ZWQuZ2V0VGltZSgpO1xuXG4gIC8vIDcuMy4gT3RoZXIgcGFpcnMgdGhhdCBkbyBub3QgYm90aCBwYXNzIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0JyxcbiAgLy8gZXF1aXZhbGVuY2UgaXMgZGV0ZXJtaW5lZCBieSA9PS5cbiAgfSBlbHNlIGlmICh0eXBlb2YgYWN0dWFsICE9ICdvYmplY3QnICYmIHR5cGVvZiBleHBlY3RlZCAhPSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBvcHRzLnN0cmljdCA/IGFjdHVhbCA9PT0gZXhwZWN0ZWQgOiBhY3R1YWwgPT0gZXhwZWN0ZWQ7XG5cbiAgLy8gNy40LiBGb3IgYWxsIG90aGVyIE9iamVjdCBwYWlycywgaW5jbHVkaW5nIEFycmF5IG9iamVjdHMsIGVxdWl2YWxlbmNlIGlzXG4gIC8vIGRldGVybWluZWQgYnkgaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChhcyB2ZXJpZmllZFxuICAvLyB3aXRoIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCksIHRoZSBzYW1lIHNldCBvZiBrZXlzXG4gIC8vIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLCBlcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnlcbiAgLy8gY29ycmVzcG9uZGluZyBrZXksIGFuZCBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuIE5vdGU6IHRoaXNcbiAgLy8gYWNjb3VudHMgZm9yIGJvdGggbmFtZWQgYW5kIGluZGV4ZWQgcHJvcGVydGllcyBvbiBBcnJheXMuXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG9iakVxdWl2KGFjdHVhbCwgZXhwZWN0ZWQsIG9wdHMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkT3JOdWxsKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0J1ZmZlciAoeCkge1xuICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnIHx8IHR5cGVvZiB4Lmxlbmd0aCAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiB4LmNvcHkgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHguc2xpY2UgIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHgubGVuZ3RoID4gMCAmJiB0eXBlb2YgeFswXSAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIG9iakVxdWl2KGEsIGIsIG9wdHMpIHtcbiAgdmFyIGksIGtleTtcbiAgaWYgKGlzVW5kZWZpbmVkT3JOdWxsKGEpIHx8IGlzVW5kZWZpbmVkT3JOdWxsKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIGRlZXBFcXVhbChhLCBiLCBvcHRzKTtcbiAgfVxuICBpZiAoaXNCdWZmZXIoYSkpIHtcbiAgICBpZiAoIWlzQnVmZmVyKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFbaV0gIT09IGJbaV0pIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYik7XG4gIH0gY2F0Y2ggKGUpIHsvL2hhcHBlbnMgd2hlbiBvbmUgaXMgYSBzdHJpbmcgbGl0ZXJhbCBhbmQgdGhlIG90aGVyIGlzbid0XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8vIGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoa2V5cyBpbmNvcnBvcmF0ZXNcbiAgLy8gaGFzT3duUHJvcGVydHkpXG4gIGlmIChrYS5sZW5ndGggIT0ga2IubGVuZ3RoKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy90aGUgc2FtZSBzZXQgb2Yga2V5cyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSxcbiAga2Euc29ydCgpO1xuICBrYi5zb3J0KCk7XG4gIC8vfn5+Y2hlYXAga2V5IHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBpZiAoa2FbaV0gIT0ga2JbaV0pXG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy9lcXVpdmFsZW50IHZhbHVlcyBmb3IgZXZlcnkgY29ycmVzcG9uZGluZyBrZXksIGFuZFxuICAvL35+fnBvc3NpYmx5IGV4cGVuc2l2ZSBkZWVwIHRlc3RcbiAgZm9yIChpID0ga2EubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBrZXkgPSBrYVtpXTtcbiAgICBpZiAoIWRlZXBFcXVhbChhW2tleV0sIGJba2V5XSwgb3B0cykpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cbiIsInZhciBzdXBwb3J0c0FyZ3VtZW50c0NsYXNzID0gKGZ1bmN0aW9uKCl7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYXJndW1lbnRzKVxufSkoKSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gc3VwcG9ydHNBcmd1bWVudHNDbGFzcyA/IHN1cHBvcnRlZCA6IHVuc3VwcG9ydGVkO1xuXG5leHBvcnRzLnN1cHBvcnRlZCA9IHN1cHBvcnRlZDtcbmZ1bmN0aW9uIHN1cHBvcnRlZChvYmplY3QpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmplY3QpID09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xufTtcblxuZXhwb3J0cy51bnN1cHBvcnRlZCA9IHVuc3VwcG9ydGVkO1xuZnVuY3Rpb24gdW5zdXBwb3J0ZWQob2JqZWN0KXtcbiAgcmV0dXJuIG9iamVjdCAmJlxuICAgIHR5cGVvZiBvYmplY3QgPT0gJ29iamVjdCcgJiZcbiAgICB0eXBlb2Ygb2JqZWN0Lmxlbmd0aCA9PSAnbnVtYmVyJyAmJlxuICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3QsICdjYWxsZWUnKSAmJlxuICAgICFPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlLmNhbGwob2JqZWN0LCAnY2FsbGVlJykgfHxcbiAgICBmYWxzZTtcbn07XG4iLCJleHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSB0eXBlb2YgT2JqZWN0LmtleXMgPT09ICdmdW5jdGlvbidcbiAgPyBPYmplY3Qua2V5cyA6IHNoaW07XG5cbmV4cG9ydHMuc2hpbSA9IHNoaW07XG5mdW5jdGlvbiBzaGltIChvYmopIHtcbiAgdmFyIGtleXMgPSBbXTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikga2V5cy5wdXNoKGtleSk7XG4gIHJldHVybiBrZXlzO1xufVxuIiwiZnVuY3Rpb24gZmxhdE1lcmdlKGEsYil7XG4gICAgaWYoIWIgfHwgdHlwZW9mIGIgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYiA9IHt9O1xuICAgIH1cblxuICAgIGlmKCFhIHx8IHR5cGVvZiBhICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGEgPSBuZXcgYi5jb25zdHJ1Y3RvcigpO1xuICAgIH1cblxuICAgIHZhciByZXN1bHQgPSBuZXcgYS5jb25zdHJ1Y3RvcigpLFxuICAgICAgICBhS2V5cyA9IE9iamVjdC5rZXlzKGEpLFxuICAgICAgICBiS2V5cyA9IE9iamVjdC5rZXlzKGIpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGFLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2FLZXlzW2ldXSA9IGFbYUtleXNbaV1dO1xuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBiS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFtiS2V5c1tpXV0gPSBiW2JLZXlzW2ldXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZsYXRNZXJnZTsiLCJmdW5jdGlvbiB2YWxpZGF0ZUtleShrZXkpe1xuICAgIGlmKCFrZXkgfHwgISh0eXBlb2Yga2V5ID09PSAnb2JqZWN0JyB8fCB0eXBlb2Yga2V5ID09PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIHRocm93IGtleSArIFwiIGlzIG5vdCBhIHZhbGlkIFdlYWtNYXAga2V5LlwiO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gTGVha01hcCgpe1xuICAgIHRoaXMuY2xlYXIoKTtcbn1cbkxlYWtNYXAucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKXtcbiAgICB0aGlzLl9rZXlzID0gW107XG4gICAgdGhpcy5fdmFsdWVzID0gW107XG59O1xuTGVha01hcC5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YWxpZGF0ZUtleShrZXkpO1xuICAgIHZhciBrZXlJbmRleCA9IHRoaXMuX2tleXMuaW5kZXhPZihrZXkpO1xuICAgIGlmKGtleUluZGV4Pj0wKXtcbiAgICAgICAgdGhpcy5fa2V5cy5zcGxpY2Uoa2V5SW5kZXgsIDEpO1xuICAgICAgICB0aGlzLl92YWx1ZXMuc3BsaWNlKGtleUluZGV4LCAxKTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFsaWRhdGVLZXkoa2V5KTtcbiAgICByZXR1cm4gdGhpcy5fdmFsdWVzW3RoaXMuX2tleXMuaW5kZXhPZihrZXkpXTtcbn07XG5MZWFrTWFwLnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbihrZXkpe1xuICAgIHZhbGlkYXRlS2V5KGtleSk7XG4gICAgcmV0dXJuICEhfnRoaXMuX2tleXMuaW5kZXhPZihrZXkpO1xufTtcbkxlYWtNYXAucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xuICAgIHZhbGlkYXRlS2V5KGtleSk7XG5cbiAgICAvLyBGYXZvcml0ZSBwaWVjZSBvZiBrb2VkIGV2b3IuXG4gICAgLy8gSUUgZGV2cyB3b3VsZCBiZSBwcm93ZGVcbiAgICB2YXIga2V5SW5kZXggPSAofnRoaXMuX2tleXMuaW5kZXhPZihrZXkpIHx8ICh0aGlzLl9rZXlzLnB1c2goa2V5KSwgdGhpcy5fa2V5cy5sZW5ndGgpKSAtIDE7XG5cbiAgICB0aGlzLl92YWx1ZXNba2V5SW5kZXhdID0gdmFsdWU7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuTGVha01hcC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiAnW29iamVjdCBXZWFrTWFwXSc7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IExlYWtNYXA7IiwiLy8gQ29weXJpZ2h0IChDKSAyMDExIEdvb2dsZSBJbmMuXG4vL1xuLy8gTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbi8vIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbi8vIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuLy9cbi8vIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuLy9cbi8vIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbi8vIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbi8vIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuLy8gU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuLy8gbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG5cbi8qKlxuICogQGZpbGVvdmVydmlldyBJbnN0YWxsIGEgbGVha3kgV2Vha01hcCBlbXVsYXRpb24gb24gcGxhdGZvcm1zIHRoYXRcbiAqIGRvbid0IHByb3ZpZGUgYSBidWlsdC1pbiBvbmUuXG4gKlxuICogPHA+QXNzdW1lcyB0aGF0IGFuIEVTNSBwbGF0Zm9ybSB3aGVyZSwgaWYge0Bjb2RlIFdlYWtNYXB9IGlzXG4gKiBhbHJlYWR5IHByZXNlbnQsIHRoZW4gaXQgY29uZm9ybXMgdG8gdGhlIGFudGljaXBhdGVkIEVTNlxuICogc3BlY2lmaWNhdGlvbi4gVG8gcnVuIHRoaXMgZmlsZSBvbiBhbiBFUzUgb3IgYWxtb3N0IEVTNVxuICogaW1wbGVtZW50YXRpb24gd2hlcmUgdGhlIHtAY29kZSBXZWFrTWFwfSBzcGVjaWZpY2F0aW9uIGRvZXMgbm90XG4gKiBxdWl0ZSBjb25mb3JtLCBydW4gPGNvZGU+cmVwYWlyRVM1LmpzPC9jb2RlPiBmaXJzdC5cbiAqXG4gKiA8cD5FdmVuIHRob3VnaCBXZWFrTWFwTW9kdWxlIGlzIG5vdCBnbG9iYWwsIHRoZSBsaW50ZXIgdGhpbmtzIGl0XG4gKiBpcywgd2hpY2ggaXMgd2h5IGl0IGlzIGluIHRoZSBvdmVycmlkZXMgbGlzdCBiZWxvdy5cbiAqXG4gKiA8cD5OT1RFOiBCZWZvcmUgdXNpbmcgdGhpcyBXZWFrTWFwIGVtdWxhdGlvbiBpbiBhIG5vbi1TRVNcbiAqIGVudmlyb25tZW50LCBzZWUgdGhlIG5vdGUgYmVsb3cgYWJvdXQgaGlkZGVuUmVjb3JkLlxuICpcbiAqIEBhdXRob3IgTWFyayBTLiBNaWxsZXJcbiAqIEByZXF1aXJlcyBjcnlwdG8sIEFycmF5QnVmZmVyLCBVaW50OEFycmF5LCBuYXZpZ2F0b3IsIGNvbnNvbGVcbiAqIEBvdmVycmlkZXMgV2Vha01hcCwgc2VzLCBQcm94eVxuICogQG92ZXJyaWRlcyBXZWFrTWFwTW9kdWxlXG4gKi9cblxuLyoqXG4gKiBUaGlzIHtAY29kZSBXZWFrTWFwfSBlbXVsYXRpb24gaXMgb2JzZXJ2YWJseSBlcXVpdmFsZW50IHRvIHRoZVxuICogRVMtSGFybW9ueSBXZWFrTWFwLCBidXQgd2l0aCBsZWFraWVyIGdhcmJhZ2UgY29sbGVjdGlvbiBwcm9wZXJ0aWVzLlxuICpcbiAqIDxwPkFzIHdpdGggdHJ1ZSBXZWFrTWFwcywgaW4gdGhpcyBlbXVsYXRpb24sIGEga2V5IGRvZXMgbm90XG4gKiByZXRhaW4gbWFwcyBpbmRleGVkIGJ5IHRoYXQga2V5IGFuZCAoY3J1Y2lhbGx5KSBhIG1hcCBkb2VzIG5vdFxuICogcmV0YWluIHRoZSBrZXlzIGl0IGluZGV4ZXMuIEEgbWFwIGJ5IGl0c2VsZiBhbHNvIGRvZXMgbm90IHJldGFpblxuICogdGhlIHZhbHVlcyBhc3NvY2lhdGVkIHdpdGggdGhhdCBtYXAuXG4gKlxuICogPHA+SG93ZXZlciwgdGhlIHZhbHVlcyBhc3NvY2lhdGVkIHdpdGggYSBrZXkgaW4gc29tZSBtYXAgYXJlXG4gKiByZXRhaW5lZCBzbyBsb25nIGFzIHRoYXQga2V5IGlzIHJldGFpbmVkIGFuZCB0aG9zZSBhc3NvY2lhdGlvbnMgYXJlXG4gKiBub3Qgb3ZlcnJpZGRlbi4gRm9yIGV4YW1wbGUsIHdoZW4gdXNlZCB0byBzdXBwb3J0IG1lbWJyYW5lcywgYWxsXG4gKiB2YWx1ZXMgZXhwb3J0ZWQgZnJvbSBhIGdpdmVuIG1lbWJyYW5lIHdpbGwgbGl2ZSBmb3IgdGhlIGxpZmV0aW1lXG4gKiB0aGV5IHdvdWxkIGhhdmUgaGFkIGluIHRoZSBhYnNlbmNlIG9mIGFuIGludGVycG9zZWQgbWVtYnJhbmUuIEV2ZW5cbiAqIHdoZW4gdGhlIG1lbWJyYW5lIGlzIHJldm9rZWQsIGFsbCBvYmplY3RzIHRoYXQgd291bGQgaGF2ZSBiZWVuXG4gKiByZWFjaGFibGUgaW4gdGhlIGFic2VuY2Ugb2YgcmV2b2NhdGlvbiB3aWxsIHN0aWxsIGJlIHJlYWNoYWJsZSwgYXNcbiAqIGZhciBhcyB0aGUgR0MgY2FuIHRlbGwsIGV2ZW4gdGhvdWdoIHRoZXkgd2lsbCBubyBsb25nZXIgYmUgcmVsZXZhbnRcbiAqIHRvIG9uZ29pbmcgY29tcHV0YXRpb24uXG4gKlxuICogPHA+VGhlIEFQSSBpbXBsZW1lbnRlZCBoZXJlIGlzIGFwcHJveGltYXRlbHkgdGhlIEFQSSBhcyBpbXBsZW1lbnRlZFxuICogaW4gRkY2LjBhMSBhbmQgYWdyZWVkIHRvIGJ5IE1hcmtNLCBBbmRyZWFzIEdhbCwgYW5kIERhdmUgSGVybWFuLFxuICogcmF0aGVyIHRoYW4gdGhlIG9mZmlhbGx5IGFwcHJvdmVkIHByb3Bvc2FsIHBhZ2UuIFRPRE8oZXJpZ2h0cyk6XG4gKiB1cGdyYWRlIHRoZSBlY21hc2NyaXB0IFdlYWtNYXAgcHJvcG9zYWwgcGFnZSB0byBleHBsYWluIHRoaXMgQVBJXG4gKiBjaGFuZ2UgYW5kIHByZXNlbnQgdG8gRWNtYVNjcmlwdCBjb21taXR0ZWUgZm9yIHRoZWlyIGFwcHJvdmFsLlxuICpcbiAqIDxwPlRoZSBmaXJzdCBkaWZmZXJlbmNlIGJldHdlZW4gdGhlIGVtdWxhdGlvbiBoZXJlIGFuZCB0aGF0IGluXG4gKiBGRjYuMGExIGlzIHRoZSBwcmVzZW5jZSBvZiBub24gZW51bWVyYWJsZSB7QGNvZGUgZ2V0X19fLCBoYXNfX18sXG4gKiBzZXRfX18sIGFuZCBkZWxldGVfX199IG1ldGhvZHMgb24gV2Vha01hcCBpbnN0YW5jZXMgdG8gcmVwcmVzZW50XG4gKiB3aGF0IHdvdWxkIGJlIHRoZSBoaWRkZW4gaW50ZXJuYWwgcHJvcGVydGllcyBvZiBhIHByaW1pdGl2ZVxuICogaW1wbGVtZW50YXRpb24uIFdoZXJlYXMgdGhlIEZGNi4wYTEgV2Vha01hcC5wcm90b3R5cGUgbWV0aG9kc1xuICogcmVxdWlyZSB0aGVpciB7QGNvZGUgdGhpc30gdG8gYmUgYSBnZW51aW5lIFdlYWtNYXAgaW5zdGFuY2UgKGkuZS4sXG4gKiBhbiBvYmplY3Qgb2Yge0Bjb2RlIFtbQ2xhc3NdXX0gXCJXZWFrTWFwfSksIHNpbmNlIHRoZXJlIGlzIG5vdGhpbmdcbiAqIHVuZm9yZ2VhYmxlIGFib3V0IHRoZSBwc2V1ZG8taW50ZXJuYWwgbWV0aG9kIG5hbWVzIHVzZWQgaGVyZSxcbiAqIG5vdGhpbmcgcHJldmVudHMgdGhlc2UgZW11bGF0ZWQgcHJvdG90eXBlIG1ldGhvZHMgZnJvbSBiZWluZ1xuICogYXBwbGllZCB0byBub24tV2Vha01hcHMgd2l0aCBwc2V1ZG8taW50ZXJuYWwgbWV0aG9kcyBvZiB0aGUgc2FtZVxuICogbmFtZXMuXG4gKlxuICogPHA+QW5vdGhlciBkaWZmZXJlbmNlIGlzIHRoYXQgb3VyIGVtdWxhdGVkIHtAY29kZVxuICogV2Vha01hcC5wcm90b3R5cGV9IGlzIG5vdCBpdHNlbGYgYSBXZWFrTWFwLiBBIHByb2JsZW0gd2l0aCB0aGVcbiAqIGN1cnJlbnQgRkY2LjBhMSBBUEkgaXMgdGhhdCBXZWFrTWFwLnByb3RvdHlwZSBpcyBpdHNlbGYgYSBXZWFrTWFwXG4gKiBwcm92aWRpbmcgYW1iaWVudCBtdXRhYmlsaXR5IGFuZCBhbiBhbWJpZW50IGNvbW11bmljYXRpb25zXG4gKiBjaGFubmVsLiBUaHVzLCBpZiBhIFdlYWtNYXAgaXMgYWxyZWFkeSBwcmVzZW50IGFuZCBoYXMgdGhpc1xuICogcHJvYmxlbSwgcmVwYWlyRVM1LmpzIHdyYXBzIGl0IGluIGEgc2FmZSB3cmFwcHBlciBpbiBvcmRlciB0b1xuICogcHJldmVudCBhY2Nlc3MgdG8gdGhpcyBjaGFubmVsLiAoU2VlXG4gKiBQQVRDSF9NVVRBQkxFX0ZST1pFTl9XRUFLTUFQX1BST1RPIGluIHJlcGFpckVTNS5qcykuXG4gKi9cblxuLyoqXG4gKiBJZiB0aGlzIGlzIGEgZnVsbCA8YSBocmVmPVxuICogXCJodHRwOi8vY29kZS5nb29nbGUuY29tL3AvZXMtbGFiL3dpa2kvU2VjdXJlYWJsZUVTNVwiXG4gKiA+c2VjdXJlYWJsZSBFUzU8L2E+IHBsYXRmb3JtIGFuZCB0aGUgRVMtSGFybW9ueSB7QGNvZGUgV2Vha01hcH0gaXNcbiAqIGFic2VudCwgaW5zdGFsbCBhbiBhcHByb3hpbWF0ZSBlbXVsYXRpb24uXG4gKlxuICogPHA+SWYgV2Vha01hcCBpcyBwcmVzZW50IGJ1dCBjYW5ub3Qgc3RvcmUgc29tZSBvYmplY3RzLCB1c2Ugb3VyIGFwcHJveGltYXRlXG4gKiBlbXVsYXRpb24gYXMgYSB3cmFwcGVyLlxuICpcbiAqIDxwPklmIHRoaXMgaXMgYWxtb3N0IGEgc2VjdXJlYWJsZSBFUzUgcGxhdGZvcm0sIHRoZW4gV2Vha01hcC5qc1xuICogc2hvdWxkIGJlIHJ1biBhZnRlciByZXBhaXJFUzUuanMuXG4gKlxuICogPHA+U2VlIHtAY29kZSBXZWFrTWFwfSBmb3IgZG9jdW1lbnRhdGlvbiBvZiB0aGUgZ2FyYmFnZSBjb2xsZWN0aW9uXG4gKiBwcm9wZXJ0aWVzIG9mIHRoaXMgV2Vha01hcCBlbXVsYXRpb24uXG4gKi9cbihmdW5jdGlvbiBXZWFrTWFwTW9kdWxlKCkge1xuICBcInVzZSBzdHJpY3RcIjtcblxuICBpZiAodHlwZW9mIHNlcyAhPT0gJ3VuZGVmaW5lZCcgJiYgc2VzLm9rICYmICFzZXMub2soKSkge1xuICAgIC8vIGFscmVhZHkgdG9vIGJyb2tlbiwgc28gZ2l2ZSB1cFxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbiBzb21lIGNhc2VzIChjdXJyZW50IEZpcmVmb3gpLCB3ZSBtdXN0IG1ha2UgYSBjaG9pY2UgYmV0d2VlZW4gYVxuICAgKiBXZWFrTWFwIHdoaWNoIGlzIGNhcGFibGUgb2YgdXNpbmcgYWxsIHZhcmlldGllcyBvZiBob3N0IG9iamVjdHMgYXNcbiAgICoga2V5cyBhbmQgb25lIHdoaWNoIGlzIGNhcGFibGUgb2Ygc2FmZWx5IHVzaW5nIHByb3hpZXMgYXMga2V5cy4gU2VlXG4gICAqIGNvbW1lbnRzIGJlbG93IGFib3V0IEhvc3RXZWFrTWFwIGFuZCBEb3VibGVXZWFrTWFwIGZvciBkZXRhaWxzLlxuICAgKlxuICAgKiBUaGlzIGZ1bmN0aW9uICh3aGljaCBpcyBhIGdsb2JhbCwgbm90IGV4cG9zZWQgdG8gZ3Vlc3RzKSBtYXJrcyBhXG4gICAqIFdlYWtNYXAgYXMgcGVybWl0dGVkIHRvIGRvIHdoYXQgaXMgbmVjZXNzYXJ5IHRvIGluZGV4IGFsbCBob3N0XG4gICAqIG9iamVjdHMsIGF0IHRoZSBjb3N0IG9mIG1ha2luZyBpdCB1bnNhZmUgZm9yIHByb3hpZXMuXG4gICAqXG4gICAqIERvIG5vdCBhcHBseSB0aGlzIGZ1bmN0aW9uIHRvIGFueXRoaW5nIHdoaWNoIGlzIG5vdCBhIGdlbnVpbmVcbiAgICogZnJlc2ggV2Vha01hcC5cbiAgICovXG4gIGZ1bmN0aW9uIHdlYWtNYXBQZXJtaXRIb3N0T2JqZWN0cyhtYXApIHtcbiAgICAvLyBpZGVudGl0eSBvZiBmdW5jdGlvbiB1c2VkIGFzIGEgc2VjcmV0IC0tIGdvb2QgZW5vdWdoIGFuZCBjaGVhcFxuICAgIGlmIChtYXAucGVybWl0SG9zdE9iamVjdHNfX18pIHtcbiAgICAgIG1hcC5wZXJtaXRIb3N0T2JqZWN0c19fXyh3ZWFrTWFwUGVybWl0SG9zdE9iamVjdHMpO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHNlcyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBzZXMud2Vha01hcFBlcm1pdEhvc3RPYmplY3RzID0gd2Vha01hcFBlcm1pdEhvc3RPYmplY3RzO1xuICB9XG5cbiAgLy8gSUUgMTEgaGFzIG5vIFByb3h5IGJ1dCBoYXMgYSBicm9rZW4gV2Vha01hcCBzdWNoIHRoYXQgd2UgbmVlZCB0byBwYXRjaFxuICAvLyBpdCB1c2luZyBEb3VibGVXZWFrTWFwOyB0aGlzIGZsYWcgdGVsbHMgRG91YmxlV2Vha01hcCBzby5cbiAgdmFyIGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUgPSBmYWxzZTtcblxuICAvLyBDaGVjayBpZiB0aGVyZSBpcyBhbHJlYWR5IGEgZ29vZC1lbm91Z2ggV2Vha01hcCBpbXBsZW1lbnRhdGlvbiwgYW5kIGlmIHNvXG4gIC8vIGV4aXQgd2l0aG91dCByZXBsYWNpbmcgaXQuXG4gIGlmICh0eXBlb2YgV2Vha01hcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHZhciBIb3N0V2Vha01hcCA9IFdlYWtNYXA7XG4gICAgLy8gVGhlcmUgaXMgYSBXZWFrTWFwIC0tIGlzIGl0IGdvb2QgZW5vdWdoP1xuICAgIGlmICh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJlxuICAgICAgICAvRmlyZWZveC8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KSkge1xuICAgICAgLy8gV2UncmUgbm93ICphc3N1bWluZyBub3QqLCBiZWNhdXNlIGFzIG9mIHRoaXMgd3JpdGluZyAoMjAxMy0wNS0wNilcbiAgICAgIC8vIEZpcmVmb3gncyBXZWFrTWFwcyBoYXZlIGEgbWlzY2VsbGFueSBvZiBvYmplY3RzIHRoZXkgd29uJ3QgYWNjZXB0LCBhbmRcbiAgICAgIC8vIHdlIGRvbid0IHdhbnQgdG8gbWFrZSBhbiBleGhhdXN0aXZlIGxpc3QsIGFuZCB0ZXN0aW5nIGZvciBqdXN0IG9uZVxuICAgICAgLy8gd2lsbCBiZSBhIHByb2JsZW0gaWYgdGhhdCBvbmUgaXMgZml4ZWQgYWxvbmUgKGFzIHRoZXkgZGlkIGZvciBFdmVudCkuXG5cbiAgICAgIC8vIElmIHRoZXJlIGlzIGEgcGxhdGZvcm0gdGhhdCB3ZSAqY2FuKiByZWxpYWJseSB0ZXN0IG9uLCBoZXJlJ3MgaG93IHRvXG4gICAgICAvLyBkbyBpdDpcbiAgICAgIC8vICB2YXIgcHJvYmxlbWF0aWMgPSAuLi4gO1xuICAgICAgLy8gIHZhciB0ZXN0SG9zdE1hcCA9IG5ldyBIb3N0V2Vha01hcCgpO1xuICAgICAgLy8gIHRyeSB7XG4gICAgICAvLyAgICB0ZXN0SG9zdE1hcC5zZXQocHJvYmxlbWF0aWMsIDEpOyAgLy8gRmlyZWZveCAyMCB3aWxsIHRocm93IGhlcmVcbiAgICAgIC8vICAgIGlmICh0ZXN0SG9zdE1hcC5nZXQocHJvYmxlbWF0aWMpID09PSAxKSB7XG4gICAgICAvLyAgICAgIHJldHVybjtcbiAgICAgIC8vICAgIH1cbiAgICAgIC8vICB9IGNhdGNoIChlKSB7fVxuXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElFIDExIGJ1ZzogV2Vha01hcHMgc2lsZW50bHkgZmFpbCB0byBzdG9yZSBmcm96ZW4gb2JqZWN0cy5cbiAgICAgIHZhciB0ZXN0TWFwID0gbmV3IEhvc3RXZWFrTWFwKCk7XG4gICAgICB2YXIgdGVzdE9iamVjdCA9IE9iamVjdC5mcmVlemUoe30pO1xuICAgICAgdGVzdE1hcC5zZXQodGVzdE9iamVjdCwgMSk7XG4gICAgICBpZiAodGVzdE1hcC5nZXQodGVzdE9iamVjdCkgIT09IDEpIHtcbiAgICAgICAgZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSA9IHRydWU7XG4gICAgICAgIC8vIEZhbGwgdGhyb3VnaCB0byBpbnN0YWxsaW5nIG91ciBXZWFrTWFwLlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbW9kdWxlLmV4cG9ydHMgPSBXZWFrTWFwO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdmFyIGhvcCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG4gIHZhciBnb3BuID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXM7XG4gIHZhciBkZWZQcm9wID0gT2JqZWN0LmRlZmluZVByb3BlcnR5O1xuICB2YXIgaXNFeHRlbnNpYmxlID0gT2JqZWN0LmlzRXh0ZW5zaWJsZTtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZGVwZW5kcyBvbiBISURERU5fTkFNRSBiZWluZyBib3RoIDxpPnVuZ3Vlc3NhYmxlPC9pPiBhbmRcbiAgICogPGk+dW5kaXNjb3ZlcmFibGU8L2k+IGJ5IHVudHJ1c3RlZCBjb2RlLlxuICAgKlxuICAgKiA8cD5HaXZlbiB0aGUga25vd24gd2Vha25lc3NlcyBvZiBNYXRoLnJhbmRvbSgpIG9uIGV4aXN0aW5nXG4gICAqIGJyb3dzZXJzLCBpdCBkb2VzIG5vdCBnZW5lcmF0ZSB1bmd1ZXNzYWJpbGl0eSB3ZSBjYW4gYmUgY29uZmlkZW50XG4gICAqIG9mLlxuICAgKlxuICAgKiA8cD5JdCBpcyB0aGUgbW9ua2V5IHBhdGNoaW5nIGxvZ2ljIGluIHRoaXMgZmlsZSB0aGF0IGlzIGludGVuZGVkXG4gICAqIHRvIGVuc3VyZSB1bmRpc2NvdmVyYWJpbGl0eS4gVGhlIGJhc2ljIGlkZWEgaXMgdGhhdCB0aGVyZSBhcmVcbiAgICogdGhyZWUgZnVuZGFtZW50YWwgbWVhbnMgb2YgZGlzY292ZXJpbmcgcHJvcGVydGllcyBvZiBhbiBvYmplY3Q6XG4gICAqIFRoZSBmb3IvaW4gbG9vcCwgT2JqZWN0LmtleXMoKSwgYW5kIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKCksXG4gICAqIGFzIHdlbGwgYXMgc29tZSBwcm9wb3NlZCBFUzYgZXh0ZW5zaW9ucyB0aGF0IGFwcGVhciBvbiBvdXJcbiAgICogd2hpdGVsaXN0LiBUaGUgZmlyc3QgdHdvIG9ubHkgZGlzY292ZXIgZW51bWVyYWJsZSBwcm9wZXJ0aWVzLCBhbmRcbiAgICogd2Ugb25seSB1c2UgSElEREVOX05BTUUgdG8gbmFtZSBhIG5vbi1lbnVtZXJhYmxlIHByb3BlcnR5LCBzbyB0aGVcbiAgICogb25seSByZW1haW5pbmcgdGhyZWF0IHNob3VsZCBiZSBnZXRPd25Qcm9wZXJ0eU5hbWVzIGFuZCBzb21lXG4gICAqIHByb3Bvc2VkIEVTNiBleHRlbnNpb25zIHRoYXQgYXBwZWFyIG9uIG91ciB3aGl0ZWxpc3QuIFdlIG1vbmtleVxuICAgKiBwYXRjaCB0aGVtIHRvIHJlbW92ZSBISURERU5fTkFNRSBmcm9tIHRoZSBsaXN0IG9mIHByb3BlcnRpZXMgdGhleVxuICAgKiByZXR1cm5zLlxuICAgKlxuICAgKiA8cD5UT0RPKGVyaWdodHMpOiBPbiBhIHBsYXRmb3JtIHdpdGggYnVpbHQtaW4gUHJveGllcywgcHJveGllc1xuICAgKiBjb3VsZCBiZSB1c2VkIHRvIHRyYXAgYW5kIHRoZXJlYnkgZGlzY292ZXIgdGhlIEhJRERFTl9OQU1FLCBzbyB3ZVxuICAgKiBuZWVkIHRvIG1vbmtleSBwYXRjaCBQcm94eS5jcmVhdGUsIFByb3h5LmNyZWF0ZUZ1bmN0aW9uLCBldGMsIGluXG4gICAqIG9yZGVyIHRvIHdyYXAgdGhlIHByb3ZpZGVkIGhhbmRsZXIgd2l0aCB0aGUgcmVhbCBoYW5kbGVyIHdoaWNoXG4gICAqIGZpbHRlcnMgb3V0IGFsbCB0cmFwcyB1c2luZyBISURERU5fTkFNRS5cbiAgICpcbiAgICogPHA+VE9ETyhlcmlnaHRzKTogUmV2aXNpdCBNaWtlIFN0YXkncyBzdWdnZXN0aW9uIHRoYXQgd2UgdXNlIGFuXG4gICAqIGVuY2Fwc3VsYXRlZCBmdW5jdGlvbiBhdCBhIG5vdC1uZWNlc3NhcmlseS1zZWNyZXQgbmFtZSwgd2hpY2hcbiAgICogdXNlcyB0aGUgU3RpZWdsZXIgc2hhcmVkLXN0YXRlIHJpZ2h0cyBhbXBsaWZpY2F0aW9uIHBhdHRlcm4gdG9cbiAgICogcmV2ZWFsIHRoZSBhc3NvY2lhdGVkIHZhbHVlIG9ubHkgdG8gdGhlIFdlYWtNYXAgaW4gd2hpY2ggdGhpcyBrZXlcbiAgICogaXMgYXNzb2NpYXRlZCB3aXRoIHRoYXQgdmFsdWUuIFNpbmNlIG9ubHkgdGhlIGtleSByZXRhaW5zIHRoZVxuICAgKiBmdW5jdGlvbiwgdGhlIGZ1bmN0aW9uIGNhbiBhbHNvIHJlbWVtYmVyIHRoZSBrZXkgd2l0aG91dCBjYXVzaW5nXG4gICAqIGxlYWthZ2Ugb2YgdGhlIGtleSwgc28gdGhpcyBkb2Vzbid0IHZpb2xhdGUgb3VyIGdlbmVyYWwgZ2NcbiAgICogZ29hbHMuIEluIGFkZGl0aW9uLCBiZWNhdXNlIHRoZSBuYW1lIG5lZWQgbm90IGJlIGEgZ3VhcmRlZFxuICAgKiBzZWNyZXQsIHdlIGNvdWxkIGVmZmljaWVudGx5IGhhbmRsZSBjcm9zcy1mcmFtZSBmcm96ZW4ga2V5cy5cbiAgICovXG4gIHZhciBISURERU5fTkFNRV9QUkVGSVggPSAnd2Vha21hcDonO1xuICB2YXIgSElEREVOX05BTUUgPSBISURERU5fTkFNRV9QUkVGSVggKyAnaWRlbnQ6JyArIE1hdGgucmFuZG9tKCkgKyAnX19fJztcblxuICBpZiAodHlwZW9mIGNyeXB0byAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgIHR5cGVvZiBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzID09PSAnZnVuY3Rpb24nICYmXG4gICAgICB0eXBlb2YgQXJyYXlCdWZmZXIgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIHR5cGVvZiBVaW50OEFycmF5ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdmFyIGFiID0gbmV3IEFycmF5QnVmZmVyKDI1KTtcbiAgICB2YXIgdThzID0gbmV3IFVpbnQ4QXJyYXkoYWIpO1xuICAgIGNyeXB0by5nZXRSYW5kb21WYWx1ZXModThzKTtcbiAgICBISURERU5fTkFNRSA9IEhJRERFTl9OQU1FX1BSRUZJWCArICdyYW5kOicgK1xuICAgICAgQXJyYXkucHJvdG90eXBlLm1hcC5jYWxsKHU4cywgZnVuY3Rpb24odTgpIHtcbiAgICAgICAgcmV0dXJuICh1OCAlIDM2KS50b1N0cmluZygzNik7XG4gICAgICB9KS5qb2luKCcnKSArICdfX18nO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNOb3RIaWRkZW5OYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gIShcbiAgICAgICAgbmFtZS5zdWJzdHIoMCwgSElEREVOX05BTUVfUFJFRklYLmxlbmd0aCkgPT0gSElEREVOX05BTUVfUFJFRklYICYmXG4gICAgICAgIG5hbWUuc3Vic3RyKG5hbWUubGVuZ3RoIC0gMykgPT09ICdfX18nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNb25rZXkgcGF0Y2ggZ2V0T3duUHJvcGVydHlOYW1lcyB0byBhdm9pZCByZXZlYWxpbmcgdGhlXG4gICAqIEhJRERFTl9OQU1FLlxuICAgKlxuICAgKiA8cD5UaGUgRVM1LjEgc3BlYyByZXF1aXJlcyBlYWNoIG5hbWUgdG8gYXBwZWFyIG9ubHkgb25jZSwgYnV0IGFzXG4gICAqIG9mIHRoaXMgd3JpdGluZywgdGhpcyByZXF1aXJlbWVudCBpcyBjb250cm92ZXJzaWFsIGZvciBFUzYsIHNvIHdlXG4gICAqIG1hZGUgdGhpcyBjb2RlIHJvYnVzdCBhZ2FpbnN0IHRoaXMgY2FzZS4gSWYgdGhlIHJlc3VsdGluZyBleHRyYVxuICAgKiBzZWFyY2ggdHVybnMgb3V0IHRvIGJlIGV4cGVuc2l2ZSwgd2UgY2FuIHByb2JhYmx5IHJlbGF4IHRoaXMgb25jZVxuICAgKiBFUzYgaXMgYWRlcXVhdGVseSBzdXBwb3J0ZWQgb24gYWxsIG1ham9yIGJyb3dzZXJzLCBpZmYgbm8gYnJvd3NlclxuICAgKiB2ZXJzaW9ucyB3ZSBzdXBwb3J0IGF0IHRoYXQgdGltZSBoYXZlIHJlbGF4ZWQgdGhpcyBjb25zdHJhaW50XG4gICAqIHdpdGhvdXQgcHJvdmlkaW5nIGJ1aWx0LWluIEVTNiBXZWFrTWFwcy5cbiAgICovXG4gIGRlZlByb3AoT2JqZWN0LCAnZ2V0T3duUHJvcGVydHlOYW1lcycsIHtcbiAgICB2YWx1ZTogZnVuY3Rpb24gZmFrZUdldE93blByb3BlcnR5TmFtZXMob2JqKSB7XG4gICAgICByZXR1cm4gZ29wbihvYmopLmZpbHRlcihpc05vdEhpZGRlbk5hbWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIGdldFByb3BlcnR5TmFtZXMgaXMgbm90IGluIEVTNSBidXQgaXQgaXMgcHJvcG9zZWQgZm9yIEVTNiBhbmRcbiAgICogZG9lcyBhcHBlYXIgaW4gb3VyIHdoaXRlbGlzdCwgc28gd2UgbmVlZCB0byBjbGVhbiBpdCB0b28uXG4gICAqL1xuICBpZiAoJ2dldFByb3BlcnR5TmFtZXMnIGluIE9iamVjdCkge1xuICAgIHZhciBvcmlnaW5hbEdldFByb3BlcnR5TmFtZXMgPSBPYmplY3QuZ2V0UHJvcGVydHlOYW1lcztcbiAgICBkZWZQcm9wKE9iamVjdCwgJ2dldFByb3BlcnR5TmFtZXMnLCB7XG4gICAgICB2YWx1ZTogZnVuY3Rpb24gZmFrZUdldFByb3BlcnR5TmFtZXMob2JqKSB7XG4gICAgICAgIHJldHVybiBvcmlnaW5hbEdldFByb3BlcnR5TmFtZXMob2JqKS5maWx0ZXIoaXNOb3RIaWRkZW5OYW1lKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiA8cD5UbyB0cmVhdCBvYmplY3RzIGFzIGlkZW50aXR5LWtleXMgd2l0aCByZWFzb25hYmxlIGVmZmljaWVuY3lcbiAgICogb24gRVM1IGJ5IGl0c2VsZiAoaS5lLiwgd2l0aG91dCBhbnkgb2JqZWN0LWtleWVkIGNvbGxlY3Rpb25zKSwgd2VcbiAgICogbmVlZCB0byBhZGQgYSBoaWRkZW4gcHJvcGVydHkgdG8gc3VjaCBrZXkgb2JqZWN0cyB3aGVuIHdlXG4gICAqIGNhbi4gVGhpcyByYWlzZXMgc2V2ZXJhbCBpc3N1ZXM6XG4gICAqIDx1bD5cbiAgICogPGxpPkFycmFuZ2luZyB0byBhZGQgdGhpcyBwcm9wZXJ0eSB0byBvYmplY3RzIGJlZm9yZSB3ZSBsb3NlIHRoZVxuICAgKiAgICAgY2hhbmNlLCBhbmRcbiAgICogPGxpPkhpZGluZyB0aGUgZXhpc3RlbmNlIG9mIHRoaXMgbmV3IHByb3BlcnR5IGZyb20gbW9zdFxuICAgKiAgICAgSmF2YVNjcmlwdCBjb2RlLlxuICAgKiA8bGk+UHJldmVudGluZyA8aT5jZXJ0aWZpY2F0aW9uIHRoZWZ0PC9pPiwgd2hlcmUgb25lIG9iamVjdCBpc1xuICAgKiAgICAgY3JlYXRlZCBmYWxzZWx5IGNsYWltaW5nIHRvIGJlIHRoZSBrZXkgb2YgYW4gYXNzb2NpYXRpb25cbiAgICogICAgIGFjdHVhbGx5IGtleWVkIGJ5IGFub3RoZXIgb2JqZWN0LlxuICAgKiA8bGk+UHJldmVudGluZyA8aT52YWx1ZSB0aGVmdDwvaT4sIHdoZXJlIHVudHJ1c3RlZCBjb2RlIHdpdGhcbiAgICogICAgIGFjY2VzcyB0byBhIGtleSBvYmplY3QgYnV0IG5vdCBhIHdlYWsgbWFwIG5ldmVydGhlbGVzc1xuICAgKiAgICAgb2J0YWlucyBhY2Nlc3MgdG8gdGhlIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCB0aGF0IGtleSBpbiB0aGF0XG4gICAqICAgICB3ZWFrIG1hcC5cbiAgICogPC91bD5cbiAgICogV2UgZG8gc28gYnlcbiAgICogPHVsPlxuICAgKiA8bGk+TWFraW5nIHRoZSBuYW1lIG9mIHRoZSBoaWRkZW4gcHJvcGVydHkgdW5ndWVzc2FibGUsIHNvIFwiW11cIlxuICAgKiAgICAgaW5kZXhpbmcsIHdoaWNoIHdlIGNhbm5vdCBpbnRlcmNlcHQsIGNhbm5vdCBiZSB1c2VkIHRvIGFjY2Vzc1xuICAgKiAgICAgYSBwcm9wZXJ0eSB3aXRob3V0IGtub3dpbmcgdGhlIG5hbWUuXG4gICAqIDxsaT5NYWtpbmcgdGhlIGhpZGRlbiBwcm9wZXJ0eSBub24tZW51bWVyYWJsZSwgc28gd2UgbmVlZCBub3RcbiAgICogICAgIHdvcnJ5IGFib3V0IGZvci1pbiBsb29wcyBvciB7QGNvZGUgT2JqZWN0LmtleXN9LFxuICAgKiA8bGk+bW9ua2V5IHBhdGNoaW5nIHRob3NlIHJlZmxlY3RpdmUgbWV0aG9kcyB0aGF0IHdvdWxkXG4gICAqICAgICBwcmV2ZW50IGV4dGVuc2lvbnMsIHRvIGFkZCB0aGlzIGhpZGRlbiBwcm9wZXJ0eSBmaXJzdCxcbiAgICogPGxpPm1vbmtleSBwYXRjaGluZyB0aG9zZSBtZXRob2RzIHRoYXQgd291bGQgcmV2ZWFsIHRoaXNcbiAgICogICAgIGhpZGRlbiBwcm9wZXJ0eS5cbiAgICogPC91bD5cbiAgICogVW5mb3J0dW5hdGVseSwgYmVjYXVzZSBvZiBzYW1lLW9yaWdpbiBpZnJhbWVzLCB3ZSBjYW5ub3QgcmVsaWFibHlcbiAgICogYWRkIHRoaXMgaGlkZGVuIHByb3BlcnR5IGJlZm9yZSBhbiBvYmplY3QgYmVjb21lc1xuICAgKiBub24tZXh0ZW5zaWJsZS4gSW5zdGVhZCwgaWYgd2UgZW5jb3VudGVyIGEgbm9uLWV4dGVuc2libGUgb2JqZWN0XG4gICAqIHdpdGhvdXQgYSBoaWRkZW4gcmVjb3JkIHRoYXQgd2UgY2FuIGRldGVjdCAod2hldGhlciBvciBub3QgaXQgaGFzXG4gICAqIGEgaGlkZGVuIHJlY29yZCBzdG9yZWQgdW5kZXIgYSBuYW1lIHNlY3JldCB0byB1cyksIHRoZW4gd2UganVzdFxuICAgKiB1c2UgdGhlIGtleSBvYmplY3QgaXRzZWxmIHRvIHJlcHJlc2VudCBpdHMgaWRlbnRpdHkgaW4gYSBicnV0ZVxuICAgKiBmb3JjZSBsZWFreSBtYXAgc3RvcmVkIGluIHRoZSB3ZWFrIG1hcCwgbG9zaW5nIGFsbCB0aGUgYWR2YW50YWdlc1xuICAgKiBvZiB3ZWFrbmVzcyBmb3IgdGhlc2UuXG4gICAqL1xuICBmdW5jdGlvbiBnZXRIaWRkZW5SZWNvcmQoa2V5KSB7XG4gICAgaWYgKGtleSAhPT0gT2JqZWN0KGtleSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ05vdCBhbiBvYmplY3Q6ICcgKyBrZXkpO1xuICAgIH1cbiAgICB2YXIgaGlkZGVuUmVjb3JkID0ga2V5W0hJRERFTl9OQU1FXTtcbiAgICBpZiAoaGlkZGVuUmVjb3JkICYmIGhpZGRlblJlY29yZC5rZXkgPT09IGtleSkgeyByZXR1cm4gaGlkZGVuUmVjb3JkOyB9XG4gICAgaWYgKCFpc0V4dGVuc2libGUoa2V5KSkge1xuICAgICAgLy8gV2VhayBtYXAgbXVzdCBicnV0ZSBmb3JjZSwgYXMgZXhwbGFpbmVkIGluIGRvYy1jb21tZW50IGFib3ZlLlxuICAgICAgcmV0dXJuIHZvaWQgMDtcbiAgICB9XG5cbiAgICAvLyBUaGUgaGlkZGVuUmVjb3JkIGFuZCB0aGUga2V5IHBvaW50IGRpcmVjdGx5IGF0IGVhY2ggb3RoZXIsIHZpYVxuICAgIC8vIHRoZSBcImtleVwiIGFuZCBISURERU5fTkFNRSBwcm9wZXJ0aWVzIHJlc3BlY3RpdmVseS4gVGhlIGtleVxuICAgIC8vIGZpZWxkIGlzIGZvciBxdWlja2x5IHZlcmlmeWluZyB0aGF0IHRoaXMgaGlkZGVuIHJlY29yZCBpcyBhblxuICAgIC8vIG93biBwcm9wZXJ0eSwgbm90IGEgaGlkZGVuIHJlY29yZCBmcm9tIHVwIHRoZSBwcm90b3R5cGUgY2hhaW4uXG4gICAgLy9cbiAgICAvLyBOT1RFOiBCZWNhdXNlIHRoaXMgV2Vha01hcCBlbXVsYXRpb24gaXMgbWVhbnQgb25seSBmb3Igc3lzdGVtcyBsaWtlXG4gICAgLy8gU0VTIHdoZXJlIE9iamVjdC5wcm90b3R5cGUgaXMgZnJvemVuIHdpdGhvdXQgYW55IG51bWVyaWNcbiAgICAvLyBwcm9wZXJ0aWVzLCBpdCBpcyBvayB0byB1c2UgYW4gb2JqZWN0IGxpdGVyYWwgZm9yIHRoZSBoaWRkZW5SZWNvcmQuXG4gICAgLy8gVGhpcyBoYXMgdHdvIGFkdmFudGFnZXM6XG4gICAgLy8gKiBJdCBpcyBtdWNoIGZhc3RlciBpbiBhIHBlcmZvcm1hbmNlIGNyaXRpY2FsIHBsYWNlXG4gICAgLy8gKiBJdCBhdm9pZHMgcmVseWluZyBvbiBPYmplY3QuY3JlYXRlKG51bGwpLCB3aGljaCBoYWQgYmVlblxuICAgIC8vICAgcHJvYmxlbWF0aWMgb24gQ2hyb21lIDI4LjAuMTQ4MC4wLiBTZWVcbiAgICAvLyAgIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvZ29vZ2xlLWNhamEvaXNzdWVzL2RldGFpbD9pZD0xNjg3XG4gICAgaGlkZGVuUmVjb3JkID0geyBrZXk6IGtleSB9O1xuXG4gICAgLy8gV2hlbiB1c2luZyB0aGlzIFdlYWtNYXAgZW11bGF0aW9uIG9uIHBsYXRmb3JtcyB3aGVyZVxuICAgIC8vIE9iamVjdC5wcm90b3R5cGUgbWlnaHQgbm90IGJlIGZyb3plbiBhbmQgT2JqZWN0LmNyZWF0ZShudWxsKSBpc1xuICAgIC8vIHJlbGlhYmxlLCB1c2UgdGhlIGZvbGxvd2luZyB0d28gY29tbWVudGVkIG91dCBsaW5lcyBpbnN0ZWFkLlxuICAgIC8vIGhpZGRlblJlY29yZCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgLy8gaGlkZGVuUmVjb3JkLmtleSA9IGtleTtcblxuICAgIC8vIFBsZWFzZSBjb250YWN0IHVzIGlmIHlvdSBuZWVkIHRoaXMgdG8gd29yayBvbiBwbGF0Zm9ybXMgd2hlcmVcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIG1pZ2h0IG5vdCBiZSBmcm96ZW4gYW5kXG4gICAgLy8gT2JqZWN0LmNyZWF0ZShudWxsKSBtaWdodCBub3QgYmUgcmVsaWFibGUuXG5cbiAgICB0cnkge1xuICAgICAgZGVmUHJvcChrZXksIEhJRERFTl9OQU1FLCB7XG4gICAgICAgIHZhbHVlOiBoaWRkZW5SZWNvcmQsXG4gICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGhpZGRlblJlY29yZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gVW5kZXIgc29tZSBjaXJjdW1zdGFuY2VzLCBpc0V4dGVuc2libGUgc2VlbXMgdG8gbWlzcmVwb3J0IHdoZXRoZXJcbiAgICAgIC8vIHRoZSBISURERU5fTkFNRSBjYW4gYmUgZGVmaW5lZC5cbiAgICAgIC8vIFRoZSBjaXJjdW1zdGFuY2VzIGhhdmUgbm90IGJlZW4gaXNvbGF0ZWQsIGJ1dCBhdCBsZWFzdCBhZmZlY3RcbiAgICAgIC8vIE5vZGUuanMgdjAuMTAuMjYgb24gVHJhdmlzQ0kgLyBMaW51eCwgYnV0IG5vdCB0aGUgc2FtZSB2ZXJzaW9uIG9mXG4gICAgICAvLyBOb2RlLmpzIG9uIE9TIFguXG4gICAgICByZXR1cm4gdm9pZCAwO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNb25rZXkgcGF0Y2ggb3BlcmF0aW9ucyB0aGF0IHdvdWxkIG1ha2UgdGhlaXIgYXJndW1lbnRcbiAgICogbm9uLWV4dGVuc2libGUuXG4gICAqXG4gICAqIDxwPlRoZSBtb25rZXkgcGF0Y2hlZCB2ZXJzaW9ucyB0aHJvdyBhIFR5cGVFcnJvciBpZiB0aGVpclxuICAgKiBhcmd1bWVudCBpcyBub3QgYW4gb2JqZWN0LCBzbyBpdCBzaG91bGQgb25seSBiZSBkb25lIHRvIGZ1bmN0aW9uc1xuICAgKiB0aGF0IHNob3VsZCB0aHJvdyBhIFR5cGVFcnJvciBhbnl3YXkgaWYgdGhlaXIgYXJndW1lbnQgaXMgbm90IGFuXG4gICAqIG9iamVjdC5cbiAgICovXG4gIChmdW5jdGlvbigpe1xuICAgIHZhciBvbGRGcmVlemUgPSBPYmplY3QuZnJlZXplO1xuICAgIGRlZlByb3AoT2JqZWN0LCAnZnJlZXplJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGlkZW50aWZ5aW5nRnJlZXplKG9iaikge1xuICAgICAgICBnZXRIaWRkZW5SZWNvcmQob2JqKTtcbiAgICAgICAgcmV0dXJuIG9sZEZyZWV6ZShvYmopO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHZhciBvbGRTZWFsID0gT2JqZWN0LnNlYWw7XG4gICAgZGVmUHJvcChPYmplY3QsICdzZWFsJywge1xuICAgICAgdmFsdWU6IGZ1bmN0aW9uIGlkZW50aWZ5aW5nU2VhbChvYmopIHtcbiAgICAgICAgZ2V0SGlkZGVuUmVjb3JkKG9iaik7XG4gICAgICAgIHJldHVybiBvbGRTZWFsKG9iaik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdmFyIG9sZFByZXZlbnRFeHRlbnNpb25zID0gT2JqZWN0LnByZXZlbnRFeHRlbnNpb25zO1xuICAgIGRlZlByb3AoT2JqZWN0LCAncHJldmVudEV4dGVuc2lvbnMnLCB7XG4gICAgICB2YWx1ZTogZnVuY3Rpb24gaWRlbnRpZnlpbmdQcmV2ZW50RXh0ZW5zaW9ucyhvYmopIHtcbiAgICAgICAgZ2V0SGlkZGVuUmVjb3JkKG9iaik7XG4gICAgICAgIHJldHVybiBvbGRQcmV2ZW50RXh0ZW5zaW9ucyhvYmopO1xuICAgICAgfVxuICAgIH0pO1xuICB9KSgpO1xuXG4gIGZ1bmN0aW9uIGNvbnN0RnVuYyhmdW5jKSB7XG4gICAgZnVuYy5wcm90b3R5cGUgPSBudWxsO1xuICAgIHJldHVybiBPYmplY3QuZnJlZXplKGZ1bmMpO1xuICB9XG5cbiAgdmFyIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nRG9uZSA9IGZhbHNlO1xuICBmdW5jdGlvbiBjYWxsZWRBc0Z1bmN0aW9uV2FybmluZygpIHtcbiAgICAvLyBGdXR1cmUgRVM2IFdlYWtNYXAgaXMgY3VycmVudGx5ICgyMDEzLTA5LTEwKSBleHBlY3RlZCB0byByZWplY3QgV2Vha01hcCgpXG4gICAgLy8gYnV0IHdlIHVzZWQgdG8gcGVybWl0IGl0IGFuZCBkbyBpdCBvdXJzZWx2ZXMsIHNvIHdhcm4gb25seS5cbiAgICBpZiAoIWNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nRG9uZSAmJiB0eXBlb2YgY29uc29sZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nRG9uZSA9IHRydWU7XG4gICAgICBjb25zb2xlLndhcm4oJ1dlYWtNYXAgc2hvdWxkIGJlIGludm9rZWQgYXMgbmV3IFdlYWtNYXAoKSwgbm90ICcgK1xuICAgICAgICAgICdXZWFrTWFwKCkuIFRoaXMgd2lsbCBiZSBhbiBlcnJvciBpbiB0aGUgZnV0dXJlLicpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBuZXh0SWQgPSAwO1xuXG4gIHZhciBPdXJXZWFrTWFwID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIE91cldlYWtNYXApKSB7ICAvLyBhcHByb3hpbWF0ZSB0ZXN0IGZvciBuZXcgLi4uKClcbiAgICAgIGNhbGxlZEFzRnVuY3Rpb25XYXJuaW5nKCk7XG4gICAgfVxuXG4gICAgLy8gV2UgYXJlIGN1cnJlbnRseSAoMTIvMjUvMjAxMikgbmV2ZXIgZW5jb3VudGVyaW5nIGFueSBwcmVtYXR1cmVseVxuICAgIC8vIG5vbi1leHRlbnNpYmxlIGtleXMuXG4gICAgdmFyIGtleXMgPSBbXTsgLy8gYnJ1dGUgZm9yY2UgZm9yIHByZW1hdHVyZWx5IG5vbi1leHRlbnNpYmxlIGtleXMuXG4gICAgdmFyIHZhbHVlcyA9IFtdOyAvLyBicnV0ZSBmb3JjZSBmb3IgY29ycmVzcG9uZGluZyB2YWx1ZXMuXG4gICAgdmFyIGlkID0gbmV4dElkKys7XG5cbiAgICBmdW5jdGlvbiBnZXRfX18oa2V5LCBvcHRfZGVmYXVsdCkge1xuICAgICAgdmFyIGluZGV4O1xuICAgICAgdmFyIGhpZGRlblJlY29yZCA9IGdldEhpZGRlblJlY29yZChrZXkpO1xuICAgICAgaWYgKGhpZGRlblJlY29yZCkge1xuICAgICAgICByZXR1cm4gaWQgaW4gaGlkZGVuUmVjb3JkID8gaGlkZGVuUmVjb3JkW2lkXSA6IG9wdF9kZWZhdWx0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5kZXggPSBrZXlzLmluZGV4T2Yoa2V5KTtcbiAgICAgICAgcmV0dXJuIGluZGV4ID49IDAgPyB2YWx1ZXNbaW5kZXhdIDogb3B0X2RlZmF1bHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGFzX19fKGtleSkge1xuICAgICAgdmFyIGhpZGRlblJlY29yZCA9IGdldEhpZGRlblJlY29yZChrZXkpO1xuICAgICAgaWYgKGhpZGRlblJlY29yZCkge1xuICAgICAgICByZXR1cm4gaWQgaW4gaGlkZGVuUmVjb3JkO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGtleXMuaW5kZXhPZihrZXkpID49IDA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0X19fKGtleSwgdmFsdWUpIHtcbiAgICAgIHZhciBpbmRleDtcbiAgICAgIHZhciBoaWRkZW5SZWNvcmQgPSBnZXRIaWRkZW5SZWNvcmQoa2V5KTtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgaGlkZGVuUmVjb3JkW2lkXSA9IHZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5kZXggPSBrZXlzLmluZGV4T2Yoa2V5KTtcbiAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICB2YWx1ZXNbaW5kZXhdID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2luY2Ugc29tZSBicm93c2VycyBwcmVlbXB0aXZlbHkgdGVybWluYXRlIHNsb3cgdHVybnMgYnV0XG4gICAgICAgICAgLy8gdGhlbiBjb250aW51ZSBjb21wdXRpbmcgd2l0aCBwcmVzdW1hYmx5IGNvcnJ1cHRlZCBoZWFwXG4gICAgICAgICAgLy8gc3RhdGUsIHdlIGhlcmUgZGVmZW5zaXZlbHkgZ2V0IGtleXMubGVuZ3RoIGZpcnN0IGFuZCB0aGVuXG4gICAgICAgICAgLy8gdXNlIGl0IHRvIHVwZGF0ZSBib3RoIHRoZSB2YWx1ZXMgYW5kIGtleXMgYXJyYXlzLCBrZWVwaW5nXG4gICAgICAgICAgLy8gdGhlbSBpbiBzeW5jLlxuICAgICAgICAgIGluZGV4ID0ga2V5cy5sZW5ndGg7XG4gICAgICAgICAgdmFsdWVzW2luZGV4XSA9IHZhbHVlO1xuICAgICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIHZhbHVlcyB3aWxsIGJlIG9uZSBsb25nZXIgdGhhbiBrZXlzLlxuICAgICAgICAgIGtleXNbaW5kZXhdID0ga2V5O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxldGVfX18oa2V5KSB7XG4gICAgICB2YXIgaGlkZGVuUmVjb3JkID0gZ2V0SGlkZGVuUmVjb3JkKGtleSk7XG4gICAgICB2YXIgaW5kZXgsIGxhc3RJbmRleDtcbiAgICAgIGlmIChoaWRkZW5SZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuIGlkIGluIGhpZGRlblJlY29yZCAmJiBkZWxldGUgaGlkZGVuUmVjb3JkW2lkXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluZGV4ID0ga2V5cy5pbmRleE9mKGtleSk7XG4gICAgICAgIGlmIChpbmRleCA8IDApIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgLy8gU2luY2Ugc29tZSBicm93c2VycyBwcmVlbXB0aXZlbHkgdGVybWluYXRlIHNsb3cgdHVybnMgYnV0XG4gICAgICAgIC8vIHRoZW4gY29udGludWUgY29tcHV0aW5nIHdpdGggcG90ZW50aWFsbHkgY29ycnVwdGVkIGhlYXBcbiAgICAgICAgLy8gc3RhdGUsIHdlIGhlcmUgZGVmZW5zaXZlbHkgZ2V0IGtleXMubGVuZ3RoIGZpcnN0IGFuZCB0aGVuIHVzZVxuICAgICAgICAvLyBpdCB0byB1cGRhdGUgYm90aCB0aGUga2V5cyBhbmQgdGhlIHZhbHVlcyBhcnJheSwga2VlcGluZ1xuICAgICAgICAvLyB0aGVtIGluIHN5bmMuIFdlIHVwZGF0ZSB0aGUgdHdvIHdpdGggYW4gb3JkZXIgb2YgYXNzaWdubWVudHMsXG4gICAgICAgIC8vIHN1Y2ggdGhhdCBhbnkgcHJlZml4IG9mIHRoZXNlIGFzc2lnbm1lbnRzIHdpbGwgcHJlc2VydmUgdGhlXG4gICAgICAgIC8vIGtleS92YWx1ZSBjb3JyZXNwb25kZW5jZSwgZWl0aGVyIGJlZm9yZSBvciBhZnRlciB0aGUgZGVsZXRlLlxuICAgICAgICAvLyBOb3RlIHRoYXQgdGhpcyBuZWVkcyB0byB3b3JrIGNvcnJlY3RseSB3aGVuIGluZGV4ID09PSBsYXN0SW5kZXguXG4gICAgICAgIGxhc3RJbmRleCA9IGtleXMubGVuZ3RoIC0gMTtcbiAgICAgICAga2V5c1tpbmRleF0gPSB2b2lkIDA7XG4gICAgICAgIC8vIElmIHdlIGNyYXNoIGhlcmUsIHRoZXJlJ3MgYSB2b2lkIDAgaW4gdGhlIGtleXMgYXJyYXksIGJ1dFxuICAgICAgICAvLyBubyBvcGVyYXRpb24gd2lsbCBjYXVzZSBhIFwia2V5cy5pbmRleE9mKHZvaWQgMClcIiwgc2luY2VcbiAgICAgICAgLy8gZ2V0SGlkZGVuUmVjb3JkKHZvaWQgMCkgd2lsbCBhbHdheXMgdGhyb3cgYW4gZXJyb3IgZmlyc3QuXG4gICAgICAgIHZhbHVlc1tpbmRleF0gPSB2YWx1ZXNbbGFzdEluZGV4XTtcbiAgICAgICAgLy8gSWYgd2UgY3Jhc2ggaGVyZSwgdmFsdWVzW2luZGV4XSBjYW5ub3QgYmUgZm91bmQgaGVyZSxcbiAgICAgICAgLy8gYmVjYXVzZSBrZXlzW2luZGV4XSBpcyB2b2lkIDAuXG4gICAgICAgIGtleXNbaW5kZXhdID0ga2V5c1tsYXN0SW5kZXhdO1xuICAgICAgICAvLyBJZiBpbmRleCA9PT0gbGFzdEluZGV4IGFuZCB3ZSBjcmFzaCBoZXJlLCB0aGVuIGtleXNbaW5kZXhdXG4gICAgICAgIC8vIGlzIHN0aWxsIHZvaWQgMCwgc2luY2UgdGhlIGFsaWFzaW5nIGtpbGxlZCB0aGUgcHJldmlvdXMga2V5LlxuICAgICAgICBrZXlzLmxlbmd0aCA9IGxhc3RJbmRleDtcbiAgICAgICAgLy8gSWYgd2UgY3Jhc2ggaGVyZSwga2V5cyB3aWxsIGJlIG9uZSBzaG9ydGVyIHRoYW4gdmFsdWVzLlxuICAgICAgICB2YWx1ZXMubGVuZ3RoID0gbGFzdEluZGV4O1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShPdXJXZWFrTWFwLnByb3RvdHlwZSwge1xuICAgICAgZ2V0X19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoZ2V0X19fKSB9LFxuICAgICAgaGFzX19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoaGFzX19fKSB9LFxuICAgICAgc2V0X19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoc2V0X19fKSB9LFxuICAgICAgZGVsZXRlX19fOiB7IHZhbHVlOiBjb25zdEZ1bmMoZGVsZXRlX19fKSB9XG4gICAgfSk7XG4gIH07XG5cbiAgT3VyV2Vha01hcC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKE9iamVjdC5wcm90b3R5cGUsIHtcbiAgICBnZXQ6IHtcbiAgICAgIC8qKlxuICAgICAgICogUmV0dXJuIHRoZSB2YWx1ZSBtb3N0IHJlY2VudGx5IGFzc29jaWF0ZWQgd2l0aCBrZXksIG9yXG4gICAgICAgKiBvcHRfZGVmYXVsdCBpZiBub25lLlxuICAgICAgICovXG4gICAgICB2YWx1ZTogZnVuY3Rpb24gZ2V0KGtleSwgb3B0X2RlZmF1bHQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0X19fKGtleSwgb3B0X2RlZmF1bHQpO1xuICAgICAgfSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSxcblxuICAgIGhhczoge1xuICAgICAgLyoqXG4gICAgICAgKiBJcyB0aGVyZSBhIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCBrZXkgaW4gdGhpcyBXZWFrTWFwP1xuICAgICAgICovXG4gICAgICB2YWx1ZTogZnVuY3Rpb24gaGFzKGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYXNfX18oa2V5KTtcbiAgICAgIH0sXG4gICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0sXG5cbiAgICBzZXQ6IHtcbiAgICAgIC8qKlxuICAgICAgICogQXNzb2NpYXRlIHZhbHVlIHdpdGgga2V5IGluIHRoaXMgV2Vha01hcCwgb3ZlcndyaXRpbmcgYW55XG4gICAgICAgKiBwcmV2aW91cyBhc3NvY2lhdGlvbiBpZiBwcmVzZW50LlxuICAgICAgICovXG4gICAgICB2YWx1ZTogZnVuY3Rpb24gc2V0KGtleSwgdmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0X19fKGtleSwgdmFsdWUpO1xuICAgICAgfSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSxcblxuICAgICdkZWxldGUnOiB7XG4gICAgICAvKipcbiAgICAgICAqIFJlbW92ZSBhbnkgYXNzb2NpYXRpb24gZm9yIGtleSBpbiB0aGlzIFdlYWtNYXAsIHJldHVybmluZ1xuICAgICAgICogd2hldGhlciB0aGVyZSB3YXMgb25lLlxuICAgICAgICpcbiAgICAgICAqIDxwPk5vdGUgdGhhdCB0aGUgYm9vbGVhbiByZXR1cm4gaGVyZSBkb2VzIG5vdCB3b3JrIGxpa2UgdGhlXG4gICAgICAgKiB7QGNvZGUgZGVsZXRlfSBvcGVyYXRvci4gVGhlIHtAY29kZSBkZWxldGV9IG9wZXJhdG9yIHJldHVybnNcbiAgICAgICAqIHdoZXRoZXIgdGhlIGRlbGV0aW9uIHN1Y2NlZWRzIGF0IGJyaW5naW5nIGFib3V0IGEgc3RhdGUgaW5cbiAgICAgICAqIHdoaWNoIHRoZSBkZWxldGVkIHByb3BlcnR5IGlzIGFic2VudC4gVGhlIHtAY29kZSBkZWxldGV9XG4gICAgICAgKiBvcGVyYXRvciB0aGVyZWZvcmUgcmV0dXJucyB0cnVlIGlmIHRoZSBwcm9wZXJ0eSB3YXMgYWxyZWFkeVxuICAgICAgICogYWJzZW50LCB3aGVyZWFzIHRoaXMge0Bjb2RlIGRlbGV0ZX0gbWV0aG9kIHJldHVybnMgZmFsc2UgaWZcbiAgICAgICAqIHRoZSBhc3NvY2lhdGlvbiB3YXMgYWxyZWFkeSBhYnNlbnQuXG4gICAgICAgKi9cbiAgICAgIHZhbHVlOiBmdW5jdGlvbiByZW1vdmUoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRlbGV0ZV9fXyhrZXkpO1xuICAgICAgfSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfVxuICB9KTtcblxuICBpZiAodHlwZW9mIEhvc3RXZWFrTWFwID09PSAnZnVuY3Rpb24nKSB7XG4gICAgKGZ1bmN0aW9uKCkge1xuICAgICAgLy8gSWYgd2UgZ290IGhlcmUsIHRoZW4gdGhlIHBsYXRmb3JtIGhhcyBhIFdlYWtNYXAgYnV0IHdlIGFyZSBjb25jZXJuZWRcbiAgICAgIC8vIHRoYXQgaXQgbWF5IHJlZnVzZSB0byBzdG9yZSBzb21lIGtleSB0eXBlcy4gVGhlcmVmb3JlLCBtYWtlIGEgbWFwXG4gICAgICAvLyBpbXBsZW1lbnRhdGlvbiB3aGljaCBtYWtlcyB1c2Ugb2YgYm90aCBhcyBwb3NzaWJsZS5cblxuICAgICAgLy8gSW4gdGhpcyBtb2RlIHdlIGFyZSBhbHdheXMgdXNpbmcgZG91YmxlIG1hcHMsIHNvIHdlIGFyZSBub3QgcHJveHktc2FmZS5cbiAgICAgIC8vIFRoaXMgY29tYmluYXRpb24gZG9lcyBub3Qgb2NjdXIgaW4gYW55IGtub3duIGJyb3dzZXIsIGJ1dCB3ZSBoYWQgYmVzdFxuICAgICAgLy8gYmUgc2FmZS5cbiAgICAgIGlmIChkb3VibGVXZWFrTWFwQ2hlY2tTaWxlbnRGYWlsdXJlICYmIHR5cGVvZiBQcm94eSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgUHJveHkgPSB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIERvdWJsZVdlYWtNYXAoKSB7XG4gICAgICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBPdXJXZWFrTWFwKSkgeyAgLy8gYXBwcm94aW1hdGUgdGVzdCBmb3IgbmV3IC4uLigpXG4gICAgICAgICAgY2FsbGVkQXNGdW5jdGlvbldhcm5pbmcoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFByZWZlcmFibGUsIHRydWx5IHdlYWsgbWFwLlxuICAgICAgICB2YXIgaG1hcCA9IG5ldyBIb3N0V2Vha01hcCgpO1xuXG4gICAgICAgIC8vIE91ciBoaWRkZW4tcHJvcGVydHktYmFzZWQgcHNldWRvLXdlYWstbWFwLiBMYXppbHkgaW5pdGlhbGl6ZWQgaW4gdGhlXG4gICAgICAgIC8vICdzZXQnIGltcGxlbWVudGF0aW9uOyB0aHVzIHdlIGNhbiBhdm9pZCBwZXJmb3JtaW5nIGV4dHJhIGxvb2t1cHMgaWZcbiAgICAgICAgLy8gd2Uga25vdyBhbGwgZW50cmllcyBhY3R1YWxseSBzdG9yZWQgYXJlIGVudGVyZWQgaW4gJ2htYXAnLlxuICAgICAgICB2YXIgb21hcCA9IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBIaWRkZW4tcHJvcGVydHkgbWFwcyBhcmUgbm90IGNvbXBhdGlibGUgd2l0aCBwcm94aWVzIGJlY2F1c2UgcHJveGllc1xuICAgICAgICAvLyBjYW4gb2JzZXJ2ZSB0aGUgaGlkZGVuIG5hbWUgYW5kIGVpdGhlciBhY2NpZGVudGFsbHkgZXhwb3NlIGl0IG9yIGZhaWxcbiAgICAgICAgLy8gdG8gYWxsb3cgdGhlIGhpZGRlbiBwcm9wZXJ0eSB0byBiZSBzZXQuIFRoZXJlZm9yZSwgd2UgZG8gbm90IGFsbG93XG4gICAgICAgIC8vIGFyYml0cmFyeSBXZWFrTWFwcyB0byBzd2l0Y2ggdG8gdXNpbmcgaGlkZGVuIHByb3BlcnRpZXMsIGJ1dCBvbmx5XG4gICAgICAgIC8vIHRob3NlIHdoaWNoIG5lZWQgdGhlIGFiaWxpdHksIGFuZCB1bnByaXZpbGVnZWQgY29kZSBpcyBub3QgYWxsb3dlZFxuICAgICAgICAvLyB0byBzZXQgdGhlIGZsYWcuXG4gICAgICAgIC8vXG4gICAgICAgIC8vIChFeGNlcHQgaW4gZG91YmxlV2Vha01hcENoZWNrU2lsZW50RmFpbHVyZSBtb2RlIGluIHdoaWNoIGNhc2Ugd2VcbiAgICAgICAgLy8gZGlzYWJsZSBwcm94aWVzLilcbiAgICAgICAgdmFyIGVuYWJsZVN3aXRjaGluZyA9IGZhbHNlO1xuXG4gICAgICAgIGZ1bmN0aW9uIGRnZXQoa2V5LCBvcHRfZGVmYXVsdCkge1xuICAgICAgICAgIGlmIChvbWFwKSB7XG4gICAgICAgICAgICByZXR1cm4gaG1hcC5oYXMoa2V5KSA/IGhtYXAuZ2V0KGtleSlcbiAgICAgICAgICAgICAgICA6IG9tYXAuZ2V0X19fKGtleSwgb3B0X2RlZmF1bHQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gaG1hcC5nZXQoa2V5LCBvcHRfZGVmYXVsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gZGhhcyhrZXkpIHtcbiAgICAgICAgICByZXR1cm4gaG1hcC5oYXMoa2V5KSB8fCAob21hcCA/IG9tYXAuaGFzX19fKGtleSkgOiBmYWxzZSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZHNldDtcbiAgICAgICAgaWYgKGRvdWJsZVdlYWtNYXBDaGVja1NpbGVudEZhaWx1cmUpIHtcbiAgICAgICAgICBkc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaG1hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICBpZiAoIWhtYXAuaGFzKGtleSkpIHtcbiAgICAgICAgICAgICAgaWYgKCFvbWFwKSB7IG9tYXAgPSBuZXcgT3VyV2Vha01hcCgpOyB9XG4gICAgICAgICAgICAgIG9tYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGVuYWJsZVN3aXRjaGluZykge1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGhtYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFvbWFwKSB7IG9tYXAgPSBuZXcgT3VyV2Vha01hcCgpOyB9XG4gICAgICAgICAgICAgICAgb21hcC5zZXRfX18oa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGhtYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGRkZWxldGUoa2V5KSB7XG4gICAgICAgICAgdmFyIHJlc3VsdCA9ICEhaG1hcFsnZGVsZXRlJ10oa2V5KTtcbiAgICAgICAgICBpZiAob21hcCkgeyByZXR1cm4gb21hcC5kZWxldGVfX18oa2V5KSB8fCByZXN1bHQ7IH1cbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIE9iamVjdC5jcmVhdGUoT3VyV2Vha01hcC5wcm90b3R5cGUsIHtcbiAgICAgICAgICBnZXRfX186ICAgIHsgdmFsdWU6IGNvbnN0RnVuYyhkZ2V0KSB9LFxuICAgICAgICAgIGhhc19fXzogICAgeyB2YWx1ZTogY29uc3RGdW5jKGRoYXMpIH0sXG4gICAgICAgICAgc2V0X19fOiAgICB7IHZhbHVlOiBjb25zdEZ1bmMoZHNldCkgfSxcbiAgICAgICAgICBkZWxldGVfX186IHsgdmFsdWU6IGNvbnN0RnVuYyhkZGVsZXRlKSB9LFxuICAgICAgICAgIHBlcm1pdEhvc3RPYmplY3RzX19fOiB7IHZhbHVlOiBjb25zdEZ1bmMoZnVuY3Rpb24odG9rZW4pIHtcbiAgICAgICAgICAgIGlmICh0b2tlbiA9PT0gd2Vha01hcFBlcm1pdEhvc3RPYmplY3RzKSB7XG4gICAgICAgICAgICAgIGVuYWJsZVN3aXRjaGluZyA9IHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2JvZ3VzIGNhbGwgdG8gcGVybWl0SG9zdE9iamVjdHNfX18nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KX1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBEb3VibGVXZWFrTWFwLnByb3RvdHlwZSA9IE91cldlYWtNYXAucHJvdG90eXBlO1xuICAgICAgbW9kdWxlLmV4cG9ydHMgPSBEb3VibGVXZWFrTWFwO1xuXG4gICAgICAvLyBkZWZpbmUgLmNvbnN0cnVjdG9yIHRvIGhpZGUgT3VyV2Vha01hcCBjdG9yXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoV2Vha01hcC5wcm90b3R5cGUsICdjb25zdHJ1Y3RvcicsIHtcbiAgICAgICAgdmFsdWU6IFdlYWtNYXAsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLCAgLy8gYXMgZGVmYXVsdCAuY29uc3RydWN0b3IgaXNcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgICB3cml0YWJsZTogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSkoKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBUaGVyZSBpcyBubyBob3N0IFdlYWtNYXAsIHNvIHdlIG11c3QgdXNlIHRoZSBlbXVsYXRpb24uXG5cbiAgICAvLyBFbXVsYXRlZCBXZWFrTWFwcyBhcmUgaW5jb21wYXRpYmxlIHdpdGggbmF0aXZlIHByb3hpZXMgKGJlY2F1c2UgcHJveGllc1xuICAgIC8vIGNhbiBvYnNlcnZlIHRoZSBoaWRkZW4gbmFtZSksIHNvIHdlIG11c3QgZGlzYWJsZSBQcm94eSB1c2FnZSAoaW5cbiAgICAvLyBBcnJheUxpa2UgYW5kIERvbWFkbywgY3VycmVudGx5KS5cbiAgICBpZiAodHlwZW9mIFByb3h5ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgUHJveHkgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBPdXJXZWFrTWFwO1xuICB9XG59KSgpO1xuIiwidmFyIFdNO1xuXG5pZih0eXBlb2YgV2Vha01hcCAhPT0gJ3VuZGVmaW5lZCcpe1xuICAgIFdNID0gV2Vha01hcDtcbn1lbHNlIGlmKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnKXtcbiAgICBpZiAobmF2aWdhdG9yLmFwcE5hbWUgPT0gJ01pY3Jvc29mdCBJbnRlcm5ldCBFeHBsb3Jlcicpe1xuICAgICAgICB2YXIgbWF0Y2ggPSBuYXZpZ2F0b3IudXNlckFnZW50Lm1hdGNoKC9NU0lFIChbMC05XXsxLH1bXFwuMC05XXswLH0pLyk7XG4gICAgICAgIGlmIChtYXRjaCAmJiBtYXRjaFsxXSA8PSA5KXtcbiAgICAgICAgICAgIC8vIE1FTU9SWSBMRUFLUyBGT1IgRVZFUllPTkUhISFcbiAgICAgICAgICAgIFdNID0gcmVxdWlyZSgnbGVhay1tYXAnKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuV00gfHwgKFdNID0gcmVxdWlyZSgnd2Vhay1tYXAnKSk7XG5cbm1vZHVsZS5leHBvcnRzID0gV007IiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIGtNYXhMZW5ndGggPSAweDNmZmZmZmZmXG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIE5vdGU6XG4gKlxuICogLSBJbXBsZW1lbnRhdGlvbiBtdXN0IHN1cHBvcnQgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMuXG4gKiAgIEZpcmVmb3ggNC0yOSBsYWNrZWQgc3VwcG9ydCwgZml4ZWQgaW4gRmlyZWZveCAzMCsuXG4gKiAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG4gKlxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXkgd2lsbFxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgd2lsbCB3b3JrIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgcmV0dXJuIDQyID09PSBhcnIuZm9vKCkgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoMSkuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciB0eXBlID0gdHlwZW9mIHN1YmplY3RcblxuICAvLyBGaW5kIHRoZSBsZW5ndGhcbiAgdmFyIGxlbmd0aFxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpXG4gICAgbGVuZ3RoID0gc3ViamVjdCA+IDAgPyBzdWJqZWN0ID4+PiAwIDogMFxuICBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGlmIChlbmNvZGluZyA9PT0gJ2Jhc2U2NCcpXG4gICAgICBzdWJqZWN0ID0gYmFzZTY0Y2xlYW4oc3ViamVjdClcbiAgICBsZW5ndGggPSBCdWZmZXIuYnl0ZUxlbmd0aChzdWJqZWN0LCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0JyAmJiBzdWJqZWN0ICE9PSBudWxsKSB7IC8vIGFzc3VtZSBvYmplY3QgaXMgYXJyYXktbGlrZVxuICAgIGlmIChzdWJqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkoc3ViamVjdC5kYXRhKSlcbiAgICAgIHN1YmplY3QgPSBzdWJqZWN0LmRhdGFcbiAgICBsZW5ndGggPSArc3ViamVjdC5sZW5ndGggPiAwID8gTWF0aC5mbG9vcigrc3ViamVjdC5sZW5ndGgpIDogMFxuICB9IGVsc2VcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG5cbiAgaWYgKHRoaXMubGVuZ3RoID4ga01heExlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoLnRvU3RyaW5nKDE2KSArICcgYnl0ZXMnKVxuXG4gIHZhciBidWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUHJlZmVycmVkOiBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGJ1ZiA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gVEhJUyBpbnN0YW5jZSBvZiBCdWZmZXIgKGNyZWF0ZWQgYnkgYG5ld2ApXG4gICAgYnVmID0gdGhpc1xuICAgIGJ1Zi5sZW5ndGggPSBsZW5ndGhcbiAgICBidWYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIHR5cGVvZiBzdWJqZWN0LmJ5dGVMZW5ndGggPT09ICdudW1iZXInKSB7XG4gICAgLy8gU3BlZWQgb3B0aW1pemF0aW9uIC0tIHVzZSBzZXQgaWYgd2UncmUgY29weWluZyBmcm9tIGEgdHlwZWQgYXJyYXlcbiAgICBidWYuX3NldChzdWJqZWN0KVxuICB9IGVsc2UgaWYgKGlzQXJyYXlpc2goc3ViamVjdCkpIHtcbiAgICAvLyBUcmVhdCBhcnJheS1pc2ggb2JqZWN0cyBhcyBhIGJ5dGUgYXJyYXlcbiAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpKSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgICAgIGJ1ZltpXSA9IHN1YmplY3QucmVhZFVJbnQ4KGkpXG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKylcbiAgICAgICAgYnVmW2ldID0gKChzdWJqZWN0W2ldICUgMjU2KSArIDI1NikgJSAyNTZcbiAgICB9XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBidWYud3JpdGUoc3ViamVjdCwgMCwgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicgJiYgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmICFub1plcm8pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIGJ1ZltpXSA9IDBcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSlcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IE1hdGgubWluKHgsIHkpOyBpIDwgbGVuICYmIGFbaV0gPT09IGJbaV07IGkrKykge31cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gKGxpc3QsIHRvdGFsTGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVXNhZ2U6IEJ1ZmZlci5jb25jYXQobGlzdFssIGxlbmd0aF0pJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmICh0b3RhbExlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdG90YWxMZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHRvdGFsTGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIodG90YWxMZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmJ5dGVMZW5ndGggPSBmdW5jdGlvbiAoc3RyLCBlbmNvZGluZykge1xuICB2YXIgcmV0XG4gIHN0ciA9IHN0ciArICcnXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAncmF3JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggKiAyXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoID4+PiAxXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbi8vIHRvU3RyaW5nKGVuY29kaW5nLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0ID4+PiAwXG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA9PT0gSW5maW5pdHkgPyB0aGlzLmxlbmd0aCA6IGVuZCA+Pj4gMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSlcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gKGIpIHtcbiAgaWYoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpXG4gICAgICBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihieXRlKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IGJ5dGVcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gdXRmMTZsZVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBoZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0ID0gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSB1dGYxNmxlV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKHN0YXJ0ID09PSAwICYmIGVuZCA9PT0gYnVmLmxlbmd0aCkge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1Zi5zbGljZShzdGFydCwgZW5kKSlcbiAgfVxufVxuXG5mdW5jdGlvbiB1dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmVzID0gJydcbiAgdmFyIHRtcCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIGlmIChidWZbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgICAgIHRtcCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgIHRtcCArPSAnJScgKyBidWZbaV0udG9TdHJpbmcoMTYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcyArIGRlY29kZVV0ZjhDaGFyKHRtcClcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHJldHVybiBhc2NpaVNsaWNlKGJ1Ziwgc3RhcnQsIGVuZClcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2kgKyAxXSAqIDI1NilcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiAoc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgc3RhcnQgPSB+fnN0YXJ0XG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkID8gbGVuIDogfn5lbmRcblxuICBpZiAoc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgKz0gbGVuO1xuICAgIGlmIChzdGFydCA8IDApXG4gICAgICBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMClcbiAgICAgIGVuZCA9IDBcbiAgfSBlbHNlIGlmIChlbmQgPiBsZW4pIHtcbiAgICBlbmQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydClcbiAgICBlbmQgPSBzdGFydFxuXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHJldHVybiBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIHZhciBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQsIHRydWUpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gICAgcmV0dXJuIG5ld0J1ZlxuICB9XG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpXG4gICAgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4N2YsIC0weDgwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZiArIHZhbHVlICsgMVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAodGFyZ2V0LCB0YXJnZXRfc3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXNcblxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoIXRhcmdldF9zdGFydCkgdGFyZ2V0X3N0YXJ0ID0gMFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VFbmQgPCBzb3VyY2VTdGFydCcpXG4gIGlmICh0YXJnZXRfc3RhcnQgPCAwIHx8IHRhcmdldF9zdGFydCA+PSB0YXJnZXQubGVuZ3RoKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHNvdXJjZS5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiBzb3VyY2UubGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKVxuICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpXG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKGxlbiA8IDEwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldF9zdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRfc3RhcnQpXG4gIH1cbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFR5cGVFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBnZXQvc2V0IG1ldGhvZHMgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fZ2V0ID0gYXJyLmdldFxuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gaXNBcnJheWlzaCAoc3ViamVjdCkge1xuICByZXR1cm4gaXNBcnJheShzdWJqZWN0KSB8fCBCdWZmZXIuaXNCdWZmZXIoc3ViamVjdCkgfHxcbiAgICAgIHN1YmplY3QgJiYgdHlwZW9mIHN1YmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgICB0eXBlb2Ygc3ViamVjdC5sZW5ndGggPT09ICdudW1iZXInXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYiA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaWYgKGIgPD0gMHg3Rikge1xuICAgICAgYnl0ZUFycmF5LnB1c2goYilcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHN0YXJ0ID0gaVxuICAgICAgaWYgKGIgPj0gMHhEODAwICYmIGIgPD0gMHhERkZGKSBpKytcbiAgICAgIHZhciBoID0gZW5jb2RlVVJJQ29tcG9uZW50KHN0ci5zbGljZShzdGFydCwgaSsxKSkuc3Vic3RyKDEpLnNwbGl0KCclJylcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgaC5sZW5ndGg7IGorKykge1xuICAgICAgICBieXRlQXJyYXkucHVzaChwYXJzZUludChoW2pdLCAxNikpXG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KHN0cilcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpXG4gICAgICBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUylcblx0XHRcdHJldHVybiA2MiAvLyAnKydcblx0XHRpZiAoY29kZSA9PT0gU0xBU0gpXG5cdFx0XHRyZXR1cm4gNjMgLy8gJy8nXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIpXG5cdFx0XHRyZXR1cm4gLTEgLy9ubyBtYXRjaFxuXHRcdGlmIChjb2RlIDwgTlVNQkVSICsgMTApXG5cdFx0XHRyZXR1cm4gY29kZSAtIE5VTUJFUiArIDI2ICsgMjZcblx0XHRpZiAoY29kZSA8IFVQUEVSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIFVQUEVSXG5cdFx0aWYgKGNvZGUgPCBMT1dFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBMT1dFUiArIDI2XG5cdH1cblxuXHRmdW5jdGlvbiBiNjRUb0J5dGVBcnJheSAoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnJcblxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG5cdFx0fVxuXG5cdFx0Ly8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcblx0XHQvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG5cdFx0Ly8gcmVwcmVzZW50IG9uZSBieXRlXG5cdFx0Ly8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG5cdFx0Ly8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuXHRcdHZhciBsZW4gPSBiNjQubGVuZ3RoXG5cdFx0cGxhY2VIb2xkZXJzID0gJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDIpID8gMiA6ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAxKSA/IDEgOiAwXG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBuZXcgQXJyKGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycylcblxuXHRcdC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcblx0XHRsID0gcGxhY2VIb2xkZXJzID4gMCA/IGI2NC5sZW5ndGggLSA0IDogYjY0Lmxlbmd0aFxuXG5cdFx0dmFyIEwgPSAwXG5cblx0XHRmdW5jdGlvbiBwdXNoICh2KSB7XG5cdFx0XHRhcnJbTCsrXSA9IHZcblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDE4KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDEyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpIDw8IDYpIHwgZGVjb2RlKGI2NC5jaGFyQXQoaSArIDMpKVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwKSA+PiA4KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdGlmIChwbGFjZUhvbGRlcnMgPT09IDIpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA+PiA0KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDEwKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDQpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPj4gMilcblx0XHRcdHB1c2goKHRtcCA+PiA4KSAmIDB4RkYpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyclxuXHR9XG5cblx0ZnVuY3Rpb24gdWludDhUb0Jhc2U2NCAodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aFxuXG5cdFx0ZnVuY3Rpb24gZW5jb2RlIChudW0pIHtcblx0XHRcdHJldHVybiBsb29rdXAuY2hhckF0KG51bSlcblx0XHR9XG5cblx0XHRmdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShudW0gPj4gMTggJiAweDNGKSArIGVuY29kZShudW0gPj4gMTIgJiAweDNGKSArIGVuY29kZShudW0gPj4gNiAmIDB4M0YpICsgZW5jb2RlKG51bSAmIDB4M0YpXG5cdFx0fVxuXG5cdFx0Ly8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuXHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHVpbnQ4Lmxlbmd0aCAtIGV4dHJhQnl0ZXM7IGkgPCBsZW5ndGg7IGkgKz0gMykge1xuXHRcdFx0dGVtcCA9ICh1aW50OFtpXSA8PCAxNikgKyAodWludDhbaSArIDFdIDw8IDgpICsgKHVpbnQ4W2kgKyAyXSlcblx0XHRcdG91dHB1dCArPSB0cmlwbGV0VG9CYXNlNjQodGVtcClcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPT0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0XHRjYXNlIDI6XG5cdFx0XHRcdHRlbXAgPSAodWludDhbdWludDgubGVuZ3RoIC0gMl0gPDwgOCkgKyAodWludDhbdWludDgubGVuZ3RoIC0gMV0pXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAxMClcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA+PiA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgMikgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dHB1dFxuXHR9XG5cblx0ZXhwb3J0cy50b0J5dGVBcnJheSA9IGI2NFRvQnl0ZUFycmF5XG5cdGV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0odHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gKHRoaXMuYmFzZTY0anMgPSB7fSkgOiBleHBvcnRzKSlcbiIsImV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0xFID8gLTEgOiAxLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXTtcblxuICBpICs9IGQ7XG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIHMgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBlTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgZSA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IG1MZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhcztcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpO1xuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbik7XG4gICAgZSA9IGUgLSBlQmlhcztcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKTtcbn07XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgYyxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMCksXG4gICAgICBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNMRSA/IDEgOiAtMSxcbiAgICAgIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDA7XG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDA7XG4gICAgZSA9IGVNYXg7XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpO1xuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLTtcbiAgICAgIGMgKj0gMjtcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKTtcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKys7XG4gICAgICBjIC89IDI7XG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMDtcbiAgICAgIGUgPSBlTWF4O1xuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSBlICsgZUJpYXM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSAwO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpO1xuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG07XG4gIGVMZW4gKz0gbUxlbjtcbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KTtcblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjg7XG59O1xuIiwiXG4vKipcbiAqIGlzQXJyYXlcbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogdG9TdHJpbmdcbiAqL1xuXG52YXIgc3RyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBXaGV0aGVyIG9yIG5vdCB0aGUgZ2l2ZW4gYHZhbGBcbiAqIGlzIGFuIGFycmF5LlxuICpcbiAqIGV4YW1wbGU6XG4gKlxuICogICAgICAgIGlzQXJyYXkoW10pO1xuICogICAgICAgIC8vID4gdHJ1ZVxuICogICAgICAgIGlzQXJyYXkoYXJndW1lbnRzKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKiAgICAgICAgaXNBcnJheSgnJyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICpcbiAqIEBwYXJhbSB7bWl4ZWR9IHZhbFxuICogQHJldHVybiB7Ym9vbH1cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXkgfHwgZnVuY3Rpb24gKHZhbCkge1xuICByZXR1cm4gISEgdmFsICYmICdbb2JqZWN0IEFycmF5XScgPT0gc3RyLmNhbGwodmFsKTtcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICB0aGlzLl9ldmVudHMgPSB0aGlzLl9ldmVudHMgfHwge307XG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC4xMC54XG5FdmVudEVtaXR0ZXIuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9ldmVudHMgPSB1bmRlZmluZWQ7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSB1bmRlZmluZWQ7XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW4gMTAgbGlzdGVuZXJzIGFyZVxuLy8gYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaCBoZWxwcyBmaW5kaW5nIG1lbW9yeSBsZWFrcy5cbkV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCFpc051bWJlcihuKSB8fCBuIDwgMCB8fCBpc05hTihuKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ24gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzT2JqZWN0KHRoaXMuX2V2ZW50cy5lcnJvcikgJiYgIXRoaXMuX2V2ZW50cy5lcnJvci5sZW5ndGgpKSB7XG4gICAgICBlciA9IGFyZ3VtZW50c1sxXTtcbiAgICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfVxuICAgICAgdGhyb3cgVHlwZUVycm9yKCdVbmNhdWdodCwgdW5zcGVjaWZpZWQgXCJlcnJvclwiIGV2ZW50LicpO1xuICAgIH1cbiAgfVxuXG4gIGhhbmRsZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzVW5kZWZpbmVkKGhhbmRsZXIpKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAoaXNGdW5jdGlvbihoYW5kbGVyKSkge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgICAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGhhbmRsZXIpKSB7XG4gICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXG4gICAgbGlzdGVuZXJzID0gaGFuZGxlci5zbGljZSgpO1xuICAgIGxlbiA9IGxpc3RlbmVycy5sZW5ndGg7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKVxuICAgICAgbGlzdGVuZXJzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIG07XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT09IFwibmV3TGlzdGVuZXJcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJcIi5cbiAgaWYgKHRoaXMuX2V2ZW50cy5uZXdMaXN0ZW5lcilcbiAgICB0aGlzLmVtaXQoJ25ld0xpc3RlbmVyJywgdHlwZSxcbiAgICAgICAgICAgICAgaXNGdW5jdGlvbihsaXN0ZW5lci5saXN0ZW5lcikgP1xuICAgICAgICAgICAgICBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgZWxzZSBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuICBlbHNlXG4gICAgLy8gQWRkaW5nIHRoZSBzZWNvbmQgZWxlbWVudCwgbmVlZCB0byBjaGFuZ2UgdG8gYXJyYXkuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXSwgbGlzdGVuZXJdO1xuXG4gIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pICYmICF0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkKSB7XG4gICAgdmFyIG07XG4gICAgaWYgKCFpc1VuZGVmaW5lZCh0aGlzLl9tYXhMaXN0ZW5lcnMpKSB7XG4gICAgICBtID0gdGhpcy5fbWF4TGlzdGVuZXJzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgfVxuXG4gICAgaWYgKG0gJiYgbSA+IDAgJiYgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCA+IG0pIHtcbiAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQgPSB0cnVlO1xuICAgICAgY29uc29sZS5lcnJvcignKG5vZGUpIHdhcm5pbmc6IHBvc3NpYmxlIEV2ZW50RW1pdHRlciBtZW1vcnkgJyArXG4gICAgICAgICAgICAgICAgICAgICdsZWFrIGRldGVjdGVkLiAlZCBsaXN0ZW5lcnMgYWRkZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAnVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gaW5jcmVhc2UgbGltaXQuJyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCk7XG4gICAgICBpZiAodHlwZW9mIGNvbnNvbGUudHJhY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gbm90IHN1cHBvcnRlZCBpbiBJRSAxMFxuICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIHZhciBmaXJlZCA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIGcoKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBnKTtcblxuICAgIGlmICghZmlyZWQpIHtcbiAgICAgIGZpcmVkID0gdHJ1ZTtcbiAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG5cbiAgZy5saXN0ZW5lciA9IGxpc3RlbmVyO1xuICB0aGlzLm9uKHR5cGUsIGcpO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gZW1pdHMgYSAncmVtb3ZlTGlzdGVuZXInIGV2ZW50IGlmZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWRcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbGlzdCwgcG9zaXRpb24sIGxlbmd0aCwgaTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXR1cm4gdGhpcztcblxuICBsaXN0ID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBsZW5ndGggPSBsaXN0Lmxlbmd0aDtcbiAgcG9zaXRpb24gPSAtMTtcblxuICBpZiAobGlzdCA9PT0gbGlzdGVuZXIgfHxcbiAgICAgIChpc0Z1bmN0aW9uKGxpc3QubGlzdGVuZXIpICYmIGxpc3QubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgfSBlbHNlIGlmIChpc09iamVjdChsaXN0KSkge1xuICAgIGZvciAoaSA9IGxlbmd0aDsgaS0tID4gMDspIHtcbiAgICAgIGlmIChsaXN0W2ldID09PSBsaXN0ZW5lciB8fFxuICAgICAgICAgIChsaXN0W2ldLmxpc3RlbmVyICYmIGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgICAgICBwb3NpdGlvbiA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICByZXR1cm4gdGhpcztcblxuICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgbGlzdC5sZW5ndGggPSAwO1xuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdC5zcGxpY2UocG9zaXRpb24sIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGtleSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgaWYgKCF0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIGVsc2UgaWYgKHRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBlbWl0IHJlbW92ZUxpc3RlbmVyIGZvciBhbGwgbGlzdGVuZXJzIG9uIGFsbCBldmVudHNcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBmb3IgKGtleSBpbiB0aGlzLl9ldmVudHMpIHtcbiAgICAgIGlmIChrZXkgPT09ICdyZW1vdmVMaXN0ZW5lcicpIGNvbnRpbnVlO1xuICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICB9XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbW92ZUxpc3RlbmVyJyk7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzRnVuY3Rpb24obGlzdGVuZXJzKSkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBMSUZPIG9yZGVyXG4gICAgd2hpbGUgKGxpc3RlbmVycy5sZW5ndGgpXG4gICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyc1tsaXN0ZW5lcnMubGVuZ3RoIC0gMV0pO1xuICB9XG4gIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSBbXTtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbih0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IFt0aGlzLl9ldmVudHNbdHlwZV1dO1xuICBlbHNlXG4gICAgcmV0ID0gdGhpcy5fZXZlbnRzW3R5cGVdLnNsaWNlKCk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5FdmVudEVtaXR0ZXIubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKGVtaXR0ZXIsIHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCFlbWl0dGVyLl9ldmVudHMgfHwgIWVtaXR0ZXIuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSAwO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKGVtaXR0ZXIuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gMTtcbiAgZWxzZVxuICAgIHJldCA9IGVtaXR0ZXIuX2V2ZW50c1t0eXBlXS5sZW5ndGg7XG4gIHJldHVybiByZXQ7XG59O1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gYXJnID09PSB2b2lkIDA7XG59XG4iXX0=
