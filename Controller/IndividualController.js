const { createWorker } = require("tesseract.js");
const multer = require("multer");
const axios = require("axios");
const Qexecution = require("./query");

// ✅ FIXED: Memory storage — Vercel has a read-only filesystem
const upload = multer({ storage: multer.memoryStorage() });

exports.uploadBill = upload.single("bill");

/* =========================================
   OCR + GenAI Electricity Bill Analysis
========================================= */

exports.analyzeElectricityBill = async (req, res) => {
  let worker = null;

  try {
    const { user_id } = req.body;

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

    // ✅ FIXED: Use buffer from memory storage — no disk path needed
    const imageBuffer = req.file.buffer;

    // ✅ FIXED: createWorker with buffer input; works in serverless
    worker = await createWorker("eng", 1, {
      logger: () => {} // suppress logs in serverless environment
    });

    const {
      data: { text }
    } = await worker.recognize(imageBuffer);

    await worker.terminate();
    worker = null;

    const cleanText = clean(text);

    // Extract fields from OCR text
    let bill = {
      amountDue: extract(cleanText, [
        /Amount\s*Payable\s*within\s*Due\s*Date\s*([\d,]+)/i,
        /Rs\.?\s*([\d,]{4,})/i
      ]),
      units: extract(cleanText, [/(\d{2,4})\s*Units/i]),
      dueDate: extract(cleanText, [
        /Due\s*Date\s*(\d{1,2}[-\w]+\s?\d{4})/i
      ])
    };

    // AI fallback if OCR didn't extract units
    if (!bill.units) {
      const aiData = await interpretBillWithAI(cleanText);
      bill.units = aiData.units_consumed || null;
      bill.amountDue = bill.amountDue || aiData.amount_due || null;
      bill.dueDate = bill.dueDate || aiData.due_date || null;
    }

    // ✅ FIXED: Parse to Number before arithmetic to avoid NaN in DB
    const unitsNum = Number(bill.units);

    if (isNaN(unitsNum) || unitsNum <= 0) {
      return res.status(422).json({
        status: "fail",
        message: "Could not extract valid unit consumption from bill image",
        raw_text: cleanText
      });
    }

    // ✅ NO fs.unlinkSync — nothing was written to disk

    // CO2 calculation
    const emissionFactor = 0.0007;
    const co2_released = Number((unitsNum * emissionFactor).toFixed(4));
    const eligible_for_credit = co2_released > 1 ? 1 : 0;

    /* ========================= SAVE TO DB ========================= */

    const insertSQL = `
      INSERT INTO electricity_bills 
      (user_id, month, unit_used, co2_released, eligible_for_credit, admin_approval_status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `;

    const result = await Qexecution.queryExecute(insertSQL, [
      user_id,
      month,
      unitsNum,
      co2_released,
      eligible_for_credit
    ]);

    /* ========================= RESPONSE ========================= */

    res.json({
      status: "success",
      bill_id: result.insertId,
      extracted_data: {
        units: unitsNum,
        amount_due: bill.amountDue,
        due_date: bill.dueDate,
        co2_released,
        eligible_for_credit
      },
      raw_text: cleanText
    });
  } catch (error) {
    // ✅ FIXED: Always clean up worker on error
    if (worker) {
      try {
        await worker.terminate();
      } catch (_) {}
    }

    // ✅ FIXED: Log and return the real error message
    console.error("analyzeElectricityBill error:", error);
    res.status(500).json({
      status: "fail",
      message: error.message || "Bill analysis failed"
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

    // ✅ FIXED: Proper destructuring for mysql2 promise API
    const rows = await Qexecution.queryExecute(
      `SELECT unit_used FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found or invalid bill_id"
      });
    }

    const units = Number(rows[0].unit_used);

    // CO2 calculation
    const emissionFactor = 0.0007;
    const co2_emitted = units * emissionFactor;
    const credits_required = Math.ceil(co2_emitted);

    // ✅ FIXED: Consistent status value — using 'open' everywhere
    const listings = await Qexecution.queryExecute(
      `SELECT 
        m.order_id AS listing_id,
        t.amount,
        m.price,
        p.project_name
      FROM marketplace m
      JOIN tokens t ON m.token_id = t.token_id
      JOIN projects p ON t.project_id = p.project_id
      WHERE m.status = 'open'
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
        price_per_credit: item.price,
        project_name: item.project_name
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
        credits_covered: credits_required - remaining,
        suggestions
      }
    });
  } catch (err) {
    console.error("calculateCarbonOffset error:", err);
    res.status(500).json({
      status: "fail",
      message: err.message || "Error calculating carbon offset"
    });
  }
};

/* =========================================
   View Marketplace Listings
========================================= */

