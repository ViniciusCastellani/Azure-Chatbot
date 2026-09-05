const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Prompt de sistema que transforma o OpenRouter no "planejador" do
 * orquestrador: ele lê o pedido em linguagem natural do usuário e decide
 * QUAIS serviços de Azure AI usar e EM QUE ORDEM (pipeline).
 *
 * Serviços disponíveis (mapeados 1:1 para os que foram identificados nas
 * requisições do Insomnia/HAR):
 *  - "vision"        -> Azure AI Vision (Computer Vision v3.2 /analyze)
 *                       precisa de uma IMAGEM. Use para: reconhecer marcas,
 *                       objetos, faces ou gerar descrição/legenda de imagem.
 *  - "speech-to-text" -> Azure AI Speech (Fast Transcription) precisa de um
 *                       ÁUDIO (.mp3, .wav, etc). Use para: transcrever
 *                       reuniões, ligações, áudios em geral.
 *  - "text-to-speech" -> Azure AI Speech (voz sintética) precisa de TEXTO.
 *                       Use para: transformar um texto em áudio falado.
 *  - "sentiment"      -> Azure AI Language (Sentiment Analysis + Opinion
 *                       Mining) precisa de TEXTO. Use para: saber se um
 *                       texto/fala é positiva, negativa ou neutra.
 *  - "ner"            -> Azure AI Language (Entity Recognition) precisa de
 *                       TEXTO. Use para: extrair nomes, lugares,
 *                       organizações, datas, valores, etc.
 *  - "translate"      -> Azure AI Translator precisa de TEXTO. Use para:
 *                       traduzir texto de um idioma para outro.
 *  - "document-intelligence" -> Azure AI Document Intelligence precisa de
 *                       um ARQUIVO (PDF/imagem de documento, nota fiscal,
 *                       contrato, formulário). Use para: extrair texto e
 *                       layout de documentos.
 *  - "document-translate" -> Azure AI Translator (Document Translation)
 *                       precisa de um ARQUIVO (.docx, .pdf, .pptx, .xlsx,
 *                       .html, .txt). Use para: traduzir um ARQUIVO inteiro
 *                       para outro idioma preservando a formatação original
 *                       (diferente de "translate", que só traduz texto solto).
 *
 * O modelo DEVE responder SOMENTE em JSON, sem markdown, seguindo o schema:
 * {
 *   "reply": "mensagem curta e amigável em pt-BR explicando o plano",
 *   "steps": [
 *      { "service": "speech-to-text", "inputType": "audio", "params": {} },
 *      { "service": "sentiment", "inputType": "text", "params": { "language": "pt" } }
 *   ],
 *   "nextInput": "audio" | "image" | "text" | "document" | "none",
 *   "clarification": null | "pergunta objetiva caso falte informação",
 *   "extractedText": null | "texto literal já fornecido pelo usuário na própria mensagem"
 * }
 */
const SYSTEM_PROMPT = `Você é o módulo de planejamento de um assistente que orquestra serviços de Inteligência Artificial da Microsoft Azure.

Sua única tarefa é interpretar o que o usuário deseja e responder EXCLUSIVAMENTE com um objeto JSON válido (sem \`\`\`, sem comentários, sem texto fora do JSON), seguindo este formato:

{
  "reply": "texto curto e amigável em pt-BR explicando o que você vai fazer",
  "steps": [ { "service": "<um dos serviços abaixo>", "inputType": "audio|image|text|document", "params": {} } ],
  "nextInput": "audio|image|text|document|none",
  "clarification": null,
  "extractedText": null
}

Serviços válidos para "service" e quando usá-los:
- "vision": análise de imagem (reconhecer marcas/logotipos, objetos, faces, gerar descrição). inputType = "image".
- "speech-to-text": transcrever áudio/reunião/fala em texto. inputType = "audio".
- "text-to-speech": converter um texto em áudio falado. inputType = "text".
- "sentiment": analisar sentimento/opinião de um texto. inputType = "text".
- "ner": extrair entidades nomeadas (pessoas, locais, datas, valores) de um texto. inputType = "text".
- "translate": traduzir um texto entre idiomas. Preencha params.from e params.to (códigos ISO, ex: "en", "pt", "fr"). inputType = "text".
- "document-intelligence": extrair texto/layout de um documento (PDF, nota fiscal, contrato, formulário) — o documento fica LEGÍVEL/pesquisável, mas não é traduzido. inputType = "document".
- "document-translate": traduzir um ARQUIVO inteiro (.docx, .pdf, .pptx, .xlsx, .html, .txt) para outro idioma, preservando a formatação original. Preencha params.to (obrigatório) e params.from (opcional). inputType = "document".

Regras importantes:
1. Um pedido pode exigir MAIS DE UM serviço em sequência (pipeline). Ex.: "quero saber se as pessoas gostaram da reunião" => primeiro "speech-to-text" (transcrever o áudio) e depois "sentiment" (analisar o texto transcrito). Coloque os passos em "steps" na ORDEM correta de execução.
2. "nextInput" deve indicar qual tipo de entrada deve ser pedido ao usuário AGORA (corresponde ao inputType do primeiro passo). Se ainda faltar alguma informação essencial (ex: idioma de destino da tradução), deixe "steps" com o que já é possível inferir e preencha "clarification" com UMA pergunta objetiva; caso contrário "clarification" deve ser null.
3. Nunca invente serviços fora da lista.
4. Sempre responda em português do Brasil no campo "reply".
5. IMPORTANTE — "extractedText": se o texto a ser processado (o que precisa ser traduzido, analisado, etc.) já veio escrito DENTRO da própria mensagem do usuário (ex: entre aspas, ou logo após o comando, ex: 'Traduza para Português: "Hello how are you?"'), copie esse texto EXATAMENTE como foi escrito (sem alterar, sem traduzir você mesmo) para o campo "extractedText". Não invente nem resuma — copie literalmente. O backend vai usar esse texto para executar o pipeline imediatamente, sem precisar perguntar de novo.
6. Se o comando foi dado mas o CONTEÚDO (texto/arquivo) ainda NÃO foi enviado (ex: "quero traduzir um texto para inglês"), deixe "extractedText": null e escreva em "reply" algo natural pedindo o conteúdo, por exemplo: "Entendido! Pode me mandar o texto que deseja traduzir?". Não invente conteúdo.
7. Nunca deixe "extractedText" preenchido se o passo inicial ("nextInput") exigir um ARQUIVO (audio, image, document) — nesses casos "extractedText" deve ser null, pois o usuário precisa fazer upload.`;

