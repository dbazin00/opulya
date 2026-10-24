import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { format } from "prettier";

const source = new URL("../apps/web/public/opulya-mark.png", import.meta.url);
const png = await readFile(source);
const { data, info } = await sharp(png)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
const labels = new Int16Array(width * height).fill(-1);
const neighbors = (pixel) => {
  const x = pixel % width;
  return [
    ...(x > 0 ? [pixel - 1] : []),
    ...(x < width - 1 ? [pixel + 1] : []),
    ...(pixel >= width ? [pixel - width] : []),
    ...(pixel < width * (height - 1) ? [pixel + width] : []),
  ];
};
const gold = (pixel, edge = false) => {
  const i = pixel * 4;
  return (
    data[i] > (edge ? 80 : 100) &&
    data[i] > data[i + 1] * (edge ? 1.04 : 1.05) &&
    data[i + 1] > data[i + 2] * (edge ? 1.3 : 1.4) &&
    data[i + 3] > (edge ? 0 : 150)
  );
};
const components = [];
for (let pixel = 0; pixel < labels.length; pixel++) {
  if (labels[pixel] !== -1 || !gold(pixel)) continue;
  const id = components.length;
  const pixels = [pixel];
  labels[pixel] = id;
  for (let cursor = 0; cursor < pixels.length; cursor++) {
    for (const next of neighbors(pixels[cursor])) {
      if (labels[next] === -1 && gold(next)) {
        labels[next] = id;
        pixels.push(next);
      }
    }
  }
  components.push({ id, pixels });
}
const shapes = components
  .filter(({ pixels }) => pixels.length > 1000)
  .sort((a, b) => b.pixels.length - a.pixels.length);
if (width !== 512 || height !== 512 || shapes.length !== 4)
  throw new Error(
    "Expected the original 512px logo with one ribbon and three bars",
  );

// Grow antialiased gold edges from all four shapes together; ribbon wins ties.
labels.fill(-1);
const queue = [];
for (const { id, pixels } of shapes) {
  for (const pixel of pixels) {
    labels[pixel] = id;
    queue.push(pixel);
  }
}
for (let cursor = 0; cursor < queue.length; cursor++) {
  const pixel = queue[cursor];
  for (const next of neighbors(pixel)) {
    if (labels[next] === -1 && gold(next, true)) {
      labels[next] = labels[pixel];
      queue.push(next);
    }
  }
}
const bars = shapes
  .slice(1)
  .map(({ id }) => {
    const rectangles = [];
    let active = new Map();
    for (let y = 0; y < height; y++) {
      const row = new Map();
      for (let x = 0; x < width; x++) {
        if (labels[y * width + x] !== id) continue;
        const start = x;
        while (x + 1 < width && labels[y * width + x + 1] === id) x++;
        const key = `${start}:${x}`;
        const rectangle = active.get(key) ?? {
          x: start,
          y,
          width: x - start + 1,
          height: 0,
        };
        rectangle.height++;
        row.set(key, rectangle);
        active.delete(key);
      }
      rectangles.push(...active.values());
      active = row;
    }
    rectangles.push(...active.values());
    const x = Math.min(...rectangles.map((r) => r.x));
    const y = Math.min(...rectangles.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rectangles.map((r) => r.x + r.width)) - x,
      height: Math.max(...rectangles.map((r) => r.y + r.height)) - y,
      path: rectangles
        .map((r) => `M${r.x} ${r.y}h${r.width}v${r.height}h-${r.width}z`)
        .join(""),
    };
  })
  .sort((a, b) => a.x - b.x);
if (bars.some((bar) => bar.width > 60 || bar.height > 180))
  throw new Error("A bar mask unexpectedly includes part of the ribbon");
for (const [size, name] of [
  [256, "opulya-spinner.webp"],
  [512, "opulya-spinner-large.webp"],
]) {
  const image = await sharp(png)
    .resize(size, size)
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  await writeFile(
    new URL(`../apps/web/public/${name}`, import.meta.url),
    image,
  );
  console.log(`${name}: ${image.length} bytes`);
}
const output = `// Generated from the original PNG pixels by scripts/generate-spinner-masks.mjs.\nexport const spinnerSourceSha256 = ${JSON.stringify(createHash("sha256").update(png).digest("hex"))};\nexport const spinnerBars = ${JSON.stringify(bars, null, 2)} as const;\n`;
await writeFile(
  new URL(
    "../apps/web/src/components/opulya-spinner-masks.ts",
    import.meta.url,
  ),
  await format(output, { parser: "typescript" }),
);