exports.viewMarketplace = async (req, res) => {
  try {
    // ✅ FIXED: Proper destructuring + consistent status = 'open'
    const [listings] = await Qexecution.queryExecute(
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
       WHERE m.status = 'open'`
    );

    res.json({
      status: "success",
      listings
    });
  } catch (err) {
    console.error("viewMarketplace error:", err);
    res.status(500).json({
      status: "fail",
      message: err.message || "Error fetching marketplace listings"
    });
  }
};

/* =========================================
   Create Sell Order (Individual)
========================================= */

exports.createSellOrderIndividual = async (req, res) => {
  try {
    const { bill_id, token_id, amount, price } = req.body;

    if (!bill_id || !token_id || !amount || !price) {
      return res.status(400).json({
        status: "fail",
        message: "bill_id, token_id, amount, price are all required"
      });
    }

    /* -------- STEP 1: GET USER_ID FROM BILL -------- */

    // ✅ FIXED: Proper destructuring — no more .rows which doesn't exist
    const billResult = await Qexecution.queryExecute(
      `SELECT user_id FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    const billRows = billResult.rows || billResult || [];

    if (!billRows.length === 0) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found"
      });
    }

    const user_id = billRows[0].user_id;

    /* -------- STEP 2: CHECK TOKEN BALANCE -------- */

    // ✅ FIXED: Corrected param count — 4 placeholders, 4 values
    // Breakdown:
    //   buyer_id = ?   → user_id
    //   seller_id = ?  → user_id  (sold and user is buyer)
    //   seller_id = ?  → user_id  (sold and user is seller)
    //   token_id = ?   → token_id
    const balanceResult = await Qexecution.queryExecute(
      `SELECT 
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
      WHERE token_id = ?`,
      [user_id, user_id, user_id, user_id, token_id]
    );

    const balanceRows = balanceResult.rows || balanceResult || [];
    const owned = Number(balanceRows?.[0]?.owned_tokens || 0);

    if (owned < Number(amount)) {
      return res.status(400).json({
        status: "fail",
        message: `Insufficient token balance. You own ${owned} tokens but tried to sell ${amount}.`
      });
    }

    /* -------- STEP 3: CREATE MARKETPLACE LISTING -------- */

    // ✅ FIXED: status = 'open' consistent with viewMarketplace query
    await Qexecution.queryExecute(
      `INSERT INTO marketplace
        (user_id, bill_id, token_id, order_type, amount, price, status, created_at)
       VALUES (?, ?, ?, 'sell', ?, ?, 'open', NOW())`,
      [user_id, bill_id, token_id, amount, price]
    );

    res.json({
      status: "success",
      message: "Sell order created successfully"
    });
  } catch (err) {
    console.error("createSellOrderIndividual error:", err);
    res.status(500).json({
      status: "fail",
      message: err.message || "Error creating sell order"
    });
  }
};

// Get Individual Carbon Summary
exports.getIndividualSummary = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id is required"
      });
    }

    /* -----------------------------
       1. TOTAL CO2 EMITTED
    ----------------------------- */
    const emissionResult = await Qexecution.queryExecute(
      `SELECT 
         COALESCE(SUM(co2_released), 0) AS total_emitted
       FROM electricity_bills
       WHERE user_id = ?`,
      [user_id]
    );

    const totalEmitted = emissionResult[0]?.total_emitted || 0;

    /* -----------------------------
       2. TOTAL CREDITS EARNED
    ----------------------------- */
    // Assuming 1 credit = 1 ton CO2 saved
    // Only approved bills count
    const creditResult = await Qexecution.queryExecute(
      `SELECT 
         COALESCE(SUM(co2_released), 0) AS credits_earned
       FROM electricity_bills
       WHERE user_id = ?
       AND eligible_for_credit = 1
       AND admin_approval_status = 'approved'`,
      [user_id]
    );

    const creditsEarned = creditResult[0]?.credits_earned || 0;

    /* -----------------------------
       3. TOKENS OWNED (OPTIONAL - STRONG FEATURE)
    ----------------------------- */
    const tokenResult = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(
          CASE 
            WHEN tx_type = 'minted' THEN amount
            WHEN tx_type = 'sold' AND buyer_id = ? THEN amount
            WHEN tx_type = 'sold' AND seller_id = ? THEN -amount
            WHEN tx_type = 'burnt' THEN -amount
            ELSE 0
          END
        ), 0) AS token_balance
      FROM token_transactions`,
      [user_id, user_id]
    );

    const tokenBalance = tokenResult[0]?.token_balance || 0;

    /* -----------------------------
       4. NET BALANCE
    ----------------------------- */
    const netBalance = creditsEarned - totalEmitted;

    /* -----------------------------
       5. ACTION
    ----------------------------- */
    let action = "NO_ACTION";

    if (netBalance < 0) {
      action = "BUY_CREDITS";
    } else if (netBalance > 0) {
      action = "SELL_CREDITS";
    }

    /* -----------------------------
       RESPONSE
    ----------------------------- */
    res.json({
      status: "success",
      user_id,
      summary: {
        total_co2_emitted: Number(totalEmitted.toFixed(4)),
        credits_earned: Number(creditsEarned.toFixed(4)),
        token_balance: tokenBalance,
        net_balance: Number(netBalance.toFixed(4)),
        action
      }
    });

  } catch (err) {
    console.error("getIndividualSummary error:", err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching individual summary"
    });
  }
};

/* =========================================
   GenAI Bill Interpretation (OpenRouter)
========================================= */

async function interpretBillWithAI(text) {
  try {
    // ✅ FIXED: Use environment variable — set this in Vercel dashboard
    const apiKey = "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";

    if (!apiKey) {
      console.warn("OPENROUTER_API_KEY not set — skipping AI fallback");
      return {};
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [
          {
            role: "user",
            content: `
Extract the following from this electricity bill text:
1. amount_due (numeric only, no currency symbol)
2. units_consumed (numeric only)
3. due_date (as printed)

Return ONLY a JSON object with no extra text, no markdown, no explanation:
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
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 15000 // 15 second timeout for serverless
      }
    );

    const aiText = response.data.choices?.[0]?.message?.content || "";

    // Strip any accidental markdown fences before parsing
    const cleaned = aiText.replace(/```json|```/g, "").trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error("interpretBillWithAI error:", err.message);
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