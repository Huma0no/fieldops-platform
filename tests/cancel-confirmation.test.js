describe('Cancel confirmation copy', () => {
  let confirmation

  beforeAll(async () => {
    ({ CANCEL_CONFIRMATION: confirmation } = await import('../frontend/pwa/src/lib/cancel-confirmation.mjs'))
  })

  it('uses the canonical irreversible wording shared by both entry points', () => {
    expect(confirmation).toEqual({
      title: 'Cancel this call?',
      body: 'This action is irreversible. Current Service, items, Weigh-In data, and pricing will be cleared. Notes and Checklist will be kept.',
      keepWorking: 'Keep Working',
      confirm: 'Cancel Call',
    })
  })
})
