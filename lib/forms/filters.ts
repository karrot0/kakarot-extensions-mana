import type { ExcludableMultiSelectProp, FilterPrimitives, SearchRequest } from "@mana-app/types";

function optionId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object" && value !== null && "id" in value) {
    return String((value as { id: unknown }).id).trim();
  }
  return "";
}

export class FilterReader {
  private readonly values: Record<string, FilterPrimitives>;

  constructor(request: SearchRequest | { filters?: Record<string, FilterPrimitives> }) {
    this.values = (request.filters ?? {}) as Record<string, FilterPrimitives>;
  }

  has(id: string): boolean {
    const value = this.values[id];
    return value !== undefined && value !== null && value !== "";
  }

  text(id: string): string {
    return optionId(this.values[id]);
  }

  option(id: string, fallback = ""): string {
    return this.text(id) || fallback;
  }

  options(id: string): string[] {
    const value = this.values[id];
    if (Array.isArray(value)) return value.map(optionId).filter(Boolean);
    const single = optionId(value);
    return single ? [single] : [];
  }

  excludable(id: string): { included: string[]; excluded: string[] } {
    const value = this.values[id];
    if (typeof value === "object" && value !== null && "included" in value) {
      const prop = value as ExcludableMultiSelectProp;
      return {
        included: (prop.included ?? []).map(optionId).filter(Boolean),
        excluded: (prop.excluded ?? []).map(optionId).filter(Boolean),
      };
    }
    return { included: this.options(id), excluded: [] };
  }

  toggle(id: string): boolean {
    const value = this.values[id];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true" || value === "1";
    return false;
  }

  number(id: string, fallback = Number.NaN): number {
    const value = this.values[id];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number.parseFloat(this.text(id));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
