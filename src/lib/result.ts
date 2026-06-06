/** Shared MCP tool result helpers — single source for the ok/error content shape. */

export function errorResult(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

export function okResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
