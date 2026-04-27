const Tesseract = require("tesseract.js");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const Qexecution = require("./query");
const { buildTxData, enc } = require("../Blockchain/contractService");
const { marketplace } = enc;

const upload = multer({ dest: "uploads/" });

exports.uploadBill = upload.single("bill");

/* =========================================
   OCR + GenAI Electricity Bill Analysis
========================================= */

// exports.analyzeElectricityBill = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         status: "fail",
//         message: "Bill image required"
//       });
//     }

//     const imagePath = req.file.path;

//     // OCR
//     const { data: { text } } = await Tesseract.recognize(
//       imagePath,
//       "eng"
//     );

//     const cleanText = clean(text);

//     // REGEX extraction
//     let bill = {
//       amountDue: extract(cleanText, [
//         /Amount\s*Payable\s*within\s*Due\s*Date\s*([\d,]+)/i,
//         /Rs\.?\s*([\d,]{4,})\s*Units/i
//       ]),

//       units: extract(cleanText, [
//         /(\d{2,4})\s*Units/i
//       ]),

//       dueDate: extract(cleanText, [
//         /Due\s*Date\s*(\d{1,2}[-\w]+\s?\d{4})/i
//       ])
//     };

//     // Use GenAI if missing
//     if (!bill.amountDue || !bill.units) {
//       const aiData = await interpretBillWithAI(cleanText);

//       bill = {
//         ...bill,
//         amountDue: bill.amountDue || aiData.amount_due,
//         units: bill.units || aiData.units_consumed,
//         dueDate: bill.dueDate || aiData.due_date
//       };
//     }

//     fs.unlinkSync(imagePath);

//     res.json({
//       status: "success",
//       extracted_data: bill,
//       raw_text: cleanText
//     });

//   } catch (error) {
//     console.error(error);

//     res.status(500).json({
//       status: "fail",
//       message: "Bill analysis failed"
//     });
//   }
// };

