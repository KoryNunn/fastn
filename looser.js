module.exports = function(entity, loose){
    if(loose && (entity._loose === undefined || loose < entity._loose)){
        return true;
    }
}