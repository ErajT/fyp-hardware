const readline = require('readline');

// CONFIGURATION CONSTANTS (Matching your API logic)
const CO2_PER_KWH = 0.0004;      // Tons of CO2 per 1 kWh
const CREDIT_VALUATION = 10;     // 1 Credit = 10 Tons of CO2
const BASE_KWH_PER_SQFT = 0.2;   // Base energy budget per sqft
const KWH_PER_PERSON = 120;      // Monthly budget per person

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("--- Household Carbon Credit Tester ---");

rl.question('Enter House Area (SqFt): ', (area) => {
  rl.question('Enter Number of People: ', (people) => {
    rl.question('Enter Actual Electricity Used (kWh): ', (actual) => {
      
      const houseAreaSqFt = parseFloat(area);
      const numPeople = parseInt(people);
      const actualKwhUsed = parseFloat(actual);

      // 1. Calculate the Quota (The "Fair" Limit)
      const quotaKwh = (houseAreaSqFt * BASE_KWH_PER_SQFT) + (numPeople * KWH_PER_PERSON);

      // 2. Calculate Units Saved
      const kwhSaved = Math.max(0, quotaKwh - actualKwhUsed);

      // 3. Convert Saved Units to Tons of CO2
      const tonsCO2Saved = kwhSaved * CO2_PER_KWH;

      // 4. Convert Tons to Micro-Credits
      const creditsEarned = tonsCO2Saved / CREDIT_VALUATION;

      // OUTPUT RESULT
      const result = {
        summary: {
          allocatedQuota: `${quotaKwh.toFixed(2)} kWh`,
          actualUsage: `${actualKwhUsed.toFixed(2)} kWh`,
          energySaved: `${kwhSaved.toFixed(2)} kWh`
        },
        carbonImpact: {
          co2AvoidedTons: tonsCO2Saved.toFixed(6),
          conversionFactor: "0.0004 tons/kWh"
        },
        rewards: {
          microCreditsEarned: creditsEarned.toFixed(8),
          note: `1 Full Credit = ${CREDIT_VALUATION} Tons of CO2`
        }
      };

      console.log("\n--- CALCULATION RESULT ---");
      console.log(JSON.stringify(result, null, 2));
      console.log("--------------------------\n");

      rl.close();
    });
  });
});