/**
 * Middleware factory : valide req.body contre un schéma zod.
 * En cas d'échec, renvoie 400 avec le premier message d'erreur.
 * En cas de succès, remplace req.body par la version normalisée
 * (ex: email en minuscule via .toLowerCase() du schéma).
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Zod v4 expose les erreurs de validation sous `issues` (et non plus
      // `errors` comme en v3). C'était la cause du crash TypeError observé
      // ("Cannot read properties of undefined (reading '0')").
      const firstIssue = result.error.issues?.[0];
      return res.status(400).json({
        error: firstIssue?.message || 'Requête invalide.',
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;