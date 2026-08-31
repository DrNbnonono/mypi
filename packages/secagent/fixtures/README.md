# Offline loopback fixtures

These fixtures are disposable inputs for SecAgent demonstrations and tests.
They do not contact a model, download scripts, or access a public target.

The manifest is the source of truth for the fixture inventory and allowed
hosts. `web/http-server.mjs` defaults to `127.0.0.1`; the Compose fixture
service overrides this to `0.0.0.0`, which is the container-only interface on
the internal Compose network. No fixture service publishes a host port.

The Docker template compiles the two C sources into disposable ELF files and
generates the PNG with Node's built-in APIs. The generated files are written
outside the source tree under `/opt/secagent-fixtures` and are never executed
by the image entry point.

Example controlled run:

```sh
docker compose -f packages/secagent/templates/docker-compose.yml --profile fixtures up -d fixture-web
docker compose -f packages/secagent/templates/docker-compose.yml run --rm pi-secagent cli --help
```

The only network target intended for the discovery scenario is
`fixture-web:8080` (or `127.0.0.1` when the service runs in the same
container). Do not replace it with a public hostname or address.
