import pg from "pg";

const password = process.env.STAGING_APP_DB_PASSWORD;
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!password || !connectionString) {
  console.error("Staging database credentials are missing.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const escapedPassword = password.replace(/'/g, "''");
  await client.query(`ALTER ROLE app_user WITH PASSWORD '${escapedPassword}'`);
} catch (error) {
  console.error("Could not secure the staging app_user role.", error instanceof Error ? error.message : "");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
