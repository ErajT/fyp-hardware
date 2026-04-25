const connection = require('./../config/database');
exports.queryExecute=(sql,values=[])=>{
    return new Promise((resolve,reject)=>{
        connection.query(sql,values,(err,result)=>{
            if(err){
                reject(err);
            }else{
                resolve(result);
            }
        })
    })
}