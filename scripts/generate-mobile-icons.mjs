import { readFile, mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const source = PNG.sync.read(await readFile("assets/myai-orbital-logo.png"));
const outputDirectory = "public/icons";
await mkdir(outputDirectory, { recursive: true });

function renderIcon(size, scale = 1) {
  const image = new PNG({ width: size, height: size });
  const contentSize = Math.round(size * scale);
  const left = Math.floor((size - contentSize) / 2);
  const top = Math.floor((size - contentSize) / 2);
  for (let y = 0; y < contentSize; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / contentSize));
    for (let x = 0; x < contentSize; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / contentSize));
      const from = (sourceY * source.width + sourceX) * 4;
      const to = ((top + y) * size + left + x) * 4;
      image.data[to] = source.data[from];
      image.data[to + 1] = source.data[from + 1];
      image.data[to + 2] = source.data[from + 2];
      image.data[to + 3] = source.data[from + 3];
    }
  }
  return PNG.sync.write(image);
}

await writeFile(`${outputDirectory}/myai-192.png`, renderIcon(192));
await writeFile(`${outputDirectory}/myai-512.png`, renderIcon(512));
await writeFile(`${outputDirectory}/myai-512-maskable.png`, renderIcon(512, 0.72));
