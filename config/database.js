const mysql = require('mysql');
//Database Connection

const connection=mysql.createPool({
    connectionLimit: 6,
    host: "climavert12.mysql.database.azure.com",
    user: "Climavert_12",
    password: "Tazeen_12",
    database: "carboncredit",
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