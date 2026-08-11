const STANDARD_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh"]);
const GPT_56_EFFORTS = Object.freeze([...STANDARD_EFFORTS, "max"]);

const catalog = [
  { id: "gpt-5.6-sol", label: "5.6 Sol", default: true, efforts: GPT_56_EFFORTS },
  { id: "gpt-5.6-terra", label: "5.6 Terra", efforts: GPT_56_EFFORTS },
  { id: "gpt-5.6-luna", label: "5.6 Luna", efforts: GPT_56_EFFORTS },
  { id: "gpt-5.5", label: "5.5", efforts: STANDARD_EFFORTS },
  { id: "gpt-5.4", label: "5.4", efforts: STANDARD_EFFORTS },
  { id: "gpt-5.4-mini", label: "5.4 Mini", efforts: STANDARD_EFFORTS },
  { id: "gpt-5.3-codex-spark", label: "5.3 Codex Spark", efforts: STANDARD_EFFORTS },
];

export const MODELS = Object.freeze(catalog.map((model) => Object.freeze({ ...model })));

export function resolveModel(value) {
  if (value === undefined || value === null || value === "") return MODELS[0];
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)) {
    throw new RangeError("Invalid model");
  }
  const normalized = value.trim().toLowerCase();
  const known = MODELS.find((model) => model.id.toLowerCase() === normalized || model.label.toLowerCase() === normalized);
  return known ?? { id: value.trim(), label: value.trim(), efforts: STANDARD_EFFORTS, custom: true };
}

export function listModels() {
  return MODELS.map((model) => ({ ...model, efforts: [...model.efforts] }));
}

export function supportsModelEffort(model, effort) {
  return Boolean(model?.efforts?.includes(effort));
}
