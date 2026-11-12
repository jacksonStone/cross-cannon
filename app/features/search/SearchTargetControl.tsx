import type { SearchTargetCorpus } from "./types";
export const SEARCH_TARGET_LABELS = {
  scripture: "Bible",
  "early-christian": "Fathers",
  "christian-classics": "Classics",
} as const;
export function SearchTargetControl({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: SearchTargetCorpus;
  onChange: (value: SearchTargetCorpus) => void;
}) {
  return (
    <fieldset className="search-target-control" disabled={disabled}>
      <legend>Search</legend>
      <div
        className="search-target-dial"
        role="radiogroup"
        aria-label="Search target"
      >
        {(
          Object.entries(SEARCH_TARGET_LABELS) as [SearchTargetCorpus, string][]
        ).map(([target, label]) => (
          <label
            key={target}
            className={value === target ? "is-active" : undefined}
          >
            <input
              type="radio"
              name="targetCorpus"
              value={target}
              checked={value === target}
              disabled={disabled}
              onChange={() => onChange(target)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
