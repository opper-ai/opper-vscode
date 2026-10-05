import type { OpperCompatModel } from './api';

/** The gateway has already intersected caller-allowed pool members. Never infer levels. */
export function supportedEfforts(entry: OpperCompatModel): string[] {
	if (entry.opper?.kind === 'dynamic_route') return [];
	const supported = entry.opper?.reasoning?.supported;
	return Array.isArray(supported)
		? [...new Set(supported.filter((value): value is string => typeof value === 'string' && value.length > 0))]
		: [];
}

/** Explicit request options take precedence over the user's saved per-model preference. */
export function reasoningOptions(
	entry: OpperCompatModel,
	options: Readonly<Record<string, unknown>> = {},
	saved?: string,
): Record<string, unknown> {
	const body = { ...options };
	const camel = body.reasoningEffort;
	const wire = body.reasoning_effort;
	for (const value of [camel, wire]) {
		if (value !== undefined && typeof value !== 'string') throw new Error('Reasoning effort must be a supported string value.');
	}
	if (camel !== undefined && wire !== undefined && camel !== wire) {
		throw new Error('Conflicting reasoning effort options. Use one effort value.');
	}
	const selected = camel ?? wire ?? saved;
	delete body.reasoningEffort;
	delete body.reasoning_effort;
	if (selected === undefined) return body; // Let the gateway choose its default.
	if (typeof selected !== 'string' || !supportedEfforts(entry).includes(selected)) {
		throw new Error(`The selected reasoning effort is unavailable for ${entry.id}. Run "Opper: Set Thinking Effort" to choose an allowed level or reset to the server default.`);
	}
	body.reasoning_effort = selected;
	return body;
}
