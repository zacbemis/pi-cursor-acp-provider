export type CursorAcpErrorCode =
	| "spawn"
	| "auth"
	| "protocol"
	| "timeout"
	| "aborted"
	| "process_exit"
	| "invalid_input";

export class CursorAcpError extends Error {
	constructor(readonly code: CursorAcpErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CursorAcpError";
	}
}

export function abortError(): CursorAcpError {
	return new CursorAcpError("aborted", "Cursor ACP request was cancelled");
}

export function errorMessage(error: unknown): string {
	return redact(error instanceof Error ? error.message : String(error));
}

export function redact(value: string): string {
	return value
		.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/giu, "$1[redacted]")
		.replace(/((?:api[_-]?key|auth[_-]?token|token)\s*[:=]\s*)[^\s,"']+/giu, "$1[redacted]")
		.replace(/(CURSOR_(?:API_KEY|AUTH_TOKEN)=)[^\s]+/gu, "$1[redacted]")
		.slice(-16_384);
}
