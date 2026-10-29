export function bytes(value: number) {
  return (
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1_048_576) +
    ' MiB'
  );
}
