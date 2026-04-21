const { create, deleteUser, getUserByEmail, resetPwd, logout, checkIfLoggedInByEmail, loginSession } = require('./user.service');
const { genSaltSync, hashSync, compareSync } = require('bcrypt');
const { sign, verify } = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Qexecution = require("../../Controller/query");

module.exports = {

    createUser: (req, res) => {
        const body = req.body;
        // body.password = hashSync(body.password, 10);
        create(body, (err, results) => {
            if (err) {
                console.log(err);
                return res.status(500).json({
                    status: "fail",
                    message: "Database connection error"
                })
            }
            return res.status(200).json({
                status: "success",
                data: results
            })
        })
    },

    updateUser: (req, res) => {
        const body = req.body;
        const salt = genSaltSync(10);
        body.password = hashSync(body.password, salt);
        updateUser(body, (error, result) => {
            if (error) {
                console.log(error);
                return;
            }
            if (!result) {
                return res.status(400).json({
                    status: "fail",
                    message: "failed to update user"
                })
            }
            return res.status(200).json({
                status: "success",
                message: "Updated successfully!"
            })
        })
    },

    login: async (req, res) => {
        const body = req.body;

        try {
            // Fetch user by email
            const results = await new Promise((resolve, reject) => {
                getUserByEmail(body.email, (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            });

            // If no user is found, return an error response
            if (!results) {
                return res.status(400).json({
                    status: "fail",
                    message: "Invalid email or password",
                });
            }

            // Verify password
            // console.log("DB Results:", results);
            // console.log("Plain password from request:", body.password);

            const isPasswordValid = compareSync(body.password, results.password_hash);
            if (!isPasswordValid) {
                return res.status(400).json({
                    status: "fail",
                    message: "Invalid email or password",
                });
            }

            // Remove the password from the user object before proceeding
            results.password = undefined;

            // After password check and results.password = undefined;

            let roleTable = '';
            switch (results.role) {
                case 'normal_user':
                    roleTable = 'normal_users';
                    break;
                case 'project_owner':
                    roleTable = 'project_owners';
                    break;
                case 'industry':
                    roleTable = 'industries';
                    break;
                case 'gov':
                    roleTable = 'government_admins';
                    break;
            }

            let roleData = {};
            if (roleTable) {
                const rows = await Qexecution.queryExecute(
                    `SELECT * FROM ${roleTable} WHERE registration_id = ?`,
                    [results.registration_id]
                );

                // console.log(rows);

                roleData = rows[0] || {};
            }

            // Generate JSON Web Token (JWT)
            const jsontoken = sign({ result: results }, "eraj20", {
                expiresIn: "1h",
            });

            // Check if the user is already logged in
            await checkIfLoggedInByEmail(results.email);

            // Encrypt the token
            const encryptedToken = crypto.createHash('sha256').update(jsontoken).digest('hex');

            // Store the session using loginsession
            await new Promise((resolve, reject) => {
                loginSession(encryptedToken, results.email, (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            });

            // Respond with success
            return res.status(200).json({
                status: "success",
                message: "Login successful",
                email: results.email,
                position: results.position,
                token: jsontoken, // Optionally include the unencrypted token for client-side use
                role_data: roleData,
            });

        } catch (error) {
            console.error("Error during login:", error);
            return res.status(500).json({
                status: "fail",
                message: "An error occurred during login. Please try again later.",
            });
        }
    },

    forgetPwd: (req, res) => {
        const email = req.body.email;
        getUserByEmail(email, (error, results) => {
            if (error) {
                console.log(error)
                return;
            }
            if (!results) {
                return res.status(400).json({
                    status: "fail",
                    message: "Invalid email"
                })
            }
            if (results) {
                results.password = undefined;
                const code = sign({ result: results }, "eraj20", {
                    // expiresIn: 5 * 60 * 1000
                    expiresIn: "5m"
                });
                const resetURL = `localhost:5173/reset/${code}`
                console.log(resetURL);

                const transporter = nodemailer.createTransport({
                    host: 'smtp.gmail.com',
                    port: 587,
                    secure: false,
                    auth: {
                        user: 'nashkaisar@gmail.com', // TBC with CloudID
                        pass: 'tzly ablu adaj swic'
                    }
                });
                try {
                    let abc = transporter.sendMail({
                        from: 'nashkaisar@gmail.com', // TBC with CloudID
                        to: email,
                        subject: "Password reset request",
                        text: "We have received a password reset request of your funfinity learning portal account. Please open this link\nlink: " + resetURL
                    });

                    res.status(200).send({
                        status: "success",
                        message: "Email successfully sent"
                    });
                } catch (error) {
                    console.error('Error sending email:', error);
                    res.status(404).send('An error occurred while sending the email.');
                }

            }
        })
    },

    resetPwd: (req, res) => {
        const code = req.params.token;
        // console.log(code);
        if (code) {
            verify(code, "eraj20", (err, decoded) => {
                if (err) {
                    res.status(400).json({
                        status: "fail",
                        message: "Invalid token"
                    })
                } else {
                    let updatedPwd = req.body.updatedPassword;
                    updatedPwd = hashSync(updatedPwd, 10);
                    resetPwd(updatedPwd, decoded.result.email, (error, result) => {
                        if (error) {
                            return res.status(404).send({
                                status: "message",
                                message: error.message
                            })
                        }
                        res.status(200).send({
                            status: "success",
                            message: "Password successfully updated!"
                        })
                    })
                }
            })
        } else {
            res.status(401).json({
                status: "fail",
                message: "Access denied! Unauthorized user"
            })
        }
    },

    logout: (req, res) => {
        let token = req.headers.authorization;
        // let token = req.body.token;
        console.log(token);
        // If the token has a "Bearer " prefix, remove it
        if (token.startsWith("Bearer ")) {
            token = token.slice(7);
        }
        const hashedtoken = crypto.createHash('sha256').update(token).digest('hex');
        // console.log("token is ",hashedtoken);
        // console.log("token done");
        logout(hashedtoken, req, res);
    }
}