/** Local estimates only; model-specific tokenizers and image accounting vary. */
export function estimateTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}
export function contextLimits(context: number | undefined, output: number | undefined): { input: number; output: number } | undefined {
	if (!Number.isSafeInteger(context) || context! <= 1) return undefined;
	const reserve = output === undefined ? Math.min(4096, Math.max(1, Math.floor(context! / 4))) : output;
	if (!Number.isSafeInteger(reserve) || reserve <= 0 || reserve >= context!) return undefined;
	return { input: context! - reserve, output: reserve };
}
export function promptEstimate(body: Record<string, unknown>): { tokens: number; hasMedia: boolean } {
	let hasMedia = false;
	const json = JSON.stringify({ messages: body.messages, tools: body.tools, tool_choice: body.tool_choice }, (key, value) => {
		if (key === 'image_url' || key === 'input_audio' || key === 'file') { hasMedia = true; return '[media omitted]'; }
		return value;
	});
	return { tokens: estimateTokens(json), hasMedia };
}
export function contextSummary(model: string, used: number, budget: number, actual: boolean, hasMedia: boolean): string {
	const kind = actual ? 'Server-reported input' : hasMedia ? 'Estimated text input (media excluded)' : 'Estimated input';
	return `${model}\n${kind}: ${used.toLocaleString()} / ${budget.toLocaleString()} input tokens.\n${hasMedia && !actual ? 'Remaining space is unknown until the server reports usage.' : `${actual ? '' : 'Approximately '}${Math.max(0, budget - used).toLocaleString()} input tokens remaining at the start of this request.`}\nThis is the last Opper request, not the currently selected chat. Output space is reserved separately; VS Code manages conversation compaction.`;
}