exports.analyzeElectricityBill = async (req, res) => {
  try {
    const { user_id, house_area, num_people } = req.body;

    if (!req.file) {
      return res.status(400).json({
        status: "fail",
        message: "Bill image required"
      });
    }

    if (!user_id || !house_area || !num_people) {
      return res.status(400).json({
        status: "fail",
        message: "user_id, house_area, num_people are required"
      });
    }

    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    const imagePath = req.file.path;

    /* =========================
       OCR
    ========================= */
    const { data: { text } } = await Tesseract.recognize(imagePath, "eng");
    const cleanText = clean(text);

    /* =========================
       EXTRACT DATA
    ========================= */
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

    /* =========================
       AI FALLBACK
    ========================= */
    if (!bill.units) {
      const aiData = await interpretBillWithAI(cleanText);
      bill.units = aiData.units_consumed;
      bill.amountDue = bill.amountDue || aiData.amount_due;
      bill.dueDate = bill.dueDate || aiData.due_date;
    }

    const units = Number(bill.units || 0);

    /* =========================
       EFFICIENCY MODEL
    ========================= */
    const CO2_PER_KWH = 0.0004;
    const CREDIT_VALUATION = 10;
    const BASE_KWH_PER_SQFT = 0.2;
    const KWH_PER_PERSON = 120;

    // 1. QUOTA
    const quotaKwh =
      (Number(house_area) * BASE_KWH_PER_SQFT) +
      (Number(num_people) * KWH_PER_PERSON);

    // 2. SAVINGS
    const kwhSaved = Math.max(0, quotaKwh - units);

    // 3. CO2 SAVED
    const co2_saved = Number((kwhSaved * CO2_PER_KWH).toFixed(6));

    // 4. TOKENS (1 token = 10 tons CO2)
    const tokensToGive = Math.floor(co2_saved / CREDIT_VALUATION);

    const eligible_for_credit = tokensToGive > 0 ? 1 : 0;

    fs.unlinkSync(imagePath);

    /* =========================
       SAVE BILL
    ========================= */
    const insertSQL = `
      INSERT INTO electricity_bills 
      (user_id, month, unit_used, co2_released, co2_saved, eligible_for_credit, admin_approval_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    const result = await Qexecution.queryExecute(insertSQL, [
      user_id,
      month,
      units,
      0, // no longer using emitted CO2
      co2_saved,
      eligible_for_credit
    ]);

    const bill_id = result.insertId;

    /* =========================
       TOKEN MINTING
    ========================= */
    let token_id = null;

    if (tokensToGive > 0) {
      const tokenResult = await Qexecution.queryExecute(
        `INSERT INTO tokens 
        (owner_user_id, amount, bill_id, price_at_mint, current_price)
        VALUES (?, ?, ?, 10, 10)`,
        [user_id, tokensToGive, bill_id]
      );

      token_id = tokenResult.insertId;

      await Qexecution.queryExecute(
        `INSERT INTO token_transactions
        (token_id, tx_type, amount)
        VALUES (?, 'minted', ?)`,
        [token_id, tokensToGive]
      );
    }

    /* =========================
       RESPONSE
    ========================= */
    res.json({
      status: "success",
      bill_id,
      extracted_data: {
        units,
        amount_due: bill.amountDue,
        due_date: bill.dueDate
      },
      energy: {
        quota_kwh: Number(quotaKwh.toFixed(2)),
        actual_kwh: units,
        saved_kwh: Number(kwhSaved.toFixed(2))
      },
      carbon: {
        co2_saved,
        conversion: "0.0004 ton per kWh"
      },
      rewards: {
        tokens_earned: tokensToGive,
        token_id,
        note: "1 token = 10 tons CO2 saved"
      },
      eligible_for_credit
    });

  } catch (error) {
    console.error("analyzeElectricityBill error:", error);
    res.status(500).json({
      status: "fail",
      message: "Bill analysis failed"
    });
  }
};

/* =========================================
   Carbon Calculation + Credit Suggestion
========================================= */

// exports.calculateCarbonOffset = async (req, res) => {
//   try {
//     const { units } = req.body;

//     if (!units) {
//       return res.status(400).json({
//         status: "fail",
//         message: "Units required"
//       });
//     }

//     // 🌱 Convert units → CO2
//     const emissionFactor = 0.0007;
//     const co2_emitted = units * emissionFactor;

//     // 🎯 Credits required
//     const credits_required = Math.ceil(co2_emitted);

//     // 🛒 Fetch marketplace
//     const [listings] = await Qexecution.queryExecute(
//       `SELECT 
//          m.id AS listing_id,
//          t.amount,
//          m.price,
//          p.project_name
//        FROM marketplace m
//        JOIN tokens t ON m.token_id = t.id
//        JOIN projects p ON t.project_id = p.id
//        WHERE m.status = 'active'
//        ORDER BY m.price ASC`
//     );

//     // 🎯 Smart suggestion
//     let remaining = credits_required;
//     const suggestions = [];

//     for (let item of listings) {
//       if (remaining <= 0) break;

//       const usable = Math.min(item.amount, remaining);

//       suggestions.push({
//         listing_id: item.listing_id,
//         buy_amount: usable,
//         price_per_credit: item.price
//       });

//       remaining -= usable;
//     }

//     res.json({
//       status: "success",
//       data: {
//         units,
//         co2_emitted: Number(co2_emitted.toFixed(4)),
//         credits_required,
//         suggestions
//       }
//     });

//   } catch (err) {
//     console.error(err);

//     res.status(500).json({
//       status: "fail",
//       message: "Error calculating carbon offset"
//     });
//   }
// };

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
      `SELECT unit_used, co2_saved FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    const rows = result.rows || result || [];

    if (!rows.length) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found"
      });
    }

    const units = Number(rows[0].unit_used);
    const co2_saved = Number(rows[0].co2_saved || 0);

    // CO2 emitted baseline
    const emissionFactor = 0.0004;
    const co2_emitted = units * emissionFactor;

    // Net impact
    const net_co2 = co2_emitted - co2_saved;

    const credits_required = net_co2 > 0
      ? Number(net_co2.toFixed(4))
      : 0;

    // Marketplace suggestions
    let suggestions = [];

    if (credits_required > 0) {
      const listings = await Qexecution.queryExecute(
        `SELECT 
          m.order_id AS listing_id,
          t.amount,
          m.price
        FROM marketplace m
        JOIN tokens t ON m.token_id = t.token_id
        WHERE m.status = 'open'
        ORDER BY m.price ASC`
      );

      let remaining = credits_required;

      for (let item of listings) {
        if (remaining <= 0) break;

        const usable = Math.min(item.amount, remaining);

        suggestions.push({
          listing_id: item.listing_id,
          buy_amount: Number(usable.toFixed(4)),
          price_per_token: item.price
        });

        remaining -= usable;
      }
    }

    res.json({
      status: "success",
      data: {
        bill_id,
        units,
        co2_emitted: Number(co2_emitted.toFixed(4)),
        co2_saved,
        net_co2: Number(net_co2.toFixed(4)),
        action: credits_required > 0 ? "BUY" : "NO_NEED",
        credits_required,
        suggestions
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error calculating offset"
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
       WHERE m.status = 'open'`
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

exports.getTokensByBill = async (req, res) => {
  try {
    const { bill_id } = req.params;

    if (!bill_id) {
      return res.status(400).json({
        status: "fail",
        message: "bill_id required"
      });
    }

    const tokens = await Qexecution.queryExecute(
      `SELECT token_id, amount 
       FROM tokens 
       WHERE bill_id = ?`,
      [bill_id]
    );

    const rows = tokens.rows || tokens || [];

    res.json({
      status: "success",
      bill_id,
      tokens: rows.length ? rows : [],
      total_tokens: rows.reduce((sum, t) => sum + Number(t.amount), 0)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching tokens"
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

    if (amount <= 0 || price <= 0) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid amount or price"
      });
    }

    // Validate ownership
    const tokenCheck = await Qexecution.queryExecute(
      `SELECT owner_user_id, amount FROM tokens WHERE token_id = ?`,
      [token_id]
    );

    const tokenRow = tokenCheck[0];

    if (!tokenRow) {
      return res.status(404).json({
        status: "fail",
        message: "Token not found"
      });
    }

    const user_id = tokenRow.owner_user_id;

    // Balance check
    const balanceResult = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(
          CASE 
            WHEN tx_type = 'minted' THEN amount
            WHEN tx_type = 'sold' AND seller_id = ? THEN -amount
            WHEN tx_type = 'sold' AND buyer_id = ? THEN amount
            WHEN tx_type = 'burnt' THEN -amount
            ELSE 0
          END
        ), 0) AS balance
      FROM token_transactions
      WHERE token_id = ?`,
      [user_id, user_id, token_id]
    );

    const balance = Number(balanceResult[0]?.balance || 0);

    // 1. Get already listed tokens
    const listedResult = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount), 0) AS listed
        FROM marketplace
        WHERE token_id = ? AND status = 'open'`,
      [token_id]
    );

    const listed = Number(listedResult[0]?.listed || 0);

    // 2. Calculate available tokens
    const available = balance - listed;

    // 3. Validate against available tokens
    if (available < amount) {
      return res.status(400).json({
        status: "fail",
        message: `Only ${available} tokens available (already listed: ${listed})`
      });
    }

    if (balance < amount) {
      return res.status(400).json({
        status: "fail",
        message: `Insufficient tokens. Available: ${balance}`
      });
    }

    // Create listing
    await Qexecution.queryExecute(
      `INSERT INTO marketplace
      (user_id, bill_id, token_id, order_type, amount, price, status, created_at)
      VALUES (?, ?, ?, 'sell', ?, ?, 'open', NOW())`,
      [user_id, bill_id, token_id, amount, price]
    );

    res.json({
      status: "success",
      message: "Sell order created",
      details: { amount, price }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error creating sell order"
    });
  }
};

