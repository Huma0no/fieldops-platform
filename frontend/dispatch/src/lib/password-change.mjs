export const MIN_PASSWORD_LENGTH = 12

export function getPasswordChangeError ({ currentPassword, newPassword, confirmPassword }) {
  if (!currentPassword) return 'Enter your temporary password.'
  if (!newPassword) return 'Enter a new password.'
  if (!confirmPassword) return 'Confirm your new password.'
  if (newPassword.length < MIN_PASSWORD_LENGTH) return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  if (newPassword !== confirmPassword) return 'New passwords do not match.'
  return ''
}

export function togglePasswordVisibility (visibility, field) {
  return { ...visibility, [field]: !visibility[field] }
}
