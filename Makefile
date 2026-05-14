.PHONY: bootstrap build lint typecheck test test-api test-api-e2e test-worker infra-up infra-down infra-reset infra-logs infra-ps dev-api dev-worker db-migrate db-migrate-dev db-migrate-status db-seed db-seed-demo compose-config docker-build demo-up demo-down demo-reset demo-logs demo-ps demo-migrate demo-seed

bootstrap:
	pnpm install --frozen-lockfile
	cd services/api && pnpm run prisma:generate
	python -m pip install -r services/worker/requirements.txt

build:
	pnpm run build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm run test

test-api:
	pnpm run test:api

test-api-e2e:
	pnpm run test:api:e2e

test-worker:
	pnpm run test:worker

infra-up:
	docker compose -f infra/compose/docker-compose.yml up -d

infra-down:
	docker compose -f infra/compose/docker-compose.yml down

infra-reset:
	docker compose -f infra/compose/docker-compose.yml down -v

infra-logs:
	docker compose -f infra/compose/docker-compose.yml logs -f --tail=200

infra-ps:
	docker compose -f infra/compose/docker-compose.yml ps

dev-api:
	cd services/api && pnpm run start:dev

dev-worker:
	cd services/worker && uvicorn main:app --reload --port 8000

db-migrate:
	pnpm run db:migrate

db-migrate-dev:
	pnpm run db:migrate:dev

db-migrate-status:
	pnpm run db:migrate:status

db-seed:
	pnpm run db:seed

db-seed-demo:
	pnpm run db:seed:demo

compose-config:
	pnpm run compose:config

docker-build:
	pnpm run docker:build

demo-up:
	pnpm run demo:up

demo-down:
	pnpm run demo:down

demo-reset:
	pnpm run demo:reset

demo-logs:
	pnpm run demo:logs

demo-ps:
	pnpm run demo:ps

demo-migrate:
	pnpm run demo:migrate

demo-seed:
	pnpm run demo:seed
