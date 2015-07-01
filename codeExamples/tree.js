function person(){
    return fastn('li',

        fastn('label', 'Name:'), fastn.binding('name'),

        fastn('label', fastn.binding('children.length', function(any){
            return any ? 'Children:' : 'No children';
        })),
        
        fastn('list', {
            tagName: 'ul',
            items: fastn.binding('children'),
            template: function(){
                return person().binding('item');
            }
        })
    );
}

var app = person()
    .attach({name: 'Jill', children: [{name: 'Bob', children: [{name: 'Ann'} ]}, {name: 'John' } ] })
    .render();

document.body.appendChild(app.element);