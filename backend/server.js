require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const chatRoutes = require('./routes/chat');
const visionRoutes = require('./routes/vision');
const speechRoutes = require('./routes/speech');
const languageRoutes = require('./routes/language');
const translateRoutes = require('./routes/translate');
const documentRoutes = require('./routes/document');
const pipelineRoutes = require('./routes/pipeline');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API routes - cada uma corresponde a um serviço Azure identificado no HAR do Insomnia
app.use('/api/chat', chatRoutes);
app.use('/api/vision', visionRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/language', languageRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/document', documentRoutes);
app.use('/api/pipeline', pipelineRoutes);

// Serve o front-end estático (HTML/CSS/JS puro)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
