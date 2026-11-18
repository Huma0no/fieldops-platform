module.exports = async () => {
  await globalThis.__testRunLockClient?.end();
};
