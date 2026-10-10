const servicePaths = new Set([
  '/health', '/auth/start', '/auth/callback',
  '/api/snapshot', '/api/photos', '/api/logout'
]);
const error = (code, status) => Response.json({ error: code }, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!/^https:\/\/[^/]+$/.test(env.PUBLIC_SERVICE_ORIGIN || '')) {
      return error('not_configured', 503);
    }
    // Pages preview URLs must not become alternate authentication endpoints.
    if (url.origin !== env.PUBLIC_SERVICE_ORIGIN) return error('invalid_origin', 403);
    try {
      if (['/', '/index.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
        return await env.ASSETS.fetch(request);
      }
      if (!servicePaths.has(url.pathname)) return error('not_found', 404);
      if (!env.UPLOAD_SERVICE?.fetch) return error('not_configured', 503);
      // Preserve the public URL, body, Origin, cookies and authorization.
      // The existing Worker remains responsible for every authentication and write check.
      return await env.UPLOAD_SERVICE.fetch(request);
    } catch {
      return error('service_unavailable', 503);
    }
  }
};
