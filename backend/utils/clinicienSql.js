
const UNACCENT_SQL = `translate(
  LOWER(TRIM(%COL%::text)),
  'àâäéèêëïîôöùûüçÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ',
  'aaaeeeeiioouucaaaeeeeiioouuc'
)`;

function normalizedSql(column) {
  return UNACCENT_SQL.replace(/%COL%/g, column);
}

module.exports = { normalizedSql };