exports.getIndividualSummary = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id required"
      });
    }

    // Total CO2 saved
    const savedResult = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_saved),0) AS total_saved
       FROM electricity_bills
       WHERE user_id = ?`,
      [user_id]
    );

    const totalSaved = Number(savedResult[0]?.total_saved || 0);

    // Token balance
    const tokenResult = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(
          CASE 
            WHEN tx_type = 'minted' THEN amount
            WHEN tx_type = 'sold' AND seller_id = ? THEN -amount
            WHEN tx_type = 'sold' AND buyer_id = ? THEN amount
            WHEN tx_type = 'burnt' THEN -amount
            ELSE 0
          END
        ), 0) AS token_balance
      FROM token_transactions`,
      [user_id, user_id]
    );

    const tokenBalance = Number(tokenResult[0]?.token_balance || 0);

    let action = "NO_ACTION";

    if (tokenBalance > 0) action = "SELL_CREDITS";

    res.json({
      status: "success",
      user_id,
      summary: {
        total_co2_saved: Number(totalSaved.toFixed(4)),
        token_balance: tokenBalance,
        action
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching summary"
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

// ── Blockchain: Get tx data for buyListing(listingId) ────────────────────────
exports.getBuyListingTx = async (req, res) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ status: "fail", message: "listing_id required" });
    }
    const txData = await buildTxData(marketplace, "buyListing", [listing_id]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getBuyListingTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

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