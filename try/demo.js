return fastn('div',
    fastn('h1', 'My Cool App'),

    // create an input
    fastn('input', {

        //Bind it's value to 'stuff'
        value: fastn.binding('stuff'),

        // automativally set the components `value` to it's elements `value` on keyup
        onkeyup: 'value:value'
    }),

    // Output a binding as text
    fastn.binding('stuff')
)
.attach({
    stuff: 'things'
});