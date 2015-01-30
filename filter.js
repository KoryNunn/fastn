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