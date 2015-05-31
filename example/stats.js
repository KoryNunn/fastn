var fastn = require('./fastn');

module.exports = function(){

    return fastn('div', {class: 'stats'},
        'This example has ',
        fastn.binding('attachedEntis'),
        ' attached model instances'
    ).on('attach', function(data){
        setInterval(function(){
            fastn.Model.set(data, 'attachedEntis', fastn.Model.prototype.attachedCount());
        },100);
    });
    
};