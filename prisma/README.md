# Database

Prisma schema for the central Restaurant POS domain.

## Environment

Create `.env` locally and set:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/restaurant_pos"
```

Do not commit real credentials. Migrations will be generated after the initial schema review and local PostgreSQL validation.