async function planPipeline({ message, history = [] }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada no .env');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message }
  ];

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
    'X-Title': process.env.OPENROUTER_SITE_NAME || 'Azure AI Orchestrator Chatbot'
  };

  const basePayload = {
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    messages,
    temperature: 0.2
  };

  let raw = '';
  try {
    // Tenta primeiro forçando o modo JSON nativo (suportado por boa parte
    // dos modelos no OpenRouter). Isso reduz muito a chance do modelo
    // responder com texto solto em vez do JSON esperado.
    const response = await axios.post(
      OPENROUTER_URL,
      { ...basePayload, response_format: { type: 'json_object' } },
      { headers }
    );
    raw = response.data?.choices?.[0]?.message?.content || '';
  } catch (err) {
    // Nem todo modelo/roteador aceita "response_format" — se der erro por
    // causa disso, refaz a chamada sem essa opção.
    const response = await axios.post(OPENROUTER_URL, basePayload, { headers });
    raw = response.data?.choices?.[0]?.message?.content || '';
  }

  return parsePlanJson(raw);
}

/**
 * O OpenRouter às vezes envolve o JSON em blocos ```json ... ``` ou até
 * acrescenta uma frase de explicação antes/depois do objeto JSON. Esta
 * função extrai o JSON de forma tolerante (pegando do primeiro "{" ao
 * último "}" da resposta) e faz o parse com segurança, devolvendo um plano
 * "seguro" mesmo se o modelo falhar em obedecer o formato.
 */
function parsePlanJson(raw) {
  const withoutFences = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonSlice = extractJsonObject(withoutFences) || withoutFences;

  try {
    const parsed = JSON.parse(jsonSlice);
    return {
      reply: parsed.reply || 'Certo! Vamos continuar.',
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      nextInput: parsed.nextInput || 'text',
      clarification: parsed.clarification || null,
      extractedText: parsed.extractedText || null
    };
  } catch (err) {
    console.error('[openRouter] Falha ao interpretar JSON do plano. Resposta bruta:', raw);
    return {
      reply: raw || 'Não consegui entender completamente o pedido. Pode reformular?',
      steps: [],
      nextInput: 'text',
      clarification: 'Pode detalhar melhor o que você precisa (ex: transcrever áudio, analisar imagem, traduzir texto)?',
      extractedText: null
    };
  }
}

/**
 * Extrai o trecho entre o primeiro "{" e o último "}" da string — cobre o
 * caso do modelo responder algo como: 'Claro! Aqui está: { ...json... }
 * Espero ter ajudado!'.
 */
function extractJsonObject(str) {
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return str.slice(start, end + 1);
}

/**
 * Remove recursivamente campos de baixo nível do OCR (confiança/posição de
 * cada palavra individual, coordenadas de polígono, spans internos) que só
 * servem para renderização visual — não agregam nada à leitura do conteúdo
 * e, numa nota fiscal grande, podem ser centenas de entradas repetidas.
 * Mantém "content" (texto completo) e "tables" (itens estruturados).
 */
