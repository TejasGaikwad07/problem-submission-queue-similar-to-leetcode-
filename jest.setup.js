// Point Prisma at the test database before any module creates a client.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST must be set to run tests (see .env.example)");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
