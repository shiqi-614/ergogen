const axios = require('axios');

const fetchFootprintTypes = async () => {
  try {
    const response = await axios.get('https://raw.githubusercontent.com/shiqi-614/ErgoCai.pretty/main/footprintTypes.json');
    const data = response.data;

    const transformedDict = {};

    for (const key in data) {
      const values = data[key];
      values.forEach(value => {
        transformedDict[value] = key;
      });
    }
    console.log("data: " + JSON.stringify(data));
    console.log("transformedDict: " + JSON.stringify(transformedDict));

    return transformedDict;
  } catch (error) {
    console.error('Error fetching the JSON file:', error);
    return {};
  }
};


module.exports = { fetchFootprintTypes };
