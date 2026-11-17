const fs = require('fs/promises');
const path = require('path');
const piexif = require('piexifjs');

it('reads GPS from a photo with the bundled EXIF library (no remote code)', async () => {
  const source = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/vendor/exifr-lite.mjs'), 'utf8');
  const exifr = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  // Smallest valid JPEG, then embed GPS 29.76, -95.37 the way a phone camera does.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64').toString('binary');
  const gps = {
    [piexif.GPSIFD.GPSLatitudeRef]: 'N', [piexif.GPSIFD.GPSLatitude]: piexif.GPSHelper.degToDmsRational(29.76),
    [piexif.GPSIFD.GPSLongitudeRef]: 'W', [piexif.GPSIFD.GPSLongitude]: piexif.GPSHelper.degToDmsRational(95.37),
  };
  const withGps = Buffer.from(piexif.insert(piexif.dump({ GPS: gps }), jpeg), 'binary');

  const result = await exifr.gps(new Uint8Array(withGps));
  expect(result.latitude).toBeCloseTo(29.76, 3);
  expect(result.longitude).toBeCloseTo(-95.37, 3);
});
