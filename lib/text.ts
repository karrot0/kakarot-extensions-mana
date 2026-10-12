import { PublicationStatus } from "@mana-app/types";

export function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function absolute(raw: string, baseUrl: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function chapterNumber(title: string, fallback: number): number {
  const match = /#\s*(\d+(?:\.\d+)?)/.exec(title) ?? /(\d+(?:\.\d+)?)\s*$/.exec(title);
  const parsed = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseDate(raw: string): Date | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

export function parseStatus(raw: string): PublicationStatus | undefined {
  const value = raw.toLowerCase();
  if (value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("complet")) return PublicationStatus.COMPLETED;
  if (value.includes("hiatus")) return PublicationStatus.HIATUS;
  if (value.includes("cancel")) return PublicationStatus.CANCELLED;
  return undefined;
}
