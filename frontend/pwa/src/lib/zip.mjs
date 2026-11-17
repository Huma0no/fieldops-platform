// Minimal ZIP writer (stored, no compression: photos are already JPEG) for the
// Report download. files: [{ name, data: Blob | Uint8Array | string }].

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32 (bytes) {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

async function toBytes (data) {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(await data.arrayBuffer())
}

function dosDateTime (date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export async function zipFiles (files, now = new Date()) {
  const { time, day } = dosDateTime(now)
  const parts = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const data = await toBytes(file.data)
    const crc = crc32(data)
    // Fields shared by the local and central headers: version, UTF-8 flag,
    // stored, time, date, crc, sizes, name length.
    const common = new DataView(new ArrayBuffer(26))
    common.setUint16(0, 20, true)
    common.setUint16(2, 0x0800, true)
    common.setUint16(4, 0, true)
    common.setUint16(6, time, true)
    common.setUint16(8, day, true)
    common.setUint32(10, crc, true)
    common.setUint32(14, data.length, true)
    common.setUint32(18, data.length, true)
    common.setUint16(22, name.length, true)
    common.setUint16(24, 0, true)
    const fields = new Uint8Array(common.buffer)

    const local = new DataView(new ArrayBuffer(4))
    local.setUint32(0, 0x04034B50, true)
    parts.push(local, fields, name, data)

    const head = new DataView(new ArrayBuffer(6))
    head.setUint32(0, 0x02014B50, true)
    head.setUint16(4, 20, true)
    const tail = new DataView(new ArrayBuffer(14))
    tail.setUint32(10, offset, true)
    central.push(head, fields, tail, name)

    offset += 4 + fields.length + name.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054B50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}
