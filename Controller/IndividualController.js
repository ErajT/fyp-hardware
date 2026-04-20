const Tesseract = require("tesseract.js");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const Qexecution = require("./query");

const upload = multer({ dest: "uploads/" });

exports.uploadBill = upload.single("bill");

/* =========================================
   OCR + GenAI Electricity Bill Analysis
========================================= */

exports.analyzeElectricityBill = async (req, res) => {
  try {
    const { user_id } = req.body; // 👈 add user + month for DB
    if (!req.file) {
      return res.status(400).json({
        status: "fail",
        message: "Bill image required"
      });
    }

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id is required"
      });
    }

    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    const imagePath = req.file.path;

    // OCR
    const { data: { text } } = await Tesseract.recognize(imagePath, "eng");

    const cleanText = clean(text);

    // Extract
    let bill = {
      amountDue: extract(cleanText, [
        /Amount\s*Payable\s*within\s*Due\s*Date\s*([\d,]+)/i,
        /Rs\.?\s*([\d,]{4,})/i
      ]),

      units: extract(cleanText, [
        /(\d{2,4})\s*Units/i
      ]),

      dueDate: extract(cleanText, [
        /Due\s*Date\s*(\d{1,2}[-\w]+\s?\d{4})/i
      ])
    };

    // AI fallback
    if (!bill.units) {
      const aiData = await interpretBillWithAI(cleanText);

      bill.units = aiData.units_consumed;
      bill.amountDue = bill.amountDue || aiData.amount_due;
      bill.dueDate = bill.dueDate || aiData.due_date;
    }

    // CO2 calculation
    const emissionFactor = 0.0007;
    const co2_released = Number((bill.units * emissionFactor).toFixed(4));

    const eligible_for_credit = co2_released > 1 ? 1 : 0;

    fs.unlinkSync(imagePath);

    /* =========================
       SAVE TO DB
    ========================= */

    const insertSQL = `
      INSERT INTO electricity_bills 
      (user_id, month, unit_used, co2_released, eligible_for_credit, admin_approval_status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `;

    const result = await Qexecution.queryExecute(insertSQL, [
      user_id,
      month || null,
      bill.units,
      co2_released,
      eligible_for_credit
    ]);

    /* =========================
       RESPONSE
    ========================= */

    res.json({
      status: "success",
      bill_id: result.insertId,
      extracted_data: {
        units: bill.units,
        co2_released,
        eligible_for_credit
      },
      raw_text: cleanText
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "fail",
      message: "Bill analysis failed"
    });
  }
};

/* =========================================
   Carbon Calculation + Credit Suggestion
========================================= */

