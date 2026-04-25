const axios = require('axios');

const testCarbonPrice = async () => {
  try {
    const response = await axios.post('http://localhost:2000/getCarbonPrice');

    console.log("Response from /getCarbonPrice:");
    console.log(response.data);

  } catch (err) {
    if (err.response) {
      console.error("Error response from server:", err.response.data);
    } else {
      console.error("Error making request:", err.message);
    }
  }
};

testCarbonPrice();