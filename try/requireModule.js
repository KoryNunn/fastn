var cpjax = require('cpjax');
var MODULE_NOT_LOADED = 'Module not loaded';
var path = require('path');
var codeCache;

try {
    codeCache = JSON.parse(localStorage.getItem('fastn-tryer-code-cache')) || {};
} catch (error) {
    codeCache = {}
}

function getCode(modulePath, callback){
    if(modulePath in codeCache){
        setTimeout(function(){
            callback(null, codeCache[modulePath]);
        })
        return;
    }

    cpjax('https://unpkg.com/' + modulePath, function(error, code){
        if(error){
            callback(error);
            return;
        }

        codeCache[modulePath] = code;
        localStorage.setItem('fastn-tryer-code-cache', JSON.stringify(codeCache));
        callback(null, code);
    })
}

module.exports = function(moduleGlobal){
    var cache = {};
    var retries = [];

    function customRequire(relativeModulePath, originPath){
        if(!relativeModulePath){
            throw new Error('Invalid require path');
        }

        var modulePath = relativeModulePath;
        if(relativeModulePath.match(/^\./)){
            modulePath = (
                originPath ? path.resolve(originPath.replace(/(.*)\/.*?$/, '$1'), relativeModulePath) : relativeModulePath
            ).replace(/^\//, '');
        }

        if(modulePath in cache){
            if(cache[modulePath].isLoading){
                throw new Error(MODULE_NOT_LOADED + ': ' + modulePath)
            }

            return cache[modulePath].module.exports;
        }

        cache[modulePath] = {
            isLoading: true
        };


        getCode(modulePath, function(error, code){
            if(error){
                console.error(error);
                return;
            }

            var requiredModule = new Function('require', 'module', 'exports', 'global', code)
            var moduleExports = {};
            cache[modulePath].module = { exports: moduleExports };
            cache[modulePath].require = requirePath => customRequire(requirePath, modulePath)
            var requireModule = () => {
                try {
                    requiredModule(
                        cache[modulePath].require,
                        cache[modulePath].module,
                        moduleExports,
                        moduleGlobal
                    );

                    cache[modulePath].isLoading = false;

                    var toRetry = retries.slice();
                    retries = [];

                    while(toRetry.length){
                        toRetry.shift()()
                    }
                } catch(error) {
                    if(error.message && error.message.includes(MODULE_NOT_LOADED)){
                        retries.push(requireModule)
                        return;
                    }

                    throw error
                }
            };

            requireModule();
        });

        throw new Error(MODULE_NOT_LOADED + ': ' + modulePath)
    }

    return {
        require: customRequire,
        MODULE_NOT_LOADED: MODULE_NOT_LOADED
    };
}