/*
    A convenience singleton that sets up fastn so it can be required from other files.
*/

module.exports = require('fastn')(
    require('fastn/domComponents')(), // Default components for rendering DOM.
    true // Pass true as the second parameter to turn on debug mode.
);