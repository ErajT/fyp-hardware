const express = require("express");
const router = express.Router();

const individualController = require("../Controller/IndividualController");

router.route('/analyze-bill')
  .post(individualController.uploadBill, individualController.analyzeElectricityBill);

router.route('/calculate-offset/:bill_id')
  .post(individualController.calculateCarbonOffset);

router.route('/marketplace')
  .get(individualController.viewMarketplace);

// POST /individual/blockchain/buy  { listing_id } → buyListing(listingId)
// router.route('/blockchain/buy')
//   .post(individualController.getBuyListingTx);

router.route('/marketplace/sell')
  .post(individualController.createSellOrderIndividual)

router.route('/summary/:user_id')
  .get(individualController.getIndividualSummary);

router.route('/bill/:bill_id/tokens')
  .get(individualController.getTokensByBill);

module.exports = router;