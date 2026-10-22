export function coverageBadge(percentage: unknown): string {
  if (
    typeof percentage !== "number" ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw new Error("Missing or invalid unit line coverage percentage");
  }

  const value = `${percentage.toFixed(2)}%`;
  const color =
    percentage >= 80 ? "#15803d" : percentage >= 50 ? "#a16207" : "#b91c1c";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20" viewBox="0 0 150 20" role="img" aria-label="Unit line coverage: ${value}">
  <title>Unit line coverage: ${value}</title>
  <clipPath id="badge"><rect width="150" height="20" rx="3"/></clipPath>
  <g clip-path="url(#badge)">
    <path fill="#555" d="M0 0h92v20H0z"/>
    <path fill="${color}" d="M92 0h58v20H92z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="46" y="14">unit coverage</text>
    <text x="121" y="14">${value}</text>
  </g>
</svg>
`;
}