const NOISY_OCR_KEYS = new Set(['words', 'polygon', 'spans', 'boundingRegions']);

function stripOcrNoise(value) {
  if (Array.isArray(value)) {
    return value.map(stripOcrNoise);
  }
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(value)) {
      if (NOISY_OCR_KEYS.has(key)) continue;
      clean[key] = stripOcrNoise(val);
    }
    return clean;
  }
  return value;
}

/**
 * Remove campos binários pesados (áudio/arquivo em base64) antes de mandar
 * os resultados para o OpenRouter — eles não agregam nada à explicação em
 * texto e só desperdiçariam tokens (ou estourariam o limite de contexto).
 * Também limpa o ruído de OCR do Document Intelligence (ver stripOcrNoise).
 */
function sanitizeResultsForSummary(results) {
  return (results || []).map((step) => {
    const clone = { ...step };
    if (clone.audioBase64) clone.audioBase64 = '[áudio já gerado — disponível para o usuário ouvir/baixar]';
    if (clone.fileBase64) clone.fileBase64 = '[arquivo já gerado — disponível para o usuário baixar]';
    if (clone.service === 'document-intelligence' && clone.result) {
      clone.result = stripOcrNoise(clone.result);
    }
    return clone;
  });
}

/**
 * Usa o OpenRouter para transformar o JSON técnico devolvido pelos serviços
 * Azure em um texto legível para o usuário final, em português do Brasil —
 * SEM resumir ou descartar informação: apenas reorganiza e reescreve de
 * forma clara (troca "confidenceScores" por "confiança de 92%", por
 * exemplo), mantendo todos os dados relevantes (todas as entidades, todo o
 * texto traduzido/transcrito/extraído, todas as tags, etc.).
 */
async function summarizeResults({ userGoal, results }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const safeResults = sanitizeResultsForSummary(results);

  const prompt = `O usuário pediu: "${userGoal}".

Os seguintes resultados técnicos (em JSON) foram obtidos dos serviços de IA da Azure, na ordem em que foram executados:
${JSON.stringify(safeResults)}

Sua tarefa é reescrever esses resultados como uma explicação em português do Brasil, clara e fácil de ler para uma pessoa sem conhecimento técnico.

REGRAS GERAIS (siga à risca):
1. NÃO omita CONTEÚDO relevante: o texto completo traduzido/transcrito/extraído, todas as entidades reconhecidas, os scores de sentimento, todas as tags/marcas/faces da análise de imagem, os valores e itens de uma nota fiscal/documento, etc. — isso tudo tem que aparecer.
2. Você PODE e DEVE reescrever e reorganizar para ficar legível (ex.: trocar "confidenceScores.positive: 0.92" por "92% de confiança de que o sentimento é positivo"), mas sem inventar dado que não esteja no JSON.
3. NÃO confunda "conteúdo" com "metadado técnico de baixo nível". Metadado técnico — como a confiança de reconhecimento de CADA PALAVRA individual de um OCR, IDs internos, timestamps de criação/atualização, versão de API/modelo usado, tipo de indexação — NÃO deve ser listado item a item. Mencione uma métrica de qualidade agregada apenas se for relevante (ex.: "algumas palavras do documento têm baixa confiança de leitura e podem estar incorretas"), nunca uma lista palavra por palavra.
4. Organize por etapa executada, com um título curto por etapa (ex.: "Tradução:", "Análise de Sentimento:", "Documento Extraído:"), com uma linha em branco entre as seções.
5. Nunca mostre JSON cru, chaves técnicas (camelCase) ou código — escreva tudo em prosa e listas simples.
6. Se algum passo tiver retornado um "error", explique esse erro em linguagem simples, sem esconder que algo falhou.
7. Não adicione opiniões ou informações que não estejam no JSON fornecido.

REGRA ESPECÍFICA para resultados de "document-intelligence" (extração de documentos como notas fiscais, contratos, formulários):
- Apresente o CONTEÚDO do documento de forma organizada e legível: dados do emissor, itens/produtos com quantidade e valor, totais, datas, números de documento, etc. — tudo que estiver no texto extraído.
- Se o resultado tiver uma lista de "palavras reconhecidas com nível de confiança" (word-level confidence), IGNORE essa lista por completo na sua resposta — ela é ruído técnico interno do OCR e nunca deve ser reproduzida palavra por palavra.
- Se o documento tiver tabelas, apresente os itens da tabela em formato de lista simples (ex.: "- Buffet a peso — 0,378 kg — R$ 32,50"), não como uma tabela técnica com nomes de coluna genéricos.`;

  const response = await axios.post(
    OPENROUTER_URL,
    {
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 4000
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'Azure AI Orchestrator Chatbot'
      }
    }
  );

  return response.data?.choices?.[0]?.message?.content || null;
}

module.exports = { planPipeline, summarizeResults };