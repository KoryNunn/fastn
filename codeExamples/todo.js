var todos = new fastn.Model({todos:[]});

function addTodo(todo){
    todos.push('todos', todo);
}

var newTodoBinding = fastn.binding('newTodo');

var app = fastn('div',
    fastn('list', {
        tagName: 'ul',
        items: fastn.binding('todos|*'),
        template: function(){
            return fastn('li', fastn.binding('item'));
        }
    }),
    fastn('form', 
        fastn('input', {
            placeholder: 'New ToDo',
            value: newTodoBinding,
            onchange: 'value:value'
        }),
        fastn('button', 'Add #', fastn.binding('todos.length', function(length){
            return length + 1;
        }))
    ).on('submit', function(event){
        event.preventDefault();
        addTodo(newTodoBinding());
        todos.set('newTodo', '');
    })
)
.attach(todos).render();

document.body.appendChild(app.element);