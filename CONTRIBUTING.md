# Contributing

Thanks for your interest in Sshelby!

Please read and follow the [code of conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

Open an issue on [GitHub](https://github.com/croos555/sshelby/issues) with your OS, the
Sshelby version and the steps to reproduce. **Never paste passwords, private keys or your
`vault.json`**; mask host names if needed.

Security issues: see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development

See [docs/development.md](docs/development.md) for the setup and the architecture.

Before opening a pull request:

- `npm run typecheck` passes,
- the app builds (`npm run build`) and you tried your change in `npm run dev`,
- no new native dependency, `npm audit --omit=dev` stays clean,
- commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`…) and explain *why* when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
