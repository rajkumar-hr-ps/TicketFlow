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
  // Express 5: req.query is a read-only getter that returns a new object each call,
  // so override it with a sanitized snapshot via defineProperty.
  const rawQuery = req.query;
  if (rawQuery && typeof rawQuery === 'object') {
    Object.defineProperty(req, 'query', {
      value: sanitizeValue(rawQuery),
      writable: true,
      configurable: true,
    });
  }
  next();
};
