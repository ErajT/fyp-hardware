const axios = require('axios');

const testAddData = async () => {
  try {
    const response = await axios.post('https://fyp-hardware.vercel.app/addData', {
      co2_emitted: 15.3
    });

    console.log("Response from /addData:");
    console.log(response.data);
  } catch (err) {
    if (err.response) {
      console.error("Error response from server:", err.response.data);
    } else {
      console.error("Error making request:", err.message);
    }
  }
};

testAddData();