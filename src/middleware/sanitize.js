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
  // Express 5: req.query and req.params are read-only, sanitize values in-place
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$')) {
        delete req.query[key];
      } else {
        req.query[key] = sanitizeValue(req.query[key]);
      }
    }
  }
  if (req.params && typeof req.params === 'object') {
    for (const key of Object.keys(req.params)) {
      if (key.startsWith('$')) {
        delete req.params[key];
      } else {
        req.params[key] = sanitizeValue(req.params[key]);
      }
    }
  }
  next();
};
