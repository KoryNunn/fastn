# fastn

Create ultra-lightweight UI components

![fastn](http://korynunn.github.io/fastn/fastn-sml.png)

## [Try it](http://korynunn.github.io/fastn/try/)

## [Example app](http://korynunn.github.io/fastn/example/)

# Usage

The absolute minimum required to make a fastn component:

initialise fastn:
```javascript
// Require and initialise fastn
var fastn = require('fastn/')({
    // component constructors.. Add what you need to use

    text: require('fastn/textComponent'), // Renders text
    _generic: require('fastn/genericComponent') // Renders DOM nodes
});

var something = fastn('h1', 'Hello World');

something.render();

window.addEventListener('load', function(){
    document.body.appendChild(something.element);
});
```
[^ try it](http://korynunn.github.io/fastn/try/#InJldHVybiBmYXN0bignaDEnLCAnSGVsbG8gV29ybGQnKTsi)

`fastn` is a function with the signature:

```javascript
fastn(type[, settings, children...])
```

which can be used to create a UI:

```javascript
// Create some component
var someComponent = fastn('section',
        fastn('h1', 'I\'m a component! :D'),
        fastn('a', {href: 'http://google.com'}, 'An anchor')
    );

someComponent.render();

// Append the components element to the DOM
document.body.appendChild(someComponent.element);
```
[^ try it](http://korynunn.github.io/fastn/try/#InJldHVybiBmYXN0bignc2VjdGlvbicsXG5cdGZhc3RuKCdoMScsICdJXFwnbSBhIGNvbXBvbmVudCEgOkQnKSxcblx0ZmFzdG4oJ2EnLCB7aHJlZjogJ2h0dHA6Ly9nb29nbGUuY29tJ30sICdBbiBhbmNob3InKVxuKTsi)

You can assign bindings to properties:

```javascript

var someComponent = fastn('section',
        fastn('h1', 'I\'m a component! :D'),
        fastn('a', {href: fastn.binding('url')},
            fastn('label', 'This link points to '),
            fastn('label', fastn.binding('url'))
        )
    );

someComponent.attach({
    url: 'http://google.com'
});

```

Which can be updated via a number of methods.


```javascript

someComponent.scope().set('url', 'http://bing.com');


```
[^ try it](http://korynunn.github.io/fastn/try/#InZhciBzb21lQ29tcG9uZW50ID0gZmFzdG4oJ3NlY3Rpb24nLFxuICAgICAgICBmYXN0bignaDEnLCAnSVxcJ20gYSBjb21wb25lbnQhIDpEJyksXG4gICAgICAgIGZhc3RuKCdhJywge2hyZWY6IGZhc3RuLmJpbmRpbmcoJ3VybCcpfSxcbiAgICAgICAgICAgIGZhc3RuKCdsYWJlbCcsICdUaGlzIGxpbmsgcG9pbnRzIHRvICcpLFxuICAgICAgICAgICAgZmFzdG4oJ2xhYmVsJywgZmFzdG4uYmluZGluZygndXJsJykpXG4gICAgICAgIClcbiAgICApO1xuXG5zb21lQ29tcG9uZW50LmF0dGFjaCh7XG4gICAgdXJsOiAnaHR0cDovL2dvb2dsZS5jb20nXG59KTtcblxuc2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRzb21lQ29tcG9uZW50LnNjb3BlKCkuc2V0KCd1cmwnLCAnaHR0cDovL2JpbmcuY29tJyk7XG59LCAyMDAwKTtcblxucmV0dXJuIHNvbWVDb21wb25lbnQ7Ig==)

## Special component types

There are a few special component types that are used as shorthands for some situations:

### `text`

if a string or `binding` is added as a child into a containerComponent, fastn will look for a `text` component, set it's `text` to the string or `binding`, and insert it. This is handy as you don't need to write: `fastn('text', 'foo')` all over the place.
[^ try it](http://korynunn.github.io/fastn/try/#InJldHVybiBmYXN0bignZGl2Jyxcblx0ZmFzdG4oJ3RleHQnLCB7dGV4dDogJ0V4cGxpY2l0IHRleHQsICd9KSxcblx0J0ltcGxpY2l0IHRleHQsICcsXG4gICAgZmFzdG4uYmluZGluZygnYm91bmRUZXh0JylcbikuYXR0YWNoKHtcbiAgXHRib3VuZFRleHQ6ICdCb3VuZCB0ZXh0J1xufSk7Ig==)

### `_generic`

if the type passed to fastn does not exactly match any component it knows about, fastn will check for a `_generic` component, and pass all the settings and children through to it. 
[^ try it](http://korynunn.github.io/fastn/try/#InJldHVybiBmYXN0bignZGl2JyxcbiAgICAgICAgICAgICBcblx0ZmFzdG4oJ3NwYW4nLCAnV29vIGEgc3BhbiEnKSxcbiAgICAgICAgICAgICBcblx0ZmFzdG4oJ2JyJyksIC8vIEJyIGJlY2F1c2Ugd2UgY2FuIVxuICAgICAgICAgICAgIFxuICAgIGZhc3RuKCdhJywge2hyZWY6ICdodHRwczovL2dpdGh1Yi5jb20va29yeW51bm4vZmFzdG4nfSwgJ0FuIGFuY2hvcicpLFxuICAgICAgICAgICAgIFxuXHRmYXN0bignYnInKSwgLy8gQW5vdGhlciBiciBmb3IgcmVhc29uc1xuICAgICAgICAgICAgIFxuICAgIGZhc3RuKCdpbWcnLCB7dGl0bGU6ICdBd2Vzb21lIGxvZ28nLCBzcmM6ICdodHRwOi8va29yeW51bm4uZ2l0aHViLmlvL2Zhc3RuL3RyeS9mYXN0bi1zbWwucG5nJ30pXG4pOyI=)

## Default components

fastn includes 4 extremely simple default components that render as DOM. It is not neccisary to use them, and you can replace them with your own to render to anything you want to.

### textComponent

A default handler for the `text` component type that renders a textNode. eg:

```
fastn('something', // render a thing
    'Some string passed as a child' // falls into the `text` component, renderes as a textNode
)
```

### genericComponent

A default handler for the `_generic` component type that renders DOM nodes based on the type passed, eg:

```
fastn('div') // no component is assigned to 'div', fastn will search for _generic, and if this component is assigned to it, it will create a div element.
```

### listComponent

takes a template and inserts children based on the result of its `items` property, eg:

```
fastn('list', {
    items: [1,2,3],
    template: function(){
        return fastn.binding('item')
    }
})
```
the templated componets will be attached to a model that contains `key` and `item`, where `key` is the key in the set that they correspond to, and `item` is the data of the item in the set.

### templaterComponent

takes a tempalte and replaces itself with the component rendered by the template. Returning null from the template indicates that nothing should be inserted. 

The template funciton will be passed the last component that was rendered by it as the third parameter.

```
fastn('templater', {
    data: 'foo',
    template: function(model, scope, currentComponent){
        if(model.get('item') === 'foo'){
            return fastn('img');
        }else{
            return null;
        }
    }
})
```

## A little deeper..

A component can be created by calling `fastn` with a `type`, like so:

```javascript
var myComponent = fastn('myComponent');
```

This will create a component regestered in `components` with the key `'myComponent'`

if `'myComponent'` is not found, fastn will check for a `'_generic'` constructor, and use that if defined. The generic component will create a DOM element of the given type passed in, and is likely the most common component you will create.

```javascript
var divComponent = fastn('div', {'class':'myDiv'});
```

The above will create a `component`, that renderes as a `div` with a class of `'myDiv'`

## `fastn.binding(key)`

Creates a binding with the given key.

A binding can be attached to data using `.attach(object)`.


# The Bits..

There are very few parts to fastn, they are:

`component`, `property`, and `binding`

If you are just want to render some DOM, you will probably be able to just use the default ones.

## `component`

A fastn `component` is an object that represents a chunk of UI.

A `component` is created by a function that returns an instance of `EventEmitter`.

### Implementation

Here is an example of an extremely simple component constructor

```javascript
function(){
    var thingy = new (require('events').EventEmitter)();

    thingy.render = function(){
        thingy.element = document.createElement('span');
        thingy.element.innerText = 'FOO!';
        thingy.emit('render');
    };

    return thingy;
}
```

### Required properties

- All from `EventEmitter`.

- `render` must:

    - assign an element of some kind to component.element.
    - `emit('render')`

## `property`

A fastn property is a getterSetter function and EventEmitter.

```javascript
function property([value])
```

### Implementation

a property must be a function that:

- given 0 arguments, returns its current value.
- given > 0 arguments,
    - set its value
    - `emit('change')`
    - call its `.update()` method with the new value.

A property should NOT emit change if the value being set has not changed
**The developer may decide what constitutes a change.**


### Required properties

- All from EventEmitter.

- `_fastn_property` lets fastn know to treat it as a `property`.

- `render()` must:

    - assign an element of some kind to component.element.
    - `emit('render')`

- `update()` must:
    - `emit('update')`

- `attach()` may:
    - attach to some object

- `detach()` may:
    - detach from its currently attached object

- `binding()` may:
    - update the properties binding

## `binding`

A fastn `binding` is a getterSetter function and `EventEmitter`.

It is used as a mapping between an object and a value on that object.

### Implementation

```javascript
function binding([value])
```

a `binding` must be a function that:

- given 0 arguments, returns its current value.
- given > 0 arguments,
    - set its value
    - `emit('change')`
    - call its `.update()` method with the new value.


### Required properties

- All from EventEmitter.

- `_fastn_binding` set to the key the binding is set to. Lets fastn know to treat it as a `binding`.

- `attach()` may:
    - attach to some object

- `detach()` may:
    - detach from its currently attached object
