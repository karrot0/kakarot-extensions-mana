import {
  UIListSection,
  UIMultiPicker,
  UIPicker,
  UIStepper,
  UITextField,
  UIToggle,
  type Form,
  type FormSection,
  type Option,
  type UIListElement,
} from "@mana-app/types";

export type PreferenceValue = string | string[] | boolean | number;

/**
 * ObjectStore's typed accessors throw when the stored value is not of the
 * requested type, and a throw here would take down the whole settings screen.
 * Every read is therefore attempted, never assumed.
 */
async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** Values written by an older version of a source may still be JSON-encoded strings. */
function decodeLegacy(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;
}

async function readValue(key: string, fallback: PreferenceValue): Promise<PreferenceValue> {
  if (Array.isArray(fallback)) {
    const native = asStringArray(await attempt(() => ObjectStore.stringArray(key)));
    if (native) return native;
    return asStringArray(decodeLegacy(await attempt(() => ObjectStore.string(key)))) ?? fallback;
  }

  if (typeof fallback === "boolean") {
    const native = await attempt(() => ObjectStore.boolean(key));
    if (native !== null) return native;
    const legacy = decodeLegacy(await attempt(() => ObjectStore.string(key)));
    return typeof legacy === "boolean" ? legacy : fallback;
  }

  if (typeof fallback === "number") {
    const native = await attempt(() => ObjectStore.number(key));
    if (native !== null) return native;
    const legacy = decodeLegacy(await attempt(() => ObjectStore.string(key)));
    return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : fallback;
  }

  const native = await attempt(() => ObjectStore.string(key));
  if (native === null) return fallback;
  const legacy = decodeLegacy(native);
  return typeof legacy === "string" ? legacy : native;
}

export class PreferenceStore<T extends Record<string, PreferenceValue>> {
  private readonly namespace: string;
  private readonly defaults: T;

  constructor(namespace: string, defaults: T) {
    this.namespace = namespace;
    this.defaults = defaults;
  }

  keyFor(key: string): string {
    return `${this.namespace}.${key}`;
  }

  async get<K extends keyof T & string>(key: K): Promise<T[K]> {
    const fallback = this.defaults[key];
    if (fallback === undefined) return fallback;
    return (await readValue(this.keyFor(key), fallback)) as T[K];
  }

  async set<K extends keyof T & string>(key: K, value: T[K]): Promise<void> {
    await ObjectStore.set(this.keyFor(key), value);
  }

  async reset<K extends keyof T & string>(key: K): Promise<void> {
    await ObjectStore.remove(this.keyFor(key));
  }
}

export type PreferenceOptions = readonly Option[] | (() => Promise<readonly Option[]>);

export type PreferenceField =
  | {
      type: "text";
      key: string;
      title: string;
      placeholder?: string;
      secure?: boolean;
      keyboard?: "alphanumeric" | "numeric" | "email";
      multiline?: boolean;
    }
  | { type: "toggle"; key: string; title: string }
  | { type: "select"; key: string; title: string; options: PreferenceOptions }
  | {
      type: "multiselect";
      key: string;
      title: string;
      options: PreferenceOptions;
      minSelectionCount?: number;
      maxSelectionCount?: number;
    }
  | {
      type: "stepper";
      key: string;
      title: string;
      lowerBound?: number;
      upperBound?: number;
      step?: 10 | 1 | 0.1;
    };

export type PreferenceSection = {
  header?: string;
  footer?: string;
  fields: readonly PreferenceField[];
};

async function resolveOptions(options: PreferenceOptions): Promise<Option[]> {
  return typeof options === "function" ? [...(await options())] : [...options];
}

/**
 * Returns null when the field cannot be rendered meaningfully — a picker whose
 * options failed to load has nothing to pick, and shipping one with an empty
 * options array gives the app a control it cannot present.
 */
