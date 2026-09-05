const axios = require('axios');

/**
 * Azure AI Translator - /translate
 * Identificado no HAR: POST https://api.cognitive.microsofttranslator.com/translate
 */
async function translateText(text, from, to) {
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  if (!key || !region) {
    throw new Error('AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION não configurados no .env');
  }

  const response = await axios.post(
    `${endpoint.replace(/\/$/, '')}/translate`,
    [{ text }],
    {
      params: { 'api-version': '3.0', from, to },
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': key,
        'Ocp-Apim-Subscription-Region': region
      }
    }
  );

  return response.data;
}

module.exports = { translateText };
