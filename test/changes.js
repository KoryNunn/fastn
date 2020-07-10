const righto = require('righto');

const outputOnError = error => { error && console.log(error); };

function runTest (fn) {
  if (fn.constructor.name === 'GeneratorFunction') {
    return function () {
      const generator = righto.iterate(fn);
      const result = righto.apply(null, [generator].concat(Array.from(arguments)));
      result(outputOnError);
    };
  }

  return fn;
}

function rightoTest (name, fn) {
  test(name, runTest(fn));
}

module.exports = rightoTest;