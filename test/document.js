module.exports = function(){
    var domLite = require('dom-lightning');

    document = domLite.document;
    document.body = document.createElement('body');
    
    global.Node = domLite.Node;
    global.document = document;
    global.Element = domLite.Element;
    global.HTMLElement = domLite.HTMLElement;
};