/**
 * Translation between VS Code's chat message parts and the OpenAI chat shape
 * Opper's `/v3/compat/chat/completions` speaks.
 *
 * The awkward bit is tool results. VS Code models a turn as User and Assistant
 * messages only (there is no Tool role in `LanguageModelChatMessageRole`), so
 * a tool's output arrives as a `LanguageModelToolResultPart` *inside a User
 * message*. OpenAI requires those to be their own `role: "tool"` messages
 * placed immediately after the assistant message whose `tool_calls` they
 * answer. So a single VS Code user message can expand into several OpenAI
 * messages, tool results first.
 */

import * as vscode from 'vscode';

export interface OpenAIToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface OpenAIContentPart {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

export interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | OpenAIContentPart[] | null;
	name?: string;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

/** Converts a whole VS Code conversation into OpenAI messages. */
export function toOpenAIMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): OpenAIMessage[] {
	const out: OpenAIMessage[] = [];
	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			pushAssistant(out, message);
		} else {
			pushUser(out, message);
		}
	}
	return out;
}

function pushAssistant(
	out: OpenAIMessage[],
	message: vscode.LanguageModelChatRequestMessage,
): void {
	let text = '';
	const toolCalls: OpenAIToolCall[] = [];

	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			toolCalls.push({
				id: part.callId,
				type: 'function',
				function: {
					name: part.name,
					// The model produced an object; the wire wants the JSON text
					// it was streamed as.
					arguments: JSON.stringify(part.input ?? {}),
				},
			});
		}
		// An assistant message carrying a tool RESULT is malformed; ignore it
		// rather than inventing a role for it.
	}

	// OpenAI rejects an assistant message that is empty in both fields.
	if (!text && toolCalls.length === 0) {
		return;
	}
	const msg: OpenAIMessage = { role: 'assistant', content: text || null };
	if (toolCalls.length > 0) {
		msg.tool_calls = toolCalls;
	}
	if (message.name) {
		msg.name = message.name;
	}
	out.push(msg);
}

function pushUser(out: OpenAIMessage[], message: vscode.LanguageModelChatRequestMessage): void {
	const content: OpenAIContentPart[] = [];

	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelToolResultPart) {
			// Emitted immediately, ahead of any user text in this message: it
			// answers the assistant turn that came before, and OpenAI validates
			// that adjacency.
			out.push({
				role: 'tool',
				tool_call_id: part.callId,
				content: flattenToolResult(part.content),
			});
		} else if (part instanceof vscode.LanguageModelTextPart) {
			content.push({ type: 'text', text: part.value });
		} else if (part instanceof vscode.LanguageModelDataPart) {
			const url = dataUri(part);
			if (url) {
				content.push({ type: 'image_url', image_url: { url } });
			}
		}
	}

	if (content.length === 0) {
		return;
	}
	// Collapse a text-only message to a plain string. Every OpenAI-compatible
	// implementation accepts that; the parts array is only needed for images.
	const onlyText = content.every((c) => c.type === 'text');
	const msg: OpenAIMessage = {
		role: 'user',
		content: onlyText ? content.map((c) => c.text ?? '').join('') : content,
	};
	if (message.name) {
		msg.name = message.name;
	}
	out.push(msg);
}

/**
 * Reduces a tool result's parts to the string an OpenAI `tool` message carries.
 *
 * Non-text parts cannot be represented here. They are replaced with a visible
 * placeholder rather than dropped: a model that silently never sees the
 * screenshot a tool returned produces a confidently wrong answer, and nothing
 * in the transcript says why.
 */
function flattenToolResult(parts: readonly unknown[]): string {
	const chunks: string[] = [];
	for (const part of parts) {
		if (part instanceof vscode.LanguageModelTextPart) {
			chunks.push(part.value);
		} else if (part instanceof vscode.LanguageModelDataPart) {
			chunks.push(`[tool returned ${part.mimeType}, which a tool message cannot carry]`);
		} else if (part && typeof part === 'object' && 'value' in part) {
			// LanguageModelPromptTsxPart and anything else shaped like it.
			chunks.push(String((part as { value: unknown }).value));
		}
	}
	return chunks.join('\n');
}

/** Renders a data part as the `data:` URI an image_url expects. */
function dataUri(part: vscode.LanguageModelDataPart): string | undefined {
	if (!part.mimeType.startsWith('image/')) {
		return undefined;
	}
	return `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`;
}

/** Maps VS Code's tool declarations onto the OpenAI `tools` array. */
export function toOpenAITools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): { type: 'function'; function: { name: string; description: string; parameters: object } }[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			// A tool with no schema still takes no arguments — say so explicitly
			// rather than omitting the key, which some providers reject.
			parameters: tool.inputSchema ?? { type: 'object', properties: {} },
		},
	}));
}
