var test = require('tape'),
    crel = require('crel'),
    fancyProps = require('../fancyProps');

test('date input', function(t){

    t.plan(2);

    var input = crel('input', {type: 'date'});

    t.equal(fancyProps.value({}, input), null);

    fancyProps.value({}, input, new Date('2000-1-1'));

    t.equal(fancyProps.value({}, input).toString(), new Date('2000-1-1').toString());
});