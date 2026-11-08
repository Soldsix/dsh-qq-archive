# dsh-qq-archive

An opt-in DSH messaging archive. A configured tenant, account and group or private peer are required before any event is saved. The selected lists form an intersection, not a list of account/group pairs. Each selected conversation uses a separate SQLite file. The plugin does not register a model-facing search or export tool.

This package is under development and is not ready for release. It archives normalized event text and opaque media references, not image or audio bytes. It cannot recover events that the transport did not receive. It reports capacity, duplicate-identity conflicts and uncertain timeouts rather than retrying automatically. An uncertain write may still have been committed; check the archive before retrying.

SQLite files are not encrypted. Access depends on host filesystem permissions; this plugin is not a defense against a privileged local user. Archives may contain personal conversations. Choose only scopes you are authorized to retain and protect the data according to your deployment's privacy requirements.

Requires Node ^22.19 or >=24, DSH 0.2.2-rc.1 and a compatible `dsh-im-kit` transport. The provided bundle is disabled. Before enabling it, configure explicit tenants, networks, accounts and groups or private peers. `allowAnyTenant` and `allowAnyAccount` broaden their respective dimensions; they do not override the conversation selection. The default archive directory is `data/qq-archive` in the selected profile. A custom directory must be absolute.

The status service exposes counts and error codes only. It does not expose message contents or identities. No automatic deletion, history replay, migration, attachment download or UI configuration is included yet. Run `npm test` for synthetic-data tests. Do not point tests at a production profile or database.
