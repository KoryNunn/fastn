var getModelsAndBindings = function getModelsAndBindings(component){
    var keys = Object.keys(component);
    return {
        type: component._type,
        element: component.element,
        scope: component.scope()._model,
        props: keys.reduce(function(props, key){
            if(component[key] && component[key]._fastn_property){
                var binding = component[key].binding();

                if(!binding){
                    return props;
                }

                props[key] = component[key].binding()._fastn_binding;
            }

            return props;
        }, {}),
        children: component._children.map(getModelsAndBindings)
    };
}