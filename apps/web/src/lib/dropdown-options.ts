export function sortDropdownOptions<T extends { value: string; text: string }>(
  options: readonly T[],
  locale: string,
  mode: "label" | "path",
): T[] {
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  return options
    .map((option) => ({
      option,
      parts: mode === "path" ? option.text.split(" / ") : [option.text],
    }))
    .sort((a, b) => {
      if (!a.option.value) return b.option.value ? -1 : 0;
      if (!b.option.value) return 1;
      for (let i = 0; i < Math.min(a.parts.length, b.parts.length); i++) {
        const result = collator.compare(a.parts[i]!, b.parts[i]!);
        if (result) return result;
      }
      return a.parts.length - b.parts.length;
    })
    .map(({ option }) => option);
}
