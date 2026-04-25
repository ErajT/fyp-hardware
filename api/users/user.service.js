// const pool = require('./../../config/database')
// const Qexecution = require('./../../Controllers/query')
// const crypto = require('crypto');
// const bcrypt = require('bcrypt');

// module.exports= {
//     create: (data, callBack) => {
//         pool.query(
//             `SELECT * FROM registrations WHERE email = ?`,
//             [data.email],
//             (error, results) => {
//                 if (error) {
//                     return callBack(error);
//                 }
//                 if (results.length > 0) {
//                     // Email already exists
//                     return callBack(null, { message: "Email already registered." });
//                 } else {
//                     // Insert into the respective table first
//                     let insertQuery = '';
//                     let insertValues = [];

//                     if (data.role === 'Client') {
//                         insertQuery = `INSERT INTO client(name, phoneNumber, email, companyName) VALUES (?,?,?,?)`;
//                         insertValues = [data.name, data.phoneNumber, data.email, data.companyName];
//                     } 
//                     else if (data.role === 'Employee') {
//                         insertQuery = `INSERT INTO employees(name, email, phoneNumber, role, status, skills, experience) VALUES (?,?,?,?,?,?,?)`;
//                         insertValues = [
//                             data.name,
//                             data.email,
//                             data.phoneNumber,
//                             data.role,
//                             'active', // default status
//                             data.skills,
//                             data.experience
//                         ];
//                     } 
//                     else if (data.role === 'PM') {
//                         insertQuery = `INSERT INTO projectmanager(name, email, phoneNumber) VALUES (?,?,?)`;
//                         insertValues = [data.name, data.email, data.phoneNumber];
//                     } 
//                     else if (data.position === 'BA') {
//                         insertQuery = `INSERT INTO businessanalyst(name, email, phoneNumber, experience) VALUES (?,?,?,?)`;
//                         insertValues = [data.name, data.email, data.phoneNumber, data.experience];
//                     } 
//                     else {
//                         return callBack(null, { message: "Invalid position specified." });
//                     }

//                     // Now insert into the respective table
//                     pool.query(
//                         insertQuery,
//                         insertValues,
//                         (error, results1) => {
//                             if (error) {
//                                 return callBack(error);
//                             }

//                             // After successful insertion, insert into registration
//                             pool.query(
//                                 `INSERT INTO registrations(email, password, position) VALUES (?,?,?)`,
//                                 [data.email, data.password, data.position],
//                                 (error, results2) => {
//                                     if (error) {
//                                         return callBack(error);
//                                     }
//                                     return callBack(null, { message: "User registered successfully." });
//                                 }
//                             );
//                         }
//                     );
//                 }
//             }
//         );
//     },  
//     getUserByEmail: async (email,callBack)=>{
//         const SQL= "SELECT * FROM registrations where email= ?";
//         try{
//             const result=await Qexecution.queryExecute(SQL,[email, 1]);
//             return callBack(null,result[0]);
//         }catch(err){
//             return callBack(err);
//         }
//     },
//     checkIfLoggedInByToken: async (token,req,res)=>{
//         const SQL= "SELECT * FROM session";
//         const encrypted=crypto.createHash('sha256').update(token).digest('hex');
//         try{
//             const result= await Qexecution.queryExecute(SQL);
//             const tokens= result.map(data=> data.token)
//             if(tokens.includes(encrypted)) {
//                 console.log('true');
//                 return true
//             }else{
//                 console.log('false');
//                 return false;
//             }
//         }catch(err){
//             return res.json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     },
//     resetPwd: async (updatedPwd,email,callBack)=>{
//         const SQL= "UPDATE registration SET password = ? WHERE email=?";
//         try{
//             const result = await Qexecution.queryExecute(SQL,[updatedPwd,email]);
//             return callBack(null,result);
//         }catch(err){
//             return callBack(err);
//         }
//     },

//     loginSession: async (token,email,callBack)=>{
//         const SQL="INSERT INTO session VALUES(?,?)";
//         try{
//             const result= await Qexecution.queryExecute(SQL,[email,token]);
//             return callBack(null,result)
//         }
//         catch(err){
//             return callBack(err);
//         }
//     },
//     checkIfLoggedInByEmail: async (email,req,res)=>{
//         const SQL= "SELECT * FROM session";
//         try{
//             const result= await Qexecution.queryExecute(SQL);
//             const emails= result.map(data=> data.email)
//             if(emails.includes(email)) {
//                 // console.log('true');
//                 const SQL2= "DELETE FROM session WHERE email=?"
//                 const result2= await Qexecution.queryExecute(SQL2,[email]);
//                 return;
//             }
//         }catch(err){
//             return res.json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     },
//     logout: async (token,req,res)=>{
//         const SQL= "DELETE FROM session WHERE token=?";
//         try{
//             // console.log("token: ",token)
//             const result= await Qexecution.queryExecute(SQL,[token]);
//             if(result.affectedRows===0){
//                 throw Error('You aren\'t logged in' );
//             }
//             else{
//                 return res.status(200).json({
//                     status: "success",
//                     message: "Successfully logged out"
//                 });
//             }
//         }catch(err){
//             return res.status(400).json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     }
// }



const pool = require('../../config/database');
const Qexecution = require('../../Controller/query');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

