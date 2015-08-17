var fastn = require('../../fastn'),
    activityRouter = require('../../activityRouter');

module.exports = fastn('header', {class: 'appBar'},

    fastn('button', {class: 'navIcon'},
        fastn('i', {class: 'close'})
    ).on('click', function(){
        activityRouter.pop();
    }),

    fastn('h1', fastn.binding(activityRouter.binding, function(activities){
        var topActivity = activities[activities.length-1];
        return topActivity ? topActivity._info.title : 'Activities Example';
    }))

);