# dsh-qq-archive

Opt-in durable archiving for DSH messaging plugins. Select tenant, network, bot account and group/private peer IDs before enabling it. Selections intersect; they are not account/group tuple pairs. Each conversation has its own SQLite file. No model-facing tool is registered.

## Install

```sh
dsh plugin --profile MY_PROFILE add https://github.com/Soldsix/dsh-qq-archive/releases/download/v0.2.1/dsh-qq-archive-0.2.1.tgz
```

The public `dsh-im-kit` dependency is installed automatically. A separately installed IM provider supplies normalized events. Target: DSH 0.2.2-rc.1, Cordis ~4.1.0, Node ^22.19 or >=24. The bundle is disabled by default. Open Plugins → dsh-qq-archive to configure it, or use a profile patch:

```yaml
- id: qq-archive
  config:
    enabled: true
    tenants: [example-tenant]
    networks: [onebot11]
    accounts: [example-account]
    groups: [example-group]
    readEnabled: false
```

These IDs must match the provider. Add `privatePeers` only when authorized to retain private chats. `allowAnyTenant` and `allowAnyAccount` widen only their respective selection. The default directory is `data/qq-archive` in the selected profile; custom directories must be absolute.

## Storage and limits

Complete normalized source events and opaque attachment references are stored; media bytes are not downloaded. Duplicate identities retain the first source. Identity conflicts, capacity failures and timeouts are visible. A write timeout means its outcome is uncertain and is never retried automatically. Events not received from the provider cannot be recovered.

A dedicated ingestion worker keeps SQLite work off the Host event loop. Record count/byte admission limits reject oversized messages without truncation. Disposal waits for pending writes or reports a shutdown timeout. Data remains after disablement or uninstall. No automatic deletion, historical replay, migration or encryption is included. Protect local files and archive only conversations you are entitled to retain.

## Storage-owner reads

`qqArchive.read(request, signal)` is a trusted Host API, disabled until the owner enables `readEnabled`. It accepts a selected scope, sender filter, Unicode substring, exclusive cursor position and resource budgets; it accepts no SQL or database path. The caller must authorize requester identity and disclosure before calling it. The separate history-search plugin supplies that policy; this API is not a sandbox for arbitrary Host code.

Read workers belong to this plugin and are separate from the writer. Owner limits cap concurrent workers, scanned records/bytes, result count/bytes, record bytes and elapsed time. Smaller caller budgets are honored. A page never truncates text; `partial` reports oversized skipped records and `next` continues before the last scanned position. Cancellation and timeout terminate only that read; its promise settles after worker exit. Missing or incompatible databases fail without creating or migrating them. Scope selection is enforced again by the owner. Schema version remains 1.

The native owner page exposes configuration and content-free counters, including active reads. Pause and save before changing configuration, then re-enable; messages received while paused are not retained. Query enablement is independent of model access and does not register a model tool.

## Development and preview scope

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --pack-destination artifacts
npm run test:native
npm run test:browser
npm run test:web
```

Tests use synthetic profiles and identities. Never point them at production data. This preview provides normalized event storage and bounded Host reads, not binary media archival, semantic memory, authenticated model history tools or offline message recovery. Actual QQ and desktop verification remain separate.
