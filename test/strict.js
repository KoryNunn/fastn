'use strict';

var test = require('tape'),
    createFastn = require('./createFastn'),
    domComponents = require('../domComponents');

test('binding', function(t){
    t.plan(1);

    var fastn = createFastn(domComponents());

    var todos = new fastn.Model({todos:[]});

    function addTodo(todo){
        if(todo){
            todos.push('todos', todo);
        }
    }

    var newTodoBinding = fastn.binding('newTodo');

    var input,
        form,
        app = fastn('div',
        fastn('list', {
            tagName: 'ul',
            items: fastn.binding('todos|*'),
            template: function(){
                return fastn('li', fastn.binding('item'));
            }
        }),
        form = fastn('form',
            input = fastn('input', {
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

    t.pass();

    document.body.removeChild(app.element);
});
