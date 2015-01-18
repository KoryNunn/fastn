module.exports = function(fastn){
    var selectedUser = fastn.binding('selectedUser').attach({});


    return fastn('list', {
        items: fastn.binding('foo').attach({
            foo: [1,2,3]
        }),
        template: function(){
            return fastn('label', {textContent: fastn.binding('item')})
        }
    });
};