# Brainrot Party Backend (scaffold)

## Run (dev)
```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
