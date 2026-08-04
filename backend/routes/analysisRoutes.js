const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAccess } = require('../utils/accessLog'); // déjà utilisé ailleurs dans le repo

const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000';

// Accès réservé clinicien / statisticien (rôle déjà défini dans schema.sql)
router.use(requireAuth, requireRole('clinicien', 'statisticien'));

// Liste des analyses disponibles (alimente dynamiquement le frontend)
router.get('/', async (req, res) => {
  try {
    const r = await fetch(`${ANALYSIS_SERVICE_URL}/analyses`);
    if (!r.ok) throw new Error(`Service analyse HS (${r.status})`);
    res.json(await r.json());
  } catch (err) {
    console.error('Erreur proxy /analyses :', err);
    res.status(502).json({ error: "Service d'analyse indisponible." });
  }
});

// Exécution d'une analyse précise avec la config choisie par le clinicien
router.post('/:analyseId/run', async (req, res) => {
  const { analyseId } = req.params;
  try {
    const r = await fetch(`${ANALYSIS_SERVICE_URL}/analyses/${analyseId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();

    await logAccess({
      userId: req.user.sub,
      action: `analyse_statistique:${analyseId}`,
      success: r.ok,
      req,
    });

    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error(`Erreur proxy /analyses/${analyseId}/run :`, err);
    res.status(502).json({ error: "Service d'analyse indisponible." });
  }
});

module.exports = router;

// Dans app.js, ajouter :
//   const analysisRoutes = require('./routes/analysisRoutes');
//   app.use('/api/analyses', analysisRoutes);
