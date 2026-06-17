/** Shared MCP tool result helpers — single source for the ok/error content shape. */
export function errorResult(message) {
    return { isError: true, content: [{ type: "text", text: message }] };
}
export function okResult(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
