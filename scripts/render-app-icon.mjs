import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const root = new URL("../", import.meta.url);
const source = new URL("resources/branding/siftcut-app-icon-master.svg", root);
const output = fileURLToPath(
  new URL("resources/branding/siftcut-app-icon-1024.png", root),
);

app.on("ready", async () => {
  try {
    const window = new BrowserWindow({
      width: 1024,
      height: 1024,
      useContentSize: true,
      frame: false,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        backgroundThrottling: false,
      },
    });

    await window.loadFile(fileURLToPath(source));
    const image = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
    });
    const master = image.resize({
      width: 1024,
      height: 1024,
      quality: "best",
    });
    await writeFile(output, master.toPNG());
    window.destroy();
    console.log(`Rendered ${output}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
