import type { LibMeta } from "@/lib/serum/library";

export function LibraryPanel({
  items,
  activeId,
  onFiles,
  onPick,
  onRemove,
}: {
  items: LibMeta[];
  activeId: string | null;
  onFiles: (files: FileList | null) => void;
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="rounded-md border border-line bg-surface p-3 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Knihovna</h2>
          <p className="mt-1 text-sm text-muted">
            Nahraj .SerumPreset nebo wav. Preset se rozebere a hod z něj udělá variaci. Sample jen vybere recept. Wavetable ze samplu se nedělá.
          </p>
        </div>
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center rounded-md bg-acid px-3 text-sm font-semibold text-ink">
          Nahrát
          <input
            type="file"
            accept=".SerumPreset,.serumpreset,audio/*,.wav,.mp3,.ogg,.flac,.aiff"
            multiple
            className="sr-only"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {items.map((item) => {
            const on = item.id === activeId;
            const title = item.kind === "preset" ? item.name : item.name;
            return (
              <li key={item.id} className="flex items-center gap-1 border-t border-line">
                <button
                  type="button"
                  onClick={() => onPick(item.id)}
                  className={
                    on
                      ? "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-acid"
                      : "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm"
                  }
                >
                  <span className="truncate">{title}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{item.kind === "preset" ? "preset" : "sample"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="min-h-11 px-2 text-sm text-muted"
                  aria-label={`Odebrat ${title}`}
                >
                  Odebrat
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
