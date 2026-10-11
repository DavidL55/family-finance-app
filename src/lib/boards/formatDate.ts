/** 'YYYY-MM-DD' → 'DD.MM.YYYY', the way dates are shown to the family. Pure string work, no Date timezone games. */
export function formatIsoDateHe(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
