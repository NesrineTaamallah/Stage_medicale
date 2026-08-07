const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { listDossiers, getDossierDetail, updateChampDossier } = require('../controllers/dossierController');
const { uploaderFichierEntite, telechargerFichierEntite } = require('../controllers/entiteFichierController');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'entites');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${suffix}${path.extname(file.originalname)}`);
  },
});

// Formats attendus pour un document d'examen : image (IRM, EEG scanné,
// photo de compte-rendu) ou PDF.
const ALLOWED_MIME_ENTITE = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp'];

const uploadEntite = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 Mo
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_ENTITE.includes(file.mimetype)) {
      return cb(new Error('Format de fichier non autorisé (PDF ou image attendu).'));
    }
    cb(null, true);
  },
});

// Comme coordonneePatientRoutes : réservé aux cliniciens.
router.use(requireAuth, requireRole('clinicien'));

router.get('/', listDossiers);
router.get('/:pseudonyme', getDossierDetail);
router.patch('/:pseudonyme/champ', updateChampDossier);

// Document joint à une ligne d'examen (IRM, EEG, LCR, potentiels évoqués,
// génétique...) — voir migration_entites_fichier_joint.sql.
router.post('/:pseudonyme/entite-fichier', uploadEntite.single('fichier'), uploaderFichierEntite);
router.get('/entite-fichier/:table/:id/telecharger', telechargerFichierEntite);

module.exports = router;
