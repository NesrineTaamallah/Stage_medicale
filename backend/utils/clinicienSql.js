/**
 * Normalise un fragment SQL texte : accents retirés (via translate sur les
 * accents français courants), espaces superflus supprimés, casse uniformisée.
 * Utilisé pour toute comparaison de valeur catégorielle saisie librement
 * (Oui/oui/OUI, Positif/positif, Décédé/decede, etc.) sans jamais modifier
 * le schéma imposé — uniquement au niveau des requêtes.
 *
 * Partagé entre clinicienOverviewController.js, clinicienSepController.js et
 * clinicienEprController.js depuis la découpe de l'ancien controller unique.
 */
const UNACCENT_SQL = `translate(
  LOWER(TRIM(%COL%::text)),
  'àâäéèêëïîôöùûüçÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ',
  'aaaeeeeiioouucaaaeeeeiioouuc'
)`;

function normalizedSql(column) {
  return UNACCENT_SQL.replace(/%COL%/g, column);
}

module.exports = { normalizedSql };
