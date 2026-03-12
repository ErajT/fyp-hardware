const mysql = require('mysql');
//Database Connection

const connection=mysql.createPool({
    connectionLimit: 6,
    host: "Climavert12.mysql.database.azure.com",
    user: "Climavert_12",
    password: "Tazeen12",
    database: "cognify",
    port: 3306,
    ssl: true
})
connection.getConnection((err,connection)=>{
    if (err){
        return console.log(err);
    }
    connection.release();
    console.log("Database connected successfully!");
})

module.exports = connection;