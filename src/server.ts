import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();
const host = "0.0.0.0";

app.listen(env.PORT, host, () => {
  console.log(`Server listening on http://${host}:${env.PORT}`);
  console.log(`Root domain: ${env.APP_ROOT_DOMAIN}`);
  console.log(`Public URL: ${env.APP_BASE_URL}`);
});
