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