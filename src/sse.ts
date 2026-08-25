/**
 * Server-sent-event framing for the Opper chat-completions stream.
 *
 * Deliberately free of any `vscode` import so it can be unit-tested under plain
 * `node --test` — this is the layer where streaming bugs actually live.
 */

/** One decoded `data:` payload, or the sentinel that ends a stream. */
export const DONE = Symbol('sse-done');

/**
 * Splits a byte stream into SSE `data:` payloads.
 *
 * Two details that have bitten this wire format before:
 *
 *  - `data:{...}` with NO space after the colon is legal SSE and some
 *    providers emit it. Slicing a fixed `"data: ".length` silently drops those
 *    frames, and the symptom is a 200 with an empty completion rather than an
 *    error — so the prefix is matched, then the payload is trimmed.
 *  - A chunk boundary can fall anywhere, including mid-line and between the
 *    `\r` and `\n` of a CRLF. Only complete lines are consumed; the remainder
 *    stays buffered.
 */
export class SSEDecoder {
	private buffer = '';
	private readonly decoder = new TextDecoder('utf-8');

	/** Feeds raw bytes in, yielding every complete frame they completed. */
	push(chunk: Uint8Array): (string | typeof DONE)[] {
		this.buffer += this.decoder.decode(chunk, { stream: true });
		return this.drain();
	}

	/** Flushes whatever a final partial chunk left behind. */
	flush(): (string | typeof DONE)[] {
		this.buffer += this.decoder.decode();
		const out = this.drain();
		// A stream that ends without a trailing newline still has one good
		// frame left in the buffer.
		const rest = this.buffer.trim();
		this.buffer = '';
		const last = rest ? parseLine(rest) : undefined;
		if (last !== undefined) {
			out.push(last);
		}
		return out;
	}

	private drain(): (string | typeof DONE)[] {
		const out: (string | typeof DONE)[] = [];
		let nl: number;
		while ((nl = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			const frame = parseLine(line);
			if (frame !== undefined) {
				out.push(frame);
			}
		}
		return out;
	}
}

/**
 * Returns the payload of one SSE line, or undefined for lines that carry none
 * (comments, `event:`/`id:` fields, blank separators).
 */
function parseLine(raw: string): string | typeof DONE | undefined {
	// Strip the CR of a CRLF; a bare \r is not a line ending we split on.
	const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
	if (line === '' || line.startsWith(':')) {
		return undefined;
	}
	if (!line.startsWith('data:')) {
		return undefined;
	}
	// NOT slice(6) — `data:{...}` is legal and would lose its first byte.
	const payload = line.slice('data:'.length).trim();
	if (payload === '') {
		return undefined;
	}
	return payload === '[DONE]' ? DONE : payload;
}

/** Parses a data frame, returning undefined rather than throwing on garbage. */
export function parseChunk<T = unknown>(payload: string): T | undefined {
	try {
		return JSON.parse(payload) as T;
	} catch {
		return undefined;
	}
}