exports.calculateCarbonOffset = async (req, res) => {
  try {
    const { bill_id } = req.params;

    if (!bill_id) {
      return res.status(400).json({
        status: "fail",
        message: "bill_id required"
      });
    }

    const result = await Qexecution.queryExecute(
      `SELECT unit_used FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    const rows = Array.isArray(result?.[0]) ? result[0] : result;

    if (!rows || rows.length === 0 || !rows[0]) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found or invalid bill_id"
      });
    }

    console.log("bill_id:", bill_id);
    console.log("DB result:", result);

    const units = Number(rows[0].unit_used);

    // 🌱 CO2 calculation
    const emissionFactor = 0.0007;
    const co2_emitted = units * emissionFactor;

    const credits_required = Math.ceil(co2_emitted);

    // 🛒 marketplace
    const listings = await Qexecution.queryExecute(
      `SELECT 
        m.order_id AS listing_id,
        t.amount,
        m.price,
        p.project_name
      FROM marketplace m
      JOIN tokens t ON m.token_id = t.token_id
      JOIN projects p ON t.project_id = p.project_id
      WHERE m.status = 'active'
      ORDER BY m.price ASC`
    );

    let remaining = credits_required;
    const suggestions = [];

    for (let item of listings) {
      if (remaining <= 0) break;

      const usable = Math.min(item.amount, remaining);

      suggestions.push({
        listing_id: item.listing_id,
        buy_amount: usable,
        price_per_credit: item.price
      });

      remaining -= usable;
    }

    res.json({
      status: "success",
      data: {
        bill_id,
        units,
        co2_emitted: Number(co2_emitted.toFixed(4)),
        credits_required,
        suggestions
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error calculating carbon offset"
    });
  }
};

/* =========================================
   View Marketplace Listings
========================================= */

exports.viewMarketplace = async (req, res) => {
  try {
    const listings = await Qexecution.queryExecute(
      `SELECT 
         m.order_id AS listing_id,
         t.amount,
         m.price,
         p.project_name,
         u.email AS seller_email
       FROM marketplace m
       JOIN tokens t ON m.token_id = t.token_id
       JOIN projects p ON t.project_id = p.project_id
       JOIN registrations u ON t.owner_user_id = u.registration_id
       WHERE m.status = 'active'`
    );

    res.json({
      status: "success",
      listings
    });

  } catch (err) {
    res.status(500).json({
      status: "fail",
      message: "Error fetching marketplace listings"
    });
  }
};

exports.createSellOrderIndividual = async (req, res) => {
  try {
    const { bill_id, token_id, amount, price } = req.body;

    if (!bill_id || !token_id || !amount || !price) {
      return res.status(400).json({
        status: "fail",
        message: "bill_id, token_id, amount, price required"
      });
    }

    /* -------- STEP 1: GET USER_ID FROM BILL -------- */
    const billResult = await Qexecution.queryExecute(
      `SELECT user_id FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    const billRows = billResult.rows || billResult || [];

    if (!billRows.length) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found"
      });
    }

    const user_id = billRows[0].user_id;

    /* -------- STEP 2: CHECK TOKEN BALANCE -------- */
    const balanceResult = await Qexecution.queryExecute(
      `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN tx_type = 'minted' THEN amount
            WHEN tx_type = 'sold' AND buyer_id = ? THEN amount
            WHEN tx_type = 'sold' AND seller_id = ? THEN -amount
            WHEN tx_type = 'burnt' THEN -amount
            ELSE 0
          END
        ), 0) AS owned_tokens
      FROM token_transactions
      WHERE token_id = ?
      `,
      [user_id, user_id, user_id, user_id, token_id]
    );

    const balanceRows = balanceResult.rows || balanceResult || [];
    const owned = balanceRows[0]?.owned_tokens || 0;

    if (owned < amount) {
      return res.status(400).json({
        status: "fail",
        message: "Insufficient token balance"
      });
    }

    /* -------- STEP 3: CREATE MARKETPLACE LISTING -------- */
    await Qexecution.queryExecute(
      `
      INSERT INTO marketplace
      (user_id, bill_id, token_id, order_type, amount, price, status, created_at)
      VALUES (?, ?, ?, 'sell', ?, ?, 'open', NOW())
      `,
      [user_id, bill_id, token_id, amount, price]
    );

    res.json({
      status: "success",
      message: "Sell order created successfully (Individual)"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error creating sell order"
    });
  }
};

/* =========================================
   GenAI (OpenRouter)
========================================= */

async function interpretBillWithAI(text) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "mistralai/mistral-7b-instruct",
      messages: [
        {
          role: "user",
          content: `
Extract:
1. amount_due
2. units_consumed
3. due_date

Return ONLY JSON:
{
 "amount_due": "",
 "units_consumed": "",
 "due_date": ""
}

Bill text:
${text}
`
        }
      ]
    },
    {
      headers: {
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
      }
    }
  );

  const aiText = response.data.choices[0].message.content;

  try {
    return JSON.parse(aiText);
  } catch {
    return {};
  }
}

/* =========================================
   Helpers
========================================= */

function clean(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/R\s*s/gi, "Rs")
    .trim();
}

function extract(text, patterns) {
  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) return match[1].replace(/,/g, "");
  }
  return null;
}