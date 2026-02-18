function sanitizeValue(value) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (typeof value === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized;
  }

  return value;
}

export const sanitize = (req, res, next) => {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) req.query = sanitizeValue(req.query);
  if (req.params) req.params = sanitizeValue(req.params);
  next();
};
