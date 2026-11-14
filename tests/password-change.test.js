describe('first-login password change validation', () => {
  let getPasswordChangeError
  let togglePasswordVisibility

  beforeAll(async () => {
    ({ getPasswordChangeError, togglePasswordVisibility } = await import('../frontend/dispatch/src/lib/password-change.mjs'))
  })

  const validFields = {
    currentPassword: 'temporary-password',
    newPassword: 'valid-password-12',
    confirmPassword: 'valid-password-12',
  }

  test('accepts matching passwords at the 12-character minimum', () => {
    expect(getPasswordChangeError({ ...validFields, newPassword: '123456789012', confirmPassword: '123456789012' })).toBe('')
  })

  test('rejects passwords that do not match exactly', () => {
    expect(getPasswordChangeError({ ...validFields, confirmPassword: 'valid-password-13' })).toBe('New passwords do not match.')
  })

  test('rejects a new password shorter than 12 characters', () => {
    expect(getPasswordChangeError({ ...validFields, newPassword: 'short', confirmPassword: 'short' })).toBe('New password must be at least 12 characters.')
  })

  test.each([
    ['temporary password', { ...validFields, currentPassword: '' }, 'Enter your temporary password.'],
    ['new password', { ...validFields, newPassword: '' }, 'Enter a new password.'],
    ['confirmation password', { ...validFields, confirmPassword: '' }, 'Confirm your new password.'],
  ])('requires the %s', (_field, values, message) => {
    expect(getPasswordChangeError(values)).toBe(message)
  })

  test('toggles each visibility independently without changing password values', () => {
    const values = { newPassword: 'new-secret-value', confirmPassword: 'confirm-secret-value' }
    const hidden = { newPassword: false, confirmPassword: false }
    const showingNew = togglePasswordVisibility(hidden, 'newPassword')

    expect(showingNew).toEqual({ newPassword: true, confirmPassword: false })
    expect(togglePasswordVisibility(showingNew, 'confirmPassword')).toEqual({ newPassword: true, confirmPassword: true })
    expect(values).toEqual({ newPassword: 'new-secret-value', confirmPassword: 'confirm-secret-value' })
    expect(hidden).toEqual({ newPassword: false, confirmPassword: false })
  })
})
