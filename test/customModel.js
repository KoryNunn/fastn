var test = require('tape'),
    EventEmitter = require('events'),
    createFastn = require('../index');

var allModels = new Set();

function CustomModel(instance){
    allModels.add(this);

    this._model = instance;

    this;

    return this;
}
CustomModel.prototype = Object.create(EventEmitter.prototype);
CustomModel.prototype.constructor = CustomModel;
CustomModel.prototype._maxListeners = 100;
CustomModel.prototype.constructor = CustomModel;
CustomModel.prototype.attach = function(instance){
    if(this._model !== instance){
        this.detach();
    }

    allModels.add(this);
    this._attached = true;
    this._model = instance;
    this.emit('attach', instance);
};
CustomModel.prototype.detach = function(){
    allModels.delete(this);

    this._model = {};
    this._attached = false;
    this.emit('detach');
};
CustomModel.prototype.destroy = function(){
    this.detach();
    this._events = null;
    this.emit('destroy');
};
var matchKeys = /(.*?)(?:\.(.*)|$)/;
CustomModel.prototype.get = function(key){
    var match = key.match(matchKeys),
        target = this._model;

    if(!match){
        return;
    }

    while(match[2]){
        if(!target){
            return;
        }

        target = target[match[1]];
        match = match[2].match(matchKeys);
    }

    if(!target){
        return;
    }

    return target[match[1]];
};
CustomModel.prototype.set = function(key, value){
    var customModel = this,
        match = key.match(matchKeys),
        target = this._model;

    if(!match){
        return;
    }

    while(match[2]){
        if(!target){
            return;
        }

        target = target[match[1]];
        match = match[2].match(matchKeys);
    }

    if(!target){
        return;
    }

    target[match[1]] = value;
    allModels.forEach(function(model){
        if(model.isAttached() && model._model === customModel._model){
            model._events && Object.keys(model._events).forEach(function(key){
                if(model.get(key.match(/(.*?)\./)[1]) === target){
                    model.emit(key, value);
                }
            });
        }
    });
    return this;
};
CustomModel.prototype.isAttached = function(){
    return !!this._model;
};
CustomModel.isModel = function(target){
    return target && target instanceof CustomModel;
};


test('binding with custom model', function(t){
    t.plan(4);

    var fastn = createFastn({});
    fastn.Model = CustomModel;
    fastn.isModel = CustomModel.isModel;

    var binding = fastn.binding('foo');

    var model = {},
        enti = new CustomModel(model);

    t.equal(binding(), undefined);

    enti.set('foo', 'bar');

    t.equal(binding(), undefined);

    binding.attach(model);

    t.equal(binding(), 'bar');

    binding.detach();

    t.equal(binding(), undefined);
});