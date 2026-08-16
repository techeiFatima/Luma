type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;

function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>) {
  if (order[level] < threshold) return;
  const line = { level, scope, message, ...fields, at: new Date().toISOString() };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

/**
 * Scoped structured logger. The AI pipeline logs through this so each stage is
 * traceable without wiring in a full observability stack.
 */
export function logger(scope: string) {
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", scope, m, f),
    info: (m: string, f?: Record<string, unknown>) => emit("info", scope, m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", scope, m, f),
    error: (m: string, f?: Record<string, unknown>) => emit("error", scope, m, f),
  };
}

export type Logger = ReturnType<typeof logger>;
