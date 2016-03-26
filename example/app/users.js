var cpjax = require('cpjax'),
    Enti = require('enti'),
    store = Enti.store;

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

module.exports = function(app){
    var service = {
        all: [],
        active: [],
        visible: []
    };

    function updateUsers(){
        var active = service.all.filter(function(user){
            return !user.removed;
        });

        store(service, 'active', active);

        store(service, 'visible', active.filter(function(user){
            if(!user || !user.name || !user.name.first || !user.name.last){
                return;
            }

            if(!service.search){
                return true;
            }

            return (
                ~user.name.first.toLowerCase().indexOf(service.search.toLowerCase()) ||
                ~user.name.last.toLowerCase().indexOf(service.search.toLowerCase())
            );
        }));
    }

    function setUsers(users){
        store(service, 'all', users);
        updateUsers(users);
    }

    app.on('init', function(){
        getUsers(function(error, users){
            if(error){
                return;
            }

            setUsers(users);
        });
    });

    function removeUser(user){
        store(user, 'removed', true);
        updateUsers();
    }

    function addUser(user){
        Enti.insert(service.users, user, 0);
        updateUsers();
    }

    function setSelected(user){
        store(service, 'selected', user);
    }

    function createNewUser(){
        var newUser = {
            save: function(){
                addUser(newUser);
            },
            cancel: function(){
                store(service, 'newUser', null);
            }
        };

        store(service, 'newUser', newUser);
    }

    function search(searchString){
        store(service, 'search', searchString);
        updateUsers();
    }

    service.remove = removeUser;
    service.create = createNewUser;
    service.setSelected = setSelected;
    service.setSearch = search;

    return service;
};