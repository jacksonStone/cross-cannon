import type { SearchTargetCorpus } from "./types";

type SearchTargetControlProps = {
  disabled: boolean;
  value: SearchTargetCorpus;
  onChange: (value: SearchTargetCorpus) => void;
};

export function SearchTargetControl({
  disabled,
  value,
  onChange
}: SearchTargetControlProps) {
  return (
    <fieldset className="search-target-control" disabled={disabled}>
      <legend>Search</legend>
      <div className="search-target-dial" role="radiogroup" aria-label="Search target">
        <label className={value === "scripture" ? "is-active" : undefined}>
          <input
            checked={value === "scripture"}
            disabled={disabled}
            name="targetCorpus"
            onChange={() => onChange("scripture")}
            type="radio"
            value="scripture"
          />
          <span>Bible</span>
        </label>
        <label className={value === "early-christian" ? "is-active" : undefined}>
          <input
            checked={value === "early-christian"}
            disabled={disabled}
            name="targetCorpus"
            onChange={() => onChange("early-christian")}
            type="radio"
            value="early-christian"
          />
          <span>Fathers</span>
        </label>
      </div>
    </fieldset>
  );
}