async function buildElement(
  field: PreferenceField,
  id: string,
  current: PreferenceValue | undefined,
  store: PreferenceStore<Record<string, PreferenceValue>>,
): Promise<UIListElement | null> {
  switch (field.type) {
    case "text":
      return UITextField({
        id,
        title: field.title,
        value: typeof current === "string" ? current : "",
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.secure === undefined ? {} : { secure: field.secure }),
        ...(field.keyboard === undefined ? {} : { keyboard: field.keyboard }),
        ...(field.multiline === undefined ? {} : { multiline: field.multiline }),
        didChange: async (value: string) => {
          await store.set(field.key, value);
        },
      });

    case "toggle":
      return UIToggle({
        id,
        title: field.title,
        value: current === true,
        didChange: async (value: boolean) => {
          await store.set(field.key, value);
        },
      });

    case "select": {
      const options = await resolveOptions(field.options);
      if (options.length === 0) return null;
      const selected = typeof current === "string" ? current : "";
      // Only reconcile against the option list when there is one. A failed
      // fetch must not blank a saved choice, or the next edit writes the blank.
      const keep = options.some((option) => option.id === selected);
      return UIPicker({
        id,
        title: field.title,
        options,
        value: keep ? selected : "",
        didChange: async (value: string) => {
          await store.set(field.key, value);
        },
      });
    }

    case "multiselect": {
      const options = await resolveOptions(field.options);
      if (options.length === 0) return null;
      const known = new Set(options.map((option) => option.id));
      const stored = Array.isArray(current) ? current : [];
      const selected = stored.filter((entry) => known.has(entry));
      return UIMultiPicker({
        id,
        title: field.title,
        options,
        value: selected,
        ...(field.minSelectionCount === undefined
          ? {}
          : { minSelectionCount: field.minSelectionCount }),
        ...(field.maxSelectionCount === undefined
          ? {}
          : { maxSelectionCount: field.maxSelectionCount }),
        didChange: async (value: string[]) => {
          await store.set(field.key, value);
        },
      });
    }

    case "stepper":
      return UIStepper({
        id,
        title: field.title,
        value: typeof current === "number" ? current : (field.lowerBound ?? 0),
        ...(field.lowerBound === undefined ? {} : { lowerBound: field.lowerBound }),
        ...(field.upperBound === undefined ? {} : { upperBound: field.upperBound }),
        ...(field.step === undefined ? {} : { step: field.step }),
        didChange: async (value: number) => {
          await store.set(field.key, value);
        },
      });
  }
}

export async function buildPreferenceMenu(
  store: PreferenceStore<Record<string, PreferenceValue>>,
  specs: readonly PreferenceSection[],
): Promise<Form> {
  const sections: FormSection[] = [];
  const orphanedNotes: string[] = [];

  for (const spec of specs) {
    const children: UIListElement[] = [];
    const unavailable: string[] = [];

    for (const field of spec.fields) {
      const element = await buildElement(
        field,
        store.keyFor(field.key),
        await store.get(field.key),
        store,
      );
      if (element) children.push(element);
      else unavailable.push(field.title);
    }

    const note =
      unavailable.length > 0
        ? `${unavailable.join(", ")} could not be loaded — check the server is reachable, then reopen this screen. Your saved selection is unchanged.`
        : "";

    // A section with no renderable children is dropped, but its note must not
    // vanish with it or the setting just silently disappears.
    if (children.length === 0) {
      if (note) orphanedNotes.push(note);
      continue;
    }

    const footer = [spec.footer, note].filter(Boolean).join(" ");

    sections.push(
      UIListSection({
        ...(spec.header === undefined ? {} : { header: spec.header }),
        ...(footer === "" ? {} : { footer }),
        children,
      }),
    );
  }

  const first = sections[0];
  if (first && orphanedNotes.length > 0) {
    first.footer = [first.footer, ...orphanedNotes].filter(Boolean).join(" ");
  }

  return { sections };
}
