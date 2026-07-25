(() => {
	if (globalThis.ImageZipStore) return;

	const encoder = new TextEncoder();
	const CRC_TABLE = buildCrcTable();

	function buildStoredZip(entries) {
		if (!Array.isArray(entries))
			throw new TypeError("entries must be an array");
		if (entries.length > 0xffff) {
			throw new RangeError(
				"This simple ZIP writer supports at most 65,535 files.",
			);
		}

		const localPieces = [];
		const centralPieces = [];
		let localOffset = 0;

		for (const entry of entries) {
			const nameBytes = encoder.encode(entry.name);
			const bytes = toUint8Array(entry.bytes);
			const size = bytes.byteLength;
			if (size > 0xffffffff || localOffset > 0xffffffff) {
				throw new RangeError("ZIP64 is not implemented in this skeleton.");
			}

			const { dosTime, dosDate } = toDosDateTime(entry.mtime || new Date());
			const checksum = crc32(bytes);

			const localHeader = new Uint8Array(30 + nameBytes.length);
			const localView = new DataView(localHeader.buffer);
			u32(localView, 0, 0x04034b50);
			u16(localView, 4, 20);
			u16(localView, 6, 0x0800); // UTF-8 filename
			u16(localView, 8, 0); // store, no compression
			u16(localView, 10, dosTime);
			u16(localView, 12, dosDate);
			u32(localView, 14, checksum);
			u32(localView, 18, size);
			u32(localView, 22, size);
			u16(localView, 26, nameBytes.length);
			u16(localView, 28, 0);
			localHeader.set(nameBytes, 30);
			localPieces.push(localHeader, bytes);

			const centralHeader = new Uint8Array(46 + nameBytes.length);
			const centralView = new DataView(centralHeader.buffer);
			u32(centralView, 0, 0x02014b50);
			u16(centralView, 4, 0x0314);
			u16(centralView, 6, 20);
			u16(centralView, 8, 0x0800);
			u16(centralView, 10, 0);
			u16(centralView, 12, dosTime);
			u16(centralView, 14, dosDate);
			u32(centralView, 16, checksum);
			u32(centralView, 20, size);
			u32(centralView, 24, size);
			u16(centralView, 28, nameBytes.length);
			u16(centralView, 30, 0);
			u16(centralView, 32, 0);
			u16(centralView, 34, 0);
			u16(centralView, 36, 0);
			u32(centralView, 38, 0);
			u32(centralView, 42, localOffset);
			centralHeader.set(nameBytes, 46);
			centralPieces.push(centralHeader);

			localOffset += localHeader.byteLength + size;
		}

		const centralOffset = localOffset;
		const centralSize = centralPieces.reduce(
			(n, piece) => n + piece.byteLength,
			0,
		);
		if (centralOffset > 0xffffffff || centralSize > 0xffffffff) {
			throw new RangeError("ZIP64 is not implemented in this skeleton.");
		}

		const end = new Uint8Array(22);
		const endView = new DataView(end.buffer);
		u32(endView, 0, 0x06054b50);
		u16(endView, 4, 0);
		u16(endView, 6, 0);
		u16(endView, 8, entries.length);
		u16(endView, 10, entries.length);
		u32(endView, 12, centralSize);
		u32(endView, 16, centralOffset);
		u16(endView, 20, 0);

		return new Blob([...localPieces, ...centralPieces, end], {
			type: "application/zip",
		});
	}

	function toUint8Array(value) {
		if (value instanceof Uint8Array) return value;
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) {
			return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		}
		throw new TypeError(
			"ZIP entry bytes must be an ArrayBuffer or typed array.",
		);
	}

	function crc32(bytes) {
		let crc = 0xffffffff;
		for (let i = 0; i < bytes.length; i += 1) {
			crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	function buildCrcTable() {
		const table = new Uint32Array(256);
		for (let i = 0; i < 256; i += 1) {
			let value = i;
			for (let bit = 0; bit < 8; bit += 1) {
				value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
			}
			table[i] = value >>> 0;
		}
		return table;
	}

	function toDosDateTime(value) {
		const date = new Date(value);
		const year = Math.min(2107, Math.max(1980, date.getFullYear()));
		return {
			dosTime:
				(date.getHours() << 11) |
				(date.getMinutes() << 5) |
				Math.floor(date.getSeconds() / 2),
			dosDate:
				((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		};
	}

	function u16(view, offset, value) {
		view.setUint16(offset, value, true);
	}

	function u32(view, offset, value) {
		view.setUint32(offset, value >>> 0, true);
	}

	globalThis.ImageZipStore = Object.freeze({ buildStoredZip });
})();
