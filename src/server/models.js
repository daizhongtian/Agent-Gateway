const catalog = [
  { id: "gpt-5.6-sol", label: "5.6 Sol", default: true },
  { id: "gpt-5.6-terra", label: "5.6 Terra" },
  { id: "gpt-5.6-luna", label: "5.6 Luna" },
  { id: "gpt-5.5", label: "5.5" },
  { id: "gpt-5.4", label: "5.4" },
  { id: "gpt-5.4-mini", label: "5.4 Mini" },
  { id: "gpt-5.3-codex-spark", label: "5.3 Codex Spark" },
];

export const MODELS = Object.freeze(catalog.map((model) => Object.freeze({ ...model })));

export function resolveModel(value) {
  if (value === undefined || value === null || value === "") return MODELS[0];
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)) {
    throw new RangeError("Invalid model");
  }
  const normalized = value.trim().toLowerCase();
  const known = MODELS.find((model) => model.id.toLowerCase() === normalized || model.label.toLowerCase() === normalized);
  return known ?? { id: value.trim(), label: value.trim(), custom: true };
}

export function listModels() {
  return MODELS.map((model) => ({ ...model }));
}
