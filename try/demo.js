
// Create a component to represent our app.
var app = fastn('div',

    // Create a heading.
    fastn('h1', 'My Cool App'),

    // Create a clear button
    fastn('button', 'Clear')
        // Clear 'stuff' on click
        .on('click', function(event, scope){
            scope.set('stuff', '')
        }),

    // create an input
    fastn('input', {

        // Bind its value to 'stuff'
        value: fastn.binding('stuff'),

        // automatically set the components `value` to its element's `value` on keyup
        onkeyup: 'value:value'
    }),

    // Output a binding as text
    fastn.binding('stuff')
);

// Attach the app component to some data.
app.attach({
    stuff: 'things'
});

// Render the app component.
app.render();

// Append the app components element to <body>
document.body.appendChild(app.element);