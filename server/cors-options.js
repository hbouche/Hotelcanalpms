function corsOptions(env = process.env) {
  const origins = (env.ALLOWED_ORIGINS || env.RENDER_EXTERNAL_URL || '')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  return {
    // Render assigns this origin when provisioning, after Blueprint inputs.
    // With no production origin, same-origin requests work without CORS.
    origin: env.NODE_ENV === 'production' ? (origins.length ? origins : false) : true,
    credentials: true
  };
}

module.exports = corsOptions;
