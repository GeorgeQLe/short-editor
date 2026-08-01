import Database from "better-sqlite3";

const database = new Database(":memory:");
database.exec("CREATE TABLE smoke (value TEXT NOT NULL)");
database.prepare("INSERT INTO smoke (value) VALUES (?)").run("windows-runtime-ready");
const row = database.prepare("SELECT value FROM smoke").get() as { value: string };
database.close();
if (row.value !== "windows-runtime-ready") throw new Error("SQLite transaction failed");
process.stdout.write("Packaged better-sqlite3 transaction passed.\n");
