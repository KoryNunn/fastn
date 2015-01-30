root:[
    {foo:1},
    {foo:2},
    {foo:3, hide:true},
    {foo:4}
]

fastn.binding('.*.hide', function(items){
    return items.filter(function(item){
        return !item.hide;
    })
}).attach(rootModel);


fastn.binding('.').attach(rootModel);

fastn.binding('.|*').attach(rootModel);

fastn.binding('.|*.foo').attach(rootModel);

fastn.binding('1.foo').attach(rootModel);

fastn.binding('.|1.foo').attach(rootModel);

fastn.binding('.|**').attach(rootModel);

fastn.binding('.|*.*.foo').attach(rootModel);