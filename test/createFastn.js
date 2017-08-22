var merge = require('flat-merge');

module.exports = function createFastn(components){
    return require('../')(require('./components')(components));
};