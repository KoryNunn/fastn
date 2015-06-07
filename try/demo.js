var app = fastn('div',
    fastn('h1', 'My Cool App'),

    // Create a clear button
    fastn('button', 'Clear')
        // Clear 'stuff' on click
        .on('click', function(event, scope){
            scope.set('stuff', '')
        }),

    // create an input
    fastn('input', {

        //Bind its value to 'stuff'
        value: fastn.binding('stuff'),

        // automatically set the components `value` to its element's `value` on keyup
        onkeyup: 'value:value'
    }),

    // Output a binding as text
    fastn.binding('stuff')
)
.attach({
    stuff: 'things'
});

return app;