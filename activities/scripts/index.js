var doc = require('doc-js'),
    appWrapper = require('./controls/appWrapper');

appWrapper.attach().render();

doc.ready(function(){
    document.body.appendChild(appWrapper.element);
});