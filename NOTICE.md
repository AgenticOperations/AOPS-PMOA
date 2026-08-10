# Third-Party Notices

This repository is licensed under the MIT License (see [LICENSE](LICENSE)).

It also vendors or depends on third-party components that retain their own
licenses. The following paths are especially important:

| Path | Upstream | License notes |
|---|---|---|
| `packages/onchain/lib/forge-std/` | [foundry-rs/forge-std](https://github.com/foundry-rs/forge-std) | Dual-licensed under MIT and Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`) |
| `packages/onchain/lib/base-contracts/` | Base / OpenZeppelin-related contracts tree | See `packages/onchain/lib/base-contracts/LICENSE` |

npm dependencies installed into `node_modules/` remain under their respective
package licenses as declared on npm. Use `npm ls` and each package's
`LICENSE` / `package.json` `license` field for the authoritative terms.

When contributing code that introduces a new dependency:

1. Prefer MIT, Apache-2.0, BSD, or ISC licensed packages.
2. Do not add GPL / AGPL dependencies without an explicit maintainer decision.
3. Document any newly vendored source trees in this file.
