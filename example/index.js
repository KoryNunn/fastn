var components = {
    _generic: require('../genericComponent'),
    list: require('../listComponent')
};

var fastn = require('../')(components),
    binding = fastn.binding,
    Enti = require('enti'),
    crel = require('crel');

var model = {
        uiState: {
            foo: 'bar'
        }
    },
    enti = new Enti(model);

// window.onload = function(){
//     var app = fastn('div',
//         require('./userList')(fastn)
//     );

//     app.attach(model);
//     app.render();

//     window.app = app;

//     enti.set('users', require('./users.json'))

//     crel(document.body, app.element);
// };

window.onload = function(){
    var thing = {
        foo: 'baz'
    };

    var app = fastn('div', {
            scope:{
                selected: fastn.binding('selected')
            }
        },
        fastn('div', {
            textContent: fastn.binding('foo')
        }),
        fastn('input', {
            onkeyup: 'value',
            onclick: function(event, scope){
                fastn.binding('foo')
            },
            value: fastn.binding('foo')
        }),
        fastn('div', {
            textContent: fastn.binding('foo').attach(thing)
        })
    );

    app.attach(model);
    app.render();

    window.app = app;
    window.enti = enti;
    window.thing = thing;
    window.Enti = Enti;

    enti.set('foo', 'bar');

    crel(document.body, app.element);
};