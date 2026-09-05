const axios = require('axios');

/**
 * Azure AI Document Intelligence - modelo prebuilt-layout
 * Identificado no HAR:
 *   POST .../documentModels/prebuilt-layout:analyze?features=...  (202 + header operation-location)
 *   GET  <operation-location>                                     (polling até status "succeeded")
 *
 * @param {Buffer} fileBuffer
 * @param {string} contentType - ex: 'application/pdf' ou 'image/png'
 */
async function analyzeDocument(fileBuffer, contentType = 'application/pdf') {
  const endpoint = process.env.AZURE_DOCINTEL_ENDPOINT;
  const key = process.env.AZURE_DOCINTEL_KEY;
  if (!endpoint || !key) {
    throw new Error('AZURE_DOCINTEL_ENDPOINT / AZURE_DOCINTEL_KEY não configurados no .env');
  }

  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-layout:analyze`;

  const submitResponse = await axios.post(analyzeUrl, fileBuffer, {
    params: {
      features: 'ocr.highResolution,ocr.formula,ocr.font',
      'api-version': '2024-11-30'
    },
    headers: {
      'Content-Type': contentType,
      'Ocp-Apim-Subscription-Key': key
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  const operationLocation = submitResponse.headers['operation-location'];
  if (!operationLocation) {
    throw new Error('Azure Document Intelligence não retornou operation-location.');
  }

  return pollUntilDone(operationLocation, key);
}

async function pollUntilDone(operationLocation, key, maxAttempts = 20, delayMs = 1500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await axios.get(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });

    if (res.data.status === 'succeeded') return res.data;
    if (res.data.status === 'failed') {
      throw new Error('Azure Document Intelligence falhou ao processar o documento.');
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Tempo esgotado aguardando o resultado do Document Intelligence.');
}

module.exports = { analyzeDocument };
