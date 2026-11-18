// Fake CP3000 route (no real people, addresses or phones), laid out like the
// real sheets: company line and ROUTE header per page, "HVAC SERVICE" before
// each block, time + builder line (one block's is missing), "# job" line,
// "CITY ST [ZIP]  BUILDER CONTACT PHONE", Map Info/No Map label prefixes,
// multi-line notes, equipment lines, one build step per line, page footer.
const pageTop = () => [
  [['Sample Air Company', 0], ['06/24/2026', 6.6]],
  { line: [["SAMPLE TECH'S ROUTE for Wednesday, June 24, 2026", 0.9]], bold: true },
  [['EMPLOYEE SCHEDULE', 2.9]],
  '',
  [['HVAC', 5.6], ['SERVICE', 6.6]],
];
const footer = (page, of) => [
  '',
  [["SAMPLE TECH'S SCHEDULE for Wednesday, 06/24/2026", 0], [`Page ${page} of ${of}`, 6.5]],
];

const route = [
  {
    lines: [
      ...pageTop(),
      { line: [['8:00 AM', 0], ['STONEBRIDGE', 1.0], ['RESIDENTIAL', 5.4], ['AC STARTUP', 6.5]], bold: true },
      [['# 7100001', 0], ['101 TESTWOOD LN', 1.0], ['ELM GROVE', 4.0], ['ALL PAYMENT TYPES', 5.6]],
      [['SAMPLEVILLE TX', 1.0], ['STONEBRIDGE ALEX EXAMPLE 555 010 0001', 2.4]],
      [['Map Info', 0], ['Called In By: OFFICE DESK', 1.0]],
      [['No Map', 0], ['PROBLEM: AC & Heating Startup', 1.0]],
      [['IMPORTANT NOTES: GATE CODE 0000 * plan 100 * 3.0 ton * 1-media filter', 1.0]],
      [['**see office', 1.0]],
      [['HEATER # ML196UH045XE36BK   COIL # CX35-36B-6F   UNIT # 5TTR5024A1', 1.0]],
      '',
      [['ROUGH J SAMPLE 1/2/26', 1.0]],
      [['TRIM K SAMPLE 3/4/26 •', 1.0]],
      '',
      [['HVAC', 5.6], ['SERVICE', 6.6]],
      { line: [['9:30 AM', 0], ['MAPLECREST', 1.0], ['RESIDENTIAL', 5.4], ['AC STARTUP', 6.5]], bold: true },
      [['# 7100002', 0], ['202 SAMPLE RIDGE DR', 1.0], ['BIRCH HOLLOW', 4.0], ['WARRANTY', 5.8]],
      [['TESTCITY TX 77000', 1.0], ['MAPLECREST JORDAN SAMPLE 555-010-0002', 2.8]],
      [['Map Info', 0], ['Called In By: SITE SUPER', 1.0]],
      [['No Map', 0], ['PROBLEM: Finish Start Up', 1.0]],
      [['IMPORTANT NOTES: TWO SYSTEMS * #1210 filter note * 4.0 ton & 2.0 ton', 1.0]],
      [['M#DHMO90R4000/U DEHUM & M#FIN180P(PO)', 1.0]],
      [['HEATER # S8X1B040M2PSC   COIL # 5TXCB003AS3   UNIT # 5TTR5024A1', 1.0]],
      [['HEATER# S8X1C080M5PSC   COIL# 5TXCD010AS3   UNIT#5TTR5036A1 «', 1.0]],
      '',
      [['ROUGH P SAMPLE 2/3/26', 1.0]],
      [['SET R SAMPLE 6/7/26', 1.0]],
      '',
      [['HVAC', 5.6], ['SERVICE', 6.6]],
      { line: [['1:30 PM', 0], ['OAKSHIRE', 1.0], ['RESIDENTIAL', 5.4], ['AC STARTUP', 6.5]], bold: true },
      [['# 7100003', 0], ['303 MOCK MEADOW CT', 1.0], ['MONARCH...', 4.0], ['WARRANTY', 5.8]],
      [['MOCKTOWN TX 77001', 1.0], ['OAKSHIRE SAM PLACEHOLDER 555 010 0003', 2.8]],
      [['Map Info', 0], ['Called In By: OFFICE DESK', 1.0]],
      [['No Map', 0], ['PROBLEM: AC Startup', 1.0]],
      ...footer(1, 2),
    ],
  },
  {
    lines: [
      ...pageTop(),
      [['IMPORTANT NOTES: BLOCK CONTINUES FROM PAGE 1 +', 1.0]],
      [['FURN # GR9S960804CN//COIL # CHPTA4830C*3//UNIT #GLXS5BA4210', 1.0]],
      '',
      [['TRIM M SAMPLE 5/6/26', 1.0]],
      '',
      [['HVAC', 5.6], ['SERVICE', 6.6]],
      // Time + builder line not in the sheet: the job number anchors the call.
      [['# 7100004', 0], ['404 FICTION WAY', 1.0], ['ELM GROVE', 4.0], ['ALL PAYMENT TYPES', 5.6]],
      [['SAMPLEVILLE TX 77002', 1.0], ['STONEBRIDGE CASEY MOCK 555 010 0004', 2.8]],
      [['Map Info', 0], ['Called In By: OFFICE DESK', 1.0]],
      [['No Map', 0], ['PROBLEM: AC & Heating Startup', 1.0]],
      [['IMPORTANT NOTES: NONE', 1.0]],
      [['FURN # DR96TC0804CN EVAP # CHPEA4830C3 UNIT# DC6VSS4210', 1.0]],
      '',
      [['ROUGH J SAMPLE 1/2/26', 1.0]],
      ...footer(2, 2),
    ],
  },
];

module.exports = { route };
