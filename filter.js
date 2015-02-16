var Enti = require('enti');

function watchKey(updateOn, childWatches, object, key, rest, model, isDoubleStar, isValueStar, handler){
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
            watchKey(updateOn, childWatches, object, key, rest, model, isDoubleStar, isValueStar, handler);
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