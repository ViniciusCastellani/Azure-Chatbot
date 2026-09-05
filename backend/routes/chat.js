const express = require('express');
const multer = require('multer');
const router = express.Router();
const { planPipeline, summarizeResults } = require('../services/openRouter');
const { runSteps } = require('../services/Pipelinerunner');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Tipos de passo que exigem um arquivo (áudio/imagem/documento) em vez de texto.
const FILE_INPUT_TYPES = new Set(['audio', 'image', 'document']);

/**
 * POST /api/chat/plan
 * multipart/form-data:
 *   - message: string
 *   - history: JSON.stringify([{role, content}, ...]) (opcional)
 *   - file:    arquivo anexado pelo usuário via clipe (opcional)
 *
 * Envia o pedido do usuário ao OpenRouter, que decide QUAIS serviços Azure
 * usar e EM QUE ORDEM. O front-end usa "nextInput" para decidir qual campo
 * de upload/texto mostrar na conversa — mas o usuário também pode anexar um
 * arquivo diretamente pelo clipe do campo de mensagem, ANTES de o OpenRouter
 * pedir por ele. Quando isso acontece e o arquivo já é do tipo que o
 * primeiro passo do plano precisa, executamos o pipeline imediatamente, sem
 * depender da zona de upload dinâmica ter sido liberada.
 */
router.post('/plan', upload.single('file'), async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    let history = [];
    try {
      history = req.body.history ? JSON.parse(req.body.history) : [];
    } catch {
      history = [];
    }

    const file = req.file || null;

    if (!message && !file) {
      return res.status(400).json({ error: 'Envie uma mensagem e/ou um arquivo anexado.' });
    }

    // Se o usuário só anexou um arquivo (sem digitar nada), damos ao
    // planejador uma pista mínima em texto para ele conseguir decidir o
    // pipeline mesmo assim.
    const effectiveMessage = message || `O usuário anexou o arquivo "${file.originalname}" (${file.mimetype}) sem escrever uma mensagem. Decida o pipeline mais provável para esse tipo de arquivo.`;

    const plan = await planPipeline({ message: effectiveMessage, history });

    // Caso 1: o texto a ser processado já veio dentro da própria mensagem
    // (ex: "Traduza 'Hello' para Português"). O OpenRouter extraiu esse
    // texto em plan.extractedText — executamos o pipeline agora.
    if (plan.extractedText && Array.isArray(plan.steps) && plan.steps.length > 0) {
      const pipelineResult = await runSteps({ steps: plan.steps, initialText: plan.extractedText });
      return res.json(await buildAutoExecutedResponse(plan, effectiveMessage, pipelineResult));
    }

    // Caso 2: o usuário já anexou (via clipe) um arquivo que bate com o tipo
    // exigido pelo primeiro passo do plano — não precisamos esperar a zona
    // dinâmica de upload; executamos direto com o arquivo recebido agora.
    const firstStep = Array.isArray(plan.steps) && plan.steps.length > 0 ? plan.steps[0] : null;
    if (file && firstStep && FILE_INPUT_TYPES.has(firstStep.inputType)) {
      const pipelineResult = await runSteps({
        steps: plan.steps,
        fileBuffer: file.buffer,
        fileMimeType: file.mimetype,
        fileName: file.originalname
      });
      return res.json(await buildAutoExecutedResponse(plan, effectiveMessage, pipelineResult));
    }

    // Caso 3: um arquivo foi anexado, mas o plano não precisa dele agora
    // (ex.: o primeiro passo exige texto). Avisamos o usuário no lugar de
    // simplesmente ignorar o anexo em silêncio.
    if (file && !(firstStep && FILE_INPUT_TYPES.has(firstStep.inputType))) {
      plan.reply = `${plan.reply}\n\n(Obs.: recebi o arquivo "${file.originalname}", mas esta etapa não precisa dele — ele foi descartado.)`;
    }

    res.json(plan);
  } catch (err) {
    console.error('[chat/plan]', err.message);
    res.status(500).json({ error: 'Falha ao consultar o OpenRouter.', details: err.message });
  }
});

async function buildAutoExecutedResponse(plan, userGoal, pipelineResult) {
  let summary = null;
  try {
    summary = await summarizeResults({ userGoal, results: pipelineResult.steps });
  } catch (sumErr) {
    console.error('[chat/plan][summarize]', sumErr.message);
  }

  return {
    ...plan,
    nextInput: 'none',
    autoExecuted: true,
    pipelineResult,
    summary
  };
}

/**
 * POST /api/chat/summarize
 * Body: { userGoal: string, results: any }
 * Uso opcional: transforma os resultados brutos da Azure em um resumo em
 * linguagem natural, usando novamente o OpenRouter.
 */
router.post('/summarize', async (req, res) => {
  try {
    const { userGoal, results } = req.body;
    const summary = await summarizeResults({ userGoal, results });
    res.json({ summary });
  } catch (err) {
    console.error('[chat/summarize]', err.message);
    res.status(500).json({ error: 'Falha ao resumir resultados.', details: err.message });
  }
});

module.exports = router;