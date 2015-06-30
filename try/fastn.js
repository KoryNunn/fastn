/*
    A convenience singleton that sets up fastn so it can be required from other files.
*/

module.exports = require('fastn')({ // Require fastn

    // set up fastn with all the components you need for your application

    // The list component is used to render items based on a set of data.
    list: require('fastn/listComponent'),

    // The templater component is used to render a component based on arbitrary data.
    templater: require('fastn/templaterComponent'),

    // The text component is used to render text or bindings passed as children to other components.
    text: require('fastn/textComponent'),

    // The _generic component is a catch-all for any component type that
    //  doesnt match any other component constructor, eg: 'div'
    _generic: require('fastn/genericComponent')

}, true); // Pass true as the second parameter to turn on debug mode.