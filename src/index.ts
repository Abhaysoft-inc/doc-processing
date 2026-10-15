import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import docpRouter from './modules/doc-processing/docp.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve UI assets from public folder
app.use(express.static(path.resolve(process.cwd(), 'public')));

// Routes
app.use('/api/docs', docpRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`UI available at: http://localhost:${PORT}`);
});
