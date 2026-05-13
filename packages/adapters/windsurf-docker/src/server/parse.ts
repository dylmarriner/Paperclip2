export interface ParsedWindsurfOutput {
  response: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  error?: string;
}

export function parseWindsurfOutput(rawOutput: string): ParsedWindsurfOutput {
  const lines = rawOutput.split("\n");
  let response = "";
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let error: string | undefined;

  for (const line of lines) {
    // Try to parse JSON lines (tool calls)
    if (line.trim().startsWith("{") || line.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.tool && parsed.arguments) {
          toolCalls.push({
            name: parsed.tool,
            arguments: parsed.arguments,
          });
        }
      } catch {
        // Not JSON, treat as regular output
        response += line + "\n";
      }
    } else if (line.toLowerCase().includes("error")) {
      error = line;
    } else {
      response += line + "\n";
    }
  }

  return {
    response: response.trim(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    error,
  };
}

export function isWindsurfTransientError(error: string): boolean {
  const transientPatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /rate limit/i,
    /temporarily/i,
  ];
  return transientPatterns.some((pattern) => pattern.test(error));
}
