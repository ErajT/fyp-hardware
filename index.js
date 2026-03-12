const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

let app = express();
app.options('*', cors()); // Allow preflight requests

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

// Mount routers
app.use('/users', function);

// Start server
app.listen(2000, () => {
  console.log("Server has started on port 2000");
});
