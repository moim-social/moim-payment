# Moim Ticket Payment Service

Small ticket checkout/payment ledger for Moim paid ticket MVP. It does not access the Moim database; integration is through HTTP APIs and signed callbacks.

## Commands

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm check
```

## Environment

Copy `.env.example` and set production values before deploying.

The service trusts checkout records created by Moim server requests, not browser-submitted amounts.

Set `DATABASE_URL` in k3s/CloudNativePG deployments. Without it, the process uses the in-memory repository intended only for local development and tests.

Provider accounts are configured through individual PortOne environment variables.
Set `DEFAULT_ENABLED_EASY_PAY_PROVIDERS` to a comma-separated list such as
`kakaopay` or `kakaopay,tosspay`. A provider account is created only when both
its store ID and channel key are present. Naver Pay also requires
`PORTONE_NAVERPAY_ENABLED=true`.
