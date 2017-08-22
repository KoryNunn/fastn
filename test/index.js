function run(){
    document.body.innerHTML = '';

    require('./firmer.js');
    require('./binding.js');
    require('./property.js');
    require('./component.js');
    require('./text.js');
    require('./list.js');
    require('./templater.js');
    require('./container.js');
    require('./generic.js');
    require('./attach.js');
    require('./fancyProps.js');
    require('./customModel.js');
}

if(typeof document !== 'undefined'){
    window.onload = run;
}else{
    require('./document')();
    run();
}