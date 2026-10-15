<img src="assets/icon.svg" width="64" height="64" alt="">

# Tuya Energy Monitor

A self-hosted web app for monitoring heating energy consumption across multiple
Tuya and Smart Life accounts, homes, and devices.

**Status:** Design in progress. The application and Docker image build are not
implemented yet.

## Planned capabilities

- Connect multiple Tuya and Smart Life accounts, treating each home as an apartment.
- Track apartment totals and drill down into individual heaters.
- Configure daily energy limits separately for each apartment.
- Detect unusually high consumption against each apartment's rolling history.
- Send timely alerts and weekly consumption and monitoring summaries through Resend.
- Protect the dashboard with a single owner login.

## Deployment direction

The planned stack is TypeScript, React, a Node.js/Fastify server, and SQLite on a
persistent volume. GitHub Actions will build and publish a Docker image to GitHub
Container Registry for self-hosting, including deployment through Nori.

Tuya API access, device data availability, and reporting intervals still need to
be validated against real devices before the integration design is finalized.

## License

[MIT](LICENSE)
