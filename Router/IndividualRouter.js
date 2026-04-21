const express = require("express");
const router = express.Router();

const individualController = require("../Controller/IndividualController");

router.route('/analyze-bill')
  .post(individualController.uploadBill, individualController.analyzeElectricityBill);

router.route('/calculate-offset/:bill_id')
  .post(individualController.calculateCarbonOffset);

router.route('/marketplace')
  .get(individualController.viewMarketplace);

router.route('/marketplace/sell')
  .post(individualController.createSellOrderIndividual)

module.exports = router;