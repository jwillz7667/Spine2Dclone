namespace Marionette.Runtime.Core.Determinism
{
    // CRC-32/ISO-HDLC (the variant used by zlib, gzip, and PNG), pinned bit exactly for the MRNT binary
    // container trailer (mirrors packages/format/src/binary/crc32.ts). Parameters: width 32, polynomial
    // 0x04C11DB7 (reflected 0xEDB88320), init 0xFFFFFFFF, RefIn true, RefOut true, XorOut 0xFFFFFFFF. The
    // check value over the ASCII string "123456789" is 0xCBF43926.
    public static class Crc32
    {
        private static readonly uint[] Table = BuildTable();

        private static uint[] BuildTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n += 1)
            {
                uint c = n;
                for (int k = 0; k < 8; k += 1)
                {
                    c = (c & 1) != 0 ? 0xedb88320u ^ (c >> 1) : c >> 1;
                }

                table[n] = c;
            }

            return table;
        }

        // CRC-32/ISO-HDLC of bytes[offset .. offset + count], returned as an unsigned 32 bit integer.
        public static uint Compute(byte[] bytes, int offset, int count)
        {
            uint crc = 0xffffffffu;
            int end = offset + count;
            for (int i = offset; i < end; i += 1)
            {
                crc = (crc >> 8) ^ Table[(crc ^ bytes[i]) & 0xff];
            }

            return crc ^ 0xffffffffu;
        }

        public static uint Compute(byte[] bytes) => Compute(bytes, 0, bytes.Length);
    }
}
