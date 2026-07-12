const utcDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

export function formatUtcDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return `${utcDateTimeFormatter.format(date)} UTC`;
}