module.exports = {
    // ======================
    // 1. Register New User
    // ======================
    create: (data, callBack) => {
        pool.query(
            `SELECT * FROM registrations WHERE email = ?`,
            [data.email],
            async (error, results) => {
                if (error) {
                    return callBack(error);
                }
                if (results.length > 0) {
                    return callBack(null, { message: "Email already registered." });
                }

                try {
                    // Hash the plain password
                    const hashedPwd = await bcrypt.hash(data.password, 10);

                    // Insert into central REGISTRATIONS table
                    pool.query(
                        `INSERT INTO registrations (email, password_hash, role, kyc_status) VALUES (?, ?, ?, ?)`,
                        [data.email, hashedPwd, data.role, false],
                        (err, regResult) => {
                            if (err) return callBack(err);

                            const registrationId = regResult.insertId;

                            // INSERT INTO ROLE-SPECIFIC TABLE:
                            let roleQuery = '';
                            let roleValues = [];

                            switch (data.role) {
                                case 'normal_user':
                                    roleQuery = `
                                    INSERT INTO normal_users 
                                    (registration_id, name, household_size, house_area_sqm)
                                    VALUES (?, ?, ?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.name,
                                        // data.wallet_address,
                                        data.household_size,
                                        data.house_area_sqm
                                    ];
                                    break;

                                case 'project_owner':
                                    roleQuery = `
                                    INSERT INTO project_owners 
                                    (registration_id, department_name, designation)
                                    VALUES (?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.department_name,
                                        data.designation
                                    ];
                                    break;

                                case 'industry':
                                    roleQuery = `
                                    INSERT INTO industries 
                                    (registration_id, industry_name, sector)
                                    VALUES (?, ?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.industry_name,
                                        data.sector,
                                        // data.wallet_address
                                    ];
                                    break;

                                case 'gov':
                                    roleQuery = `
                                    INSERT INTO government_admins
                                    (registration_id, department_name, designation)
                                    VALUES (?, ?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.department_name,
                                        data.designation
                                    ];
                                    break;

                                default:
                                    return callBack(null, { message: "Invalid role supplied." });
                            }

                            // Execute the role-specific INSERT
                            pool.query(roleQuery, roleValues, (roleErr) => {
                                if (roleErr) return callBack(roleErr);

                                return callBack(null, {
                                    message: "User registered successfully.",
                                    registration_id: registrationId,
                                    role: data.role
                                });
                            });
                        }
                    );
                } catch (err) {
                    return callBack(err);
                }
            }
        );
    },

    // ======================
    // 2. Get User by Email
    // ======================
    getUserByEmail: async (email, callBack) => {
        const SQL = "SELECT * FROM registrations WHERE email = ?";
        try {
            const result = await Qexecution.queryExecute(SQL, [email]);
            return callBack(null, result[0]);
        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 3. Login Session
    // ======================
    loginSession: async (token, email, callBack) => {
        try {
            // 1. Get registration_id from email
            const user = await Qexecution.queryExecute(
                "SELECT registration_id FROM registrations WHERE email=?",
                [email]
            );

            if (!user || user.length === 0) {
                return callBack(new Error("User not found"));
            }

            const registrationId = user[0].id;

            // 2. Insert session using registration_id
            const SQL = "INSERT INTO session (registration_id, token) VALUES (?, ?)";

            const result = await Qexecution.queryExecute(SQL, [
                registrationId,
                token
            ]);

            return callBack(null, result);

        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 4. Check Login by Token
    // ======================
    checkIfLoggedInByToken: async (token, req, res) => {
        const SQL = "SELECT * FROM session";
        const encrypted = crypto.createHash('sha256').update(token).digest('hex');
        try {
            const result = await Qexecution.queryExecute(SQL);
            const tokens = result.map(data => data.token);
            return tokens.includes(encrypted);
        } catch (err) {
            return res.json({
                status: "fail",
                message: err.message
            });
        }
    },

    // ======================
    // 5. Logout
    // ======================
    logout: async (token, req, res) => {
        const SQL = "DELETE FROM session WHERE token=?";
        try {
            const result = await Qexecution.queryExecute(SQL, [token]);
            if (result.affectedRows === 0) {
                throw Error("You aren't logged in");
            } else {
                return res.status(200).json({
                    status: "success",
                    message: "Successfully logged out"
                });
            }
        } catch (err) {
            return res.status(400).json({
                status: "fail",
                message: err.message
            });
        }
    },

    // ======================
    // 6. Reset Password
    // ======================
    resetPwd: async (updatedPwd, email, callBack) => {
        const SQL = "UPDATE registrations SET password_hash = ? WHERE email=?";
        try {
            const hashedPwd = await bcrypt.hash(updatedPwd, 10);
            const result = await Qexecution.queryExecute(SQL, [hashedPwd, email]);
            return callBack(null, result);
        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 7. Check Login by Email
    // ======================
    checkIfLoggedInByEmail: async (email) => {
        try {
            // 1. Get user from registration table
            const user = await Qexecution.queryExecute(
                "SELECT registration_id FROM registrations WHERE email=?",
                [email]
            );

            if (!user || user.length === 0) {
                return false;
            }

            const registrationId = user[0].id;

            // 2. Check session using registration_id
            const session = await Qexecution.queryExecute(
                "SELECT * FROM session WHERE registration_id=?",
                [registrationId]
            );

            // 3. If session exists → delete it
            if (session.length > 0) {
                await Qexecution.queryExecute(
                    "DELETE FROM session WHERE registration_id=?",
                    [registrationId]
                );
            }

            return true;

        } catch (err) {
            throw err;
        }
    }
};
