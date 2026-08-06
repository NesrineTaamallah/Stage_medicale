const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { creerDossier } = require('../controllers/dossierUploadController');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${suffix}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_MIME = {
  audio: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac'],
  scan: ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'],
};

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 Mo (dictées audio longues)
  fileFilter: (req, file, cb) => {
    const typeEntree = req.body.type_entree;
    const allowed = ALLOWED_MIME[typeEntree];
    if (!allowed) return cb(new Error("Type d'entrée manquant ou invalide."));
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`Format de fichier non autorisé pour l'entrée "${typeEntree}".`));
    }
    cb(null, true);
  },
});

// Seul le clinicien saisit de nouveaux dossiers.
router.post('/creer', requireAuth, requireRole('clinicien'), upload.single('fichier'), creerDossier);

module.exports = router;

// Dans app.js, ajouter :
//   const dossierUploadRoutes = require('./routes/dossierUploadRoutes');
//   app.use('/api/dossiers', dossierUploadRoutes);
// (peut cohabiter avec dossierRoutes existant, qui monte déjà /api/dossiers)
