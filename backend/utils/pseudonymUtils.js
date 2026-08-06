const crypto = require('crypto');
require('dotenv').config();

// Sel dédié (distinct de TOTP_ENCRYPTION_KEY) : le pseudonyme doit être
// stable et reproductible pour un même numéro de dossier + registre (pas de
// re-tirage à chaque appel), mais pas devinable à partir du seul numéro de
// dossier en clair -> HMAC avec un secret côté serveur plutôt qu'un simple
// SHA-256(numero_dossier).
const PEPPER = process.env.PSEUDONYM_PEPPER || process.env.TOTP_ENCRYPTION_KEY;

if (!PEPPER) {
  throw new Error(
    'PSEUDONYM_PEPPER (ou TOTP_ENCRYPTION_KEY) manquant dans le .env : requis pour générer les pseudonymes.'
  );
}

/**
 * Génère le pseudonyme d'un patient à partir de son registre et de son
 * numéro de dossier en clair.
 *
 * Format : `${registre}_${HMAC tronqué en majuscules}`, ex. SEP_9F3A2B1C —
 * volontairement différent des pseudonymes legacy type SEP_MJ_001 (initiales
 * + compteur) présents dans les scripts de seed existants : ceux-là étaient
 * attribués à la main pendant la phase de constitution du registre, alors
 * qu'ici on a besoin d'une fonction déterministe et non réversible calculée
 * côté serveur à partir du numéro de dossier saisi par le clinicien.
 *
 * Déterministe : le même (registre, numero_dossier) redonne toujours le même
 * pseudonyme, donc soumettre deux fois le même numéro de dossier retombe sur
 * la même fiche patient (cf. ON CONFLICT DO UPDATE de createCoordonnee) au
 * lieu de créer un doublon.
 */
function genererPseudonyme(registre, numeroDossier) {
  if (!registre || !numeroDossier) {
    throw new Error('registre et numeroDossier requis pour générer le pseudonyme.');
  }
  const hmac = crypto
    .createHmac('sha256', PEPPER)
    .update(`${registre}:${String(numeroDossier).trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();

  return `${registre}_${hmac}`;
}

module.exports = { genererPseudonyme };
