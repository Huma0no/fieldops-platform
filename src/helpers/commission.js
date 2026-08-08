// Computes the commission split for a technician's gross for a pay period.
// commission_rate is the house's cut, e.g. 20 means the house retains 20%
// and the technician nets 80%. Owners never have commission withheld.
function computeCommission(gross, role, commissionRate) {
  if (role === 'owner') {
    return { rateApplied: 0, commissionRetained: 0, netAmount: gross };
  }
  const rateApplied = Number(commissionRate);
  const commissionRetained = gross * (rateApplied / 100);
  const netAmount = gross - commissionRetained;
  return { rateApplied, commissionRetained, netAmount };
}

module.exports = { computeCommission };
