const axios = require('axios');
const FormData = require('form-data');

/**
 * Azure AI Translator - Document Translation (API síncrona, sem necessidade
 * de Blob Storage): traduz um ARQUIVO inteiro (.docx, .pdf, .pptx, .xlsx,
 * .html, .txt) preservando a formatação original, diferente do serviço
 * "translate" (que só traduz uma string de texto simples).
 *
 * Endpoint: POST {endpoint}/translator/document:translate
 *   ?sourceLanguage=xx&targetLanguage=yy&api-version=2024-05-01
 *
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} mimeType
 * @param {string} targetLanguage - ex: 'en', 'es', 'fr'
 * @param {string} [sourceLanguage] - opcional; se omitido, a Azure detecta automaticamente
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
async function translateDocument(fileBuffer, filename, mimeType, targetLanguage, sourceLanguage) {
  const endpoint = process.env.AZURE_DOC_TRANSLATOR_ENDPOINT;
  const key = process.env.AZURE_DOC_TRANSLATOR_KEY;
  if (!endpoint || !key) {
    throw new Error('AZURE_DOC_TRANSLATOR_ENDPOINT / AZURE_DOC_TRANSLATOR_KEY não configurados no .env');
  }
  if (!targetLanguage) {
    throw new Error('Informe o idioma de destino (targetLanguage) para a tradução do documento.');
  }

  const url = `${endpoint.replace(/\/$/, '')}/translator/document:translate`;

  const form = new FormData();
  form.append('document', fileBuffer, { filename, contentType: mimeType || 'application/octet-stream' });

  const params = { targetLanguage, 'api-version': '2024-05-01' };
  if (sourceLanguage) params.sourceLanguage = sourceLanguage;

  const response = await axios.post(url, form, {
    params,
    headers: {
      ...form.getHeaders(),
      'Ocp-Apim-Subscription-Key': key
    },
    responseType: 'arraybuffer',
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || mimeType || 'application/octet-stream'
  };
}

module.exports = { translateDocument };
