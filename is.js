
function isComponent(thing){
    return thing && typeof thing === 'object' && '_fastn_component' in thing;
}

function isBindingObject(thing){
    return thing && typeof thing === 'object' && '_fastn_binding' in thing;
}

function isBinding(thing){
    return thing && typeof thing === 'function' && '_fastn_binding' in thing;
}

function isProperty(thing){
    return thing && typeof thing === 'function' && '_fastn_property' in thing;
}

module.exports = {
    component: isComponent,
    bindingObject: isBindingObject,
    binding: isBinding,
    property: isProperty
};