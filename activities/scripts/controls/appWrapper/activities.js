var activityRouter = require('../../activityRouter'),
    pages = require('../../pages');

module.exports = fastn('list', {
    class: 'activities',
    items: activityRouter.binding,
    template: function(){
        return fastn('templater', {
            data: fastn.binding('item|*'),
            attachTemplates: false,
            template: function(model, scope, lastComponent){
                var name = model.get('item.name'),
                    route = activityRouter.router.get(name, model.get('item.values'));

                if(lastComponent && lastComponent.route === route){
                    return lastComponent;
                }

                var activity = fastn('div', {
                        'class': fastn.binding('item.name', function(name){
                            return ['activity', name];
                        })
                    },
                    pages[name] && pages[name](fastn, model)
                );

                activity.route = route;

                return activity;
            }
        });
    }
});