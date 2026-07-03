export type SearchTargetCorpus = "scripture" | "early-christian";

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
      <div className="reader-segmented-control">
        <button
          className={value === "scripture" ? "is-active" : undefined}
          onClick={() => onChange("scripture")}
          type="button"
        >
          Bible
        </button>
        <button
          className={value === "early-christian" ? "is-active" : undefined}
          onClick={() => onChange("early-christian")}
          type="button"
        >
          Fathers
        </button>
      </div>
    </fieldset>
  );
}
