import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";

const root = new URL("../", import.meta.url);
const source = new URL("resources/branding/siftcut-app-icon-master.svg", root);
const masterOutput = new URL("resources/branding/siftcut-app-icon-1024.png", root);
const publicDirectory = new URL("apps/web/public/", root);

app.on("ready", async () => {
  try {
    const masterWindow = new BrowserWindow({
      width: 1024, height: 1024, useContentSize: true, frame: false, show: false,
      transparent: true, backgroundColor: "#00000000",
      webPreferences: { backgroundThrottling: false }
    });
    await masterWindow.loadFile(fileURLToPath(source));
    const captured = await masterWindow.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    const master = captured.resize({ width: 1024, height: 1024, quality: "best" });
    const masterPng = master.toPNG();
    await Promise.all([
      writeFile(fileURLToPath(masterOutput), masterPng),
      writeFile(fileURLToPath(new URL("siftcut-icon.png", publicDirectory)), masterPng),
      writeFile(fileURLToPath(new URL("app-web-icon-512.png", publicDirectory)),
        master.resize({ width: 512, height: 512, quality: "best" }).toPNG()),
      writeFile(fileURLToPath(new URL("favicon-32.png", publicDirectory)),
        master.resize({ width: 32, height: 32, quality: "best" }).toPNG())
    ]);

    const svg = await readFile(source, "utf8");
    const iconData = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const regularUrl = new URL("resources/fonts/Inter-Regular.otf", root).href;
    const boldUrl = new URL("resources/fonts/Inter-Bold.otf", root).href;
    const html = `<!doctype html><style>
      @font-face{font-family:Inter;src:url(${regularUrl})}
      @font-face{font-family:Inter;src:url(${boldUrl});font-weight:700}
      *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}
      body{font-family:Inter,sans-serif;color:#f7f7f4;background:#090a0f}
      main{position:relative;width:100%;height:100%;padding:72px 78px;display:grid;grid-template-columns:1fr 330px;align-items:center;gap:64px;background:radial-gradient(circle at 85% 16%,rgba(173,146,255,.22),transparent 36%),radial-gradient(circle at 55% 100%,rgba(166,242,200,.08),transparent 38%)}
      main:after{content:"";position:absolute;inset:28px;border:1px solid rgba(255,255,255,.1);border-radius:28px}
      .copy{position:relative;z-index:1}.brand{display:flex;align-items:center;gap:14px;font-size:28px;font-weight:700;letter-spacing:-1.5px}.brand img{width:48px;height:48px}
      h1{max-width:730px;margin:52px 0 28px;font-size:68px;line-height:.98;letter-spacing:-4.5px}
      p{margin:0;color:#a6f2c8;font-size:18px;letter-spacing:.4px}.icon{position:relative;z-index:1;width:330px;height:330px;filter:drop-shadow(0 28px 50px rgba(0,0,0,.45))}
    </style><main><div class="copy"><div class="brand"><img src="${iconData}">SiftCut</div><h1>Find the short hiding inside the long story.</h1><p>Long-form context. Short-form clarity.</p></div><img class="icon" src="${iconData}"></main>`;
    const socialWindow = new BrowserWindow({ width: 1200, height: 630, useContentSize: true,
      frame: false, show: false, backgroundColor: "#090a0f", webPreferences: { backgroundThrottling: false } });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "siftcut-brand-"));
    const temporaryHtml = join(temporaryDirectory, "social-card.html");
    await writeFile(temporaryHtml, html);
    await socialWindow.loadURL(pathToFileURL(temporaryHtml).href);
    await socialWindow.webContents.executeJavaScript("document.fonts.ready");
    const social = await socialWindow.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 });
    await rm(temporaryDirectory, { recursive: true, force: true });
    const socialPng = social.resize({ width: 1200, height: 630, quality: "best" }).toPNG();
    await Promise.all([
      writeFile(fileURLToPath(new URL("social-card-1200x630.png", publicDirectory)), socialPng),
      writeFile(fileURLToPath(new URL("og.png", publicDirectory)), socialPng)
    ]);
    socialWindow.destroy();
    masterWindow.destroy();
    console.log("Rendered SiftCut master and deterministic web derivatives");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
