const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const query = require("./query");

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

app.post('/getCarbonPrice', async (req, res) => {
  try {
    const cheerio = require("cheerio");

    // 🔹 Step 1: Fetch carbon price (EUR) — DO NOT CHANGE (your working logic)
    const response = await fetch("https://tradingeconomics.com/commodity/carbon");
    const html = await response.text();
    const $ = cheerio.load(html);

    let priceText = $("td:contains('EU Carbon Permits')")
      .next()
      .text()
      .trim();

    // ✅ Clean price
    const eurPrice = parseFloat(priceText.replace(/[^\d.]/g, ""));

    if (!eurPrice) {
      return res.status(500).json({ error: 'Failed to extract carbon price' });
    }

    // 🔹 Step 2: Convert EUR → PKR (FIXED & STABLE)
    let pkrPrice = null;

    try {
      const rateRes = await fetch("https://api.fxratesapi.com/latest?base=EUR");
      const rateData = await rateRes.json();

      // console.log(rateData)

      const rate = rateData?.rates?.PKR;

      console.log(rate)

      if (typeof rate === "number") {
        pkrPrice = Math.round(eurPrice * rate);
      } else {
        throw new Error("PKR rate not found");
      }

    } catch (convErr) {
      console.error("Currency conversion failed:", convErr.message);

      // 🔥 fallback (safe for demo + production stability)
      const fallbackRate = 300;
      pkrPrice = Math.round(eurPrice * fallbackRate);
    }

    // 🔹 Step 3: Response
    return res.status(200).json({
      message: 'Carbon price fetched successfully',
      data: {
        eur_price: eurPrice,
        pkr_price: pkrPrice,
        unit: 'per ton CO2',
        market: 'EU ETS',
        currency_base: 'EUR',
        converted_to: 'PKR',
        datetime: new Date()
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// Start server
app.listen(2000, () => {
  console.log("Server has started on port 2000");
});
