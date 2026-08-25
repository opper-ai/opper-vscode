const test = require('node:test');
const assert = require('node:assert');

const { SSEDecoder, DONE, parseChunk } = require('../out/sse.js');

/** Feeds a whole string through the decoder as one chunk. */
function decode(text) {
	const d = new SSEDecoder();
	const out = d.push(Buffer.from(text, 'utf8'));
	return out.concat(d.flush());
}

test('reads frames with a space after the colon', () => {
	assert.deepStrictEqual(decode('data: {"a":1}\n\n'), ['{"a":1}']);
});

test('reads frames with NO space after the colon', () => {
	// The regression that produced empty-but-200 streams: slicing a fixed
	// "data: ".length here eats the opening brace and the frame is discarded.
	assert.deepStrictEqual(decode('data:{"a":1}\n\n'), ['{"a":1}']);
});

test('ends the stream on [DONE], with or without a space', () => {
	assert.deepStrictEqual(decode('data: [DONE]\n\n'), [DONE]);
	assert.deepStrictEqual(decode('data:[DONE]\n\n'), [DONE]);
});

test('reassembles a frame split across chunk boundaries', () => {
	const d = new SSEDecoder();
	assert.deepStrictEqual(d.push(Buffer.from('data: {"he')), []);
	assert.deepStrictEqual(d.push(Buffer.from('llo":"wor')), []);
	assert.deepStrictEqual(d.push(Buffer.from('ld"}\n')), ['{"hello":"world"}']);
});

test('survives a chunk boundary between the CR and the LF', () => {
	const d = new SSEDecoder();
	assert.deepStrictEqual(d.push(Buffer.from('data: {"a":1}\r')), []);
	assert.deepStrictEqual(d.push(Buffer.from('\n')), ['{"a":1}']);
});

test('survives a chunk boundary inside a multi-byte character', () => {
	const bytes = Buffer.from('data: {"t":"café"}\n', 'utf8');
	const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
	const d = new SSEDecoder();
	const first = d.push(bytes.subarray(0, cut));
	const second = d.push(bytes.subarray(cut));
	assert.deepStrictEqual(first.concat(second), ['{"t":"café"}']);
});

test('ignores comments, blank lines and non-data fields', () => {
	const text = ': ping\n\nevent: message\nid: 7\ndata: {"a":1}\n\n';
	assert.deepStrictEqual(decode(text), ['{"a":1}']);
});

test('yields a trailing frame that never got its newline', () => {
	const d = new SSEDecoder();
	assert.deepStrictEqual(d.push(Buffer.from('data: {"a":1}')), []);
	assert.deepStrictEqual(d.flush(), ['{"a":1}']);
});

test('handles CRLF line endings', () => {
	assert.deepStrictEqual(decode('data: {"a":1}\r\ndata: {"b":2}\r\n'), ['{"a":1}', '{"b":2}']);
});

test('parseChunk returns undefined on garbage rather than throwing', () => {
	assert.strictEqual(parseChunk('not json'), undefined);
	assert.deepStrictEqual(parseChunk('{"a":1}'), { a: 1 });
});
