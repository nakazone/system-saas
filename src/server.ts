import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
  console.log(`Root domain: ${env.APP_ROOT_DOMAIN}`);
  console.log(`Signup: http://${env.APP_ROOT_DOMAIN}:${env.PORT}/signup`);
});
