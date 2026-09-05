const axios = require('axios');

/**
 * Azure AI Vision (Computer Vision v3.2) - /vision/v3.2/analyze
 * Identificado no HAR: requisições com visualFeatures=Description,Objects,Brands
 * e também Faces / Brands isoladamente.
 *
 * @param {Buffer} imageBuffer - bytes da imagem enviada pelo usuário
 * @param {string[]} visualFeatures - ex: ['Description','Objects','Brands','Faces']
 */
async function analyzeImage(imageBuffer, visualFeatures = ['Description', 'Objects', 'Brands']) {
  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const key = process.env.AZURE_VISION_KEY;
  if (!endpoint || !key) {
    throw new Error('AZURE_VISION_ENDPOINT / AZURE_VISION_KEY não configurados no .env');
  }

  const url = `${endpoint.replace(/\/$/, '')}/vision/v3.2/analyze`;

  const response = await axios.post(url, imageBuffer, {
    params: {
      visualFeatures: visualFeatures.join(','),
      language: 'pt'
    },
    headers: {
      'Content-Type': 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': key
    }
  });

  return response.data;
}

module.exports = { analyzeImage };
