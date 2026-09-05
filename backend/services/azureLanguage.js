const axios = require('axios');

/**
 * Azure AI Language - /language/:analyze-text
 * Identificado no HAR: kind = "SentimentAnalysis" (com opinionMining) e
 * kind = "EntityRecognition".
 */
async function analyzeText({ text, kind, language = 'pt', opinionMining = true }) {
  const endpoint = process.env.AZURE_LANGUAGE_ENDPOINT;
  const key = process.env.AZURE_LANGUAGE_KEY;
  if (!endpoint || !key) {
    throw new Error('AZURE_LANGUAGE_ENDPOINT / AZURE_LANGUAGE_KEY não configurados no .env');
  }

  const url = `${endpoint.replace(/\/$/, '')}/language/:analyze-text`;

  const body = {
    kind,
    parameters:
      kind === 'SentimentAnalysis'
        ? { modelVersion: 'latest', opinionMining: opinionMining ? 'True' : 'False' }
        : { modelVersion: 'latest' },
    analysisInput: {
      documents: [{ id: '1', language, text }]
    }
  };

  const response = await axios.post(url, body, {
    params: { 'api-version': '2025-05-15-preview' },
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': key
    }
  });

  return response.data;
}

const analyzeSentiment = (text, language = 'pt') =>
  analyzeText({ text, kind: 'SentimentAnalysis', language, opinionMining: true });

const recognizeEntities = (text, language = 'pt') =>
  analyzeText({ text, kind: 'EntityRecognition', language });

module.exports = { analyzeText, analyzeSentiment, recognizeEntities };
