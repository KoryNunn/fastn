var count = fastn.binding('count').attach({ count: 0 });

var app = fastn('button', 'Current count: ', count)
    .on('click', function(){
        count(count()+1);
    })
    .render();

document.body.appendChild(app.element);