export type ReaderBookHeaderDetail = {
  label: string;
  value: string;
};

type ReaderBookHeaderProps = {
  description?: string | null;
  details?: ReaderBookHeaderDetail[];
  subtitle?: string | null;
  title: string;
};

export function ReaderBookHeader({
  description,
  details = [],
  subtitle,
  title
}: ReaderBookHeaderProps) {
  const visibleDetails = details.filter((detail) => detail.value.trim().length > 0);

  return (
    <div className="reader-book-header">
      <div className="reader-book-header-main">
        <p className="reader-book-header-eyebrow">Book</p>
        <h2>{title}</h2>
        {subtitle ? <p className="reader-book-header-subtitle">{subtitle}</p> : null}
        {description ? (
          <p className="reader-book-header-description">{description}</p>
        ) : null}
      </div>
      {visibleDetails.length > 0 ? (
        <dl className="reader-book-header-details">
          {visibleDetails.map((detail) => (
            <div key={`${detail.label}:${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
