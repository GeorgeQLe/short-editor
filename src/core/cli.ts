import { createApi, DEFAULT_API_HOST } from "./api.js";
import { createCore } from "./bootstrap.js";
import { ProcessOpenAiProvider } from "./openai-provider.js";

const host = DEFAULT_API_HOST;
const port = Number(process.env.SHORT_EDITOR_PORT ?? 43120);
const service = createCore(undefined, process.send ? new ProcessOpenAiProvider() : undefined);
const server = createApi(service, process.env.SHORT_EDITOR_DESKTOP_TOKEN).listen(port, host, () => {
  console.log(`Short Editor core listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => {
  void (async () => {
    await service.stop();
    process.exit(0);
  })();
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
