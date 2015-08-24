var createActivityRouter = require('activity-router'),
    routes = require('./routes'),
    fastn = require('../fastn');

var activityRouter = createActivityRouter(routes),
    activitiesModel =  new fastn.Model({
        activities: []
    }),
    activitiesBinding = fastn.binding('activities|*').attach(activitiesModel);

function updateInfo(route){
    fastn.Model.set(route, '_info', activityRouter.router.info(route.name));
}

activityRouter.on('add', function(activity, index){
    updateInfo(activity);
    activitiesModel.push('activities', activity);
});
activityRouter.on('update', function(activity, index){
    activitiesModel.update('activities.' + index, activity);
});
activityRouter.on('replace', function(activity, index){
    updateInfo(activity);
    activitiesModel.set('activities.' + index, activity);
});
activityRouter.on('remove', function(activity, index){
    activitiesModel.remove('activities', index);
});

activityRouter.binding = activitiesBinding;

activityRouter.init();

module.exports = activityRouter;