const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const query = require("./query");
const userRouter = require('./api/users/user.router');
const IndividualRouter = require("./Router/IndividualRouter");

let app = express();


// Middleware to enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true'); 
  next();
});

app.use(cors({
  origin: ['*'], 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true 
}));

// Middleware to handle large payloads
app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));
app.use(express.json());

// POST route to add CO2 log
app.post('/addData', async (req, res) => {
  try {
    const { co2_emitted } = req.body;

    if (co2_emitted === undefined) {
      return res.status(400).json({ error: 'co2_emitted is required' });
    }

    const sql = `
      INSERT INTO hardware_logs (datetime, co2_emitted)
      VALUES (NOW(), ?)
    `;

    const result = await query.queryExecute(sql, [co2_emitted]);

    res.status(201).json({
      message: 'Log added successfully',
      log: { log_id: result.insertId, datetime: new Date(), co2_emitted }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// app.use(cors({
//   origin: ['http://localhost:5173', 'https://learn-lime-three.vercel.app'],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
//   credentials: true // Allow credentials (cookies) to be included with requests
// }));


const corsOptions = {
  origin: ['http://localhost:5173', 'https://learn-lime-three.vercel.app', '*'], 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allowed methods
  credentials: true // Allow credentials
};

app.use('/users', userRouter)
app.use("/individual", IndividualRouter);

// Start server
app.listen(2000, () => {
  console.log("Server has started on port 2000");
});
