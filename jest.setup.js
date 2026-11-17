require('dotenv').config({ path: '.env.test' });

// Photo uploads in tests go to a throwaway folder, never the repository.
process.env.PHOTO_STORAGE_DIR ??= require('path').join(require('os').tmpdir(), 'fieldops-test-photos');

// supertest calls app.listen(0), which binds every interface (IPv6 `::`), and then
// connects to 127.0.0.1. On macOS another process can already own 127.0.0.1:<port>,
// so the request reaches that process (e.g. a 404 from another app) instead of
// FieldOps. Binding the test server to 127.0.0.1 makes such a port unusable.
const { application } = require('express');
const listen = application.listen;
application.listen = function (port, ...rest) {
  if (port === 0 && typeof rest[0] !== 'string') return listen.call(this, 0, '127.0.0.1', ...rest);
  return listen.call(this, port, ...rest);
};
