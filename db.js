const mysql = require('mysql');
require('dotenv').config();

const connection = mysql.createPool({
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT),
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT),
    ssl: process.env.DB_SSL === 'true'
});


connection.getConnection((err,connection)=>{
    if (err){
        return console.log(err);
    }
    connection.release();
    console.log("Database connected successfully!");
})

module.exports = connection;