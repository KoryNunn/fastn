# fastn

Create ultra-lightweight UI components

![fastn](fastn-sml.png)

## [Try it](http://korynunn.github.io/fastn/try/)

## [Example app](http://korynunn.github.io/fastn/example/)

# Usage

The absolute minimum required to make a fastn component:

initialise fastn:
```javascript
// Require and initialise fastn
var fastn = require('fastn/')({
    // component constructors
    _generic: require('fastn/genericComponent'),
    list: require('fastn/listComponent')
});

var something = fastn('h1', 'Hello World');

document.body.appendChild(something.element);
```

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
