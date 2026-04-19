const { createUser,login,forgetPwd,resetPwd,logout }= require('./user.controller');
// const {checkToken} from "./../auth.token_validation.js";
// const { checkToken } = require("./../../auth/token_validation");
const router = require("express").Router();

router.post('/', createUser);
router.post('/login',login);
router.post('/forgetPassword',forgetPwd)
router.patch('/resetPassword/:token',resetPwd)
router.post('/logout', logout);

module.exports= router;