# dsh-qq-archive

An opt-in DSH messaging archive. A configured tenant, account and group or private peer are required before any event is saved. The selected lists form an intersection, not a list of account/group pairs. Each selected conversation uses a separate SQLite file. The plugin does not register a model-facing search or export tool.

This package is under development and is not ready for release. It archives normalized event text and opaque media references, not image or audio bytes. It cannot recover events that the transport did not receive. It reports capacity, duplicate-identity conflicts and uncertain timeouts rather than retrying automatically. An uncertain write may still have been committed; check the archive before retrying.

SQLite files are not encrypted. Access depends on host filesystem permissions; this plugin is not a defense against a privileged local user. Archives may contain personal conversations. Choose only scopes you are authorized to retain and protect the data according to your deployment's privacy requirements.

Requires Node ^22.19 or >=24, DSH 0.2.2-rc.1 and a compatible `dsh-im-kit` transport. The provided bundle is disabled. Before enabling it, configure explicit tenants, networks, accounts and groups or private peers. `allowAnyTenant` and `allowAnyAccount` broaden their respective dimensions; they do not override the conversation selection. The default archive directory is `data/qq-archive` in the selected profile. A custom directory must be absolute.

Install the matching `dsh-im-kit` package in the profile first, then use `dsh plugin --profile <profile> add <archive>` to add this bundle. Until `dsh-im-kit` is published, its locally built package is required. The plugin also needs an IM transport to publish normalized events. The owner can configure the bundle in the DSH plugin page, or add a profile patch such as:

```yaml
- id: qq-archive
  config:
    enabled: true
    tenants: [example-tenant]
    networks: [onebot11]
    accounts: [example-account]
    groups: [example-group]
```

These identifiers are placeholders and must match the transport's account and conversation identities. Add `privatePeers` explicitly only when private-chat retention is intended.

The status service exposes counts and error codes only. It does not expose message contents or identities. The owner settings entry shows configuration and status. While the archive is active, the only permitted change is to switch it off. Save that change before editing other settings; messages received until it is enabled again are not archived. Explicit per-record and outstanding-byte limits reject oversized work without truncating it. No automatic deletion, history replay, migration or attachment download is included yet. Run `npm test` for synthetic-data tests. Do not point tests at a production profile or database.
