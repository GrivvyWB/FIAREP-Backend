export function developmentNamesFromCsv(content: string) {
  const rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    values.push(value.trim());
    return values;
  });
  const header = rows[0]?.map((value) => value.toLowerCase()) || [];
  const headerIndex = header.findIndex((value) =>
    value === "name" || value.includes("development"));
  const nameIndex = headerIndex >= 0 ? headerIndex : 0;
  const names = rows
    .slice(headerIndex >= 0 ? 1 : 0)
    .map((row) => row[nameIndex]?.trim() || "")
    .filter(Boolean);
  return [...new Set(names)];
}