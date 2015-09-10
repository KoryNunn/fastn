# Changelog for fastn


## v2

Version two of fastn changes the way the component constructors work, to allow for better composition of components.

In fastn v1, component constructors would create a component, modify it, then return it.

In fastn v2, component constructors are passed a component, and they may extend it with functionality.

The v1 way:

```

function myCoolComponentConstructor(fastn, type, settings, children){
    var component = fastn.base(type, settings, children);

    // Add properties, implement/override methods, etc...

    return component;
}

```

The v2 way:

```

function myCoolComponentConstructor(fastn, component, type, settings, children){
    // Add properties, implement/override methods, etc...

    return component;
}

```

## Extending

In v1, if you wanted to make a component that was an extension of another component, you would do something like this:

```

function myCoolFancyList(fastn, type, settings, children){

    // Create a list.
    var component = fastn.createComponent('list', settings, children);

    // Add properties, implement/override methods, etc...

    return component;
}

```

in v2, you can just call .extend()...


```

function myCoolComponentConstructor(fastn, component, type, settings, children){

    // Become a list.
    component.extend('list', settings, children);

    // Add properties, implement/override methods, etc...

    return component;
}

```

Which is extremely handy if you want features from multiple components:


```

function myCoolComponentConstructor(fastn, component, type, settings, children){

    // Become a list.
    component.extend('list', settings, children);

    // Also be a modal
    component.extend('modal', settings, children);

    // Also be a whatever
    component.extend('whatever', settings, children);

    // Add properties, implement/override methods, etc...

    return component;
}

```

# Why

In fastn v2, you can mix components together when you create them, like so:

```
var myMapList = fastn('list:map', { ... });
```

Fastn will, under the covers, extend all the types together in the order they are listed, so the above example is equivilent to:

fastn('list', settings, children...).extend('map', settings, children...);

## Details

### API

#### Removed

 - fastn.createComponent

#### Changed

 - componant constructor parameters (fastn, type, settings, children) -> (fastn, component, type, settings, children)
 - component.setProperty can now be passed only a key, which will use the existing property, or create a new default one for that key.

#### Added

 - Mixin syntax, fastn('componantType1:componantType2')
 - componant.extend(componantType, settings, children)
 - componant.is(componantType) -> bool
 - fastn.componants._container is now defaulted to containerComponant.

### Best Practice

#### Composition

In v1, you could add functionality to a componant arbitrarily, with no real structure

In v2, obviously, using the fastn('foo:bar') style is recommended.

#### Adding properties

In v1, properties were generally added via

```
property.addTo(componant, key);
```

In v2 this is deprecated, and it is encouraged that you instead use:

```
componant.setProperty('key', property);
```
