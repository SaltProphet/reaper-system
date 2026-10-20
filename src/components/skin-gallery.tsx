import { useState } from "react";
import { SKINS, type CanvasStyle, type Contrast, type Density, type Look, type SkinId } from "@/lib/skins";

export function SkinGallery({
  look,
  onChange,
  onClose,
}: {
  look: Look;
  onChange: (look: Look) => void;
  onClose: () => void;
}) {
  const [ask, setAsk] = useState(false);

  function choose(id: SkinId) {
    if (id === "eyes" && look.skin !== "eyes") {
      setAsk(true);
      return;
    }
    onChange({ ...look, skin: id });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-xs text-ember">REAPER // SKINS</h2>
        <button type="button" onClick={onClose} className="min-h-11 px-3 font-mono text-xs text-mute">
          close
        </button>
      </header>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SKINS.map((skin) => (
          <li key={skin.id}>
            <button
              type="button"
              onClick={() => choose(skin.id)}
              className={`w-full border p-2 text-left ${look.skin === skin.id ? "border-ember" : "border-line"}`}
              style={{ background: skin.swatch.bg, color: skin.swatch.ink }}
            >
              <span className="flex gap-1">
                <span className="h-3 flex-1" style={{ background: skin.swatch.panel }} />
                <span className="h-3 w-6" style={{ background: skin.swatch.node }} />
              </span>
              <span className="mt-2 block font-mono text-xs">
                {skin.index} / {skin.name}
              </span>
              <span className="mt-1 block font-mono text-[11px] opacity-80">{skin.line}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Choice
          label="Density"
          value={look.density}
          options={[
            ["comfortable", "Comfortable"],
            ["compact", "Compact"],
          ]}
          onPick={(density) => onChange({ ...look, density: density as Density })}
        />
        <Choice
          label="Contrast"
          value={look.contrast}
          options={[
            ["standard", "Standard"],
            ["high", "High"],
          ]}
          onPick={(contrast) => onChange({ ...look, contrast: contrast as Contrast })}
        />
        <Choice
          label="Canvas"
          value={look.canvas}
          options={[
            ["clean", "Clean"],
            ["dotted", "Dotted"],
            ["grid", "Grid"],
          ]}
          onPick={(canvas) => onChange({ ...look, canvas: canvas as CanvasStyle })}
        />
      </div>
      {ask ? (
        <div className="mt-3 border border-ember bg-ink p-3">
          <p className="font-mono text-sm text-paper">Are you absolutely sure? We're legally obligated to ask.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="min-h-11 border border-ember px-3 font-mono text-xs text-ember"
              onClick={() => {
                onChange({ ...look, skin: "eyes" });
                setAsk(false);
              }}
            >
              Yes
            </button>
            <button
              type="button"
              className="min-h-11 border border-line px-3 font-mono text-xs text-mute"
              onClick={() => setAsk(false)}
            >
              No
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Choice({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onPick: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="font-mono text-xs text-mute">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className={`min-h-11 border px-2 font-mono text-xs ${value === id ? "border-ember text-ember" : "border-line text-mute"}`}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
