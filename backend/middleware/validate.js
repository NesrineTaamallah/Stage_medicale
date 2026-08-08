
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      
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