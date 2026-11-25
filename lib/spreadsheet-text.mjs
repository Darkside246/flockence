/** Keep user-entered text inert when a spreadsheet opens a CSV export. */
export function spreadsheetText(value) {
  const text = value ?? "";
  return /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)
    ? "'" + text
    : text;
}
