/**
 * ZIP STORE writer for one named payload. Used for admin database backups.
 * @module @deepseek-ai/dsh-sync-server/zip
 */

const CRC_TABLE = makeCrcTable()

/**
 * Build a ZIP archive containing one stored (uncompressed) file.
 * @param name - archive entry path using `/` separators.
 * @param payload - file bytes.
 * @returns a complete ZIP buffer.
 */
export function zipStore(name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = Buffer.from(name, 'utf8')
  const crc = crc32(payload)
  const local = Buffer.alloc(30 + nameBytes.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt16LE(0, 10)
  local.writeUInt16LE(0, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28)
  nameBytes.copy(local, 30)

  const central = Buffer.alloc(46 + nameBytes.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42)
  nameBytes.copy(central, 46)

  const eocd = Buffer.alloc(22)
  const centralOffset = local.length + payload.length
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([local, payload, central, eocd])
}

function makeCrcTable(): Int32Array {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[index] = crc
  }
  return table
}

function crc32(payload: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of payload) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
