module.exports = function(entity, firm){
    if(firm && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
}