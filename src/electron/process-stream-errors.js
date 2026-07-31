const PROTECTED_STREAM = Symbol("agentGatewayProtectedProcessStream");

function protectStream(stream) {
  if (!stream || typeof stream.on !== "function" || stream[PROTECTED_STREAM]) return;

  Object.defineProperty(stream, PROTECTED_STREAM, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  // Electron can outlive the terminal or launcher that owns stdout/stderr.
  // Windows then reports EPIPE or ECONNRESET on the logging pipe. An `error`
  // event without a listener is treated as an uncaught exception and would
  // close the whole desktop application even though the Gateway is healthy.
  stream.on("error", () => {});
}
export function protectProcessLoggingStreams({ stdout = process.stdout, stderr = process.stderr } = {}) {
  protectStream(stdout);
  if (stderr !== stdout) protectStream(stderr);
}
