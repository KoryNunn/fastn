var activityRouter = require('../activityRouter');

module.exports = function(fastn, activityModel) {
    return fastn('div', {'class':'page'},

        fastn('h1', 'Activity ', fastn.binding('key')),

        fastn('h3', 'Route value: ', fastn.binding('item.values.value')),

        fastn('button', 'Open an activity on top')
            .on('click', function(){
                activityRouter.add('home', {value: Math.random()});
            }),

        fastn('button', 'Close this activity')
            .on('click', function(){
                activityRouter.pop();
            }),

        fastn('button', 'Close all activities')
            .on('click', function(){
                activityRouter.reset('home');
            })
    )
};